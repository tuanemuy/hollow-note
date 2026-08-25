/**
 * The wire shape every Cloudflare adapter speaks.
 *
 * A statement is plain data — SQL text plus positional bindings — and
 * nothing else. That is deliberate: the scope plane ships whole
 * write-sets to a Durable Object over RPC, so a statement has to survive
 * structured clone. Never put a closure,
 * a `Date`, or a domain object in one; encode with the helpers in
 * `./row.ts` first.
 */
export type SqlValue = string | number | null | ArrayBuffer;

/** One row as the driver returns it. Column names are the SQL aliases. */
export type SqlRow = Readonly<Record<string, SqlValue>>;

export type SqlStatement = Readonly<{
  sql: string;
  params: readonly SqlValue[];
}>;

export const statement = (
  sql: string,
  ...params: readonly SqlValue[]
): SqlStatement => ({ sql, params });

/**
 * Both planes cap positional bindings at 100
 * (`spec/platform/index.md` 実上限). Anything that binds a list must go
 * through `./json.ts` instead of spreading `?` per element; this guard
 * turns a violation into a `SystemError` at the call site rather than a
 * driver error deep inside a batch.
 */
export const MAX_BOUND_PARAMETERS = 100;

/**
 * How many statements one global-plane commit may carry.
 *
 * A commit is exactly one D1 `batch()`, and every statement in it spends
 * one query from the 500 a Worker invocation is allowed
 * (`spec/platform/index.md`「実行予算と分割単位」→ Global D1). Half of
 * that budget is reserved here for the commit; the reads that produced
 * the write-set need the other half. The OCC guards that double a
 * commit's statement count are counted inside this number, not on top of
 * it.
 *
 * The scope plane has no equivalent cap because D1's query count does
 * not apply to a Durable Object's own storage; what bounds a scope
 * commit is the per-turn row limits the same spec section sets.
 */
export const MAX_STATEMENTS_PER_COMMIT = 250;
