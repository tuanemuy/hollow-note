import type { WorkerContainer } from "../../di/types";
import type { AccountDeletionManifestItem } from "../../ports/accountDeletionManifestStore";
import { IdentityContinuations } from "../continuations";
import { FINALIZE_ATTEMPT_FROM_REDACTION } from "./finalize";
import type { AccountDeletionDispatchContinuedInput } from "./input";
import { MANIFEST_PAGE_LIMIT } from "./manifestBuild";

const nextTurn = (cursor: string | null): string =>
  String(Number.parseInt(cursor ?? "0", 10) + 1);

const isAuthorRoute = (
  item: AccountDeletionManifestItem,
): item is Extract<AccountDeletionManifestItem, { kind: "authorRoute" }> =>
  item.kind === "authorRoute";

/**
 * Erases the leaving author from every note route the manifest fixed
 * (spec/usecases/identity.md 手順 4, TC-identity-081).
 *
 * One turn takes one page of not-yet-acknowledged targets, writes each
 * plane, and records the plane acks — never the other way round, so an
 * ack always means the projection is already redacted. Because the acks
 * are what the page is selected by, a redelivered turn simply finds less
 * to do, and finalize cannot start while a single plane is unacked.
 *
 * Each target's plane is re-resolved rather than taken from the fixed
 * item: a note may have moved since the manifest was built, and one that
 * has been purged has no projection left to redact — both planes are
 * acknowledged for it.
 *
 * The redaction generation is the deleting user's own version. Admission
 * bumped it, so it is strictly greater than the version any note event
 * still in flight carries, and those events therefore cannot bring the
 * old display name back (TC-identity-082).
 */
export async function dispatchAccountDeletionRedaction(
  container: WorkerContainer,
  input: AccountDeletionDispatchContinuedInput<"redaction">,
): Promise<void> {
  const header = await container.accountDeletionManifestStore.describe(
    input.operationId,
  );
  if (header === null || header.status !== "built") {
    return;
  }
  const now = container.clock.now();

  const claimed = await container.globalUnitOfWorkProvider.run(async (ctx) => {
    const versioned = await ctx.userRepository.findById(header.userId);
    if (versioned === null) {
      return null;
    }
    const items = await ctx.accountDeletionManifestStore.claimPending(
      input.operationId,
      "redaction",
      MANIFEST_PAGE_LIMIT,
    );
    return {
      redactionVersion: versioned.entity.version,
      targets: items.filter(isAuthorRoute),
    };
  });
  if (claimed === null) {
    return;
  }

  const localAcked: string[] = [];
  const publicAcked: string[] = [];
  for (const target of claimed.targets) {
    const route = await container.noteRouteResolver.resolve(target.noteId);
    const redaction = {
      noteId: target.noteId,
      createdBy: header.userId,
      redactionVersion: claimed.redactionVersion,
    };
    if (route !== null) {
      await container.scopeUnitOfWorkProvider.run(route.scope, (ctx) =>
        ctx.localNoteProjectionWriter.redactAuthor(redaction),
      );
      await container.publicNoteProjectionWriter.redactAuthor(redaction);
    }
    localAcked.push(target.key);
    publicAcked.push(target.key);
  }

  await container.globalUnitOfWorkProvider.run(async (ctx) => {
    await ctx.accountDeletionManifestStore.acknowledge(
      input.operationId,
      localAcked,
      "localRedaction",
    );
    await ctx.accountDeletionManifestStore.acknowledge(
      input.operationId,
      publicAcked,
      "publicRedaction",
    );
    ctx.collectEvents([
      claimed.targets.length === MANIFEST_PAGE_LIMIT
        ? IdentityContinuations.accountDeletionDispatch(
            {
              operationId: input.operationId,
              phase: "redaction",
              cursor: nextTurn(input.cursor),
            },
            now,
          )
        : IdentityContinuations.accountDeletionDispatch(
            {
              operationId: input.operationId,
              phase: "finalize",
              cursor: FINALIZE_ATTEMPT_FROM_REDACTION,
            },
            now,
          ),
    ]);
  });
}
