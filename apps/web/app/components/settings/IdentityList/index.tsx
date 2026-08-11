import { loadIdentities } from "./action";
import { IdentityBoard } from "./board";

/**
 * P-22 ログイン方法設定の本体（モック P22-settings-auth.html）。
 *
 * 読み出しはこのサーバーコンポーネントが行い、操作はすべて島
 * （`IdentityBoard`）に渡す。追加 / 解除はリストの増減なので、島が
 * `useOptimistic` ごと所有する。
 */
export async function IdentityList({ userId }: { userId: string }) {
  const { identities, removable } = await loadIdentities(userId);
  return <IdentityBoard identities={identities} removable={removable} />;
}
