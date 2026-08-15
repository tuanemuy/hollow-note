import { AsyncLocalStorage } from "node:async_hooks";
import { isValidationError } from "@repo/core/application/errors";
import { requestHandler } from "@tanstack/react-start/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { devApprovalRedirect, devDenialRedirect } from "../devOAuth";
import { extractSerializedError, httpStatusFor } from "../errorResponse";

const container = vi.hoisted(() => ({
  oauthDevMode: false,
  config: { appUrl: "https://app.example.test" },
}));

const APP_URL = container.config.appUrl;

vi.mock("@repo/core/application/di/containerStore", () => ({
  getContainer: async () => container,
}));

const invalidRedirect = (run: () => unknown): void => {
  try {
    run();
  } catch (error) {
    expect(isValidationError(error) && error.code).toBe("INVALID_REDIRECT");
    return;
  }
  throw new Error("expected a ValidationError");
};

describe("devOAuth redirects", () => {
  it("carries code + state back to a same-origin redirect_uri", () => {
    const url = new URL(
      devApprovalRedirect({
        appUrl: APP_URL,
        redirectUri: `${APP_URL}/auth/callback/google`,
        state: "state-1",
        code: "code-1",
      }),
    );
    expect(url.pathname).toBe("/auth/callback/google");
    expect(url.searchParams.get("code")).toBe("code-1");
    expect(url.searchParams.get("state")).toBe("state-1");
  });

  it("carries error=access_denied + state on cancel", () => {
    const url = new URL(
      devDenialRedirect({
        appUrl: APP_URL,
        redirectUri: `${APP_URL}/auth/callback/google`,
        state: "state-1",
      }),
    );
    expect(url.searchParams.get("error")).toBe("access_denied");
    expect(url.searchParams.get("state")).toBe("state-1");
    expect(url.searchParams.get("code")).toBeNull();
  });

  it("refuses a redirect_uri on another origin", () => {
    invalidRedirect(() =>
      devApprovalRedirect({
        appUrl: APP_URL,
        redirectUri: "https://evil.example/auth/callback/google",
        state: "state-1",
        code: "code-1",
      }),
    );
  });

  it("refuses a redirect_uri that is not a URL", () => {
    invalidRedirect(() =>
      devDenialRedirect({
        appUrl: APP_URL,
        redirectUri: "/auth/callback/google",
        state: "state-1",
      }),
    );
  });
});

const START_CONTEXT_KEY = Symbol.for("tanstack-start:start-storage-context");

/**
 * server function を 1 リクエスト分の実行文脈で走らせ、投げられたものを
 * 返す（投げなければ `undefined`）。`errorResponseMiddleware` が
 * `setResponseStatus` を呼ぶので、実行文脈の外では 404 に落ちる経路その
 * ものが観測できない。
 */
async function thrownByServerFn(
  invoke: () => Promise<unknown>,
): Promise<unknown> {
  let error: unknown;
  const handler = requestHandler(async (request: Request) => {
    const globals = globalThis as unknown as Record<
      symbol,
      AsyncLocalStorage<unknown> | undefined
    >;
    const storage =
      globals[START_CONTEXT_KEY] ?? new AsyncLocalStorage<unknown>();
    globals[START_CONTEXT_KEY] = storage;
    await storage.run(
      { request, contextAfterGlobalMiddlewares: {} },
      async () => {
        try {
          await invoke();
        } catch (thrown) {
          error = thrown;
        }
      },
    );
    return new Response(null, { status: 204 });
  });
  await handler(
    new Request("https://app.example.test/_serverFn", { method: "POST" }),
    undefined,
  );
  return error;
}

/**
 * AC-6: 承認コードを実発行する経路が `OAUTH_DEV_MODE` のフラグに従うこと。
 * 起動時ガードが止めるのは env の側だけなので、フラグが偽のまま到達した
 * 要求をこの 1 本が塞ぐ。
 */
describe("submitDevConsentFn", () => {
  const consent = {
    redirectUri: `${APP_URL}/auth/callback/google`,
    state: "state-1",
    codeChallenge: "challenge-1",
    decision: "approve" as const,
    email: "victim@example.test",
    displayName: "Victim",
    emailVerified: true,
  };

  const thrownBySubmit = async (): Promise<unknown> => {
    const { submitDevConsentFn } = await import("@/routes/dev/-action");
    return thrownByServerFn(() => submitDevConsentFn({ data: consent }));
  };

  beforeEach(() => {
    container.oauthDevMode = false;
  });

  it("refuses to mint an authorization code when the dev IdP is off", async () => {
    const serialized = extractSerializedError(await thrownBySubmit());

    expect(serialized.kind).toBe("notFound");
    expect(httpStatusFor(serialized)).toBe(404);
  });

  it("accepts the same consent when the dev IdP is on", async () => {
    container.oauthDevMode = true;

    expect(await thrownBySubmit()).toBeUndefined();
  });
});
