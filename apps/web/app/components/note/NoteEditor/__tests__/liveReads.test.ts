import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { describe, expect, it } from "vitest";

/**
 * 編集の島で「往復をまたぐ関数が、描画が捕まえた値を読んでいない」ことを
 * 固定する。
 *
 * 島の関数は `await` を挟んで走る。描画が捕まえた state は往復のあいだ
 * 固定されるので、`await` の後（あるいは往復の途中で張られたタイマーの
 * 中）にそれを読むと、判定は往復を始めた時点の値で決まる — 門なら恒真に
 * なり、選択肢の読み取りなら利用者が切り替える前の値で走る。生きた値は
 * ref（`liveRef` / `identityRef` / `confirmedRef` / …）が持つ。
 *
 * 検査は禁止する識別子を**列挙しない**。列挙は state を足すたび・関数を
 * 足すたびに漏れ、漏れた分はそもそも検査の対象語に入らないので検査を
 * すり抜ける。代わりに 2 つの集合をソースから計算する。
 *
 * - **F**（描画が捕まえる値）= `useState` の第 1 束縛名 ∪ 島の直下で F を
 *   参照して作られる派生 const（関数と `useRef` は除く。ref は生きた値を
 *   持つ入れ物であって捕まえた値ではない）
 * - **G**（往復をまたぐ関数）= 自分の本体に `await` を持つ関数 ∪ そこから
 *   名前呼びで到達する島の局所関数
 *
 * 主張は「G の中に式位置の F が 0 件」である。型ノード・プロパティ名・
 * 局所名でシャドウされたものは読みではないので除く。
 *
 * 置き場所が島の隣なのは、検査が `editor.tsx` 1 ファイルに掛かるからで
 * ある（リポジトリ全体に掛かる規約走査は `app/__tests__/` が持つ）。
 */

const ISLAND = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../editor.tsx",
);

const source = readFileSync(ISLAND, "utf8");

const sourceFile = ts.createSourceFile(
  ISLAND,
  source,
  ts.ScriptTarget.ESNext,
  true,
  ts.ScriptKind.TSX,
);

type FunctionLike =
  | ts.FunctionDeclaration
  | ts.FunctionExpression
  | ts.ArrowFunction
  | ts.MethodDeclaration;

const isFunctionLike = (node: ts.Node): node is FunctionLike =>
  ts.isFunctionDeclaration(node) ||
  ts.isFunctionExpression(node) ||
  ts.isArrowFunction(node) ||
  ts.isMethodDeclaration(node);

/** 直下の子だけを畳む（入れ子の関数へは降りない用途で使う）。 */
const eachChild = (node: ts.Node, visit: (child: ts.Node) => void): void => {
  ts.forEachChild(node, (child) => {
    visit(child);
  });
};

const walk = (node: ts.Node, visit: (child: ts.Node) => void): void => {
  eachChild(node, (child) => {
    visit(child);
    walk(child, visit);
  });
};

/** 島 = `useState` を直下に持つ関数。名前で決め打ちにしない。 */
const findIsland = (): ts.FunctionDeclaration => {
  for (const statement of sourceFile.statements) {
    if (!ts.isFunctionDeclaration(statement) || statement.body === undefined) {
      continue;
    }
    const declaresState = statement.body.statements.some(
      (inner) =>
        ts.isVariableStatement(inner) &&
        inner.declarationList.declarations.some((declaration) =>
          isHookCall(declaration.initializer, "useState"),
        ),
    );
    if (declaresState) return statement;
  }
  throw new Error("no island found in editor.tsx");
};

const isHookCall = (
  node: ts.Node | undefined,
  hook: string,
): node is ts.CallExpression =>
  node !== undefined &&
  ts.isCallExpression(node) &&
  ts.isIdentifier(node.expression) &&
  node.expression.text === hook;

/**
 * フックの呼び出し。返り値は「F を参照して作られた派生値」ではないので
 * 閉包を伸ばさない — 伸ばすと `useState` の第 2 束縛（描画をまたいで
 * 同一の setter）まで捕まえた値に数えてしまう。
 */
const isAnyHookCall = (node: ts.Node | undefined): node is ts.CallExpression =>
  node !== undefined &&
  ts.isCallExpression(node) &&
  ts.isIdentifier(node.expression) &&
  /^use[A-Z]/.test(node.expression.text);

const island = findIsland();
const islandBody = island.body as ts.Block;

/** 束縛が導入する名前（分割代入も含めて平らに集める）。 */
const boundNames = (name: ts.BindingName): readonly string[] => {
  if (ts.isIdentifier(name)) return [name.text];
  return name.elements.flatMap((element) =>
    ts.isBindingElement(element) ? boundNames(element.name) : [],
  );
};

const declarationsOf = (block: ts.Block): readonly ts.VariableDeclaration[] =>
  block.statements.flatMap((statement) =>
    ts.isVariableStatement(statement)
      ? [...statement.declarationList.declarations]
      : [],
  );

const islandDeclarations = declarationsOf(islandBody);

/** F の種。`useState` の第 1 束縛名。 */
const stateNames = new Set<string>(
  islandDeclarations.flatMap((declaration) => {
    if (!isHookCall(declaration.initializer, "useState")) return [];
    const name = declaration.name;
    if (ts.isIdentifier(name)) return [name.text];
    const first = name.elements[0];
    return first !== undefined && ts.isBindingElement(first)
      ? boundNames(first.name)
      : [];
  }),
);

const referencedIdentifiers = (node: ts.Node): ReadonlySet<string> => {
  const names = new Set<string>();
  const visit = (child: ts.Node): void => {
    if (ts.isIdentifier(child)) names.add(child.text);
  };
  visit(node);
  walk(node, visit);
  return names;
};

/**
 * F の閉包。島の直下の const のうち、関数でも ref でもなく、F を参照して
 * 作られるものは同じく描画が捕まえた値である。
 */
const capturedNames = ((): ReadonlySet<string> => {
  const names = new Set(stateNames);
  let grew = true;
  while (grew) {
    grew = false;
    for (const declaration of islandDeclarations) {
      const initializer = declaration.initializer;
      if (initializer === undefined) continue;
      if (isFunctionLike(initializer)) continue;
      if (isAnyHookCall(initializer)) continue;
      const referenced = referencedIdentifiers(initializer);
      if (![...referenced].some((name) => names.has(name))) continue;
      for (const name of boundNames(declaration.name)) {
        if (names.has(name)) continue;
        names.add(name);
        grew = true;
      }
    }
  }
  return names;
})();

/** 島の局所関数（名前で呼べるもの）。 */
const localFunctions = new Map<string, FunctionLike>();
for (const statement of islandBody.statements) {
  if (ts.isFunctionDeclaration(statement) && statement.name !== undefined) {
    localFunctions.set(statement.name.text, statement);
    continue;
  }
  if (!ts.isVariableStatement(statement)) continue;
  for (const declaration of statement.declarationList.declarations) {
    const initializer = declaration.initializer;
    if (initializer === undefined || !isFunctionLike(initializer)) continue;
    if (!ts.isIdentifier(declaration.name)) continue;
    localFunctions.set(declaration.name.text, initializer);
  }
}

/** 自分の本体に `await` を持つか（入れ子の関数の `await` は数えない）。 */
const ownsAwait = (fn: FunctionLike): boolean => {
  if (fn.body === undefined) return false;
  let found = false;
  const visit = (node: ts.Node): void => {
    if (found) return;
    if (isFunctionLike(node)) return;
    if (
      ts.isAwaitExpression(node) ||
      (ts.isForOfStatement(node) && node.awaitModifier !== undefined)
    ) {
      found = true;
      return;
    }
    eachChild(node, visit);
  };
  eachChild(fn.body, visit);
  return found;
};

/** 島の中のすべての関数（入れ子・JSX のハンドラも含む）。 */
const allFunctions: FunctionLike[] = [];
walk(island, (node) => {
  if (isFunctionLike(node)) allFunctions.push(node);
});

const crossing = ((): ReadonlySet<FunctionLike> => {
  const reached = new Set<FunctionLike>(allFunctions.filter(ownsAwait));
  const queue = [...reached];
  while (queue.length > 0) {
    const fn = queue.pop();
    if (fn === undefined || fn.body === undefined) continue;
    walk(fn.body, (node) => {
      if (!ts.isCallExpression(node) || !ts.isIdentifier(node.expression)) {
        return;
      }
      const callee = localFunctions.get(node.expression.text);
      if (callee === undefined || reached.has(callee)) return;
      reached.add(callee);
      queue.push(callee);
    });
  }
  return reached;
})();

/** 識別子が値として読まれる位置にあるか。 */
const isValueRead = (id: ts.Identifier): boolean => {
  const parent = id.parent;
  if (parent === undefined) return false;
  if (ts.isPropertyAccessExpression(parent) && parent.name === id) return false;
  if (ts.isQualifiedName(parent) && parent.right === id) return false;
  if (ts.isPropertyAssignment(parent) && parent.name === id) return false;
  if (ts.isBindingElement(parent) && parent.propertyName === id) return false;
  if (ts.isJsxAttribute(parent) && parent.name === id) return false;
  if (ts.isParameter(parent) && parent.name === id) return false;
  if (ts.isVariableDeclaration(parent) && parent.name === id) return false;
  if (ts.isBindingElement(parent) && parent.name === id) return false;
  if (ts.isLabeledStatement(parent) || ts.isBreakOrContinueStatement(parent)) {
    return false;
  }
  for (let node: ts.Node | undefined = id; node; node = node.parent) {
    if (ts.isTypeNode(node) || ts.isTypeParameterDeclaration(node))
      return false;
    if (isFunctionLike(node) || ts.isSourceFile(node)) break;
  }
  return true;
};

/** そのスコープが導入する名前。 */
const scopeNames = (node: ts.Node): readonly string[] => {
  if (isFunctionLike(node)) {
    return [
      ...node.parameters.flatMap((parameter) => boundNames(parameter.name)),
      ...(ts.isFunctionExpression(node) && node.name !== undefined
        ? [node.name.text]
        : []),
    ];
  }
  if (ts.isCatchClause(node)) {
    return node.variableDeclaration === undefined
      ? []
      : boundNames(node.variableDeclaration.name);
  }
  const names: string[] = [];
  const collect = (statement: ts.Node): void => {
    if (ts.isVariableStatement(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        names.push(...boundNames(declaration.name));
      }
      return;
    }
    if (ts.isFunctionDeclaration(statement) && statement.name !== undefined) {
      names.push(statement.name.text);
    }
  };
  if (ts.isBlock(node) || ts.isCaseClause(node) || ts.isDefaultClause(node)) {
    for (const statement of node.statements) collect(statement);
    return names;
  }
  if (
    ts.isForStatement(node) ||
    ts.isForOfStatement(node) ||
    ts.isForInStatement(node)
  ) {
    const initializer = node.initializer;
    if (
      initializer !== undefined &&
      ts.isVariableDeclarationList(initializer)
    ) {
      for (const declaration of initializer.declarations) {
        names.push(...boundNames(declaration.name));
      }
    }
    return names;
  }
  return names;
};

const isShadowed = (id: ts.Identifier, root: ts.Node): boolean => {
  for (let node = id.parent; node !== undefined; node = node.parent) {
    if (scopeNames(node).includes(id.text)) return true;
    if (node === root) break;
  }
  return false;
};

const lineOf = (node: ts.Node): number =>
  sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1;

const violations = ((): readonly string[] => {
  const found = new Map<number, string>();
  for (const fn of crossing) {
    const body = fn.body;
    if (body === undefined) continue;
    walk(body, (node) => {
      if (!ts.isIdentifier(node)) return;
      if (!capturedNames.has(node.text)) return;
      if (!isValueRead(node)) return;
      if (isShadowed(node, body)) return;
      const line = lineOf(node);
      found.set(line, `editor.tsx:${line} ${node.text}`);
    });
  }
  return [...found.entries()]
    .sort(([a], [b]) => a - b)
    .map(([, message]) => message);
})();

describe("live reads in the note editor island", () => {
  it("computes both sets from the source", () => {
    expect(stateNames.size).toBeGreaterThan(10);
    expect(capturedNames.size).toBeGreaterThan(stateNames.size);
    expect(crossing.size).toBeGreaterThan(10);
  });

  it("reads no render-captured value from a function that crosses a roundtrip", () => {
    expect(violations).toEqual([]);
  });
});
