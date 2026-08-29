import type { Identity } from "@repo/core/domain/identity/identity";
import { AccountDeletionRetryPolicy } from "@repo/core/domain/identity/services/accountDeletionRetryPolicy";
import { User } from "@repo/core/domain/identity/user";
import { UserId } from "@repo/core/domain/identity/valueObject";
import type { RequestContainer } from "../../di/types";
import { ConflictError, NotFoundError, ValidationError } from "../../errors";
import type { GlobalUnitOfWorkContext } from "../../execution/unitOfWork";
import { ScopeKey } from "../../scope";
import { providerAccountKey } from "../uniqueness";
import {
  type AccountDeletionOperationPayload,
  type DeleteAccountUserRequestInput,
  requireRequestId,
} from "./input";

export type AdmittedAccountDeletion = Readonly<{
  operationId: string;
  userId: UserId;
  /** `false` once the operation reached `completed` / `rejected`. */
  running: boolean;
}>;

const confirmationMismatch = (): ValidationError =>
  new ValidationError(
    "CONFIRMATION_MISMATCH",
    "The confirmation address does not match the account",
  );

const accountUnavailable = (): ValidationError =>
  new ValidationError("ACCOUNT_UNAVAILABLE", "Account is unavailable");

const operationMismatch = (operationId: string): ConflictError =>
  new ConflictError(
    "ACCOUNT_DELETION_OPERATION_MISMATCH",
    `Another deletion operation than ${operationId} owns this account`,
  );

const workspaceMembershipsRemain = (): ConflictError =>
  new ConflictError(
    "WORKSPACE_MEMBERSHIPS_REMAIN",
    "Leave or hand over every workspace before deleting the account",
  );

/**
 * Refuses the request while the user still holds a directory edge, in
 * any state a join or a removal can leave behind.
 *
 * Two reads, because the seat is announced in two places: the settled
 * edges (`active` / `pending` / `removing`) the manifest would fix as
 * membership items, and the `activating` edges a join has claimed but
 * not settled. `activating` is not a state anything acknowledges either —
 * the join that owns it settles it to `active` moments later, and the
 * manifest fixes it then — so counting only the settled half admits a
 * deletion inside the join saga's [claim, activate] window.
 *
 * Called **after** the user has been moved to `deleting` in this very
 * transaction, which is what makes the pair a decision rather than a
 * guess: a join arriving before this read is seen here, and one arriving
 * after loses its own Active-User check. On the reference runtime (Node +
 * in-memory) neither ordering leaves an admitted deletion facing an edge
 * that settles behind it (spec/usecases/identity.md#deleteaccount 手順 2).
 */
const refuseWhileMemberOfAnyWorkspace = async (
  ctx: GlobalUnitOfWorkContext,
  userId: UserId,
): Promise<void> => {
  const settled = await ctx.settledMembershipReader.countSettledByUser(
    userId,
    1,
  );
  if (settled > 0) {
    throw workspaceMembershipsRemain();
  }
  const activating = await ctx.activatingMembershipReader.listActivatingByUser(
    userId,
    1,
  );
  if (activating.length > 0) {
    throw workspaceMembershipsRemain();
  }
};

const uniquenessKeysOf = (
  user: Readonly<{ email: string; handle: string | null }>,
  identities: readonly Identity[],
): AccountDeletionOperationPayload => ({
  uniqueness: {
    email: user.email,
    handle: user.handle,
    providerAccounts: identities
      .filter((identity) => identity.kind === "oauth")
      .map((identity) =>
        providerAccountKey(identity.provider, identity.providerAccountId),
      ),
  },
});

/**
 * Admits a deletion request (spec/usecases/identity.md#deleteaccount 手順
 * 2): it decides the operation, moves the user to `deleting`, and takes
 * the personal write barrier.
 *
 * The order is load-bearing. Retained terminal attempts are
 * **counted and judged before** the operation is created, so a request
 * the retry window rejects never reaches the store at all. The operation
 * is then decided **before** the user transition, because
 * `User.beginDeletion` accepts
 * only an `ActiveUser` and bumps `authEpoch`: calling it on a resume
 * would bump the generation a second time and let the running residue
 * cleanup delete credentials of the generation still in use. A resume
 * therefore only checks that the user is already `deleting` for this
 * very operation.
 *
 * The uniqueness keys are frozen into the operation payload here, while
 * the PII is still alive; global cleanup and every replay of it read
 * only the payload.
 *
 * The barrier is taken after the commit, in the personal scope's own
 * transaction: writes that committed before it stay visible to the
 * cleanup scan, and everything after is refused with `ACCOUNT_DELETING`.
 *
 * A user who still holds a workspace directory edge is refused outright
 * with `WORKSPACE_MEMBERSHIPS_REMAIN`. This deployment has no workspace
 * prepare / cleanup wave, so nothing would ever acknowledge the
 * membership items the manifest fixes from those edges, and the
 * operation would wait forever with the account stuck in `deleting`.
 * Refusing at admission is the closed direction of that gap: the
 * transaction rolls back, so the account stays `active` and recoverable,
 * and the caller is pointed at leaving or handing over the workspaces.
 * **The slice that adds the wave deletes this check** (and its two
 * readers, if nothing else reads them) — that is the single condition
 * under which it may go.
 *
 * Only a request that would create a new operation is judged. Neither a
 * resume nor the replay of an already-settled operation is: refusing one
 * would leave an account already `deleting` unable to move forward or
 * back, and neither adds a membership item to anything.
 *
 * The refusal is the last step of the transaction rather than the first,
 * and that ordering is the whole of its fail-closed property. The join
 * saga's own barrier is the Active-User check inside
 * `reserveAndClaimActivation`, so publishing the `deleting` transition
 * *before* reading the directory leaves a concurrent join no gap: it
 * either already wrote its edge, in which case the read sees it, or it
 * writes afterwards and its own check refuses. Judging first — from
 * inside or outside the transaction — reopens exactly that window, and
 * an edge that settles behind an admitted deletion is unrecoverable.
 * Creating an operation the refusal rolls back costs nothing: the
 * rollback is what the transaction is for, and no terminal row survives
 * it to burn the retry window.
 *
 * Both claims hold **on the reference runtime**, which is the limit the
 * canon states (spec/usecases/identity.md#deleteaccount 手順 2): the
 * in-memory backend serialises transactions and makes a write visible the
 * moment it is staged, so the transition really is published before the
 * read. On a backend whose write set stays invisible until commit — D1 —
 * a join batch can still land between this read and the apply, and only a
 * commit-time guard on the directory closes that residue.
 */
export async function admitAccountDeletion(
  container: RequestContainer,
  input: DeleteAccountUserRequestInput,
): Promise<AdmittedAccountDeletion> {
  const userId = UserId.create(input.userId);
  const requestId = requireRequestId(input.requestId);
  const now = container.clock.now();

  const admitted = await container.globalUnitOfWorkProvider.run(
    async (ctx): Promise<AdmittedAccountDeletion> => {
      const versioned = await ctx.userRepository.findById(userId);
      if (versioned === null || versioned.entity.status === "deleted") {
        throw new NotFoundError("USER_NOT_FOUND", "User not found");
      }
      const user = versioned.entity;
      if (user.status !== "active" && user.status !== "deleting") {
        throw accountUnavailable();
      }
      if (input.confirmationEmail.trim().toLowerCase() !== user.email) {
        throw confirmationMismatch();
      }

      if (user.status === "active") {
        // Only a request that can create a new operation is judged: a
        // resume adds no terminal row.
        AccountDeletionRetryPolicy.ensureRetryable(
          await ctx.distributedOperationStore.countTerminalSince(
            "accountDeletion",
            userId,
            AccountDeletionRetryPolicy.windowStart(now),
          ),
        );
      }

      const identities = await ctx.identityRepository.listByUserId(userId);
      const { operation, resumed } =
        await ctx.distributedOperationStore.beginOrResume({
          kind: "accountDeletion",
          partitionKey: userId,
          requestKey: requestId,
          payload: uniquenessKeysOf(user, identities),
        });

      if (operation.state !== "running") {
        // A replay of a request whose operation already settled: the
        // status ticket is where the outcome is read.
        return { operationId: operation.id, userId, running: false };
      }

      if (resumed) {
        if (
          user.status !== "deleting" ||
          user.deletionOperationId !== operation.id
        ) {
          throw operationMismatch(operation.id);
        }
        return { operationId: operation.id, userId, running: true };
      }

      if (user.status !== "active") {
        throw operationMismatch(operation.id);
      }
      await ctx.userRepository.save(
        User.beginDeletion(user, operation.id, now),
        versioned.expectedVersion,
      );
      await refuseWhileMemberOfAnyWorkspace(ctx, userId);
      return { operationId: operation.id, userId, running: true };
    },
  );

  if (admitted.running) {
    await container.scopeUnitOfWorkProvider.run(ScopeKey.user(userId), (ctx) =>
      ctx.cleanupAdmission.beginPersonalAccountDeletion(
        admitted.operationId,
        userId,
      ),
    );
  }
  return admitted;
}
