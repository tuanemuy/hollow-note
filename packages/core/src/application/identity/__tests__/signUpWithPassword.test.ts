import {
  isConflictError,
  isValidationError,
} from "@repo/core/application/errors";
import { isBusinessRuleError } from "@repo/core/domain/error";
import { IdentityErrorCode } from "@repo/core/domain/identity/errorCode";
import { describe, expect, it } from "vitest";
import { createTestHarness } from "../../__tests__/helpers";
import { signUpWithPassword } from "../signUpWithPassword";

const VALID = {
  email: "user@example.com",
  password: "password1234",
  displayName: "Alice",
  termsAccepted: true,
};

const directoryRowFor = (
  h: ReturnType<typeof createTestHarness>,
  normalizedKey: string,
) =>
  h.backend.uniqueDirectory
    .values()
    .find(
      (row) => row.kind === "email" && row.normalizedKey === normalizedKey,
    ) ?? null;

const businessCode = async (
  promise: Promise<unknown>,
): Promise<string | null> => {
  try {
    await promise;
    return null;
  } catch (error) {
    if (isBusinessRuleError(error)) {
      return error.code;
    }
    throw error;
  }
};

describe("signUpWithPassword", () => {
  it("TC-identity-247: creates a PendingUser + PasswordIdentity and sends the verification mail", async () => {
    const h = createTestHarness();
    const view = await signUpWithPassword({
      container: h.container,
      input: VALID,
    });

    expect(view.emailVerificationRequired).toBe(true);
    expect(view.sessionToken).toBeNull();

    const user = h.backend.users.get(view.userId);
    expect(user?.status).toBe("pending");
    const identities = h.backend.identities
      .values()
      .filter((identity) => identity.userId === view.userId);
    expect(identities).toHaveLength(1);
    expect(identities[0]?.kind).toBe("password");

    expect(directoryRowFor(h, "user@example.com")?.state).toBe("active");

    const sent = h.mailSender.sent();
    expect(sent).toHaveLength(1);
    expect(sent[0]?.template.kind).toBe("emailVerification");
    expect(sent[0]?.to).toBe("user@example.com");

    const outboxTypes = h.backend.outbox.values().map((row) => row.type);
    expect(outboxTypes).toContain("identity.user.created");
    expect(outboxTypes).toContain("identity.identity.added");
  });

  it("TC-identity-248: rejects without terms acceptance and creates nothing", async () => {
    const h = createTestHarness();
    await expect(
      signUpWithPassword({
        container: h.container,
        input: { ...VALID, termsAccepted: false },
      }),
    ).rejects.toSatisfy(
      (error) =>
        isValidationError(error) && error.code === "TERMS_NOT_ACCEPTED",
    );
    expect(h.backend.users.size).toBe(0);
  });

  it("TC-identity-249: rejects a malformed email", async () => {
    const h = createTestHarness();
    await expect(
      businessCode(
        signUpWithPassword({
          container: h.container,
          input: { ...VALID, email: "not-an-email" },
        }),
      ),
    ).resolves.toBe(IdentityErrorCode.InvalidEmail);
  });

  it("TC-identity-250: rejects a 7-character password", async () => {
    const h = createTestHarness();
    await expect(
      businessCode(
        signUpWithPassword({
          container: h.container,
          input: { ...VALID, password: "pass123" },
        }),
      ),
    ).resolves.toBe(IdentityErrorCode.WeakPassword);
  });

  it("TC-identity-251: accepts a 128-character password (upper boundary)", async () => {
    const h = createTestHarness();
    const password = `a1${"x".repeat(126)}`;
    expect(password).toHaveLength(128);
    const view = await signUpWithPassword({
      container: h.container,
      input: { ...VALID, password },
    });
    expect(h.backend.users.get(view.userId)?.status).toBe("pending");
  });

  it("TC-identity-252: rejects a 129-character password", async () => {
    const h = createTestHarness();
    const password = `a1${"x".repeat(127)}`;
    expect(password).toHaveLength(129);
    await expect(
      businessCode(
        signUpWithPassword({
          container: h.container,
          input: { ...VALID, password },
        }),
      ),
    ).resolves.toBe(IdentityErrorCode.WeakPassword);
  });

  it("TC-identity-253: rejects a digits-only 10-character password", async () => {
    const h = createTestHarness();
    await expect(
      businessCode(
        signUpWithPassword({
          container: h.container,
          input: { ...VALID, password: "1234567890" },
        }),
      ),
    ).resolves.toBe(IdentityErrorCode.WeakPassword);
  });

  it("TC-identity-254: rejects a whitespace-only display name", async () => {
    const h = createTestHarness();
    await expect(
      businessCode(
        signUpWithPassword({
          container: h.container,
          input: { ...VALID, displayName: "   " },
        }),
      ),
    ).resolves.toBe(IdentityErrorCode.InvalidDisplayName);
  });

  it("TC-identity-255: an already-registered email sends the existing-account notice with an indistinguishable response", async () => {
    const h = createTestHarness();
    const first = await signUpWithPassword({
      container: h.container,
      input: VALID,
    });

    const second = await signUpWithPassword({
      container: h.container,
      input: { ...VALID, displayName: "Someone else" },
    });

    expect(second.emailVerificationRequired).toBe(true);
    expect(second.sessionToken).toBeNull();
    // The decoy id never leaks the existing account.
    expect(second.userId).not.toBe(first.userId);
    // No second user was created.
    expect(h.backend.users.size).toBe(1);

    const kinds = h.mailSender.sent().map((message) => message.template.kind);
    expect(kinds).toEqual(["emailVerification", "existingAccountNotice"]);
  });

  it("TC-identity-259: a mail-infrastructure failure still returns success and is recorded", async () => {
    const h = createTestHarness({
      requestOverrides: {
        mailSender: {
          async send() {
            throw new Error("smtp down");
          },
        },
      },
    });
    const view = await signUpWithPassword({
      container: h.container,
      input: VALID,
    });
    expect(view.emailVerificationRequired).toBe(true);
    expect(h.backend.users.get(view.userId)?.status).toBe("pending");
    expect(
      h.logger
        .byLevel("error")
        .some((entry) => entry.message.includes("verification mail failed")),
    ).toBe(true);
  });

  it("TC-identity-261: two concurrent sign-ups for the same email — one wins, the other conflicts", async () => {
    const h = createTestHarness();
    const results = await Promise.allSettled([
      signUpWithPassword({ container: h.container, input: VALID }),
      signUpWithPassword({ container: h.container, input: VALID }),
    ]);

    const fulfilled = results.filter((r) => r.status === "fulfilled");
    const rejected = results.filter((r) => r.status === "rejected");
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    const reason = (rejected[0] as PromiseRejectedResult).reason;
    expect(isConflictError(reason)).toBe(true);
    expect((reason as { code: string }).code).toBe("EMAIL_ALREADY_USED");
    expect(h.backend.users.size).toBe(1);
  });

  it("TC-identity-262: a commit failure after the reservation releases it, so the email is not permanently blocked", async () => {
    const h = createTestHarness();
    const failing = {
      ...h.container,
      globalUnitOfWorkProvider: {
        run: () => Promise.reject(new Error("commit failed")),
      },
    };
    await expect(
      signUpWithPassword({ container: failing, input: VALID }),
    ).rejects.toThrow("commit failed");
    expect(directoryRowFor(h, "user@example.com")).toBeNull();

    // The same email registers successfully afterwards.
    const view = await signUpWithPassword({
      container: h.container,
      input: VALID,
    });
    expect(h.backend.users.get(view.userId)?.status).toBe("pending");
  });

  it("TC-identity-263: a lost activate response reconciles to active with the same sub-operation id", async () => {
    const h = createTestHarness();
    let activateCalls = 0;
    const flaky = {
      ...h.container,
      identityUniqueDirectory: {
        ...h.container.identityUniqueDirectory,
        async activate(operationId: string, expectedUserVersion: number) {
          activateCalls += 1;
          if (activateCalls === 1) {
            // Apply, then lose the response.
            await h.container.identityUniqueDirectory.activate(
              operationId,
              expectedUserVersion,
            );
            throw new Error("response lost");
          }
          await h.container.identityUniqueDirectory.activate(
            operationId,
            expectedUserVersion,
          );
        },
      },
    };

    const view = await signUpWithPassword({ container: flaky, input: VALID });
    expect(activateCalls).toBe(2);
    const row = directoryRowFor(h, "user@example.com");
    expect(row?.state).toBe("active");
    expect(row?.userId).toBe(view.userId);
  });
});
