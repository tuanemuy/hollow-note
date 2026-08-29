import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { errorResponseMiddleware } from "@/presentation/errorResponseMiddleware";
import { renderServerFragment } from "@/presentation/serverFragment";
import { validateInput } from "@/presentation/validator";

/**
 * P-43 の断片ブリッジ。**セッションを要求しない**唯一のアプリ側
 * ブリッジで、`requireSession*` を呼ばずに `sessionUserOrNull` を読む
 * — 未サインインの閲覧者がこの画面の主な利用者だからである。
 *
 * スラッグと絞り込み条件は URL から来る外部入力なので、形と DoS 上限を
 * ここで閉じる（業務上の字種と予約語は `WorkspaceSlug` が見る）。
 */
export const PUBLIC_SLUG_MAX_LENGTH = 64;
const PUBLIC_KEYWORD_MAX_LENGTH = 200;
const PUBLIC_TAG_MAX_LENGTH = 64;
const PUBLIC_TAG_MAX_COUNT = 10;

const publicWorkspaceInputSchema = z.object({
  slug: z.string().min(1).max(PUBLIC_SLUG_MAX_LENGTH),
  keyword: z.string().max(PUBLIC_KEYWORD_MAX_LENGTH),
  tags: z
    .array(z.string().min(1).max(PUBLIC_TAG_MAX_LENGTH))
    .max(PUBLIC_TAG_MAX_COUNT),
});

/**
 * 名前と説明だけは断片とは別に素の値で返す（設定レイアウトと同じ形）。
 * ルートの `head` は断片の解決を待てないので、これが無いとすべての公開
 * ページが同じタイトルになり、共有カードも検索結果も区別が付かない
 * （PAGE-p43-001 の metadata）。
 *
 * 見つからないスラッグは断片側が終端表示に畳むので、ここでは `null` を
 * 返して `head` を既定へ倒すだけにする。
 */
export const renderPublicWorkspace = createServerFn({ method: "GET" })
  .middleware([errorResponseMiddleware])
  .validator(validateInput(publicWorkspaceInputSchema))
  .handler(async ({ data }) => {
    const [
      { PublicWorkspacePage },
      { sessionUserOrNull },
      { loadPublicWorkspace },
      { serializeError },
    ] = await Promise.all([
      import("@/components/workspace/PublicWorkspacePage"),
      import("@/presentation/session"),
      import("@/components/workspace/PublicWorkspacePage/action"),
      import("@/presentation/errorResponse"),
    ]);
    const [user, workspace] = await Promise.all([
      sessionUserOrNull(),
      loadPublicWorkspace(data.slug).then(
        (view) => ({ name: view.name, description: view.description }),
        (error: unknown) => {
          if (serializeError(error).kind === "notFound") return null;
          throw error;
        },
      ),
    ]);
    return {
      workspace,
      PublicWorkspacePage: renderServerFragment(() =>
        PublicWorkspacePage({
          slug: data.slug,
          userId: user?.userId ?? null,
          keyword: data.keyword,
          tags: data.tags,
        }),
      ),
    };
  });
