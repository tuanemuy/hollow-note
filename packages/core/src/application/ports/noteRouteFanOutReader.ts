import type { ShardPage } from "@repo/core/domain/common/pagination";
import type { UserId } from "@repo/core/domain/identity/valueObject";
import type { ScopeKey } from "../scope";
import type { NoteRoute } from "./noteRouteStore";

/**
 * The single secondary-key scan over the NoteId-hash route placement.
 * `limit` is a whole-scan cap (max 200 across all shards); shards are
 * read in bounded waves and merged in NoteId order. Cursors are signed
 * opaque values carrying the query kind / fingerprint, shard generation,
 * and per-shard `afterNoteId` keyset positions — every shard's position
 * advances (including empty shards), so author / scope fan-out and
 * account-deletion target fixing resume without gaps. During a reshard
 * both generations are read, deduplicated by NoteId with the higher
 * routeVersion winning.
 *
 * Error contract: `ValidationError("INVALID_PAGINATION")` (tampered /
 * retired cursor), `SystemError(DatabaseError)`.
 */
export interface NoteRouteFanOutReader {
  listByCreatedBy(
    userId: UserId,
    cursor: string | null,
    limit: number,
  ): Promise<ShardPage<NoteRoute>>;
  listByScope(
    scope: ScopeKey,
    cursor: string | null,
    limit: number,
  ): Promise<ShardPage<NoteRoute>>;
}
