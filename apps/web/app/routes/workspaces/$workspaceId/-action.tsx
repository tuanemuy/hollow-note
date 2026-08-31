import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { errorResponseMiddleware } from "@/presentation/errorResponseMiddleware";
import { REDIRECT_MAX_LENGTH } from "@/presentation/redirect";
import { WORKSPACE_ID_MAX_LENGTH } from "@/presentation/scope";
import { loadServerDeps } from "@/presentation/serverAction";
import { renderServerFragment } from "@/presentation/serverFragment";
import { validateInput } from "@/presentation/validator";

/**
 * ワークスペース文脈のノート（`/workspaces/:workspaceId/notes...`）の
 * server function 置き場。設定（`settings/-action.tsx`）とは別の場所に
 * 置くのは、こちらが設定レイアウトの子ではなく `$workspaceId` 直下の
 * ルートだからである。
 */

const workspaceNoteListSchema = z.object({
  workspaceId: z.string().min(1).max(WORKSPACE_ID_MAX_LENGTH),
  redirect: z.string().min(1).max(REDIRECT_MAX_LENGTH),
});

/**
 * P-10 のワークスペース版。シェルに要る名前・スラッグ・公開状態は素の値で
 * 返し（設定レイアウトと同じ理由 — RSC ペイロードに載せるとルートを跨ぐ
 * たびに作り直され、スコープトークンの開閉が飛ぶ）、一覧だけを断片で流す。
 *
 * 非メンバー（`WORKSPACE_INSUFFICIENT_ROLE`）と削除済み
 * （`WORKSPACE_NOT_FOUND`）は `getWorkspaceSettings` が投げ、ルートの
 * `errorComponent` が同じ「開けません」に畳む（WS-02）。存在の有無は
 * どちらの経路でも漏れない。あわせて引き継ぎ Cookie も畳む — ここは
 * 入口（`/`）が引き継ぎを信じて送り込む先なので、畳まないと毎回の訪問が
 * 同じエラー画面に着き続ける。
 */
export const renderWorkspaceNoteList = createServerFn({ method: "GET" })
  .middleware([errorResponseMiddleware])
  .validator(validateInput(workspaceNoteListSchema))
  .handler(async ({ data }) => {
    const [
      { container, module },
      { NoteList },
      { requireSessionOrRedirect },
      { WorkspaceRole },
      { toViewerView },
      scopeCookie,
    ] = await Promise.all([
      loadServerDeps(
        () => import("@repo/core/application/workspace/getWorkspaceSettings"),
      ),
      import("@/components/note/NoteList"),
      import("@/presentation/sessionGuard"),
      import("@repo/core/domain/workspace/valueObject"),
      import("@/presentation/auth"),
      import("@/presentation/scopeCookie"),
    ]);
    const user = await requireSessionOrRedirect(data.redirect);
    let workspace: Awaited<ReturnType<typeof module.getWorkspaceSettings>>;
    try {
      workspace = await module.getWorkspaceSettings({
        container,
        input: { workspaceId: data.workspaceId, userId: user.userId },
      });
    } catch (error) {
      scopeCookie.foldScopeSelectionForUnavailable(data.workspaceId, error);
      throw error;
    }
    const owner = {
      kind: "workspace",
      workspaceId: workspace.workspaceId,
      name: workspace.name,
      canWrite: WorkspaceRole.atLeast(workspace.role, "editor"),
    } as const;
    return {
      user: toViewerView(user),
      workspace: {
        workspaceId: workspace.workspaceId,
        name: workspace.name,
        slug: workspace.slug,
        publication: workspace.publication,
      },
      NoteList: renderServerFragment(() =>
        NoteList({ userId: user.userId, owner }),
      ),
    };
  });

const workspaceNoteDetailSchema = z.object({
  workspaceId: z.string().min(1).max(WORKSPACE_ID_MAX_LENGTH),
  noteId: z.string().min(1).max(128),
  redirect: z.string().min(1).max(REDIRECT_MAX_LENGTH),
});

/**
 * P-11 のワークスペース版（`/workspaces/:workspaceId/notes/:noteId`）。
 * 個人の `/notes/:noteId` と同じ `NoteDetail` を描き、文脈だけが URL から
 * 来る（`spec/pages/index.md` の「`/notes` 以下と同じ構成」）。
 *
 * 一覧と違ってワークスペース自身は読まない。この画面が読むのはノート 1 件
 * だけで、その認可は `getNote` が持つ — 非メンバーも削除済みも
 * `NOTE_NOT_FOUND` に収斂し、P-11 の「見つかりません」に落ちる。URL の
 * `workspaceId` は所属先の照合（OR-12 の正規化）にだけ使う。
 */
export const renderWorkspaceNoteDetail = createServerFn({ method: "GET" })
  .middleware([errorResponseMiddleware])
  .validator(validateInput(workspaceNoteDetailSchema))
  .handler(async ({ data }) => {
    const [{ NoteDetail }, { requireSessionOrRedirect }] = await Promise.all([
      import("@/components/note/NoteDetail"),
      import("@/presentation/sessionGuard"),
    ]);
    const user = await requireSessionOrRedirect(data.redirect);
    return {
      NoteDetail: renderServerFragment(() =>
        NoteDetail({
          noteId: data.noteId,
          userId: user.userId,
          context: { kind: "workspace", workspaceId: data.workspaceId },
        }),
      ),
    };
  });

/**
 * P-12 のワークスペース版（`/workspaces/:workspaceId/notes/:noteId/edit`）。
 * 個人の `/notes/:noteId/edit` と同じ `NoteEditor` を描き、文脈だけが
 * URL から来る。
 *
 * 詳細と同じ理由でワークスペース自身は読まない — この画面が読むのは
 * ノート 1 件だけで、その認可は `getNote` が持つ。非メンバーが URL を
 * 直接開けば `NOTE_NOT_FOUND` に落ちる（`spec/manual-tests/editing.md`
 * の TC-28 手順 3）。
 *
 * 保存・自動保存・メディア挿入・版の復元は `routes/notes/-action.tsx` の
 * ミューテーションを両文脈で共有する（`noteId` で対象が定まるため）。
 */
export const renderWorkspaceNoteEditor = createServerFn({ method: "GET" })
  .middleware([errorResponseMiddleware])
  .validator(validateInput(workspaceNoteDetailSchema))
  .handler(async ({ data }) => {
    const [{ NoteEditor }, { requireSessionOrRedirect }] = await Promise.all([
      import("@/components/note/NoteEditor"),
      import("@/presentation/sessionGuard"),
    ]);
    const user = await requireSessionOrRedirect(data.redirect);
    return {
      NoteEditor: renderServerFragment(() =>
        NoteEditor({
          noteId: data.noteId,
          userId: user.userId,
          context: { kind: "workspace", workspaceId: data.workspaceId },
        }),
      ),
    };
  });

/**
 * P-12 の新規作成のワークスペース版
 * （`/workspaces/:workspaceId/notes/new`）。作成先は URL が決めるので
 * 取り込み先セレクターは出さない（`CreateNoteButton` の `workspaceId`
 * と同じ渡し方）。
 *
 * ここもワークスペースは読まない。viewer と非メンバーの拒否は
 * `createBlankNote` が `createNote` 権限で行い、初回保存が
 * `WORKSPACE_INSUFFICIENT_ROLE` で返る。
 */
export const renderWorkspaceNewNoteEditor = createServerFn({ method: "GET" })
  .middleware([errorResponseMiddleware])
  .validator(validateInput(workspaceNoteListSchema))
  .handler(async ({ data }) => {
    const [{ NewNoteEditor }, { requireSessionOrRedirect }] = await Promise.all(
      [
        import("@/components/note/NoteEditor"),
        import("@/presentation/sessionGuard"),
      ],
    );
    await requireSessionOrRedirect(data.redirect);
    return {
      NoteEditor: renderServerFragment(() =>
        NewNoteEditor({
          context: { kind: "workspace", workspaceId: data.workspaceId },
        }),
      ),
    };
  });
