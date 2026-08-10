import {
  createTestClock,
  type TestClock,
} from "@repo/core/adapters/conformance/testClock";
import type { MemoryMailSender } from "@repo/core/adapters/memory/mailSender";
import type { MemoryBackend } from "@repo/core/adapters/memory/store";
import type { MaintenanceKind } from "@repo/core/application/ports/globalMaintenanceRunStore";
import {
  createMemoryRuntime,
  type MemoryRuntimeOptions,
} from "../di/memoryRuntime";
import type { AppConfig, RequestContainer, WorkerContainer } from "../di/types";
import type { IdGenerator } from "../ports/idGenerator";
import { FakeIdGenerator, FakeLogger } from "./fakes";

export type TestHarnessOptions = Readonly<{
  maintenanceShardIds?: readonly string[];
  maintenanceTablesByKind?: Partial<Record<MaintenanceKind, readonly string[]>>;
  routingGenerations?: readonly string[];
  requestOverrides?: Partial<RequestContainer>;
  workerOverrides?: Partial<WorkerContainer>;
}>;

export type TestHarness = Readonly<{
  backend: MemoryBackend;
  clock: TestClock;
  idGenerator: IdGenerator;
  logger: FakeLogger;
  container: RequestContainer;
  workerContainer: WorkerContainer;
  mailSender: MemoryMailSender;
  config: AppConfig;
}>;

export const TEST_APP_URL = "https://app.example.test";

const TEST_CONFIG: AppConfig = {
  appUrl: TEST_APP_URL,
  siteName: "Test",
  defaultTitle: "Test",
  defaultDescription: "Test",
  themeColor: "#ffffff",
};

/**
 * Builds request + worker containers over one in-memory backend — the
 * production wiring of `createMemoryRuntime` with a controllable clock,
 * a deterministic id stream, and a recording logger. Overrides replace
 * individual ports for fault injection.
 */
export function createTestHarness(
  options: TestHarnessOptions = {},
): TestHarness {
  const clock = createTestClock();
  const idGenerator = new FakeIdGenerator();
  const logger = new FakeLogger();
  const runtimeOptions: MemoryRuntimeOptions = {
    clock,
    idGenerator,
    ...(options.maintenanceShardIds !== undefined
      ? { maintenanceShardIds: options.maintenanceShardIds }
      : {}),
    ...(options.maintenanceTablesByKind !== undefined
      ? { maintenanceTablesByKind: options.maintenanceTablesByKind }
      : {}),
    ...(options.routingGenerations !== undefined
      ? { routingGenerations: options.routingGenerations }
      : {}),
  };
  const runtime = createMemoryRuntime(runtimeOptions);
  const container: RequestContainer = {
    ...runtime.createRequestContainer(TEST_CONFIG),
    logger,
    ...options.requestOverrides,
  };
  const workerContainer: WorkerContainer = {
    ...runtime.createWorkerContainer(),
    logger,
    ...options.workerOverrides,
  };
  return {
    backend: runtime.backend,
    clock,
    idGenerator,
    logger,
    container,
    workerContainer,
    mailSender: runtime.mailSender,
    config: TEST_CONFIG,
  };
}
