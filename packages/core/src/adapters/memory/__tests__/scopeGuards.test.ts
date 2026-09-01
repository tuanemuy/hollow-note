import { describe, expect, it } from "vitest";
import { isSystemError, SystemErrorCode } from "../../../application/errors";
import { ScopeKey } from "../../../application/scope";
import { UserId } from "../../../domain/identity/valueObject";
import { TagAssignment } from "../../../domain/tag/tagAssignment";
import { createMemoryTagAssignmentRepository } from "../repositories/tagAssignmentRepository";
import { MemoryBackend } from "../store";

/**
 * The scope-key columns an adapter checks against the object it is bound
 * to (`spec/database/index.md` の「共通の規約」).
 *
 * This is a backend guard, not a port contract — a row naming another
 * scope object cannot be produced through any usecase, only by wiring a
 * repository to the wrong object — so it is not part of the shared
 * conformance suites. It is checked here because physical separation
 * rests on the pin alone: if the write goes through, nothing downstream
 * ever notices the row is in the wrong place.
 */
describe("memory scope-key guards", () => {
  it("ADP-tag-010: refuses an assignment whose scope names another object", async () => {
    const backend = new MemoryBackend();
    const store = backend.scope(ScopeKey.user(UserId.create("user-1")));
    const repository = createMemoryTagAssignmentRepository(store);

    const foreign = TagAssignment.reconstruct({
      id: "assignment-001",
      tagId: "tag-1",
      noteId: "note-001",
      scopeType: "user",
      scopeId: "user-2",
      assignedBy: "user-2",
      assignedAt: backend.clock.now(),
    });

    await expect(repository.insert(foreign)).rejects.toSatisfy(
      (error: unknown) =>
        isSystemError(error) &&
        error.code === SystemErrorCode.DataIntegrityError,
    );
    expect(store.tagAssignments.values()).toEqual([]);
  });
});
