import type { UsageLevelView } from "@repo/core/application/usage/view";
import type { ReactNode } from "react";

/**
 * P-24 の 1 セクション（モック P24-settings-usage.html の `.usage`）と、
 * その数値整形。
 *
 * `"use client"` を付けないのは、サーバーコンポーネント（個人 / LLM）と
 * クライアントの島（ワークスペースの追加読み込み）の両方から使うため。
 * フックを持たない純粋な描画なので、どちらのグラフに載っても同じものが
 * 出る。整形も `Intl` を使わない算術だけに閉じてあり、サーバーが描いた
 * 行とブラウザーが足した行で表記がずれない。
 */
const FIGURE_CLASS_BY_LEVEL: Record<UsageLevelView, string> = {
  none: "text-ink-secondary",
  warning: "text-warning",
  exceeded: "text-error",
};

const METER_CLASS_BY_LEVEL: Record<UsageLevelView, string> = {
  none: "bg-accent",
  warning: "bg-warning",
  exceeded: "bg-error",
};

export function UsageSection({
  name,
  figure,
  level,
  ratio,
  notes,
}: {
  name: ReactNode;
  figure: string;
  level: UsageLevelView;
  ratio: number;
  notes: readonly ReactNode[];
}) {
  return (
    <section className="border-t border-hairline py-5">
      <div className="mb-3 flex flex-wrap items-baseline gap-3">
        <span className="inline-flex items-center gap-2 text-sm font-medium">
          {name}
        </span>
        <span
          className={`ml-auto text-sm tabular-nums ${FIGURE_CLASS_BY_LEVEL[level]}`}
        >
          {figure}
        </span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-surface">
        <span
          aria-hidden="true"
          className={`block h-full rounded-full ${METER_CLASS_BY_LEVEL[level]}`}
          style={{ width: `${Math.min(100, Math.round(ratio * 100))}%` }}
        />
      </div>
      <p className="mt-2 flex flex-wrap gap-2 text-xs text-ink-tertiary">
        {notes.map((note, index) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: 表示順そのものが同一性
          <span key={index} className="flex gap-2">
            {index > 0 ? (
              <span aria-hidden="true" className="text-hairline-strong">
                ·
              </span>
            ) : null}
            {note}
          </span>
        ))}
      </p>
    </section>
  );
}

export function ScopeBadge({ children }: { children: ReactNode }) {
  return (
    <span
      aria-hidden="true"
      className="inline-flex size-5 items-center justify-center rounded-sm bg-ink-secondary text-[9px] font-medium text-bg"
    >
      {children}
    </span>
  );
}

const KIB = 1024;
const MIB = 1024 * KIB;
const GIB = 1024 * MIB;

const BYTE_UNITS = [
  { scale: GIB, suffix: "GB" },
  { scale: MIB, suffix: "MB" },
  { scale: KIB, suffix: "KB" },
] as const;

export function formatBytes(bytes: number): string {
  for (const unit of BYTE_UNITS) {
    if (bytes >= unit.scale) {
      const value = (bytes / unit.scale).toFixed(1);
      return `${value.endsWith(".0") ? value.slice(0, -2) : value} ${unit.suffix}`;
    }
  }
  return `${bytes} B`;
}

/** A zero limit admits nothing, so it reads as full rather than empty. */
export function ratioOf(consumed: number, limit: number): number {
  return limit <= 0 ? 1 : consumed / limit;
}
