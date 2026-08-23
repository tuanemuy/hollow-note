import {
  isConflictError,
  isNotFoundError,
} from "@repo/core/application/errors";
import { EventId } from "@repo/core/domain/common/event";
import { isBusinessRuleError } from "@repo/core/domain/error";
import { IdentityErrorCode } from "@repo/core/domain/identity/errorCode";
import type { IdentityRemovedEvent } from "@repo/core/domain/identity/events";
import { describe, expect, it } from "vitest";
import { createTestHarness, type TestHarness } from "../../__tests__/helpers";
import { dispatchDomainEvent } from "../../workers/subscribers";
import { addPasswordIdentity } from "../addPasswordIdentity";
import { completeOAuthSignIn } from "../completeOAuthSignIn";
import { linkOAuthIdentity } from "../linkOAuthIdentity";
import { removalOperationId, removeIdentity } from "../removeIdentity";
import {
  beginOAuthFlow,
  devAuthorizationCode,
  signUpVerified,
  signUpWithGoogle,
} from "./authFlowHelpers";

const remove = (h: TestHarness, userId: string, identityId: string) =>
  removeIdentity({ container: h.container, input: { userId, identityId } });

const identitiesOf = (h: TestHarness, userId: string) =>
  h.backend.identities.values().filter((row) => row.userId === userId);

const removedEvents = (h: TestHarness) =>
  h.backend.outbox
    .values()
    .filter((row) => row.type === "identity.identity.removed");

const removedPayloads = (
  h: TestHarness,
): readonly IdentityRemovedEvent["payload"][] =>
  removedEvents(h).map((row) => row.payload as IdentityRemovedEvent["payload"]);

const directoryRow = (h: TestHarness, normalizedKey: string) =>
  h.backend.uniqueDirectory
    .values()
    .find(
      (row) =>
        row.kind === "providerAccount" && row.normalizedKey === normalizedKey,
    );

/** Runs every registered subscriber for the removals already emitted. */
async function drainRemovalEvents(h: TestHarness): Promise<void> {
  for (const row of removedEvents(h)) {
    await dispatchDomainEvent(
      {
        id: EventId.create(row.id),
        type: row.type,
        payload: row.payload as Record<string, unknown>,
        occurredAt: row.occurredAt,
        aggregateId: row.aggregateId,
      },
      h.workerContainer,
    );
  }
}

/** A user holding both a password and a Google identity. */
async function withTwoIdentities(h: TestHarness): Promise<
  Readonly<{
    userId: string;
    passwordIdentityId: string;
    oauthIdentityId: string;
  }>
> {
  const { userId } = await signUpWithGoogle(h, { email: "user@example.com" });
  const { identityId } = await addPasswordIdentity({
    container: h.container,
    input: { userId, newPassword: "addedpassword1" },
  });
  const oauth = identitiesOf(h, userId).find((row) => row.kind === "oauth");
  if (oauth === undefined) {
    throw new Error("no oauth identity was created");
  }
  return {
    userId,
    passwordIdentityId: identityId,
    oauthIdentityId: oauth.id,
  };
}

describe("removeIdentity", () => {
  it("TC-identity-179: deletes the identity and emits identity.identity.removed", async () => {
    const h = createTestHarness();
    const { userId, oauthIdentityId } = await withTwoIdentities(h);

    await expect(remove(h, userId, oauthIdentityId)).resolves.toEqual({});

    expect(identitiesOf(h, userId).map((row) => row.kind)).toEqual([
      "password",
    ]);
    expect(removedPayloads(h)).toEqual([
      {
        identityId: oauthIdentityId,
        userId,
        kind: "oauth",
        providerAccountKey: "google:google-account-1",
        operationId: removalOperationId(oauthIdentityId),
      },
    ]);
    expect(
      h.backend.identityRemovalReceipts.get(oauthIdentityId),
    ).toMatchObject({
      operationId: removalOperationId(oauthIdentityId),
      providerAccountKey: "google:google-account-1",
    });
  });

  it("TC-identity-180: refuses to remove the last identity", async () => {
    const h = createTestHarness();
    const { userId } = await signUpVerified(h);
    const [only] = identitiesOf(h, userId);
    if (only === undefined) {
      throw new Error("no identity to remove");
    }

    await expect(remove(h, userId, only.id)).rejects.toSatisfy(
      (error) =>
        isBusinessRuleError(error) &&
        error.code === IdentityErrorCode.LastIdentityCannotBeRemoved,
    );
    expect(identitiesOf(h, userId)).toHaveLength(1);
  });

  it("TC-identity-181: another user's identity is not found", async () => {
    const h = createTestHarness();
    const { userId, oauthIdentityId } = await withTwoIdentities(h);
    const stranger = await signUpVerified(h, "stranger@example.com");

    await expect(remove(h, stranger.userId, oauthIdentityId)).rejects.toSatisfy(
      (error) => isNotFoundError(error) && error.code === "IDENTITY_NOT_FOUND",
    );
    expect(identitiesOf(h, userId)).toHaveLength(2);
  });

  it("TC-identity-182: an unknown id is not found", async () => {
    const h = createTestHarness();
    const { userId } = await withTwoIdentities(h);

    await expect(remove(h, userId, "no-such-identity")).rejects.toSatisfy(
      (error) => isNotFoundError(error) && error.code === "IDENTITY_NOT_FOUND",
    );
  });

  it("TC-identity-184: the released provider account can be linked by somebody else", async () => {
    const h = createTestHarness();
    const { userId, oauthIdentityId } = await withTwoIdentities(h);
    expect(directoryRow(h, "google:google-account-1")?.state).toBe("active");

    await remove(h, userId, oauthIdentityId);
    await drainRemovalEvents(h);

    expect(directoryRow(h, "google:google-account-1")).toBeUndefined();
    const flow = await beginOAuthFlow(h, { intent: "signIn" });
    const view = await completeOAuthSignIn({
      container: h.container,
      input: {
        state: flow.state,
        stateBinding: flow.stateBinding,
        code: devAuthorizationCode(flow, {
          providerAccountId: "google-account-1",
          email: "someone-else@example.com",
        }),
      },
    });
    expect(view.userId).not.toBe(userId);
    expect(directoryRow(h, "google:google-account-1")).toMatchObject({
      state: "active",
      userId: view.userId,
    });
  });

  it("refuses to sign in with the provider account of a removed identity before the release lands", async () => {
    const h = createTestHarness();
    const { userId, oauthIdentityId } = await withTwoIdentities(h);
    await remove(h, userId, oauthIdentityId);
    // The claim outlives the identity until the removal event is
    // consumed, and may outlive it forever if that never happens.
    expect(directoryRow(h, "google:google-account-1")?.state).toBe("active");
    const sessionsBefore = h.backend.sessions.values().length;

    const flow = await beginOAuthFlow(h, { intent: "signIn" });
    await expect(
      completeOAuthSignIn({
        container: h.container,
        input: {
          state: flow.state,
          stateBinding: flow.stateBinding,
          code: devAuthorizationCode(flow, {
            providerAccountId: "google-account-1",
          }),
        },
      }),
    ).rejects.toSatisfy(
      (error) =>
        isConflictError(error) &&
        error.code === "PROVIDER_ACCOUNT_RELEASE_PENDING",
    );
    expect(h.backend.sessions.values()).toHaveLength(sessionsBefore);
  });

  it("tells the owner the claim is being released when re-linking before it lands", async () => {
    const h = createTestHarness();
    const { userId, oauthIdentityId } = await withTwoIdentities(h);
    await remove(h, userId, oauthIdentityId);

    const relink = await beginOAuthFlow(h, { intent: "linkIdentity", userId });
    await expect(
      linkOAuthIdentity({
        container: h.container,
        input: {
          state: relink.state,
          stateBinding: relink.stateBinding,
          code: devAuthorizationCode(relink, {
            providerAccountId: "google-account-1",
          }),
        },
      }),
    ).rejects.toSatisfy(
      (error) =>
        isConflictError(error) &&
        error.code === "PROVIDER_ACCOUNT_RELEASE_PENDING",
    );
    expect(identitiesOf(h, userId).map((row) => row.kind)).toEqual([
      "password",
    ]);
  });

  it("TC-identity-185: a re-sent removal answers from the receipt and releases under the same operation id", async () => {
    const h = createTestHarness();
    const { userId, oauthIdentityId } = await withTwoIdentities(h);
    await remove(h, userId, oauthIdentityId);

    await expect(remove(h, userId, oauthIdentityId)).resolves.toEqual({});

    expect(removedEvents(h)).toHaveLength(1);
    // Redelivering the same event must converge, not resurrect the key.
    await drainRemovalEvents(h);
    await drainRemovalEvents(h);
    expect(directoryRow(h, "google:google-account-1")).toBeUndefined();
  });

  it("TC-identity-186: two concurrent removals leave one identity standing", async () => {
    const h = createTestHarness();
    const { userId, oauthIdentityId, passwordIdentityId } =
      await withTwoIdentities(h);

    const results = await Promise.allSettled([
      remove(h, userId, oauthIdentityId),
      remove(h, userId, passwordIdentityId),
    ]);

    expect(identitiesOf(h, userId)).toHaveLength(1);
    const [rejected] = results.filter((result) => result.status === "rejected");
    if (rejected === undefined) {
      throw new Error("both removals succeeded");
    }
    expect(
      isBusinessRuleError(rejected.reason) &&
        rejected.reason.code === IdentityErrorCode.LastIdentityCannotBeRemoved,
    ).toBe(true);
  });

  it("keeps the re-linked claim when the removal event is redelivered", async () => {
    const h = createTestHarness();
    const { userId, oauthIdentityId } = await withTwoIdentities(h);
    await remove(h, userId, oauthIdentityId);
    await drainRemovalEvents(h);

    const relink = await beginOAuthFlow(h, { intent: "linkIdentity", userId });
    const { identityId: relinkedId } = await linkOAuthIdentity({
      container: h.container,
      input: {
        state: relink.state,
        stateBinding: relink.stateBinding,
        code: devAuthorizationCode(relink, {
          providerAccountId: "google-account-1",
        }),
      },
    });
    expect(relinkedId).not.toBe(oauthIdentityId);

    await drainRemovalEvents(h);

    expect(directoryRow(h, "google:google-account-1")).toMatchObject({
      state: "active",
      userId,
    });

    const stranger = await signUpVerified(h, "stranger@example.com");
    const steal = await beginOAuthFlow(h, {
      intent: "linkIdentity",
      userId: stranger.userId,
    });
    await expect(
      linkOAuthIdentity({
        container: h.container,
        input: {
          state: steal.state,
          stateBinding: steal.stateBinding,
          code: devAuthorizationCode(steal, {
            providerAccountId: "google-account-1",
          }),
        },
      }),
    ).rejects.toSatisfy(
      (error) =>
        isConflictError(error) &&
        error.code === "PROVIDER_ACCOUNT_ALREADY_LINKED",
    );

    const flow = await beginOAuthFlow(h, { intent: "signIn" });
    const view = await completeOAuthSignIn({
      container: h.container,
      input: {
        state: flow.state,
        stateBinding: flow.stateBinding,
        code: devAuthorizationCode(flow, {
          providerAccountId: "google-account-1",
        }),
      },
    });
    expect(view.userId).toBe(userId);
  });

  it("keeps the claim when no receipt backs the removal event", async () => {
    const h = createTestHarness();
    const { userId, oauthIdentityId } = await withTwoIdentities(h);
    await remove(h, userId, oauthIdentityId);
    h.backend.identityRemovalReceipts.delete(oauthIdentityId);

    await drainRemovalEvents(h);

    expect(directoryRow(h, "google:google-account-1")?.state).toBe("active");
  });
});
