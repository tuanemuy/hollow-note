import { renderErrorMessage } from "@/presentation/errorDisplay";
import { extractSerializedError } from "@/presentation/errorResponse";

/**
 * P-25 の提出の失敗を、画面のどの状態へ落とすかまで決める
 * （spec/pages/index.md#P-25 の状態直和）。
 *
 * 3 つに割るのは行き先が違うからで、項目エラー欄はメールアドレス不一致
 * （確認不一致）の専用枠、`blocked` は参加中のワークスペースによる実行
 * 不可（PAGE-p25-004）、残りは入力と無関係な失敗を出すパネルの live
 * region になる。認証切れのような失敗を項目欄へ出すと、無関係な欄に
 * `aria-invalid` が付く。
 *
 * コンポーネントから分けてあるのは、DOM もサーバー関数のランタイムも
 * 無しでこの割り当てを単体テストできる形に保つため。
 */
export type SubmitFailure =
  | Readonly<{ target: "field"; message: string }>
  | Readonly<{ target: "panel"; message: string }>
  | Readonly<{ target: "blocked"; message: string }>;

export function submitFailure(error: unknown): SubmitFailure {
  const serialized = extractSerializedError(error);
  const message = renderErrorMessage(serialized);
  switch (serialized.code) {
    case "CONFIRMATION_MISMATCH":
      return { target: "field", message };
    case "WORKSPACE_MEMBERSHIPS_REMAIN":
      return { target: "blocked", message };
    default:
      return { target: "panel", message };
  }
}
