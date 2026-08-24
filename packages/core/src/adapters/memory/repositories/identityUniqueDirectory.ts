import { ConflictError } from "../../../application/errors";
import type {
  ActiveUniqueClaim,
  IdentityUniqueDirectory,
  IdentityUniqueKind,
} from "../../../domain/identity/ports/identityUniqueDirectory";
import type { UserId } from "../../../domain/identity/valueObject";
import type { DirectoryRow, MemoryBackend } from "../store";

const CONFLICT_CODES: Record<IdentityUniqueKind, string> = {
  email: "EMAIL_ALREADY_USED",
  handle: "HANDLE_ALREADY_USED",
  providerAccount: "PROVIDER_ACCOUNT_ALREADY_LINKED",
};

// NUL separates the composite key because it cannot occur in either
// part; the escape sequence (not a raw byte) keeps this file text for
// git diff / grep / blame.
const rowKey = (kind: IdentityUniqueKind, normalizedKey: string): string =>
  `${kind}\u0000${normalizedKey}`;

const heldByAnother = (
  kind: IdentityUniqueKind,
  normalizedKey: string,
): ConflictError =>
  new ConflictError(
    CONFLICT_CODES[kind],
    `Unique key already held: ${kind} ${normalizedKey}`,
  );

export function createMemoryIdentityUniqueDirectory(
  backend: MemoryBackend,
): IdentityUniqueDirectory {
  const table = backend.uniqueDirectory;
  const rowsByOperation = (
    operationId: string,
  ): readonly (readonly [string, DirectoryRow])[] =>
    table.entries().filter(([, row]) => row.operationId === operationId);

  // Reserved rows are not durable claims yet, and releasing rows are
  // claims already being torn down — neither resolves.
  const activeClaim = (
    kind: IdentityUniqueKind,
    normalizedKey: string,
  ): ActiveUniqueClaim | null => {
    const row = table.get(rowKey(kind, normalizedKey));
    return row !== undefined && row.state === "active"
      ? { userId: row.userId, claimToken: row.claimToken }
      : null;
  };

  return {
    async resolveClaim(
      kind: IdentityUniqueKind,
      normalizedKey: string,
    ): Promise<ActiveUniqueClaim | null> {
      return activeClaim(kind, normalizedKey);
    },

    async resolve(
      kind: IdentityUniqueKind,
      normalizedKey: string,
    ): Promise<UserId | null> {
      return activeClaim(kind, normalizedKey)?.userId ?? null;
    },

    async reserve(input): Promise<void> {
      const key = rowKey(input.kind, input.normalizedKey);
      const existing = table.get(key);
      const now = backend.clock.now();
      if (existing !== undefined) {
        if (existing.operationId === input.operationId) {
          if (existing.state === "reserved") {
            table.set(key, { ...existing, expiresAt: input.expiresAt });
          }
          return;
        }
        const reservationLapsed =
          existing.state === "reserved" &&
          existing.expiresAt !== null &&
          existing.expiresAt.getTime() <= now.getTime();
        if (!reservationLapsed) {
          throw heldByAnother(input.kind, input.normalizedKey);
        }
      }
      // A fresh row, so a fresh claim token — including when the same
      // operation id takes the key again after its previous claim was
      // released, since `release` removed the row entirely.
      table.set(key, {
        kind: input.kind,
        normalizedKey: input.normalizedKey,
        userId: input.userId,
        state: "reserved",
        operationId: input.operationId,
        expiresAt: input.expiresAt,
        userVersion: null,
        claimToken: backend.nextClaimToken(),
      });
    },

    async activate(
      operationId: string,
      expectedUserVersion: number,
    ): Promise<void> {
      const rows = rowsByOperation(operationId);
      if (rows.length === 0) {
        throw new ConflictError(
          "UNIQUE_RESERVATION_NOT_FOUND",
          `No reservation for operation ${operationId}`,
        );
      }
      // Conditional update: the durable claim may only be published on
      // top of the committed user row it belongs to. Every row is checked
      // before any is written so the operation stays all-or-nothing.
      for (const [, row] of rows) {
        const user = backend.users.get(row.userId);
        if (
          user === undefined ||
          (user.version as number) !== expectedUserVersion
        ) {
          throw new ConflictError(
            "OPTIMISTIC_LOCK_FAILURE",
            `User ${row.userId} is not at version ${expectedUserVersion}`,
          );
        }
      }
      for (const [key, row] of rows) {
        if (row.state === "active") {
          continue;
        }
        table.set(key, {
          ...row,
          state: "active",
          expiresAt: null,
          userVersion: expectedUserVersion,
        });
      }
    },

    async beginRelease(input): Promise<void> {
      const key = rowKey(input.kind, input.normalizedKey);
      const row = table.get(key);
      if (
        row === undefined ||
        row.state !== "active" ||
        row.userId !== input.expectedUserId ||
        row.claimToken !== input.expectedClaimToken
      ) {
        return;
      }
      // Re-keying to the releasing operation is what lets the paired
      // `release(operationId)` find the row: the reservation's original
      // operation id belongs to a past operation and cannot be re-derived.
      table.set(key, {
        ...row,
        state: "releasing",
        operationId: input.operationId,
        expiresAt: null,
      });
    },

    async release(operationId: string): Promise<void> {
      for (const [key, row] of rowsByOperation(operationId)) {
        if (row.state === "reserved" || row.state === "releasing") {
          table.delete(key);
        }
      }
    },
  };
}
