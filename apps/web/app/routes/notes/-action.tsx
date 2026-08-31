import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import {
  applyTextNodeEditsSchema,
  changeNoteStyleModeSchema,
  createNoteWithBodySchema,
  emptyTrashSchema,
  moveNoteSchema,
  noteMediaUploadSchema,
  noteRefSchema,
  purgeNoteSchema,
  renameNoteSchema,
  restoreNoteRevisionSchema,
  restoreNoteSchema,
  trashNoteSchema,
  updateNoteBodySchema,
} from "@/components/note/schema";
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
      targets: page.workspaces.flatMap((workspace) =>
        workspace.status === "active" &&
        WorkspaceRole.atLeast(workspace.role, "editor")
          ? [{ workspaceId: workspace.workspaceId, name: workspace.name }]
          : [],
      ),
      nextCursor: page.nextCursor,
    };
  });

/**
 * ノートの移動（UC-note-013、OR-12）。
 *
 * `expectedVersion` を転送境界で受け取らないのは、`getNote` の DTO が
 * ノートの版を持たないため（`spec/usecases/note.md#getnote` の出力 DTO に
 * `version` が無い）。画面が見た版が無い以上ここでも作れないので、`null`
 * を渡して「版を持たない呼び出し元」であることを `moveNote` に伝える。
 * サーバー側で引き直した版を渡すと、`moveNote` が自分で読んだ値と突き
 * 合わせるだけの恒真な検査になり、楽観ロックが**あるように見えて無い**
 * 状態になる。`getNote` が版を返すようになったら、画面が見た版をここで
 * 受け取る形にする（そのときだけ「読んでから移動するまでの間の編集」を
 * 弾ける）。
 */
export const moveNoteFn = createServerFn({ method: "POST" })
  .middleware([errorResponseMiddleware])
  .validator(validateInput(moveNoteSchema))
  .handler(async ({ data }) => {
    const [{ container, module }, { requireSession }] = await Promise.all([
      loadServerDeps(() => import("@repo/core/application/note/moveNote")),
      import("@/presentation/session"),
    ]);
    const user = await requireSession();

    return module.moveNote({
      container,
      input: { ...data, userId: user.userId, expectedVersion: null },
    });
  });

// --- P-12 ノート編集 -------------------------------------------------------

/**
 * P-12 の断片（PAGE-p12-001）。個人文脈の `/notes/:noteId/edit`。
 *
 * 詳細（`renderNoteDetail`）と同じく、この画面はノート 1 件しか扱わない
 * のでワークスペース自身は読まない。認可は `getNote` が持ち、非メンバー・
 * 削除済み・権限なしはすべて `NOTE_NOT_FOUND` に収斂する。
 */
export const renderNoteEditor = createServerFn({ method: "GET" })
  .middleware([errorResponseMiddleware])
  .validator(validateInput(noteDetailInputSchema))
  .handler(async ({ data }) => {
    const [{ NoteEditor }, { requireSessionOrRedirect }] = await Promise.all([
      import("@/components/note/NoteEditor"),
      import("@/presentation/sessionGuard"),
    ]);
    const user = await requireSessionOrRedirect(data.redirect);
    return {
      NoteEditor: renderServerFragment(() =>
        NoteEditor({ noteId: data.noteId, userId: user.userId }),
      ),
    };
  });

/**
 * P-12 の新規作成（PAGE-p12-002）。ノートはまだ無いので読み取りは
 * セッションだけで、断片は作成先を持った空のエディタになる。
 */
export const renderNewNoteEditor = createServerFn({ method: "GET" })
  .middleware([errorResponseMiddleware])
  .validator(validateInput(z.object({ redirect: redirectField })))
  .handler(async ({ data }) => {
    const [{ NewNoteEditor }, { requireSessionOrRedirect }] = await Promise.all(
      [
        import("@/components/note/NoteEditor"),
        import("@/presentation/sessionGuard"),
      ],
    );
    await requireSessionOrRedirect(data.redirect);
    return { NoteEditor: renderServerFragment(() => NewNoteEditor({})) };
  });

/**
 * 本文の保存（UC-note-009、ED-03 / ED-04 / ED-08）。
 *
 * 以下 6 本のミューテーションは**文脈を取らない**。`noteId` が対象を
 * 一意に決めるので、`moveNoteFn` と同じく個人とワークスペースの両文脈が
 * 1 本を共有する（`spec/pages/index.md` の「文脈によらない 1 つの画面」）。
 *
 * `expectedVersion` は画面が見た版をそのまま運ぶ。サーバー側で引き直すと
 * 自分で読んだ値と突き合わせるだけの恒真な検査になり、ED-08 の競合
 * （他者の更新）が検出できなくなる。
 */
export const updateNoteBodyFn = createServerFn({ method: "POST" })
  .middleware([errorResponseMiddleware])
  .validator(validateInput(updateNoteBodySchema))
  .handler(async ({ data }) => {
    const [{ container, module }, { requireSession }] = await Promise.all([
      loadServerDeps(
        () => import("@repo/core/application/note/updateNoteBody"),
      ),
      import("@/presentation/session"),
    ]);
    const user = await requireSession();
    return module.updateNoteBody({
      container,
      input: { ...data, userId: user.userId },
    });
  });

/** ビジュアルモードの保存（UC-note-010、ED-02）。 */
export const applyTextNodeEditsFn = createServerFn({ method: "POST" })
  .middleware([errorResponseMiddleware])
  .validator(validateInput(applyTextNodeEditsSchema))
  .handler(async ({ data }) => {
    const [{ container, module }, { requireSession }] = await Promise.all([
      loadServerDeps(
        () => import("@repo/core/application/note/applyTextNodeEdits"),
      ),
      import("@/presentation/session"),
    ]);
    const user = await requireSession();
    return module.applyTextNodeEdits({
      container,
      input: { ...data, userId: user.userId },
    });
  });

/** タイトルの保存（UC-note-011、ED-07）。空は `NoteTitle` が「無題」に畳む。 */
export const renameNoteFn = createServerFn({ method: "POST" })
  .middleware([errorResponseMiddleware])
  .validator(validateInput(renameNoteSchema))
  .handler(async ({ data }) => {
    const [{ container, module }, { requireSession }] = await Promise.all([
      loadServerDeps(() => import("@repo/core/application/note/renameNote")),
      import("@/presentation/session"),
    ]);
    const user = await requireSession();
    return module.renameNote({
      container,
      input: { ...data, userId: user.userId },
    });
  });

/**
 * 競合・復元のあとに画面が版と本文を取り直す経路（ED-08）。
 *
 * ルーターの `invalidate()` では足りない。競合の解決（上書き / 破棄）も
 * 版の復元も**その場で次の保存に使う版**が要るのに対し、`invalidate()` は
 * 断片を作り直すだけで、島が握っている版には届かないためである。
 */
export const readNoteEditStateFn = createServerFn({ method: "GET" })
  .middleware([errorResponseMiddleware])
  .validator(validateInput(noteRefSchema))
  .handler(async ({ data }) => {
    const [{ container, module }, { requireSession }] = await Promise.all([
      loadServerDeps(() => import("@repo/core/application/note/getNote")),
      import("@/presentation/session"),
    ]);
    const user = await requireSession();
    const note = await module.getNote({
      container,
      input: { noteId: data.noteId, userId: user.userId },
    });
    return {
      version: note.version,
      title: note.title,
      html: note.content.html ?? "",
      canEdit: note.permissions.canEdit,
    };
  });

/** 版の一覧（UC-note-023、ED-08 の直近 20 版）。 */
export const listNoteRevisionsFn = createServerFn({ method: "GET" })
  .middleware([errorResponseMiddleware])
  .validator(validateInput(noteRefSchema))
  .handler(async ({ data }) => {
    const [{ container, module }, { requireSession }] = await Promise.all([
      loadServerDeps(
        () => import("@repo/core/application/note/listNoteRevisions"),
      ),
      import("@/presentation/session"),
    ]);
    const user = await requireSession();
    const view = await module.listNoteRevisions({
      container,
      input: { noteId: data.noteId, userId: user.userId },
    });
    return {
      revisions: view.revisions.map((revision) => ({
        revisionId: revision.revisionId,
        createdAt: revision.createdAt,
        createdByName: revision.createdByName,
        reason: revision.reason,
        excerpt: revision.excerpt,
      })),
    };
  });

/**
 * 版からの復元（UC-note-024、ED-04 / ED-08）。
 *
 * 応答の `version` を次の保存の `expectedVersion` に使う。復元は本文・
 * タイトル・スタイルの 3 つの遷移を合成するので版が 2〜3 進み、差分を
 * 数えて予測すると外れる（.thread/7/adr.md ADR-014）。
 */
export const restoreNoteRevisionFn = createServerFn({ method: "POST" })
  .middleware([errorResponseMiddleware])
  .validator(validateInput(restoreNoteRevisionSchema))
  .handler(async ({ data }) => {
    const [{ container, module }, { requireSession }] = await Promise.all([
      loadServerDeps(
        () => import("@repo/core/application/note/restoreNoteRevision"),
      ),
      import("@/presentation/session"),
    ]);
    const user = await requireSession();
    return module.restoreNoteRevision({
      container,
      input: { ...data, userId: user.userId },
    });
  });

/**
 * 本文へ挿入するメディアの保管（UC-storage-003、ED-06）。
 *
 * 応答の `mimeType` / `size` は保管したものの実測値なので、挿入する
 * 要素（`img` / `video`）はそれで決める — 送った側の申告ではなく先頭
 * バイトの判定結果である。
 */
export const storeNoteMediaFn = createServerFn({ method: "POST" })
  .middleware([errorResponseMiddleware])
  .validator((input: unknown) =>
    validateInput(noteMediaUploadSchema)({
      file: input instanceof FormData ? input.get("file") : undefined,
      noteId: input instanceof FormData ? input.get("noteId") : undefined,
    }),
  )
  .handler(async ({ data }) => {
    const [{ container, module }, { requireSession }] = await Promise.all([
      loadServerDeps(() => import("@repo/core/application/storage/storeMedia")),
      import("@/presentation/session"),
    ]);
    const user = await requireSession();
    const body = new Uint8Array(await data.file.arrayBuffer());
    return module.storeMedia({
      container,
      input: {
        userId: user.userId,
        noteId: data.noteId,
        fileName: data.file.name,
        body,
      },
    });
  });

/**
 * 新規作成の初回保存（PAGE-p12-002）。作成と本文の反映を 1 往復に束ねる。
 *
 * 分けられないのは版のためである。`createBlankNote` は `version` を返さ
 * ないので、画面が 2 本目の呼び出しに渡す `expectedVersion` を持てない。
 * 作ったばかりのノートを**この経路の中で**読み直して版を得れば、画面が
 * 一度も版を知らないまま本文を確定できる。読み直しと保存のあいだに他者が
 * 割り込む窓は理屈のうえでは残るが、作成直後の非公開ノートを知る者は
 * 作成者しかいない。
 *
 * 本文が空のときは白紙のまま作る（`updateNoteBody` を呼ばない） — 版を
 * 1 つと Revision を 1 件、何も書いていない編集に費やさないため。
 */
export const createNoteWithBodyFn = createServerFn({ method: "POST" })
  .middleware([errorResponseMiddleware])
  .validator(validateInput(createNoteWithBodySchema))
  .handler(async ({ data }) => {
    const [
      { container, module },
      { getNote },
      { updateNoteBody },
      { requireSession },
    ] = await Promise.all([
      loadServerDeps(
        () => import("@repo/core/application/note/createBlankNote"),
      ),
      import("@repo/core/application/note/getNote"),
      import("@repo/core/application/note/updateNoteBody"),
      import("@/presentation/session"),
    ]);
    const user = await requireSession();
    const created = await module.createBlankNote({
      container,
      input:
        data.workspaceId === null
          ? { userId: user.userId, ownerType: "user", title: data.title }
          : {
              userId: user.userId,
              ownerType: "workspace",
              ownerWorkspaceId: data.workspaceId,
              title: data.title,
            },
    });

    if (data.rawHtml.length === 0) {
      const blank = await getNote({
        container,
        input: { noteId: created.noteId, userId: user.userId },
      });
      return {
        noteId: created.noteId,
        workspaceId: data.workspaceId,
        version: blank.version,
        removed: [],
      };
    }

    const read = await getNote({
      container,
      input: { noteId: created.noteId, userId: user.userId },
    });
    const saved = await updateNoteBody({
      container,
      input: {
        noteId: created.noteId,
        userId: user.userId,
        rawHtml: data.rawHtml,
        expectedVersion: read.version,
        reason: "manualEdit",
        importReferences: data.importReferences,
      },
    });
    return {
      noteId: created.noteId,
      workspaceId: data.workspaceId,
      version: saved.version,
      removed: saved.removed,
    };
  });

// --- P-11 の表示スタイル・削除と P-14 ゴミ箱 ------------------------------

/** 表示スタイルの切替（UC-note-012、PAGE-p11-008 / ED-11）。 */
export const changeNoteStyleModeFn = createServerFn({ method: "POST" })
  .middleware([errorResponseMiddleware])
  .validator(validateInput(changeNoteStyleModeSchema))
  .handler(async ({ data }) => {
    const [{ container, module }, { requireSession }] = await Promise.all([
      loadServerDeps(
        () => import("@repo/core/application/note/changeNoteStyleMode"),
      ),
      import("@/presentation/session"),
    ]);
    const user = await requireSession();
    return module.changeNoteStyleMode({
      container,
      input: { ...data, userId: user.userId },
    });
  });

/**
 * ゴミ箱へ移す（UC-note-017、PAGE-p11-013 / ED-09）。
 *
 * `excludingJobId` は画面からは常に `null` である。一覧・詳細のどちらから
 * 削除しても実行中のジョブはすべて取り消してよく、除外してよい 1 件を
 * 持つのは一括操作の子ジョブだけだからで、その値は転送境界を渡らない。
 */
export const trashNoteFn = createServerFn({ method: "POST" })
  .middleware([errorResponseMiddleware])
  .validator(validateInput(trashNoteSchema))
  .handler(async ({ data }) => {
    const [{ container, module }, { requireSession }] = await Promise.all([
      loadServerDeps(() => import("@repo/core/application/note/trashNote")),
      import("@/presentation/session"),
    ]);
    const user = await requireSession();
    return module.trashNote({
      container,
      input: { ...data, userId: user.userId, excludingJobId: null },
    });
  });

/** ゴミ箱から戻す（UC-note-018、PAGE-p14-002 / ED-10）。 */
export const restoreNoteFn = createServerFn({ method: "POST" })
  .middleware([errorResponseMiddleware])
  .validator(validateInput(restoreNoteSchema))
  .handler(async ({ data }) => {
    const [{ container, module }, { requireSession }] = await Promise.all([
      loadServerDeps(() => import("@repo/core/application/note/restoreNote")),
      import("@/presentation/session"),
    ]);
    const user = await requireSession();
    return module.restoreNote({
      container,
      input: { ...data, userId: user.userId },
    });
  });

/** 完全に削除する（UC-note-019、PAGE-p14-003 / ED-10）。 */
export const purgeNoteFn = createServerFn({ method: "POST" })
  .middleware([errorResponseMiddleware])
  .validator(validateInput(purgeNoteSchema))
  .handler(async ({ data }) => {
    const [{ container, module }, { requireSession }] = await Promise.all([
      loadServerDeps(() => import("@repo/core/application/note/purgeNote")),
      import("@/presentation/session"),
    ]);
    const user = await requireSession();
    await module.purgeNote({
      container,
      input: { kind: "userRequest", ...data, userId: user.userId },
    });
    return { noteId: data.noteId };
  });

/**
 * ゴミ箱を空にする（UC-note-020、PAGE-p14-004 / ED-10）。
 *
 * 応答の `mode` をそのまま画面へ返す。`purgedCount` は 2 つの意味を持ち
 * （`purged` は消し終えた件数、`scheduled` は登録しただけの件数）、
 * 取り違えるとまだ 1 件も消えていない予約を「削除しました」と announce
 * することになる（`EmptyTrashView` の JSDoc）。
 */
export const emptyTrashFn = createServerFn({ method: "POST" })
  .middleware([errorResponseMiddleware])
  .validator(validateInput(emptyTrashSchema))
  .handler(async ({ data }) => {
    const [{ container, module }, { requireSession }] = await Promise.all([
      loadServerDeps(() => import("@repo/core/application/note/emptyTrash")),
      import("@/presentation/session"),
    ]);
    const user = await requireSession();
    return module.emptyTrash({
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
  });

/** P-14 の断片（PAGE-p14-001）。個人文脈の `/notes/trash`。 */
export const renderTrashList = createServerFn({ method: "GET" })
  .middleware([errorResponseMiddleware])
  .validator(validateInput(z.object({ redirect: redirectField })))
  .handler(async ({ data }) => {
    const [{ TrashList }, { requireSessionOrRedirect }, { toViewerView }] =
      await Promise.all([
        import("@/components/note/TrashList"),
        import("@/presentation/sessionGuard"),
        import("@/presentation/auth"),
      ]);
    const user = await requireSessionOrRedirect(data.redirect);
    return {
      user: toViewerView(user),
      TrashList: renderServerFragment(() => TrashList({ userId: user.userId })),
    };
  });
