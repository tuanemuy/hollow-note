import { describe, expect, it } from "vitest";
import {
  nodeServerEnvToRuntimeOptions,
  readNodeServerEnv,
} from "../serverNode";

const BASE = { APP_URL: "http://localhost:3000" };

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
    const env = readNodeServerEnv({
      ...BASE,
      GOOGLE_OAUTH_CLIENT_ID: "client-id",
      GOOGLE_OAUTH_CLIENT_SECRET: "client-secret",
    });
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
