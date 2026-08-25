import type { RelayTrigger } from "../ports/relayTrigger";
import type { ScopeTaskTrigger } from "../ports/scopeTaskTrigger";
import type { AppConfig, RequestContainer, WorkerContainer } from "./types";

/**
 * What every composition root of this codebase offers its entry point,
 * independent of which backend it is built over.
 *
 * The two container factories are the whole dependency surface an app
 * package sees; the two `bind*` methods exist because the unit-of-work
 * providers need a trigger at construction while the runner that owns
 * the real one is built later from the worker container. Until bound, a
 * commit simply waits for the runner's next tick, so binding is
 * optional in deployments that have no in-process runner.
 *
 * Runtime-specific extras (a backend handle, a recording mail sender)
 * belong on the concrete runtime type, not here: this is the part an
 * entry point may depend on without naming a backend.
 */
export type AppRuntime = Readonly<{
  bindRelayTrigger: (trigger: RelayTrigger) => void;
  bindScopeTaskTrigger: (trigger: ScopeTaskTrigger) => void;
  createRequestContainer: (config: AppConfig) => RequestContainer;
  createWorkerContainer: () => WorkerContainer;
}>;
