/**
 * ADR 029: a session cookie is issued only to the browser that asked for the
 * verification. `pendingUserId` is the `userId` left behind by `signUpFn` in
 * the pending-verification cookie (`null` when absent); `view` is the result
 * of the `verifyEmail` usecase.
 *
 * Kept free of framework imports so it can be unit-tested: it is the only
 * guard against login CSRF (an attacker making a victim open the attacker's
 * verification link would otherwise plant the attacker's session).
 *
 * `sessionToken === null` means the token was already consumed
 * (`alreadyVerified`), which never issues a session either.
 */
export function shouldIssueVerificationSession<
  TView extends { userId: string; sessionToken: string | null },
>(
  pendingUserId: string | null,
  view: TView,
): view is TView & { sessionToken: string } {
  return view.sessionToken !== null && pendingUserId === view.userId;
}
