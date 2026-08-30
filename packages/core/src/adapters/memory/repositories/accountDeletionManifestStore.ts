import { ConflictError } from "../../../application/errors";
import type {
  AccountDeletionAckPhase,
  AccountDeletionAuthorRoute,
  AccountDeletionManifestHeader,
  AccountDeletionManifestItem,
  AccountDeletionManifestStore,
  AccountDeletionPhase,
  AccountDeletionReceipt,
} from "../../../application/ports/accountDeletionManifestStore";
import type { UserId } from "../../../domain/identity/valueObject";
import { NoteId } from "../../../domain/note/valueObject";
import type {
  ManifestAuthorRouteItemRow,
  ManifestHeaderRow,
  ManifestItemRow,
  ManifestMembershipItemRow,
  MembershipDirectoryRow,
  MemoryBackend,
} from "../store";
import { clone, compareStrings } from "../support";

const PAGE_LIMIT = 100;

type SettledEdge = ManifestMembershipItemRow["edgeState"];

const ALL_FINALIZE_RECEIPTS: readonly AccountDeletionReceipt[] = [
  "personalCleanup",
  "authResidue",
  "externalConnections",
  "jobHistory",
  "uniquenessRelease",
];

export type MemoryAccountDeletionManifestOptions = Readonly<{
  /**
   * Receipts finalize waits for. Defaults to every non-rollback receipt
   * — the strictest reading — so a deployment that forgets to declare
   * its participants stalls instead of finalizing early.
   */
  requiredFinalizeReceipts?: readonly AccountDeletionReceipt[];
}>;

const itemTableKey = (operationId: string, itemKey: string): string =>
  `${operationId} ${itemKey}`;

const stateViolation = (operationId: string, detail: string): ConflictError =>
  new ConflictError(
    "ACCOUNT_DELETION_MANIFEST_STATE_VIOLATION",
    `Manifest ${operationId}: ${detail}`,
  );

const membershipFullyAcked = (item: ManifestMembershipItemRow): boolean =>
  item.prepareAckedAt !== null && item.cleanupAckedAt !== null;

const membershipReleased = (item: ManifestMembershipItemRow): boolean =>
  item.prepareDispatchedAt === null || item.releaseAckedAt !== null;

const authorRouteFullyAcked = (item: ManifestAuthorRouteItemRow): boolean =>
  item.localRedactionAckedAt !== null && item.publicRedactionAckedAt !== null;

export function createMemoryAccountDeletionManifestStore(
  backend: MemoryBackend,
  options: MemoryAccountDeletionManifestOptions = {},
): AccountDeletionManifestStore {
  const headers = backend.manifestHeaders;
  const items = backend.manifestItems;
  const requiredReceipts =
    options.requiredFinalizeReceipts ?? ALL_FINALIZE_RECEIPTS;

  const requireHeader = (operationId: string): ManifestHeaderRow => {
    const header = headers.get(operationId);
    if (header === undefined) {
      throw stateViolation(operationId, "manifest does not exist");
    }
    return header;
  };

  const itemsOf = (operationId: string): readonly ManifestItemRow[] =>
    items
      .values()
      .filter((item) => item.operationId === operationId)
      .sort((a, b) => compareStrings(a.key, b.key));

  const membershipItems = (
    operationId: string,
  ): readonly ManifestMembershipItemRow[] =>
    itemsOf(operationId).filter(
      (item): item is ManifestMembershipItemRow => item.kind === "membership",
    );

  const authorRouteItems = (
    operationId: string,
  ): readonly ManifestAuthorRouteItemRow[] =>
    itemsOf(operationId).filter(
      (item): item is ManifestAuthorRouteItemRow => item.kind === "authorRoute",
    );

  const toPublicItem = (item: ManifestItemRow): AccountDeletionManifestItem =>
    item.kind === "membership"
      ? {
          key: item.key,
          kind: "membership",
          workspaceId: item.workspaceId,
          edgeState: item.edgeState,
          membershipId: item.membershipId,
          prepareCommandKey: item.prepareCommandKey,
          prepareDispatchedAt: item.prepareDispatchedAt,
          prepareAckedAt: item.prepareAckedAt,
          releaseCommandKey: item.releaseCommandKey,
          releaseDispatchedAt: item.releaseDispatchedAt,
          releaseAckedAt: item.releaseAckedAt,
          cleanupAckedAt: item.cleanupAckedAt,
        }
      : {
          key: item.key,
          kind: "authorRoute",
          noteId: NoteId.create(item.noteId),
          routeVersion: item.routeVersion,
          localRedactionAckedAt: item.localRedactionAckedAt,
          publicRedactionAckedAt: item.publicRedactionAckedAt,
        };

  const allRollbackReleased = (operationId: string): boolean =>
    membershipItems(operationId).every(membershipReleased);

  const allRequiredAcknowledged = (operationId: string): boolean => {
    const header = requireHeader(operationId);
    return (
      membershipItems(operationId).every(membershipFullyAcked) &&
      authorRouteItems(operationId).every(authorRouteFullyAcked) &&
      requiredReceipts.every((receipt) => header.receipts.includes(receipt))
    );
  };

  return {
    async describe(
      operationId: string,
    ): Promise<AccountDeletionManifestHeader | null> {
      const header = headers.get(operationId);
      return header === undefined ? null : clone(header);
    },

    async begin(operationId: string, userId: UserId): Promise<void> {
      if (headers.has(operationId)) {
        return;
      }
      headers.set(operationId, {
        operationId,
        userId,
        status: "building",
        membershipCursor: null,
        authorRouteCursor: null,
        receipts: [],
        terminalAt: null,
        retainUntil: null,
      });
    },

    async appendMembershipPage(
      operationId: string,
      afterEdgeKey: string | null,
      limit: number,
    ): Promise<Readonly<{ count: number; nextCursor: string | null }>> {
      const header = requireHeader(operationId);
      if (header.status !== "building") {
        throw stateViolation(operationId, "membership pages require building");
      }
      const effectiveLimit = Math.min(Math.max(0, limit), PAGE_LIMIT);
      const edges = backend.membershipEdges
        .values()
        .filter(
          // `activating` edges are excluded by the contract, not by
          // convenience: a deletion drains them to zero through
          // `listActivatingByUser` before it fixes its manifest, so an
          // edge still claimed by a join has no settled state to record.
          (edge): edge is MembershipDirectoryRow & { edgeState: SettledEdge } =>
            edge.userId === header.userId &&
            edge.edgeState !== "activating" &&
            (afterEdgeKey === null || edge.edgeKey > afterEdgeKey),
        )
        .sort((a, b) => compareStrings(a.edgeKey, b.edgeKey));
      const page = edges.slice(0, effectiveLimit);
      for (const edge of page) {
        const key = `membership:${edge.edgeKey}`;
        const tableKey = itemTableKey(operationId, key);
        if (!items.has(tableKey)) {
          items.set(tableKey, {
            operationId,
            key,
            kind: "membership",
            workspaceId: edge.workspaceId,
            edgeState: edge.edgeState,
            membershipId: edge.membershipId,
            prepareCommandKey: null,
            prepareDispatchedAt: null,
            prepareAckedAt: null,
            releaseCommandKey: null,
            releaseDispatchedAt: null,
            releaseAckedAt: null,
            cleanupAckedAt: null,
          });
        }
      }
      const last = page[page.length - 1];
      const nextCursor =
        edges.length > page.length && last !== undefined ? last.edgeKey : null;
      headers.set(operationId, { ...header, membershipCursor: nextCursor });
      return { count: page.length, nextCursor };
    },

    async appendAuthorRoutePage(
      operationId: string,
      routes: readonly AccountDeletionAuthorRoute[],
      nextCursor: string | null,
    ): Promise<void> {
      const header = requireHeader(operationId);
      if (header.status !== "building") {
        throw stateViolation(
          operationId,
          "author-route pages require building",
        );
      }
      for (const route of routes) {
        const key = `authorRoute:${route.noteId}`;
        const tableKey = itemTableKey(operationId, key);
        if (!items.has(tableKey)) {
          items.set(tableKey, {
            operationId,
            key,
            kind: "authorRoute",
            noteId: route.noteId,
            routeVersion: route.routeVersion,
            localRedactionAckedAt: null,
            publicRedactionAckedAt: null,
          });
        }
      }
      headers.set(operationId, { ...header, authorRouteCursor: nextCursor });
    },

    async markBuilt(operationId: string): Promise<void> {
      const header = requireHeader(operationId);
      if (header.status === "built") {
        return;
      }
      if (header.status !== "building") {
        throw stateViolation(operationId, `cannot mark ${header.status} built`);
      }
      headers.set(operationId, { ...header, status: "built" });
    },

    async beginRollback(operationId: string): Promise<void> {
      const header = requireHeader(operationId);
      if (header.status === "rollingBack") {
        return;
      }
      if (header.status !== "built") {
        throw stateViolation(
          operationId,
          `cannot roll back from ${header.status}`,
        );
      }
      headers.set(operationId, { ...header, status: "rollingBack" });
    },

    async claimPending(
      operationId: string,
      phase: AccountDeletionPhase,
      limit: number,
    ): Promise<readonly AccountDeletionManifestItem[]> {
      const header = requireHeader(operationId);
      const requiredStatus = phase === "release" ? "rollingBack" : "built";
      if (header.status !== requiredStatus) {
        throw stateViolation(
          operationId,
          `phase ${phase} requires ${requiredStatus}, was ${header.status}`,
        );
      }
      const effectiveLimit = Math.min(Math.max(0, limit), PAGE_LIMIT);
      const now = backend.clock.now();
      const claimed: AccountDeletionManifestItem[] = [];
      if (phase === "redaction") {
        for (const item of authorRouteItems(operationId)) {
          if (claimed.length >= effectiveLimit) {
            break;
          }
          if (!authorRouteFullyAcked(item)) {
            claimed.push(toPublicItem(item));
          }
        }
        return claimed;
      }
      for (const item of membershipItems(operationId)) {
        if (claimed.length >= effectiveLimit) {
          break;
        }
        const tableKey = itemTableKey(operationId, item.key);
        if (phase === "prepare" && item.prepareAckedAt === null) {
          const next: ManifestMembershipItemRow = {
            ...item,
            prepareCommandKey:
              item.prepareCommandKey ?? `${operationId}:prepare:${item.key}`,
            prepareDispatchedAt: item.prepareDispatchedAt ?? now,
          };
          items.set(tableKey, next);
          claimed.push(toPublicItem(next));
        } else if (
          phase === "release" &&
          item.prepareDispatchedAt !== null &&
          item.releaseAckedAt === null
        ) {
          const next: ManifestMembershipItemRow = {
            ...item,
            releaseCommandKey:
              item.releaseCommandKey ?? `${operationId}:release:${item.key}`,
            releaseDispatchedAt: item.releaseDispatchedAt ?? now,
          };
          items.set(tableKey, next);
          claimed.push(toPublicItem(next));
        } else if (phase === "cleanup" && item.cleanupAckedAt === null) {
          claimed.push(toPublicItem(item));
        }
      }
      return claimed;
    },

    async acknowledge(
      operationId: string,
      itemKeys: readonly string[],
      phase: AccountDeletionAckPhase,
    ): Promise<void> {
      requireHeader(operationId);
      const now = backend.clock.now();
      for (const key of itemKeys) {
        const tableKey = itemTableKey(operationId, key);
        const item = items.get(tableKey);
        if (item === undefined) {
          continue;
        }
        if (item.kind === "membership") {
          if (phase === "prepare" && item.prepareAckedAt === null) {
            items.set(tableKey, { ...item, prepareAckedAt: now });
          } else if (phase === "release" && item.releaseAckedAt === null) {
            items.set(tableKey, { ...item, releaseAckedAt: now });
          } else if (phase === "cleanup" && item.cleanupAckedAt === null) {
            items.set(tableKey, { ...item, cleanupAckedAt: now });
          }
        } else {
          if (
            phase === "localRedaction" &&
            item.localRedactionAckedAt === null
          ) {
            items.set(tableKey, { ...item, localRedactionAckedAt: now });
          } else if (
            phase === "publicRedaction" &&
            item.publicRedactionAckedAt === null
          ) {
            items.set(tableKey, { ...item, publicRedactionAckedAt: now });
          }
        }
      }
    },

    async acknowledgeReceipt(
      operationId: string,
      receipt: AccountDeletionReceipt,
    ): Promise<void> {
      const header = requireHeader(operationId);
      if (header.receipts.includes(receipt)) {
        return;
      }
      headers.set(operationId, {
        ...header,
        receipts: [...header.receipts, receipt],
      });
    },

    async allRollbackReleased(operationId: string): Promise<boolean> {
      requireHeader(operationId);
      return allRollbackReleased(operationId);
    },

    async allRequiredAcknowledged(operationId: string): Promise<boolean> {
      return allRequiredAcknowledged(operationId);
    },

    async compactItems(
      operationId: string,
      limit: number,
    ): Promise<Readonly<{ removed: number; remaining: boolean }>> {
      const header = requireHeader(operationId);
      const rollback =
        header.status === "rollingBack" || header.status === "rejected";
      const success =
        header.status === "built" || header.status === "completed";
      if (!rollback && !success) {
        throw stateViolation(operationId, "compaction requires a settled path");
      }
      if (rollback && !allRollbackReleased(operationId)) {
        throw stateViolation(
          operationId,
          "compaction requires every release ack",
        );
      }
      if (success && !allRequiredAcknowledged(operationId)) {
        throw stateViolation(
          operationId,
          "compaction requires every finalize ack",
        );
      }
      const effectiveLimit = Math.min(Math.max(0, limit), PAGE_LIMIT);
      const removable = itemsOf(operationId).slice(0, effectiveLimit);
      for (const item of removable) {
        items.delete(itemTableKey(operationId, item.key));
      }
      return {
        removed: removable.length,
        remaining: itemsOf(operationId).length > 0,
      };
    },

    async markCompleted(
      operationId: string,
      terminalAt: Date,
      retainUntil: Date,
    ): Promise<void> {
      const header = requireHeader(operationId);
      if (header.status === "completed") {
        return;
      }
      if (header.status !== "built") {
        throw stateViolation(
          operationId,
          `cannot complete from ${header.status}`,
        );
      }
      if (!allRequiredAcknowledged(operationId)) {
        throw stateViolation(operationId, "finalize acks are incomplete");
      }
      headers.set(operationId, {
        ...header,
        status: "completed",
        terminalAt,
        retainUntil,
      });
    },

    async markRejected(
      operationId: string,
      terminalAt: Date,
      retainUntil: Date,
    ): Promise<void> {
      const header = requireHeader(operationId);
      if (header.status === "rejected") {
        return;
      }
      if (header.status !== "rollingBack") {
        throw stateViolation(
          operationId,
          `cannot reject from ${header.status}`,
        );
      }
      if (!allRollbackReleased(operationId)) {
        throw stateViolation(operationId, "release acks are incomplete");
      }
      headers.set(operationId, {
        ...header,
        status: "rejected",
        terminalAt,
        retainUntil,
      });
    },

    async pruneTerminal(
      asOf: Date,
      cursor: string | null,
      limit: number,
    ): Promise<
      Readonly<{ operationIds: readonly string[]; nextCursor: string | null }>
    > {
      const effectiveLimit = Math.min(Math.max(0, limit), PAGE_LIMIT);
      const reclaimable = headers
        .values()
        .filter(
          (header) =>
            (header.status === "completed" || header.status === "rejected") &&
            header.retainUntil !== null &&
            header.retainUntil.getTime() <= asOf.getTime() &&
            (cursor === null || header.operationId > cursor),
        )
        .sort((a, b) => compareStrings(a.operationId, b.operationId));
      const page = reclaimable.slice(0, effectiveLimit);
      for (const header of page) {
        for (const item of itemsOf(header.operationId)) {
          items.delete(itemTableKey(header.operationId, item.key));
        }
        headers.delete(header.operationId);
      }
      const last = page[page.length - 1];
      return {
        operationIds: page.map((header) => header.operationId),
        nextCursor:
          reclaimable.length > page.length && last !== undefined
            ? last.operationId
            : null,
      };
    },
  };
}
