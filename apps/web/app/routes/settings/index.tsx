import { createFileRoute, redirect } from "@tanstack/react-router";
import { SETTINGS_TABS } from "@/components/layout/SettingsTabs";

/**
 * `/settings` 自体はセクションを持たない枠（spec/pages/index.md#P-20）
 * なので、タブ列の先頭へ送る。入口の定義は `SETTINGS_TABS` の 1 か所
 * だけで、`AccountMenu` の導線と同じ根拠を共有する。
 */
export const Route = createFileRoute("/settings/")({
  beforeLoad: () => {
    throw redirect({ to: SETTINGS_TABS[0].href });
  },
});
