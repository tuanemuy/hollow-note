import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { errorResponseMiddleware } from "@/presentation/errorResponseMiddleware";
import { REDIRECT_MAX_LENGTH } from "@/presentation/redirect";
import { loadServerDeps } from "@/presentation/serverAction";
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
    const [{ NoteList }, { requireSessionOrRedirect }, { toViewerView }] =
      await Promise.all([
        import("@/components/note/NoteList"),
        import("@/presentation/sessionGuard"),
        import("@/presentation/auth"),
      ]);
    const user = await requireSessionOrRedirect(data.redirect);
    return {
      user: toViewerView(user),
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

const moveTargetPageSchema = z.object({
  cursor: z.string().min(1).max(512).nullable(),
});

/**
 * ノート移動の移動先候補（PAGE-p11-009 / PAGE-p10-007）。
 *
 * **editor 以上のワークスペースだけ**を返す。絞り込みをサーバー側に
 * 置くのは、`moveNote` が target scope で `createNote` を再認可する以上、
 * 選べない行を客に見せる意味が無いためで、viewer のワークスペースの
 * 存在自体はスコープトークンが既に見せているので秘匿にはならない。
 * `unavailable`（shard が答えられない）行も落とす — 移動先として選ばせて
 * から失敗させるより、その往復では出さないほうがよい。
 */
export const listMoveTargetsFn = createServerFn({ method: "GET" })
  .middleware([errorResponseMiddleware])
  .validator(validateInput(moveTargetPageSchema))
  .handler(async ({ data }) => {
    const [{ container, module }, { requireSession }, { WorkspaceRole }] =
      await Promise.all([
        loadServerDeps(
          () => import("@repo/core/application/workspace/listUserWorkspaces"),
        ),
        import("@/presentation/session"),
        import("@repo/core/domain/workspace/valueObject"),
      ]);
    const user = await requireSession();
    const page = await module.listUserWorkspaces({
      container,
      input: { userId: user.userId, cursor: data.cursor },
    });
    return {
      targets: page.workspaces
        .filter(
          (workspace) =>
            workspace.status === "active" &&
            WorkspaceRole.atLeast(workspace.role, "editor"),
        )
        .map((workspace) => ({
          workspaceId: workspace.workspaceId,
          name: workspace.status === "active" ? workspace.name : "",
        })),
      nextCursor: page.nextCursor,
    };
  });

const moveNoteSchema = z.object({
  noteId: z.string().min(1).max(128),
  targetOwnerType: z.enum(["user", "workspace"]),
  targetWorkspaceId: z.string().min(1).max(128).nullable(),
});

/**
 * ノートの移動（UC-note-013、OR-12）。
 *
 * `expectedVersion` を転送境界で受け取らないのは、`getNote` の DTO が
 * ノートの版を持たないため（`spec/usecases/note.md#getnote` の出力 DTO に
 * `version` が無い）。版を持たない呼び出し元は「呼ぶ直前に自分で対象を
 * 引いてそのときの版を渡す」のが規約なので（`spec/usecases/identity.md`
 * の共通規約）、ここで route → scope → ノートの順に 1 回だけ引いて渡す。
 * `getNote` が版を返すようになったら、画面が見た版をそのまま送る形へ
 * 戻すこと（そのときだけ「読んでから移動するまでの間の編集」を弾ける）。
 *
 * 経路の解決に失敗すれば `ScopeRouter` が `NOTE_NOT_FOUND` を投げるので、
 * 不在・他人のノートは `moveNote` 本体と同じ 1 つの応答に収斂する。
 */
export const moveNoteFn = createServerFn({ method: "POST" })
  .middleware([errorResponseMiddleware])
  .validator(validateInput(moveNoteSchema))
  .handler(async ({ data }) => {
    const [{ container, module }, { requireSession }, { NoteId }] =
      await Promise.all([
        loadServerDeps(() => import("@repo/core/application/note/moveNote")),
        import("@/presentation/session"),
        import("@repo/core/domain/note/valueObject"),
      ]);
    const user = await requireSession();

    const noteId = NoteId.create(data.noteId);
    const { scope } = await container.scopeRouter.resolveNote(noteId);
    const stored = await container.noteReaderFor(scope).findById(noteId);

    return module.moveNote({
      container,
      input: {
        noteId: data.noteId,
        userId: user.userId,
        targetOwnerType: data.targetOwnerType,
        targetWorkspaceId: data.targetWorkspaceId,
        expectedVersion:
          stored === null ? 0 : (stored.expectedVersion as number),
      },
    });
  });
