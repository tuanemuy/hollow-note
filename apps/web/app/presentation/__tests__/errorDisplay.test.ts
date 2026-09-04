import { describe, expect, it } from "vitest";
import { displayError, renderErrorMessage } from "../errorDisplay";
import {
  AppServerError,
  extractSerializedError,
  type SerializedError,
  type SerializedErrorKind,
} from "../errorResponse";

const RAW_MESSAGE = "libsql: connect ECONNREFUSED 10.0.0.1:5432";

const withKind = (
  kind: SerializedErrorKind,
  code: string | null = null,
): SerializedError => ({ kind, code, message: RAW_MESSAGE }) as SerializedError;

const KINDS = [
  "business",
  "notFound",
  "conflict",
  "unauthorized",
  "forbidden",
  "validation",
  "system",
  "unknown",
] as const satisfies readonly SerializedErrorKind[];

describe("renderErrorMessage", () => {
  it("falls back to the shared message of the kind for codes outside the dictionary", () => {
    const expected: Record<SerializedErrorKind, string> = {
      business: "入力内容を確認してもう一度お試しください。",
      notFound:
        "対象が見つかりません。URL が変わったか、削除された可能性があります。",
      conflict: "他の操作と競合しました。もう一度お試しください。",
      unauthorized:
        "サインインが必要です。サインインしてからもう一度お試しください。",
      forbidden: "この操作を行う権限がありません。",
      validation: "入力内容を確認してもう一度お試しください。",
      system:
        "一時的な問題が発生しました。少し待ってからもう一度お試しください。",
      unknown:
        "うまく処理できませんでした。少し待ってからもう一度お試しください。",
    };
    for (const kind of KINDS) {
      expect(renderErrorMessage(withKind(kind, null))).toBe(expected[kind]);
      expect(renderErrorMessage(withKind(kind, "NOT_IN_DICTIONARY"))).toBe(
        expected[kind],
      );
    }
  });

  it("never leaks the raw server message", () => {
    const codes = [
      null,
      "NOT_IN_DICTIONARY",
      "UNAUTHENTICATED",
      "NOTE_NOT_FOUND",
      "OPTIMISTIC_LOCK_FAILURE",
    ];
    for (const kind of KINDS) {
      for (const code of codes) {
        const rendered = renderErrorMessage(withKind(kind, code));
        expect(typeof rendered).toBe("string");
        expect(rendered).not.toContain(RAW_MESSAGE);
      }
    }
  });

  it("ignores codes inherited from Object.prototype", () => {
    const inherited = [
      "constructor",
      "toString",
      "valueOf",
      "hasOwnProperty",
      "__proto__",
      "__defineGetter__",
    ];
    for (const code of inherited) {
      const rendered = renderErrorMessage(withKind("business", code));
      expect(rendered).toBe("入力内容を確認してもう一度お試しください。");
    }
  });

  it("renders NOTE_ACCESS_DENIED identically to NOTE_NOT_FOUND", () => {
    expect(
      renderErrorMessage(withKind("forbidden", "NOTE_ACCESS_DENIED")),
    ).toBe(renderErrorMessage(withKind("notFound", "NOTE_NOT_FOUND")));
  });

  it("uses the dictionary entry when the code is known", () => {
    expect(renderErrorMessage(withKind("validation", "UNAUTHENTICATED"))).toBe(
      "サインインが必要です。サインインしてからもう一度お試しください。",
    );
    expect(renderErrorMessage(withKind("notFound", "NOTE_GONE"))).toBe(
      "このノートは削除されています。ノート一覧からお探しください。",
    );
  });

  // P-12 ノート編集 / P-14 ゴミ箱 が実際に到達するコード。共通文言に落ちる
  // と「何をすればいいか」が消えるので、辞書に載っていること自体を押さえる。
  const EDITING_CODES: readonly (readonly [SerializedErrorKind, string])[] = [
    ["business", "NOTE_IS_TRASHED"],
    ["business", "NOTE_CONTENT_TOO_LARGE"],
    ["business", "NOTE_HTML_TOO_COMPLEX"],
    ["business", "NOTE_LOCKED_BY_JOB"],
    ["business", "NOTE_INVALID_TITLE"],
    ["business", "NOTE_INVALID_STYLE_MODE"],
    ["business", "NOTE_CANNOT_CAPTURE_EMPTY_CONTENT"],
    ["business", "USAGE_STORAGE_QUOTA_EXCEEDED"],
    ["business", "STORAGE_UNSUPPORTED_MIME_TYPE"],
    ["business", "STORAGE_FILE_TOO_LARGE"],
    ["validation", "NOTE_NOT_TRASHED"],
    ["notFound", "REVISION_NOT_FOUND"],
    // `OPTIMISTIC_LOCK_FAILURE` はここに入れない。辞書の文言が conflict の
    // 共通文言と同一で、それが正しい（競合はどの経路でも「もう一度」でよい）
    // ため、この形の判定では区別できない。
  ];

  it("has a dictionary entry for every editing / trash code the slice reaches", () => {
    for (const [kind, code] of EDITING_CODES) {
      expect(renderErrorMessage(withKind(kind, code))).not.toBe(
        renderErrorMessage(withKind(kind, null)),
      );
    }
  });

  it("tells the reader to wait rather than retry while a job holds the note", () => {
    // 共通文言（「もう一度お試しください」）は、ジョブが終わるまで成功しない
    // 再試行を勧めてしまう。移動サガの 4 コードと同じ判断。
    const rendered = renderErrorMessage(
      withKind("business", "NOTE_LOCKED_BY_JOB"),
    );
    expect(rendered).toContain("待って");
    expect(rendered).not.toContain("もう一度お試しください");
  });

  it("tells the reader what to change rather than to retry an unprocessable body", () => {
    // 資源の上限による拒否は、同じ本文を送れば必ず同じ結果になる。共通文言の
    // 「入力内容を確認してもう一度お試しください」は実行不能な助言なので、
    // 何を変えれば通るかを言う（`NOTE_LOCKED_BY_JOB` と同じ判断）。
    const rendered = renderErrorMessage(
      withKind("business", "NOTE_HTML_TOO_COMPLEX"),
    );
    expect(rendered).toContain("複雑");
    expect(rendered).not.toBe(renderErrorMessage(withKind("business", null)));
  });

  it("names both upload purposes in the shared storage codes", () => {
    // アイコンと本文のメディアは許す形式も上限も違うのに、ドメインが投げる
    // コードは 1 つ。辞書は `code` しか読まないので、両方を書くほかない。
    const unsupported = renderErrorMessage(
      withKind("business", "STORAGE_UNSUPPORTED_MIME_TYPE"),
    );
    expect(unsupported).toContain("アイコン");
    expect(unsupported).toContain("SVG");
    const tooLarge = renderErrorMessage(
      withKind("business", "STORAGE_FILE_TOO_LARGE"),
    );
    expect(tooLarge).toContain("5 MB");
    expect(tooLarge).toContain("200 MB");
  });
});

describe("extractSerializedError", () => {
  it("returns the payload carried by an AppServerError instance", () => {
    const serialized = withKind("conflict", "OPTIMISTIC_LOCK_FAILURE");
    expect(extractSerializedError(new AppServerError(serialized))).toEqual(
      serialized,
    );
  });

  it("recovers the payload from a structural remnant", () => {
    const serialized = withKind("notFound", "NOTE_NOT_FOUND");
    expect(extractSerializedError({ serialized })).toEqual(serialized);
  });

  it("falls back to an unknown error for a plain Error", () => {
    expect(extractSerializedError(new Error(RAW_MESSAGE))).toEqual({
      kind: "unknown",
      code: null,
      message: RAW_MESSAGE,
    });
  });

  it("falls back to an unknown error for a remnant of an unlisted kind", () => {
    expect(
      extractSerializedError({
        serialized: { kind: "teapot", code: null, message: RAW_MESSAGE },
      }),
    ).toEqual({ kind: "unknown", code: null, message: "Unexpected error" });
  });
});

describe("displayError", () => {
  it("keeps the raw message of a plain Error out of the UI string", () => {
    const rendered = displayError(new Error(RAW_MESSAGE));
    expect(rendered).not.toContain(RAW_MESSAGE);
    expect(rendered).toBe(
      "うまく処理できませんでした。少し待ってからもう一度お試しください。",
    );
  });
});
