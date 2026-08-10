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
