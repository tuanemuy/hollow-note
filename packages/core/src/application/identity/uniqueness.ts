import type {
  IdentityUniqueDirectory,
  IdentityUniqueKind,
} from "@repo/core/domain/identity/ports/identityUniqueDirectory";
import type {
  OAuthProvider,
  UserId,
} from "@repo/core/domain/identity/valueObject";
import type { Clock } from "../ports/clock";
import type { Logger } from "../ports/logger";

/**
 * The uniqueness reservation saga shared by every usecase that claims an
 * email / handle / provider-account key
 * (spec/usecases/identity.md#identity-uniqueness-の物理shard境界).
 *
 * Shape of the saga, identical for all three kinds:
 * `reserve` on the key shard → the UserId-shard unit of work →
 * `activate` on the key shard. A failed commit releases; a lost
 * `activate` response reconciles by re-reading the authoritative row.
 * It is a **usecase procedure**, not domain logic: nothing here decides
 * a business rule, it only sequences two stores that cannot share a
 * transaction.
 *
 * Multi-key operations (OAuth sign-up claims email *and* provider
 * account) derive one sub-operation id per key from the parent, so a
 * partial failure can release exactly the keys it took and a retry of
 * the same parent derives the same ids.
 */

export type UniqueKey = Readonly<{
  kind: IdentityUniqueKind;
  normalizedKey: string;
}>;

/**
 * A key claimed for one parent operation. `parentOperationId` is kept
 * alongside the derived `operationId` because it is, with `kind`, the only
 * part of the reservation that may leave this module: `operationId` ends in
 * the raw key.
 */
export type UniqueReservation = UniqueKey &
  Readonly<{ parentOperationId: string; operationId: string }>;

/** How long a reservation holds the key while its unit of work runs. */
export const UNIQUE_RESERVATION_TTL_MS = 10 * 60 * 1000;

type UniquenessDeps = Readonly<{
  identityUniqueDirectory: IdentityUniqueDirectory;
  clock: Clock;
  logger: Logger;
}>;

/** Directory key of an OAuth identity — the only composite key kind. */
export const providerAccountKey = (
  provider: OAuthProvider,
  providerAccountId: string,
): string => `${provider}:${providerAccountId}`;

/**
 * Sub-operation id for one key of a parent operation.
 *
 * Composed rather than hashed (the spec writes `sha256(parent + ":" +
 * kind + ":" + normalizedKey)`): the components are unambiguous in this
 * order — `kind` is a closed enum without `:` and the free-form key comes
 * last — so composition already gives distinctness and determinism, and
 * it keeps a hash implementation out of the application layer.
 *
 * The result therefore embeds the raw key (an email address, a handle, a
 * provider account id) and must never reach a log or any other sink
 * outside the directory: log `{ parentOperationId, kind }` instead.
 */
export const reservationOperationId = (
  parentOperationId: string,
  key: UniqueKey,
): string => `${parentOperationId}:${key.kind}:${key.normalizedKey}`;

/**
 * Claims every key for the parent operation, in order. If any claim
 * fails the ones already taken are released before the failure
 * propagates, so a rejected saga never leaves a key parked until its TTL.
 */
export async function reserveUniqueKeys(
  deps: UniquenessDeps,
  params: Readonly<{
    parentOperationId: string;
    userId: UserId;
    keys: readonly UniqueKey[];
  }>,
): Promise<readonly UniqueReservation[]> {
  const expiresAt = new Date(
    deps.clock.now().getTime() + UNIQUE_RESERVATION_TTL_MS,
  );
  const taken: UniqueReservation[] = [];
  for (const key of params.keys) {
    const reservation: UniqueReservation = {
      ...key,
      parentOperationId: params.parentOperationId,
      operationId: reservationOperationId(params.parentOperationId, key),
    };
    try {
      await deps.identityUniqueDirectory.reserve({
        kind: key.kind,
        normalizedKey: key.normalizedKey,
        userId: params.userId,
        operationId: reservation.operationId,
        expiresAt,
      });
    } catch (error) {
      await releaseUniqueKeys(deps, taken);
      throw error;
    }
    taken.push(reservation);
  }
  return taken;
}

/**
 * Frees reservations after a failure. Never throws: the caller is
 * already failing for another reason, and a release that does not land
 * only parks the key until its TTL lapses.
 */
export async function releaseUniqueKeys(
  deps: UniquenessDeps,
  reservations: readonly UniqueReservation[],
): Promise<void> {
  for (const reservation of reservations) {
    try {
      await deps.identityUniqueDirectory.release(reservation.operationId);
    } catch (cause) {
      deps.logger.error("[uniqueness] reservation release failed", {
        cause,
        parentOperationId: reservation.parentOperationId,
        kind: reservation.kind,
      });
    }
  }
}

/**
 * Whether the durable (`active`) claim for `key` is held by
 * `expectedUserId` right now.
 *
 * A key that is merely `reserved`, already `releasing`, absent, or held by
 * someone else all answer `false` — the aggregate that names the key can
 * only treat its claim as published when the directory says the claim is
 * both durable and its own.
 */
export async function holdsActiveUniqueKey(
  deps: Pick<UniquenessDeps, "identityUniqueDirectory">,
  params: UniqueKey & Readonly<{ expectedUserId: UserId }>,
): Promise<boolean> {
  const owner = await deps.identityUniqueDirectory.resolve(
    params.kind,
    params.normalizedKey,
  );
  return owner === params.expectedUserId;
}

/**
 * Tears a **durable** (`active`) claim down, the mirror of the reserve →
 * activate half: `beginRelease` marks the row `releasing` and re-keys it
 * to `operationId`, then `release` drops it.
 *
 * Keyed by `normalizedKey` and the owner rather than by the reservation
 * that created the claim: that operation is long past and its id cannot
 * be re-derived by the one freeing the key. A row that is
 * missing or held by someone else makes `beginRelease` a no-op, so this
 * can never take a key away from its owner, and re-running the same
 * `operationId` converges — which is what lets an at-least-once consumer
 * call it.
 */
export async function releaseActiveUniqueKey(
  deps: Pick<UniquenessDeps, "identityUniqueDirectory">,
  params: UniqueKey &
    Readonly<{
      expectedUserId: UserId;
      operationId: string;
    }>,
): Promise<void> {
  await deps.identityUniqueDirectory.beginRelease({
    kind: params.kind,
    normalizedKey: params.normalizedKey,
    expectedUserId: params.expectedUserId,
    operationId: params.operationId,
  });
  await deps.identityUniqueDirectory.release(params.operationId);
}

/**
 * Publishes the durable claims after the authoritative write committed.
 *
 * A lost `activate` response is reconciled per the spec's convergence
 * rule: re-read the authoritative row through `confirm`, and either
 * activate at its current version (the write is durable) or release (it
 * is not). `confirm` runs at most once per call — every reservation of
 * one operation observes the same verdict, so the group cannot end up
 * half activated and half released.
 */
export async function activateUniqueKeys(
  deps: UniquenessDeps,
  params: Readonly<{
    reservations: readonly UniqueReservation[];
    committedVersion: number;
    confirm: () => Promise<number | null>;
  }>,
): Promise<void> {
  let verdict: Promise<number | null> | null = null;
  const confirmOnce = (): Promise<number | null> => {
    verdict ??= params.confirm();
    return verdict;
  };

  for (const reservation of params.reservations) {
    try {
      await deps.identityUniqueDirectory.activate(
        reservation.operationId,
        params.committedVersion,
      );
    } catch (cause) {
      deps.logger.error("[uniqueness] activate response lost; reconciling", {
        cause,
        parentOperationId: reservation.parentOperationId,
        kind: reservation.kind,
      });
      const currentVersion = await confirmOnce();
      if (currentVersion !== null) {
        await deps.identityUniqueDirectory.activate(
          reservation.operationId,
          currentVersion,
        );
      } else {
        await deps.identityUniqueDirectory.release(reservation.operationId);
      }
    }
  }
}
