import { encodeDevAuthorizationCode } from "@repo/core/adapters/oauth/devSignInOAuthClient";
import {
  isConflictError,
  isSystemError,
  isValidationError,
  SystemError,
  SystemErrorCode,
} from "@repo/core/application/errors";
import { isBusinessRuleError } from "@repo/core/domain/error";
import { IdentityErrorCode } from "@repo/core/domain/identity/errorCode";
import { Identity } from "@repo/core/domain/identity/identity";
import type { IdentityUniqueDirectory } from "@repo/core/domain/identity/ports/identityUniqueDirectory";
import type { SignInOAuthClient } from "@repo/core/domain/identity/ports/signInOAuthClient";
import { UserId } from "@repo/core/domain/identity/valueObject";
import { describe, expect, it } from "vitest";
import { createTestHarness, type TestHarness } from "../../__tests__/helpers";
import { completeOAuthSignIn } from "../completeOAuthSignIn";
import { startOAuthFlow } from "../startOAuthFlow";
import { signUpPending, signUpVerified } from "./authFlowHelpers";

type Grant = Readonly<{
  providerAccountId?: string;
  email?: string;
  emailVerified?: boolean;
  displayName?: string | null;
  /** Overrides the challenge the code answers, to break PKCE on purpose. */
  codeChallenge?: string;
}>;

const required = (value: string | null, name: string): string => {
  if (value === null) {
    throw new Error(`authorization URL has no ${name}`);
  }
  return value;
};

async function beginFlow(
  h: TestHarness,
  redirectTo: string | null = null,
): Promise<{ state: string; codeChallenge: string }> {
  const { authorizationUrl } = await startOAuthFlow({
    container: h.container,
    input: { provider: "google", intent: "signIn", redirectTo },
  });
  const url = new URL(authorizationUrl);
  return {
    state: required(url.searchParams.get("state"), "state"),
    codeChallenge: required(
      url.searchParams.get("code_challenge"),
      "code_challenge",
    ),
  };
}

const codeFor = (codeChallenge: string, grant: Grant): string =>
  encodeDevAuthorizationCode({
    providerAccountId: grant.providerAccountId ?? "google-account-1",
    email: grant.email ?? "oauth-user@example.com",
    emailVerified: grant.emailVerified ?? true,
    displayName: grant.displayName ?? "OAuth User",
    codeChallenge: grant.codeChallenge ?? codeChallenge,
  });

async function signInWithOAuth(
  h: TestHarness,
  grant: Grant = {},
  redirectTo: string | null = null,
) {
  const { state, codeChallenge } = await beginFlow(h, redirectTo);
  return completeOAuthSignIn({
    container: h.container,
    input: { state, code: codeFor(codeChallenge, grant) },
  });
}

/**
 * Same backend, one port swapped: the fault has to be injected around
 * the real directory, not around a second backend that shares nothing.
 */
const withDirectory = (
  h: TestHarness,
  directory: IdentityUniqueDirectory,
): TestHarness => ({
  ...h,
  container: { ...h.container, identityUniqueDirectory: directory },
});

const directoryRows = (h: TestHarness, kind: string) =>
  h.backend.uniqueDirectory.values().filter((row) => row.kind === kind);

const failing = (): SignInOAuthClient => ({
  deriveCodeChallenge: () => "challenge",
  buildAuthorizationUrl: () => "https://idp.example.test/authorize",
  exchangeCode: () => {
    throw new SystemError(
      SystemErrorCode.ExternalApiError,
      "provider unreachable",
    );
  },
});

describe("completeOAuthSignIn", () => {
  it("TC-identity-024: creates a verified user, an OAuth identity and a session", async () => {
    const h = createTestHarness();

    const view = await signInWithOAuth(h);

    expect(view.created).toBe(true);
    expect(view.sessionToken.length).toBeGreaterThan(0);
    const users = h.backend.users.values();
    expect(users).toHaveLength(1);
    expect(users[0]?.status).toBe("active");
    const identities = h.backend.identities.values();
    expect(identities).toHaveLength(1);
    expect(identities[0]?.kind).toBe("oauth");
    expect(h.backend.sessions.values()).toHaveLength(1);
    expect(directoryRows(h, "email").map((row) => row.state)).toEqual([
      "active",
    ]);
    expect(directoryRows(h, "providerAccount").map((row) => row.state)).toEqual(
      ["active"],
    );
  });

  it("shortens an over-long provider name to the DisplayName limit", async () => {
    const h = createTestHarness();

    const { userId } = await signInWithOAuth(h, {
      displayName: "x".repeat(80),
    });

    const user = h.backend.users.get(userId);
    expect(user?.status === "deleted" ? null : user?.displayName).toBe(
      "x".repeat(50),
    );
  });

  it("TC-identity-025: an existing provider link signs the same user in without creating one", async () => {
    const h = createTestHarness();
    const first = await signInWithOAuth(h);

    const second = await signInWithOAuth(h);

    expect(second.created).toBe(false);
    expect(second.userId).toBe(first.userId);
    expect(h.backend.users.values()).toHaveLength(1);
    expect(h.backend.identities.values()).toHaveLength(1);
    expect(h.backend.sessions.values()).toHaveLength(2);
  });

  it("TC-identity-026: an ActiveUser with the same address gains the OAuth identity", async () => {
    const h = createTestHarness();
    const { userId } = await signUpVerified(h, "user@example.com");

    const view = await signInWithOAuth(h, { email: "user@example.com" });

    expect(view.created).toBe(false);
    expect(view.userId).toBe(userId);
    const kinds = h.backend.identities
      .values()
      .filter((identity) => identity.userId === userId)
      .map((identity) => identity.kind);
    expect([...kinds].sort()).toEqual(["oauth", "password"]);
    const sessions = h.backend.sessions
      .values()
      .filter((session) => session.userId === userId);
    expect(sessions).toHaveLength(2);
    expect(sessions.map((session) => session.tokenHash)).toContain(
      h.container.secureTokenGenerator.hashOf(view.sessionToken),
    );
    expect(directoryRows(h, "providerAccount").map((row) => row.state)).toEqual(
      ["active"],
    );
  });

  it("TC-identity-027: the 8-identity limit refuses the link and frees the reservation", async () => {
    const h = createTestHarness();
    const { userId } = await signUpVerified(h, "user@example.com");
    const now = h.clock.now();
    for (let index = 0; index < 7; index += 1) {
      const filler = Identity.createOAuth(
        {
          id: `filler-${index}`,
          userId: UserId.create(userId),
          provider: "google",
          providerAccountId: `filler-account-${index}`,
          providerEmail: "user@example.com",
        },
        now,
      ).entity;
      h.backend.identities.set(filler.id, filler);
    }

    const error = await signInWithOAuth(h, { email: "user@example.com" }).catch(
      (thrown: unknown) => thrown,
    );

    expect(isBusinessRuleError(error) && error.code).toBe(
      IdentityErrorCode.IdentityLimitExceeded,
    );
    expect(h.backend.identities.values()).toHaveLength(8);
    expect(h.backend.sessions.values()).toHaveLength(1);
    expect(directoryRows(h, "providerAccount")).toHaveLength(0);
  });

  it("TC-identity-028: a PendingUser with the same address is EXISTING_ACCOUNT_UNVERIFIED", async () => {
    const h = createTestHarness();
    await signUpPending(h, "user@example.com");

    const error = await signInWithOAuth(h, { email: "user@example.com" }).catch(
      (thrown: unknown) => thrown,
    );

    expect(isValidationError(error) && error.code).toBe(
      "EXISTING_ACCOUNT_UNVERIFIED",
    );
    expect(h.backend.identities.values()).toHaveLength(1);
    expect(directoryRows(h, "providerAccount")).toHaveLength(0);
  });

  it("TC-identity-029: a DeletingUser reached by address or by provider link is ACCOUNT_UNAVAILABLE", async () => {
    const h = createTestHarness();
    const { userId } = await signUpVerified(h, "user@example.com");
    const linked = await signInWithOAuth(h, { email: "user@example.com" });
    expect(linked.userId).toBe(userId);
    const stored = h.backend.users.get(userId);
    if (stored === undefined || stored.status !== "active") {
      throw new Error("expected an active user row");
    }
    h.backend.users.set(userId, {
      ...stored,
      status: "deleting",
      deletionOperationId: "operation-1",
    });
    const sessionsBefore = h.backend.sessions.values().length;
    const identitiesBefore = h.backend.identities.values().length;

    // Provider link resolves to the deleting user.
    const viaProvider = await signInWithOAuth(h, {
      email: "user@example.com",
    }).catch((thrown: unknown) => thrown);
    expect(isValidationError(viaProvider) && viaProvider.code).toBe(
      "ACCOUNT_UNAVAILABLE",
    );

    // Address resolves to the deleting user (different provider account).
    const viaEmail = await signInWithOAuth(h, {
      email: "user@example.com",
      providerAccountId: "google-account-2",
    }).catch((thrown: unknown) => thrown);
    expect(isValidationError(viaEmail) && viaEmail.code).toBe(
      "ACCOUNT_UNAVAILABLE",
    );

    expect(h.backend.sessions.values()).toHaveLength(sessionsBefore);
    expect(h.backend.identities.values()).toHaveLength(identitiesBefore);
  });

  it("TC-identity-030: only one sign-up may hold the provider-account key", async () => {
    const h = createTestHarness();
    // The competing flow has reserved the key but not activated it yet;
    // `resolve` deliberately ignores reserved rows, so this request only
    // learns about the race from `reserve`.
    await h.container.identityUniqueDirectory.reserve({
      kind: "providerAccount",
      normalizedKey: "google:google-account-1",
      userId: UserId.create("other-user"),
      operationId: "other-operation",
      expiresAt: new Date(h.clock.now().getTime() + 60_000),
    });

    const error = await signInWithOAuth(h).catch((thrown: unknown) => thrown);

    expect(isConflictError(error) && error.code).toBe(
      "PROVIDER_ACCOUNT_ALREADY_LINKED",
    );
    expect(h.backend.users.values()).toHaveLength(0);
    // The email key taken earlier in the same saga is given back.
    expect(directoryRows(h, "email")).toHaveLength(0);
  });

  it("TC-identity-031: a failed second reservation releases the first under its own sub-operation id", async () => {
    const base = createTestHarness();
    const real = base.container.identityUniqueDirectory;
    const reserveCalls: string[] = [];
    const h = withDirectory(base, {
      ...real,
      reserve: async (input) => {
        reserveCalls.push(input.operationId);
        if (input.kind === "providerAccount") {
          throw new SystemError(
            SystemErrorCode.DatabaseError,
            "reserve failed",
          );
        }
        await real.reserve(input);
      },
    });

    const error = await signInWithOAuth(h).catch((thrown: unknown) => thrown);

    expect(isSystemError(error)).toBe(true);
    expect(reserveCalls).toHaveLength(2);
    expect(reserveCalls[0]).not.toBe(reserveCalls[1]);
    // The email key taken first is handed back under its own id.
    expect(h.backend.uniqueDirectory.values()).toHaveLength(0);
    expect(h.backend.users.values()).toHaveLength(0);
  });

  it("TC-identity-032: a lost activate response converges both reservations to active", async () => {
    const base = createTestHarness();
    const real = base.container.identityUniqueDirectory;
    let lossesLeft = 1;
    const h = withDirectory(base, {
      ...real,
      activate: async (operationId, version) => {
        await real.activate(operationId, version);
        if (lossesLeft > 0) {
          lossesLeft -= 1;
          // The write landed; only the answer was lost.
          throw new SystemError(
            SystemErrorCode.DatabaseError,
            "activate response lost",
          );
        }
      },
    });

    await signInWithOAuth(h);

    expect(h.backend.uniqueDirectory.values().map((row) => row.state)).toEqual([
      "active",
      "active",
    ]);
  });

  it("TC-identity-033: an unverified provider address is refused", async () => {
    const h = createTestHarness();

    const error = await signInWithOAuth(h, { emailVerified: false }).catch(
      (thrown: unknown) => thrown,
    );

    expect(isValidationError(error) && error.code).toBe(
      "OAUTH_EMAIL_UNVERIFIED",
    );
    expect(h.backend.users.values()).toHaveLength(0);
    expect(h.backend.uniqueDirectory.values()).toHaveLength(0);
  });

  it("TC-identity-034: an unknown state is OAUTH_STATE_INVALID", async () => {
    const h = createTestHarness();

    const error = await completeOAuthSignIn({
      container: h.container,
      input: { state: "never-issued", code: "code" },
    }).catch((thrown: unknown) => thrown);

    expect(isValidationError(error) && error.code).toBe("OAUTH_STATE_INVALID");
  });

  it("TC-identity-035: a state can only be exchanged once", async () => {
    const h = createTestHarness();
    const { state, codeChallenge } = await beginFlow(h);
    const code = codeFor(codeChallenge, {});
    await completeOAuthSignIn({
      container: h.container,
      input: { state, code },
    });

    const error = await completeOAuthSignIn({
      container: h.container,
      input: { state, code },
    }).catch((thrown: unknown) => thrown);

    expect(isValidationError(error) && error.code).toBe("OAUTH_STATE_INVALID");
    expect(h.backend.users.values()).toHaveLength(1);
  });

  it("TC-identity-036: a code the provider rejects is OAUTH_CODE_INVALID", async () => {
    const h = createTestHarness();

    const error = await signInWithOAuth(h, {
      codeChallenge: "challenge-of-another-flow",
    }).catch((thrown: unknown) => thrown);

    expect(isValidationError(error) && error.code).toBe("OAUTH_CODE_INVALID");
    expect(h.backend.users.values()).toHaveLength(0);
  });

  it("TC-identity-037: a provider that cannot be reached surfaces as a system error", async () => {
    const h = createTestHarness();
    const { state } = await beginFlow(h);

    const error = await completeOAuthSignIn({
      container: { ...h.container, signInOAuthClient: failing() },
      input: { state, code: "code" },
    }).catch((thrown: unknown) => thrown);

    expect(isSystemError(error) && error.code).toBe(
      SystemErrorCode.ExternalApiError,
    );
    expect(h.backend.users.values()).toHaveLength(0);
  });

  it("TC-identity-038: the stored redirectTo comes back with the session", async () => {
    const h = createTestHarness();

    const view = await signInWithOAuth(h, {}, "/notes/note-1");

    expect(view.redirectTo).toBe("/notes/note-1");
  });
});
