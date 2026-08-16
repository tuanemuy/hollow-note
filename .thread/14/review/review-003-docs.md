# レビュー R3（収束確認） — ADR・プロジェクトドキュメント・乖離台帳

**対象:** PR #22 / `origin/main...HEAD`（`55a5bb9..da8803c`）
**このラウンドの目的:** 第 2 ラウンドの修正（triage `M-62`〜`M-87`）が正しく入っているか / 対になる側が置き去りになっていないか / AC の検査が実際に通るか の 3 点のみ。新規の粗探しはしていない。

## ADR・プロジェクトドキュメント・乖離台帳

### Blockers

なし。

### Warnings

- **[W-001]** `.thread/14/steps.md` の最終確認手順とコミット表が R1 時点の実測のまま残り、R2 で実測へ改めた `plan.md` の AC と食い違う。
  - **場所:** `.thread/14/steps.md:131`（コミット分割表）/ `:478`（ステップ 17-3）/ `:482`（17-7）/ `:483`（17-8）
  - **実測との差:**
    - 17-3 / :131 — 「**27 ファイル = 変更 24 / 削除 3**」「機械検査が **12 行**」。実測は **35 ファイル = 変更 32 / 削除 3**、機械検査は **14 行**（本レビューで両方とも実行して確認。plan.md AC-63 の値と一致）
    - 17-7 — 「**7 つの Issue 番号と 4 つのコメント URL**」。plan.md のスコープ節と AC-23 / AC-60 は **新規 Issue 12 本 ＋ コメント 4 件**（AC-23 の 4 ＋ AC-60 の 12 参照）
    - 17-8 — 「`DOM` **8 行** / `ADP` 8 行 / `UC` 3 行」「TC は**新設 3 ファイルの行と `requestPasswordReset` の境界 2 行**」。実測は DOM **11 行**、TC は **32 行 / 9 ユースケース**（AC-55 / AC-64 の R2 改訂後の値）
  - **理由:** R1 の `M-45` は「手順どおり検証すると正しい PR がスコープ逸脱と判定される」を理由に `.thread/14/testing.md` の件数を直し、R2 の `M-80` は同じ理由で `plan.md` の AC-55 / AC-63 / AC-64 を実測へ改めた。**同じクラスの検証手順が `steps.md` にだけ 1 ラウンドも追随していない。** `testing.md` は今回「件数と内訳の正典は AC-63 だけで、この文書には写さない」と書いて二重管理そのものを解消した（良い解き方）のに対し、`steps.md` は R1 の数値を写したまま残っている。ステップ 17 は実行手順として書かれているので、これを読んで最終確認をする人は正しい PR を逸脱と判定する。
  - **緩和材料:** AC-63 の本文が「**AC-24 / ステップ 17-3 の件数を上書きする**」と明示しており、17-8 も参照先が AC-55 / AC-64（どちらも実測値）なので、AC まで辿る読者は正しい値に着く。**Blocker にはしない**が、片側置き去りとしては R1 / R2 で最も多かった形そのもの。
  - **提案:** `testing.md` と同じ解き方を採る — 17-3 / 17-7 / 17-8 / `:131` の件数を本文から落とし、「件数と内訳の正典は `plan.md` の AC-63 / AC-55 / AC-64 / AC-60」と参照に置き換える（数値を書き換えるだけだと次の修正ラウンドでまた陳腐化する）。

- **[W-002]** `.thread/14/plan.md` の 2 か所が「適合スイートの `describe` / `it` 名に ADP ID を付ける」と書いており、V1（M-62）が確定させた `spec/adr/052` の決定と食い違う。
  - **場所:** `.thread/14/plan.md:169`（Phase 5 の 6. の起票骨子）/ `:219`（リスク節）
  - **理由:** `spec/adr/052:24` は R2 で「ケース名（`it` の第 1 引数）の先頭に ADP ID を置く。**`describe` はスイート名だけを名乗り、ID は持たない**」と 1 つの形に確定した（`spec/inventory/adapter.md:5` と `spec/adr/index.md:114` も同じ文言へ追随済み）。triage M-62 は「`plan.md:215` は既に『`describe` / `it` 名』と書いており正しいのは plan 側」と判定したが、その後 V1 が規約を `it` 名一本に絞ったので、**両論併記だった plan 側が今度は緩い側になった**（ADR-034 の代替案節も「両論併記のまま残す」を明示的に棄却している）。
  - **実害の見込み:** `:169` は Phase 5 で起票する Issue の骨子で、そのまま Issue 本文になる。骨子どおりに実装すると「34 本の `describe` に ADP ID を付ける」という、052 が明示的に棄却した成果物が作られうる。
  - **付随して件数も合わない:** `:219` の「適合スイートも**この 5 本だけ** `describe` / `it` 名に ADP ID を持たない（他 **20 本**は持つ）」— 実測すると `adapters/conformance/` のスイートは **31 本**（ヘルパー 4 本を除く）で、ADP ID を 1 つも持たないのは列挙どおり **5 本**（`appliedOperationStore` / `distributedOperationStore` / `identityRemovalReceiptStore` / `outboxRepository` / `scopeTaskScheduler`）、持つのは **26 本**。「5 本だけ」は正しく、「他 20 本」だけがずれている。
  - **提案:** `:169` / `:219` の「`describe` / `it` 名」を「`it` 名」へ、`:219` の「他 20 本」を「他 26 本」へ。

- **[W-003]** `.thread/14/adr.md` の ADR-029 / ADR-035 が挙げる「到達不能 ID 21 本」の帰属が 1 本だけずれている。
  - **場所:** `.thread/14/adr.md:1063`（ADR-029 Consequences）/ `:1261`（ADR-035 代替案）
  - **記述:** 「実測で **`it` 名の短縮連記が 31 ケース**、そのうち**単体 grep で到達できない ID が 21 本**ある」＋ 21 本の列挙
  - **実測:** `it` 名の短縮連記は **31 ケース**で一致。ただしそこから抽出できる到達不能 ID は **20 本**で、列挙にある 21 本目の `ADP-identity-034` は `it` 名ではなく **`signInOAuthClient.ts:41` のファイル冒頭 JSDoc**（`(ADP-identity-033/034, 040)`）の短縮由来である。ディレクトリ全体（`it` 名 ＋ ヘッダーコメント）で数えれば **21 本**で列挙とちょうど一致する。
  - **理由:** ADR-035 の決定は「ヘッダーコメントの範囲表記も同じ」と明記しており、**規則の射程としては 21 本で正しい**。ずれているのは「`it` 名の短縮連記 31 ケースの**うち**」という係り受けだけ。ADR-029 / ADR-035 の判断そのものには影響しない。
  - **提案:** 「`it` 名の短縮連記が 31 ケース、`it` 名とヘッダーコメントを合わせて単体 grep で到達できない ID が 21 本」と 1 語直す。

- **[W-004]** `spec/usecases/note.md` に「以前は〜だった」の改訂履歴が 2 か所残っている（**本 PR 由来ではなく、対応不要でよい**）。
  - **場所:** `spec/usecases/note.md:847`（「以前は受け取ったのと同じ `identity.user.deleted` … を再投入して継続していたが」）/ `:977`（「以前は `expiresAt <= now + 24 時間` を追加条件にしていたが、これは … 読み違えたもので、守る必要のない制約だった」）
  - **理由:** R1 の `M-47` が `spec/index.md:5` / `CLAUDE.md:16` の「日付つきの改訂履歴・廃止済みの判断は置かない」を根拠に同型の 3 か所（`spec/usecases/storage.md` / `spec/testcases/storage/deleteFilesByOwner.md` / `spec/inventory/test.md`）を落としたが、`spec/usecases/note.md` は**本 PR の編集対象ではない**ため検出範囲の外に残った。本レビューで `spec/` `docs/` `CLAUDE.md` `README.md` 全域を走査した結果、この 2 か所以外に同型の残置は無い。
  - **提案:** 本 PR では触らない。Phase 5 の 13.（リポジトリに残る失効した規則）と同じ「本 PR が触っていないファイルの同型の残り」なので、必要なら起票骨子へ 1 行相乗りさせる程度でよい。

## 第 2 ラウンドの修正の検証結果

`triage.md` の R2 の節（`M-62`〜`M-87` の 26 件）を実物と突き合わせた。**26 件すべて反映済み。反映漏れ 0 / 反映ミス 0 / 反映によって生まれた矛盾 1（W-002）。**

とくに指示のあった 5 点:

- **M-62（ADR 052 の記述と ADR 026 への誤帰属）— 正しく入っている。**
  - `spec/adr/052:13` / `:24` が「ケース名（`it` の第 1 引数）の先頭に ADP ID を置き、`describe` はスイート名だけを名乗る」へ改訂済み。`spec/inventory/adapter.md:5` / `spec/adr/index.md:114` も同じ文言へ追随。
  - **`spec/adr/026` を実際に読んで確認した:** 026 の決定 2 が定めるのは `describeXxxContract(name, makeBackend)` という**スイート関数名**の形と「スイート自体が契約の実行形」であることだけで、ID 命名規約も ADP ID も本文に一切出てこない。052:19 の前提節は「契約の正本がポート定義にあり、検証が共有適合スイートであること（026）」＋「ADP 行と適合ケースの対応をどう追うかは 026 が決めておらず、本 ADR が決める」に改まっており、**026 から引ける範囲に正しく閉じている**。誤帰属は解消。
  - 実測との一致も確認: `describe` は全 **34 本**で ADP ID を持つものが **0 本**、ADP ID を名乗る `it` が **166 本**（ADR-034 の記載どおり）。
- **M-86（「レビュー R1」→「計画レビュー R1」）— 正しく入っている。** `.thread/14/research-2.md:448` / `:531` の 2 か所とも `計画レビュー R1` になり、両台帳に「レビュー R」の他用例は残っていない。冒頭の as-of `55a5bb9` 宣言も両ファイルにある。
- **M-84 / ADR-030 の検証 grep — 実際に 0 件になる。**
  `grep -rn "the spec writes\|the spec's output table\|has no usecase in the spec\|no spec TC\|the spec mandates it unconditionally\|spec の記載漏れ" packages/ apps/` = **0 件**（`git grep` 版も 0 件）。ADR-030 Consequences に「検査語は否定形に絞ってある」理由（`the spec's` 単体が拾う 2 件、`the spec mandates` 単体が拾う `noteAccessPolicy.ts:51`）も記録されている。
- **ADR-029 の更新 — 「全数拾える」が偽である前提へ改まっている。** Consequences が「**ただし『採番済み ID を全数拾えるようになる』は成立しない**」と明示し、残存分（短縮連記 31 ケース）と到達不能 ID の列挙、全形化の規則を ADR-035 と `spec/adr/052:54`（影響節）に置いた、という分担まで書かれている。到達性の主張は「本 PR の採番分まで」に正しく限定されている。数え方の係り受けだけ W-003。
- **ADR-033〜036 — 内容として妥当・既存の判断と矛盾しない・様式に沿っている。**
  - 4 本とも `### Status`（Proposed ＋ 由来の指摘 Key と作業単位）/ `### Context` / `### Decision` / `### 検討した代替案` / `### Consequences` の既存様式に一致。
  - ADR-033（`failed`）は `spec/adr/046`（実装の縮退を写して spec を狭めない）と AC-63（振る舞いを変えない）の両方に照らして「落とさず広げず帰属を明記」を選び、決定を Phase 5 の 16. へ送っている。`spec/presentation/index.md:236` / `PAGE-p25-003` / `PAGE-p25-004` の 3 か所が同じ粒度で書かれていることを実物で確認。
  - ADR-034（052 自身の決定として立てる）は 026 の実文と一致（上記）。代替案「ADR 026 に追記する」を Phase 5 の 12.（ADR 048 の前提改訂）と同じ根拠で棄却しており、既存判断と整合。
  - ADR-035（連記の全形化）は ADR-029 の決定を狭める向きだが、ADR-029 側の代替案節に「この代替案は採用された」と明記して系列が繋がっている。`spec/adr/052:24` に「後続の ID を短縮しない」が入っているのも確認。
  - ADR-036（ADR 057 の軸を広げる）は `spec/adr/057:13` / `:27` / `:28` に反映済み。既存の `verifyEmail | 一時障害` 行と `getUsageSnapshot | 取得の失敗` 行が新しい軸で説明でき、内部矛盾が解消している。
  - **R1 の M-29 で削った「実際にそれが起きた。」は復活していない**（`spec/adr/052`〜`057` にレビュー事象・弁明・作業経緯の記述は 0 件）。
- **Phase 5 起票リスト — 漏れ・重複なし。** `plan.md` スコープ節の 1〜16 が「新規 12（1〜4 / 5〜7 / 12〜16）＋ 既存 Issue へのコメント 4（8〜11）」で、節の見出し・AC-23（4 本）・AC-60（12 参照）と 3 者一致。R1 の defer（M-06）は 5. に「**起票必須**」として、R1 の M-28 は 9.(a) に、R2 の M-70 は 16. に、それぞれ受け皿がある。重複は無い（12. ADR 048 前提 / 13. リポジトリ設定 / 14. `spec/inventory/test.md` の重複行 / 15. `linkOAuthIdentity` 自己所有分岐 / 16. `failed` の生成経路 はいずれも別テーマ）。

## 実行した検査とその結果

すべてリポジトリルートで実行した。

| 検査 | 結果 |
| --- | --- |
| **AC-63** `git diff --name-status $(git merge-base origin/main HEAD) -- packages/ apps/` | **35 件 = 変更 32 / 削除 3 / 追加 0** ✓（plan.md「コード差分の内訳」表の 35 行と 1 対 1 で一致） |
| **AC-63** 機械検査（コメント / JSDoc 行と `describe`・`it` 第 1 引数を除いた残り） | **14 行** ✓。内訳も AC-63 の記載どおり — 適合スイート `ADP-common-008` への追加 9 行（空行 1 含む）/ `containerStore.ts` のエラーメッセージ 3 行 / 削除コメントブロックの残り空行 2 行 |
| **AC-55** `origin/main` との ID 集合差分 | `domain.md` **+11 / -0**（`DOM-common-041,042` `DOM-identity-060〜065` `DOM-note-071,072` `DOM-storage-038`）、`adapter.md` **+8 / -0**、`usecase.md` **+3 / -0** = **22 行**、消えた ID **0 件** ✓ AC-55 の列挙と完全一致。grep 版（8 / 8 / 3）も一致 |
| **AC-64** `ls spec/testcases/identity/*.md \| wc -l` / `grep -c "^\| UC-identity-"` | **24 / 24** ✓。`TC-identity-024` は `completeOAuthSignIn` の 1 件目のまま ✓ |
| **AC-64** TC の ID 集合差分 | `TC-identity-305`〜`335`（31）＋ `TC-usage-073` = **32 行 / 消えた ID 0 件** ✓。ユースケース別内訳（getProfile 6 / checkHandleAvailability 8 / completeOAuthCallback 6 / requestPasswordReset 2 / addPasswordIdentity 3 / completeOAuthSignIn 1 / linkOAuthIdentity 1 / updateProfile 4 / recalculateStorageUsage 1）も AC-64 の列挙と 1 行ずれずに一致 |
| **AC-68 / M-15** `spec/` `docs/` `README.md` `CLAUDE.md` の相対リンクを実際に解決 | **259 ファイル / リンク切れ 0 件** ✓（自作の解決スクリプトで全リンクを `path.resolve` して存在確認） |
| （追加）同じ範囲の**見出しアンカー**（`#...`）を実際に解決 | **解決しないアンカー 0 件** ✓（`#クエリ予算` の類が再発していないことの確認） |
| **AC-60 / AC-23** Phase 5 リストの件数整合 | 新規 12 ＋ コメント 4 で、スコープ節・AC-23・AC-60 の 3 者一致 ✓（起票そのものは Phase 5 で未実施） |
| **AC-29 / AC-61 / AC-69** `ls spec/adr/05[2-7]-*.md` / `spec/adr/index.md` | **6 ファイル** ✓。ADR **52 本すべて**が一覧に 1 行・前提依存マップに 1 行（各 1 回ずつ、過不足 0）✓。dangling リンク 0 / 未掲載 0。ADR 056 は `spec/usecases/storage.md` / `spec/testcases/storage/deleteFilesByOwner.md` / `spec/platform/index.md` の 3 か所からリンク ✓ |
| **AC-20 / AC-22 / AC-25** 実在しない固有名 grep | **0 件** ✓ |
| （追加）`CLAUDE.md` / `README.md` が名指しするファイル・ディレクトリ・`pnpm` スクリプトの実在 | **全件実在** ✓（`packages/core/src/{config.ts,lib/error.ts,domain/error.ts,application/{scope.ts,errors.ts,di/*,adapters/*}}`、`apps/web/app/{start.ts,router.tsx,server.node.ts,presentation/*,worker/node/runner.ts}`、`apps/web/scripts/listen.node.ts`、`apps/web/vite.config.node.ts`、`docs/*.md`、参照している 13 スクリプトはすべて root / `@repo/web` の `package.json` に実在。`AGENTS.md` → `CLAUDE.md` のシンボリックリンクも健在。domain 8 フォルダの記述も実測と一致） |
| **M-17 / ADR 057** `spec/manual-tests/` の集計 | `account.md` の実測 **42 / 正常系 14 / 異常系 24 / 境界値 4**、`index.md` の行と合計行（**319 / 133 / 161 / 25**）が実測と完全一致 ✓ |
| **M-68** ユースケースエラーケース対応表 | 本 PR が増やした失敗経路（`startOAuthFlow` の非 active / `completeOAuthSignIn`・`linkOAuthIdentity` の claim 残置 / `addPasswordIdentity` 3 / `getProfile` 3 / `checkHandleAvailability` 1 / `completeOAuthCallback` 3 / `recalculateStorageUsage` 1）がすべて行として存在し、いずれも `対象外` ＋ 理由 1 行 ✓ |
| **M-71 / M-72 / ADR-029 / ADR-035** ADP ID の到達性 | 本 PR 採番の 8 ID ＋ `ADP-identity-007` の **9 本すべてが単体 grep で `adapters/conformance/` にヒット** ✓（`ADP-note-056` = 2 件 / `ADP-identity-007` = 5 件）。連記は全形（`ADP-note-055/ADP-note-056`、`ADP-identity-041/ADP-identity-007`）✓ |
| **M-62** `describe` / `it` の実測 | `describe` 34 本中 ADP ID を含むもの **0 本**、ADP ID を名乗る `it` **166 本** ✓（ADR-034 の記載と一致） |
| **M-85** `.dockerignore` | `**/.wrangler` / `infra/aws/cdk.out` / `!.env.*.example` の 3 行が消え、残る 12 行はすべて実在の対象を持つ ✓ |
| plan.md「テスト方針」の 0 件検査 / 1 件以上検査 / 件数一致検査 | **全項目が想定どおり** ✓（`NOTE_ROUTE_BATCH_TOO_LARGE` 0 / `shareTokenProtector` の `ExternalServiceError` 0 / `start.ts` の `AC-15` 0 / identity 3 か所の `InvalidProvider` 0 / `多行 outbox INSERT` 0 / `sha256("removeIdentity` 0 / `クエリ予算` 0 / `sha256(parentOperationId` 0 / `ensureAcceptable({...mimeType, size})` 0 / `declaredMimeType` **1** / `rejected attempt` 0 / `createDownloadUrl` 3 / `workspaceCursor` 1 / `next_attempt_at` 2 / P-25「削除されるもの」1 / `AppliedOperationStore` in `domains/index.md` 1）。identity 側の `ExternalServiceError` も **0 件**（残る 8 件は conversion / integration / job / storage、すなわち SYNC-27 のスコープ外分のみ） |
| `spec/inventory/*.md` 5 ファイルの「最終同期」 | 5 ファイルとも **2026-08-16**（本日）✓ |
| `spec/` `docs/` `CLAUDE.md` `README.md` の弁明・改訂履歴・作業経緯の走査 | `spec/adr/052`〜`057` に **0 件**、`.thread/14/research{,-2}.md` に **0 件**、`.thread/14/adr.md` に一人称の意見表明 **0 件**。`spec/` 全域で残るのは W-004 の 2 か所のみ（本 PR 非対象ファイル） |

## 対になる側の確認

- **`spec/adr/052` の規約 ↔ 適合スイートの `it` 名** — 一致 ✓。052 が言う「`it` 名の先頭に ADP ID」「`describe` は ID を持たない」「連記は短縮しない」の 3 点が、V7 が触った 2 ファイルを含め実測と矛盾しない。052:54 が「既存の短縮連記は残っており、触れた回で全形化する」と正直に記録しているので、実測（31 ケース残置）と ADR の主張が食い違わない。
- **`.thread/14/adr.md` の ADR ↔ `spec/adr/` へ昇格済みの内容** — ADR-011 / ADR-016（052 の本文）/ ADR-014（056）/ ADR-010（057）/ ADR-029・035（052 の決定と影響節）/ ADR-036（057 の決定）/ ADR-033（`spec/presentation/index.md` と `PAGE-p25-003/004`）がすべて昇格先で確認でき、昇格元と決定内容が一致 ✓。ADR-034 は「052 自身の決定として立てる」という判断そのものが 052 の前提節に反映されている ✓。
- **`.thread/14/plan.md` の AC ↔ 実測** — AC-55 / AC-63 / AC-64 は実測と完全一致（上表）。AC-60 は件数整合のみ確認（起票は Phase 5）。**唯一の不一致が `steps.md` 側（W-001）と `plan.md` の 2 か所（W-002）。**
- **`spec/inventory/*` ↔ 本文** — R2 が触った対（`PAGE-p03-004` ↔ `spec/pages/index.md:178`、`PAGE-p25-003/004` ↔ `spec/presentation/index.md:236`、`DOM-identity-064/065` ↔ `spec/domains/identity.md:46,374`、`TC-identity-330〜335` / `TC-usage-073` ↔ 各テストケースファイル、`DOM-note-037`・`DOM-common-013`・`DOM-storage-034` ↔ 対応する ADP 行）を全件つき合わせ、いずれも同文・同粒度 ✓。

## カバレッジ

- **確認（87 件）:**
  - `.dockerignore`
  - `.thread/14/adr.md`, `.thread/14/plan.md`, `.thread/14/steps.md`, `.thread/14/testing.md`, `.thread/14/research.md`, `.thread/14/research-2.md`
  - `CLAUDE.md`, `README.md`, `docs/backend_implementation_example.md`, `docs/frontend_implementation_example.md`
  - `spec/adr/052-adapter-inventory-granularity.md`, `spec/adr/053-account-deletion-rollback-completion.md`, `spec/adr/054-provider-account-uniqueness-owner.md`, `spec/adr/055-session-expiry-derivation.md`, `spec/adr/056-performance-budget-placement.md`, `spec/adr/057-manual-test-followthrough.md`, `spec/adr/index.md`（＋対照として `spec/adr/026-port-contract-and-conformance.md` を全文精読）
  - `spec/database/index.md`, `spec/domains/identity.md`, `spec/domains/index.md`, `spec/domains/note.md`, `spec/domains/storage.md`, `spec/domains/usage.md`
  - `spec/inventory/adapter.md`, `spec/inventory/domain.md`, `spec/inventory/frontend.md`, `spec/inventory/test.md`, `spec/inventory/usecase.md`
  - `spec/manual-tests/account.md`, `spec/manual-tests/index.md`, `spec/pages/index.md`, `spec/platform/index.md`, `spec/presentation/index.md`, `spec/scenario/account.md`
  - `spec/testcases/identity/{addPasswordIdentity,checkHandleAvailability,completeOAuthCallback,completeOAuthSignIn,deleteAccount,getProfile,linkOAuthIdentity,requestPasswordReset,signUpWithPassword,startOAuthFlow,updateProfile}.md`（11 件）
  - `spec/testcases/storage/{deleteFilesByOwner,storeUpload}.md`, `spec/testcases/usage/recalculateStorageUsage.md`
  - `spec/usecases/identity.md`, `spec/usecases/storage.md`, `spec/usecases/usage.md`
  - `apps/web/.dev.vars.example`（削除）, `apps/web/.env.aws.example`（削除）, `apps/web/.env.gcp.example`（削除）
  - `apps/web/app/components/settings/DeleteAccountPanel/ticketStorage.ts`, `apps/web/app/components/settings/ProfileForm/action.ts`, `apps/web/app/presentation/oauthStateCookie.ts`, `apps/web/app/presentation/session.ts`, `apps/web/app/start.ts`
  - `packages/core/src/adapters/conformance/{accountDeletionManifestStore,authTokenRepository,identityUniqueDirectory,noteProjection,objectStorage,scopeCleanupAdmissionStore,signInOAuthClient}.ts`（7 件）
  - `packages/core/src/application/di/containerStore.ts`
  - `packages/core/src/application/identity/__tests__/{checkHandleAvailability,getProfile,updateProfile}.test.ts`（3 件）
  - `packages/core/src/application/identity/{addPasswordIdentity,changePassword,completeOAuthCallback,getProfile,removeIdentity,uniqueness,view}.ts`（7 件）
  - `packages/core/src/application/ports/{accountDeletionManifestStore,scopeCleanupAdmissionStore,shareTokenProtector}.ts`（3 件）
  - `packages/core/src/application/storage/__tests__/deleteFilesByOwner.test.ts`
  - `packages/core/src/domain/identity/errorCode.ts`, `packages/core/src/domain/identity/ports/{authTokenRepository,identityRepository,identityUniqueDirectory}.ts`, `packages/core/src/domain/storage/errorCode.ts`（5 件）

  確認の深さは 2 段階ある。**(a) 全文または R2 差分を読んだもの** — `.thread/14/{adr,plan,steps,testing,research,research-2}.md`、`spec/adr/*`（新設 6 本 ＋ index ＋ 026）、`CLAUDE.md`、`README.md`、`spec/inventory/*`、`spec/manual-tests/*`、`spec/presentation/index.md`、`spec/pages/index.md`、`spec/domains/identity.md`、R2 が触ったコード 12 ファイル。**(b) 機械検査でのみ確認したもの** — 上記以外の `spec/` 本文とコード。ただしコードは **AC-63 の機械検査が差分行の 100% を通している**（14 行を除く全行がコメント / JSDoc / `it`・`describe` 名であることを証明済み）ので、振る舞い面の未確認は残らない。`spec/` 本文は全リンク・全アンカー解決、ID 集合差分、`plan.md`「テスト方針」の全 grep、`spec/` 全域の弁明・改訂履歴走査を通している。

- **スキップ（14 件）:** `.thread/14/review/review-001.md`, `review-001-{docs,domain,general,inventory,presentation,usecase}.md`, `review-002.md`, `review-002-{docs,domain,inventory,presentation,usecase}.md`, `review/triage.md` — レビュー中間成果物（後続フェーズで削除される。`triage.md` は既出判定の入力として全文を読んだが、内容のレビューはしていない）

確認 **87** ＋ スキップ **14** = **101**（変更ファイル一覧と 1 対 1）。

## 収束判定

**はい（実装レビューを終えてよい）。**

- **Blocker 0 件。** 第 2 ラウンドの 26 件はすべて反映済みで、反映漏れ・反映ミスは 0。
- 検証の中心に指定された 5 点（M-62 の ADR 026 誤帰属是正 / M-86 / M-84 の grep / ADR-029 の「全数拾える」撤回 / ADR-033〜036 の妥当性）は**全件が正しく入っている**。AC-55 / AC-60 / AC-63 / AC-64 / AC-68 は自分で実測し、**すべて記載値と一致した**（相対リンク 0 件切れ、見出しアンカーも 0 件切れ）。
- Warning 4 件のうち **W-002 だけは Phase 5 の起票前に直すのが望ましい**（起票骨子がそのまま Issue 本文になり、ADR 052 が棄却した成果物を指示してしまうため）。ただし `spec/` 正典側は既に正しく、コードにも影響しないので、マージの前提条件にはしない。
- W-001 / W-003 は `.thread/14/` の作業成果物の件数ずれで、いずれも参照先の AC / ADR 本文が正しい値を持っている。W-004 は本 PR が触っていないファイルの既存記述。
