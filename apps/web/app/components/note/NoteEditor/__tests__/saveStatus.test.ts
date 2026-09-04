import { describe, expect, it } from "vitest";
import {
  AppServerError,
  type SerializedError,
  type SerializedErrorKind,
} from "@/presentation/errorResponse";
import { classifySaveFailure, type RetryTarget } from "../saveStatus";

const RETRY: RetryTarget = { kind: "save" };

const thrown = (
  kind: SerializedErrorKind,
  code: string | null = null,
): unknown =>
  new AppServerError({
    kind,
    code,
    message: "libsql: connect ECONNREFUSED 10.0.0.1:5432",
  } as SerializedError);

/**
 * P-12 状態表の 2 つの集合を両側から固定する。`classifySaveFailure` は
 * 「再試行と端末への退避を出してよい失敗」を列挙し、決定的な業務拒否を
 * **その補集合**として閉じているので、片側だけの表では閉じる向きが逆転
 * しても緑のままになる。
 */
describe("classifySaveFailure", () => {
  it.each(["system", "unknown", "unauthorized"] as const)(
    "puts a %s failure on the retryable side (the roundtrip never happened)",
    (kind) => {
      const status = classifySaveFailure(thrown(kind), RETRY);
      expect(status).toEqual({
        kind: "failed",
        message: expect.any(String),
        // 退避を書いたかを知るのは呼び出し元なので、ここでは常に偽。
        stashed: false,
        retry: RETRY,
      });
    },
  );

  it("carries the failed roundtrip so the retry button re-sends that one", () => {
    const target: RetryTarget = { kind: "revision", revisionId: "rev-1" };
    const status = classifySaveFailure(thrown("system"), target);
    expect(status).toMatchObject({ kind: "failed", retry: target });
  });

  it.each([
    ["business", "NOTE_CONTENT_TOO_LARGE"],
    ["business", "NOTE_CONTENT_NOT_READY"],
    ["validation", "INVALID_INPUT"],
    ["notFound", "REVISION_NOT_FOUND"],
    ["conflict", "SOME_FUTURE_CONFLICT"],
    ["forbidden", "SOME_FUTURE_REFUSAL"],
    // コードを名乗らない業務拒否も既定でこちらへ落ちる。
    ["business", null],
  ] as const)(
    "puts a deterministic %s refusal (%s) on the rejected side",
    (kind, code) => {
      expect(classifySaveFailure(thrown(kind, code), RETRY)).toEqual({
        kind: "rejected",
        message: expect.any(String),
      });
    },
  );

  it("routes the version race to the conflict resolution, not to a retry", () => {
    expect(
      classifySaveFailure(thrown("conflict", "OPTIMISTIC_LOCK_FAILURE"), RETRY),
    ).toEqual({ kind: "conflict" });
  });

  it("routes a running job to the locked state so the reader waits", () => {
    expect(
      classifySaveFailure(thrown("business", "NOTE_LOCKED_BY_JOB"), RETRY),
    ).toEqual({ kind: "locked" });
  });

  it.each([
    "NOTE_NOT_FOUND",
    "NOTE_ACCESS_DENIED",
    "NOTE_IS_TRASHED",
    "WORKSPACE_INSUFFICIENT_ROLE",
  ])("freezes the surface for %s (the note is no longer editable)", (code) => {
    expect(classifySaveFailure(thrown("notFound", code), RETRY)).toEqual({
      kind: "blocked",
      message: expect.any(String),
    });
  });

  it("keeps the blocking codes ahead of the transient kinds", () => {
    // 権限喪失はセッション切れ（`unauthorized`）として届きうる。退避と
    // 再試行ではなくダウンロードを出す側に落ちなければならない。
    expect(
      classifySaveFailure(
        thrown("unauthorized", "WORKSPACE_INSUFFICIENT_ROLE"),
        RETRY,
      ),
    ).toMatchObject({ kind: "blocked" });
  });
});
