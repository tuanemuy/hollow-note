import { beforeEach, describe, expect, it } from "vitest";
import {
  type WorkspaceId,
  WorkspaceSlug,
} from "../../domain/workspace/valueObject";
import { expectConflict } from "./asserts";
import type { ConformanceBackend, MakeConformanceBackend } from "./backend";
import { workspaceId } from "./fixtures";

const HOUR_MS = 60 * 60 * 1000;

const slug = (name: string): WorkspaceSlug => WorkspaceSlug.create(name);

/**
 * Shared conformance suite for `WorkspaceSlugReservationStore`
 * (ADP-workspace-061..065): the two-phase claim behind
 * `ConflictError("SLUG_ALREADY_USED")`, the atomic exchange that keeps a
 * public URL live across a slug change, which attempt of a shared
 * operation may compensate, and the teardown a deletion runs — including
 * which rows that teardown may not touch.
 */
export function describeWorkspaceSlugReservationStoreContract(
  backendName: string,
  makeBackend: MakeConformanceBackend,
): void {
  describe(`WorkspaceSlugReservationStore conformance [${backendName}]`, () => {
    let backend: ConformanceBackend;
    const store = () => backend.workspaceSlugReservationStore;

    beforeEach(async () => {
      backend = await makeBackend();
    });

    /**
     * `attemptId` defaults to the operation id, which is what a caller
     * that mints a fresh operation per request effectively has. The cases
     * that make two attempts share one operation pass it explicitly.
     */
    const reserve = (
      operationId: string,
      name = "alpha",
      owner: WorkspaceId = workspaceId(1),
      attemptId: string = operationId,
    ): Promise<void> =>
      store().reserve({
        slug: slug(name),
        workspaceId: owner,
        operationId,
        attemptId,
        expiresAt: new Date(backend.clock.now().getTime() + HOUR_MS),
      });

    const abandon = (
      operationId: string,
      name = "alpha",
      attemptId: string = operationId,
    ): Promise<void> =>
      store().abandon({ slug: slug(name), operationId, attemptId });

    const activate = (
      operationId: string,
      name = "alpha",
      owner: WorkspaceId = workspaceId(1),
      releasing: string | null = null,
    ): Promise<void> =>
      store().activate({
        slug: slug(name),
        workspaceId: owner,
        operationId,
        releasing: releasing === null ? null : slug(releasing),
      });

    const claim = async (
      operationId: string,
      name = "alpha",
      owner: WorkspaceId = workspaceId(1),
    ): Promise<void> => {
      await reserve(operationId, name, owner);
      await activate(operationId, name, owner);
    };

    it("ADP-workspace-061/062/063: a slug resolves only once its reservation is activated", async () => {
      expect(await store().resolveActive(slug("alpha"))).toBeNull();

      await reserve("op-1");
      expect(await store().resolveActive(slug("alpha"))).toBeNull();

      await activate("op-1");
      expect(await store().resolveActive(slug("alpha"))).toBe(workspaceId(1));
    });

    it("ADP-workspace-062: a slug held by another operation or workspace is SLUG_ALREADY_USED", async () => {
      await reserve("op-1");
      await expectConflict(
        reserve("op-2", "alpha", workspaceId(2)),
        "SLUG_ALREADY_USED",
      );

      await activate("op-1");
      await expectConflict(
        reserve("op-3", "alpha", workspaceId(2)),
        "SLUG_ALREADY_USED",
      );
      expect(await store().resolveActive(slug("alpha"))).toBe(workspaceId(1));
    });

    it("ADP-workspace-062: a lapsed reservation is reclaimable, an active claim never", async () => {
      await reserve("op-1");
      backend.clock.advance(HOUR_MS + 1);

      await claim("op-2", "alpha", workspaceId(2));
      expect(await store().resolveActive(slug("alpha"))).toBe(workspaceId(2));

      backend.clock.advance(HOUR_MS * 24);
      await expectConflict(
        reserve("op-3", "alpha", workspaceId(1)),
        "SLUG_ALREADY_USED",
      );
      expect(await store().resolveActive(slug("alpha"))).toBe(workspaceId(2));
    });

    it("ADP-workspace-062/063: reserve and activate are idempotent per operation (lost response)", async () => {
      await reserve("op-1");
      await reserve("op-1");
      await activate("op-1");
      await activate("op-1");
      expect(await store().resolveActive(slug("alpha"))).toBe(workspaceId(1));
    });

    it("ADP-workspace-062: a workspace may re-reserve the slug it already holds", async () => {
      await claim("op-1");

      await reserve("op-2");
      // The public URL keeps resolving through the whole second saga.
      expect(await store().resolveActive(slug("alpha"))).toBe(workspaceId(1));
      await activate("op-2");
      expect(await store().resolveActive(slug("alpha"))).toBe(workspaceId(1));
    });

    it("ADP-workspace-063: the exchange frees the old slug and opens the new one", async () => {
      await claim("op-1");

      await reserve("op-2", "beta");
      // Both resolve while the change is in flight — the old link stays
      // usable until the new one is live.
      expect(await store().resolveActive(slug("alpha"))).toBe(workspaceId(1));
      expect(await store().resolveActive(slug("beta"))).toBeNull();

      await activate("op-2", "beta", workspaceId(1), "alpha");
      expect(await store().resolveActive(slug("alpha"))).toBeNull();
      expect(await store().resolveActive(slug("beta"))).toBe(workspaceId(1));

      // The freed slug is available to another workspace at once.
      await claim("op-3", "alpha", workspaceId(2));
      expect(await store().resolveActive(slug("alpha"))).toBe(workspaceId(2));
    });

    it("ADP-workspace-063: the exchange is idempotent and skips a release already applied", async () => {
      await claim("op-1");
      await reserve("op-2", "beta");
      await activate("op-2", "beta", workspaceId(1), "alpha");
      await activate("op-2", "beta", workspaceId(1), "alpha");

      expect(await store().resolveActive(slug("beta"))).toBe(workspaceId(1));
      expect(await store().resolveActive(slug("alpha"))).toBeNull();
    });

    it("ADP-workspace-063: a stale replay cannot free the slug the workspace holds today", async () => {
      await claim("op-1", "alpha");
      await reserve("op-2", "beta");
      await activate("op-2", "beta", workspaceId(1), "alpha");
      // The workspace moves back: `beta` is given up for `alpha` again.
      await reserve("op-3", "alpha");
      await activate("op-3", "alpha", workspaceId(1), "beta");

      // The first change replays long after the fact. Its row is gone, so
      // it is refused before it can release the live slug.
      await expectConflict(activate("op-2", "beta", workspaceId(1), "alpha"));
      expect(await store().resolveActive(slug("alpha"))).toBe(workspaceId(1));
    });

    it("ADP-workspace-063: activate is refused for anyone but the operation holding the row", async () => {
      await reserve("op-1");

      await expectConflict(activate("op-2"), "SLUG_ALREADY_USED");
      await expectConflict(
        activate("op-1", "alpha", workspaceId(2)),
        "SLUG_ALREADY_USED",
      );
      expect(await store().resolveActive(slug("alpha"))).toBeNull();

      await activate("op-1");
      expect(await store().resolveActive(slug("alpha"))).toBe(workspaceId(1));
    });

    it("ADP-workspace-063: a replayed exchange leaves a slug that was re-taken alone", async () => {
      await claim("op-1", "alpha");
      await reserve("op-2", "beta");
      await activate("op-2", "beta", workspaceId(1), "alpha");
      await claim("op-9", "alpha", workspaceId(2));

      // The replay still holds `beta`, so it gets that far — but the slug
      // it means to free now belongs to someone else.
      await activate("op-2", "beta", workspaceId(1), "alpha");
      expect(await store().resolveActive(slug("alpha"))).toBe(workspaceId(2));
      expect(await store().resolveActive(slug("beta"))).toBe(workspaceId(1));
    });

    it("ADP-workspace-063: activating a row that abandon already dropped conflicts", async () => {
      await reserve("op-1");
      await abandon("op-1");

      await expectConflict(activate("op-1"));
      expect(await store().resolveActive(slug("alpha"))).toBeNull();
    });

    it("ADP-workspace-064: abandon drops only this operation's reserved row", async () => {
      await claim("op-1");
      // An activated claim survives its own operation's compensation.
      await abandon("op-1");
      expect(await store().resolveActive(slug("alpha"))).toBe(workspaceId(1));

      await reserve("op-2", "beta");
      await abandon("op-other", "beta");
      await expectConflict(
        reserve("op-3", "beta", workspaceId(2)),
        "SLUG_ALREADY_USED",
      );

      await abandon("op-2", "beta");
      await abandon("op-2", "beta");
      await claim("op-3", "beta", workspaceId(2));
      expect(await store().resolveActive(slug("beta"))).toBe(workspaceId(2));
    });

    /**
     * An operation id may name a rename rather than a request, so two
     * attempts can share one row. The row belongs to whichever reserved
     * it last, and only that attempt may compensate — otherwise the one
     * that failed for a reason of its own drops the row the other is
     * about to activate.
     */
    it("ADP-workspace-064: a row a later attempt took over is not the earlier attempt's to abandon", async () => {
      await reserve("op-1", "alpha", workspaceId(1), "attempt-a");
      await reserve("op-1", "alpha", workspaceId(1), "attempt-b");

      await abandon("op-1", "alpha", "attempt-a");

      // The row is still there and still this operation's, so the attempt
      // that holds it lands its change.
      await activate("op-1");
      expect(await store().resolveActive(slug("alpha"))).toBe(workspaceId(1));
    });

    it("ADP-workspace-064: the attempt holding the row is the one whose abandon frees the slug", async () => {
      await reserve("op-1", "alpha", workspaceId(1), "attempt-a");
      await reserve("op-1", "alpha", workspaceId(1), "attempt-b");

      await abandon("op-1", "alpha", "attempt-b");

      await expectConflict(activate("op-1"));
      await claim("op-2", "alpha", workspaceId(2));
      expect(await store().resolveActive(slug("alpha"))).toBe(workspaceId(2));
    });

    it("ADP-workspace-065: release frees the workspace's own claim and nobody else's", async () => {
      await claim("op-1", "alpha", workspaceId(1));

      // A workspace that does not hold the key changes nothing.
      await store().release({
        slug: slug("alpha"),
        workspaceId: workspaceId(2),
      });
      expect(await store().resolveActive(slug("alpha"))).toBe(workspaceId(1));

      await store().release({
        slug: slug("alpha"),
        workspaceId: workspaceId(1),
      });
      expect(await store().resolveActive(slug("alpha"))).toBeNull();
      // An absent row succeeds: the slug already does not resolve.
      await store().release({
        slug: slug("alpha"),
        workspaceId: workspaceId(1),
      });

      await claim("op-2", "alpha", workspaceId(2));
      expect(await store().resolveActive(slug("alpha"))).toBe(workspaceId(2));
    });

    /**
     * Callers name every key that *could* be the one they hold and let
     * the wrong guesses write nothing, so a workspace regularly releases
     * a slug it is at that moment only holding as `reserved` — the row a
     * change still in flight took. Dropping it there would take the
     * reservation out from under the change that is about to activate
     * it, and the release path has no operation id with which to tell
     * the two apart.
     */
    it("ADP-workspace-065: release leaves the workspace's own reserved row alone", async () => {
      await reserve("op-1", "alpha", workspaceId(1));

      await store().release({
        slug: slug("alpha"),
        workspaceId: workspaceId(1),
      });

      // The row is still the claim it was: nobody else may take it ...
      await expectConflict(
        reserve("op-2", "alpha", workspaceId(2)),
        "SLUG_ALREADY_USED",
      );
      // ... and the change that reserved it still lands.
      await activate("op-1");
      expect(await store().resolveActive(slug("alpha"))).toBe(workspaceId(1));
    });
  });
}
