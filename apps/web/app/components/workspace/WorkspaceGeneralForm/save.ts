import { WorkspaceErrorCode } from "@repo/core/domain/workspace/errorCode";
import { slugSuggestionsFor } from "@/components/workspace/slugSuggestions";
import { renderErrorMessage } from "@/presentation/errorDisplay";
import { extractSerializedError } from "@/presentation/errorResponse";

/**
 * P-31 の保存バーの結末（PAGE-p31-001..003）。
 *
 * 島から出してあるのは、DOM もサーバー関数のランタイムも無しにこの判定を
 * 単体テストできる形に保つため（`ScopeToken/listing.ts` と同じ理由）。
 */
type SaveTarget = "name" | "description" | "slug" | "form";

export type SaveError = Readonly<{
  target: SaveTarget;
  /** 判断の対象になった値。入力が変わったら失効させるために持つ。 */
  slug: string;
  message: string;
  suggestions: readonly string[];
}>;

export type SaveState =
  | Readonly<{ kind: "idle" }>
  | Readonly<{ kind: "saved" }>
  | Readonly<{ kind: "error"; error: SaveError }>;

export const IDLE_SAVE_STATE: SaveState = { kind: "idle" };

const SLUG_FIELD_CODES: ReadonlySet<string> = new Set([
  "SLUG_ALREADY_USED",
  WorkspaceErrorCode.InvalidSlug,
  WorkspaceErrorCode.SlugReserved,
  WorkspaceErrorCode.PublishedWorkspaceRequiresSlug,
]);

export function saveErrorFor(slug: string, error: unknown): SaveError {
  const serialized = extractSerializedError(error);
  const message = renderErrorMessage(serialized);
  const code = serialized.code;
  if (code !== null && SLUG_FIELD_CODES.has(code)) {
    return {
      target: "slug",
      slug,
      message,
      suggestions: code === "SLUG_ALREADY_USED" ? slugSuggestionsFor(slug) : [],
    };
  }
  if (code === WorkspaceErrorCode.InvalidName) {
    return { target: "name", slug, message, suggestions: [] };
  }
  if (code === WorkspaceErrorCode.InvalidDescription) {
    return { target: "description", slug, message, suggestions: [] };
  }
  return { target: "form", slug, message, suggestions: [] };
}

export type SaveOutcome = Readonly<{
  /** loader を失効させるか。 */
  reconcile: boolean;
  state: SaveState;
}>;

/**
 * 保存の結末。失効の要否はサーバー側で確定した書き込みがあったかだけで決まり、
 * **失敗して抜ける経路でも真になりうる** — プロフィールが確定したあとスラッグの
 * 交換が落ちた部分成功で loader を古いままにすると、保存済みの名前に対して
 * 「未保存の変更があります」が出続け、シェルのラベルと `<h1>` も旧名のまま残る。
 */
export function saveOutcome(
  committed: boolean,
  failure: Readonly<{ slug: string; error: unknown }> | null,
): SaveOutcome {
  return {
    reconcile: committed,
    state:
      failure === null
        ? { kind: "saved" }
        : { kind: "error", error: saveErrorFor(failure.slug, failure.error) },
  };
}
