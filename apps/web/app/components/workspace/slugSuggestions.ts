import { WORKSPACE_SLUG_MAX_LENGTH } from "./schema";

/**
 * 重複したスラッグの代案（WS-01「代替候補を示す」）。P-30 と P-31 の
 * 両方が同じ候補を出すので 1 か所に置く。上限を超えないよう接尾辞の分を
 * 先に削る。
 */
export function slugSuggestionsFor(slug: string): readonly string[] {
  const base = slug.trim().toLowerCase();
  if (base === "") return [];
  const suffixes = ["-2", "-team", `-${new Date().getFullYear() % 100}`];
  return suffixes.map(
    (suffix) =>
      `${base.slice(0, WORKSPACE_SLUG_MAX_LENGTH - suffix.length)}${suffix}`,
  );
}
