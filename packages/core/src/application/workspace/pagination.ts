import type { Pagination } from "@repo/core/domain/common/pagination";
import { ValidationError } from "../errors";

/**
 * Offset-paging convention shared by every listing usecase
 * (spec/usecases/identity.md 冒頭): `page` is 1-indexed and `limit` is
 * 1–100. The upper bound is also what keeps a page within the 100-id cap
 * of the batch readers a listing resolves its display data through.
 *
 * Out-of-range values are rejected rather than clamped: a caller that
 * asked for a page that does not exist gets a decision, not a silently
 * different page.
 */
export const MAX_PAGE_LIMIT = 100;

export const resolvePagination = (
  input: Readonly<{ page?: number; limit?: number }>,
  defaultLimit: number,
): Pagination => {
  const page = input.page ?? 1;
  const limit = input.limit ?? defaultLimit;
  if (!Number.isInteger(page) || page < 1) {
    throw new ValidationError("INVALID_PAGINATION", "page must be at least 1");
  }
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_PAGE_LIMIT) {
    throw new ValidationError(
      "INVALID_PAGINATION",
      `limit must be between 1 and ${MAX_PAGE_LIMIT}`,
    );
  }
  return { page, limit };
};
