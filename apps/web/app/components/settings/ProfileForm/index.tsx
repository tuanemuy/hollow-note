import { loadProfile } from "./action";
import { ProfileEditor } from "./editor";

/**
 * P-21 プロフィール設定の本体（モック P21-settings-profile.html）。
 *
 * 読み出しはこのサーバーコンポーネントが行い、編集はすべて島
 * （`ProfileEditor`）に渡す。ハンドルの接頭辞は配備のオリジンから
 * 作るので、島が `config` を読まずに済むようここで解決する。
 *
 * 公開プロフィールのプレビュー導線は出さない（遷移先 P-42 が別スライス。
 * 無効ボタンの placeholder も置かない）。
 */
export async function ProfileForm({
  userId,
  appUrl,
}: {
  userId: string;
  appUrl: string;
}) {
  const profile = await loadProfile(userId);
  return (
    <ProfileEditor profile={profile} handlePrefix={handlePrefix(appUrl)} />
  );
}

function handlePrefix(appUrl: string): string {
  try {
    return `${new URL(appUrl).host}/@`;
  } catch {
    return "/@";
  }
}
