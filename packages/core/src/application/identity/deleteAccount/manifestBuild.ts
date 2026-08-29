import type { UserId } from "@repo/core/domain/identity/valueObject";
import type { RequestContainer, WorkerContainer } from "../../di/types";
import { IdentityContinuations } from "../continuations";
import type {
  AccountDeletionBuildPhase,
  AccountDeletionDispatchPhase,
  AccountDeletionManifestBuildContinuedInput,
} from "./input";

/** Targets fixed per turn (spec/domains/index.md: at most 100). */
export const MANIFEST_PAGE_LIMIT = 100;

/**
 * Phase the build moves to once every membership page is fixed.
 *
 * The workspace prepare wave belongs **between** the two: author routes
 * may only be scanned after every membership barrier is acked, or a
 * workspace write still in flight would create a route the scan has
 * already passed. A slice adding the wave inserts it here rather than
 * after `authorRoutes`.
 */
const PHASE_AFTER_MEMBERSHIPS: AccountDeletionBuildPhase = "authorRoutes";

/**
 * Dispatch phase the built manifest hands over to. Membership edges do
 * exist, but admission refuses a user who still holds one
 * (`WORKSPACE_MEMBERSHIPS_REMAIN`), so no manifest ever fixes a
 * membership item and `prepare` stays empty: the chain starts at the
 * personal cleanup wave. The slice that adds the membership prepare /
 * cleanup wave drops that refusal and moves the entry point back to
 * `prepare`.
 */
const FIRST_DISPATCH_PHASE: AccountDeletionDispatchPhase = "cleanup";

/**
 * Opens the manifest and asks for its first page (手順 3). Runs after
 * the barrier ack, so the targets it fixes are exactly the ones the
 * barrier closed writes against.
 */
export async function startAccountDeletionManifestBuild(
  container: Pick<RequestContainer, "clock" | "globalUnitOfWorkProvider">,
  params: Readonly<{ operationId: string; userId: UserId }>,
): Promise<void> {
  const now = container.clock.now();
  await container.globalUnitOfWorkProvider.run(async (ctx) => {
    await ctx.accountDeletionManifestStore.begin(
      params.operationId,
      params.userId,
    );
    ctx.collectEvents([
      IdentityContinuations.accountDeletionManifestBuild(
        { operationId: params.operationId, phase: "memberships", cursor: null },
        now,
      ),
    ]);
  });
}

/**
 * Fixes one page of deletion targets and stores the next continuation in
 * the same transaction (TC-identity-095 / 096 / 100 / 101).
 *
 * A turn is fully described by its own `(phase, cursor)`: a replay
 * re-fixes exactly the targets it fixed before — appends are idempotent
 * per target — and re-emits the same successor, so a lost response
 * neither duplicates targets nor re-opens a phase that has moved on. The
 * page position is mirrored onto the header as the audit trail of where
 * the build reached.
 *
 * The author-route scan reads the routing catalog, which the manifest's
 * transaction may not enclose (spec: D1 and a DO never share one), so it
 * runs before the unit of work opens.
 */
export async function continueAccountDeletionManifestBuild(
  container: WorkerContainer,
  input: AccountDeletionManifestBuildContinuedInput,
): Promise<void> {
  const header = await container.accountDeletionManifestStore.describe(
    input.operationId,
  );
  if (header === null || header.status !== "building") {
    // The build already finished; this is a redelivery of one of its turns.
    return;
  }
  const now = container.clock.now();

  if (input.phase === "memberships") {
    await container.globalUnitOfWorkProvider.run(async (ctx) => {
      const page = await ctx.accountDeletionManifestStore.appendMembershipPage(
        input.operationId,
        input.cursor,
        MANIFEST_PAGE_LIMIT,
      );
      ctx.collectEvents([
        IdentityContinuations.accountDeletionManifestBuild(
          page.nextCursor !== null
            ? {
                operationId: input.operationId,
                phase: "memberships",
                cursor: page.nextCursor,
              }
            : {
                operationId: input.operationId,
                phase: PHASE_AFTER_MEMBERSHIPS,
                cursor: null,
              },
          now,
        ),
      ]);
    });
    return;
  }

  const routes = await container.noteRouteFanOutReader.listByCreatedBy(
    header.userId,
    input.cursor,
    MANIFEST_PAGE_LIMIT,
  );
  await container.globalUnitOfWorkProvider.run(async (ctx) => {
    await ctx.accountDeletionManifestStore.appendAuthorRoutePage(
      input.operationId,
      routes.items.map((route) => ({
        noteId: route.noteId,
        routeVersion: route.routeVersion,
      })),
      routes.nextCursor,
    );
    if (routes.nextCursor !== null) {
      ctx.collectEvents([
        IdentityContinuations.accountDeletionManifestBuild(
          {
            operationId: input.operationId,
            phase: "authorRoutes",
            cursor: routes.nextCursor,
          },
          now,
        ),
      ]);
      return;
    }
    await ctx.accountDeletionManifestStore.markBuilt(input.operationId);
    ctx.collectEvents([
      IdentityContinuations.accountDeletionDispatch(
        { operationId: input.operationId, phase: FIRST_DISPATCH_PHASE },
        now,
      ),
    ]);
  });
}
