import type {
  IdentityAddedEvent,
  IdentityPasswordChangedEvent,
  IdentityRemovedEvent,
  UserCreatedEvent,
  UserDeletedEvent,
  UserEmailVerifiedEvent,
  UserHandleChangedEvent,
  UserProfileUpdatedEvent,
} from "@repo/core/domain/identity/events";
import {
  DisplayName,
  Handle,
  IdentityId,
  UserId,
} from "@repo/core/domain/identity/valueObject";
import { z } from "zod";
import { buildEventDecoder } from "../events/buildDecoder";
import type {
  AccountDeletionDispatchContinuedEvent,
  AccountDeletionManifestBuildContinuedEvent,
  AccountDeletionManifestCompactContinuedEvent,
  UserAuthResidueCleanupContinuedEvent,
} from "./continuations";

/**
 * Wire decoders for the identity events. Decoders live in the application
 * layer because they depend on it. Each schema is `.strict()` so a payload with
 * extra keys — a schema-skewed row — fails as
 * `SystemError(DataIntegrityError)` instead of passing silently.
 */

const identityKindSchema = z.enum(["password", "oauth"]);

export const identityEventDecoders = {
  "identity.user.created": buildEventDecoder<
    UserCreatedEvent,
    { userId: string }
  >(
    "identity.user.created",
    z.object({ userId: z.string().min(1) }).strict(),
    (parsed) => ({ userId: UserId.create(parsed.userId) }),
  ),

  "identity.user.emailVerified": buildEventDecoder<
    UserEmailVerifiedEvent,
    { userId: string }
  >(
    "identity.user.emailVerified",
    z.object({ userId: z.string().min(1) }).strict(),
    (parsed) => ({ userId: UserId.create(parsed.userId) }),
  ),

  "identity.user.profileUpdated": buildEventDecoder<
    UserProfileUpdatedEvent,
    { userId: string; displayName: string }
  >(
    "identity.user.profileUpdated",
    z
      .object({ userId: z.string().min(1), displayName: z.string().min(1) })
      .strict(),
    (parsed) => ({
      userId: UserId.create(parsed.userId),
      displayName: DisplayName.create(parsed.displayName),
    }),
  ),

  "identity.user.handleChanged": buildEventDecoder<
    UserHandleChangedEvent,
    {
      userId: string;
      previousHandle: string | null;
      currentHandle: string | null;
    }
  >(
    "identity.user.handleChanged",
    z
      .object({
        userId: z.string().min(1),
        previousHandle: z.string().min(1).nullable(),
        currentHandle: z.string().min(1).nullable(),
      })
      .strict(),
    (parsed) => ({
      userId: UserId.create(parsed.userId),
      previousHandle:
        parsed.previousHandle === null
          ? null
          : Handle.create(parsed.previousHandle),
      currentHandle:
        parsed.currentHandle === null
          ? null
          : Handle.create(parsed.currentHandle),
    }),
  ),

  "identity.user.deleted": buildEventDecoder<
    UserDeletedEvent,
    { userId: string; deletionOperationId: string }
  >(
    "identity.user.deleted",
    z
      .object({
        userId: z.string().min(1),
        deletionOperationId: z.string().min(1),
      })
      .strict(),
    (parsed) => ({
      userId: UserId.create(parsed.userId),
      deletionOperationId: parsed.deletionOperationId,
    }),
  ),

  "identity.identity.added": buildEventDecoder<
    IdentityAddedEvent,
    { identityId: string; userId: string; kind: "password" | "oauth" }
  >(
    "identity.identity.added",
    z
      .object({
        identityId: z.string().min(1),
        userId: z.string().min(1),
        kind: identityKindSchema,
      })
      .strict(),
    (parsed) => ({
      identityId: IdentityId.create(parsed.identityId),
      userId: UserId.create(parsed.userId),
      kind: parsed.kind,
    }),
  ),

  "identity.identity.removed": buildEventDecoder<
    IdentityRemovedEvent,
    {
      identityId: string;
      userId: string;
      kind: "password" | "oauth";
      providerAccountKey: string | null;
      operationId: string;
    }
  >(
    "identity.identity.removed",
    z
      .object({
        identityId: z.string().min(1),
        userId: z.string().min(1),
        kind: identityKindSchema,
        providerAccountKey: z.string().min(1).nullable(),
        operationId: z.string().min(1),
      })
      .strict(),
    (parsed) => ({
      identityId: IdentityId.create(parsed.identityId),
      userId: UserId.create(parsed.userId),
      kind: parsed.kind,
      providerAccountKey: parsed.providerAccountKey,
      operationId: parsed.operationId,
    }),
  ),

  "identity.identity.passwordChanged": buildEventDecoder<
    IdentityPasswordChangedEvent,
    { identityId: string; userId: string }
  >(
    "identity.identity.passwordChanged",
    z
      .object({ identityId: z.string().min(1), userId: z.string().min(1) })
      .strict(),
    (parsed) => ({
      identityId: IdentityId.create(parsed.identityId),
      userId: UserId.create(parsed.userId),
    }),
  ),

  "identity.userAuthResidueCleanupContinued": buildEventDecoder<
    UserAuthResidueCleanupContinuedEvent,
    {
      userId: string;
      authEpoch: number;
      table: "sessions" | "authTokens";
      deletionOperationId: string | null;
    }
  >(
    "identity.userAuthResidueCleanupContinued",
    z
      .object({
        userId: z.string().min(1),
        authEpoch: z.number().int().nonnegative(),
        table: z.enum(["sessions", "authTokens"]),
        deletionOperationId: z.string().min(1).nullable(),
      })
      .strict(),
    (parsed) => ({
      userId: UserId.create(parsed.userId),
      authEpoch: parsed.authEpoch,
      table: parsed.table,
      deletionOperationId: parsed.deletionOperationId,
    }),
  ),

  "identity.accountDeletionManifestBuildContinued": buildEventDecoder<
    AccountDeletionManifestBuildContinuedEvent,
    {
      operationId: string;
      phase: "memberships" | "authorRoutes";
      cursor: string | null;
      continuationKey: string;
    }
  >(
    "identity.accountDeletionManifestBuildContinued",
    z
      .object({
        operationId: z.string().min(1),
        phase: z.enum(["memberships", "authorRoutes"]),
        cursor: z.string().min(1).nullable(),
        continuationKey: z.string().min(1),
      })
      .strict(),
    (parsed) => parsed,
  ),

  "identity.accountDeletionDispatchContinued": buildEventDecoder<
    AccountDeletionDispatchContinuedEvent,
    {
      operationId: string;
      phase:
        | "prepare"
        | "rollbackRelease"
        | "cleanup"
        | "redaction"
        | "finalize";
      cursor: string | null;
      continuationKey: string;
    }
  >(
    "identity.accountDeletionDispatchContinued",
    z
      .object({
        operationId: z.string().min(1),
        phase: z.enum([
          "prepare",
          "rollbackRelease",
          "cleanup",
          "redaction",
          "finalize",
        ]),
        cursor: z.string().min(1).nullable(),
        continuationKey: z.string().min(1),
      })
      .strict(),
    (parsed) => parsed,
  ),

  "identity.accountDeletionManifestCompactContinued": buildEventDecoder<
    AccountDeletionManifestCompactContinuedEvent,
    { operationId: string; cursor: string | null; continuationKey: string }
  >(
    "identity.accountDeletionManifestCompactContinued",
    z
      .object({
        operationId: z.string().min(1),
        cursor: z.string().min(1).nullable(),
        continuationKey: z.string().min(1),
      })
      .strict(),
    (parsed) => parsed,
  ),
} as const;
