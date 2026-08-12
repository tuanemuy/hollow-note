/**
 * P-25 の削除 ticket をタブに退避する境界（ADR-006 / ADR-095 / ADR-112）。
 *
 * `sessionStorage` から戻る値は信頼できないので、デコード
 * （`parseStoredTicket`）と復元の可否（`canRestoreTicket`）は DOM に依存
 * しない純関数として切り出す。`sessionStorage` そのものへの触り方だけが
 * 下のラッパーに閉じる。
 */

const TICKET_STORAGE_KEY = "hollow.account-deletion-ticket";

/**
 * 退避する ticket は「誰の削除か」まで持つ。ticket 自体は operationId と
 * 期限しか含まないので、主体はここに置く。持たないと、進行中に離脱した
 * タブで別の利用者がサインインしたときに、その人へ他人の削除の進捗と
 * 「削除しました」を見せてしまう。
 */
export type StoredTicket = Readonly<{ ticket: string; userId: string | null }>;

export const parseStoredTicket = (raw: string | null): StoredTicket | null => {
  if (raw === null) {
    return null;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null) {
    return null;
  }
  const { ticket, userId } = parsed as {
    ticket?: unknown;
    userId?: unknown;
  };
  if (typeof ticket !== "string") {
    return null;
  }
  return { ticket, userId: typeof userId === "string" ? userId : null };
};

/**
 * 復元してよいのは保存時の主体と今の主体が一致するときだけ。セッションが
 * 無いときは受理でセッションを失った当人しかありえないので通す。
 */
export const canRestoreTicket = (
  stored: StoredTicket,
  currentUserId: string | null,
): boolean => currentUserId === null || stored.userId === currentUserId;

/**
 * 退避は best-effort。サイトデータを遮断した設定では `sessionStorage` への
 * アクセス自体が投げるが、受理そのものはこのタブの `phase` で追えるので、
 * 保持の失敗を削除の失敗として見せない（追えなくなるのはリロード後だけ）。
 */
export const persistTicket = (stored: StoredTicket): void => {
  try {
    sessionStorage.setItem(TICKET_STORAGE_KEY, JSON.stringify(stored));
  } catch {
    // 退避できなくても、このタブのメモリで進捗を追える。
  }
};

export const forgetTicket = (): void => {
  try {
    sessionStorage.removeItem(TICKET_STORAGE_KEY);
  } catch {
    // 同上。捨てられなくても復元側が主体と ticket の妥当性を見る。
  }
};

export const readStoredTicket = (): StoredTicket | null => {
  let raw: string | null;
  try {
    raw = sessionStorage.getItem(TICKET_STORAGE_KEY);
  } catch {
    return null;
  }
  return parseStoredTicket(raw);
};
