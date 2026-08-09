import type { ReactNode } from "react";

/**
 * インラインアラート（spec/design/index.md §9）。白地 + セマンティック
 * カラーのヘアライン枠。`--alert-accent` 1 変数でトーンを切り替える。
 */
type AlertTone = "info" | "success" | "warning" | "error";

const ACCENT_BY_TONE: Record<AlertTone, string> = {
  info: "var(--color-info)",
  success: "var(--color-success)",
  warning: "var(--color-warning)",
  error: "var(--color-error)",
};

const ICON_BY_TONE: Record<AlertTone, ReactNode> = {
  info: (
    <>
      <circle cx="12" cy="12" r="10" />
      <line x1="12" y1="8" x2="12" y2="13" />
      <line x1="12" y1="17" x2="12.01" y2="17" />
    </>
  ),
  success: (
    <>
      <circle cx="12" cy="12" r="10" />
      <polyline points="16 9.5 10.8 15 8 12.3" />
    </>
  ),
  warning: (
    <>
      <circle cx="12" cy="12" r="10" />
      <polyline points="12 6 12 12 16 14" />
    </>
  ),
  error: (
    <>
      <circle cx="12" cy="12" r="10" />
      <line x1="12" y1="8" x2="12" y2="13" />
      <line x1="12" y1="17" x2="12.01" y2="17" />
    </>
  ),
};

type AlertProps = {
  tone: AlertTone;
  title: string;
  children?: ReactNode;
  actions?: ReactNode;
  role?: "alert" | "status" | "note";
};

export function Alert({
  tone,
  title,
  children,
  actions,
  role = "alert",
}: AlertProps) {
  return (
    <div
      role={role === "note" ? undefined : role}
      style={{
        ["--alert-accent" as string]: ACCENT_BY_TONE[tone],
        borderColor:
          "color-mix(in oklab, var(--alert-accent) 30%, transparent)",
      }}
      className="mb-5 flex items-start gap-3 rounded-md border p-3 pr-4 text-left shadow-xs"
    >
      <svg
        width="16"
        height="16"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
        className="mt-0.5 shrink-0"
        style={{ color: "var(--alert-accent)" }}
      >
        {ICON_BY_TONE[tone]}
      </svg>
      <div className="min-w-0">
        <div
          className="mb-0.5 text-sm font-semibold"
          style={{ color: "var(--alert-accent)" }}
        >
          {title}
        </div>
        {children !== undefined ? (
          <div className="text-sm text-ink-secondary">{children}</div>
        ) : null}
        {actions !== undefined ? (
          <div className="mt-3 flex flex-wrap gap-2">{actions}</div>
        ) : null}
      </div>
    </div>
  );
}
