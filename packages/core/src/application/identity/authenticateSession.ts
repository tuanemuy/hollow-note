import { Session } from "@repo/core/domain/identity/session";
import { ValidationError } from "../errors";
import type { ServiceArgs } from "../types";
import { type AuthenticatedUserView, toAuthenticatedUserView } from "./view";

export type AuthenticateSessionInput = Readonly<{
  sessionToken: string;
}>;

const unauthenticated = (): ValidationError =>
  new ValidationError("UNAUTHENTICATED", "Not authenticated");

/**
 * Resolves the user behind a session token (UC-identity-008,
 * spec/usecases/identity.md#authenticatesession). Runs before every
 * protected operation, so it is **purely read-only**: sessions carry an
 * absolute expiry and no last-used timestamp, and nothing is written on
 * the success path. The only writes are best-effort deletions of rows
 * that are already invalid (expired / stale-epoch), whose failure never
 * changes the verdict. Every failure collapses to
 * `ValidationError("UNAUTHENTICATED")` without distinction.
 */
export async function authenticateSession({
  container,
  input,
}: ServiceArgs<AuthenticateSessionInput>): Promise<AuthenticatedUserView> {
  const { clock, secureTokenGenerator, sessionReader, userReader, logger } =
    container;

  const userId = secureTokenGenerator.locateUser(input.sessionToken);
  if (userId === null) {
    throw unauthenticated();
  }
  const tokenHash = secureTokenGenerator.hashOf(input.sessionToken);

  const session = await sessionReader.findByTokenHash(userId, tokenHash);
  if (session === null) {
    throw unauthenticated();
  }

  const dropQuietly = async (): Promise<void> => {
    try {
      await sessionReader.deleteById(session.id);
    } catch (cause) {
      logger.error("[authenticateSession] best-effort delete failed", {
        cause,
      });
    }
  };

  if (Session.isExpired(session, clock.now())) {
    await dropQuietly();
    throw unauthenticated();
  }

  const versioned = await userReader.findById(userId);
  if (versioned === null) {
    throw unauthenticated();
  }
  const user = versioned.entity;
  if (user.status !== "active" || session.authEpoch !== user.authEpoch) {
    if (user.status === "active" || user.status === "deleted") {
      await dropQuietly();
    }
    throw unauthenticated();
  }

  return toAuthenticatedUserView(user);
}
