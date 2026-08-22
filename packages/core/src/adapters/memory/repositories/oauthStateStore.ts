import type {
  OAuthFlowState,
  OAuthStateStore,
} from "../../../application/ports/oauthStateStore";
import type { PrunePage } from "../../../domain/common/pagination";
import type { TokenHash } from "../../../domain/identity/valueObject";
import type { MemoryBackend } from "../store";
import { clone, deleteExpiredPage } from "../support";

export function createMemoryOAuthStateStore(
  backend: MemoryBackend,
): OAuthStateStore {
  const table = backend.oauthStates;
  return {
    async put(
      state: string,
      value: OAuthFlowState,
      ttlMs: number,
    ): Promise<void> {
      table.set(state, {
        state,
        value: clone(value),
        expiresAt: new Date(backend.clock.now().getTime() + ttlMs),
      });
    },

    // Synchronous get + compare + delete: atomic on this backend, the
    // memory equivalent of
    // `DELETE … WHERE state = ? AND state_binding_hash = ? RETURNING *`.
    async take(
      state: string,
      stateBindingHash: TokenHash,
    ): Promise<OAuthFlowState | null> {
      const row = table.get(state);
      if (row === undefined) {
        return null;
      }
      // A mismatched binding leaves the row alone: deleting it would let
      // anyone who merely knows `state` burn down someone else's
      // in-flight authorization round trip.
      if (row.value.stateBindingHash !== stateBindingHash) {
        return null;
      }
      table.delete(state);
      if (row.expiresAt.getTime() <= backend.clock.now().getTime()) {
        return null;
      }
      return clone(row.value);
    },

    async deleteExpired(
      now: Date,
      cursor: string | null,
      limit: number,
    ): Promise<PrunePage> {
      return deleteExpiredPage(
        table,
        (row) => row.expiresAt,
        now,
        cursor,
        limit,
      );
    },
  };
}
