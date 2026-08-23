import { describe, expect, it } from "vitest";
import { createTestHarness } from "../../__tests__/helpers";
import { abandonOAuthFlow } from "../abandonOAuthFlow";
import { beginOAuthFlow } from "./authFlowHelpers";

describe("abandonOAuthFlow", () => {
  it("TC-identity-338: releases the flow row when the binding matches", async () => {
    const h = createTestHarness();
    const flow = await beginOAuthFlow(h, { intent: "signIn" });

    const view = await abandonOAuthFlow({
      container: h.container,
      input: { state: flow.state, stateBinding: flow.stateBinding },
    });

    expect(view.abandoned).toBe(true);
    expect(h.backend.oauthStates.get(flow.state)).toBeUndefined();
  });

  it("TC-identity-339: leaves another browser's flow row untouched", async () => {
    const h = createTestHarness();
    const flow = await beginOAuthFlow(h, { intent: "signIn" });

    const view = await abandonOAuthFlow({
      container: h.container,
      input: { state: flow.state, stateBinding: "not-the-binding" },
    });

    expect(view.abandoned).toBe(false);
    expect(h.backend.oauthStates.get(flow.state)).toBeDefined();
  });

  it("TC-identity-340: an unknown state is simply not abandoned", async () => {
    const h = createTestHarness();

    const view = await abandonOAuthFlow({
      container: h.container,
      input: { state: "never-issued", stateBinding: "binding" },
    });

    expect(view.abandoned).toBe(false);
  });
});
