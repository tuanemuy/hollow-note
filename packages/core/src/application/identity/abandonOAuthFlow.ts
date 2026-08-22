import type { ServiceArgs } from "../types";
import type { AbandonOAuthFlowView } from "./view";

export type AbandonOAuthFlowInput = Readonly<{
  state: string;
  /** Plaintext of the secret the flow handed to the starting browser. */
  stateBinding: string;
}>;

/**
 * Cleans up after a round trip that ends without a consuming call — the
 * provider answered with a refusal, or the callback arrived without a
 * `code` (UC-identity-025, spec/usecases/identity.md#abandonoauthflow).
 *
 * The row is released only when the binding matches, and the transport
 * boundary may drop its cookie only on that answer: dropping it
 * unconditionally would let anyone burn down someone else's in-flight
 * flow by making them load the callback URL.
 */
export async function abandonOAuthFlow({
  container,
  input,
}: ServiceArgs<AbandonOAuthFlowInput>): Promise<AbandonOAuthFlowView> {
  const flow = await container.oauthStateStore.take(
    input.state,
    container.secureTokenGenerator.hashOf(input.stateBinding),
  );
  return { abandoned: flow !== null };
}
