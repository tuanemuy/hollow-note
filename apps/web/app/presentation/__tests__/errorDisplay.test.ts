import { NoteRevision } from "@repo/core/domain/note/noteRevision";
import { NoteTitle } from "@repo/core/domain/note/valueObject";
import {
  AVATAR_MAX_BYTES,
  MEDIA_IMAGE_MAX_BYTES,
  MEDIA_SVG_MAX_BYTES,
  MEDIA_VIDEO_MAX_BYTES,
} from "@repo/core/domain/storage/services/uploadValidationPolicy";
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

const MB = 1024 * 1024;
const megabytes = (bytes: number): string => `${bytes / MB} MB`;
const kilobytes = (bytes: number): string => `${bytes / 1024} KB`;

/**
 * タイトルの上限。ドメインは定数を公開しないので、受け付ける最大の長さを
 * `NoteTitle` 自身に引かせる — 辞書の数字がドメインから逸れたら落ちる。
 */
const TITLE_MAX_LENGTH = ((): number => {
  const accepts = (length: number): boolean => {
    try {
      NoteTitle.create("a".repeat(length), "manual");
      return true;
    } catch {
      return false;
    }
  };
  for (let length = 1; length <= 4096; length += 1) {
    if (!accepts(length)) return length - 1;
  }
  throw new Error("NoteTitle accepts a title longer than the probed range");
})();

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
  // と「何をすればいいか」が消えるので、各コードの文言が言うべきことを
  // キーワードで押さえる。数字はドメイン定数から組み、辞書がドメインから
  // 逸れたら落ちるようにする。
  const EDITING_CODES: readonly (readonly [
    SerializedErrorKind,
    string,
    string,
  ])[] = [
    ["business", "NOTE_IS_TRASHED", "ゴミ箱"],
    ["business", "NOTE_CONTENT_TOO_LARGE", "分割"],
    ["business", "NOTE_HTML_TOO_COMPLEX", "複雑"],
    ["business", "NOTE_LOCKED_BY_JOB", "処理中"],
    ["business", "NOTE_INVALID_TITLE", `${TITLE_MAX_LENGTH} 文字`],
    ["business", "NOTE_INVALID_STYLE_MODE", "表示スタイル"],
    ["business", "NOTE_CANNOT_CAPTURE_EMPTY_CONTENT", "取り込み"],
    ["business", "USAGE_STORAGE_QUOTA_EXCEEDED", "容量"],
    ["business", "STORAGE_UNSUPPORTED_MIME_TYPE", "形式"],
    ["business", "STORAGE_FILE_TOO_LARGE", megabytes(AVATAR_MAX_BYTES)],
    ["validation", "NOTE_NOT_TRASHED", "再読み込み"],
    ["notFound", "REVISION_NOT_FOUND", `${NoteRevision.RETENTION} 版`],
    // `OPTIMISTIC_LOCK_FAILURE` はここに入れない。辞書の文言が conflict の
    // 共通文言と同一で、それが正しい（競合はどの経路でも「もう一度」でよい）
    // ため、どのキーワードも辞書の当たり外れを区別しない。
  ];

  it("says what each editing / trash code the slice reaches asks the reader to do", () => {
    for (const [kind, code, keyword] of EDITING_CODES) {
      expect(renderErrorMessage(withKind(kind, code))).toContain(keyword);
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
    expect(tooLarge).toContain(megabytes(AVATAR_MAX_BYTES));
    expect(tooLarge).toContain(megabytes(MEDIA_IMAGE_MAX_BYTES));
    expect(tooLarge).toContain(kilobytes(MEDIA_SVG_MAX_BYTES));
    expect(tooLarge).toContain(megabytes(MEDIA_VIDEO_MAX_BYTES));
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
