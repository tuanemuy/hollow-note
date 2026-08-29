import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { errorResponseMiddleware } from "@/presentation/errorResponseMiddleware";
import { WORKSPACE_ID_MAX_LENGTH } from "@/presentation/scope";
import { loadServerDeps } from "@/presentation/serverAction";
import { validateInput } from "@/presentation/validator";

const createBlankNoteSchema = z.object({
  // `null` は個人の文脈。
  workspaceId: z.string().min(1).max(WORKSPACE_ID_MAX_LENGTH).nullable(),
});

/**
 * P-10「新規作成」→ createBlankNote（UC-note-001）。実行者はセッションの
 * 利用者で、所有先は画面が置かれた文脈（個人 / ワークスペース）。タイトルは
 * 省略 — 「無題 / auto」はドメインが導出する。
 *
 * 文脈を本文で受けても認可は緩まない: `createBlankNote` が対象ワークス
 * ペースで `createNote` を判定するので、非メンバーと viewer は
 * `WORKSPACE_INSUFFICIENT_ROLE` で弾かれる。
 */
export const createBlankNoteFn = createServerFn({ method: "POST" })
  .middleware([errorResponseMiddleware])
  .validator(validateInput(createBlankNoteSchema))
  .handler(async ({ data }) => {
    const [{ container, module }, { requireSession }] = await Promise.all([
      loadServerDeps(
        () => import("@repo/core/application/note/createBlankNote"),
      ),
      import("@/presentation/session"),
    ]);
    const user = await requireSession();
    const view = await module.createBlankNote({
      container,
      input:
        data.workspaceId === null
          ? { userId: user.userId, ownerType: "user" }
          : {
              userId: user.userId,
              ownerType: "workspace",
              ownerWorkspaceId: data.workspaceId,
            },
    });
    return { noteId: view.noteId };
  });
