import type { DeletionTicketKeyRing } from "@repo/core/application/di/types";
import { ValidationError } from "@repo/core/application/errors";

/**
 * 削除進捗の status ticket（spec/presentation/index.md・ADR-006）。
 *
 * `deleteAccount` は受理と同じ応答でセッションを失効させるので、利用者
 * は自分の削除を追う手段を失う。ticket はその 1 件の operation の状態を
 * 読む権限だけを持つ 30 分の資格情報で、**再実行・取消・他データの取得
 * には使えない** — 中身が `operationId` と期限だけなので、権限を広げる
 * 材料がそもそも入っていない。
 *
 * 鍵は composition root が供給する（`RequestContainer.deletionTicketKeyRing`）。
 * この層は `process.env` を読まない — 秘密の供給点を 1 系統に保つため。
 *
 * Cookie にしない（ADR-006）。セッション破棄と同時に自動送信される別の
 * 資格情報を増やすことになり、SharePass / ExportTicket の扱いとも揃わ
 * ない。応答 body で返し、島が `sessionStorage` に持つ。
 *
 * フレームワーク非依存で Web 標準の暗号だけを使う（`crypto.subtle`）。
 */

/** spec/presentation/index.md が定める ticket の有効期間。 */
export const DELETION_TICKET_TTL_MS = 30 * 60 * 1000;

export type DeletionTicketClaims = Readonly<{
  operationId: string;
  expiresAt: Date;
}>;

const invalidTicket = (): ValidationError =>
  new ValidationError("DELETION_TICKET_INVALID", "Status ticket is not valid");

const expiredTicket = (): ValidationError =>
  new ValidationError("DELETION_TICKET_EXPIRED", "Status ticket has expired");

const toBase64Url = (bytes: Uint8Array): string => {
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
};

const fromBase64Url = (value: string): Uint8Array => {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(padded.padEnd(Math.ceil(padded.length / 4) * 4, "="));
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
};

const encoder = new TextEncoder();

async function importKey(
  keyRing: DeletionTicketKeyRing,
  version: number,
): Promise<CryptoKey> {
  const material = keyRing.keys.get(version);
  if (material === undefined) {
    throw invalidTicket();
  }
  return crypto.subtle.importKey(
    "raw",
    material.slice().buffer,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
}

/**
 * `{keyVersion}.{claims}.{signature}`。版を平文で先頭に置くのは、検証
 * より前にどの鍵で照合するかを決める必要があるため（鍵そのものは出ない）。
 */
export async function issueDeletionTicket(
  keyRing: DeletionTicketKeyRing,
  params: Readonly<{ operationId: string; now: Date }>,
): Promise<string> {
  const claims = toBase64Url(
    encoder.encode(
      JSON.stringify({
        o: params.operationId,
        e: params.now.getTime() + DELETION_TICKET_TTL_MS,
      }),
    ),
  );
  const signed = `${keyRing.currentVersion}.${claims}`;
  const signature = await crypto.subtle.sign(
    "HMAC",
    await importKey(keyRing, keyRing.currentVersion),
    encoder.encode(signed),
  );
  return `${signed}.${toBase64Url(new Uint8Array(signature))}`;
}

/**
 * 署名と期限を検証して `operationId` を取り出す。**呼び出し側は要求本文
 * の `operationId` を信じてはならない** — ここが返した値だけを使うこと
 * が「ticket が示す 1 件以外は読めない」を成り立たせている。
 */
export async function readDeletionTicket(
  keyRing: DeletionTicketKeyRing,
  ticket: string,
  now: Date,
): Promise<DeletionTicketClaims> {
  const [rawVersion, claims, signature, ...rest] = ticket.split(".");
  if (
    rawVersion === undefined ||
    claims === undefined ||
    signature === undefined ||
    rest.length > 0
  ) {
    throw invalidTicket();
  }
  const version = Number(rawVersion);
  if (!Number.isInteger(version)) {
    throw invalidTicket();
  }

  let verified: boolean;
  let payload: unknown;
  try {
    verified = await crypto.subtle.verify(
      "HMAC",
      await importKey(keyRing, version),
      fromBase64Url(signature).slice().buffer,
      encoder.encode(`${rawVersion}.${claims}`),
    );
    payload = verified
      ? JSON.parse(new TextDecoder().decode(fromBase64Url(claims)))
      : null;
  } catch (error) {
    if (error instanceof ValidationError) throw error;
    throw invalidTicket();
  }
  if (!verified) {
    throw invalidTicket();
  }

  if (
    typeof payload !== "object" ||
    payload === null ||
    typeof (payload as { o?: unknown }).o !== "string" ||
    typeof (payload as { e?: unknown }).e !== "number"
  ) {
    throw invalidTicket();
  }
  const { o: operationId, e: expiresAtMs } = payload as {
    o: string;
    e: number;
  };
  // 期限は署名の検証を通った後にだけ見る。順序を逆にすると、偽造された
  // ticket の期限が「署名は正しいが期限切れ」と読める。
  if (expiresAtMs <= now.getTime()) {
    throw expiredTicket();
  }
  return { operationId, expiresAt: new Date(expiresAtMs) };
}
