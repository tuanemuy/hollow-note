import { BusinessRuleError, RehydrationError } from "@repo/core/domain/error";
import { IdentityErrorCode } from "./errorCode";
import {
  AuthTokenId,
  AuthTokenPurpose,
  TokenHash,
  UserId,
} from "./valueObject";

type AuthTokenBase = Readonly<{
  id: AuthTokenId;
  userId: UserId;
  purpose: AuthTokenPurpose;
  tokenHash: TokenHash;
  authEpoch: number;
  createdAt: Date;
  expiresAt: Date;
}>;

export type PendingAuthToken = AuthTokenBase & Readonly<{ status: "pending" }>;
export type ConsumedAuthToken = AuthTokenBase &
  Readonly<{ status: "consumed"; consumedAt: Date }>;

/**
 * One-shot secret for email verification / password reset. No OCC —
 * single consumption is enforced by `AuthTokenRepository.save` being a
 * conditional update on the `pending` row.
 */
export type AuthToken = PendingAuthToken | ConsumedAuthToken;

type ReconstructInput = Readonly<{
  id: string;
  userId: string;
  purpose: string;
  tokenHash: string;
  authEpoch: number;
  status: string;
  createdAt: Date;
  expiresAt: Date;
  consumedAt?: Date | null;
}>;

export const AuthToken = {
  /** `expiresAt = now + AuthTokenPurpose.ttlMs(purpose)`. */
  issue: (
    params: Readonly<{
      id: string;
      userId: UserId;
      purpose: AuthTokenPurpose;
      tokenHash: TokenHash;
      authEpoch: number;
    }>,
    now: Date,
  ): PendingAuthToken => ({
    status: "pending",
    id: AuthTokenId.create(params.id),
    userId: params.userId,
    purpose: params.purpose,
    tokenHash: params.tokenHash,
    authEpoch: params.authEpoch,
    createdAt: now,
    expiresAt: new Date(now.getTime() + AuthTokenPurpose.ttlMs(params.purpose)),
  }),

  consume: (token: PendingAuthToken, now: Date): ConsumedAuthToken => {
    if (AuthToken.isExpired(token, now)) {
      throw new BusinessRuleError(
        IdentityErrorCode.TokenExpired,
        "Auth token has expired",
      );
    }
    return { ...token, status: "consumed", consumedAt: now };
  },

  isExpired: (token: AuthToken, now: Date): boolean =>
    token.expiresAt.getTime() <= now.getTime(),

  reconstruct: (input: ReconstructInput): AuthToken => {
    try {
      if (!Number.isInteger(input.authEpoch) || input.authEpoch < 0) {
        throw new BusinessRuleError(
          IdentityErrorCode.InvalidId,
          "Invalid auth epoch",
        );
      }
      const base = {
        id: AuthTokenId.create(input.id),
        userId: UserId.create(input.userId),
        purpose: AuthTokenPurpose.create(input.purpose),
        tokenHash: TokenHash.create(input.tokenHash),
        authEpoch: input.authEpoch,
        createdAt: input.createdAt,
        expiresAt: input.expiresAt,
      };
      if (input.status === "pending") {
        return { ...base, status: "pending" };
      }
      if (input.status === "consumed") {
        if (input.consumedAt === null || input.consumedAt === undefined) {
          throw new BusinessRuleError(
            IdentityErrorCode.InvalidId,
            "Missing consumedAt",
          );
        }
        return { ...base, status: "consumed", consumedAt: input.consumedAt };
      }
      throw new BusinessRuleError(
        IdentityErrorCode.InvalidId,
        `Invalid auth token status: ${input.status}`,
      );
    } catch (error) {
      throw new RehydrationError(
        `Failed to reconstruct AuthToken ${input.id}`,
        error,
      );
    }
  },
};
