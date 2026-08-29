import { applyD1Migrations, env } from "cloudflare:test";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { ConflictError } from "../../../application/errors";
import type { PublicNoteProjectionWriter } from "../../../domain/note/ports/publicNoteProjectionWriter";
import {
  WorkspaceName,
  WorkspaceSlug,
} from "../../../domain/workspace/valueObject";
import {
  makeProjectionEntry,
  noteId,
  scopeOf,
  userId,
  workspaceId,
} from "../../conformance/fixtures";
import { createTestClock } from "../../conformance/testClock";
import { createD1PublicNoteProjectionWriter } from "../d1/repositories/publicNoteProjection";
import { createD1PublicNoteQueryService } from "../d1/repositories/publicNoteQueryService";
import { createD1PublicWorkspaceDirectoryReader } from "../d1/repositories/publicWorkspaceDirectoryReader";
import { createD1WorkspaceDirectoryBatchReader } from "../d1/repositories/workspaceDirectoryBatchReader";
import { createD1WorkspaceDirectoryProjectionWriter } from "../d1/repositories/workspaceDirectoryProjectionWriter";
import { GLOBAL_TABLES, GLOBAL_WIPE_STATEMENTS } from "../d1/schema";
import { createScopeNoteProjectionRevisionStore } from "../do/repositories/noteProjection";
import { createScopeStubExecutor } from "../do/scopeStub";
import { createD1Executor } from "../sql/executor";
import { createAutocommitSession, type SqlSession } from "../sql/session";
import { statement } from "../sql/statement";

/**
 * The public plane is the first of the two blocks below:
 * `events-public-projection` runs at concurrency 4, so two consumers can
 * hold the same note at once.
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

const REDACTION = {
  noteId: noteId(1),
  createdBy: userId(1),
  redactionVersion: 3,
};

describe("cloudflare public projection concurrency", () => {
  const executor = createD1Executor(env.GLOBAL_DB);
  const session = createAutocommitSession(executor);
  const writer = createD1PublicNoteProjectionWriter(session);
  const queryService = createD1PublicNoteQueryService(session);

  const racing = (rival: () => Promise<unknown>): PublicNoteProjectionWriter =>
    createD1PublicNoteProjectionWriter(interposeOnce(session, rival));

  const publish = (body: string, revision: number) =>
    writer.replaceSnapshotIfNewer(snapshotOf(body), [], version(revision));

  const publishAuthor = (displayName: string, authorVersion: number) =>
    writer.replaceSnapshotIfNewer(
      {
        ...snapshotOf("四月"),
        author: { displayName, handle: "yamada", version: authorVersion },
      },
      [],
      { ...version(4), authorVersion },
    );

  const pageOf = (keyword: string | null) =>
    queryService.searchPublic({
      keyword,
      tagNames: [],
      ownerFilter: null,
      updatedWithin: null,
      cursor: null,
      limit: 10,
    });

  const found = async (keyword: string | null): Promise<readonly string[]> =>
    (await pageOf(keyword)).items.map((item) => item.excerpt);

  const authors = async (): Promise<readonly string[]> =>
    (await pageOf(null)).items.map((item) => item.authorDisplayName);

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

  /**
   * The author columns are outside the FTS index, so what is at stake is
   * the body row alone: the `UPDATE` is unconditional, and only the guard
   * makes the three no-ops decided from the row that was read still true
   * at commit.
   */
  it("refuses an author redaction whose row a rival consumer republished after it was read", async () => {
    await publishAuthor("山田", 1);

    await expect(
      racing(() => publishAuthor("山田 太郎", 5)).redactAuthor(REDACTION),
    ).rejects.toThrow(ConflictError);

    // The rival's newer author generation stands: the stale erasure did
    // not stamp the withdrawn name over it.
    expect(await authors()).toEqual(["山田 太郎"]);
    // The redelivery reads that newer row and settles on the no-op.
    expect(await writer.redactAuthor(REDACTION)).toBe(false);
    expect(await authors()).toEqual(["山田 太郎"]);
  });
});

/**
 * `workspace_directory` is written by `events-workspace-projection`, whose
 * consumers hold no lock: `applySnapshotIfNewer` reads the row, decides
 * its branch, and applies a guarded upsert a round trip later. The apply
 * carries a slug release for whichever other row still projects the slug,
 * and the two must agree — a release that survived a rejected upsert
 * leaves a third workspace with no slug and no one holding it, silently
 * out of the sitemap until its own next event.
 *
 * The memory backend decides and writes in one synchronous step, so the
 * shared suite can only reach the serial half of this (a stale snapshot
 * releasing nothing); the interleaving lives here.
 */
describe("cloudflare workspace directory projection concurrency", () => {
  const executor = createD1Executor(env.GLOBAL_DB);
  const session = createAutocommitSession(executor);
  const clock = createTestClock();
  const deps = { session, clock };
  const writer = createD1WorkspaceDirectoryProjectionWriter(deps);
  const batchReader = createD1WorkspaceDirectoryBatchReader({ session });
  const publicReader = createD1PublicWorkspaceDirectoryReader({ session });

  const racing = (rival: () => Promise<unknown>) =>
    createD1WorkspaceDirectoryProjectionWriter({
      ...deps,
      session: interposeOnce(session, rival),
    });

  const snapshot = (
    n: number,
    sourceVersion: number,
    slug: string | null,
    publication: "private" | "published" = "private",
  ) => ({
    workspaceId: workspaceId(n),
    name: WorkspaceName.create(`Workspace ${n}`),
    slug: slug === null ? null : WorkspaceSlug.create(slug),
    avatarUrl: null,
    publication,
    sourceVersion,
  });

  const slugOf = async (n: number): Promise<string | null | "notActive"> => {
    const resolved = (await batchReader.resolveMany([workspaceId(n)])).get(
      workspaceId(n),
    );
    return resolved?.state === "active"
      ? resolved.entry.entity.slug
      : "notActive";
  };

  const published = async (): Promise<readonly string[]> =>
    (await publicReader.listPublished(null, 200)).items.map(
      (item) => item.workspaceId,
    );

  beforeAll(async () => {
    await applyD1Migrations(env.GLOBAL_DB, env.MIGRATIONS);
  });

  beforeEach(async () => {
    await executor.apply(GLOBAL_WIPE_STATEMENTS.map((sql) => statement(sql)));
  });

  it("leaves a third workspace's slug alone when a rival's newer snapshot rejects the apply", async () => {
    await writer.applySnapshotIfNewer(snapshot(1, 1, "alpha"));
    await writer.applySnapshotIfNewer(
      snapshot(3, 1, "shared-slug", "published"),
    );

    // Reads workspace 1 at version 1 and decides to apply, then the
    // rival's version 3 lands before the write-set does.
    await racing(() =>
      writer.applySnapshotIfNewer(snapshot(1, 3, "gamma")),
    ).applySnapshotIfNewer(snapshot(1, 2, "shared-slug"));

    expect(await slugOf(1)).toBe(WorkspaceSlug.create("gamma"));
    expect(await slugOf(3)).toBe(WorkspaceSlug.create("shared-slug"));
    expect(await published()).toEqual([workspaceId(3)]);
  });

  it("leaves it alone when a tombstone lands between the read and the apply", async () => {
    await writer.applySnapshotIfNewer(snapshot(1, 1, "alpha"));
    await writer.applySnapshotIfNewer(
      snapshot(3, 1, "shared-slug", "published"),
    );

    await racing(() =>
      writer.tombstone({
        workspaceId: workspaceId(1),
        operationId: "deletion-1",
      }),
    ).applySnapshotIfNewer(snapshot(1, 2, "shared-slug"));

    expect(await slugOf(1)).toBe("notActive");
    expect(await slugOf(3)).toBe(WorkspaceSlug.create("shared-slug"));
    expect(await published()).toEqual([workspaceId(3)]);
  });
});

/**
 * `bump` spans two RPCs to the scope object — the read and the write-set
 * apply — so two turns on the same scope can
 * interleave, and a lost update would hand two events the same revision
 * and make them unorderable against each other.
 *
 * The scope object is namespaced per suite and never wiped, so each case
 * takes a note of its own.
 */
describe("cloudflare scope projection revision concurrency", () => {
  const session = createAutocommitSession(
    createScopeStubExecutor(env.SCOPE_OBJECT, scopeOf(1), "revision-race"),
  );
  const store = createScopeNoteProjectionRevisionStore(session);

  const racing = (rival: () => Promise<unknown>) =>
    createScopeNoteProjectionRevisionStore(interposeOnce(session, rival));

  it("refuses the first bump whose row a rival turn inserted after it was read", async () => {
    const note = noteId(11);
    const rivalRevisions: number[] = [];

    await expect(
      racing(async () => {
        rivalRevisions.push(await store.bump(note));
      }).bump(note),
    ).rejects.toThrow(ConflictError);

    expect(rivalRevisions).toEqual([1]);
    // The redelivery reads what the rival left, so no two events carry 1.
    expect(await store.bump(note)).toBe(2);
  });

  it("refuses the bump whose counter a rival turn advanced after it was read", async () => {
    const note = noteId(12);
    expect(await store.bump(note)).toBe(1);
    const rivalRevisions: number[] = [];

    await expect(
      racing(async () => {
        rivalRevisions.push(await store.bump(note));
      }).bump(note),
    ).rejects.toThrow(ConflictError);

    expect(rivalRevisions).toEqual([2]);
    expect(await store.bump(note)).toBe(3);
  });
});
