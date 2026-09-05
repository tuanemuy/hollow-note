import { describe, expect, it } from "vitest";
import { diffTextNodeEdits } from "../textNodes";

const paths = (
  entries: readonly (readonly [string, string])[],
): ReadonlyMap<string, string> => new Map(entries);

describe("diffTextNodeEdits", () => {
  it("sends only the paths whose text actually changed", () => {
    const edits = diffTextNodeEdits(
      paths([
        ["0.0", "before"],
        ["1.0", "same"],
      ]),
      paths([
        ["0.0", "after"],
        ["1.0", "same"],
      ]),
    );
    expect(edits).toEqual([{ path: "0.0", expected: "before", text: "after" }]);
  });

  it("carries the confirmed text as `expected`, not the edited one", () => {
    // サーバーはこれで衝突を見るので、向きが逆だと必ず素通りする。
    const [edit] = diffTextNodeEdits(
      paths([["0", "old"]]),
      paths([["0", "new"]]),
    );
    expect(edit).toEqual({ path: "0", expected: "old", text: "new" });
  });

  it("sends nothing when the surface has not been touched", () => {
    expect(diffTextNodeEdits(paths([["0", "a"]]), paths([["0", "a"]]))).toEqual(
      [],
    );
  });

  it("skips a path the surface no longer holds", () => {
    // 面が組み直される途中の表は欠けうる。欠けた経路を「空へ書き換えた」
    // と読むと、載せ直しのたびに本文が消える。
    expect(diffTextNodeEdits(paths([["0", "a"]]), paths([]))).toEqual([]);
  });

  it("ignores a path that only the surface knows", () => {
    // 確定値に無い経路はサーバーの木にも無いので、送っても当たらない。
    expect(diffTextNodeEdits(paths([]), paths([["0", "a"]]))).toEqual([]);
  });

  it("treats a path cleared to the empty string as an edit", () => {
    expect(diffTextNodeEdits(paths([["0", "a"]]), paths([["0", ""]]))).toEqual([
      { path: "0", expected: "a", text: "" },
    ]);
  });
});
