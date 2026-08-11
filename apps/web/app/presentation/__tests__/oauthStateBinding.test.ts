import { isValidationError } from "@repo/core/application/errors";
import { describe, expect, it } from "vitest";
import {
  assertOAuthStateBinding,
  deriveOAuthStateBinding,
} from "../oauthStateBinding";

const capture = (promise: Promise<unknown>) =>
  promise.then(
    () => null,
    (thrown: unknown) => thrown,
  );

describe("deriveOAuthStateBinding", () => {
  it("is deterministic and never exposes the state itself", async () => {
    const binding = await deriveOAuthStateBinding("state-1");

    expect(binding).toBe(await deriveOAuthStateBinding("state-1"));
    expect(binding).not.toContain("state-1");
    expect(binding).toMatch(/^[0-9a-f]{64}$/);
  });

  it("separates two flows", async () => {
    expect(await deriveOAuthStateBinding("state-1")).not.toBe(
      await deriveOAuthStateBinding("state-2"),
    );
  });
});

describe("assertOAuthStateBinding", () => {
  it("accepts the browser that started the flow", async () => {
    await expect(
      assertOAuthStateBinding(
        await deriveOAuthStateBinding("state-1"),
        "state-1",
      ),
    ).resolves.toBeUndefined();
  });

  it("refuses a callback started in another browser (login CSRF)", async () => {
    const error = await capture(
      assertOAuthStateBinding(
        await deriveOAuthStateBinding("victim-state"),
        "attacker-state",
      ),
    );

    expect(isValidationError(error) && error.code).toBe("OAUTH_STATE_INVALID");
  });

  it("refuses when no binding cookie is present", async () => {
    const error = await capture(assertOAuthStateBinding(null, "state-1"));

    expect(isValidationError(error) && error.code).toBe("OAUTH_STATE_INVALID");
  });

  it("refuses a cookie carrying the raw state", async () => {
    const error = await capture(assertOAuthStateBinding("state-1", "state-1"));

    expect(isValidationError(error) && error.code).toBe("OAUTH_STATE_INVALID");
  });
});
