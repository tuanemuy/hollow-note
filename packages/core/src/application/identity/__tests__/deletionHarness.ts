import type { TestHarness } from "../../__tests__/helpers";
import {
  type EventDispatchOutcome,
  processOutboxEvents,
} from "../../workers/eventRelayWorker";
import { dispatchDomainEvent } from "../../workers/subscribers";
import { deleteAccount } from "../deleteAccount";
import type { AccountDeletionBuildPhase } from "../deleteAccount/input";
import { continueAccountDeletionManifestBuild } from "../deleteAccount/manifestBuild";

export const DELETION_REQUEST_ID = "11111111-1111-4111-8111-111111111111";

/**
 * Runs the relay against the real subscriber registry until the outbox
 * is drained — the same path `pnpm dev` takes, so a test that reaches a
 * terminal state proves the chain hands over correctly at every step.
 */
export async function drainDeletion(h: TestHarness): Promise<number> {
  const { processed } = await processOutboxEvents(
    h.workerContainer,
    async (events) => {
      const outcomes: EventDispatchOutcome[] = [];
      for (const event of events) {
        await dispatchDomainEvent(event, h.workerContainer);
        outcomes.push({ kind: "success", id: event.id });
      }
      return outcomes;
    },
  );
  return processed;
}

/**
 * Plays the build turns by hand, leaving the dispatch chain untouched —
 * the starting point for tests that drive one later phase in isolation.
 */
export async function buildDeletionManifest(
  h: TestHarness,
  operationId: string,
): Promise<void> {
  const store = h.workerContainer.accountDeletionManifestStore;
  let phase: AccountDeletionBuildPhase = "memberships";
  let cursor: string | null = null;
  for (;;) {
    await continueAccountDeletionManifestBuild(h.workerContainer, {
      type: "identity.accountDeletionManifestBuildContinued",
      operationId,
      phase,
      cursor,
    });
    const header = await store.describe(operationId);
    if (header === null || header.status !== "building") {
      return;
    }
    if (phase === "memberships") {
      cursor = header.membershipCursor;
      if (cursor === null) {
        phase = "authorRoutes";
      }
      continue;
    }
    cursor = header.authorRouteCursor;
  }
}

/** Accepts a deletion request without following its continuations. */
export async function acceptDeletion(
  h: TestHarness,
  params: Readonly<{
    userId: string;
    email: string;
    requestId?: string;
  }>,
): Promise<string> {
  const view = await deleteAccount({
    container: h.container,
    input: {
      type: "userRequest",
      userId: params.userId,
      confirmationEmail: params.email,
      requestId: params.requestId ?? DELETION_REQUEST_ID,
    },
  });
  return view.operationId;
}
