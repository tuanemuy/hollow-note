import type { Identity } from "@repo/core/domain/identity/identity";
import { AccountDeletionRetryPolicy } from "@repo/core/domain/identity/services/accountDeletionRetryPolicy";
import { User } from "@repo/core/domain/identity/user";
import { UserId } from "@repo/core/domain/identity/valueObject";
import type { RequestContainer } from "../../di/types";
import { ConflictError, NotFoundError, ValidationError } from "../../errors";
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
 * The order is load-bearing (ADR-020). Retained terminal attempts are
 * **counted and judged before** the operation is created, so admission
 * never creates one it has to roll back. The operation is then decided
 * **before** the user transition, because `User.beginDeletion` accepts
 * only an `ActiveUser` and bumps `authEpoch`: calling it on a resume
 * would bump the generation a second time and let the running residue
 * cleanup delete credentials of the generation still in use. A resume
 * therefore only checks that the user is already `deleting` for this
 * very operation.
 *
 * The uniqueness keys are frozen into the operation payload here, while
 * the PII is still alive; global cleanup and every replay of it read
 * only the payload (ADR-020).
 *
 * The barrier is taken after the commit, in the personal scope's own
 * transaction: writes that committed before it stay visible to the
 * cleanup scan, and everything after is refused with `ACCOUNT_DELETING`.
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
