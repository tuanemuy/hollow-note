import {
  type ScopeKey,
  ScopeKey as ScopeKeyOps,
} from "../../../application/scope";
import type { ScopeSqlExecutor } from "../sql/executor";
import { assertBindable } from "../sql/json";
import type { SqlRow, SqlStatement } from "../sql/statement";
import { scopeObjectName } from "./scopeName";
import type { ScopeObject } from "./scopeObject";

export type ScopeObjectNamespace = DurableObjectNamespace<ScopeObject>;

/**
 * Worker-side handle on one scope object.
 *
 * Every read is an RPC round trip and every commit is exactly one more.
 * That asymmetry is deliberate: a unit of work's callback cannot cross
 * the RPC boundary, so it runs here and its reads travel one at a time,
 * while the whole finished write-set travels in a single call. The cost
 * that can grow is therefore the read path, and reducing it is a matter
 * of batching reads inside a repository — an optimisation, not a change
 * of contract.
 *
 * `objectNamespace` is empty in production and set by the conformance
 * factory to give each backend genuinely empty storage: a new namespace
 * yields a new object name, and a new name is a new object.
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
  // Checked before the RPC as well as inside the object, so a statement
  // over the binding limit names the repository that built it rather
  // than surfacing from the far side of a Durable Object call.
  return {
    async query(input: SqlStatement): Promise<readonly SqlRow[]> {
      return stub.query(scopeKey, assertBindable(input));
    },
    async apply(statements: readonly SqlStatement[]): Promise<void> {
      await stub.applyWriteSet(scopeKey, statements.map(assertBindable), []);
    },
    async applyWriteSet(
      statements: readonly SqlStatement[],
      touchedTables: readonly string[],
    ): Promise<void> {
      await stub.applyWriteSet(
        scopeKey,
        statements.map(assertBindable),
        touchedTables,
      );
    },
  };
}
