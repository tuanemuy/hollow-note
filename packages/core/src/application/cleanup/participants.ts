import type { AccountDeletionReceipt } from "../ports/accountDeletionManifestStore";
import type { PersonalCleanupComponent } from "../ports/scopeCleanupAdmissionStore";

/**
 * Who acknowledges the cleanup a deletion waits for (ADR-002 / ADR-017).
 *
 * Both registries are **exhaustive** over their enum, so a build cannot
 * silently omit a component: a value that has no participant here must
 * say so, with the reason and the slice that will bring one. The
 * required sets are derived from the participant side, which is what
 * keeps "nothing cleaned it, yet completion passed" unrepresentable —
 * the deployment declares what exists rather than acknowledging on
 * behalf of what does not.
 */
export type CleanupAbsentReason = Readonly<{
  kind: "absent";
  reason: string;
  /** Slice that turns this entry into a participant. */
  handoff: string;
}>;

export type PersonalCleanupParticipant = Readonly<{
  kind: "participant";
  /** Scope-task kind carrying this component's continuation turns. */
  taskKind: string;
}>;

export type GlobalCleanupParticipant = Readonly<{ kind: "participant" }>;

const absent = (reason: string, handoff: string): CleanupAbsentReason => ({
  kind: "absent",
  reason,
  handoff,
});

/** Scope-task kind of the storage cleanup turns. */
export const STORAGE_OWNER_DELETE_TASK_KIND = "storage.ownerDeleteContinued";
/** Scope-task kind of the usage cleanup turns. */
export const USAGE_USER_CLEANUP_TASK_KIND = "usage.userCleanupContinued";

export const personalCleanupParticipants = {
  storage: { kind: "participant", taskKind: STORAGE_OWNER_DELETE_TASK_KIND },
  usage: { kind: "participant", taskKind: USAGE_USER_CLEANUP_TASK_KIND },
  job: absent("The Job aggregate does not exist", "#5"),
  note: absent("`deleteNotesForOwner` does not exist", "editing / curation"),
  tag: absent("The Tag aggregate does not exist", "curation"),
  backup: absent("BackupRecord does not exist", "#4"),
  localProjection: absent(
    "Nothing enqueues deletion-driven local projection tasks; author redaction is counted as a manifest item ack instead",
    "editing / curation",
  ),
  outbox: absent(
    "The scope plane has no reader for its own outbox; delivery of `storage.fileDeleted` rests on the idempotent `deleteStoredObjects`",
    "#11 / the slice adding a scope outbox read side",
  ),
} as const satisfies Record<
  PersonalCleanupComponent,
  PersonalCleanupParticipant | CleanupAbsentReason
>;

export const globalCleanupParticipants = {
  personalCleanup: { kind: "participant" },
  authResidue: { kind: "participant" },
  uniquenessRelease: { kind: "participant" },
  externalConnections: absent("ExternalConnection does not exist", "#4"),
  jobHistory: absent("Global job history does not exist", "#5"),
} as const satisfies Record<
  Exclude<AccountDeletionReceipt, "personalAbort">,
  GlobalCleanupParticipant | CleanupAbsentReason
>;

type ParticipantKeyOf<TRegistry> = {
  [K in keyof TRegistry]: TRegistry[K] extends Readonly<{ kind: "participant" }>
    ? K
    : never;
}[keyof TRegistry];

/** Components something actually cleans up in this deployment. */
export type ActivePersonalCleanupComponent = ParticipantKeyOf<
  typeof personalCleanupParticipants
> &
  PersonalCleanupComponent;

export const REQUIRED_PERSONAL_CLEANUP_COMPONENTS: readonly ActivePersonalCleanupComponent[] =
  Object.entries(personalCleanupParticipants).flatMap(([component, entry]) =>
    entry.kind === "participant"
      ? [component as ActivePersonalCleanupComponent]
      : [],
  );

export const REQUIRED_FINALIZE_RECEIPTS: readonly AccountDeletionReceipt[] =
  Object.entries(globalCleanupParticipants).flatMap(([receipt, entry]) =>
    entry.kind === "participant" ? [receipt as AccountDeletionReceipt] : [],
  );
