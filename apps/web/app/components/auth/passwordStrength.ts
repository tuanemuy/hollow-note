import {
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
} from "@repo/core/domain/identity/valueObject";

/**
 * パスワード規則の UI 側の唯一の写し。合否を決めるのはドメインの
 * `PlainPassword`（`PASSWORD_MIN_LENGTH`〜`PASSWORD_MAX_LENGTH` 字・英字と
 * 数字を各 1 つ以上）だけで、ここが返すのは「その条件を満たすか」と、
 * 満たしたうえでどれだけ余裕があるかの 4 段階の目安。
 *
 * `score: 0` は「ドメインの条件を満たさない」を意味し、送信を止めてよいのは
 * この 0 のときだけ。1 以上の刻みは表示のためだけで、ここを厳しくすると
 * サーバーが受け付けるパスワードの利用者を締め出してしまう。
 */
export type PasswordStrength = Readonly<{
  score: 0 | 1 | 2 | 3 | 4;
  label: string;
}>;

const STRENGTH_LABELS = [
  "条件を満たしていません",
  "弱い",
  "ふつう",
  "十分",
  "とても強い",
] as const;

const hasLetter = (password: string): boolean => /[a-zA-Z]/.test(password);
const hasDigit = (password: string): boolean => /[0-9]/.test(password);
const meetsDomainRule = (password: string): boolean =>
  password.length >= PASSWORD_MIN_LENGTH &&
  password.length <= PASSWORD_MAX_LENGTH &&
  hasLetter(password) &&
  hasDigit(password);

export function passwordStrength(password: string): PasswordStrength {
  if (!meetsDomainRule(password)) {
    return { score: 0, label: STRENGTH_LABELS[0] };
  }
  const mixedCase = /[a-z]/.test(password) && /[A-Z]/.test(password);
  const bonus =
    (password.length >= 12 ? 1 : 0) +
    (password.length >= 16 ? 1 : 0) +
    (/[^a-zA-Z0-9]/.test(password) || mixedCase ? 1 : 0);
  const score = Math.min(1 + bonus, 4) as 1 | 2 | 3 | 4;
  return { score, label: STRENGTH_LABELS[score] };
}

export const PASSWORD_RULE_HINT = `${PASSWORD_MIN_LENGTH} 文字以上で、英字と数字の両方を含めます`;

/**
 * 入力欄に添える指摘。`passwordStrength` の `score: 0` と同じ条件を、
 * どこが足りないかまで分けて言う。
 */
export function passwordFieldError(password: string): string | null {
  if (password.length === 0) return "パスワードを入力してください";
  if (password.length < PASSWORD_MIN_LENGTH) {
    return `パスワードが短すぎます。${PASSWORD_MIN_LENGTH} 文字以上で入力してください`;
  }
  if (password.length > PASSWORD_MAX_LENGTH) {
    return `パスワードは ${PASSWORD_MAX_LENGTH} 文字までです`;
  }
  if (!hasLetter(password) || !hasDigit(password)) {
    return "英字と数字の両方を含めてください";
  }
  return null;
}
