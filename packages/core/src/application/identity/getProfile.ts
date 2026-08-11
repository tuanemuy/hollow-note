import { UserId } from "@repo/core/domain/identity/valueObject";
import { NotFoundError, ValidationError } from "../errors";
import type { ServiceArgs } from "../types";
import { type ProfileView, toProfileView } from "./view";

export type GetProfileInput = Readonly<{ userId: string }>;

/**
 * Reads back the fields P-21 edits.
 *
 * A read of one's own profile has no usecase in the spec — `updateProfile`
 * defines the projection and `getPublicProfile` is keyed by handle, so it
 * cannot serve a user who has not set one. The settings form still has to
 * start from the stored values (`bio` in particular is projected nowhere
 * else), and reaching into `userReader` from the presentation layer would
 * put a repository read outside the application layer. Hence this
 * read-only sibling of `updateProfile` (ADR-047).
 */
export async function getProfile({
  container,
  input,
}: ServiceArgs<GetProfileInput>): Promise<ProfileView> {
  const userId = UserId.create(input.userId);
  const versioned = await container.userReader.findById(userId);
  if (versioned === null || versioned.entity.status === "deleted") {
    throw new NotFoundError("USER_NOT_FOUND", "User not found");
  }
  if (versioned.entity.status === "pending") {
    throw new ValidationError(
      "EMAIL_NOT_VERIFIED",
      "The email address has not been verified",
    );
  }
  if (versioned.entity.status !== "active") {
    throw new ValidationError("ACCOUNT_UNAVAILABLE", "Account is unavailable");
  }
  return toProfileView(versioned.entity);
}
