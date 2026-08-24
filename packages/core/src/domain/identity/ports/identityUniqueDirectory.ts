import type { UserId } from "../valueObject";

export type IdentityUniqueKind = "email" | "handle" | "providerAccount";

/**
 * A durable claim as observed at a point in time.
 *
 * `claimToken` tells one claim from another within the observed
 * `(kind, normalizedKey)`, and the contract asks exactly two things of
 * it: it stays the same for as long as the claim lives (a repeated,
 * idempotent `activate` included), and a claim taken after this one was
 * torn down carries a different token for the same normalized key —
 * **even when the same operation id takes it again**. Reservation
 * operation ids are deterministic (`updateProfile` derives one from the
 * user and the handle), so the same id can claim the same key twice; a
 * backend deriving the token from the operation id does not satisfy this
 * contract.
 *
 * Nothing beyond those two is contracted: tokens held under different
 * keys may coincide, and the value need not be hard to guess. What the
 * two do require is a value minted once per claim and carried for as
 * long as that claim lives — a counter that advances once per claim, or
 * a UUID minted when the claim's row is written and carried through the
 * later state transitions, qualifies; a value derived from the row's
 * contents or from the `operationId`, and a per-row version that
 * restarts once the row is deleted, do not.
 *
 * Opaque to callers — compare it, never parse, log, or persist it.
 */
export type ActiveUniqueClaim = Readonly<{
  userId: UserId;
  claimToken: string;
}>;

/**
 * Global uniqueness directory for email / handle / provider-account keys.
 *
 * Two-phase reservation protocol: `reserve` claims the normalized key for
 * an operation with an expiry; after the owning UoW commits, `activate`
 * (conditional on the expected user version) flips the reservation to a
 * durable claim; `release` frees it on failure. A caller that loses the
 * `activate` / `release` response reconciles by re-reading and re-issuing
 * the same operation's call — both must be idempotent for the same
 * `operationId`.
 *
 * Tearing a durable claim down is the mirrored two-phase move:
 * `beginRelease` marks the `active` row `releasing`, then `release` drops
 * it. It is keyed by `normalizedKey` rather than by the reservation's
 * `operationId` because the operation that created the claim is long
 * past and its id cannot be re-derived by the operation freeing it — and
 * it is conditional on the claim the caller observed through
 * `resolveClaim`, so a claim taken in the meantime is never torn down by
 * a decision made about its predecessor.
 *
 * Error contract: `ConflictError("EMAIL_ALREADY_USED")` /
 * `ConflictError("HANDLE_ALREADY_USED")` /
 * `ConflictError("PROVIDER_ACCOUNT_ALREADY_LINKED")` when the key is held
 * by another operation (a lapsed `reserved` row aside),
 * `SystemError(DatabaseError)` otherwise.
 */
export interface IdentityUniqueDirectory {
  /** Resolves the owner of a durable (`active`) claim; a key that is
   * merely reserved or already `releasing` resolves to `null`. A
   * projection of `resolveClaim`: the answer always equals
   * `(await resolveClaim(kind, normalizedKey))?.userId ?? null`. */
  resolve(
    kind: IdentityUniqueKind,
    normalizedKey: string,
  ): Promise<UserId | null>;
  /**
   * `resolve` plus the token identifying the claim itself, for a caller
   * that will later decide whether to tear *that* claim down.
   *
   * Same visibility rule as `resolve`: only `active` rows answer, while
   * `reserved`, `releasing`, and absent rows all answer `null`. An
   * `active` row always has a token — which write mints it is a backend
   * mechanism the contract does not constrain.
   */
  resolveClaim(
    kind: IdentityUniqueKind,
    normalizedKey: string,
  ): Promise<ActiveUniqueClaim | null>;
  reserve(
    input: Readonly<{
      kind: IdentityUniqueKind;
      normalizedKey: string;
      userId: UserId;
      operationId: string;
      expiresAt: Date;
    }>,
  ): Promise<void>;
  activate(operationId: string, expectedUserVersion: number): Promise<void>;
  /**
   * Moves the observed durable claim to `releasing` and re-keys the row
   * to the releasing operation, so the following `release(operationId)`
   * can find it.
   *
   * A compare-and-set, not an unconditional teardown: the only row it
   * touches is one that is `active`, held by `expectedUserId`, and whose
   * token equals `expectedClaimToken`. An absent row, a `reserved` row, a
   * `releasing` row, another user's row, and a token that no longer
   * matches are all no-ops, so a decision made about one claim can never
   * take the key away from the claim that replaced it.
   *
   * `reserved` is excluded because this call only tears **durable**
   * claims down: re-keying a reservation would hand it to the releasing
   * operation, whose `release` drops `reserved` rows as well, and the
   * in-flight operation that took the reservation would lose it mid-saga.
   * `releasing` is excluded because such a row already belongs to the
   * operation that re-keyed it.
   *
   * `expectedClaimToken` is mandatory so that no teardown can succeed
   * without an observation — the caller must have observed the claim
   * through `resolveClaim` first. A `releasing` row's token is
   * unspecified (it is invisible to `resolveClaim`), and only the
   * `release` of the operation that re-keyed the row can drop it, so a
   * caller freeing a key must use an operation id it can re-derive after
   * a lost response.
   */
  beginRelease(
    input: Readonly<{
      kind: IdentityUniqueKind;
      normalizedKey: string;
      expectedUserId: UserId;
      expectedClaimToken: string;
      operationId: string;
    }>,
  ): Promise<void>;
  /** Drops the operation's `reserved` and `releasing` rows. Activated
   * claims are untouched — freeing one goes through `beginRelease`. */
  release(operationId: string): Promise<void>;
}
