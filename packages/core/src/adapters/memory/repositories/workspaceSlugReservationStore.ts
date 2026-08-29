import { ConflictError } from "../../../application/errors";
import type { WorkspaceSlugReservationStore } from "../../../domain/workspace/ports/workspaceSlugReservationStore";
import type {
  WorkspaceId,
  WorkspaceSlug,
} from "../../../domain/workspace/valueObject";
import type { MemoryBackend } from "../store";

const alreadyUsed = (slug: WorkspaceSlug): ConflictError =>
  new ConflictError("SLUG_ALREADY_USED", `Workspace slug ${slug} is taken`);

const reservationGone = (slug: WorkspaceSlug): ConflictError =>
  new ConflictError(
    "SLUG_RESERVATION_NOT_FOUND",
    `No slug reservation for ${slug}`,
  );

export function createMemoryWorkspaceSlugReservationStore(
  backend: MemoryBackend,
): WorkspaceSlugReservationStore {
  const table = backend.slugReservations;

  const releaseHeldBy = (
    slug: WorkspaceSlug,
    workspaceId: WorkspaceId,
  ): void => {
    const row = table.get(slug);
    if (
      row === undefined ||
      row.state !== "active" ||
      row.workspaceId !== workspaceId
    ) {
      return;
    }
    table.delete(slug);
  };

  return {
    async resolveActive(slug: WorkspaceSlug): Promise<WorkspaceId | null> {
      const row = table.get(slug);
      return row !== undefined && row.state === "active"
        ? row.workspaceId
        : null;
    },

    async reserve(input): Promise<void> {
      const existing = table.get(input.slug);
      if (existing !== undefined) {
        if (existing.operationId === input.operationId) {
          if (existing.state === "reserved") {
            table.set(input.slug, { ...existing, expiresAt: input.expiresAt });
          }
          return;
        }
        // The workspace already owns the key durably; re-keying it to
        // this operation lets `activate` find it without the public URL
        // ever ceasing to resolve.
        if (
          existing.state === "active" &&
          existing.workspaceId === input.workspaceId
        ) {
          table.set(input.slug, {
            ...existing,
            operationId: input.operationId,
          });
          return;
        }
        const lapsed =
          existing.state === "reserved" &&
          existing.expiresAt !== null &&
          existing.expiresAt.getTime() <= backend.clock.now().getTime();
        if (!lapsed) {
          throw alreadyUsed(input.slug);
        }
      }
      table.set(input.slug, {
        slug: input.slug,
        workspaceId: input.workspaceId,
        operationId: input.operationId,
        state: "reserved",
        expiresAt: input.expiresAt,
      });
    },

    async activate(input): Promise<void> {
      const row = table.get(input.slug);
      if (row === undefined) {
        throw reservationGone(input.slug);
      }
      // Checked before anything is released, so a stale replay of an
      // earlier change cannot free the slug the workspace holds today.
      if (
        row.operationId !== input.operationId ||
        row.workspaceId !== input.workspaceId
      ) {
        throw alreadyUsed(input.slug);
      }
      if (row.state === "reserved") {
        table.set(input.slug, { ...row, state: "active", expiresAt: null });
      }
      if (input.releasing !== null && input.releasing !== input.slug) {
        releaseHeldBy(input.releasing, input.workspaceId);
      }
    },

    async abandon(input): Promise<void> {
      const row = table.get(input.slug);
      if (
        row === undefined ||
        row.operationId !== input.operationId ||
        row.state !== "reserved"
      ) {
        return;
      }
      table.delete(input.slug);
    },

    async release(input): Promise<void> {
      releaseHeldBy(input.slug, input.workspaceId);
    },
  };
}
