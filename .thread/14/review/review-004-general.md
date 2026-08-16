# General Review（R003 修正のスコープ確認）

**対象:** `git diff HEAD~1 HEAD`（コミット `75a7c27` — 「fix: レビュー R003 の指摘 11 件を反映する」）
**照合先:** `.thread/14/review/triage.md` の第 3 ラウンドの節（`M-88`〜`M-102`）／ `.thread/14/plan.md`
**方針:** 新規の粗探しはしない。(1) fix 11 件の反映、(2) 修正が生んだ矛盾・退行、(3) wont-fix 4 件の送付先・記録先の実在、(4) 受け入れ基準の検査の実行、の 4 点に限る。

## Blockers

なし。

## Warnings

- **[W-001]** `.thread/14/steps.md:366` / `:526` / `:661` と `.thread/14/adr.md:67` に、ADP ID の命名規約を **`spec/adr/026` に帰属させる記述**と **「`describe` 名」**の記述が残っている。
  - 場所: `steps.md:366`（ステップ 11 が `spec/inventory/adapter.md` のヘッダーに書けと指示する文言 —「適合スイートのケースは行にせず、`describe` 名に ADP ID を含める命名規約で追う」）／ `steps.md:526`（ステップ 20 の ADR 昇格対応表）／ `steps.md:661`（ステップ 30 —「describe 名 / it 名の `ADP-common-008` は変えない（… 命名規約 — `spec/adr/026`、adr.md ADR-002）」）／ `adr.md:67`（ADR-002 のトレードオフ —「describe 名の命名規約で追う既存方針のまま」）
  - 理由: これは **M-89 / M-88 がこの回で直したのとまったく同じクラス**。R003 は `plan.md:169` / `:219`、`adr.md:589` / `:595`、`steps.md:200` / `:460` の 6 か所を `spec/adr/052` ＋ `it` 名へ直したが、同じ文書内の残り 4 か所が置き去りになっている（過去 3 ラウンドで最も多かった失敗形そのもの）。`steps.md:366` は**ヘッダー文言の生成指示**なので、手順どおり書くと ADR 052 の決定 2（「`describe` はスイート名だけを名乗り、ID は持たない」）に反するヘッダーができる。
  - 実害の限定: **正典側は正しい**。`spec/adr/052-adapter-inventory-granularity.md:24` は「ケース名（`it` の第 1 引数）の先頭に ADP ID を置く。`describe` はスイート名だけを名乗り、ID は持たない」と書き、`spec/inventory/adapter.md:5` のヘッダーも実際には `it` 版で書かれている（実測）。適合スイートの `describe` に ADP ID を持つものは **0 本**（実測）。したがって成果物には波及していない。
  - 提案: 4 か所の文字列置換（`spec/adr/026` → `spec/adr/052`、`describe` 名 → `it` 名）。マージのゲートにはしない。

- **[W-002]** `.thread/14/plan.md` の「テスト方針」にある **AC-55 の件数一致検査が AC-55 本文と食い違う**。
  - 場所: `plan.md:290`（「件数一致検査 — … AC-55 の **8 / 8 / 3**」）と `plan.md:320`（`grep -cE "DOM-common-04[12]|DOM-identity-06[012]|DOM-note-07[12]|DOM-storage-038" spec/inventory/domain.md` → **8**）
  - 理由: AC-55 本文（`:111`）は新規 DOM 行を **11 行**（`DOM-identity-060〜065` を含む）と定めている。検査側の正規表現は `DOM-identity-06[012]` までしか拾わないので、**実行すると 8 を返して「期待どおり」で通る**（false pass）。R1 で `DOM-identity-063`、R2 で `064` / `065` が加わった時に AC 本文だけが更新され、検査行が置き去りになっている。**M-100 が AC-56 について閉じたのと同じクラス**が AC-55 側に残っている形。
  - 実害の限定: 隠している欠陥は無い。AC-55 が「検査は ID 集合の差分で行う」と定めており、そちらを実行すると **DOM 11 / ADP 8 / UC 3・消えた ID 0 件**で正しく通る（下記「実行した検査」参照）。R003 由来ではなく R2 以来の残置。
  - 提案: `:290` の「8 / 8 / 3」を「11 / 8 / 3」へ、`:320` の正規表現を `DOM-identity-06[0-5]` へ。あるいは AC-55 が正としている ID 集合差分の検査へ一本化する。

- **[W-003]** `packages/core/src/adapters/conformance/scopeCleanupAdmissionStore.ts:83` — **本 PR がこの回で追加したインラインコメント**が `// (ADP-common-009/010).` と短縮連記のまま。
  - 場所: ステップ 30 / AC-59 で追加したブロック（`git diff $(git merge-base origin/main HEAD)` で追加行であることを確認）
  - 理由: ADR-035 の決定は「**連記は ID を省略せず全形で書く**。ヘッダーコメントの範囲表記も同じ」で、M-93 が直した 5 ヘッダーと**同じクラスの、本 PR 由来の 6 行目**にあたる。ADR-035 の代替案節は「本 PR がこの回で書き換えたヘッダーコメント 5 行だけを全形にした」と書いており、この 1 行に触れていない。
  - 実害の限定と、直さない側の理由: 参照先ケースの `it` 名（`:94` の `it("ADP-common-009/010: …")`）は **base 由来で本 PR は触っていない**（実測）。コメントだけ全形にすると同一ファイル内で新しい非対称ができ、`:94` まで全形にすると「そのケースに触れた回で全形化する」規則の外へ出るうえ、**ADR-029 / ADR-035 が今回確定させた「到達不能 20 本」が 19 本へ動く**（`ADP-common-010` が単体 grep に当たるようになるため）。据え置きが妥当と判断する。
  - 提案: コードは触らず、`adr.md` の ADR-035 代替案節に半行だけ添える（「本 PR が書いたインライン参照 1 行は、参照先ケースの `it` 名が base 由来の短縮なので据え置いた」）。任意。

## R003 の fix 11 件の突き合わせ

| Key | 期待した修正 | 実物 | 判定 |
| --- | --- | --- | --- |
| M-88 | `steps.md` の実測値を参照へ置き換え（`:5` / `:131` / ステップ 16 見出し・本文 / 17-3 / 17-7 / 17-8） | 6 か所すべて「件数と内訳の正典は AC-63 / AC-55 / AC-64 / AC-23・AC-60 だけで、この文書には写さない」の形へ。17-8 に残る `TC-identity-305` は**起点**であり実測（base 最大 `TC-identity-304`）と一致 | ○（付随の 4 か所が W-001） |
| M-89 | `plan.md:169` / `:219` ＋ `adr.md:589` を `spec/adr/052` ＋ `it` 名へ。件数を実測（31 スイート / 26 本）へ | 3 か所とも反映。`describe には付けない` の明示も追加。**独立再実測: スイート 31 本 / `it` 名に ADP ID を持たない 5 本 / 持つ 26 本** — 記述と一致 | ○ |
| M-90 | 到達不能 ID を 21 → 20 とし列挙から `ADP-identity-034` を落とす（`adr.md:1063` / `:1261` / `:1267`） | 3 か所とも 20 本 ＋ 列挙から `034` を除去。**独立再実測: 短縮連記 31 ケース / 到達不能 20 本、列挙は完全一致** | ○ |
| M-92 | `DOM-note-071/072` に「行が変わったかを返す」を追記 | 追記済み。`ADP-note-055/056` と**一字一句同文**。出所は `spec/domains/note.md` の `Promise<boolean>` | ○ |
| M-93 | 適合スイート 5 ヘッダーの短縮連記を全形へ | `authTokenRepository` / `accountDeletionManifestStore` / `objectStorage` / `scopeCleanupAdmissionStore` / `signInOAuthClient` の 5 行を全形化。**`grep -rn "ADP-identity-034" packages/` が 0 → 1 件** | ○（W-003 は付随） |
| M-96 | `TC-storage-221` の前提条件を実際に用意できる状態へ、DTO の言明を期待結果へ | `spec/testcases/storage/storeUpload.md:36` と `spec/inventory/test.md:1932` が**同文**で更新。3 MB は `source` の上限（画像 50 MB、`spec/domains/storage.md:187`）の内側で矛盾しない | ○ |
| M-97 | `deleteFilesByOwner.test.ts:358` の括弧書き除去 | 除去済み。`TC-storage-043` を名乗る `it` は**この 1 本だけ**（`:252` は M-12 で接頭辞除去済み） | ○ |
| M-98 | 本文由来の 3 組をそろえる（DOM 1 行 ＋ ADP 2 行） | `DOM-storage-033` に「未知の key では null」（出所 `storage.md:293` の `Promise<ObjectBody \| null>`）、`ADP-note-046/047` に「`tombstone` は unspecified」（出所 `note.md:676` のアダプター向け段落）。対の側は既に同主張を持つ | ○ |
| M-100 | AC-56 に `UC-storage-002,003` を追加し 11 行 ＋「実測が正」の但し書き | 反映済み。**独立再実測: 要点欄が改訂された UC 行は 11 行**で、`UC-identity-005,006,007,011,013` / `UC-storage-002,003,004,013` / `UC-usage-005,007` と完全一致 | ○ |
| M-101 | `PAGE-p21-001/002` からユースケース名を落とし、AC-57 の列挙からも外す | 2 行とも `origin/main` と同一へ復帰（ID 集合差分で確認）。AC-57 から `PAGE-p21-001,002` を除去し理由と検査（`grep -c` = 0）を明記。**実測 0 / 0** | ○ |
| M-102 | `start.ts` の CSRF コメントを 3 ヘッダーの順へ | `Sec-Fetch-Site` → `Origin` → `Referer` へ。`spec/presentation/index.md:126` と `routes/settings/-action.tsx:167-169` の 3 者が一致 | ○ |

**反映漏れ 0 / 反映ミス 0 / 新たな矛盾 0。** 「片側だけ直して対になる側が置き去り」の再発は、R003 が直した対（DOM↔ADP、spec↔コード、AC↔台帳）については**発生していない**（M-92 / M-98 / M-101 / M-102 をいずれも対の両側で実測確認）。W-001 / W-003 は R003 が**列挙し損ねた同クラスの残置**であって、直した側が壊れているわけではない。

## wont-fix 4 件の送付先・記録先

| Key | 宣言した送付先・記録先 | 実在確認 |
| --- | --- | --- |
| M-91（`spec/usecases/note.md` の改訂履歴 2 か所） | `plan.md` Phase 5 の **17.(a)** | ○ `plan.md:191-193` に「17. 新規」として実在。`:847` / `:977` を名指しし、R1 の M-47 との同型性まで記載 |
| M-95（`requestPasswordReset \| レート制限` の対応表行） | `plan.md` Phase 5 の **17.(b)** | ○ `plan.md:194` に実在。`パスワード手段なし` 行の直後に足す指示まで具体化 |
| M-94（TC / UC ID の名乗りを規約にしない） | `.thread/14/adr.md` **ADR-037** | ○ `adr.md:1299-` に新設。**記述の裏取りも一致** — 新規 TC 32 行のうちコードから名乗るのは `TC-identity-332`〜`335` の 4 行だけ（実測）、`UC-identity-*` を持つ application ファイルは 20（= `UC-identity-022` の `getProfile.ts` ＋ 既存 19、実測） |
| M-99（DOM↔ADP の残り 5 組） | `.thread/14/adr.md` **ADR-038** | ○ `adr.md:1335-` に新設。切り分けの根拠も実測と一致 — `ObjectStorage.put` の「既存 key は上書きする」は `ADP-storage-018` にあり `spec/domains/storage.md` の `ObjectStorage` 節には無い（実測） |

あわせて Phase 5 の総数（新規 12 → **13** 本）と AC-60 の参照数（12 → **13**）が両方更新されており、`1〜4 / 5〜7 / 12〜17 が新規、8〜11 がコメント` = 4 + 3 + 6 = 13 で内訳が閉じている。**送付先の片側だけ更新、は起きていない。**

## 実行した検査

### 品質ゲート

| 検査 | 結果 |
| --- | --- |
| `pnpm typecheck` | ○ `packages/core` / `apps/web` とも Done |
| `pnpm test:unit` | ○ **76 files / 925 passed / 3 skipped**（基準どおり） |
| `spec/` 全域の相対 `.md` リンク実解決 | ○ **933 本を解決して切れ 0 件** |
| `spec/inventory/` の既存 ID 繰り下げ | ○ 5 ファイルとも**消えた ID 0 件**。増分は domain +11 / adapter +8 / usecase +3 / test +32 / frontend ±0 |
| 本 PR 採番 ADP ID の単体 grep | ○ 8 本すべて 1 件以上。**`ADP-identity-034` が 0 → 1 件**（`signInOAuthClient.ts:41`） |

### 受け入れ基準（`plan.md`「テスト方針」全項目）

| AC | 検査 | 期待 | 実測 |
| --- | --- | --- | --- |
| — | `NOTE_ROUTE_BATCH_TOO_LARGE`（spec/packages/apps） | 0 | 0 ○ |
| — | `ExternalServiceError`（`ports/shareTokenProtector.ts`） | 0 | 0 ○ |
| AC-20/22/25 | 実在しない固有名の `-E` grep（4 ファイル） | 0 | 0 ○ |
| AC-15 | `AC-15`（`start.ts`） | 0 | 0 ○ |
| AC-27 | `IdentityLimitExceeded`（`errorCode.ts`）のコメント部分 | 0 | enum 値定義行のみ（`:14`）○ |
| AC-56 | inventory 5 ファイルの「最終同期」 | 更新 | 5 ファイルとも `2026-08-16` ○ |
| AC-29/61/69 | `ls spec/adr/05[2-7]-*.md` ／ `index.md` の 2 表 | 6 / 6 / 6 | 6 ファイル、一覧 6 行（`:57-62`）、前提依存マップ 6 行（`:114-119`）○ |
| AC-33 | `ExternalServiceError` ＋「通信・応答不正」／ `ExternalApiError` | 0 ／ ≧1 | 0 ／ 1 ○ |
| AC-52 | `InvalidProvider\b`（identity 3 ファイル） | 0 | 0 ○ |
| AC-53 | 「多行 outbox INSERT」（3 ファイル） | 0 | 0 ○ |
| AC-67 | `sha256("removeIdentity` | 0 | 0 ○ |
| AC-47 | 「クエリ予算」（`usecases/storage.md`） | 0 | 0 ○ |
| AC-46/49 | `sha256(parentOperationId` | 0 | 0 ○ |
| AC-65(a) | `ensureAcceptable({ purpose: "source", mimeType, size })` | 0 | 0 ○ |
| AC-65(b) | `declaredMimeType`（`usecases/storage.md`） | **1** | 1 ○（向きの取り違え無し） |
| AC-62 | `createDownloadUrl` / `workspaceCursor` / `next_attempt_at` | ≧1 | 3 / 1 / 2 ○ |
| **AC-55** | ID 集合差分（AC-55 が正とする検査） | DOM 11 / ADP 8 / UC 3・消滅 0 | 一致 ○ ／ **テスト方針の grep 版は 8 / 8 / 3 を返す（W-002）** |
| **AC-57** | `getProfile` / `checkHandleAvailability`（`inventory/frontend.md`） | 0 / 0 | 0 / 0 ○ |
| **AC-60** | Phase 5 の一覧と参照数の 1 対 1 | 13 ＋ コメント 4 | 一覧と一致 ○（起票自体は Phase 5 の作業） |
| **AC-63** | `git diff --name-status $(git merge-base origin/main HEAD) -- packages/ apps/` | 35 = 変更 32 / 削除 3 / 追加 0 | **35 = M 32 / D 3 / A 0** ○。「コード差分の内訳」表と 35 ファイルが 1 対 1（両方向で照合） |
| **AC-63** | 振る舞い行の機械検査 | 14 行（9 + 3 + 2） | **14 行**。内訳も宣言どおり（`ADP-common-008` の追加アサーション 9・`containerStore.ts` の文字列 3・空行 2）○ |
| **AC-64** | `ls spec/testcases/identity/*.md` ／ `grep -c "^| UC-identity-"` ／ `TC-identity-024` の指す先 | 24 / 24 / `completeOAuthSignIn` | 24 / 24 / `completeOAuthSignIn`（`:165`）○ |
| AC-68 | `adr/05[2-7]-` の参照先実在 | 全件実在 | 全件実在 ○（933 本の全リンク解決に包含） |

### 独立再実測（R003 が確定させた数値の裏取り）

- 適合スイートの短縮連記: **31 ケース** / そこから単体 grep で到達できない ID: **20 本**、列挙も ADR-029 / ADR-035 の記述と**完全一致**（自作の走査 — `it()` の第 1 引数から連記を展開し `packages/` 全体の grep と突き合わせ）
- `adapters/conformance/` のスイート: **31 本**、`it` 名に ADP ID を持たないのは **5 本**（`appliedOperationStore` / `distributedOperationStore` / `identityRemovalReceiptStore` / `outboxRepository` / `scopeTaskScheduler`）、持つのは **26 本**
- `describe` 名に ADP ID を持つスイート: **0 本**（ADR 052 の決定どおり）
- `spec/inventory/usecase.md` の要点欄改訂: **11 行**、列挙と完全一致
- `TC-identity-305`〜`335` ＋ `TC-usage-073` = **32 行**、既存 TC ID の消滅 0

## カバレッジ

- 確認（対象 15 ファイル）: `.thread/14/adr.md`, `.thread/14/plan.md`, `.thread/14/steps.md`, `apps/web/app/start.ts`, `packages/core/src/adapters/conformance/accountDeletionManifestStore.ts`, `packages/core/src/adapters/conformance/authTokenRepository.ts`, `packages/core/src/adapters/conformance/objectStorage.ts`, `packages/core/src/adapters/conformance/scopeCleanupAdmissionStore.ts`, `packages/core/src/adapters/conformance/signInOAuthClient.ts`, `packages/core/src/application/storage/__tests__/deleteFilesByOwner.test.ts`, `spec/inventory/adapter.md`, `spec/inventory/domain.md`, `spec/inventory/frontend.md`, `spec/inventory/test.md`, `spec/testcases/storage/storeUpload.md`
- 突き合わせに使った周辺（差分外・参照のみ）: `.thread/14/review/triage.md`, `spec/adr/052-adapter-inventory-granularity.md`, `spec/domains/{storage,note}.md`, `spec/presentation/index.md`, `spec/inventory/usecase.md`, `apps/web/app/routes/settings/-action.tsx`, `packages/core/src/adapters/conformance/{noteProjection,identityUniqueDirectory,storedFileRepository}.ts`
- スキップ: `.thread/14/review/review-003*.md`（6 本）— レビュー中間成果物

## 収束判定

- **fix すべき指摘が残っているか**: **いいえ**
  - Blocker 0 件。Warning 3 件はいずれも (a) `.thread/14/` の作業成果物の内部整合（W-001 / W-003）か、(b) AC 本文が上位の検査を定めているため実害の無い false pass（W-002）で、**正典（`spec/` と `spec/adr/`）にも実装にも波及していない**。3 件とも本 PR の R003 修正が**壊した**ものではなく、R003 のトリアージが**列挙し損ねた同クラスの残置**である。
  - 直すなら合計 6 行前後の文字列置換で済むので、次に `.thread/14/` を触る回にまとめても損失は無い。
- **実装レビューを APPROVED として閉じてよいか**: **はい**
  - R003 の fix 11 件は全件が正しく入っており、数値主張（31 / 26 / 20 / 11 / 32）はすべて独立再実測で一致した。
  - wont-fix 4 件は 2 件が `plan.md` Phase 5 の 17.(a)(b) に、2 件が `adr.md` ADR-037 / ADR-038 に**実在**し、記録の内容も実測と食い違わない。総数（Phase 5 の 13 本 / AC-60 の 13 参照）も両側そろっている。
  - 品質ゲート（typecheck / 76 files・925 passed・3 skipped）、リンク 933 本の実解決 0 件切れ、inventory の繰り下げ 0 件、AC-63 の 35 ファイル / 14 行、AC-64 の 24 / 24 がすべて通る。
  - R1 → R3 で最も多かった「対になる側が置き去り」は、R003 が扱った対については再発していない。
