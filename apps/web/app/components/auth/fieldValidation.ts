import { EMAIL_MAX_LENGTH } from "./schema";

/**
 * P-01 / P-02 共通のメール形式チェック。ここで弾かないと `Email.create`
 * の invariant 違反として往復してしまい、画面には code 由来の共通文言
 * しか出せない（spec/design/index.md §9）。形式の指摘は入力の隣で出す。
 */
export function emailFormatError(value: string): string | null {
  if (value.length === 0) return "メールアドレスを入力してください";
  if (
    value.length > EMAIL_MAX_LENGTH ||
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)
  ) {
    return "メールアドレスの形式が正しくありません";
  }
  return null;
}
