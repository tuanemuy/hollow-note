import { z } from "zod";
import { WORKSPACE_ID_MAX_LENGTH } from "@/presentation/scope";

/**
 * ノート画面の転送境界スキーマ（P-10 / P-11）。
 *
 * 形と DoS 上限だけを見る。業務不変条件（移動先の実在・ロール）は
 * `moveNote` と値オブジェクトが持つ。
 *
 * 移動先の 2 項目には相関があるので、判別共用体で受ける。`ownerType` と
 * ID を独立に検証すると `{ targetOwnerType: "workspace",
 * targetWorkspaceId: null }` が転送境界を通り、`WorkspaceId.create("")`
 * の `InvalidId` になって、`spec/testcases/note/moveNote.md` が定める
 * `WORKSPACE_NOT_FOUND` とも別の種別で返る。
 */
const noteId = z.string().min(1).max(128);

export const moveNoteSchema = z.discriminatedUnion("targetOwnerType", [
  z.object({ noteId, targetOwnerType: z.literal("user") }),
  z.object({
    noteId,
    targetOwnerType: z.literal("workspace"),
    targetWorkspaceId: z.string().min(1).max(WORKSPACE_ID_MAX_LENGTH),
  }),
]);

/**
 * P-12（ノート編集）の転送境界スキーマ。
 *
 * ここが見るのは形と DoS 上限だけで、業務の上限はドメインが持つ —
 * タイトルの 200 文字は `NoteTitle`、本文の 800 KB は `NoteHtml` である。
 * 転送側の上限をドメインより**緩く**取ってあるのは意図で、ちょうどの値を
 * 二重に持つと ED-03 の「800 KB 超は保存を拒否し、分割を促す」が転送の
 * 形の不正（`INVALID_INPUT`）として返り、`NOTE_CONTENT_TOO_LARGE` の
 * 文言に届かなくなる。
 */
const NOTE_TITLE_TRANSPORT_MAX = 1_000;

// 800 KB は UTF-8 バイト数の上限。1 UTF-16 単位は最大 3 バイトなので、
// バイト上限と同じ数の**文字数**を許せばドメインの判定より必ず緩い。
const NOTE_HTML_TRANSPORT_MAX = 800_000;

const expectedVersion = z.number().int().min(0);

/** 版を跨いで安定する本文中のテキストノード位置（body ルートからのドット区切り 0 始まり子インデックス）。 */
const textNodePath = z
  .string()
  .min(1)
  .max(512)
  .regex(/^\d+(\.\d+)*$/);

export const updateNoteBodySchema = z.object({
  noteId,
  rawHtml: z.string().max(NOTE_HTML_TRANSPORT_MAX),
  expectedVersion,
  // 版の記録理由。WYSIWYG を通した本文は正規化を受けているので、
  // 版一覧でそれと分かる必要がある（ED-04 の「元に戻す」）。
  reason: z.enum(["manualEdit", "wysiwygConversion"]),
  importReferences: z.boolean(),
});

/**
 * 1 回の書き換えが運べる文字数の総量。個々のテキストノードは本文と同じ
 * 上限まで伸びうる（本文全体が 1 つの段落でもよい）ので、要素ごとの上限
 * では枠にならない — 効くのは**合計**のほうである。旧値・新値・経路の
 * 3 列を合わせて本文 2 つ分に収める: 書き換えの前後どちらの本文も
 * サニタイズ後 800 KB に収まる以上、その和を超える編集列は本文の不変
 * 条件のほうと矛盾する。
 */
const TEXT_NODE_EDITS_TOTAL_MAX = 2 * NOTE_HTML_TRANSPORT_MAX;

export const applyTextNodeEditsSchema = z.object({
  noteId,
  expectedVersion,
  edits: z
    .array(
      z.object({
        path: textNodePath,
        expected: z.string().max(NOTE_HTML_TRANSPORT_MAX),
        text: z.string().max(NOTE_HTML_TRANSPORT_MAX),
      }),
    )
    .max(20_000)
    .superRefine((edits, ctx) => {
      let total = 0;
      for (const edit of edits) {
        total += edit.path.length + edit.expected.length + edit.text.length;
      }
      if (total > TEXT_NODE_EDITS_TOTAL_MAX) {
        ctx.addIssue({
          code: "custom",
          message: `The edits carry more than ${TEXT_NODE_EDITS_TOTAL_MAX} characters in total`,
        });
      }
    }),
});

export const renameNoteSchema = z.object({
  noteId,
  title: z.string().max(NOTE_TITLE_TRANSPORT_MAX),
  expectedVersion,
});

export const noteRefSchema = z.object({ noteId });

export const restoreNoteRevisionSchema = z.object({
  noteId,
  revisionId: z.string().min(1).max(128),
  expectedVersion,
});

/**
 * 新規作成（`/notes/new`）の初回保存。白紙の作成と本文の反映を 1 往復に
 * 束ねるのは、`createBlankNote` が版を返さず、画面が 2 本目の呼び出しに
 * 渡す `expectedVersion` を持てないため（PAGE-p12-002）。
 */
export const createNoteWithBodySchema = z.object({
  workspaceId: z.string().min(1).max(WORKSPACE_ID_MAX_LENGTH).nullable(),
  title: z.string().max(NOTE_TITLE_TRANSPORT_MAX),
  rawHtml: z.string().max(NOTE_HTML_TRANSPORT_MAX),
  importReferences: z.boolean(),
});

/**
 * 本文へ挿入するメディア（ED-06）。形式と上限の判定はバイト列を見る
 * `UploadValidationPolicy` が持つので、ここは「送りつけ」を止める粗い枠
 * だけを置く — 動画の上限 200 MB より緩い値にして、ドメインの拒否理由が
 * 転送の形の不正に化けないようにする。
 */
const MEDIA_UPLOAD_TRANSPORT_MAX_BYTES = 256 * 1024 * 1024;

export const noteMediaUploadSchema = z.object({
  noteId,
  file: z
    .instanceof(File)
    .refine(
      (file) => file.size > 0 && file.size <= MEDIA_UPLOAD_TRANSPORT_MAX_BYTES,
    ),
});

/**
 * P-11 の表示スタイル切替（PAGE-p11-008 / ED-11）。値の妥当性は
 * `StyleMode` が持つが、転送境界は 2 値の直和で受ける — 画面が出す
 * 選択肢がその 2 つしかないので、それ以外は形の不正である。
 */
export const changeNoteStyleModeSchema = z.object({
  noteId,
  styleMode: z.enum(["default", "preserve"]),
  expectedVersion,
});

/**
 * ゴミ箱の 3 つのミューテーション（PAGE-p11-013 / PAGE-p14-002 /
 * PAGE-p14-003）。`excludingJobId` は転送境界に出さない — 呼び出し元が
 * ジョブ ID を名指しできると、他人のジョブを一掃の対象から外せてしまう
 * （`TrashNoteInput` の JSDoc）。
 */
export const trashNoteSchema = z.object({ noteId, expectedVersion });

export const restoreNoteSchema = z.object({ noteId, expectedVersion });

export const purgeNoteSchema = z.object({ noteId, expectedVersion });

/**
 * ゴミ箱を空にする（PAGE-p14-004）。対象は文脈そのものなので、運ぶのは
 * 「どのスコープか」だけになる（`null` が個人）。
 */
export const emptyTrashSchema = z.object({
  workspaceId: z.string().min(1).max(WORKSPACE_ID_MAX_LENGTH).nullable(),
});
