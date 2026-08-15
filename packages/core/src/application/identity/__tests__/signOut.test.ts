import { isValidationError } from "@repo/core/application/errors";
import { describe, expect, it } from "vitest";
import { createTestHarness, type TestHarness } from "../../__tests__/helpers";
import { authenticateSession } from "../authenticateSession";
import { signInWithPassword } from "../signInWithPassword";
import { signOut } from "../signOut";
import { DEFAULT_PASSWORD, signUpVerified } from "./authFlowHelpers";

const out = (h: TestHarness, sessionToken: string) =>
  signOut({ container: h.container, input: { sessionToken } });

const expectUnauthenticated = (promise: Promise<unknown>) =>
  expect(promise).rejects.toSatisfy(
    (error) => isValidationError(error) && error.code === "UNAUTHENTICATED",
  );

describe("signOut", () => {
  it("TC-identity-238: deletes the session so its token stops authenticating", async () => {
    const h = createTestHarness();
    const { sessionToken } = await signUpVerified(h);

    await expect(out(h, sessionToken)).resolves.toEqual({});

    expect(h.backend.sessions.size).toBe(0);
    await expectUnauthenticated(
      authenticateSession({ container: h.container, input: { sessionToken } }),
    );
  });

  it("TC-identity-239: signing out twice still succeeds", async () => {
    const h = createTestHarness();
    const { sessionToken } = await signUpVerified(h);
    await out(h, sessionToken);

    await expect(out(h, sessionToken)).resolves.toEqual({});
  });

  it("TC-identity-240: an unknown or malformed token still succeeds", async () => {
    const h = createTestHarness();
    await signUpVerified(h);

    await expect(out(h, "not-a-token")).resolves.toEqual({});
    await expect(out(h, "dXNlcg.deadbeef")).resolves.toEqual({});
    expect(h.backend.sessions.size).toBe(1);
  });

  it("TC-identity-241: the user's other session survives", async () => {
    const h = createTestHarness();
    const { userId, sessionToken } = await signUpVerified(h);
    const other = await signInWithPassword({
      container: h.container,
      input: {
        email: "user@example.com",
        password: DEFAULT_PASSWORD,
        clientKey: "other-device",
      },
    });

    await out(h, sessionToken);

    await expect(
      authenticateSession({
        container: h.container,
        input: { sessionToken: other.sessionToken },
      }),
    ).resolves.toMatchObject({ userId });
    expect(h.backend.sessions.size).toBe(1);
  });
});
