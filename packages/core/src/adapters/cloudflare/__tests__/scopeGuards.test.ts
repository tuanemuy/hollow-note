import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { isSystemError, SystemErrorCode } from "../../../application/errors";
import { ScopeKey } from "../../../application/scope";
import { UserId } from "../../../domain/identity/valueObject";
import type { NoteRepository } from "../../../domain/note/ports/noteRepository";
import { NoteId } from "../../../domain/note/valueObject";
import type { TagAssignmentRepository } from "../../../domain/tag/ports/tagAssignmentRepository";
import { TagAssignment } from "../../../domain/tag/tagAssignment";
import { makeBlankNote } from "../../conformance/fixtures";
import { createCloudflareNoteRepository } from "../do/repositories/noteRepository";
import { createCloudflareTagAssignmentRepository } from "../do/repositories/tagAssignmentRepository";
import { SCOPE_TABLES } from "../do/schema";
import { createScopeStubExecutor } from "../do/scopeStub";
import { opaque } from "../execution/writeSet";
import { createAutocommitSession, type SqlSession } from "../sql/session";
import { statement } from "../sql/statement";

/**
 * The scope-key columns this backend checks against the object it is
 * bound to (`spec/database/index.md` の「共通の規約」). Every path over
 * a row is exercised here — for `tag_assignments` the save
 * (ADP-tag-010), the restore (ADP-tag-012) and the bounded delete
 * (ADP-tag-019); for `notes` the restore (ADP-note-009) and the
 * version-guarded delete (ADP-note-011), which reaches its row by id and
 * version alone — since a guard that covers the reads but not the
 * deletes leaves the destructive path open.
 *
 * The counterpart of `memory/__tests__/scopeGuards.test.ts`, and the
 * only place the *restore* half of that rule is exercised at all: memory
 * keeps each scope object's rows in a table of its own, so no read there
 * can produce a foreign row, whereas here every scope shares one table
 * shape and the pin is the only thing separating them. This is a backend
 * guard rather than a port contract — a row naming another object cannot
 * be produced through any usecase, only by binding a repository to the
 * wrong object — which is why it is not in the shared conformance
 * suites.
 */
const BOUND_USER = UserId.create("user-1");
const BOUND = ScopeKey.user(BOUND_USER);
const FOREIGN_USER = "user-2";
const NOTE_ID = NoteId.create("note-0001");
const ASSIGNED_AT = new Date("2026-08-31T00:00:00.000Z");

let namespaceSeq = 0;

/** A scope object of its own per test, so a seeded row cannot leak. */
const openObject = (): Readonly<{
  session: SqlSession;
  repository: TagAssignmentRepository;
  notes: NoteRepository;
}> => {
  namespaceSeq += 1;
  const session = createAutocommitSession(
    createScopeStubExecutor(env.SCOPE_OBJECT, BOUND, `guards-${namespaceSeq}`),
  );
  return {
    session,
    repository: createCloudflareTagAssignmentRepository({
      session,
      scope: BOUND,
    }),
    notes: createCloudflareNoteRepository({ session, scope: BOUND }),
  };
};

const boundAssignment = TagAssignment.reconstruct({
  id: "assignment-0002",
  tagId: "tag-0002",
  noteId: NOTE_ID,
  scopeType: "user",
  scopeId: BOUND_USER,
  assignedBy: BOUND_USER,
  assignedAt: ASSIGNED_AT,
});

const foreignAssignment = TagAssignment.reconstruct({
  id: "assignment-0001",
  tagId: "tag-0001",
  noteId: NOTE_ID,
  scopeType: "user",
  scopeId: FOREIGN_USER,
  assignedBy: FOREIGN_USER,
  assignedAt: ASSIGNED_AT,
});

const isDataIntegrityError = (error: unknown): boolean =>
  isSystemError(error) && error.code === SystemErrorCode.DataIntegrityError;

/** Puts a foreign row in place without going through the guard above it. */
const seedForeignRow = (session: SqlSession): Promise<void> =>
  session.write([
    opaque(
      statement(
        `INSERT INTO ${SCOPE_TABLES.tagAssignments}
           (id, tag_id, note_id, scope_type, scope_id, assigned_by, assigned_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        foreignAssignment.id,
        foreignAssignment.tagId,
        NOTE_ID,
        "user",
        FOREIGN_USER,
        FOREIGN_USER,
        ASSIGNED_AT.getTime(),
      ),
    ),
  ]);

/**
 * Moves a note row out of the bound scope behind the repository's back:
 * only a misbound repository could see it, which is the configuration
 * the pin exists to catch.
 */
const moveOutOfScope = (session: SqlSession, id: string): Promise<void> =>
  session.write([
    opaque(
      statement(
        `UPDATE ${SCOPE_TABLES.notes} SET owner_id = ? WHERE id = ?`,
        FOREIGN_USER,
        id,
      ),
    ),
  ]);

const storedNoteOwners = async (
  session: SqlSession,
): Promise<readonly unknown[]> =>
  (
    await session.query(
      statement(`SELECT owner_id FROM ${SCOPE_TABLES.notes} ORDER BY id`),
    )
  ).map((row) => row.owner_id);

const storedIds = async (session: SqlSession): Promise<readonly unknown[]> =>
  (
    await session.query(
      statement(`SELECT id FROM ${SCOPE_TABLES.tagAssignments} ORDER BY id`),
    )
  ).map((row) => row.id);

describe("cloudflare scope-key guards", () => {
  it("ADP-tag-010: refuses to save an assignment whose scope names another object", async () => {
    const { session, repository } = openObject();

    await expect(repository.insert(foreignAssignment)).rejects.toSatisfy(
      isDataIntegrityError,
    );
    expect(await storedIds(session)).toEqual([]);
  });

  it("ADP-tag-010: still saves an assignment of the bound scope", async () => {
    const { session, repository } = openObject();

    await repository.insert(boundAssignment);

    expect(await storedIds(session)).toEqual([boundAssignment.id]);
  });

  it("ADP-tag-012: refuses to restore a row whose scope names another object", async () => {
    const { session, repository } = openObject();
    await seedForeignRow(session);

    await expect(repository.listByNote(NOTE_ID)).rejects.toSatisfy(
      isDataIntegrityError,
    );
    // The row is still there: the guard reports the crossing, it does not
    // repair it — nothing but the pin can say which object it belongs to.
    expect(await storedIds(session)).toEqual([foreignAssignment.id]);
  });

  it("ADP-tag-019: refuses to delete a page holding a row scoped to another object", async () => {
    const { session, repository } = openObject();
    await seedForeignRow(session);
    await repository.insert(boundAssignment);

    // The page the note-purge fan-out asks for: the bounded delete is the
    // only repository method that path touches, so a guard it skipped
    // would silently take the foreign row with it.
    await expect(repository.deleteByNote(NOTE_ID, 100)).rejects.toSatisfy(
      isDataIntegrityError,
    );
    // Nothing went, not even the row of the bound scope: the page is
    // checked before the first delete, so the crossing is reported rather
    // than half-applied.
    expect(await storedIds(session)).toEqual([
      foreignAssignment.id,
      boundAssignment.id,
    ]);
  });

  it("ADP-note-009: refuses to restore a note row scoped to another object", async () => {
    const { session, notes } = openObject();
    const note = makeBlankNote(1, BOUND_USER, ASSIGNED_AT);
    await notes.insert(note);
    await moveOutOfScope(session, note.id);

    await expect(notes.findById(note.id)).rejects.toSatisfy(
      isDataIntegrityError,
    );
    expect(await storedNoteOwners(session)).toEqual([FOREIGN_USER]);
  });

  it("ADP-note-011: refuses to delete a note row scoped to another object", async () => {
    const { session, notes } = openObject();
    const note = makeBlankNote(1, BOUND_USER, ASSIGNED_AT);
    await notes.insert(note);
    const stored = await notes.findById(note.id);
    if (stored === null) {
      throw new Error("seeded note missing");
    }
    await moveOutOfScope(session, note.id);

    // The delete reaches the row by id and version alone, so without the
    // guard the version match would be the whole of its permission.
    await expect(
      notes.delete(note.id, stored.expectedVersion),
    ).rejects.toSatisfy(isDataIntegrityError);
    expect(await storedNoteOwners(session)).toEqual([FOREIGN_USER]);
  });

  it("ADP-note-011: still deletes a note row of the bound scope", async () => {
    const { session, notes } = openObject();
    const note = makeBlankNote(1, BOUND_USER, ASSIGNED_AT);
    await notes.insert(note);
    const stored = await notes.findById(note.id);
    if (stored === null) {
      throw new Error("seeded note missing");
    }

    await notes.delete(note.id, stored.expectedVersion);

    expect(await storedNoteOwners(session)).toEqual([]);
  });

  it("ADP-tag-019: still deletes the bound scope's rows of the note", async () => {
    const { session, repository } = openObject();
    await repository.insert(boundAssignment);

    expect(await repository.deleteByNote(NOTE_ID, 100)).toBe(1);
    expect(await storedIds(session)).toEqual([]);
  });
});
