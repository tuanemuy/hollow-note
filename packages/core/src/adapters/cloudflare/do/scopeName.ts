import {
  type ScopeKey,
  ScopeKey as ScopeKeyOps,
} from "../../../application/scope";
import type { UserId } from "../../../domain/identity/valueObject";
import type { WorkspaceId } from "../../../domain/workspace/valueObject";
import { dataIntegrityError } from "../sql/errors";

/**
 * Naming and column encoding of a scope object.
 *
 * The canonical name is `ScopeKey.serialize` — `user:{userId}` /
 * `workspace:{workspaceId}` (`spec/platform/index.md`「ScopeKey と Durable
 * Object」) — so the same scope resolves to the same object from a
 * request, a queue consumer or an alarm.
 *
 * `namespace` is a prefix that is always applied and is empty in
 * production. It exists because the workers test pool isolates storage
 * per **file**, not per test, while the conformance suites contract for
 * a fresh backend per test: a new namespace yields a new object name and
 * therefore genuinely empty storage. Keeping it an argument rather than
 * a branch means production takes the same code path.
 */
export const scopeObjectName = (scope: ScopeKey, namespace: string): string =>
  namespace === ""
    ? ScopeKeyOps.serialize(scope)
    : `${namespace}/${ScopeKeyOps.serialize(scope)}`;

/** Columns every scope table carries for the `scope 検証` rule. */
export const scopeColumns = (
  scope: ScopeKey,
): Readonly<{ type: "user" | "workspace"; id: string }> =>
  scope.type === "user"
    ? { type: "user", id: scope.userId }
    : { type: "workspace", id: scope.workspaceId };

export const scopeFromColumns = (type: string, id: string): ScopeKey => {
  if (type === "user") {
    return ScopeKeyOps.user(id as UserId);
  }
  if (type === "workspace") {
    return ScopeKeyOps.workspace(id as WorkspaceId);
  }
  throw dataIntegrityError(`Unknown scope type ${type}`);
};

/** Splits `user:{id}` / `workspace:{id}` back into its two columns. */
export const scopeColumnsFromName = (
  serialized: string,
): Readonly<{ type: "user" | "workspace"; id: string }> => {
  const separator = serialized.indexOf(":");
  const type = serialized.slice(0, separator);
  if (separator < 0 || (type !== "user" && type !== "workspace")) {
    throw dataIntegrityError(`Malformed scope key ${serialized}`);
  }
  return { type, id: serialized.slice(separator + 1) };
};
