import {
  WorkspaceId,
  WorkspaceSlug,
} from "@repo/core/domain/workspace/valueObject";
import type { ServiceArgs } from "../types";
import type { WorkspaceSlugAvailabilityView } from "./view";

export type CheckWorkspaceSlugAvailabilityInput = Readonly<{
  slug: string;
  workspaceId?: string | null;
}>;

/**
 * Tells the creation and general-settings forms whether a slug is free
 * before it is saved (UC-workspace-023,
 * spec/usecases/workspace.md#checkworkspaceslugavailability, WS-01 の
 * 「スラッグが既に使われている場合、入力中に検出して代替候補を示す」,
 * P-30 / P-31).
 *
 * An **advisory** read, not a claim, exactly like `checkHandleAvailability`
 * on the identity plane: only the reservation taken by `createWorkspace` /
 * `changeWorkspaceSlug` decides the winner, so a slug reported free can
 * still lose a race and come back as `SLUG_ALREADY_USED`. `resolveActive`
 * resolves settled claims only, so a key another operation has merely
 * reserved reads as free — the conservative direction for a hint, since
 * the form's own save is what finally refuses.
 *
 * `workspaceId` is the slug the caller already holds: passing it keeps a
 * form that re-submits its current slug from reporting a conflict with
 * itself. Slugs are public URL segments, so answering about one is not the
 * kind of oracle spec/adr/028-account-enumeration-resistance.md guards
 * against; the caller is still an authenticated session, which the
 * transport boundary enforces.
 */
export async function checkWorkspaceSlugAvailability({
  container,
  input,
}: ServiceArgs<CheckWorkspaceSlugAvailabilityInput>): Promise<WorkspaceSlugAvailabilityView> {
  const slug = WorkspaceSlug.create(input.slug);
  const workspaceId =
    input.workspaceId === undefined || input.workspaceId === null
      ? null
      : WorkspaceId.create(input.workspaceId);

  const holder =
    await container.workspaceSlugReservationStore.resolveActive(slug);
  const ownedBySelf = workspaceId !== null && holder === workspaceId;

  return {
    slug,
    available: holder === null || ownedBySelf,
    ownedBySelf,
  };
}
