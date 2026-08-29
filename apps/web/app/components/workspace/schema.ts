import { z } from "zod";

/**
 * ワークスペース画面の転送境界スキーマ（P-30 / P-31 / P-33 / P-34）。
 *
 * 形と DoS 上限だけを見る。名前 80 文字・説明 500 文字・スラッグの字種と
 * 予約語といった業務不変条件は `domain/workspace/valueObject.ts` の値
 * オブジェクトが持つので、ここでは**上限より 1 文字広く**取って、超過の
 * 理由がドメイン側の文言で返るようにする。
 *
 * クライアントからも import されるモジュールなので、`@repo/core/domain/*`
 * / `@repo/core/application/*` を持ち込まない（定数を除く）。
 */
export const WORKSPACE_ID_MAX_LENGTH = 128;
export const WORKSPACE_NAME_MAX_LENGTH = 80;
export const WORKSPACE_DESCRIPTION_MAX_LENGTH = 500;
export const WORKSPACE_SLUG_MAX_LENGTH = 30;

const workspaceId = z.string().min(1).max(WORKSPACE_ID_MAX_LENGTH);
const name = z
  .string()
  .min(1)
  .max(WORKSPACE_NAME_MAX_LENGTH + 1);
const description = z.string().max(WORKSPACE_DESCRIPTION_MAX_LENGTH + 1);
const slug = z.string().max(WORKSPACE_SLUG_MAX_LENGTH + 1);

export const createWorkspaceSchema = z.object({
  name,
  description,
  // 空文字は「スラッグを設定しない」。`null` と分けないのは、フォームの
  // 空欄がそのまま送られてくるため。
  slug,
});

export const updateWorkspaceProfileSchema = z.object({
  workspaceId,
  name: name.optional(),
  description: description.optional(),
  avatarUrl: z.string().max(2048).nullable().optional(),
});

export const changeWorkspaceSlugSchema = z.object({
  workspaceId,
  slug,
});

export const workspaceRefSchema = z.object({ workspaceId });

export const deleteWorkspaceSchema = z.object({
  workspaceId,
  confirmationName: z.string().max(WORKSPACE_NAME_MAX_LENGTH + 1),
});

/**
 * 転送境界の DoS 上限。業務上の上限（5 MB）より広いのは意図的で、
 * 5〜8 MB は `UploadValidationPolicy` に届いて `FileTooLarge` として返る
 * （`routes/settings/-action.tsx` のアイコン投稿と同じ扱い）。
 */
const AVATAR_UPLOAD_MAX_BYTES = 8 * 1024 * 1024;

export const workspaceAvatarUploadSchema = z.object({
  workspaceId,
  file: z
    .instanceof(File)
    .refine((file) => file.size > 0 && file.size <= AVATAR_UPLOAD_MAX_BYTES),
});
