import type { WorkerContainer } from "../../di/types";
import { IdentityContinuations } from "../continuations";
import type { AccountDeletionManifestCompactContinuedInput } from "./input";
import { MANIFEST_PAGE_LIMIT } from "./manifestBuild";

/** How long a terminal manifest header is kept before it is reclaimed. */
export const TERMINAL_MANIFEST_RETENTION_MS = 120 * 24 * 60 * 60 * 1000;

const nextTurn = (cursor: string | null): string =>
  String(Number.parseInt(cursor ?? "0", 10) + 1);

/**
 * Reclaims the acknowledged manifest items a page at a time and
 * terminates the operation on the page that empties it
 * (spec/usecases/identity.md 手順 5).
 *
 * Terminating last is what makes a `completed` header mean "nothing left
 * to reclaim": the header and its control-plane row are then a pure
 * tombstone that the terminal prune can drop whole, 120 days on.
 *
 * The continuation numbers its turns. A turn that re-armed itself under
 * its own key would be marked processed by the relay finalize of the very
 * turn that stored it, and the chain would stop one page in (ADR-025).
 */
export async function compactAccountDeletionManifest(
  container: WorkerContainer,
  input: AccountDeletionManifestCompactContinuedInput,
): Promise<void> {
  const now = container.clock.now();
  await container.globalUnitOfWorkProvider.run(async (ctx) => {
    const header = await ctx.accountDeletionManifestStore.describe(
      input.operationId,
    );
    if (header === null) {
      return;
    }
    if (header.status !== "built" && header.status !== "completed") {
      return;
    }

    const page = await ctx.accountDeletionManifestStore.compactItems(
      input.operationId,
      MANIFEST_PAGE_LIMIT,
    );
    if (page.remaining) {
      ctx.collectEvents([
        IdentityContinuations.accountDeletionManifestCompact(
          { operationId: input.operationId, cursor: nextTurn(input.cursor) },
          now,
        ),
      ]);
      return;
    }
    if (header.status === "completed") {
      return;
    }

    await ctx.accountDeletionManifestStore.markCompleted(
      input.operationId,
      now,
      new Date(now.getTime() + TERMINAL_MANIFEST_RETENTION_MS),
    );
    await ctx.distributedOperationStore.markState(
      input.operationId,
      "completed",
      now,
    );
  });
}
