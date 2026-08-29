import { z } from "zod";
import { EMAIL_MAX_LENGTH, EMAIL_PATTERN } from "@/components/auth/schema";
import { WORKSPACE_ID_MAX_LENGTH } from "@/presentation/scope";

/**
 * ワークスペース画面の転送境界スキーマ（P-30 / P-31 / P-32 / P-33 / P-34
 * と P-06）。
 *
 * 形と DoS 上限だけを見る。名前 80 文字・説明 500 文字・スラッグの字種と
 * 予約語といった業務不変条件は `domain/workspace/valueObject.ts` の値
 * オブジェクトが持つので、ここでは**上限より 1 文字広く**取って、超過の
 * 理由がドメイン側の文言で返るようにする。
 *
 * クライアントからも import されるモジュールなので、`@repo/core/domain/*`
 * / `@repo/core/application/*` を持ち込まない（定数を除く）。
 */
// ワークスペース ID の上限は Cookie 経路と共通の正本（`presentation/scope.ts`）
// から引く。2 つ置くと本文経路と Cookie 経路で受け付ける長さが割れる。
export { WORKSPACE_ID_MAX_LENGTH };

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

/**
 * P-30 / P-31 のスラッグ欄の目安表示。`workspaceId` は「いま自分が
 * 押さえているスラッグ」を伝えるための任意項目で、作成時は `null`。
 * 省略ではなく `null` を要求するのは `exactOptionalPropertyTypes` の下で
 * 「省略」と「undefined」が別物になるため。
 */
export const workspaceSlugAvailabilitySchema = z.object({
  slug: z
    .string()
    .min(1)
    .max(WORKSPACE_SLUG_MAX_LENGTH + 1),
  workspaceId: workspaceId.nullable(),
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

// P-32 / P-06。ID はいずれも生成器由来なので実際はこれよりずっと短い。
const invitationId = z.string().min(1).max(WORKSPACE_ID_MAX_LENGTH);
const membershipId = z.string().min(1).max(WORKSPACE_ID_MAX_LENGTH);

// ロールの語彙は `WorkspaceRole.create` が持つ。ここを `z.enum` で閉じると
// 未知の値が転送の形の不正として返り、`WORKSPACE_INVALID_ROLE` の文言に
// 届かなくなる。
const role = z.string().min(1).max(16);

/**
 * 形式は転送境界でも閉じる（WS-03「メールアドレスの形式が不正な場合は
 * 送信前に弾く」）。パターンはドメインの `Email` と同じものを使うので、
 * ここで落ちるのは画面側の事前判定をすり抜けた要求だけになる。
 */
export const inviteMemberSchema = z.object({
  workspaceId,
  email: z.string().trim().min(1).max(EMAIL_MAX_LENGTH).regex(EMAIL_PATTERN),
  role,
});

export const invitationRefSchema = z.object({ workspaceId, invitationId });

export const changeMemberRoleSchema = z.object({
  workspaceId,
  membershipId,
  role,
});

export const membershipRefSchema = z.object({ workspaceId, membershipId });

/**
 * 招待トークン（`/invitations/:token`）。URL のパスから来る外部入力なので、
 * 使う側の server function がこのスキーマで転送境界を閉じる。長さの上限は
 * 認証系トークン（`components/auth/schema.ts`）と揃える。
 */
export const invitationTokenSchema = z.object({
  token: z.string().min(1).max(512),
});
