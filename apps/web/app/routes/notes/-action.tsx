import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { errorResponseMiddleware } from "@/presentation/errorResponseMiddleware";
import { REDIRECT_MAX_LENGTH } from "@/presentation/redirect";
import { renderServerFragment } from "@/presentation/serverFragment";
import { validateInput } from "@/presentation/validator";

// 権限判定の権威はここ（ハンドラー側）にあり、ルートの `beforeLoad` ガード
// は置かない。セッションが解決できない理由（無い／期限切れ／epoch 失効／
// 削除中・削除済み）は区別されず、すべて遷移元付きの `/signin` redirect に
// なる。401 が残るのは `requireSession()` を直に呼ぶミューテーションと
// `/settings` の子断片だけ。

const redirectField = z.string().min(1).max(REDIRECT_MAX_LENGTH);

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
