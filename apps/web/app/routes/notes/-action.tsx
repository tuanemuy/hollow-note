import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { errorResponseMiddleware } from "@/presentation/errorResponseMiddleware";
import { renderServerFragment } from "@/presentation/serverFragment";
import { validateInput } from "@/presentation/validator";

// 権限判定の権威はここ（ハンドラー側）にあり、ルートの `beforeLoad` ガード
// は置かない。セッションが無ければ遷移元付きで `/signin` へ redirect し、
// 主体が無効（削除中／削除済み）なら 401 が出る。断片の promise は
// UNRESOLVED のまま返し、loader がそれを転送して Suspense の下で解決される。
// `renderServerFragment` は、`errorResponseMiddleware` が既に応答を返した
// あとにストリーム途中で reject した誤りの redaction 境界。

const redirectField = z.string().min(1).max(2048);

export const renderNoteList = createServerFn({ method: "GET" })
  .middleware([errorResponseMiddleware])
  .validator(validateInput(z.object({ redirect: redirectField })))
  .handler(async ({ data }) => {
    const [{ NoteList }, { requireSessionOrRedirect }] = await Promise.all([
      import("@/components/note/NoteList"),
      import("@/presentation/sessionGuard"),
    ]);
    const user = await requireSessionOrRedirect(data.redirect);
    return {
      user,
      NoteList: renderServerFragment(() => NoteList({ userId: user.userId })),
    };
  });

const noteDetailInputSchema = z.object({
  noteId: z.string().min(1).max(128),
  redirect: redirectField,
});

export const renderNoteDetail = createServerFn({ method: "GET" })
  .middleware([errorResponseMiddleware])
  .validator(validateInput(noteDetailInputSchema))
  .handler(async ({ data }) => {
    const [{ NoteDetail }, { requireSessionOrRedirect }] = await Promise.all([
      import("@/components/note/NoteDetail"),
      import("@/presentation/sessionGuard"),
    ]);
    const user = await requireSessionOrRedirect(data.redirect);
    return {
      NoteDetail: renderServerFragment(() =>
        NoteDetail({ noteId: data.noteId, userId: user.userId }),
      ),
    };
  });
