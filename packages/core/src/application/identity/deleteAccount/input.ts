import { SystemError, SystemErrorCode, ValidationError } from "../../errors";
import type { DistributedOperationPayload } from "../../ports/distributedOperationStore";
import type { ScopeKey } from "../../scope";

/**
 * Input DTO of `deleteAccount` (spec/usecases/identity.md#deleteaccount).
 *
 * Only `userRequest` carries user input and therefore authentication and
 * confirmation checks; every other variant is a continuation that
 * resumes from the operation / manifest state on the UserId shard. They
 * are consumed by different entry points — the request path runs
 * `deleteAccount`, the continuations are worker-plane consumers — so the
 * union exists as the contract rather than as one dispatcher's parameter.
 */
export type DeleteAccountUserRequestInput = Readonly<{
  type: "userRequest";
  userId: string;
  confirmationEmail: string;
  requestId: string;
}>;

export type AccountDeletionBuildPhase = "memberships" | "authorRoutes";

export type AccountDeletionDispatchPhase =
  | "prepare"
  | "rollbackRelease"
  | "cleanup"
  | "redaction"
  | "finalize";

/**
 * `cursor` is the page position the turn starts from. The spec's DTO
 * names only the phase and leaves the position on the manifest header,
 * but then a redelivered turn resumes from wherever the chain has since
 * moved to instead of re-running itself: replaying the last page of a
 * phase would re-open that phase from its start. Carrying the position
 * makes a continuation describe exactly one turn, which is also what
 * makes its deterministic event id identify that turn.
 */
export type AccountDeletionManifestBuildContinuedInput = Readonly<{
  type: "identity.accountDeletionManifestBuildContinued";
  operationId: string;
  phase: AccountDeletionBuildPhase;
  cursor: string | null;
}>;

export type AccountDeletionDispatchContinuedInput<
  TPhase extends AccountDeletionDispatchPhase = AccountDeletionDispatchPhase,
> = Readonly<{
  type: "identity.accountDeletionDispatchContinued";
  operationId: string;
  phase: TPhase;
  /** Turn discriminator of a multi-turn phase (see the event's JSDoc). */
  cursor: string | null;
}>;

export type AccountDeletionManifestCompactContinuedInput = Readonly<{
  type: "identity.accountDeletionManifestCompactContinued";
  operationId: string;
  cursor: string | null;
}>;

export type AccountDeletionManifestPruneContinuedInput = Readonly<{
  type: "identity.accountDeletionManifestPruneContinued";
  runId: string;
  generation: string;
  shardId: string;
  cursor: string | null;
  asOf: Date;
}>;

export type PersonalBarrierPruneContinuedInput = Readonly<{
  type: "identity.personalBarrierPruneContinued";
  scope: ScopeKey;
  asOf: Date;
}>;

export type DeleteAccountInput =
  | DeleteAccountUserRequestInput
  | AccountDeletionManifestBuildContinuedInput
  | AccountDeletionDispatchContinuedInput
  | AccountDeletionManifestCompactContinuedInput
  | AccountDeletionManifestPruneContinuedInput
  | PersonalBarrierPruneContinuedInput;

/**
 * Uniqueness keys frozen into the operation payload at admission. Global
 * cleanup releases the directory claims from these and never re-reads
 * the identity rows: by then the PII they were derived from is either
 * gone or about to be.
 */
export type AccountDeletionUniquenessKeys = Readonly<{
  email: string;
  handle: string | null;
  providerAccounts: readonly string[];
}>;

export type AccountDeletionOperationPayload = Readonly<{
  uniqueness: AccountDeletionUniquenessKeys;
}>;

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The request key of the control-plane operation must be a UUID. */
export function requireRequestId(raw: string): string {
  if (!UUID_PATTERN.test(raw.trim())) {
    throw new ValidationError("INVALID_REQUEST_ID", "requestId must be a UUID");
  }
  return raw.trim();
}

const isStringArray = (value: unknown): value is readonly string[] =>
  Array.isArray(value) && value.every((item) => typeof item === "string");

/**
 * Reads the frozen uniqueness keys back off an operation payload. A
 * payload that does not carry them is a corrupt row rather than a user
 * error — the admission path is the only writer and always writes them.
 */
export function readUniquenessKeys(
  payload: DistributedOperationPayload,
): AccountDeletionUniquenessKeys {
  const uniqueness = (payload as Partial<AccountDeletionOperationPayload>)
    .uniqueness;
  if (
    uniqueness === undefined ||
    typeof uniqueness.email !== "string" ||
    (uniqueness.handle !== null && typeof uniqueness.handle !== "string") ||
    !isStringArray(uniqueness.providerAccounts)
  ) {
    throw new SystemError(
      SystemErrorCode.DataIntegrityError,
      "Account deletion operation payload carries no uniqueness keys",
    );
  }
  return {
    email: uniqueness.email,
    handle: uniqueness.handle,
    providerAccounts: [...uniqueness.providerAccounts],
  };
}
