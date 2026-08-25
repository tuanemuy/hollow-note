import {
  type ScopeKey,
  ScopeKey as ScopeKeyOps,
} from "../../../application/scope";
import type { ScopeSqlExecutor } from "../sql/executor";
import type { SqlRow, SqlStatement } from "../sql/statement";
import { scopeObjectName } from "./scopeName";
import type { ScopeObject } from "./scopeObject";

export type ScopeObjectNamespace = DurableObjectNamespace<ScopeObject>;

/**
 * Worker-side handle on one scope object.
 *
 * Every read is an RPC round trip and every commit is exactly one more
 * ([ADR 002](../../../../../.thread/11/adr.md)). That asymmetry is
 * deliberate: the write path is bounded at one call per unit of work, so
 * the cost that can grow is the read path, and reducing it is a matter
 * of batching reads inside a repository — an optimisation, not a change
 * of contract.
 *
 * `objectNamespace` is empty in production and set by the conformance
 * factory to give each backend genuinely empty storage
 * ([ADR 004](../../../../../.thread/11/adr.md)).
 */
export function createScopeStubExecutor(
  namespace: ScopeObjectNamespace,
  scope: ScopeKey,
  objectNamespace = "",
): ScopeSqlExecutor {
  const scopeKey = ScopeKeyOps.serialize(scope);
  const stub = namespace.get(
    namespace.idFromName(scopeObjectName(scope, objectNamespace)),
  );
  return {
    async query(input: SqlStatement): Promise<readonly SqlRow[]> {
      return stub.query(scopeKey, input);
    },
    async apply(statements: readonly SqlStatement[]): Promise<void> {
      await stub.applyWriteSet(scopeKey, statements, []);
    },
    async applyWriteSet(
      statements: readonly SqlStatement[],
      touchedTables: readonly string[],
    ): Promise<void> {
      await stub.applyWriteSet(scopeKey, statements, touchedTables);
    },
  };
}
