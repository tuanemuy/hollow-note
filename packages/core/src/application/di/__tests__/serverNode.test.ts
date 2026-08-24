import { afterEach, describe, expect, it } from "vitest";
import { SCOPE_TASK_LEASE_MS } from "../../ports/scopeTaskScheduler";
import { DEFAULT_LEASE_MS } from "../../workers/eventRelayWorker";
import { readRelayTuning, readScopeTaskTuning } from "../env";
import { createMemoryRuntime } from "../memoryRuntime";
import {
  createNodeRequestContainer,
  initNodeRuntime,
  nodeServerEnvToRuntimeOptions,
  nodeServerEnvToTuningEnv,
  readNodeRequestServerConfig,
  readNodeServerEnv,
} from "../serverNode";

const BASE = { APP_URL: "http://localhost:3000" };
const GOOGLE = {
  GOOGLE_OAUTH_CLIENT_ID: "client-id",
  GOOGLE_OAUTH_CLIENT_SECRET: "client-secret",
};
const DEV = { OAUTH_DEV_MODE: "true", NODE_ENV: "development" };

/**
 * OAuth プロバイダーの選択規則は起動時の env スキーマに閉じる
 * （`createMemoryRuntime` 側に置くと env を持たないテストハーネスが全滅
 * する）。
 */
describe("nodeServerEnvSchema OAuth provider selection", () => {
  it("selects the dev identity provider under NODE_ENV=development", () => {
    const env = readNodeServerEnv({ ...BASE, ...DEV });
    expect(nodeServerEnvToRuntimeOptions(env).oauth).toEqual({ mode: "dev" });
  });

  // The rule is an allowlist, so the interesting cases are the values a
  // denylist on `production` would have let through.
  it.each([
    ["production", "production"],
    ["staging", "staging"],
    ["test", "test"],
    ["empty", ""],
    ["unset", undefined],
  ])(
    "refuses the dev identity provider when NODE_ENV is %s",
    (_label, nodeEnv) => {
      expect(() =>
        readNodeServerEnv({
          ...BASE,
          OAUTH_DEV_MODE: "true",
          NODE_ENV: nodeEnv,
        }),
      ).toThrow(/only under NODE_ENV=development/);
    },
  );

  it("refuses the dev identity provider even with Google credentials present", () => {
    expect(() =>
      readNodeServerEnv({
        ...BASE,
        ...GOOGLE,
        OAUTH_DEV_MODE: "true",
        NODE_ENV: "production",
      }),
    ).toThrow(/only under NODE_ENV=development/);
  });

  it("selects Google when both credentials are present", () => {
    const env = readNodeServerEnv({ ...BASE, ...GOOGLE });
    expect(nodeServerEnvToRuntimeOptions(env).oauth).toEqual({
      mode: "google",
      clientId: "client-id",
      clientSecret: "client-secret",
    });
  });

  it("fails to boot rather than falling back to a fake provider", () => {
    expect(() => readNodeServerEnv(BASE)).toThrow();
    expect(() =>
      readNodeServerEnv({ ...BASE, GOOGLE_OAUTH_CLIENT_ID: "client-id" }),
    ).toThrow();
  });
});

/**
 * `/dev/oauth/authorize` の 404 ガードは env を直読みせず
 * `RequestContainer.oauthDevMode` だけを見る。ここで押さえるのは env から
 * そのフラグまでの経路で、フラグを読む側は
 * `apps/web/app/presentation/__tests__/devOAuth.test.ts`（承認コードを
 * 発行する server function）が持つ。
 */
describe("dev consent route flag", () => {
  const oauthDevModeFor = (
    source: Readonly<Record<string, string | undefined>>,
  ): boolean => {
    const env = readNodeServerEnv({ ...BASE, ...source });
    return createMemoryRuntime(
      nodeServerEnvToRuntimeOptions(env),
    ).createRequestContainer(readNodeRequestServerConfig(env)).oauthDevMode;
  };

  it("is on for OAUTH_DEV_MODE=true", () => {
    expect(oauthDevModeFor(DEV)).toBe(true);
  });

  it("is off for a Google deployment", () => {
    expect(oauthDevModeFor(GOOGLE)).toBe(false);
  });

  it("is off for any OAUTH_DEV_MODE value other than true", () => {
    expect(oauthDevModeFor({ ...GOOGLE, OAUTH_DEV_MODE: "1" })).toBe(false);
  });
});

describe("initNodeRuntime", () => {
  const RUNTIME_SYMBOL = Symbol.for(
    "@tanstack-start-template/memory-runtime",
  ) as unknown as symbol;
  const slot = globalThis as unknown as Record<symbol, unknown>;
  const devEnv = () => readNodeServerEnv({ ...BASE, ...DEV });
  const TEST_CONFIG = readNodeRequestServerConfig(devEnv());

  afterEach(() => {
    delete slot[RUNTIME_SYMBOL];
  });

  it("refuses to keep a runtime built from a different env", () => {
    initNodeRuntime(devEnv());
    expect(() =>
      initNodeRuntime(readNodeServerEnv({ ...BASE, ...GOOGLE })),
    ).toThrow(/already initialized from a different environment/);
    expect(createNodeRequestContainer(TEST_CONFIG).oauthDevMode).toBe(true);
  });

  it("keeps the runtime when the same env boots again (dev-server reload)", () => {
    initNodeRuntime(devEnv());
    const first = createNodeRequestContainer(TEST_CONFIG);
    initNodeRuntime(devEnv());
    // Per-runtime singletons, so identity here means the process kept
    // its one backend — and with it the data of the running dev server.
    expect(createNodeRequestContainer(TEST_CONFIG).objectStorage).toBe(
      first.objectStorage,
    );
  });

  it("refuses to build a container before initialization", () => {
    expect(() =>
      createNodeRequestContainer(readNodeRequestServerConfig(devEnv())),
    ).toThrow(/not initialized/);
  });
});

/**
 * 空値を「未設定」と読む規約は、素の射影ではなく tuning スキーマまで
 * 通して押さえる。空文字を転送すると `z.coerce` が `0` にして boot が
 * 落ちるので、既定値が返ることが「落とした」ことの証拠になる。
 */
describe("nodeServerEnvToTuningEnv", () => {
  const tuningFor = (source: Readonly<Record<string, string | undefined>>) =>
    nodeServerEnvToTuningEnv(
      readNodeServerEnv({ ...BASE, ...GOOGLE, ...source }),
    );

  it("boots on defaults when a container manifest expands the tuning variables to empty", () => {
    const tuning = tuningFor({
      OUTBOX_BATCH_SIZE: "",
      OUTBOX_LEASE_MS: "",
      OUTBOX_MAX_ATTEMPTS: "",
      OUTBOX_RETENTION_MS: "",
      SCOPE_TASK_LEASE_MS: "",
    });
    expect(tuning).toEqual({});
    expect(readScopeTaskTuning(tuning).leaseMs).toBe(SCOPE_TASK_LEASE_MS);
    expect(readRelayTuning(tuning).leaseMs).toBe(DEFAULT_LEASE_MS);
  });

  it("forwards a set lease to the tuning both workers read", () => {
    const tuning = tuningFor({
      OUTBOX_LEASE_MS: "1000",
      SCOPE_TASK_LEASE_MS: "60000",
    });
    expect(readScopeTaskTuning(tuning).leaseMs).toBe(60_000);
    expect(readRelayTuning(tuning).leaseMs).toBe(1000);
  });
});
