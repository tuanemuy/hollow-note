import { BusinessRuleError } from "@repo/core/domain/error";
import type { Email, UserId } from "@repo/core/domain/identity/valueObject";
import { WorkspaceErrorCode } from "@repo/core/domain/workspace/errorCode";
import { WorkspaceAuthorization } from "@repo/core/domain/workspace/services/workspaceAuthorization";
import type { WorkspaceRole } from "@repo/core/domain/workspace/valueObject";
import type { RequestContainer } from "../di/types";
import { NotFoundError, ValidationError } from "../errors";
import type { Logger } from "../ports/logger";

/** Pieces the six invitation usecases share. */

export const invitationNotFound = (): NotFoundError =>
  new NotFoundError("INVITATION_NOT_FOUND", "Invitation not found");

export const invitationNotPending = (): ValidationError =>
  new ValidationError(
    "INVITATION_NOT_PENDING",
    "The invitation is no longer pending",
  );

/**
 * `manageMembers` for a caller whose role may be `null`. A non-member is
 * rejected with the same `InsufficientRole` a viewer gets: whether the
 * actor is outside the workspace or merely below the bar is not a
 * distinction the member-management screens are allowed to leak.
 */
export const ensureCanManageMembers = (role: WorkspaceRole | null): void => {
  if (role === null) {
    throw new BusinessRuleError(
      WorkspaceErrorCode.InsufficientRole,
      "Only a member can manage the workspace members",
    );
  }
  WorkspaceAuthorization.ensureCan(role, "manageMembers");
};

/** The link the recipient opens (`/invitations/:token`). */
export const invitationUrl = (appUrl: string, token: string): string =>
  `${appUrl}/invitations/${encodeURIComponent(token)}`;

/**
 * Sends the invitation mail and reports whether it left. A send failure
 * never fails the operation — the invitation is already durable and its
 * URL is returned to the inviter, who can share the link directly — but
 * the inviter is the one who has to do that sharing, so the outcome is
 * answered rather than only logged (`mailSent` in view.ts).
 */
export async function sendInvitationMail(
  container: RequestContainer,
  params: Readonly<{
    to: Email;
    workspaceName: string;
    role: WorkspaceRole;
    inviterId: UserId;
    token: string;
    expiresAt: Date;
  }>,
): Promise<boolean> {
  const { config, logger, mailSender, userBatchReader } = container;
  try {
    const users = await userBatchReader.resolveMany([params.inviterId]);
    const inviter = users.get(params.inviterId)?.entity;
    await mailSender.send({
      to: params.to,
      template: {
        kind: "workspaceInvitation",
        workspaceName: params.workspaceName,
        role: params.role,
        inviterName:
          inviter === undefined || inviter.status === "deleted"
            ? ""
            : inviter.displayName,
        acceptUrl: invitationUrl(config.appUrl, params.token),
        expiresAt: params.expiresAt,
      },
      locale: "ja",
    });
    return true;
  } catch (cause) {
    logger.error("[invitation] invitation mail failed", { cause });
    return false;
  }
}

/**
 * Runs a saga step that has already been decided but whose response may
 * have been lost. Every such step is idempotent for its operation id, so
 * repeating it either lands the same outcome or re-raises the genuine
 * conflict for the caller.
 */
export async function retryOnce(
  logger: Logger,
  label: string,
  run: () => Promise<void>,
): Promise<void> {
  try {
    await run();
  } catch (cause) {
    logger.error(`${label} response lost; retrying once`, { cause });
    await run();
  }
}

/**
 * Runs a compensation on a failure path. The original error is the one
 * the caller must see, so a failing compensation is logged and swallowed;
 * the reservation it could not drop is reclaimed by expiry recovery.
 */
export async function compensate(
  logger: Logger,
  label: string,
  cause: unknown,
  run: () => Promise<void>,
): Promise<void> {
  try {
    await run();
  } catch (compensationError) {
    logger.error(`${label} compensation failed`, {
      cause,
      compensationError,
    });
  }
}
