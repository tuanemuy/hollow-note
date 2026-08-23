# API 検証結果 — Issue #13 / PR #36

**実行日:** 2026-08-23
**ブランチ:** issue/13/reduce-navigation-rpc-roundtrips
**コミット:** 4fe41b0

## 項目 16: 品質ゲート（AC-10）

| コマンド | 終了コード |
| --- | --- |
| `pnpm typecheck` | 0 |
| `pnpm lint:fix` | 0 |
| `pnpm format` | 0 |
| `pnpm test` | 0 |

**期待:** 4 つとも終了コード 0。`pnpm test` に `apps/web/app/presentation/__tests__/redirect.test.ts` が含まれ、全ケースが pass する。

**観測:**

`pnpm test`（`pnpm test:unit` → `vitest run`）の最終サマリー行（そのまま転記）:

```
 Test Files  76 passed (76)
      Tests  935 passed | 3 skipped (938)
   Start at  15:08:19
   Duration  5.36s (transform 3.82s, setup 0ms, import 12.22s, tests 13.96s, environment 6ms)
```

`redirect.test.ts` が実行対象に含まれていたか: デフォルトの reporter はファイル名を一覧表示しないため、`pnpm test` のログ内に `redirect.test` という文字列は出現しなかった（`grep -n "redirect.test" test.log` → 出力なし、exit=1）。別途 `npx vitest run apps/web/app/presentation/__tests__/redirect.test.ts --reporter=verbose` を実行し、対象ファイルが存在し全 12 ケースが pass することを個別に確認した（そのまま転記）:

```
 RUN  v4.1.10 /Users/hikaru/github.com/tuanemuy/hollow

 ✓ apps/web/app/presentation/__tests__/redirect.test.ts > safeRedirectPath > keeps a same-origin absolute path 1ms
 ✓ apps/web/app/presentation/__tests__/redirect.test.ts > safeRedirectPath > rejects protocol-relative URLs 0ms
 ✓ apps/web/app/presentation/__tests__/redirect.test.ts > safeRedirectPath > rejects backslashes, which some browsers normalize to slashes 0ms
 ✓ apps/web/app/presentation/__tests__/redirect.test.ts > safeRedirectPath > rejects control characters, which URL parsers strip before resolving 0ms
 ✓ apps/web/app/presentation/__tests__/redirect.test.ts > safeRedirectPath > rejects scheme-ful values 0ms
 ✓ apps/web/app/presentation/__tests__/redirect.test.ts > safeRedirectPath > rejects relative paths 0ms
 ✓ apps/web/app/presentation/__tests__/redirect.test.ts > safeRedirectPath > falls back for absent values 0ms
 ✓ apps/web/app/presentation/__tests__/redirect.test.ts > signInRedirectOptions > carries a same-origin path back as the sign-in destination 0ms
 ✓ apps/web/app/presentation/__tests__/redirect.test.ts > signInRedirectOptions > passes percent-encoded control characters through undecoded 0ms
 ✓ apps/web/app/presentation/__tests__/redirect.test.ts > signInRedirectOptions > never lets an off-origin value reach the sign-in search param 0ms
 ✓ apps/web/app/presentation/__tests__/redirect.test.ts > boundedRedirectSource > keeps an href at or below the transport limit 1ms
 ✓ apps/web/app/presentation/__tests__/redirect.test.ts > boundedRedirectSource > clamps an href past the transport limit to the default destination 0ms

 Test Files  1 passed (1)
      Tests  12 passed (12)
   Start at  15:08:34
   Duration  141ms (transform 24ms, setup 0ms, import 34ms, tests 5ms, environment 0ms)
```

`ls -la apps/web/app/presentation/__tests__/redirect.test.ts` の出力（ファイル自体の存在確認、そのまま転記）:

```
.rw-r--r--@ 3.8k hikaru 23 8月  13:36 /Users/hikaru/github.com/tuanemuy/hollow/apps/web/app/presentation/__tests__/redirect.test.ts
```

`pnpm test` 全体のサマリーでは 76 ファイル中 935 tests passed（3 skipped）。個別実行で確認した 12 ケースはこの合計に含まれる形になっている（個別ファイルの内訳は `pnpm test` のデフォルト出力では表示されない）。

**`pnpm lint:fix` / `pnpm format` によるファイル書き換え:** `git status --short` の出力はいずれも空だった（変更なし）。

## 項目 17: ドキュメントから「ガードとハンドラーの二重化」の記述が消えている（AC-13）

**手順:**
```
grep -n "defense in depth" docs/frontend_implementation_example.md
grep -n "the pair is intentional" docs/frontend_implementation_example.md
grep -n "return 401" docs/frontend_implementation_example.md
grep -c "requireSessionOrRedirect" docs/frontend_implementation_example.md
grep -c "shouldReload" docs/frontend_implementation_example.md
```

**期待結果:** 最初の 3 つは出力なし（終了コード 1）。`requireSessionOrRedirect` と `shouldReload` の件数はいずれも 1 以上。

**観測:**

| grep | 出力 | 終了コード |
| --- | --- | --- |
| `grep -n "defense in depth" docs/frontend_implementation_example.md` | （出力なし） | 1 |
| `grep -n "the pair is intentional" docs/frontend_implementation_example.md` | （出力なし） | 1 |
| `grep -n "return 401" docs/frontend_implementation_example.md` | （出力なし） | 1 |
| `grep -c "requireSessionOrRedirect" docs/frontend_implementation_example.md` | `7` | 0 |
| `grep -c "shouldReload" docs/frontend_implementation_example.md` | `6` | 0 |

`return 401` がヒットしなかったため、該当行の全文・前後 3 行の転記は該当なし。

## 項目 18: `requireAuthenticated` の参照がリポジトリに残っていない（AC-14）

**手順:**
```
grep -rn "requireAuthenticated" --exclude-dir=node_modules --exclude-dir=.git --exclude-dir=.thread .
grep -n "safeRedirectPath" apps/web/app/presentation/auth.ts
```

**期待結果:** 1 つ目は出力なし（終了コード 1）。2 つ目も出力なし。

**観測:**

| grep | 出力 | 終了コード |
| --- | --- | --- |
| `grep -rn "requireAuthenticated" --exclude-dir=node_modules --exclude-dir=.git --exclude-dir=.thread .` | （出力なし） | 1 |
| `grep -n "safeRedirectPath" apps/web/app/presentation/auth.ts` | （出力なし） | 1 |

補足: `apps/web/app/presentation/auth.ts` はファイルとして存在し、空ファイルではない（`ls -la` 出力: `.rw-r--r--@ 731 hikaru 23 8月 12:56 /Users/hikaru/github.com/tuanemuy/hollow/apps/web/app/presentation/auth.ts`）。したがって出力なしはファイル不在によるものではない。
