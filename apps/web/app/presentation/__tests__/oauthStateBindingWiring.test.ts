import { AsyncLocalStorage } from "node:async_hooks";
import { isValidationError } from "@repo/core/application/errors";
import { requestHandler } from "@tanstack/react-start/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { deriveOAuthStateBinding } from "../oauthStateBinding";

/**
 * 束縛の「配線」を守るテスト。純関数側は
 * `oauthStateBinding.test.ts` が持つので、ここが固定するのは server
 * function の中の順序だけ — 開始が Cookie を焼くこと、照合が `state` の
 * 消費より**前**に走ること、照合を通ったら成否によらず Cookie が残らない
 * こと。この順序が壊れると login CSRF が復活する。
 */

const STATE = "state-1";
const AUTHORIZATION_URL = "https://idp.example.test/authorize?state=state-1";
const COOKIE_NAME = "hollow_oauth_state";

const take = vi.fn(async (_state: string) => null);

vi.mock("@repo/core/application/di/containerStore", () => ({
  getContainer: async () => ({
    oauthStateStore: { take },
    clock: { now: () => new Date("2024-01-01T00:00:00.000Z") },
  }),
}));

vi.mock("@repo/core/application/identity/startOAuthFlow", async (original) => ({
  ...(await original<Record<string, unknown>>()),
  startOAuthFlow: async () => ({
    state: STATE,
    authorizationUrl: AUTHORIZATION_URL,
  }),
}));

const START_CONTEXT_KEY = Symbol.for("tanstack-start:start-storage-context");

type Outcome = {
  error: unknown;
  setCookie: readonly string[];
};

/**
 * server function のハンドラーを 1 リクエスト分の実行文脈（h3 event +
 * Start context）の中で走らせる。Cookie の読み書きはモックせず、実際の
 * `Cookie` ヘッダーと `Set-Cookie` ヘッダーで観測する。
 */
async function callServerFn(
  invoke: () => Promise<unknown>,
  cookie?: string,
): Promise<Outcome> {
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
  const response = await handler(
    new Request(
      "https://app.example.test/_serverFn",
      cookie !== undefined
        ? { method: "POST", headers: { cookie } }
        : { method: "POST" },
    ),
    undefined,
  );
  return { error, setCookie: response.headers.getSetCookie() };
}

const bindingCookie = async (state: string): Promise<string> =>
  `${COOKIE_NAME}=${await deriveOAuthStateBinding(state)}`;

const bindingHeader = (outcome: Outcome): string | undefined =>
  outcome.setCookie.find((header) => header.startsWith(`${COOKIE_NAME}=`));

const loadActions = () => import("@/routes/auth/-action");

beforeEach(() => {
  take.mockClear();
});

describe("startOAuthSignInFn", () => {
  it("bakes the binding cookie for the browser that starts the flow", async () => {
    const { startOAuthSignInFn } = await loadActions();

    const outcome = await callServerFn(() =>
      startOAuthSignInFn({ data: { provider: "google", redirectTo: null } }),
    );

    const header = bindingHeader(outcome);
    expect(header).toContain(await deriveOAuthStateBinding(STATE));
    expect(header).not.toContain(STATE);
    expect(header).toContain("HttpOnly");
    expect(header).toContain("SameSite=Lax");
    expect(header).toContain("Path=/");
  });
});

describe("completeOAuthCallbackFn", () => {
  it("refuses a callback with no binding cookie without consuming the state", async () => {
    const { completeOAuthCallbackFn } = await loadActions();

    const outcome = await callServerFn(() =>
      completeOAuthCallbackFn({
        data: { provider: "google", state: STATE, code: "code-1" },
      }),
    );

    expect(isValidationError(outcome.error) && outcome.error.code).toBe(
      "OAUTH_STATE_INVALID",
    );
    expect(take).not.toHaveBeenCalled();
  });

  it("refuses another browser's callback without consuming the state or the victim's cookie", async () => {
    const { completeOAuthCallbackFn } = await loadActions();

    const outcome = await callServerFn(
      () =>
        completeOAuthCallbackFn({
          data: { provider: "google", state: "attacker-state", code: "code-1" },
        }),
      await bindingCookie(STATE),
    );

    expect(isValidationError(outcome.error) && outcome.error.code).toBe(
      "OAUTH_STATE_INVALID",
    );
    expect(take).not.toHaveBeenCalled();
    expect(bindingHeader(outcome)).toBeUndefined();
  });

  it("consumes the state and drops the binding cookie once the binding holds", async () => {
    const { completeOAuthCallbackFn } = await loadActions();

    const outcome = await callServerFn(
      () =>
        completeOAuthCallbackFn({
          data: { provider: "google", state: STATE, code: "code-1" },
        }),
      await bindingCookie(STATE),
    );

    expect(take).toHaveBeenCalledWith(STATE);
    // `take` が空を返す＝この往復は完了できないが、それでも束縛は残らない。
    expect(isValidationError(outcome.error) && outcome.error.code).toBe(
      "OAUTH_STATE_INVALID",
    );
    expect(bindingHeader(outcome)).toContain("Max-Age=0");
  });
});

describe("abandonOAuthFlowFn", () => {
  it("drops the binding cookie of a round trip that will never be consumed", async () => {
    const { abandonOAuthFlowFn } = await loadActions();

    const outcome = await callServerFn(
      () => abandonOAuthFlowFn(),
      await bindingCookie(STATE),
    );

    expect(bindingHeader(outcome)).toContain("Max-Age=0");
  });
});
