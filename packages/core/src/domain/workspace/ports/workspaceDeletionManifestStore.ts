import type { TokenHash, UserId } from "@repo/core/domain/identity/valueObject";
import type { InvitationId, MembershipId } from "../valueObject";

/**
 * One target fixed by the manifest, with the two acknowledgements it
 * needs before it can be compacted away.
 *
 * `key` is opaque and stable: unique within the operation, derived from
 * the item's kind and target id, and unchanged for the item's whole life
 * so an acknowledgement can name it after the row it describes is gone.
 * Compare it, never parse it.
 *
 * The payload carries the global route key next to the local id —
 * `userId` for the membership directory shard, `tokenHash` for the
 * invitation route shard — because global cleanup runs after the local
 * rows are deleted and could not re-derive either from source data that
 * no longer exists.
 */
export type WorkspaceDeletionManifestItem =
  | Readonly<{
      key: string;
      kind: "membership";
      userId: UserId;
      membershipId: MembershipId;
      localDeletedAt: Date | null;
      globalAckedAt: Date | null;
    }>
  | Readonly<{
      key: string;
      kind: "invitation";
      tokenHash: TokenHash;
      invitationId: InvitationId;
      localDeletedAt: Date | null;
      globalAckedAt: Date | null;
    }>;

/**
 * The work list of a workspace deletion, held in the **current workspace
 * scope**. Its header is created by
 * `WorkspaceOperationLockStore.beginDeletion` in the
 * same transaction that closes the scope, so the manifest exists from the
 * moment mutation stops.
 *
 * Four phases, each advancing 100 items at a time so no turn is unbounded:
 * fix the targets (`appendMembershipPage` / `appendInvitationPage` →
 * `markReady`), delete them locally (`listLocalPending` →
 * `acknowledgeLocal`), let the global orchestrator delete the directory
 * and route rows (`listItems` → `acknowledge`), then reclaim
 * (`compactAcknowledged` → `markCompleted`). A page's items, the header
 * cursor, and the continuation task that schedules the next turn are all
 * written in one unit of work, which is what makes a turn atomic: it
 * lands whole or not at all.
 *
 * Recovery is forward-only and reads only the manifest, never the source
 * data — by the time global cleanup runs, the rows it describes are
 * already deleted. Every method is idempotent for its operation, so a
 * lost response is repaired by repeating the call.
 *
 * The state guards observe the writes their own transaction has already
 * made. That is what lets a turn fix its last page and ready the
 * manifest, or reclaim its last page and complete it, without waiting for
 * the commit in between. A **paged** read (`listLocalPending`,
 * `listItems`, the compaction page) is the other way round: it must come
 * before this transaction writes to the manifest, because a page
 * recomputed from uncommitted changes can be short or misordered and a
 * backend is free to refuse it rather than answer. Every turn therefore
 * reads its page at the head and writes last.
 *
 * The manifest outlives the Workspace row: it is what
 * `assertWritable` / `assertDeletionOwner` read afterwards, and its
 * completed tombstone is retained at least as long as scope routing so a
 * write delayed past the deletion is refused permanently. This port never
 * prunes that tombstone.
 *
 * Error contract: `ConflictError` (state-machine violations — readying a
 * manifest whose targets are not fixed, completing one that still holds
 * items, touching a terminal manifest), `SystemError(DatabaseError)`.
 */
export interface WorkspaceDeletionManifestStore {
  /**
   * Fixes up to `limit` Memberships as items, reading the scope's own
   * rows in `membershipId` keyset order after `afterMembershipId`, and
   * advances the header's membership cursor in the same transaction —
   * so no membership can be skipped by a cursor that moved without its
   * page.
   *
   * `next` is the cursor for the following turn and `null` at the end;
   * `count` is how many items this page fixed.
   *
   * Idempotent on the item key, which makes resuming cheap and safe:
   * replaying a page fixes nothing new, and a caller that lost both the
   * response and its cursor may pass an older cursor — or `null` — and
   * simply re-walk. The scope has been closed to mutation since
   * `beginDeletion`, so a re-walk can only ever find the same set.
   */
  appendMembershipPage(
    operationId: string,
    afterMembershipId: MembershipId | null,
    limit: number,
  ): Promise<Readonly<{ next: MembershipId | null; count: number }>>;
  /**
   * The invitation half of the same walk, keyed on `invitationId` and
   * fixing each invitation's `tokenHash` as its global route key. Same
   * transaction rule, same idempotency, same safety in resuming from a
   * stale cursor.
   */
  appendInvitationPage(
    operationId: string,
    afterInvitationId: InvitationId | null,
    limit: number,
  ): Promise<Readonly<{ next: InvitationId | null; count: number }>>;
  /**
   * Declares the target set complete, moving the header from `building`.
   * Legal only once both walks reached their end; calling it earlier is a
   * `ConflictError`, since a manifest readied mid-walk would let deletion
   * finish while targets it never fixed survive.
   *
   * Idempotent: a header already at or past `ready` succeeds without
   * moving backwards. A completed manifest is a `ConflictError`.
   */
  markReady(operationId: string): Promise<void>;
  /**
   * Up to `limit` items with no `localDeletedAt`, in key order.
   *
   * A plain read with no claim and no lease — the deletion has a single
   * owner, enforced by `assertDeletionOwner`, so there is nothing to
   * claim against. Repeating it returns the same items until they are
   * acknowledged, which is exactly what a replayed turn needs.
   */
  listLocalPending(
    operationId: string,
    limit: number,
  ): Promise<readonly WorkspaceDeletionManifestItem[]>;
  /**
   * Stamps `localDeletedAt` on the named items.
   *
   * It must share the unit of work with the `deleteByIds` that actually
   * removed the rows: the delete and its acknowledgement then land or
   * fail together, and a lost response leaves a state the next turn can
   * read without consulting source data that may already be gone.
   *
   * Idempotent: an item already stamped keeps its first timestamp, and a
   * key that no longer exists — compacted away, or never part of this
   * manifest — is ignored rather than resurrected.
   */
  acknowledgeLocal(
    operationId: string,
    itemKeys: readonly string[],
  ): Promise<void>;
  /**
   * The global orchestrator's enumeration: items in key order with an
   * opaque `nextCursor`, `null` at the end.
   *
   * It does **not** filter out acknowledged items. The cursor walks the
   * full key order, so filtering would make a page's meaning depend on
   * acknowledgements landing concurrently; re-sending a delete for an
   * already-acknowledged item is a no-op on the target shard, which is
   * what makes the unfiltered walk safe. During a reshard the same item
   * is deleted in both generations.
   *
   * A pure read; the cursor is opaque, so compare it, never parse it.
   */
  listItems(
    operationId: string,
    cursor: string | null,
    limit: number,
  ): Promise<
    Readonly<{
      items: readonly WorkspaceDeletionManifestItem[];
      nextCursor: string | null;
    }>
  >;
  /**
   * Stamps `globalAckedAt` on the named items, recording that the
   * directory edge or invitation route they name is gone. Same
   * idempotency as `acknowledgeLocal`: first timestamp wins, unknown keys
   * are ignored.
   */
  acknowledge(operationId: string, itemKeys: readonly string[]): Promise<void>;
  /**
   * Reclaims at most `limit` items that carry **both** acknowledgements,
   * one page per turn.
   *
   * `removed` counts what this call deleted; `remaining` says whether any
   * item at all is still in the manifest — not just a compactable one —
   * because `markCompleted` needs zero items and the continuation must
   * keep re-registering while items await an acknowledgement they have
   * not received. A replay after a lost response simply compacts the next
   * page and may report `removed: 0`.
   *
   * Deliberately separate from the header transition: a manifest of
   * thousands of items must never be emptied in the transaction that
   * completes it.
   */
  compactAcknowledged(
    operationId: string,
    limit: number,
  ): Promise<Readonly<{ removed: number; remaining: boolean }>>;
  /**
   * Moves the header to its completed tombstone. Legal only when the
   * manifest holds zero items; anything left is a `ConflictError`.
   *
   * Idempotent: a header already completed succeeds without a second
   * transition, so a lost response cannot stamp the tombstone twice.
   *
   * After this the tombstone is the scope's whole memory: `assertWritable`
   * keeps rejecting late writes through it, and `assertDeletionOwner`
   * turns false so a redelivered continuation cannot restart cleanup.
   */
  markCompleted(operationId: string): Promise<void>;
}
