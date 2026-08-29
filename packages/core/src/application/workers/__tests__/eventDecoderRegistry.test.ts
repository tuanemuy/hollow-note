import type { EventDraft } from "@repo/core/domain/common/event";
import { EventId } from "@repo/core/domain/common/event";
import { Email, UserId } from "@repo/core/domain/identity/valueObject";
import {
  type WorkspaceEvent,
  WorkspaceEvents,
} from "@repo/core/domain/workspace/events";
import {
  InvitationId,
  WorkspaceId,
  WorkspaceName,
  WorkspaceSlug,
} from "@repo/core/domain/workspace/valueObject";
import { describe, expect, it } from "vitest";
import { createTestHarness } from "../../__tests__/helpers";
import { signUpWithPassword } from "../../identity/signUpWithPassword";
import { createBlankNote } from "../../note/createBlankNote";
import { defaultEventDecoderRegistry } from "../eventRelayWorker";

// The registry must decode every event the walking-skeleton usecases
// enqueue — a missing or shape-skewed decoder would quarantine the row
// at relay time instead of failing here.
describe("defaultEventDecoderRegistry", () => {
  it("round-trips the outbox rows produced by the sign-up and note-creation flows", async () => {
    const h = createTestHarness();
    await signUpWithPassword({
      container: h.container,
      input: {
        email: "user@example.com",
        password: "password1234",
        displayName: "Alice",
        termsAccepted: true,
      },
    });
    await createBlankNote({
      container: h.container,
      input: {
        userId: "u1",
        ownerType: "user",
        ownerWorkspaceId: null,
        title: null,
      },
    });

    const rows = h.backend.outbox.values();
    expect(rows.map((row) => row.type).sort()).toEqual([
      "identity.identity.added",
      "identity.user.created",
      "note.created",
    ]);

    for (const row of rows) {
      const decoder =
        defaultEventDecoderRegistry[
          row.type as keyof typeof defaultEventDecoderRegistry
        ];
      expect(decoder).toBeDefined();
      const event = decoder(row.payload, {
        id: EventId.create(row.id),
        occurredAt: row.occurredAt,
        aggregateId: row.aggregateId,
      });
      expect(event.type).toBe(row.type);
      expect(event.aggregateId).toBe(row.aggregateId);
    }
  });

  // Every workspace event has to survive the wire, including the ones
  // spec/domains/workspace.md marks 監査 with no subscriber: the relay
  // decodes before it dispatches, so a missing decoder quarantines the row
  // instead of being acknowledged with a "no subscriber" warning.
  it("round-trips every workspace event, subscribed or not", () => {
    const now = new Date(0);
    const workspaceId = WorkspaceId.create("ws-1");
    const userId = UserId.create("u-1");
    const invitationId = InvitationId.create("inv-1");
    const slug = WorkspaceSlug.create("team-alpha");

    const drafts: readonly EventDraft<WorkspaceEvent>[] = [
      WorkspaceEvents.workspaceCreated(workspaceId, userId, now),
      WorkspaceEvents.workspaceProfileUpdated(
        workspaceId,
        WorkspaceName.create("Team Alpha"),
        now,
      ),
      WorkspaceEvents.workspaceSlugChanged(workspaceId, null, slug, now),
      WorkspaceEvents.workspacePublished(workspaceId, slug, now),
      WorkspaceEvents.workspaceUnpublished(workspaceId, now),
      WorkspaceEvents.workspaceDeleted(workspaceId, "op-1", now),
      WorkspaceEvents.membershipAdded(workspaceId, userId, "editor", now),
      WorkspaceEvents.membershipRoleChanged(
        {
          workspaceId,
          userId,
          previousRole: "editor",
          currentRole: "viewer",
        },
        now,
      ),
      WorkspaceEvents.membershipRemoved(workspaceId, userId, now),
      WorkspaceEvents.invitationCreated(
        {
          invitationId,
          workspaceId,
          email: Email.create("invitee@example.com"),
          role: "viewer",
        },
        now,
      ),
      WorkspaceEvents.invitationAccepted(
        invitationId,
        workspaceId,
        userId,
        now,
      ),
      WorkspaceEvents.invitationRevoked(invitationId, workspaceId, now),
    ];

    const registered = Object.keys(defaultEventDecoderRegistry).filter((type) =>
      type.startsWith("workspace."),
    );
    expect(drafts.map((draft) => draft.type).sort()).toEqual(registered.sort());

    for (const draft of drafts) {
      const decoder =
        defaultEventDecoderRegistry[
          draft.type as keyof typeof defaultEventDecoderRegistry
        ];
      expect(decoder, `no decoder for ${draft.type}`).toBeDefined();
      // The outbox stores the payload as JSON, so the decoder is handed
      // primitives rather than the branded values the draft carried.
      const wire = JSON.parse(JSON.stringify(draft.payload)) as unknown;
      const event = decoder(wire, {
        id: EventId.create("e-1"),
        occurredAt: now,
        aggregateId: draft.aggregateId,
      });
      expect(event.type).toBe(draft.type);
      expect(event.aggregateId).toBe(workspaceId);
      expect(event.payload).toEqual(draft.payload);
    }
  });

  it("rejects a schema-skewed payload as a data-integrity fault", () => {
    const decoder = defaultEventDecoderRegistry["note.created"];
    expect(() =>
      decoder(
        { noteId: "n1", unexpected: true },
        {
          id: EventId.create("e1"),
          occurredAt: new Date(0),
          aggregateId: "n1",
        },
      ),
    ).toThrowError(/Invalid payload for note.created/);
  });
});
