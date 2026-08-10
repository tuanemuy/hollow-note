import type { AppConfig } from "@repo/core/application/di/types";

export const content: Omit<AppConfig, "appUrl"> = {
  siteName: "Hollow",
  defaultTitle: "Hollow",
  defaultDescription:
    "あらゆるファイルをHTMLに変換して保存・共有するサービス。",
  themeColor: "#ffffff",
};
