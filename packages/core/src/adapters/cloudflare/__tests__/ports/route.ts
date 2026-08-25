import type { IdempotencyStore } from "../../../../application/ports/idempotencyStore";
import type { NoteRouteFanOutReader } from "../../../../application/ports/noteRouteFanOutReader";
import type { NoteRouteStore } from "../../../../application/ports/noteRouteStore";
import type { OutboxRepository } from "../../../../application/ports/outboxRepository";
import type { ScopeRouter } from "../../../../application/ports/scopeRouter";
import type { ScopeTaskQueue } from "../../../../application/ports/scopeTaskQueue";
import { port } from "../pendingPorts";
import type { GlobalPortDeps } from "./deps";

/**
 * Step 7 — the D1 route / infrastructure / cross-plane bundle.
 *
 * Two notes for the owner. `OutboxRepository` is built over whichever
 * session it is handed, and both planes have an identically shaped
 * `outbox_events` table, so the **same** implementation serves the global
 * outbox and each scope object's local one — the unit of work stages
 * `save` through it on both planes. And `ScopeTaskQueue.listDue` reads
 * the global `scope_task_due_index`
 * ([ADR 003](../../../../../../.thread/11/adr.md)), not any scope object.
 *
 * Suites: `conformance/route.test.ts`.
 */
export type RoutePorts = Readonly<{
  noteRouteStore: NoteRouteStore;
  noteRouteFanOutReader: NoteRouteFanOutReader;
  outboxRepository: OutboxRepository;
  idempotencyStore: IdempotencyStore;
  scopeRouter: ScopeRouter;
  scopeTaskQueue: ScopeTaskQueue;
}>;

export function createRoutePorts(_deps: GlobalPortDeps): RoutePorts {
  return {
    noteRouteStore: port<NoteRouteStore>("NoteRouteStore"),
    noteRouteFanOutReader: port<NoteRouteFanOutReader>("NoteRouteFanOutReader"),
    outboxRepository: port<OutboxRepository>("OutboxRepository"),
    idempotencyStore: port<IdempotencyStore>("IdempotencyStore"),
    scopeRouter: port<ScopeRouter>("ScopeRouter"),
    scopeTaskQueue: port<ScopeTaskQueue>("ScopeTaskQueue"),
  };
}
