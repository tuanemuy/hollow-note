import {
  isConflictError,
  isNotFoundError,
  isSystemError,
  isUnauthorizedError,
  isValidationError,
  SystemError,
  SystemErrorCode,
} from "@repo/core/application/errors";
import { isBusinessRuleError } from "@repo/core/domain/error";
import { IdentityErrorCode } from "@repo/core/domain/identity/errorCode";
import { Identity } from "@repo/core/domain/identity/identity";
import { UserId } from "@repo/core/domain/identity/valueObject";
import { describe, expect, it } from "vitest";
import { createTestHarness, type TestHarness } from "../../__tests__/helpers";
import { linkOAuthIdentity } from "../linkOAuthIdentity";
import { UNIQUE_RESERVATION_TTL_MS } from "../uniqueness";
import {
  beginOAuthFlow,
  devAuthorizationCode,
  markDeleted,
  markDeleting,
  type OAuthGrant,
  overwriteUser,
  signUpVerified,
  signUpWithGoogle,
} from "./authFlowHelpers";

const identitiesOf = (h: TestHarness, userId: string) =>
  h.backend.identities.values().filter((row) => row.userId === userId);

const directoryRows = (h: TestHarness) =>
  h.backend.uniqueDirectory
    .values()
    .filter((row) => row.kind === "providerAccount");

/** Starts a link flow for `userId` and exchanges the dev consent code. */
async function link(
  h: TestHarness,
  userId: string,
  grant: OAuthGrant = { providerAccountId: "google-link-1" },
) {
  const flow = await beginOAuthFlow(h, { intent: "linkIdentity", userId });
  return linkOAuthIdentity({
    container: h.container,
    input: {
      state: flow.state,
      stateBinding: flow.stateBinding,
      code: devAuthorizationCode(flow, grant),
    },
  });
}

/** Plants OAuth identities so the 8-method ceiling can be reached. */
function plantOAuthIdentities(
  h: TestHarness,
  userId: string,
  count: number,
): void {
  for (let index = 0; index < count; index += 1) {
    const id = `planted-oauth-${index}`;
    const { entity } = Identity.createOAuth(
      {
        id,
        userId: UserId.create(userId),
        provider: "google",
        providerAccountId: `planted-account-${index}`,
        providerEmail: `planted-${index}@example.com`,
      },
      h.clock.now(),
    );
    h.backend.identities.set(id, entity);
  }
}

describe("linkOAuthIdentity", () => {
  it("TC-identity-119: adds the OAuth identity and emits identity.added", async () => {
    const h = createTestHarness();
    const { userId } = await signUpVerified(h);

    const view = await link(h, userId);

    expect(
      identitiesOf(h, userId)
        .map((row) => row.kind)
        .sort(),
    ).toEqual(["oauth", "password"]);
    expect(
      h.backend.outbox
        .values()
        .filter(
          (row) =>
            row.type === "identity.identity.added" &&
            (row.payload as { identityId: string }).identityId ===
              view.identityId,
        ),
    ).toHaveLength(1);
    expect(
      directoryRows(h).find(
        (row) => row.normalizedKey === "google:google-link-1",
      ),
    ).toMatchObject({ state: "active", userId });
  });

  it("TC-identity-120: refuses a provider account linked to somebody else", async () => {
    const h = createTestHarness();
    const other = await signUpWithGoogle(h, {
      providerAccountId: "google-link-1",
      email: "other@example.com",
    });
    const { userId } = await signUpVerified(h);

    await expect(link(h, userId)).rejects.toSatisfy(
      (error) =>
        isConflictError(error) &&
        error.code === "PROVIDER_ACCOUNT_ALREADY_LINKED",
    );
    expect(identitiesOf(h, userId)).toHaveLength(1);
    expect(identitiesOf(h, other.userId)).toHaveLength(1);
  });

  it("TC-identity-121: refuses a signIn state", async () => {
    const h = createTestHarness();
    const { userId } = await signUpVerified(h);
    const flow = await beginOAuthFlow(h, { intent: "signIn" });

    await expect(
      linkOAuthIdentity({
        container: h.container,
        input: {
          state: flow.state,
          stateBinding: flow.stateBinding,
          code: devAuthorizationCode(flow),
        },
      }),
    ).rejects.toSatisfy(
      (error) =>
        isValidationError(error) && error.code === "OAUTH_STATE_INVALID",
    );
    expect(identitiesOf(h, userId)).toHaveLength(1);
  });

  it("TC-identity-122: refuses a user that no longer exists", async () => {
    const h = createTestHarness();
    const { userId } = await signUpVerified(h);
    const flow = await beginOAuthFlow(h, { intent: "linkIdentity", userId });
    h.backend.users.delete(userId);

    await expect(
      linkOAuthIdentity({
        container: h.container,
        input: {
          state: flow.state,
          stateBinding: flow.stateBinding,
          code: devAuthorizationCode(flow, {
            providerAccountId: "google-link-1",
          }),
        },
      }),
    ).rejects.toSatisfy(
      (error) => isNotFoundError(error) && error.code === "USER_NOT_FOUND",
    );
    expect(directoryRows(h)).toHaveLength(0);
  });

  it("TC-identity-122: refuses a tombstoned user the same way", async () => {
    const h = createTestHarness();
    const { userId } = await signUpVerified(h);
    const flow = await beginOAuthFlow(h, { intent: "linkIdentity", userId });
    markDeleted(h, userId);

    await expect(
      linkOAuthIdentity({
        container: h.container,
        input: {
          state: flow.state,
          stateBinding: flow.stateBinding,
          code: devAuthorizationCode(flow, {
            providerAccountId: "google-link-1",
          }),
        },
      }),
    ).rejects.toSatisfy(
      (error) => isNotFoundError(error) && error.code === "USER_NOT_FOUND",
    );
    expect(identitiesOf(h, userId)).toHaveLength(1);
    expect(directoryRows(h)).toHaveLength(0);
  });

  it("TC-identity-123: an auth-epoch bump after the flow started releases the reservation", async () => {
    const h = createTestHarness();
    const { userId } = await signUpVerified(h);
    const flow = await beginOAuthFlow(h, { intent: "linkIdentity", userId });
    overwriteUser(h, userId, (user) => ({
      ...user,
      authEpoch: user.authEpoch + 1,
    }));

    await expect(
      linkOAuthIdentity({
        container: h.container,
        input: {
          state: flow.state,
          stateBinding: flow.stateBinding,
          code: devAuthorizationCode(flow, {
            providerAccountId: "google-link-1",
          }),
        },
      }),
    ).rejects.toSatisfy(
      (error) => isUnauthorizedError(error) && error.code === "UNAUTHENTICATED",
    );
    expect(identitiesOf(h, userId)).toHaveLength(1);
    expect(directoryRows(h)).toHaveLength(0);
  });

  it("TC-identity-124: a deletion started after the flow blocks the late insert", async () => {
    const h = createTestHarness();
    const { userId } = await signUpVerified(h);
    const flow = await beginOAuthFlow(h, { intent: "linkIdentity", userId });
    markDeleting(h, userId);

    await expect(
      linkOAuthIdentity({
        container: h.container,
        input: {
          state: flow.state,
          stateBinding: flow.stateBinding,
          code: devAuthorizationCode(flow, {
            providerAccountId: "google-link-1",
          }),
        },
      }),
    ).rejects.toSatisfy(
      (error) =>
        isValidationError(error) && error.code === "ACCOUNT_UNAVAILABLE",
    );
    expect(identitiesOf(h, userId)).toHaveLength(1);
    expect(directoryRows(h)).toHaveLength(0);
  });

  it("TC-identity-125: refuses a 9th identity and releases the reservation", async () => {
    const h = createTestHarness();
    const { userId } = await signUpVerified(h);
    plantOAuthIdentities(h, userId, 7);

    await expect(link(h, userId)).rejects.toSatisfy(
      (error) =>
        isBusinessRuleError(error) &&
        error.code === IdentityErrorCode.IdentityLimitExceeded,
    );
    expect(identitiesOf(h, userId)).toHaveLength(8);
    expect(directoryRows(h)).toHaveLength(0);
  });

  it("TC-identity-126: two concurrent links from 7 identities cannot exceed 8", async () => {
    const h = createTestHarness();
    const { userId } = await signUpVerified(h);
    plantOAuthIdentities(h, userId, 6);

    const results = await Promise.allSettled([
      link(h, userId, { providerAccountId: "google-link-a" }),
      link(h, userId, { providerAccountId: "google-link-b" }),
    ]);

    expect(identitiesOf(h, userId)).toHaveLength(8);
    expect(
      results.filter((result) => result.status === "fulfilled"),
    ).toHaveLength(1);
    const losers = results.filter((result) => result.status === "rejected");
    expect(losers).toHaveLength(1);
    expect(
      losers.every(
        (loser) =>
          isBusinessRuleError(loser.reason) &&
          loser.reason.code === IdentityErrorCode.IdentityLimitExceeded,
      ),
    ).toBe(true);
    expect(directoryRows(h).map((row) => row.state)).toEqual(["active"]);
  });

  it("TC-identity-343: re-linking heals an identity whose claim was lost mid-saga", async () => {
    const h = createTestHarness();
    const { userId } = await signUpVerified(h);
    // The stranded row is the 8th, so healing it is only reachable while
    // the duplicate is looked up before the ceiling is enforced.
    plantOAuthIdentities(h, userId, 6);
    const real = h.container.identityUniqueDirectory;
    const stalled: TestHarness = {
      ...h,
      container: {
        ...h.container,
        identityUniqueDirectory: {
          ...real,
          activate: () => {
            throw new SystemError(
              SystemErrorCode.DatabaseError,
              "activate response lost",
            );
          },
        },
      },
    };

    await expect(link(stalled, userId)).rejects.toSatisfy(isSystemError);
    const stranded = identitiesOf(h, userId).find(
      (row) =>
        row.kind === "oauth" && row.providerAccountId === "google-link-1",
    );
    expect(stranded).toBeDefined();
    expect(identitiesOf(h, userId)).toHaveLength(8);
    expect(directoryRows(h).map((row) => row.state)).toEqual(["reserved"]);

    h.clock.advance(UNIQUE_RESERVATION_TTL_MS + 1);
    const view = await link(h, userId);

    expect(view.identityId).toBe(stranded?.id);
    expect(identitiesOf(h, userId)).toHaveLength(8);
    expect(
      identitiesOf(h, userId).filter(
        (row) =>
          row.kind === "oauth" && row.providerAccountId === "google-link-1",
      ),
    ).toHaveLength(1);
    expect(
      await h.container.identityUniqueDirectory.resolve(
        "providerAccount",
        "google:google-link-1",
      ),
    ).toBe(userId);
  });

  it("TC-identity-127: linking an account already linked to the same user is idempotent", async () => {
    const h = createTestHarness();
    const { userId } = await signUpVerified(h);
    const first = await link(h, userId);

    const second = await link(h, userId);

    expect(second.identityId).toBe(first.identityId);
    expect(identitiesOf(h, userId)).toHaveLength(2);
  });
});
