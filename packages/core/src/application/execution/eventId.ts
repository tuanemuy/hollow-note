import { type EventDraft, EventId } from "@repo/core/domain/common/event";

/**
 * Event id of one buffered draft — minted, unless the draft names itself.
 *
 * Continuation requests carry a `continuationKey` built from their
 * originating operation, phase and cursor. Deriving the id from it makes
 * a replay of the turn that stored it write the **same** outbox row
 * instead of a second one, which is what keeps a lost commit response
 * from forking a continuation chain in two. Everything else —
 * domain events, whose duplicates are meaningful history — is minted.
 *
 * The key must differ between the turns of a chain. A continuation that
 * re-emitted its own key would be marked processed by the relay finalize
 * of the turn that stored it, and the chain would stop there;
 * a chain that cannot vary its key therefore leaves the field out and
 * relies on its handler being idempotent instead.
 *
 * Placed in the application layer rather than in an adapter because both
 * unit-of-work implementations mint against it and the rule is one
 * decision, not one per backend.
 */
export function mintEventIdFor(
  draft: EventDraft,
  mint: () => EventId,
): EventId {
  const key: unknown = draft.payload.continuationKey;
  return typeof key === "string" && key.length > 0
    ? EventId.create(key)
    : mint();
}
