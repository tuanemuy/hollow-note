import { ValidationError } from "@repo/core/application/errors";

/**
 * dev IdP（ADR-021）の同意画面が組み立てる遷移先。
 *
 * `redirect_uri` はクエリー由来なので、そのまま `Location` に載せると
 * 開いたリダイレクターになる。受理するのはアプリ自身のオリジンに限り、
 * 判定はここ 1 箇所に閉じる。`OAUTH_DEV_MODE` の真偽そのものは
 * composition root が `RequestContainer.oauthDevMode` として供給する
 * ので、この層は env を読まない。
 *
 * フレームワーク非依存の純関数として置く（単体テストが
 * `createServerFn` の実行時を引き込まずに import できる）。
 */
export function resolveDevRedirectUri(
  appUrl: string,
  redirectUri: string,
): URL {
  let target: URL;
  try {
    target = new URL(redirectUri);
  } catch {
    throw new ValidationError("INVALID_REDIRECT", "redirect_uri is not a URL");
  }
  if (target.origin !== new URL(appUrl).origin) {
    throw new ValidationError(
      "INVALID_REDIRECT",
      "redirect_uri must stay on this origin",
    );
  }
  return target;
}

export function devApprovalRedirect(
  params: Readonly<{
    appUrl: string;
    redirectUri: string;
    state: string;
    code: string;
  }>,
): string {
  const target = resolveDevRedirectUri(params.appUrl, params.redirectUri);
  target.searchParams.set("code", params.code);
  target.searchParams.set("state", params.state);
  return target.toString();
}

export function devDenialRedirect(
  params: Readonly<{ appUrl: string; redirectUri: string; state: string }>,
): string {
  const target = resolveDevRedirectUri(params.appUrl, params.redirectUri);
  target.searchParams.set("error", "access_denied");
  target.searchParams.set("state", params.state);
  return target.toString();
}
