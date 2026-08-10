import type { DeletingUser, User } from "@repo/core/domain/identity/user";
import type { TestHarness } from "../../__tests__/helpers";
import { signUpWithPassword } from "../signUpWithPassword";
import { verifyEmail } from "../verifyEmail";

export const DEFAULT_PASSWORD = "password1234";

/** Extracts the plaintext token from the latest verification mail. */
export function latestVerificationToken(h: TestHarness): string {
  const mails = h.mailSender.sent();
  for (let i = mails.length - 1; i >= 0; i -= 1) {
    const template = mails[i]?.template;
    if (template?.kind === "emailVerification") {
      const url = new URL(template.verifyUrl);
      const token = url.searchParams.get("token");
      if (token !== null) {
        return token;
      }
    }
  }
  throw new Error("no verification mail was sent");
}

/** Extracts the plaintext token from the latest password-reset mail. */
export function latestPasswordResetToken(h: TestHarness): string {
  const mails = h.mailSender.sent();
  for (let i = mails.length - 1; i >= 0; i -= 1) {
    const template = mails[i]?.template;
    if (template?.kind === "passwordReset") {
      const url = new URL(template.resetUrl);
      const token = url.searchParams.get("token");
      if (token !== null) {
        return token;
      }
    }
  }
  throw new Error("no password reset mail was sent");
}

export async function signUpPending(
  h: TestHarness,
  email = "user@example.com",
): Promise<Readonly<{ userId: string; verificationToken: string }>> {
  const view = await signUpWithPassword({
    container: h.container,
    input: {
      email,
      password: DEFAULT_PASSWORD,
      displayName: "Alice",
      termsAccepted: true,
    },
  });
  return { userId: view.userId, verificationToken: latestVerificationToken(h) };
}

export async function signUpVerified(
  h: TestHarness,
  email = "user@example.com",
): Promise<Readonly<{ userId: string; sessionToken: string }>> {
  const { userId, verificationToken } = await signUpPending(h, email);
  const verified = await verifyEmail({
    container: h.container,
    input: { token: verificationToken },
  });
  if (verified.sessionToken === null) {
    throw new Error("expected a session from verification");
  }
  return { userId, sessionToken: verified.sessionToken };
}

/** Moves an active user to `deleting` without running `deleteAccount`. */
export function markDeleting(
  h: TestHarness,
  userId: string,
  deletionOperationId = "deletion-1",
): void {
  overwriteUser(h, userId, (user) => {
    if (user.status !== "active") {
      throw new Error(`user ${userId} is not active`);
    }
    const deleting: DeletingUser = {
      ...user,
      status: "deleting",
      deletionOperationId,
    };
    return deleting;
  });
}

/** Direct row rewrite for states no usecase in this slice can produce. */
export function overwriteUser(
  h: TestHarness,
  userId: string,
  mutate: (user: User) => User,
): void {
  const stored = h.backend.users.get(userId);
  if (stored === undefined) {
    throw new Error(`no user row for ${userId}`);
  }
  h.backend.users.set(userId, mutate(stored));
}
