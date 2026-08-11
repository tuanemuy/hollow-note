import type { ServiceArgs } from "../types";
import type { SignOutView } from "./view";

export type SignOutInput = Readonly<{
  sessionToken: string;
}>;

/**
 * Destroys the current session (UC-identity-009,
 * spec/usecases/identity.md#signout).
 *
 * Never fails. A malformed locator, a token that names no row and a row
 * already deleted are all the same outcome — the caller wanted to stop
 * being signed in, and it now is. Reporting them apart would only tell an
 * unauthenticated caller whether a token exists. Discarding the cookie is
 * the presentation layer's half of the same response.
 */
export async function signOut({
  container,
  input,
}: ServiceArgs<SignOutInput>): Promise<SignOutView> {
  const { secureTokenGenerator, sessionReader } = container;

  const userId = secureTokenGenerator.locateUser(input.sessionToken);
  if (userId === null) {
    return {};
  }
  const session = await sessionReader.findByTokenHash(
    userId,
    secureTokenGenerator.hashOf(input.sessionToken),
  );
  if (session === null) {
    return {};
  }
  await sessionReader.deleteById(session.id);
  return {};
}
