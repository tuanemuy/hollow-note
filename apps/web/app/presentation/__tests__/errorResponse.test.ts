import { describe, expect, it } from "vitest";
import {
  httpStatusFor,
  redactForClient,
  type SerializedError,
  type SerializedErrorKind,
} from "../errorResponse";

const withKind = (
  kind: SerializedErrorKind,
  code: string | null = null,
): SerializedError =>
  ({ kind, code, message: "raw internal detail" }) as SerializedError;

describe("httpStatusFor", () => {
  it("maps every kind to its status", () => {
    const expected: Record<SerializedErrorKind, number> = {
      business: 422,
      notFound: 404,
      conflict: 409,
      unauthorized: 401,
      forbidden: 403,
      validation: 422,
      system: 500,
      unknown: 500,
    };
    for (const [kind, status] of Object.entries(expected)) {
      expect(httpStatusFor(withKind(kind as SerializedErrorKind))).toBe(status);
    }
  });

  it("applies the closed list of code-level exceptions", () => {
    expect(httpStatusFor(withKind("validation", "UNAUTHENTICATED"))).toBe(401);
    expect(httpStatusFor(withKind("validation", "THROTTLED"))).toBe(429);
    expect(httpStatusFor(withKind("validation", "LOCKED"))).toBe(429);
    expect(httpStatusFor(withKind("validation", "RATE_LIMITED"))).toBe(429);
    expect(httpStatusFor(withKind("notFound", "NOTE_GONE"))).toBe(410);
  });

  it("scopes each exception to its own kind", () => {
    expect(httpStatusFor(withKind("business", "THROTTLED"))).toBe(422);
    expect(httpStatusFor(withKind("notFound", "UNAUTHENTICATED"))).toBe(404);
    expect(httpStatusFor(withKind("validation", "NOTE_GONE"))).toBe(422);
  });

  it("falls back to the kind mapping for unlisted or absent codes", () => {
    expect(httpStatusFor(withKind("validation", "INVALID_CREDENTIALS"))).toBe(
      422,
    );
    expect(httpStatusFor(withKind("notFound", null))).toBe(404);
  });

  // P-12 / P-14 が増やしたコードは、どれもクライアントの振る舞いを変えない
  // （401 でサインインへ、429 で待つ、410 で索引から落とす、のいずれでもない）
  // ので、例外表には**入らない**。ここはその「入っていないこと」を固定する。
  it("keeps the editing and trash codes on their kind mapping", () => {
    expect(httpStatusFor(withKind("business", "NOTE_LOCKED_BY_JOB"))).toBe(422);
    expect(httpStatusFor(withKind("business", "NOTE_IS_TRASHED"))).toBe(422);
    expect(httpStatusFor(withKind("business", "NOTE_CONTENT_TOO_LARGE"))).toBe(
      422,
    );
    expect(httpStatusFor(withKind("business", "NOTE_INVALID_TITLE"))).toBe(422);
    expect(httpStatusFor(withKind("business", "NOTE_INVALID_STYLE_MODE"))).toBe(
      422,
    );
    expect(httpStatusFor(withKind("validation", "NOTE_NOT_TRASHED"))).toBe(422);
    expect(httpStatusFor(withKind("notFound", "REVISION_NOT_FOUND"))).toBe(404);
    // 競合は再試行が意味を持つ唯一の枝なので 409 で届く必要がある。
    expect(httpStatusFor(withKind("conflict", "OPTIMISTIC_LOCK_FAILURE"))).toBe(
      409,
    );
  });
});

describe("redactForClient", () => {
  it("strips code and message from system errors", () => {
    expect(
      redactForClient({
        kind: "system",
        code: "DATABASE_ERROR",
        message: "libsql: connect ECONNREFUSED 10.0.0.1:5432",
        retryable: true,
      } as SerializedError),
    ).toEqual({
      kind: "system",
      code: null,
      message: "System error",
      retryable: true,
    });
  });

  it("strips code and message from unknown errors", () => {
    expect(
      redactForClient(withKind("unknown", "INTERNAL_TABLE_MISSING")),
    ).toEqual({ kind: "unknown", code: null, message: "System error" });
  });

  it("passes every client-actionable kind through untouched", () => {
    const kinds = [
      "business",
      "notFound",
      "conflict",
      "unauthorized",
      "forbidden",
      "validation",
    ] as const satisfies readonly SerializedErrorKind[];
    for (const kind of kinds) {
      const serialized = withKind(kind, "SOME_CODE");
      expect(redactForClient(serialized)).toEqual(serialized);
    }
  });

  it("keeps field errors on validation errors", () => {
    const serialized: SerializedError = {
      kind: "validation",
      code: "THROTTLED",
      message: "Too many attempts",
      fieldErrors: { waitSeconds: ["30"] },
    };
    expect(redactForClient(serialized)).toEqual(serialized);
  });
});
