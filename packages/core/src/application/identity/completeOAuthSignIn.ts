import type { OAuthFlowState } from "@repo/core/application/ports/oauthStateStore";
import { Identity } from "@repo/core/domain/identity/identity";
import type { OAuthProfile } from "@repo/core/domain/identity/ports/signInOAuthClient";
import { AccountLinkingPolicy } from "@repo/core/domain/identity/services/accountLinkingPolicy";
import { IdentityPolicy } from "@repo/core/domain/identity/services/identityPolicy";
import { Session } from "@repo/core/domain/identity/session";
import { User } from "@repo/core/domain/identity/user";
import {
  DisplayName,
  Email,
  OAuthProvider,
  type UserId,
} from "@repo/core/domain/identity/valueObject";
import type { RequestContainer } from "../di/types";
import { ConflictError, ValidationError } from "../errors";
import type { ServiceArgs } from "../types";
import { oauthRedirectUri } from "./startOAuthFlow";
import {
  activateUniqueKeys,
  providerAccountKey,
  releaseUniqueKeys,
  reserveUniqueKeys,
  type UniqueKey,
  type UniqueReservation,
} from "./uniqueness";
import type { CompleteOAuthSignInView } from "./view";

export type CompleteOAuthSignInInput = Readonly<{
  state: string;
  code: string;
}>;

export const oauthStateInvalid = (): ValidationError =>
  new ValidationError("OAUTH_STATE_INVALID", "Authorization state is invalid");

const accountUnavailable = (): ValidationError =>
  new ValidationError("ACCOUNT_UNAVAILABLE", "Account is unavailable");

const existingAccountUnverified = (): ValidationError =>
  new ValidationError(
    "EXISTING_ACCOUNT_UNVERIFIED",
    "The existing account has not verified its email address",
  );

/**
 * The directory still names an owner whose UserId shard has no matching
 * identity. `removeIdentity` deletes the row inside its own shard and
 * leaves the claim to `identityRemovalRelease`, so the key outlives the
 * identity for as long as that event takes to land — and forever if it
 * never does. Distinct from `PROVIDER_ACCOUNT_ALREADY_LINKED` because
 * the claim belongs to the very account the visitor just unlinked, not
 * to a stranger.
 */
export const providerAccountReleasePending = (): ConflictError =>
  new ConflictError(
    "PROVIDER_ACCOUNT_RELEASE_PENDING",
    "This provider account is claimed but has no identity",
  );

/**
 * Falls back to the address' local part: the provider may withhold a
 * name, and `DisplayName` cannot be empty. A provider name longer than
 * the limit is shortened rather than refused — the visitor never chose it.
 */
function displayNameFor(profile: OAuthProfile, email: Email): DisplayName {
  const candidate = profile.displayName?.trim();
  const source =
    candidate !== undefined && candidate.length > 0
      ? candidate
      : (email.split("@")[0] ?? email);
  return DisplayName.truncate(source);
}

/**
 * Exchanges an authorization code and signs the visitor in, creating the
 * account or attaching the provider to an existing one
 * (UC-identity-006, spec/usecases/identity.md#completeoauthsignin).
 *
 * Three outcomes, decided in this order: an existing provider link signs
 * that user in; otherwise `AccountLinkingPolicy` judges the address, and
 * the flow either creates a verified user (claiming **two** uniqueness
 * keys under one parent operation) or attaches the identity to the
 * existing user (one key). Every branch re-reads status and epoch inside
 * the final unit of work and inserts the identity and the session there
 * together, so credential issuance stays serialized against deletion
 * start (spec/usecases/identity.md 認証資格発行と削除開始の直列化).
 */
export async function completeOAuthSignIn({
  container,
  input,
}: ServiceArgs<CompleteOAuthSignInInput>): Promise<CompleteOAuthSignInView> {
  const flow = await container.oauthStateStore.take(input.state);
  // `take` is a single atomic get + delete, so a replayed state lands
  // here as "not stored" and can never reach the exchange twice.
  if (flow === null || flow.intent !== "signIn") {
    throw oauthStateInvalid();
  }
  return completeOAuthSignInForFlow(container, flow, input.code);
}

/**
 * The sign-in half of the callback, for a `state` row that has already
 * been consumed. The callback dispatcher enters here because it had to
 * read the intent to choose a usecase at all.
 */
export async function completeOAuthSignInForFlow(
  container: RequestContainer,
  flow: OAuthFlowState,
  code: string,
): Promise<CompleteOAuthSignInView> {
  const { config, identityUniqueDirectory, userReader, signInOAuthClient } =
    container;

  const provider = OAuthProvider.create(flow.provider);
  const profile = await signInOAuthClient.exchangeCode({
    provider,
    code,
    codeVerifier: flow.codeVerifier,
    redirectUri: oauthRedirectUri(config.appUrl, provider),
  });

  const accountKey = providerAccountKey(provider, profile.providerAccountId);
  const linkedUserId = await identityUniqueDirectory.resolve(
    "providerAccount",
    accountKey,
  );
  if (linkedUserId !== null) {
    return signInLinkedUser(container, {
      userId: linkedUserId,
      accountKey,
      flow,
    });
  }

  const email = Email.create(profile.email);
  const existingUserId = await identityUniqueDirectory.resolve("email", email);
  const existingUser =
    existingUserId !== null
      ? ((await userReader.findById(existingUserId))?.entity ?? null)
      : null;

  const decision = AccountLinkingPolicy.decide(
    existingUser,
    profile.emailVerified,
  );
  switch (decision.kind) {
    case "refuse":
      switch (decision.reason) {
        case "providerEmailUnverified":
          throw new ValidationError(
            "OAUTH_EMAIL_UNVERIFIED",
            "The provider has not verified this email address",
          );
        case "existingUserUnverified":
          throw existingAccountUnverified();
        case "existingUserUnavailable":
          throw accountUnavailable();
      }
      break;
    case "linkToExisting":
      return attachToExistingUser(container, {
        userId: decision.userId,
        accountKey,
        profile,
        flow,
      });
    case "createNew":
      return createUser(container, { email, accountKey, profile, flow });
  }
}

/**
 * Signs in the user an existing provider link already points at. The
 * claim alone does not authorize the session (spec/usecases/identity.md
 * 手順 3): the identities of the shard it names must still include this
 * provider account, or the key outlived the identity it stood for.
 */
async function signInLinkedUser(
  container: RequestContainer,
  params: Readonly<{
    userId: UserId;
    accountKey: string;
    flow: OAuthFlowState;
  }>,
): Promise<CompleteOAuthSignInView> {
  const { clock, idGenerator, secureTokenGenerator, globalUnitOfWorkProvider } =
    container;
  const { userId } = params;
  const now = clock.now();
  const session = secureTokenGenerator.issueForUser(userId);

  await globalUnitOfWorkProvider.run(async (ctx) => {
    const fresh = await ctx.userRepository.findById(userId);
    if (fresh === null) {
      throw accountUnavailable();
    }
    if (fresh.entity.status === "pending") {
      throw existingAccountUnverified();
    }
    if (fresh.entity.status !== "active") {
      throw accountUnavailable();
    }
    const identities = await ctx.identityRepository.listByUserId(userId);
    const stillLinked = identities.some(
      (identity) =>
        identity.kind === "oauth" &&
        providerAccountKey(identity.provider, identity.providerAccountId) ===
          params.accountKey,
    );
    if (!stillLinked) {
      throw providerAccountReleasePending();
    }
    await ctx.sessionRepository.insert(
      Session.create(
        {
          id: idGenerator.next(),
          userId,
          tokenHash: session.hash,
          authEpoch: fresh.entity.authEpoch,
        },
        now,
      ),
    );
  });

  return {
    userId,
    sessionToken: session.token,
    redirectTo: params.flow.redirectTo,
    created: false,
  };
}

/** `createNew`: a verified user plus its first identity, two keys claimed. */
async function createUser(
  container: RequestContainer,
  params: Readonly<{
    email: Email;
    accountKey: string;
    profile: OAuthProfile;
    flow: OAuthFlowState;
  }>,
): Promise<CompleteOAuthSignInView> {
  const { clock, idGenerator, secureTokenGenerator, globalUnitOfWorkProvider } =
    container;
  const now = clock.now();
  const parentOperationId = idGenerator.next();

  const created = User.createVerified(
    {
      id: idGenerator.next(),
      email: params.email,
      displayName: displayNameFor(params.profile, params.email),
    },
    now,
  );
  const user = created.entity;

  const keys: readonly UniqueKey[] = [
    { kind: "email", normalizedKey: params.email },
    { kind: "providerAccount", normalizedKey: params.accountKey },
  ];
  const reservations = await reserveUniqueKeys(container, {
    parentOperationId,
    userId: user.id,
    keys,
  });

  const session = secureTokenGenerator.issueForUser(user.id);
  try {
    await globalUnitOfWorkProvider.run(async (ctx) => {
      await ctx.userRepository.insert(user);
      ctx.collectEvents(created.eventDrafts);

      const identity = Identity.createOAuth(
        {
          id: idGenerator.next(),
          userId: user.id,
          provider: params.profile.provider,
          providerAccountId: params.profile.providerAccountId,
          providerEmail: params.profile.email,
        },
        now,
      );
      await ctx.identityRepository.insert(identity.entity);
      ctx.collectEvents(identity.eventDrafts);

      await ctx.sessionRepository.insert(
        Session.create(
          {
            id: idGenerator.next(),
            userId: user.id,
            tokenHash: session.hash,
            authEpoch: user.authEpoch,
          },
          now,
        ),
      );
    });
  } catch (error) {
    await releaseUniqueKeys(container, reservations);
    throw error;
  }

  await activateReservations(container, reservations, user.version, user.id);

  return {
    userId: user.id,
    sessionToken: session.token,
    redirectTo: params.flow.redirectTo,
    created: true,
  };
}

/** `linkToExisting`: one identity added to a user that already exists. */
async function attachToExistingUser(
  container: RequestContainer,
  params: Readonly<{
    userId: UserId;
    accountKey: string;
    profile: OAuthProfile;
    flow: OAuthFlowState;
  }>,
): Promise<CompleteOAuthSignInView> {
  const { clock, idGenerator, secureTokenGenerator, globalUnitOfWorkProvider } =
    container;
  const now = clock.now();
  const parentOperationId = idGenerator.next();

  const reservations = await reserveUniqueKeys(container, {
    parentOperationId,
    userId: params.userId,
    keys: [{ kind: "providerAccount", normalizedKey: params.accountKey }],
  });

  const session = secureTokenGenerator.issueForUser(params.userId);
  let committedVersion: number;
  try {
    committedVersion = await globalUnitOfWorkProvider.run(async (ctx) => {
      const fresh = await ctx.userRepository.findById(params.userId);
      if (fresh === null) {
        throw accountUnavailable();
      }
      if (fresh.entity.status === "pending") {
        throw existingAccountUnverified();
      }
      if (fresh.entity.status !== "active") {
        throw accountUnavailable();
      }
      const identities = await ctx.identityRepository.listByUserId(
        params.userId,
      );
      // Throws BusinessRuleError(IdentityLimitExceeded) at 8 — the
      // reservation is released by the catch below.
      IdentityPolicy.ensureAddable(identities);

      const identity = Identity.createOAuth(
        {
          id: idGenerator.next(),
          userId: params.userId,
          provider: params.profile.provider,
          providerAccountId: params.profile.providerAccountId,
          providerEmail: params.profile.email,
        },
        now,
      );
      await ctx.identityRepository.insert(identity.entity);
      ctx.collectEvents(identity.eventDrafts);

      await ctx.sessionRepository.insert(
        Session.create(
          {
            id: idGenerator.next(),
            userId: params.userId,
            tokenHash: session.hash,
            authEpoch: fresh.entity.authEpoch,
          },
          now,
        ),
      );
      return fresh.entity.version;
    });
  } catch (error) {
    await releaseUniqueKeys(container, reservations);
    throw error;
  }

  await activateReservations(
    container,
    reservations,
    committedVersion,
    params.userId,
  );

  return {
    userId: params.userId,
    sessionToken: session.token,
    redirectTo: params.flow.redirectTo,
    created: false,
  };
}

/**
 * Publishes the claims, reconciling a lost response against the user row
 * the reservations belong to: a live (non-tombstone) user means the
 * authoritative write is durable and the claims converge to `active`.
 */
function activateReservations(
  container: RequestContainer,
  reservations: readonly UniqueReservation[],
  committedVersion: number,
  userId: UserId,
): Promise<void> {
  return activateUniqueKeys(container, {
    reservations,
    committedVersion,
    confirm: async () => {
      const current = await container.userReader.findById(userId);
      return current === null || current.entity.status === "deleted"
        ? null
        : current.entity.version;
    },
  });
}
