import { env, runInDurableObject } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { ScopeKey } from "../../../application/scope";
import { deleteStoredFiles } from "../../../application/storage/deleteFiles";
import { type DomainEvent, EventId } from "../../../domain/common/event";
import { UserId } from "../../../domain/identity/valueObject";
import type { StoredFile } from "../../../domain/storage/storedFile";
import { StoredFile as StoredFileOps } from "../../../domain/storage/storedFile";
import {
  Checksum,
  ObjectKey,
  StorageOwner,
  StoredFileId,
} from "../../../domain/storage/valueObject";
import { createCloudflareStoredFileRepository } from "../do/repositories/storedFileRepository";
import { SCOPE_TABLES } from "../do/schema";
import { scopeObjectName } from "../do/scopeName";
import type { ScopeObject } from "../do/scopeObject";
import { createScopeStubExecutor } from "../do/scopeStub";
import {
  createScopeUnitOfWorkProvider,
  type ScopePlaneRepositories,
} from "../execution/scopeUnitOfWork";
import { opaque } from "../execution/writeSet";
import type { ScopeSqlExecutor } from "../sql/executor";
import { insertRowsFromJson, jsonRows } from "../sql/json";
import { createAutocommitSession, type SqlSession } from "../sql/session";
import { statement } from "../sql/statement";

/**
 * Stand-in for a port this test must not touch: every method throws,
 * naming itself, so an accidental call is a named failure rather than a
 * miscount. `then` and symbol keys stay `undefined` so the object is
 * inert when a framework probes it for thenability or an inspection hook.
 */
function unusedPort<T extends object>(name: string): T {
  return new Proxy({} as T, {
    get(_target, property): unknown {
      if (typeof property === "symbol" || property === "then") {
        return undefined;
      }
      return (): never => {
        throw new Error(`${name}.${String(property)} is out of scope here`);
      };
    },
  });
}

/**
 * AC-5: how many SQL statements one `deleteFilesByOwner` turn issues.
 *
 * `spec/platform/index.md` の「実行予算と分割単位」→「Scope DO」 states a
 * design goal of **three** statements for a scope-local bulk delete —
 * "列挙 1 ＋ 多行 DELETE 1 ＋ 多行 outbox INSERT 1" — and this file is the
 * measurement that goal is held against. What is reproduced here is the
 * storage half of `application/storage/deleteFilesByOwner.ts`: the
 * `listByOwner` enumeration, the `deleteStoredFiles` loop it feeds, and
 * the outbox flush their events land in. The turn's surrounding calls
 * (`assertOwner`, `markApplied`, the scheduler settle) are constant in
 * the batch size and belong to other bundles, so they are left out.
 *
 * The outbox flush is staged the way the design goal assumes — one
 * `json_each` multi-row INSERT for the whole batch — so the measurement
 * is not made pessimistic by a stand-in.
 *
 * Two quantities are counted and pinned against each other: the executor
 * calls the worker side makes, and the statements the object executes
 * against its own SQLite. They agree, which is the claim that lets the
 * figure be quoted as a statement count.
 *
 * The observable contract "no extra round trip proportional to the batch"
 * lives in `spec/testcases/storage/deleteFilesByOwner.md` and is
 * backend-agnostic; nothing here changes it.
 */

const OWNER_ID = UserId.create("user-1");
const OWNER = StorageOwner.user(OWNER_ID);
const SCOPE = ScopeKey.user(OWNER_ID);
const NOW = new Date("2026-08-26T00:00:00.000Z");
const CHECKSUM = Checksum.sha256("a".repeat(64));

let namespaceSeq = 0;
let eventSeq = 0;

const mintEventId = (): EventId => {
  eventSeq += 1;
  return EventId.create(`event-${eventSeq}`);
};

const avatar = (n: number): StoredFile =>
  StoredFileOps.register(
    {
      id: `file-${String(n).padStart(4, "0")}`,
      owner: OWNER,
      objectKey: ObjectKey.build(
        OWNER,
        "avatar",
        StoredFileId.create(`file-${String(n).padStart(4, "0")}`),
        "png",
      ),
      fileName: `avatar-${n}.png`,
      mimeType: "image/png",
      size: 100,
      checksum: CHECKSUM,
      purpose: "avatar",
      noteId: null,
      uploadedBy: OWNER_ID,
    },
    NOW,
  ).entity;

type Counts = {
  /** `query` calls — one SQL statement and one round trip each. */
  reads: number;
  /** `applyWriteSet` calls — one atomic apply each. */
  commits: number;
  /** Statements inside those applies. */
  commitStatements: number;
  /** Statements the object actually executed against its own SQLite. */
  executed: number;
};

/**
 * Counts what runs *inside* the object rather than what was sent to it.
 *
 * Without this the measurement is a count of executor calls, which is
 * only the same number while nothing in the object adds statements of
 * its own — the identity pin used to add two per RPC before it was
 * memoised. Wrapping `sql` on the object's own state is what keeps the
 * two counts honest about each other.
 */
const countExecuted = async (
  stub: DurableObjectStub<ScopeObject>,
  counts: Counts,
  body: () => Promise<void>,
): Promise<void> => {
  await runInDurableObject(stub, (_instance, state) => {
    const real = state.storage.sql;
    const wrapper = {
      ...real,
      exec: (query: string, ...bindings: unknown[]) => {
        counts.executed += 1;
        return real.exec(query, ...bindings);
      },
    } as unknown as SqlStorage;
    Object.defineProperty(state.storage, "sql", {
      configurable: true,
      get: () => wrapper,
    });
  });
  try {
    await body();
  } finally {
    await runInDurableObject(stub, (_instance, state) => {
      Reflect.deleteProperty(state.storage, "sql");
    });
  }
};

const counting = (
  inner: ScopeSqlExecutor,
  counts: Counts,
): ScopeSqlExecutor => ({
  async query(input) {
    counts.reads += 1;
    return inner.query(input);
  },
  async apply(statements) {
    counts.commits += 1;
    counts.commitStatements += statements.length;
    return inner.apply(statements);
  },
  async applyWriteSet(statements, touchedTables) {
    counts.commits += 1;
    counts.commitStatements += statements.length;
    return inner.applyWriteSet(statements, touchedTables);
  },
});

/** The multi-row outbox INSERT the design goal counts as its third statement. */
const stageOutbox = async (
  session: SqlSession,
  events: readonly DomainEvent[],
): Promise<void> => {
  await session.write([
    opaque(
      statement(
        insertRowsFromJson({
          table: SCOPE_TABLES.outboxEvents,
          columns: [
            "id",
            "type",
            "payload",
            "occurred_at",
            "aggregate_id",
            "created_at",
          ],
          conflictKey: ["id"],
          conflict: "ignore",
        }),
        jsonRows(
          events.map((event) => ({
            id: event.id,
            type: event.type,
            payload: JSON.stringify(event.payload),
            occurred_at: event.occurredAt.getTime(),
            aggregate_id: event.aggregateId,
            created_at: NOW.getTime(),
          })),
        ),
      ),
    ),
  ]);
};

const repositories = (session: SqlSession): ScopePlaneRepositories => ({
  noteRepository: unusedPort("NoteRepository"),
  noteRevisionRepository: unusedPort("NoteRevisionRepository"),
  cleanupAdmission: unusedPort("ScopeCleanupAdmissionStore"),
  noteProjectionRevisionStore: unusedPort("NoteProjectionRevisionStore"),
  localNoteProjectionWriter: unusedPort("LocalNoteProjectionWriter"),
  scopeTaskScheduler: unusedPort("ScopeTaskScheduler"),
  appliedOperationStore: unusedPort("AppliedOperationStore"),
  storageQuotaRepository: unusedPort("StorageQuotaRepository"),
  llmUsageRepository: unusedPort("LlmUsageRepository"),
  storedFileRepository: createCloudflareStoredFileRepository({ session }),
});

const runOneTurn = async (
  batchSize: number,
): Promise<Readonly<{ counts: Counts; deleted: number }>> => {
  namespaceSeq += 1;
  const namespace = `ac5-${namespaceSeq}`;
  const inner = createScopeStubExecutor(env.SCOPE_OBJECT, SCOPE, namespace);
  const seeded = createCloudflareStoredFileRepository({
    session: createAutocommitSession(inner),
  });
  for (let n = 1; n <= batchSize; n += 1) {
    await seeded.insert(avatar(n));
  }

  const counts: Counts = {
    reads: 0,
    commits: 0,
    commitStatements: 0,
    executed: 0,
  };
  const provider = createScopeUnitOfWorkProvider({
    openScope: () => counting(inner, counts),
    mintEventId,
    buildRepositories: repositories,
    stageOutbox,
  });

  let deleted = 0;
  const stub = env.SCOPE_OBJECT.get(
    env.SCOPE_OBJECT.idFromName(scopeObjectName(SCOPE, namespace)),
  );
  await countExecuted(stub, counts, async () => {
    await provider.run(SCOPE, async (ctx) => {
      const page = await ctx.storedFileRepository.listByOwner(OWNER, null, {
        page: 1,
        limit: batchSize,
      });
      deleted = await deleteStoredFiles(
        ctx,
        page.items.map((file) => file.id),
        "operation-1",
        NOW,
      );
    });
  });
  return { counts, deleted };
};

describe("deleteFilesByOwner statement budget [cloudflare]", () => {
  it("AC-5: the turn commits once, whatever the batch size", async () => {
    const small = await runOneTurn(10);
    const large = await runOneTurn(40);

    expect(small.deleted).toBe(10);
    expect(large.deleted).toBe(40);
    // The write half is one atomic apply — one Durable Object round trip
    // and one `transactionSync` — no matter how many rows it carries.
    expect(small.counts.commits).toBe(1);
    expect(large.counts.commits).toBe(1);
  });

  it("AC-5: enumeration and the outbox flush are constant, the per-row work is not", async () => {
    const small = await runOneTurn(10);
    const large = await runOneTurn(40);

    // Enumeration: the page and its `COUNT(*)`. `listByOwner` returns a
    // `PaginationResult`, so the total is a second statement — the design
    // goal's "列挙 1" is already two.
    expect(small.counts.reads - 2 * 10).toBe(2);
    expect(large.counts.reads - 2 * 40).toBe(2);

    // The outbox flush really is the single multi-row INSERT the goal
    // assumes; everything else in the commit is per row.
    expect(small.counts.commitStatements - 2 * 10).toBe(1);
    expect(large.counts.commitStatements - 2 * 40).toBe(1);

    // Per row: two reads — `findById`, the only site that mints an OCC
    // token (`TransactionalRepository`'s JSDoc), and the re-read `delete`
    // makes so a stale token is refused at the call site rather than at
    // commit — plus two staged statements, an `_occ_guard` trip wire and
    // the `DELETE` it protects. The port has no bulk delete
    // (`spec/domains/storage.md` rules one out so every removed file
    // emits its own `storage.fileDeleted`), so no adapter can fold these
    // into one statement while keeping OCC.
    expect(large.counts.reads - small.counts.reads).toBe(60);
    expect(large.counts.commitStatements - small.counts.commitStatements).toBe(
      60,
    );
  });

  it("AC-5: records the measured totals of one turn", async () => {
    const measured = await runOneTurn(10);

    // 4n + 3 for a batch of n: (2n + 2) reads and (2n + 1) statements in
    // the single commit. The design goal of three statements is not met;
    // `spec/platform/index.md` carries the measured figure instead.
    expect(measured.counts.reads).toBe(22);
    expect(measured.counts.commitStatements).toBe(21);
    expect(measured.counts.reads + measured.counts.commitStatements).toBe(43);
  });

  it("AC-5: the object executes exactly the statements it was sent", async () => {
    const small = await runOneTurn(10);
    const large = await runOneTurn(40);

    // The identity pin is read once at construction and held, so a turn
    // against an object already in memory adds nothing of its own. This
    // is what makes the figure above a count of SQL rather than a count
    // of executor calls.
    expect(small.counts.executed).toBe(
      small.counts.reads + small.counts.commitStatements,
    );
    expect(large.counts.executed).toBe(
      large.counts.reads + large.counts.commitStatements,
    );
    expect(small.counts.executed).toBe(43);
    expect(large.counts.executed).toBe(163);
  });
});
