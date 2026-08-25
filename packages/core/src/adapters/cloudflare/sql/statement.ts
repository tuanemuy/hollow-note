/**
 * The wire shape every Cloudflare adapter speaks.
 *
 * A statement is plain data — SQL text plus positional bindings — and
 * nothing else. That is deliberate: the scope plane ships whole
 * write-sets to a Durable Object over RPC ([ADR 002](../../../../../.thread/11/adr.md)),
 * so a statement has to survive structured clone. Never put a closure,
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
