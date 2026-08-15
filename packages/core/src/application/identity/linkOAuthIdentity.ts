import type { OAuthFlowState } from "@repo/core/application/ports/oauthStateStore";
import { Identity } from "@repo/core/domain/identity/identity";
import { IdentityPolicy } from "@repo/core/domain/identity/services/identityPolicy";
import {
  OAuthProvider,
  type UserId,
} from "@repo/core/domain/identity/valueObject";
import type { RequestContainer } from "../di/types";
import {
  ConflictError,
  NotFoundError,
  UnauthorizedError,
  ValidationError,
} from "../errors";
import type { ServiceArgs } from "../types";
import {
  oauthStateInvalid,
  providerAccountReleasePending,
} from "./completeOAuthSignIn";
import { oauthRedirectUri } from "./startOAuthFlow";
import {
  activateUniqueKeys,
  providerAccountKey,
  releaseUniqueKeys,
  reserveUniqueKeys,
} from "./uniqueness";
import type { LinkOAuthIdentityView } from "./view";

export type LinkOAuthIdentityInput = Readonly<{
  state: string;
  code: string;
}>;

const userNotFound = (): NotFoundError =>
  new NotFoundError("USER_NOT_FOUND", "User not found");

/**
 * Attaches an OAuth provider to the signed-in account (UC-identity-007,
 * spec/usecases/identity.md#linkoauthidentity).
 *
 * The `state` row is the only evidence of who started the flow and under
 * which auth generation, so a `signIn` state can never reach here and a
 * generation that has since been revoked (sign-out-all, password reset)
 * cannot land an identity on the account. Everything that can refuse the
 * link — deletion started, stale generation, the 8-method ceiling — is
 * decided inside the final unit of work, and the provider-account
 * reservation taken before it is released on every one of those paths so
 * a refused link never parks the key.
 */
export async function linkOAuthIdentity({
  container,
  input,
}: ServiceArgs<LinkOAuthIdentityInput>): Promise<LinkOAuthIdentityView> {
  const flow = await container.oauthStateStore.take(input.state);
  if (flow === null || flow.intent !== "linkIdentity") {
    throw oauthStateInvalid();
  }
  return linkOAuthIdentityForFlow(container, flow, input.code);
}

/**
 * The link half of the callback, for a `state` row the dispatcher has
 * already consumed to read its intent.
 */
export async function linkOAuthIdentityForFlow(
  container: RequestContainer,
  flow: OAuthFlowState,
  code: string,
): Promise<LinkOAuthIdentityView> {
  const {
    config,
    clock,
    idGenerator,
    identityUniqueDirectory,
    userReader,
    signInOAuthClient,
    globalUnitOfWorkProvider,
  } = container;

  const userId = flow.userId;
  const flowEpoch = flow.userAuthEpoch;
  if (userId === null || flowEpoch === null) {
    // `startOAuthFlow` never mints a linkIdentity state without both.
    throw oauthStateInvalid();
  }

  const provider = OAuthProvider.create(flow.provider);
  const profile = await signInOAuthClient.exchangeCode({
    provider,
    code,
    codeVerifier: flow.codeVerifier,
    redirectUri: oauthRedirectUri(config.appUrl, provider),
  });

  const accountKey = providerAccountKey(provider, profile.providerAccountId);
  const owner = await identityUniqueDirectory.resolve(
    "providerAccount",
    accountKey,
  );
  if (owner !== null && owner !== userId) {
    throw new ConflictError(
      "PROVIDER_ACCOUNT_ALREADY_LINKED",
      "This provider account is linked to another user",
    );
  }
  if (owner === userId) {
    return {
      identityId: await existingLinkId(
        container,
        userId,
        profile.providerAccountId,
        provider,
      ),
    };
  }

  const reservations = await reserveUniqueKeys(container, {
    parentOperationId: idGenerator.next(),
    userId,
    keys: [{ kind: "providerAccount", normalizedKey: accountKey }],
  });

  const now = clock.now();
  let created: { identityId: string; committedVersion: number };
  try {
    created = await globalUnitOfWorkProvider.run(async (ctx) => {
      const fresh = await ctx.userRepository.findById(userId);
      if (fresh === null || fresh.entity.status === "deleted") {
        throw userNotFound();
      }
      if (fresh.entity.status !== "active") {
        throw new ValidationError(
          "ACCOUNT_UNAVAILABLE",
          "Account is unavailable",
        );
      }
      if (fresh.entity.authEpoch !== flowEpoch) {
        // The generation that started the flow has been revoked, so the
        // principal behind this callback is no longer authenticated.
        throw new UnauthorizedError("UNAUTHENTICATED", "Not authenticated");
      }

      const identities = await ctx.identityRepository.listByUserId(userId);
      IdentityPolicy.ensureAddable(identities);

      const identity = Identity.createOAuth(
        {
          id: idGenerator.next(),
          userId,
          provider: profile.provider,
          providerAccountId: profile.providerAccountId,
          providerEmail: profile.email,
        },
        now,
      );
      await ctx.identityRepository.insert(identity.entity);
      ctx.collectEvents(identity.eventDrafts);
      return {
        identityId: identity.entity.id,
        committedVersion: fresh.entity.version,
      };
    });
  } catch (error) {
    await releaseUniqueKeys(container, reservations);
    throw error;
  }

  await activateUniqueKeys(container, {
    reservations,
    committedVersion: created.committedVersion,
    confirm: async () => {
      const current = await userReader.findById(userId);
      return current === null || current.entity.status === "deleted"
        ? null
        : current.entity.version;
    },
  });

  return { identityId: created.identityId };
}

/**
 * Idempotent replay: the directory already names this user as the owner,
 * so a live identity makes the link a no-op that answers with it.
 */
async function existingLinkId(
  container: RequestContainer,
  userId: UserId,
  providerAccountId: string,
  provider: OAuthProvider,
): Promise<string> {
  const identities = await container.identityReader.listByUserId(userId);
  const linked = identities.find(
    (identity) =>
      identity.kind === "oauth" &&
      identity.provider === provider &&
      identity.providerAccountId === providerAccountId,
  );
  if (linked === undefined) {
    // The claim resolves to this user but the row is gone: `removeIdentity`
    // deleted the identity and its `identity.identity.removed` has not
    // freed the key yet, so the link has to wait for that release.
    throw providerAccountReleasePending();
  }
  return linked.id;
}
