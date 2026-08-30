import { ConflictError } from "../../../application/errors";
import type {
  WorkspaceDeletionManifestItem,
  WorkspaceDeletionManifestStore,
} from "../../../domain/workspace/ports/workspaceDeletionManifestStore";
import type {
  InvitationId,
  MembershipId,
} from "../../../domain/workspace/valueObject";
import type {
  ScopeStore,
  WorkspaceDeletionManifestHeaderRow,
  WorkspaceDeletionManifestItemRow,
} from "../store";
import { compareStrings } from "../support";

const PAGE_LIMIT = 100;

const membershipKey = (id: MembershipId): string => `membership:${id}`;
const invitationKey = (id: InvitationId): string => `invitation:${id}`;

const itemTableKey = (operationId: string, key: string): string =>
  `${operationId} ${key}`;

const stateViolation = (operationId: string, detail: string): ConflictError =>
  new ConflictError(
    "WORKSPACE_DELETION_MANIFEST_STATE_VIOLATION",
    `Manifest ${operationId}: ${detail}`,
  );

const toPublicItem = (
  row: WorkspaceDeletionManifestItemRow,
): WorkspaceDeletionManifestItem =>
  row.kind === "membership"
    ? {
        key: row.key,
        kind: "membership",
        userId: row.userId,
        membershipId: row.membershipId,
        localDeletedAt: row.localDeletedAt,
        globalAckedAt: row.globalAckedAt,
      }
    : {
        key: row.key,
        kind: "invitation",
        tokenHash: row.tokenHash,
        invitationId: row.invitationId,
        localDeletedAt: row.localDeletedAt,
        globalAckedAt: row.globalAckedAt,
      };

export function createMemoryWorkspaceDeletionManifestStore(
  scope: ScopeStore,
  now: () => Date,
): WorkspaceDeletionManifestStore {
  const headers = scope.deletionManifestHeaders;
  const items = scope.deletionManifestItems;

  const requireHeader = (
    operationId: string,
  ): WorkspaceDeletionManifestHeaderRow => {
    const header = headers.get(operationId);
    if (header === undefined) {
      throw stateViolation(operationId, "manifest does not exist");
    }
    return header;
  };

  const requireOpenHeader = (
    operationId: string,
  ): WorkspaceDeletionManifestHeaderRow => {
    const header = requireHeader(operationId);
    if (header.state === "completed") {
      throw stateViolation(operationId, "manifest is a completed tombstone");
    }
    return header;
  };

  const itemsOf = (
    operationId: string,
  ): readonly WorkspaceDeletionManifestItemRow[] =>
    items
      .values()
      .filter((row) => row.operationId === operationId)
      .sort((a, b) => compareStrings(a.key, b.key));

  const boundedLimit = (limit: number): number =>
    Math.min(Math.max(0, limit), PAGE_LIMIT);

  const stamp = (
    operationId: string,
    itemKeys: readonly string[],
    field: "localDeletedAt" | "globalAckedAt",
  ): void => {
    requireHeader(operationId);
    const at = now();
    for (const key of itemKeys) {
      const tableKey = itemTableKey(operationId, key);
      const row = items.get(tableKey);
      // A key that no longer exists — compacted away, or never part of
      // this manifest — is ignored rather than resurrected.
      if (row === undefined || row[field] !== null) {
        continue;
      }
      items.set(
        tableKey,
        field === "localDeletedAt"
          ? { ...row, localDeletedAt: at }
          : { ...row, globalAckedAt: at },
      );
    }
  };

  return {
    async appendMembershipPage(
      operationId: string,
      afterMembershipId: MembershipId | null,
      limit: number,
    ): Promise<Readonly<{ next: MembershipId | null; count: number }>> {
      const header = requireOpenHeader(operationId);
      const remaining = scope.memberships
        .values()
        .filter(
          (row) => afterMembershipId === null || row.id > afterMembershipId,
        )
        .sort((a, b) => compareStrings(a.id, b.id));
      const page = remaining.slice(0, boundedLimit(limit));
      for (const membership of page) {
        const key = membershipKey(membership.id);
        const tableKey = itemTableKey(operationId, key);
        if (!items.has(tableKey)) {
          items.set(tableKey, {
            operationId,
            key,
            kind: "membership",
            userId: membership.userId,
            membershipId: membership.id,
            localDeletedAt: null,
            globalAckedAt: null,
          });
        }
      }
      const last = page[page.length - 1];
      const next =
        remaining.length > page.length && last !== undefined ? last.id : null;
      headers.set(operationId, { ...header, membershipCursor: next });
      return { next, count: page.length };
    },

    async appendInvitationPage(
      operationId: string,
      afterInvitationId: InvitationId | null,
      limit: number,
    ): Promise<Readonly<{ next: InvitationId | null; count: number }>> {
      const header = requireOpenHeader(operationId);
      const remaining = scope.invitations
        .values()
        .filter(
          (row) => afterInvitationId === null || row.id > afterInvitationId,
        )
        .sort((a, b) => compareStrings(a.id, b.id));
      const page = remaining.slice(0, boundedLimit(limit));
      for (const invitation of page) {
        const key = invitationKey(invitation.id);
        const tableKey = itemTableKey(operationId, key);
        if (!items.has(tableKey)) {
          items.set(tableKey, {
            operationId,
            key,
            kind: "invitation",
            tokenHash: invitation.tokenHash,
            invitationId: invitation.id,
            localDeletedAt: null,
            globalAckedAt: null,
          });
        }
      }
      const last = page[page.length - 1];
      const next =
        remaining.length > page.length && last !== undefined ? last.id : null;
      headers.set(operationId, { ...header, invitationCursor: next });
      return { next, count: page.length };
    },

    async markReady(operationId: string): Promise<void> {
      const header = requireOpenHeader(operationId);
      if (header.state === "ready") {
        return;
      }
      // "Both walks reached their end" read as the property it protects:
      // every target the closed scope still holds is fixed as an item.
      // The scope stopped accepting mutation at `beginDeletion`, so this
      // is stable, and it holds however the walks were resumed.
      const fixed = new Set(itemsOf(operationId).map((row) => row.key));
      const unfixed =
        scope.memberships
          .values()
          .some((row) => !fixed.has(membershipKey(row.id))) ||
        scope.invitations
          .values()
          .some((row) => !fixed.has(invitationKey(row.id)));
      if (unfixed) {
        throw stateViolation(operationId, "targets are not fixed yet");
      }
      headers.set(operationId, { ...header, state: "ready" });
    },

    async listLocalPending(
      operationId: string,
      limit: number,
    ): Promise<readonly WorkspaceDeletionManifestItem[]> {
      requireHeader(operationId);
      return itemsOf(operationId)
        .filter((row) => row.localDeletedAt === null)
        .slice(0, boundedLimit(limit))
        .map(toPublicItem);
    },

    async acknowledgeLocal(
      operationId: string,
      itemKeys: readonly string[],
    ): Promise<void> {
      stamp(operationId, itemKeys, "localDeletedAt");
    },

    async listItems(
      operationId: string,
      cursor: string | null,
      limit: number,
    ): Promise<
      Readonly<{
        items: readonly WorkspaceDeletionManifestItem[];
        nextCursor: string | null;
      }>
    > {
      requireHeader(operationId);
      // Deliberately unfiltered by acknowledgement: the cursor walks the
      // full key order, and re-sending a delete for an acknowledged item
      // is a no-op on the target shard.
      const remaining = itemsOf(operationId).filter(
        (row) => cursor === null || row.key > cursor,
      );
      const page = remaining.slice(0, boundedLimit(limit));
      const last = page[page.length - 1];
      return {
        items: page.map(toPublicItem),
        nextCursor:
          remaining.length > page.length && last !== undefined
            ? last.key
            : null,
      };
    },

    async acknowledge(
      operationId: string,
      itemKeys: readonly string[],
    ): Promise<void> {
      stamp(operationId, itemKeys, "globalAckedAt");
    },

    async compactAcknowledged(
      operationId: string,
      limit: number,
    ): Promise<Readonly<{ removed: number; remaining: boolean }>> {
      requireHeader(operationId);
      const compactable = itemsOf(operationId)
        .filter(
          (row) => row.localDeletedAt !== null && row.globalAckedAt !== null,
        )
        .slice(0, boundedLimit(limit));
      for (const row of compactable) {
        items.delete(itemTableKey(operationId, row.key));
      }
      return {
        removed: compactable.length,
        // Any item at all, not just a compactable one: the continuation
        // must keep re-registering while items await an acknowledgement.
        remaining: itemsOf(operationId).length > 0,
      };
    },

    async markCompleted(operationId: string): Promise<void> {
      const header = requireHeader(operationId);
      if (header.state === "completed") {
        return;
      }
      if (itemsOf(operationId).length > 0) {
        throw stateViolation(operationId, "manifest still holds items");
      }
      headers.set(operationId, { ...header, state: "completed" });
    },
  };
}
