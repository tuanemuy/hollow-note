import { EMAIL_MAX_LENGTH, EMAIL_PATTERN } from "./schema";

/**
 * P-01 / P-02 共通のメール形式チェック。ここで弾かないと `Email.create`
 * の invariant 違反として往復してしまい、画面には code 由来の共通文言
 * しか出せない（spec/design/index.md §9）。形式の指摘は入力の隣で出す。
 *
 * 判定はドメインの `Email` と同じ正規化（trim）・同じパターンで行う。
 * この結果は送信ボタンの活性も決めるため、ドメインより厳しくすると
 * サーバーが受け付けるアドレスの利用者を締め出してしまう。
 */
export function emailFormatError(value: string): string | null {
  const normalized = value.trim();
  if (normalized.length === 0) return "メールアドレスを入力してください";
  if (normalized.length > EMAIL_MAX_LENGTH || !EMAIL_PATTERN.test(normalized)) {
    return "メールアドレスの形式が正しくありません";
  }
  return null;
}
