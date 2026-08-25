import { applyD1Migrations, env } from "cloudflare:test";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { ConflictError } from "../../../application/errors";
import type { PublicNoteProjectionWriter } from "../../../domain/note/ports/publicNoteProjectionWriter";
import {
  makeProjectionEntry,
  noteId,
  userId,
} from "../../conformance/fixtures";
import { createD1PublicNoteProjectionWriter } from "../d1/repositories/publicNoteProjection";
import { createD1PublicNoteQueryService } from "../d1/repositories/publicNoteQueryService";
import { GLOBAL_TABLES, GLOBAL_WIPE_STATEMENTS } from "../d1/schema";
import { createD1Executor } from "../sql/executor";
import { createAutocommitSession, type SqlSession } from "../sql/session";
import { statement } from "../sql/statement";

/**
 * AC-4, the public-projection half: `events-public-projection` runs at
 * concurrency 4, so two consumers can hold the same note at once.
 *
 * The memory backend makes read-compare-write atomic by being
 * single-threaded, so the shared suites cannot reach this interleaving —
 * which is why the observation lives here. What is at stake is not only
 * the body row: the FTS index is contentless, so a withdrawal names the
 * tokens of the row that was read, and a stale withdrawal both leaves the
 * winner's tokens standing over the loser's body and cancels tokens that
 * were already gone. `'rebuild'` is unavailable on a contentless index
 * (ADR 017), so every case searches for the keywords of all three
 * revisions rather than only reading the row back.
 *
 * `interposeOnce` stages the race rather than hoping for it: the rival
 * commits between the observed writer's read and its apply.
 */

const AT = new Date("2026-01-10T00:00:00.000Z");

/** A session whose next `write` lets `rival` commit first. */
const interposeOnce = (
  session: SqlSession,
  rival: () => Promise<unknown>,
): SqlSession => {
  let pending = true;
  return {
    ...session,
    async write(mutations) {
      if (pending) {
        pending = false;
        await rival();
      }
      await session.write(mutations);
    },
  };
};

const snapshotOf = (body: string) =>
  makeProjectionEntry(1, userId(1), AT, {
    visibility: "public",
    title: "共有ノート",
    text: `${body}の記録`,
    excerpt: `${body}の記録`,
  });

const version = (projectionRevision: number) => ({
  projectionRevision,
  authorVersion: 1,
  workspaceVersion: 0,
  routeVersion: 1,
});

describe("cloudflare public projection concurrency", () => {
  const executor = createD1Executor(env.GLOBAL_DB);
  const session = createAutocommitSession(executor);
  const writer = createD1PublicNoteProjectionWriter(session);
  const queryService = createD1PublicNoteQueryService(session);

  const racing = (rival: () => Promise<unknown>): PublicNoteProjectionWriter =>
    createD1PublicNoteProjectionWriter(interposeOnce(session, rival));

  const publish = (body: string, revision: number) =>
    writer.replaceSnapshotIfNewer(snapshotOf(body), [], version(revision));

  const found = async (keyword: string | null): Promise<readonly string[]> => {
    const page = await queryService.searchPublic({
      keyword,
      tagNames: [],
      ownerFilter: null,
      updatedWithin: null,
      cursor: null,
      limit: 10,
    });
    return page.items.map((item) => item.excerpt);
  };

  /**
   * Structural only — it never compares the index against
   * `public_note_search`, so it is the keyword assertions beside it that
   * catch a broken index: a note found by a word its body does not carry,
   * or lost to a withdrawal of tokens that were already gone.
   */
  const integrityCheck = () =>
    executor.apply([
      statement(
        `INSERT INTO ${GLOBAL_TABLES.publicNoteSearchFts}(${GLOBAL_TABLES.publicNoteSearchFts}) VALUES('integrity-check')`,
      ),
    ]);

  beforeAll(async () => {
    await applyD1Migrations(env.GLOBAL_DB, env.MIGRATIONS);
  });

  beforeEach(async () => {
    await executor.apply(GLOBAL_WIPE_STATEMENTS.map((sql) => statement(sql)));
  });

  it("refuses the snapshot whose row a rival consumer replaced after it was read", async () => {
    await publish("四月", 4);

    await expect(
      racing(() => publish("六月", 6)).replaceSnapshotIfNewer(
        snapshotOf("五月"),
        [],
        version(5),
      ),
    ).rejects.toThrow(ConflictError);

    // No lost update: the rival's newer snapshot is what stands.
    expect(await found(null)).toEqual(["六月の記録"]);
    await integrityCheck();
    expect(await found("六月")).toEqual(["六月の記録"]);
    expect(await found("四月")).toEqual([]);
    expect(await found("五月")).toEqual([]);

    // The redelivery reads the newer row and settles without writing.
    expect(await publish("五月", 5)).toBe("stale");
  });

  it("lets the redelivered newer snapshot land after its first attempt lost the race", async () => {
    await publish("四月", 4);

    await expect(
      racing(() => publish("五月", 5)).replaceSnapshotIfNewer(
        snapshotOf("六月"),
        [],
        version(6),
      ),
    ).rejects.toThrow(ConflictError);

    expect(await publish("六月", 6)).toBe("written");
    await integrityCheck();
    expect(await found("六月")).toEqual(["六月の記録"]);
    expect(await found("五月")).toEqual([]);
    expect(await found("四月")).toEqual([]);
  });

  it("refuses a removal whose row a rival consumer replaced after it was read", async () => {
    await publish("四月", 4);

    await expect(
      racing(() => publish("六月", 6)).removeIfNewer(noteId(1), 1, 4),
    ).rejects.toThrow(ConflictError);

    await integrityCheck();
    expect(await found("六月")).toEqual(["六月の記録"]);
    expect(await found("四月")).toEqual([]);
  });

  it("refuses a first projection whose note a rival consumer inserted first", async () => {
    await expect(
      racing(() => publish("六月", 6)).replaceSnapshotIfNewer(
        snapshotOf("四月"),
        [],
        version(4),
      ),
    ).rejects.toThrow(ConflictError);

    await integrityCheck();
    expect(await found(null)).toEqual(["六月の記録"]);
    expect(await found("四月")).toEqual([]);
  });
});
