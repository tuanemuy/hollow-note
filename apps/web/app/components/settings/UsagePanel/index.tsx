import type {
  LlmUsageView,
  PersonalUsageView,
} from "@repo/core/application/usage/view";
import { Link } from "@tanstack/react-router";
import { ghostButtonClass } from "@/components/settings/panelStyles";
import { Alert } from "@/components/ui/Alert";
import { loadUsageSnapshot } from "./action";
import { WorkspaceUsageBoard } from "./board";
import { formatBytes, ratioOf, ScopeBadge, UsageSection } from "./section";

/**
 * P-24 使用量（モック P24-settings-usage.html）。
 *
 * 個人と LLM の数値はここで描き、ワークスペース別の内訳と「20 件ずつ
 * 読み込む」導線は `WorkspaceUsageBoard` が所有する（追加読み込みが
 * 一覧メンバーシップの変更だから）。並び順はモックどおり
 * 個人 → ワークスペース → 追加読み込み → AI 実行回数。
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
            <ScopeBadge>個</ScopeBadge>個人
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
      <WorkspaceUsageBoard
        initialWorkspaces={usage.workspaces}
        initialCursor={usage.nextWorkspaceCursor}
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

// 同じパネルに並ぶリセット日と基準を揃える（下の `resetDateFormat` と
// 同じ理由で UTC 固定。片方だけ配備の時間帯に従うと、同一画面の 2 つの
// 日時が別基準になる）。ただしこちらは暦月境界ではなく実時刻なので、
// 基準を表示にも添えないと閲覧者の時計とずれた時刻に読める。
const updatedDateFormat = new Intl.DateTimeFormat("ja-JP", {
  month: "long",
  day: "numeric",
  timeZone: "UTC",
});
const updatedTimeFormat = new Intl.DateTimeFormat("ja-JP", {
  hour: "2-digit",
  minute: "2-digit",
  timeZone: "UTC",
});

function formatUpdatedAt(updatedAt: Date): string {
  return `${updatedDateFormat.format(updatedAt)} ${updatedTimeFormat.format(updatedAt)}（UTC）`;
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
