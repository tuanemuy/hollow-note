import { BusinessRuleError, RehydrationError } from "@repo/core/domain/error";
import { IdentityErrorCode } from "./errorCode";
import { SessionId, TokenHash, UserId } from "./valueObject";

/**
 * Sign-in credential with an absolute (non-sliding) expiry. No OCC: the
 * row is only created and deleted, except for the epoch-refresh
 * conditional update owned by `SessionRepository.refreshAuthEpoch`.
 *
 * The plaintext session token lives on the client; only its hash is
 * stored. Cookie transport attributes and CSRF policy are presentation
 * concerns (spec/presentation/index.md).
 */
export type Session = Readonly<{
  id: SessionId;
  userId: UserId;
  tokenHash: TokenHash;
  authEpoch: number;
  createdAt: Date;
  expiresAt: Date;
}>;

const DAY_MS = 24 * 60 * 60 * 1000;

// The TTL is domain-owned (not a `create` argument) so the four issuing
// usecases cannot drift apart on the value.
const SESSION_TTL_MS = 30 * DAY_MS;

type ReconstructInput = Readonly<{
  id: string;
  userId: string;
  tokenHash: string;
  authEpoch: number;
  createdAt: Date;
  expiresAt: Date;
}>;

export const Session = {
  ttlMs: SESSION_TTL_MS,

  /** `expiresAt = now + Session.ttlMs`. Emits no events. */
  create: (
    params: Readonly<{
      id: string;
      userId: UserId;
      tokenHash: TokenHash;
      authEpoch: number;
    }>,
    now: Date,
  ): Session => ({
    id: SessionId.create(params.id),
    userId: params.userId,
    tokenHash: params.tokenHash,
    authEpoch: params.authEpoch,
    createdAt: now,
    expiresAt: new Date(now.getTime() + SESSION_TTL_MS),
  }),

  isExpired: (session: Session, now: Date): boolean =>
    session.expiresAt.getTime() <= now.getTime(),

  reconstruct: (input: ReconstructInput): Session => {
    try {
      if (
        !Number.isInteger(input.authEpoch) ||
        input.authEpoch < 0 ||
        input.expiresAt.getTime() <= input.createdAt.getTime()
      ) {
        throw new BusinessRuleError(
          IdentityErrorCode.InvalidId,
          "Invalid session row",
        );
      }
      return {
        id: SessionId.create(input.id),
        userId: UserId.create(input.userId),
        tokenHash: TokenHash.create(input.tokenHash),
        authEpoch: input.authEpoch,
        createdAt: input.createdAt,
        expiresAt: input.expiresAt,
      };
    } catch (error) {
      throw new RehydrationError(
        `Failed to reconstruct Session ${input.id}`,
        error,
      );
    }
  },
};
