import { EventId } from "@repo/core/domain/common/event";
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
