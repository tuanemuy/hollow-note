import type { WithEventDrafts } from "@repo/core/domain/common/event";
import { Version } from "@repo/core/domain/common/version";
import { BusinessRuleError, RehydrationError } from "@repo/core/domain/error";
import { IdentityErrorCode } from "./errorCode";
import { type IdentityEvent, IdentityEvents } from "./events";
import {
  Email,
  IdentityId,
  OAuthProvider,
  PasswordHash,
  UserId,
} from "./valueObject";

type IdentityBase = Readonly<{
  id: IdentityId;
  userId: UserId;
  version: Version;
  createdAt: Date;
  updatedAt: Date;
}>;

export type PasswordIdentity = IdentityBase &
  Readonly<{ kind: "password"; passwordHash: PasswordHash }>;
export type OAuthIdentity = IdentityBase &
  Readonly<{
    kind: "oauth";
    provider: OAuthProvider;
    providerAccountId: string;
    providerEmail: Email;
  }>;

export type Identity = PasswordIdentity | OAuthIdentity;

type ReconstructInput = Readonly<{
  id: string;
  userId: string;
  kind: string;
  version: number;
  createdAt: Date;
  updatedAt: Date;
  passwordHash?: string | null;
  provider?: string | null;
  providerAccountId?: string | null;
  providerEmail?: string | null;
}>;

export const Identity = {
  createPassword: (
    params: Readonly<{
      id: string;
      userId: UserId;
      passwordHash: PasswordHash;
    }>,
    now: Date,
  ): WithEventDrafts<PasswordIdentity, IdentityEvent> => {
    const identity: PasswordIdentity = {
      kind: "password",
      id: IdentityId.create(params.id),
      userId: params.userId,
      passwordHash: params.passwordHash,
      version: Version.initial(),
      createdAt: now,
      updatedAt: now,
    };
    return {
      entity: identity,
      eventDrafts: [
        IdentityEvents.identityAdded(
          identity.id,
          identity.userId,
          "password",
          now,
        ),
      ],
    };
  },

  createOAuth: (
    params: Readonly<{
      id: string;
      userId: UserId;
      provider: string;
      providerAccountId: string;
      providerEmail: string;
    }>,
    now: Date,
  ): WithEventDrafts<OAuthIdentity, IdentityEvent> => {
    if (params.providerAccountId.trim().length === 0) {
      throw new BusinessRuleError(
        IdentityErrorCode.InvalidProviderAccount,
        "Provider account id cannot be empty",
      );
    }
    const identity: OAuthIdentity = {
      kind: "oauth",
      id: IdentityId.create(params.id),
      userId: params.userId,
      provider: OAuthProvider.create(params.provider),
      providerAccountId: params.providerAccountId,
      providerEmail: Email.create(params.providerEmail),
      version: Version.initial(),
      createdAt: now,
      updatedAt: now,
    };
    return {
      entity: identity,
      eventDrafts: [
        IdentityEvents.identityAdded(
          identity.id,
          identity.userId,
          "oauth",
          now,
        ),
      ],
    };
  },

  changePassword: (
    identity: PasswordIdentity,
    passwordHash: PasswordHash,
    now: Date,
  ): WithEventDrafts<PasswordIdentity, IdentityEvent> => {
    const next: PasswordIdentity = {
      ...identity,
      passwordHash,
      version: Version.next(identity.version),
      updatedAt: now,
    };
    return {
      entity: next,
      eventDrafts: [
        IdentityEvents.identityPasswordChanged(next.id, next.userId, now),
      ],
    };
  },

  reconstruct: (input: ReconstructInput): Identity => {
    try {
      const base = {
        id: IdentityId.create(input.id),
        userId: UserId.create(input.userId),
        version: Version.create(input.version),
        createdAt: input.createdAt,
        updatedAt: input.updatedAt,
      };
      if (input.kind === "password") {
        if (input.passwordHash === null || input.passwordHash === undefined) {
          throw new BusinessRuleError(
            IdentityErrorCode.InvalidId,
            "Missing password hash",
          );
        }
        return {
          ...base,
          kind: "password",
          passwordHash: PasswordHash.create(input.passwordHash),
        };
      }
      if (input.kind === "oauth") {
        if (
          input.provider === null ||
          input.provider === undefined ||
          input.providerAccountId === null ||
          input.providerAccountId === undefined ||
          input.providerAccountId.length === 0 ||
          input.providerEmail === null ||
          input.providerEmail === undefined
        ) {
          throw new BusinessRuleError(
            IdentityErrorCode.InvalidProviderAccount,
            "Missing OAuth identity fields",
          );
        }
        return {
          ...base,
          kind: "oauth",
          provider: OAuthProvider.create(input.provider),
          providerAccountId: input.providerAccountId,
          providerEmail: Email.create(input.providerEmail),
        };
      }
      throw new BusinessRuleError(
        IdentityErrorCode.InvalidId,
        `Invalid identity kind: ${input.kind}`,
      );
    } catch (error) {
      throw new RehydrationError(
        `Failed to reconstruct Identity ${input.id}`,
        error,
      );
    }
  },
};
