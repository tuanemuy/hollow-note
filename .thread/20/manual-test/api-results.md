# api 項目の観測結果 — Issue #20

**実行日:** 2026-08-22
**ブランチ:** issue/20/oauth-state-binding-nonce
**コミット:** 6cd63f9

## 品質ゲート（AC-7）

| # | コマンド | 期待結果 | 観測した出力 |
|---|---|---|---|
| 1 | `pnpm typecheck` | 型エラーなしで完了 | ```\n$ tsgo && pnpm -r typecheck\nScope: 2 of 3 workspace projects\npackages/core typecheck$ tsgo\npackages/core typecheck: Done\napps/web typecheck$ tsgo\napps/web typecheck: Done\n``` |
| 2 | `pnpm lint:fix` | 新たな修正が適用されない | ```\n$ biome check --write\nbiome.json:2:14 deserialize ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n  i The configuration schema version does not match the CLI version 2.5.5\n  \n    1 │ {\n  > 2 │   "$schema": "https://biomejs.dev/schemas/2.4.15/schema.json",\n      │              ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^\n    3 │   "vcs": {\n    4 │     "enabled": true,\n  \n  i   Expected:                     2.5.5\n      Found:                        2.4.15\n  \n  \n  i Run the command biome migrate to migrate the configuration file.\n  \n\nbiome.json:25:13 deserialize  DEPRECATED  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n  i The use of the recommended field has been deprecated, and will removed in the next major version of Biome. Use preset instead.\n  \n    23 │   },\n    24 │   "assist": { "actions": { "source": { "organizeImports": "on" } } },\n  > 25 │   "linter": {\n       │             ^\n  > 26 │     "enabled": true,\n        ...\n  > 52 │     }\n  > 53 │   },\n       │   ^\n    54 │   "javascript": {\n    55 │     "formatter": {\n  \n  i Migrate the configuration with the proper command\n  \n  $ biome migrate\n  \n\nChecked 443 files in 318ms. No fixes applied.\nFound 2 infos.\n``` |
| 3 | `pnpm format` | 新たな整形が発生しない | ```\n$ biome format --write\nFormatted 443 files in 71ms. No fixes applied.\n``` |
| 4 | `pnpm test` | 失敗 0 | ```\n$ pnpm test:unit\n$ vitest run\n\n RUN  v4.1.10 /Users/hikaru/github.com/tuanemuy/hollow\n\n\n Test Files  76 passed (76)\n      Tests  930 passed | 3 skipped (933)\n   Start at  17:58:49\n   Duration  5.31s (transform 3.85s, setup 0ms, import 12.19s, tests 13.61s, environment 5ms)\n``` |

## 作業ツリーの状態

`git status --short` の出力:

```
(空)
```
