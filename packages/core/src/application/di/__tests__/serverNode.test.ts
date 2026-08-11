import { afterEach, describe, expect, it } from "vitest";
import { createMemoryRuntime } from "../memoryRuntime";
import {
  createNodeRequestContainer,
  initNodeRuntime,
  nodeServerEnvToRuntimeOptions,
  readNodeRequestServerConfig,
  readNodeServerEnv,
} from "../serverNode";

const BASE = { APP_URL: "http://localhost:3000" };
const GOOGLE = {
  GOOGLE_OAUTH_CLIENT_ID: "client-id",
  GOOGLE_OAUTH_CLIENT_SECRET: "client-secret",
};

/**
 * ADR-003 の選択規則は起動時の env スキーマに閉じる（`createMemoryRuntime`
 * 側に置くと env を持たないテストハーネスが全滅する）。
 */
describe("nodeServerEnvSchema OAuth provider selection", () => {
  it("selects the dev identity provider when OAUTH_DEV_MODE is true", () => {
    const env = readNodeServerEnv({ ...BASE, OAUTH_DEV_MODE: "true" });
    expect(nodeServerEnvToRuntimeOptions(env).oauth).toEqual({ mode: "dev" });
  });

  it("refuses the dev identity provider in production", () => {
    expect(() =>
      readNodeServerEnv({
        ...BASE,
        OAUTH_DEV_MODE: "true",
        NODE_ENV: "production",
      }),
    ).toThrow();
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
 * AC-6 / ADR-021: `/dev/oauth/authorize` の 404 ガードは env を直読みせず
 * `RequestContainer.oauthDevMode` だけを見る。ここで押さえるのは env から
 * そのフラグまでの経路で、ルート loader が偽で `notFound()` を投げる 1 行は
 * コード確認に留まる（progress.md に記録）。
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
    expect(oauthDevModeFor({ OAUTH_DEV_MODE: "true" })).toBe(true);
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
  const devEnv = () => readNodeServerEnv({ ...BASE, OAUTH_DEV_MODE: "true" });
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
