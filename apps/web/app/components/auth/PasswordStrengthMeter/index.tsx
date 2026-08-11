import type { PasswordStrength } from "../passwordStrength";

/**
 * 4 本のバーと文言で強度を見せる目安表示（モック P01 / P04 / P22 の
 * `.strength`）。判定は持たず `passwordStrength` の結果を描くだけなので、
 * 同じパスワードは 3 画面で必ず同じ見た目になる。
 */
export function PasswordStrengthMeter({
  strength,
}: {
  strength: PasswordStrength;
}) {
  return (
    <>
      <div className="mt-2 flex gap-[3px]" aria-hidden="true">
        {[0, 1, 2, 3].map((index) => (
          <i
            key={index}
            className={`h-[3px] flex-1 rounded-xs ${
              index < strength.score
                ? strength.score >= 3
                  ? "bg-success"
                  : "bg-warning"
                : "bg-hairline"
            }`}
          />
        ))}
      </div>
      <p className="mt-1 text-xs text-ink-secondary">強さ: {strength.label}</p>
    </>
  );
}
