import {
  ConflictError,
  SystemError,
  SystemErrorCode,
} from "../../../application/errors";

/**
 * Constraint classes a SQLite-backed driver (D1 or `ctx.storage.sql`)
 * can report. Adapters branch on this rather than on driver message
 * text, so the translation of a driver failure into the shared error
 * contracts happens in exactly one place (CLAUDE.md, adapter → application).
 */
export type SqlFailureKind =
  | "occGuard"
  | "unique"
  | "check"
  | "notNull"
  | "foreignKey"
  | "unknown";

/**
 * Name of the CHECK constraint `occGuard()` trips. Kept in one place so
 * the DDL and the classifier cannot drift apart.
 */
export const OCC_GUARD_CONSTRAINT = "_occ_guard_conflict";

const messageOf = (error: unknown): string =>
  error instanceof Error ? `${error.message}` : String(error);

/**
 * Classifies a thrown driver error. `occGuard` is the write-set's
 * optimistic-concurrency trip wire (`./occGuard.ts`) and takes
 * precedence over the plain `check` it is built from.
 */
export function classifySqlError(error: unknown): SqlFailureKind {
  const message = messageOf(error);
  if (message.includes(OCC_GUARD_CONSTRAINT)) {
    return "occGuard";
  }
  if (message.includes("UNIQUE constraint failed")) {
    return "unique";
  }
  if (message.includes("CHECK constraint failed")) {
    return "check";
  }
  if (message.includes("NOT NULL constraint failed")) {
    return "notNull";
  }
  if (message.includes("FOREIGN KEY constraint failed")) {
    return "foreignKey";
  }
  return "unknown";
}

export const databaseError = (context: string, cause?: unknown): SystemError =>
  new SystemError(
    SystemErrorCode.DatabaseError,
    `${context}: ${messageOf(cause)}`,
    cause,
  );

export const dataIntegrityError = (message: string): SystemError =>
  new SystemError(SystemErrorCode.DataIntegrityError, message);

export const optimisticLockFailure = (context: string): ConflictError =>
  new ConflictError(
    "OPTIMISTIC_LOCK_FAILURE",
    `Version mismatch while writing ${context}`,
  );

/**
 * Default translation at the driver boundary: a tripped OCC guard is a
 * lost optimistic-lock race, everything else is a database fault.
 *
 * A repository that gives a constraint its own meaning — a unique
 * violation that means "somebody already claimed this", say — calls
 * `classifySqlError` and decides for itself instead of using this.
 */
export function throwTranslated(context: string, cause: unknown): never {
  if (classifySqlError(cause) === "occGuard") {
    throw optimisticLockFailure(context);
  }
  throw databaseError(context, cause);
}
