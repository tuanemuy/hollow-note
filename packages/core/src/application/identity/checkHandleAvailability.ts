import { Handle, UserId } from "@repo/core/domain/identity/valueObject";
import type { ServiceArgs } from "../types";
import type { HandleAvailabilityView } from "./view";

export type CheckHandleAvailabilityInput = Readonly<{
  userId: string;
  handle: string;
}>;

/**
 * Tells the profile form whether a handle is free before it is saved
 * (P-21 の「ハンドル重複（候補提示）」).
 *
 * An **advisory** read, not a claim: only `updateProfile`'s reservation
 * decides the winner, so a handle reported free can still lose a race and
 * come back as `HANDLE_ALREADY_USED`. It resolves durable claims only, so
 * a key another request merely reserved reads as free — which is the
 * conservative direction for a hint.
 *
 * Public handles are public by construction (they are URLs), so answering
 * this is not the kind of oracle
 * spec/adr/028-account-enumeration-resistance.md guards against; the
 * caller is still an authenticated session.
 */
export async function checkHandleAvailability({
  container,
  input,
}: ServiceArgs<CheckHandleAvailabilityInput>): Promise<HandleAvailabilityView> {
  const userId = UserId.create(input.userId);
  const handle = Handle.create(input.handle);
  const holder = await container.identityUniqueDirectory.resolve(
    "handle",
    handle,
  );
  return {
    handle,
    available: holder === null || holder === userId,
    ownedBySelf: holder === userId,
  };
}
