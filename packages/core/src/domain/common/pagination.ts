/** Request shape for paginated reads. `page` is 1-indexed. */
export type Pagination = Readonly<{
  page: number;
  limit: number;
}>;

/** `count` is the total matching rows, not just the current page size. */
export type PaginationResult<T> = Readonly<{
  items: readonly T[];
  count: number;
}>;

/**
 * Keyset-cursor page for shard-spanning reads. `nextCursor` is an opaque
 * (usually signed) cursor; `null` means the enumeration is exhausted.
 */
export type ShardPage<T> = Readonly<{
  items: readonly T[];
  nextCursor: string | null;
}>;

/**
 * Result of one bounded pass of an expiry sweep (`deleteExpired` /
 * `pruneTerminal` style methods). Cursors are keyset cursors — never
 * OFFSETs — so concurrent deletions ahead of the cursor cannot skip rows.
 */
export type PrunePage = Readonly<{
  deleted: number;
  nextCursor: string | null;
}>;
