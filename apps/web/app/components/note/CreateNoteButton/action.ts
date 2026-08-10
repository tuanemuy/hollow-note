import { createServerFn } from "@tanstack/react-start";
import { errorResponseMiddleware } from "@/presentation/errorResponseMiddleware";
import { loadServerDeps } from "@/presentation/serverAction";

/**
 * P-10「新規作成」→ createBlankNote（UC-note-001）。所有者はセッションの
 * 利用者の個人スコープ固定（ワークスペースは本スライス外）。タイトルは
 * 省略 — 「無題 / auto」はドメインが導出する。
 */
export const createBlankNoteFn = createServerFn({ method: "POST" })
  .middleware([errorResponseMiddleware])
  .handler(async () => {
    const [{ container, module }, { requireSession }] = await Promise.all([
      loadServerDeps(
        () => import("@repo/core/application/note/createBlankNote"),
      ),
      import("@/presentation/session"),
    ]);
    const user = await requireSession();
    const view = await module.createBlankNote({
      container,
      input: { userId: user.userId, ownerType: "user" },
    });
    return { noteId: view.noteId };
  });
