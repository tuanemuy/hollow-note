import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { ConflictError } from "../../../application/errors";
import { scopeOf, userId } from "../../conformance/fixtures";
import { createTestClock } from "../../conformance/testClock";
import { createCloudflareWorkspaceOperationLockStore } from "../do/repositories/workspaceOperationLockStore";
import { SCOPE_TABLES } from "../do/schema";
import { createScopeStubExecutor } from "../do/scopeStub";
import { text } from "../sql/row";
import { createAutocommitSession, type SqlSession } from "../sql/session";
import { statement } from "../sql/statement";

/**
 * The scope plane's counterpart to `globalConcurrency.test.ts`: two turns
 * that both read the same scope row and then both write.
 *
 * A scope object serializes its turns, but a repository's read and its
 * write-set apply are two RPCs, so a rival turn still fits between them.
 * The memory backend makes the pair atomic by being single-threaded, and
 * therefore the shared conformance suites cannot reach this interleaving
 * at all — which is why the observation lives here.
 *
 * `interposeOnce` stages the race rather than hoping for it, and every
 * store is built over `createAutocommitSession`, the only shape in which
 * a guard defeat reaches the repository: inside a unit of work a staged
 * `write` merely buffers, so the loss surfaces at commit as the default
 * translation instead.
 *
 * The scope object is namespaced per file and never wiped, so each case
 * takes a migration id of its own.
 */

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

const conflictCode = async (call: Promise<unknown>): Promise<string> => {
  try {
    await call;
  } catch (error) {
    if (error instanceof ConflictError) {
      return error.code;
    }
    throw error;
  }
  throw new Error("expected a ConflictError");
};

describe("cloudflare move authorization lock concurrency", () => {
  const session = createAutocommitSession(
    createScopeStubExecutor(env.SCOPE_OBJECT, scopeOf(1), "move-lock-race"),
  );
  const clock = createTestClock();
  const store = createCloudflareWorkspaceOperationLockStore({ session, clock });

  const racing = (rival: () => Promise<unknown>) =>
    createCloudflareWorkspaceOperationLockStore({
      session: interposeOnce(session, rival),
      clock,
    });

  const actorOf = async (migrationId: string): Promise<string | null> => {
    const rows = await session.query(
      statement(
        `SELECT actor_user_id FROM ${SCOPE_TABLES.moveAuthorizationLocks}
          WHERE migration_id = ?`,
        migrationId,
      ),
    );
    const row = rows[0];
    return row === undefined ? null : text(row, "actor_user_id");
  };

  it("refuses a staging whose migration a rival actor locked after it was read", async () => {
    const migrationId = "migration-contested";

    expect(
      await conflictCode(
        racing(() =>
          store.stageMove({ migrationId, actorUserId: userId(2) }),
        ).stageMove({ migrationId, actorUserId: userId(1) }),
      ),
    ).toBe("MOVE_AUTHORIZATION_LOCK_CONFLICT");

    // The lock pins the rival's actor, so the membership the move still
    // depends on is the one that was actually authorized — and the loser
    // is told, rather than carrying on believing it holds the lock.
    expect(await actorOf(migrationId)).toBe(userId(2));
    expect(await store.hasMoveConflict(userId(1))).toBe(false);
    expect(await store.hasMoveConflict(userId(2))).toBe(true);
  });

  it("lets a crossed replay of the same actor's staging settle", async () => {
    const migrationId = "migration-replayed";

    await expect(
      racing(() =>
        store.stageMove({ migrationId, actorUserId: userId(3) }),
      ).stageMove({ migrationId, actorUserId: userId(3) }),
    ).resolves.toBeUndefined();

    expect(await actorOf(migrationId)).toBe(userId(3));
  });
});
