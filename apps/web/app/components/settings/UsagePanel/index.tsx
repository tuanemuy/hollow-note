import type {
  LlmUsageView,
  PersonalUsageView,
  UsageLevelView,
} from "@repo/core/application/usage/view";
import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { ghostButtonClass } from "@/components/settings/panelStyles";
import { Alert } from "@/components/ui/Alert";
import { loadUsageSnapshot } from "./action";

/**
 * P-24 使用量（モック P24-settings-usage.html）。
 *
 * 読み取りだけの画面なので島を持たない。ワークスペースの行と「さらに
 * 読み込む」は本スライスでは常に空なので出さない（PAGE-p24-002 は別
 * スライス。無効ボタンの placeholder も置かない）。
 */
export async function UsagePanel({ userId }: { userId: string }) {
  const usage = await loadUsageSnapshot(userId);
  return (
    <div>
      <p className="mb-6 text-xs text-ink-tertiary">
        {formatUpdatedAt(usage.updatedAt)} 時点
      </p>
      <StorageAlert personal={usage.personal} />
      <UsageSection
        name={
          <>
            <span
              aria-hidden="true"
              className="inline-flex size-5 items-center justify-center rounded-sm bg-ink-secondary text-[9px] font-medium text-bg"
            >
              個
            </span>
            個人
          </>
        }
        figure={`${formatBytes(usage.personal.consumedBytes)} / ${formatBytes(usage.personal.limitBytes)}`}
        level={usage.personal.level}
        ratio={ratioOf(usage.personal.consumedBytes, usage.personal.limitBytes)}
        notes={
          usage.personal.level === "exceeded"
            ? [
                <span key="exceeded" className="text-error">
                  上限に達しています。新しいアップロードは受け付けられません
                </span>,
                `${usage.personal.noteCount} 件のノート`,
              ]
            : [`${usage.personal.noteCount} 件のノート`]
        }
      />
      <UsageSection
        name="AI 実行回数（今月）"
        figure={`${usage.llm.consumedCalls} / ${usage.llm.limitCalls} 回`}
        level={usage.llm.level}
        ratio={ratioOf(usage.llm.consumedCalls, usage.llm.limitCalls)}
        notes={[
          `${formatResetDate(usage.llm)}にリセットされます`,
          "機械的な変換は消費しません",
        ]}
      />
      <div className="flex flex-wrap items-center gap-3 border-t border-hairline py-5 text-xs text-ink-tertiary">
        <span>
          アカウントと保存されたデータをまとめて削除することもできます。
        </span>
        <Link className={`${ghostButtonClass} ml-auto`} to="/settings/danger">
          アカウント削除へ
        </Link>
      </div>
    </div>
  );
}

function StorageAlert({ personal }: { personal: PersonalUsageView }) {
  if (personal.level === "none") {
    return null;
  }
  if (personal.level === "exceeded") {
    return (
      <Alert
        role="status"
        tone="error"
        title="個人の保存容量が上限に達しました"
      >
        新しいアップロードは受け付けられません。読み終えたノートを削除するか、ゴミ箱を空にすると空きが増えます。
      </Alert>
    );
  }
  const percent = Math.round(
    ratioOf(personal.consumedBytes, personal.limitBytes) * 100,
  );
  return (
    <Alert
      role="status"
      tone="warning"
      title={`個人の保存容量が ${percent}% に達しています`}
    >
      上限に達すると新しいアップロードを受け付けられなくなります。読み終えたノートを削除するか、ゴミ箱を空にすると空きが増えます。
    </Alert>
  );
}

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

function UsageSection({
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

const KIB = 1024;
const MIB = 1024 * KIB;
const GIB = 1024 * MIB;

const BYTE_UNITS = [
  { scale: GIB, suffix: "GB" },
  { scale: MIB, suffix: "MB" },
  { scale: KIB, suffix: "KB" },
] as const;

function formatBytes(bytes: number): string {
  for (const unit of BYTE_UNITS) {
    if (bytes >= unit.scale) {
      const value = (bytes / unit.scale).toFixed(1);
      return `${value.endsWith(".0") ? value.slice(0, -2) : value} ${unit.suffix}`;
    }
  }
  return `${bytes} B`;
}

/** A zero limit admits nothing, so it reads as full rather than empty. */
function ratioOf(consumed: number, limit: number): number {
  return limit <= 0 ? 1 : consumed / limit;
}

const updatedDateFormat = new Intl.DateTimeFormat("ja-JP", {
  month: "long",
  day: "numeric",
});
const updatedTimeFormat = new Intl.DateTimeFormat("ja-JP", {
  hour: "2-digit",
  minute: "2-digit",
});

function formatUpdatedAt(updatedAt: Date): string {
  return `${updatedDateFormat.format(updatedAt)} ${updatedTimeFormat.format(updatedAt)}`;
}

// 課金期間は UTC の暦月なので、リセット日も UTC で読む — 端末の時間帯
// で丸めると月末に 1 日ずれた日付を出す。
const resetDateFormat = new Intl.DateTimeFormat("ja-JP", {
  month: "long",
  day: "numeric",
  timeZone: "UTC",
});

function formatResetDate(llm: LlmUsageView): string {
  return resetDateFormat.format(
    new Date(Date.UTC(llm.period.year, llm.period.month, 1)),
  );
}
