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
