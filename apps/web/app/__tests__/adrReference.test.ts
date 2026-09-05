import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * ソースが引く ADR 参照が、必ず `spec/adr/` の実在するファイルへ解決する
 * ことを固定する。
 *
 * 設計の正典は `spec/` だけで、1 つの Issue の作業ログ（`CLAUDE.md` が
 * 「not canon」と定めるディレクトリ）は ADR 番号を独自に振っている。その
 * 番号をコードから引くと、Issue が閉じた時点で参照は宙に浮き、読み手は
 * 存在しない `spec/adr/<番号>` を探すか、将来まったく別の決定に割り当て
 * られた番号へ辿り着く。番号は型でも識別子でもないので、この違反は
 * typecheck も lint も通り抜ける — 機械で落とせる場所はここしかない。
 *
 * 置き場所が `app/__tests__/` なのは、特定のルート / コンポーネントに属さず
 * ソース走査で規約を見張るテストの家がここだからである
 * （`serverFunctionRegistration.test.ts` と並ぶ。検査そのものはリポジトリ
 * 全体のソースに掛かる）。
 */

const REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../..",
);

const SOURCE_ROOTS = ["apps/web/app", "packages/core/src"];

const SOURCE_EXTENSIONS = [".ts", ".tsx"];

/**
 * 設計の正典。ADR 番号の解決は markdown なら相対リンクが担保するので、
 * ここには作業ログの引用検査だけが掛かる。
 */
const DOC_ROOTS = ["spec", "docs"];

const DOC_EXTENSIONS = [".md"];

/** 作業ログのディレクトリ。コード・`spec/`・`docs/` から引いてはならない。 */
const WORK_LOG_DIR = ".thread/";

const SELF = path.relative(REPO_ROOT, fileURLToPath(import.meta.url));

const listFiles = (
  root: string,
  extensions: readonly string[],
): readonly string[] => {
  const collected: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(path.join(REPO_ROOT, dir), {
      withFileTypes: true,
    })) {
      const relative = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === "node_modules" || entry.name === "dist") continue;
        walk(relative);
        continue;
      }
      if (!extensions.includes(path.extname(entry.name))) continue;
      if (relative === SELF) continue;
      collected.push(relative);
    }
  };
  walk(root);
  return collected;
};

const SOURCE_FILES = SOURCE_ROOTS.flatMap((root) =>
  listFiles(root, SOURCE_EXTENSIONS),
);

const DOC_FILES = DOC_ROOTS.flatMap((root) => listFiles(root, DOC_EXTENSIONS));

/** `CLAUDE.md` が作業ログの引用を禁じる 3 対象。 */
const WORK_LOG_SCANNED_FILES = [...SOURCE_FILES, ...DOC_FILES];

const ADR_FILE_NUMBERS: ReadonlySet<string> = new Set(
  readdirSync(path.join(REPO_ROOT, "spec/adr"))
    .map((name) => /^(\d+)-.*\.md$/.exec(name)?.[1])
    .filter((number): number is string => number !== undefined),
);

/** 番号での参照（`ADR 013` / `ADR-013`）と、パスでの参照の両方を拾う。 */
const NUMBER_REFERENCE = /\bADR[-\s](\d{1,4})\b/g;
const PATH_REFERENCE = /spec\/adr\/(\d{1,4})\b/g;

const referencedNumbers = (source: string): readonly string[] => {
  const numbers: string[] = [];
  for (const pattern of [NUMBER_REFERENCE, PATH_REFERENCE]) {
    for (const match of source.matchAll(pattern)) {
      numbers.push(match[1].padStart(3, "0"));
    }
  }
  return numbers;
};

describe("ADR references in source", () => {
  it("has source files to check", () => {
    expect(SOURCE_FILES.length).toBeGreaterThan(100);
    expect(DOC_FILES.length).toBeGreaterThan(0);
    expect(ADR_FILE_NUMBERS.size).toBeGreaterThan(0);
  });

  it("resolves every ADR number to a file under spec/adr/", () => {
    const dangling = SOURCE_FILES.flatMap((file) =>
      [
        ...new Set(
          referencedNumbers(readFileSync(path.join(REPO_ROOT, file), "utf8")),
        ),
      ]
        .filter((number) => !ADR_FILE_NUMBERS.has(number))
        .map((number) => `${file}: ADR ${number}`),
    );
    expect(dangling).toEqual([]);
  });

  it("cites no work-log path from source, spec/ or docs/", () => {
    const citing = WORK_LOG_SCANNED_FILES.filter((file) =>
      readFileSync(path.join(REPO_ROOT, file), "utf8").includes(WORK_LOG_DIR),
    );
    expect(citing).toEqual([]);
  });
});
