import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { describe, expect, it } from "vitest";

/**
 * 編集の島で「往復をまたぐ関数が、描画が捕まえた値を読んでいない」ことを
 * 固定する。
 *
 * 島の関数は `await` を挟んで走る。描画が捕まえた値は往復のあいだ固定
 * されるので、`await` の後（あるいは往復の途中で張られたタイマー・
 * `then` の中）にそれを読むと、判定は往復を始めた時点の値で決まる — 門
 * なら恒真になり、選択肢の読み取りなら利用者が切り替える前の値で走る。
 * 生きた値は ref（`liveRef` / `identityRef` / `confirmedRef` / …）が持つ。
 *
 * 検査は禁止する識別子を**列挙しない**。列挙は値を足すたび・関数を足す
 * たびに漏れ、漏れた分はそもそも検査の対象語に入らないのですり抜ける。
 * 代わりに 2 つの集合をソースから計算する。
 *
 * ## 定義域
 *
 * - **F**（描画が捕まえる値）= 島の仮引数（分割代入の全名）∪ 島の直下の
 *   全束縛 − 初期化子が関数リテラルのもの − {@link STABLE_HOOKS} の返り値。
 *   setter や `startTransition` も F に入るが、**呼び出し位置の識別子は
 *   読みに数えない**ので、呼ぶだけなら違反にならない
 * - **G**（往復をまたぐ関数）= 自分の本体に `await` を持つ関数 ∪ その
 *   本体に**値位置の識別子**として現れる島の局所関数の閉包。値位置で
 *   数えるので、`setTimeout(later)` / `.then(later)` のように参照で渡して
 *   後から走らせる形も G に入る
 * - **シャドウ**は関数のノードまで遡って数える。G の関数自身の仮引数が
 *   F と同じ名前でも、それは別の値なので読みではない
 *
 * 主張は「G の中に F の読みが 0 件」である。型ノード・プロパティ名・
 * シャドウされた名前は読みではないので除く。定義域の中なら、state・
 * 関数・props を足しても検査の編集は要らない。
 *
 * 置き場所が島の隣なのは、検査が `editor.tsx` 1 ファイルに掛かるからで
 * ある（リポジトリ全体に掛かる規約走査は `app/__tests__/` が持つ）。
 */

/**
 * 描画を跨いで同一性が変わらないフック。返すのは生きた値を持つ入れ物か、
 * 描画に依らない同一性であって、描画が捕まえた値ではない。
 *
 * 載せるのは**フックの意味論だけ**で、state 名は載せない。表に無いフック
 * （`useMemo` / `useOptimistic` / 自作フック）は全束縛を捕まえた値と見なす
 * — 漏れる側ではなく余計に赤くなる側へ倒す。
 */
const STABLE_HOOKS: ReadonlySet<string> = new Set([
  "useRef",
  "useRouter",
  "useId",
  "useServerFn",
]);

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

/** 部分木を全部降りる。入れ子の関数リテラルの中にも入る。 */
const walk = (node: ts.Node, visit: (child: ts.Node) => void): void => {
  eachChild(node, (child) => {
    visit(child);
    walk(child, visit);
  });
};

/**
 * 根も含めて降りる。式本体のアロー関数は本体そのものが読みなので、根を
 * 飛ばすとその 1 語を落とす。
 */
const walkInclusive = (
  node: ts.Node,
  visit: (child: ts.Node) => void,
): void => {
  visit(node);
  walk(node, visit);
};

const isHookCall = (
  node: ts.Node | undefined,
  hook: string,
): node is ts.CallExpression =>
  node !== undefined &&
  ts.isCallExpression(node) &&
  ts.isIdentifier(node.expression) &&
  node.expression.text === hook;

const isStableHookCall = (node: ts.Node | undefined): boolean =>
  node !== undefined &&
  ts.isCallExpression(node) &&
  ts.isIdentifier(node.expression) &&
  STABLE_HOOKS.has(node.expression.text);

/** 束縛が導入する名前（分割代入も含めて平らに集める）。 */
const boundNames = (name: ts.BindingName): readonly string[] => {
  if (ts.isIdentifier(name)) return [name.text];
  return name.elements.flatMap((element) =>
    ts.isBindingElement(element) ? boundNames(element.name) : [],
  );
};

/** 識別子が値として置かれている位置か（呼び出し位置も含む）。 */
const isValuePosition = (id: ts.Identifier): boolean => {
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
  if (ts.isFunctionDeclaration(parent) && parent.name === id) return false;
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

/** 呼び出しの相手として書かれているか。 */
const isCallee = (id: ts.Identifier): boolean => {
  const parent = id.parent;
  return (
    parent !== undefined &&
    (ts.isCallExpression(parent) || ts.isNewExpression(parent)) &&
    parent.expression === id
  );
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

/**
 * `root` までのスコープ鎖に同名の束縛があるか。`root` は関数のノード自身
 * なので、その関数の仮引数も数える。
 */
const isShadowed = (id: ts.Identifier, root: ts.Node): boolean => {
  for (let node = id.parent; node !== undefined; node = node.parent) {
    if (scopeNames(node).includes(id.text)) return true;
    if (node === root) break;
  }
  return false;
};

type Violation = Readonly<{ line: number; name: string }>;

type Analysis = Readonly<{
  stateNames: ReadonlySet<string>;
  capturedNames: ReadonlySet<string>;
  crossing: ReadonlySet<FunctionLike>;
  violations: readonly Violation[];
}>;

const analyze = (source: string, fileName: string): Analysis => {
  const sourceFile = ts.createSourceFile(
    fileName,
    source,
    ts.ScriptTarget.ESNext,
    true,
    ts.ScriptKind.TSX,
  );

  /** 島 = `useState` を直下に持つ関数。名前で決め打ちにしない。 */
  const island = ((): ts.FunctionDeclaration => {
    for (const statement of sourceFile.statements) {
      if (
        !ts.isFunctionDeclaration(statement) ||
        statement.body === undefined
      ) {
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
    throw new Error(`no island found in ${fileName}`);
  })();
  const islandBody = island.body as ts.Block;

  const islandDeclarations = islandBody.statements.flatMap((statement) =>
    ts.isVariableStatement(statement)
      ? [...statement.declarationList.declarations]
      : [],
  );

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

  const capturedNames = ((): ReadonlySet<string> => {
    const names = new Set<string>();
    for (const parameter of island.parameters) {
      for (const name of boundNames(parameter.name)) names.add(name);
    }
    for (const declaration of islandDeclarations) {
      const initializer = declaration.initializer;
      if (initializer !== undefined && isFunctionLike(initializer)) continue;
      if (isStableHookCall(initializer)) continue;
      for (const name of boundNames(declaration.name)) names.add(name);
    }
    return names;
  })();

  /** 島の局所関数（名前で呼べる・名前で渡せるもの）。 */
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
    visit(fn.body);
    return found;
  };

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
      walkInclusive(fn.body, (node) => {
        if (!ts.isIdentifier(node) || !isValuePosition(node)) return;
        const callee = localFunctions.get(node.text);
        if (callee === undefined || reached.has(callee)) return;
        if (isShadowed(node, fn)) return;
        reached.add(callee);
        queue.push(callee);
      });
    }
    return reached;
  })();

  const violations = ((): readonly Violation[] => {
    const found = new Map<number, Violation>();
    for (const fn of crossing) {
      const body = fn.body;
      if (body === undefined) continue;
      walkInclusive(body, (node) => {
        if (!ts.isIdentifier(node)) return;
        if (!capturedNames.has(node.text)) return;
        if (!isValuePosition(node) || isCallee(node)) return;
        if (isShadowed(node, fn)) return;
        const line =
          sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile))
            .line + 1;
        found.set(line, { line, name: node.text });
      });
    }
    return [...found.values()].sort((a, b) => a.line - b.line);
  })();

  return { stateNames, capturedNames, crossing, violations };
};

const ISLAND = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../editor.tsx",
);

const editor = analyze(readFileSync(ISLAND, "utf8"), ISLAND);

/**
 * 検査の効きを固定するための最小の島。`BODY` / `LATER` / `SECOND` の
 * 3 か所に 1〜2 行を注入して、往復をまたぐ関数から捕まえた値へ届く形が
 * 赤くなることを確かめる。
 *
 * 注入前の状態で違反 0 であることが陰性の側を固定する — `shadowed` の
 * 仮引数 `mode` は F と同名だが別の値であり、`crossing` が呼ぶ setter と
 * `startTransition` は呼び出し位置なので、どちらも読みではない。
 */
const FIXTURE = `
export function Island({ target }: { target: { kind: string } }) {
  const router = useRouter();
  const fieldId = useId();
  const persist = useServerFn(persistFn);
  const liveRef = useRef({ mode: "html" });
  const [mode, setMode] = useState("html");
  const [pending, startTransition] = useTransition();
  const memo = useMemo(() => mode.length, [mode]);
  const derived = mode + "!";

  const readDerived = () => derived;

  const later = () => {
    /* LATER */
  };

  const first = () => {
    second();
  };

  const second = () => {
    /* SECOND */
  };

  const shadowed = async (mode: string) => {
    await persist();
    return mode.length;
  };

  const crossing = async () => {
    await persist();
    setMode(liveRef.current.mode);
    startTransition(() => setMode("html"));
    /* BODY */
  };

  return <div id={fieldId} onClick={() => void crossing()} />;
}
`;

const withInjection = (
  slots: Readonly<{ body?: string; later?: string; second?: string }>,
): Analysis =>
  analyze(
    FIXTURE.replace("/* BODY */", slots.body ?? "")
      .replace("/* LATER */", slots.later ?? "")
      .replace("/* SECOND */", slots.second ?? ""),
    "fixture.tsx",
  );

describe("live reads in the note editor island", () => {
  it("computes both sets from the source", () => {
    expect(editor.stateNames.size).toBeGreaterThan(10);
    expect(editor.capturedNames.size).toBeGreaterThan(editor.stateNames.size);
    expect(editor.crossing.size).toBeGreaterThan(10);
  });

  it("reads no render-captured value from a function that crosses a roundtrip", () => {
    expect(
      editor.violations.map(({ line, name }) => `editor.tsx:${line} ${name}`),
    ).toEqual([]);
  });

  it.each([
    ["a direct read", { body: "console.log(mode);" }, "mode"],
    [
      "an inline closure",
      { body: "setTimeout(() => console.log(mode), 0);" },
      "mode",
    ],
    [
      "a local function handed to setTimeout",
      { body: "setTimeout(later, 0);", later: "console.log(mode);" },
      "mode",
    ],
    [
      "a local function handed to then",
      { body: "void persist().then(later);", later: "console.log(mode);" },
      "mode",
    ],
    [
      "a local function handed to requestAnimationFrame, two hops deep",
      { body: "requestAnimationFrame(first);", second: "console.log(mode);" },
      "mode",
    ],
    ["a useMemo value", { body: "console.log(memo);" }, "memo"],
    ["a useTransition value", { body: "console.log(pending);" }, "pending"],
    ["a prop", { body: "console.log(target.kind);" }, "target"],
    [
      "a value derived through a local function",
      { body: "console.log(readDerived());" },
      "derived",
    ],
  ])("reports %s", (_label, slots, name) => {
    expect(withInjection(slots).violations.map((v) => v.name)).toContain(name);
  });

  it("reports nothing for a parameter that shares a name with a captured value", () => {
    expect(withInjection({}).violations).toEqual([]);
  });
});
