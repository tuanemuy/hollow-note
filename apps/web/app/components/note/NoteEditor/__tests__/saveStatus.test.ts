import { describe, expect, it } from "vitest";
import {
  AppServerError,
  type SerializedError,
  type SerializedErrorKind,
} from "@/presentation/errorResponse";
import {
  classifySaveFailure,
  describeFailure,
  FAILED_LABEL,
  type RetryTarget,
} from "../saveStatus";

const RETRY: RetryTarget = { kind: "save" };

/**
 * 一次経路 5 つの見本。`satisfies` で網羅を型に見張らせてあるので、
 * `RetryTarget` に種類が増えるとこの表がコンパイルエラーになる — 再試行の
 * 宛先と一次経路が 1 対 1 であることの正典が表の側で欠けない。
 */
const TARGETS = {
  save: { kind: "save" },
  mode: { kind: "mode", mode: "html", acknowledged: false },
  conflict: { kind: "conflict", keepLocal: true },
  revision: { kind: "revision", revisionId: "rev-1" },
  reload: { kind: "reload" },
} satisfies { [K in RetryTarget["kind"]]: Extract<RetryTarget, { kind: K }> };

const EVERY_TARGET: readonly RetryTarget[] = Object.values(TARGETS);

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

/**
 * `failed` の見出しと案内。落ちた往復ごとに分かれていないと、版の復元が
 * 落ちた画面が「保存できませんでした」と告げ、利用者は保存されていない
 * 打鍵を探しに行く。
 */
describe("describeFailure", () => {
  it("names each failed roundtrip apart so the heading matches what was pressed", () => {
    const titles = EVERY_TARGET.map(
      (retry) => describeFailure({ stashed: false, retry }, false).title,
    );
    expect(new Set(titles).size).toBe(EVERY_TARGET.length);
  });

  it("offers a retry in every hint (the roundtrip never happened)", () => {
    for (const retry of EVERY_TARGET) {
      expect(describeFailure({ stashed: false, retry }, false).hint).toContain(
        "もう一度お試しください",
      );
    }
  });

  it("promises the local stash only once it has actually been written", () => {
    // 退避を書けるのは保存の `catch` だけなので、それ以外の往復が
    // 「退避した」と告げると、利用者はそれを信じて画面を離れる。
    expect(
      describeFailure({ stashed: false, retry: TARGETS.save }, false).hint,
    ).toContain("退避していません");
    expect(
      describeFailure({ stashed: true, retry: TARGETS.save }, false).hint,
    ).toContain("退避したので");
  });

  it("tells every roundtrip but the save that nothing moved", () => {
    // `failed` はどの種でも「往復そのものが成立しなかった」を意味するので、
    // 面もサーバーも動いていない。退避を書けるのは保存の `catch` だけなので、
    // 保存だけが別の案内を持つ。
    for (const retry of EVERY_TARGET) {
      const hint = describeFailure({ stashed: false, retry }, false).hint;
      if (retry.kind === "save") {
        expect(hint).toContain("退避していません");
      } else {
        expect(hint).toContain("面の内容はそのまま");
      }
    }
  });

  it("labels the bar by the roundtrip that fell, not by 保存", () => {
    // 上部バーは Alert と同じ画面に並ぶ。版の復元が落ちた画面のバーが
    // 「保存に失敗しました」と言うと、利用者は保存されていない打鍵を
    // 探しに行く。
    const labels = EVERY_TARGET.map((retry) => FAILED_LABEL[retry.kind]);
    expect(new Set(labels).size).toBe(EVERY_TARGET.length);
    expect(FAILED_LABEL.save).toContain("保存");
    for (const retry of EVERY_TARGET) {
      if (retry.kind === "save") continue;
      expect(FAILED_LABEL[retry.kind]).not.toContain("保存");
    }
  });

  it("sends a note that does not exist yet to the download instead of the stash", () => {
    const hint = describeFailure(
      { stashed: false, retry: TARGETS.save },
      true,
    ).hint;
    expect(hint).toContain("ダウンロード");
  });
});
