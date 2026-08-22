import { AsyncLocalStorage } from "node:async_hooks";
import { createHash } from "node:crypto";
import { createMemoryOAuthStateStore } from "@repo/core/adapters/memory/repositories/oauthStateStore";
import { createNodeSecureTokenGenerator } from "@repo/core/adapters/memory/secureTokenGenerator";
import { MemoryBackend } from "@repo/core/adapters/memory/store";
import {
  isValidationError,
  ValidationError,
} from "@repo/core/application/errors";
import { requestHandler } from "@tanstack/react-start/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * 束縛の「配線」を守るテスト。固定するのは server function の中の順序と
 * 破棄の条件 — 開始が束縛の秘密そのものを Cookie に焼くこと、`state` だけ
 * を知る第三者の Cookie では `state` 行が消費されないこと、照合を通らな
 * かった要求では Cookie を捨てないこと。この配線が壊れると login CSRF が
 * 復活する。
 *
 * `oauthStateStore` / `secureTokenGenerator` は参照アダプターを差す。
 * 条件付き消費をモックで再現すると、「不一致では消費されない」を満たして
 * いるのが実装ではなくテストになる。
 */

const STATE = "state-1";
const BINDING = "binding-secret-1";
const AUTHORIZATION_URL = "https://idp.example.test/authorize?state=state-1";
const COOKIE_NAME = "hollow_oauth_state";
const TTL_MS = 10 * 60 * 1000;
const NOW = new Date("2024-01-01T00:00:00.000Z");

const sha256 = (value: string): string =>
  createHash("sha256").update(value).digest("hex");

const clock = { now: () => NOW };
const secureTokenGenerator = createNodeSecureTokenGenerator();
let backend: MemoryBackend;
let oauthStateStore: ReturnType<typeof createMemoryOAuthStateStore>;
// 実装そのものに委譲したまま「呼ばれたか」だけを数える。
let take: ReturnType<typeof vi.fn>;
let logger: Record<"info" | "warn" | "error", ReturnType<typeof vi.fn>>;

vi.mock("@repo/core/application/di/containerStore", () => ({
  getContainer: async () => ({
    oauthStateStore,
    secureTokenGenerator,
    clock,
    logger,
    config: { appUrl: "https://app.example.test" },
    signInOAuthClient: {
      exchangeCode: async () => {
        throw new ValidationError(
          "OAUTH_EMAIL_UNVERIFIED",
          "The provider has not verified this email address",
        );
      },
    },
  }),
}));

vi.mock("@repo/core/application/identity/startOAuthFlow", async (original) => ({
  ...(await original<Record<string, unknown>>()),
  startOAuthFlow: async () => ({
    stateBinding: BINDING,
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

const cookieOf = (value: string): string => `${COOKIE_NAME}=${value}`;

const bindingHeader = (outcome: Outcome): string | undefined =>
  outcome.setCookie.find((header) => header.startsWith(`${COOKIE_NAME}=`));

const stateInvalid = (outcome: Outcome): boolean =>
  isValidationError(outcome.error) &&
  outcome.error.code === "OAUTH_STATE_INVALID";

const storedState = () => backend.oauthStates.get(STATE);

const loadActions = () => import("@/routes/auth/-action");

async function parkFlow(): Promise<void> {
  await oauthStateStore.put(
    STATE,
    {
      provider: "google",
      codeVerifier: "verifier-1",
      redirectTo: null,
      intent: "signIn",
      userId: null,
      userAuthEpoch: null,
      stateBindingHash: secureTokenGenerator.hashOf(BINDING),
    },
    TTL_MS,
  );
}

beforeEach(() => {
  backend = new MemoryBackend({ clock });
  const store = createMemoryOAuthStateStore(backend);
  take = vi.fn(store.take);
  oauthStateStore = { ...store, take: take as typeof store.take };
  logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
});

describe("startOAuthSignInFn", () => {
  it("bakes the flow's own secret, which the state cannot produce", async () => {
    const { startOAuthSignInFn } = await loadActions();

    const outcome = await callServerFn(() =>
      startOAuthSignInFn({ data: { provider: "google", redirectTo: null } }),
    );

    const header = bindingHeader(outcome);
    expect(header).toContain(BINDING);
    expect(header).not.toContain(STATE);
    expect(header).not.toContain(sha256(STATE));
    expect(header).toContain("HttpOnly");
    expect(header).toContain("SameSite=Lax");
    expect(header).toContain("Path=/");
  });
});

describe("completeOAuthCallbackFn", () => {
  it("refuses a callback with no binding cookie without consuming the state", async () => {
    const { completeOAuthCallbackFn } = await loadActions();
    await parkFlow();

    const outcome = await callServerFn(() =>
      completeOAuthCallbackFn({
        data: { provider: "google", state: STATE, code: "code-1" },
      }),
    );

    expect(stateInvalid(outcome)).toBe(true);
    expect(take).not.toHaveBeenCalled();
    expect(storedState()).toBeDefined();
  });

  it("refuses the cookies a holder of the state alone could produce, leaving the row", async () => {
    const { completeOAuthCallbackFn } = await loadActions();

    for (const value of [STATE, sha256(STATE), "guessed-binding"]) {
      await parkFlow();
      const outcome = await callServerFn(
        () =>
          completeOAuthCallbackFn({
            data: { provider: "google", state: STATE, code: "code-1" },
          }),
        cookieOf(value),
      );

      expect(stateInvalid(outcome)).toBe(true);
      expect(storedState()).toBeDefined();
      // 別のブラウザーが進行中のフローの Cookie なので触らない。
      expect(bindingHeader(outcome)).toBeUndefined();
    }
  });

  it("consumes the state and drops the cookie once the binding holds", async () => {
    const { completeOAuthCallbackFn } = await loadActions();
    await parkFlow();

    const outcome = await callServerFn(
      () =>
        completeOAuthCallbackFn({
          data: { provider: "google", state: STATE, code: "code-1" },
        }),
      cookieOf(BINDING),
    );

    expect(storedState()).toBeUndefined();
    // 交換は決定的に失敗させてある。それでも `OAUTH_STATE_INVALID` では
    // ないので、束縛は残らない。
    expect(isValidationError(outcome.error) && outcome.error.code).toBe(
      "OAUTH_EMAIL_UNVERIFIED",
    );
    expect(bindingHeader(outcome)).toContain("Max-Age=0");
  });
});

describe("abandonOAuthFlowFn", () => {
  it("drops the cookie and releases the row of a round trip that will never be consumed", async () => {
    const { abandonOAuthFlowFn } = await loadActions();
    await parkFlow();

    const outcome = await callServerFn(
      () => abandonOAuthFlowFn({ data: { state: STATE } }),
      cookieOf(BINDING),
    );

    expect(bindingHeader(outcome)).toContain("Max-Age=0");
    expect(storedState()).toBeUndefined();
  });

  it("keeps the cookie and the row of another browser's flow", async () => {
    const { abandonOAuthFlowFn } = await loadActions();
    await parkFlow();

    const outcome = await callServerFn(
      () => abandonOAuthFlowFn({ data: { state: STATE } }),
      cookieOf("another-browsers-binding"),
    );

    // 不一致を弾いているのは転送境界ではなく条件付き `take` なので、
    // 呼ばれたうえで行が残っていることまで見る。
    expect(take).toHaveBeenCalledTimes(1);
    expect(bindingHeader(outcome)).toBeUndefined();
    expect(storedState()).toBeDefined();
  });

  it("does nothing at all when the request carries no binding cookie", async () => {
    const { abandonOAuthFlowFn } = await loadActions();
    await parkFlow();

    const outcome = await callServerFn(() =>
      abandonOAuthFlowFn({ data: { state: STATE } }),
    );

    expect(take).not.toHaveBeenCalled();
    expect(outcome.setCookie).toHaveLength(0);
    expect(storedState()).toBeDefined();
  });

  it("records a failed cleanup instead of failing the callback screen", async () => {
    const { abandonOAuthFlowFn } = await loadActions();
    await parkFlow();
    const failure = new Error("the state store is unavailable");
    take.mockRejectedValueOnce(failure);

    const outcome = await callServerFn(
      () => abandonOAuthFlowFn({ data: { state: STATE } }),
      cookieOf(BINDING),
    );

    // 応答 `null` はこの harness では常に `TypeError` になるので、主張は
    // 「例外が無い」ではなく「ストアの失敗が呼び出し側へ漏れない」に置く。
    expect(outcome.error).not.toBe(failure);
    expect(logger.error).toHaveBeenCalledWith(
      "Abandoning the OAuth flow failed",
      { cause: failure },
    );
    expect(bindingHeader(outcome)).toBeUndefined();
  });
});
