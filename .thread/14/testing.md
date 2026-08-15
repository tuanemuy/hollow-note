# 動作確認計画 — Issue #14: spec と実装の乖離を同期する（skeleton スライスで蓄積した分）

**Issue:** #14
**作成日:** 2026-08-15

---

## 確認環境

この Issue の変更を確認するために必要な手順のみ記載（依存パッケージのインストール等、プロジェクト全体のセットアップは省略）。

本 Issue の成果物は **`spec/` / `docs/` / `CLAUDE.md` / `README.md` のドキュメント同期**が主体で、コード差分は **8 ファイル**（ポート JSDoc 4・`errorCode.ts` のコメント 2・`start.ts` のコメント 1・適合スイート 1）に限られ、**振る舞いを変える差分は 0**（AC-63 / adr.md ADR-012）。したがって確認はリポジトリルートで実行するコマンドと、`spec/` 内の ID・リンク整合の検査で完結する。

### 検証環境の起動

**専用の検証サーバーは不要。** 画面挙動を変えないため（下記「画面操作の確認項目について」）、起動はコマンド 11（回帰スモーク）でのみ行う。実行はすべて**リポジトリルート**から。

| 用途 | コマンド | 出典（実ファイルで確認） |
| --- | --- | --- |
| 型検査 | `pnpm typecheck` | root `package.json` の `scripts.typecheck`（`tsgo && pnpm -r typecheck`）/ `CLAUDE.md`「Development Commands」/ `README.md`「Development commands」 |
| Lint | `pnpm lint` | root `package.json` の `scripts.lint`（`biome lint`）/ `README.md` |
| Lint（自動修正） | `pnpm lint:fix` | root `package.json` の `scripts.lint:fix`（`biome check --write`）/ `CLAUDE.md` |
| 整形チェック | `pnpm format:check` | root `package.json` の `scripts.format:check`（`biome format`）/ `README.md` |
| 整形（書き込み） | `pnpm format` | root `package.json` の `scripts.format`（`biome format --write`）/ `CLAUDE.md` |
| 単体テスト | `pnpm test:unit` | root `package.json` の `scripts.test:unit`（`vitest run`）。`test` は同じものへの別名。設定は root `vitest.config.ts`（`spec/**` を除外、`TZ=Asia/Tokyo`、`testTimeout: 10_000`） |
| 本番ビルド | `pnpm build` | root `package.json` の `scripts.build` → `@repo/web` の `build:node`（`vite build --config vite.config.node.ts`） |
| 本番起動 | `pnpm start` | root `package.json` の `scripts.start` → `@repo/web` の `start:node`（`tsx scripts/listen.node.ts`）。待ち受け URL は起動ログの `[listen.node] listening on http://...` 行 |

補足（すべて実ファイルで確認済み）:

- **DB マイグレーションもシードも不要。** 永続化は in-memory アダプターのみで、root / `apps/web` / `packages/core` のいずれの `package.json` にも `db:generate` / `db:migrate` は存在しない（`README.md` の「Database migrations」節がそれらを載せているのは本 Issue のステップ 19 が直す乖離そのもの — AC-25）。
- **`:cf` / `:aws` / `:gcp` のスクリプトは存在しない。** root `package.json` の scripts は `dev` / `dev:node` / `build` / `build:node` / `start` / `start:node` / `typecheck` / `lint` / `lint:fix` / `format` / `format:check` / `test` / `test:unit` の 13 個のみ（`README.md` / `CLAUDE.md` の記述が古い側で、ステップ 13 / 19 の対象）。
- **Makefile / Taskfile / justfile はリポジトリルートに存在しない**（`ls` で確認）。タスクランナーは pnpm scripts のみ。
- **CI と同じ検査が使える。** `.github/workflows/ci.yml` は `pnpm lint` → `pnpm format:check` → `pnpm typecheck` → `pnpm test:unit`（`lint-typecheck-unit` ジョブ）と `pnpm build:node`（`build` ジョブ）を回す。本計画の確認項目 1 はこれと同じ集合なので、ローカルで通れば CI も通る。
- **実行前の基準値（本計画の作成時に実測）**: `pnpm typecheck` = 緑 / `pnpm lint` = 緑（infos 2 件） / `pnpm format:check` = 緑（443 ファイル） / `pnpm test:unit` = **76 ファイル・925 passed・3 skipped** / `pnpm build` = 緑。**この 5 つは Issue 完了後も同じ結果**でなければならない（テスト件数は適合スイートの既存 `it` に主張を 1 つ足すだけなので **925 のまま**。`it` 名も変えない — ステップ 30）。

### デプロイ方法

なし（Node ランタイム一本でローカル実行のみ。`infra/` ディレクトリは存在せず、本 Issue はデプロイ成果物を持たない）。

### 画面操作の確認項目について

**画面操作（ブラウザー）の確認項目は 0 件。** 後続フェーズのブラウザー検証はスキップしてよい。根拠は次の 4 点で、いずれも確認項目 2 と 11 で機械的に検証する。

1. **`apps/web/` 配下の差分は `apps/web/app/start.ts` の 1 ファイルだけで、しかもコメント 1 行**（`AC-15` という `.thread/1/plan.md` 由来の dangling 参照を `spec/presentation/index.md` への参照に差し替える — ステップ 8-5）。ルート・コンポーネント・server function・スタイル・vite / router 設定は 1 ファイルも触らない。
2. **残る 6 つのコード差分は `packages/core` のポート JSDoc とエラーコードの冒頭コメント**で、実行されるコードではない（ステップ 8-1〜8-4 / 8-6 / 8-7）。
3. **8 つ目の差分は `packages/core/src/adapters/conformance/` の適合スイート**で、テストコードのみ。追加するのは既存 `ADP-common-008` ケースへの主張 1 つで、memory 実装は既にその振る舞いを持つため実装変更は発生しない（AC-59 / adr.md ADR-012）。
4. **AC-63 が「振る舞いを変える差分は 0」を受け入れ基準として明示**しており、plan.md「テスト方針」も「マニュアルテストの実行は不要（UI の挙動を変えない）」と書いている。`spec/manual-tests/account.md` への変更（TC-42 追加・TC-26 / TC-13 の是正 — AC-30 / AC-54）は**手順書というドキュメントの修正**であって、アプリの挙動の変更ではない。

## 確認項目

上から順に実行する。確認項目 3〜9 はすべてリポジトリルートで実行する読み取り専用のコマンドなので、順序を入れ替えても構わない。

### 1. 品質ゲート（コード差分がビルド・型・Lint・テストを壊していない）

- **対応する受け入れ基準:** AC-24、AC-59、AC-63
- **目的:** JSDoc・コメントの書き換えと適合スイートへの 1 主張追加が、型検査・Lint・整形・単体テスト・本番ビルドのいずれも壊していないことを確認する
- **手順:**
  1. リポジトリルートで `pnpm typecheck`
  2. `pnpm lint`
  3. `pnpm format:check`
  4. `pnpm test:unit`
  5. `pnpm build`
- **期待結果:** 5 つすべてが成功で終了する。`pnpm test:unit` は **76 ファイル・925 passed・3 skipped**（作成時の実測値と同じ）。
- **確認ポイント:** テスト件数が **926 以上に増えていたらスコープ逸脱**（ステップ 30 が許すのは既存 `it` への主張追加だけで、新しい `it` を足さない — AC-59 / adr.md ADR-012）。逆に **赤になった場合は実装変更で直さない** — memory アダプターが `completed` した barrier への `assertOwner` を既に弾く前提が崩れているので、ステップを止めて判断し直す（ステップ 30 の注意）。整形差分が出たら `pnpm format` を実行してから再確認する。

### 2. コード差分が 8 ファイルに限られている

- **対応する受け入れ基準:** AC-63、AC-24（上書きされる側）
- **目的:** ドキュメント同期のはずの Issue が、意図しない実装変更を持ち込んでいないことを確認する
- **手順:**
  1. `git diff --stat` を実行し、`packages/` と `apps/` 配下の差分ファイルを数える
  2. `git diff --name-only -- packages/ apps/` で内訳を確認する
  3. `git diff -- apps/web/` を目視する
- **期待結果:** `packages/` と `apps/` の差分がちょうど **8 ファイル** —
  `packages/core/src/application/ports/shareTokenProtector.ts` /
  `packages/core/src/domain/identity/ports/identityRepository.ts` /
  `packages/core/src/application/ports/accountDeletionManifestStore.ts` /
  `packages/core/src/application/ports/scopeCleanupAdmissionStore.ts` /
  `packages/core/src/domain/identity/errorCode.ts` /
  `packages/core/src/domain/storage/errorCode.ts` /
  `apps/web/app/start.ts` /
  `packages/core/src/adapters/conformance/scopeCleanupAdmissionStore.ts`
- **確認ポイント:** **`apps/web/` の差分は `start.ts` のコメント 1 行だけ**であること（これが「画面操作の確認が要らない」判定の根拠。ここに他のファイルが出たら判定をやり直す）。`errorCode.ts` 2 本の差分は**コメント行の削除のみ**で、enum の値定義行は 1 行も動いていないこと（AC-27 / AC-58(b)(c)）。

### 3. 「直すべき記述が残っていない」検査（ヒット 0 件が合否）

- **対応する受け入れ基準:** AC-5、AC-16、AC-18、AC-33、AC-46、AC-47、AC-49、AC-52、AC-53、AC-65(a)、AC-67
- **目的:** 台帳の各項目が spec / コードから確かに消えていることを機械的に確かめる
- **手順:** リポジトリルートで次を順に実行する（丸括弧内は plan.md 作成時の実測 = 修正前の値）。
  1. `grep -rn "NOTE_ROUTE_BATCH_TOO_LARGE" spec/ packages/ apps/`（0 → 0。存在しないコード名を新設しない側の検査）
  2. `grep -c "ExternalServiceError" packages/core/src/application/ports/shareTokenProtector.ts`（1 → 0）
  3. `grep -c "AC-15" apps/web/app/start.ts`（1 → 0）
  4. `grep -rniE "serverCloudflare|serverAws|serverGcp|infra/aws|infra/cloudflare|infra/gcp|components/todo|routes/todo|TodoBoard|TodoList|TodoItem|TodoShell|TodoRepository|inputValidator|libSQL|Turso|drizzle|migrate\.(cf|aws|gcp|node)|runtime_(cloudflare|aws|gcp)" CLAUDE.md README.md docs/frontend_implementation_example.md docs/backend_implementation_example.md | wc -l`（57 → 0。内訳は CLAUDE.md 14 / README.md 10 / backend 5 / frontend 28）
  5. `grep -inc "todo" docs/frontend_implementation_example.md`（67 → 0）
  6. `grep -n "ExternalServiceError" spec/domains/identity.md | grep -c "通信・応答不正"`（1 → 0）
  7. `grep -rn "InvalidProvider\b" spec/usecases/identity.md spec/testcases/identity/startOAuthFlow.md spec/inventory/test.md | grep -v InvalidProviderAccount | grep -v "TC-integration-" | wc -l`（3 → 0）
  8. `grep -rn "多行 outbox INSERT" spec/testcases/storage/deleteFilesByOwner.md spec/usecases/storage.md spec/inventory/test.md | wc -l`（3 → 0）
  9. `grep -rn 'sha256("removeIdentity' spec/ | wc -l`（1 → 0）
  10. `grep -c "クエリ予算" spec/usecases/storage.md`（1 → 0）
  11. `grep -rn "sha256(parentOperationId" spec/ | wc -l`（2 → 0）
  12. `grep -cF 'ensureAcceptable({ purpose: "source", mimeType, size })' spec/usecases/storage.md`（1 → 0）
- **期待結果:** 12 本すべてが **0** を返す。
- **確認ポイント:** **6 番はファイル全体を見ない形になっていること。** `spec/domains/identity.md` の `ExternalServiceError` は全部で 3 件あり、本 Issue が直すのは `SignInOAuthClient`（通信・応答不正）の 1 行だけ。`PasswordHasher` と `SecureTokenGenerator` の 2 件は SYNC-27 としてステップ 16-4 の Issue へ送るスコープ外なので、ファイル全体の 0 件検査にすると全ステップを正しく終えても必ず落ちる（計画レビュー R3 coverage:P-001）。**8 番は対象 3 ファイルに限定すること**（ステップ 29 が `spec/platform/index.md` に同じ語を意図的に足すため、`spec/` 全域で引くと落ちる）。**7 番の `grep -v "TC-integration-"` を外さないこと**（integration 側 3 か所は本 Issue では触らない）。

### 4. 「件数が一致する」検査

- **対応する受け入れ基準:** AC-29、AC-55、AC-61、AC-64、AC-65(b)、AC-69
- **目的:** 新規採番・新設ファイルの件数が計画どおりであること、宣言値の削除が過不足なく効いていることを確かめる
- **手順:**
  1. `grep -cE "DOM-common-04[12]|DOM-identity-06[012]|DOM-note-07[12]|DOM-storage-038" spec/inventory/domain.md` → **8**
  2. `grep -cE "ADP-common-04[01]|ADP-identity-0(39|4[01])|ADP-note-05[56]|ADP-storage-024" spec/inventory/adapter.md` → **8**
  3. `grep -cE "UC-identity-02[234]" spec/inventory/usecase.md` → **3**
  4. `ls spec/testcases/identity/*.md | wc -l` → **24**（現状 21）
  5. `grep -c "^| UC-identity-" spec/inventory/usecase.md` → **24**（現状 21）
  6. `ls spec/adr/05[2-7]-*.md | wc -l` → **6**（現状 0）
  7. `grep -c "declaredMimeType" spec/usecases/storage.md` → **1**（現状 4）
- **期待結果:** 上記の 7 つがそれぞれ 8 / 8 / 3 / 24 / 24 / 6 / 1 を返す。
- **確認ポイント:** **1〜3 は 3 本とも `grep -cE`（ERE）であること。** BRE のまま `(39|4[01])` を書くと `ADP-identity-039`〜`041` を永久に検出できず、8 行すべてを正しく採番しても 5 しか返らない（R2 で実測済み）。**7 番は 0 ではなく 1 が正解。** 残る 1 件は `startBulkUpload` の `files` 列で、このユースケースはバイト列を持たないため `spec/adr/050` の前提（受理判定の時点で実体を握っていること）が成立せず、宣言値は受理判定の入力ではなく合計サイズ検査と暫定判定のヒントとして残る（計画レビュー R3 arch:P-001）。**あわせて `size` の書き分けも目視する** — `storeUpload` / `storeMedia` / `storeAvatar` の入力 DTO からは `size` も消え、`startBulkUpload` の `files[].size` は残っていること（AC-65(b2)）。

### 5. 「spec を狭めていない」検査（ヒット 1 件以上が合否）

- **対応する受け入れ基準:** AC-62、AC-66
- **目的:** スコープ外に置いた 4 件（SYNC-203(3) / 214 / 231 / 237）について、実装の縮退を spec へ書き写していないことを確かめる
- **手順:**
  1. `grep -c "createDownloadUrl" spec/domains/storage.md`（現状 2）
  2. `grep -c "workspaceCursor" spec/usecases/usage.md`（現状 1）
  3. `grep -c "next_attempt_at" spec/database/index.md`（現状 2）
  4. `grep -c "AppliedOperationStore" spec/domains/index.md`（現状 0 → **1 以上**）
  5. `spec/pages/index.md` の P-25 に「削除されるもの / されないもの」の機能行が残っていることを目視する
- **期待結果:** 1〜4 がいずれも **1 以上**、5 の記述が残っている。
- **確認ポイント:** **確認項目 3 と合否の向きが逆。** ここで 0 が返るのは「スコープ外の記述を消してしまった」という失敗であって成功ではない（plan.md「テスト方針」が「取り違えないこと」と明記している）。4 番だけは向きが逆に見えるが同じ側 — `AppliedOperationStore` は本 Issue で **1 行言及を足す**ことで「`spec/database/index.md` だけが定義の無いポート名を参照する」状態を消す（interface は新設しない — adr.md ADR-015 / AC-66）。

### 6. spec ドキュメント間のリンクとアンカーが実在する

- **対応する受け入れ基準:** AC-29、AC-47、AC-61、AC-68、AC-69
- **目的:** 新設した 6 本の ADR への番号入りリンクと、修正したセクションリンクが実在するファイル・見出しを指すことを確かめる
- **手順:**
  1. `grep -rn "adr/05[2-7]-" spec/` の出力を取り、各リンクのファイル名が `ls spec/adr/05[2-7]-*.md` の 6 ファイルに含まれることを突き合わせる（現状はどちらも 0 件）
  2. `spec/adr/index.md` の **`## 一覧`** 表と **`## 前提依存マップ`** の**両方**に 052〜057 の 6 行が入っていることを目視する
  3. `grep -n "platform/index.md" spec/usecases/storage.md` の出力が指すアンカーが `spec/platform/index.md` に実在する見出し（`### Scope DO`）であることを確かめる
  4. 056 のリンク元 3 か所（`spec/usecases/storage.md` の `batchSize` 段落 / `spec/testcases/storage/deleteFilesByOwner.md` / `spec/platform/index.md` の `### Scope DO`）と 057 のリンク元 1 か所（`spec/manual-tests/account.md` の TC-42）を目視する
- **期待結果:** リンク切れが 0。`spec/adr/index.md` の 2 表がともに 6 行増えている。
- **確認ポイント:** **「ファイルが 6 つある」「index に 6 行ある」だけでは足りない**（AC-68）。ADR の採番が先に消費されていて番号がずれた場合、本文リンクだけが取り残されるが、ファイル数と行数の検査は両方通ってしまう。**`spec/usecases/storage.md:492` の `#クエリ予算` は現状すでにリンク切れ**（その見出しは `spec/platform/index.md` に存在しない）なので、同種のリンク切れを新たに作らないこと。

### 7. inventory の既存 ID が 1 つも別の要素を指していない

- **対応する受け入れ基準:** AC-55、AC-57、AC-64
- **目的:** 新規行の採番が「群の末尾に追加」で行われ、既存 ID の繰り下げが起きていないことを確かめる（`spec/` 本文と `.thread/` から参照されている ID が別物を指すのを防ぐ）
- **手順:**
  1. `git diff spec/inventory/` を表示し、**ID 列に差分が出ている行が無い**ことを目視する（要点欄・最終同期日付・末尾の新規行だけが差分であるべき）
  2. `grep -n "^| TC-identity-024 " spec/inventory/test.md` が `completeOAuthSignIn` の 1 件目を指したままであることを確かめる
  3. `grep -oE "TC-identity-[0-9]+" spec/inventory/test.md | sort -u | tail -1` で最大 TC ID を取り、新規 TC 行が **`TC-identity-305` 以降**に採番されていることを確かめる
  4. `spec/inventory/test.md` のヘッダーに TC 採番規則の 1 行（「新規テストケースは各群の末尾に採番し、ファイル名の辞書順の位置に挿入しない。ID は行位置ではない」）が入っていることを目視する
- **期待結果:** ID 列の差分が 0。`TC-identity-024` は `completeOAuthSignIn`、`TC-identity-304` は `verifyEmail` の並行消費のまま。新規行は 305 以降。
- **確認ポイント:** **採番起点に穴を作らないこと。** 計画作成時の実測で `spec/inventory/test.md` の identity 群は **最大 `TC-identity-304`・行数も 304**（001〜304 が連番で埋まっている）なので 305 起点は正しい。採番前に手順 3 のコマンドで**最大値を必ず取り直す**こと（先に消費されていたらその次から）。**採番対象は新設 3 ファイルの行だけでなく、`requestPasswordReset.md` に足す発行間隔の境界 2 行も含む**（既存ブロック `TC-identity-187`〜`193` の中へ挿入しない — 計画レビュー R3 coverage:S-002 / adr.md ADR-016 の決定 4）。

### 8. inventory 5 ファイルの「最終同期」日付が更新されている

- **対応する受け入れ基準:** AC-19a（AC-56 が上書き）、AC-56
- **目的:** 本文からの生成物である inventory が、今回の本文改訂に追随したことを記録として残す
- **手順:**
  1. `grep -n "最終同期" spec/inventory/domain.md spec/inventory/adapter.md spec/inventory/test.md spec/inventory/frontend.md spec/inventory/usecase.md`
- **期待結果:** **5 ファイルすべて**の日付が本 Issue の作業日に更新されている（現状はいずれも `2026-08-09`）。
- **確認ポイント:** **`usecase.md` を落とさないこと。** SYNC-01〜27 の範囲では 4 ファイルだったが、Issue #2 由来の統合で `spec/inventory/usecase.md` が対象に入り 5 ファイルになっている（AC-56 が AC-19a の「4 ファイル」を上書きする）。

### 9. `errorCode.ts` のコメントが「spec の記載漏れ」を語っていない

- **対応する受け入れ基準:** AC-27、AC-58(b)(c)
- **目的:** spec の union にコードを足したことで事実に反するようになった冒頭コメントが、確かに消えていることを確かめる
- **手順:**
  1. `grep -n "IdentityLimitExceeded" packages/core/src/domain/identity/errorCode.ts`
  2. `grep -n "InvalidChecksum" packages/core/src/domain/storage/errorCode.ts`
  3. 2 ファイルの冒頭を目視する
- **期待結果:** どちらも **enum の値定義行だけ**がヒットし、`// ... is missing from the enum in spec/...` の形のコメント行が 1 行も残っていない（現状は `identity/errorCode.ts:1` にコメントがある）。
- **確認ポイント:** **これは grep の件数では判定できない**（値定義行が正当にヒットするため、0 件検査にも 1 件検査にもできない）。ヒット行が**コメントかコードか**を人が読んで判定する 4 つの確認のうちの 1 つ（plan.md「テスト方針」の前置き）。`identity` 側は `IdentityLimitExceeded` / `InvalidAvatarUrl` / `AccountDeletionRetryLimitExceeded` の 3 つとも spec の union に入るので **冒頭コメントは全文削除**になる（AC-58(b) が AC-27 の後半を上書き）。

### 10. `AGENTS.md` のシンボリックリンクが壊れていない

- **対応する受け入れ基準:** AC-20（ステップ 13 / 17-5）
- **目的:** `CLAUDE.md` の全面改訂で、実体ではなくリンク側を書き換えてしまう事故を検出する
- **手順:**
  1. `ls -l AGENTS.md`
  2. `head -3 AGENTS.md`
- **期待結果:** `AGENTS.md -> CLAUDE.md` のシンボリックリンクのままで、`head` が改訂後の `CLAUDE.md` の内容を返す。
- **確認ポイント:** リンクが通常ファイルに置き換わっていると、以後 `CLAUDE.md` の更新が `AGENTS.md` に反映されなくなる（plan.md リスク節）。

### 11. 回帰スモーク（本番ビルドが起動し、既存画面が従来どおり動く）

- **対応する受け入れ基準:** AC-24、AC-63
- **目的:** 「画面挙動を変えない」という本 Issue の前提が実際に成り立っていることを、起動 1 回で裏づける
- **手順:**
  1. `pnpm build`
  2. `pnpm start`
  3. 起動ログの `[listen.node] listening on http://...` 行の URL を開く
  4. トップページが表示されること、サインイン画面（`/signin`）へ遷移できることを確認して停止する
- **期待結果:** ビルドが成功し、サーバーが起動し、トップとサインイン画面が従来どおり描画される。
- **確認ポイント:** **これは新機能の確認ではなく、コード差分がコメントだけであることの裏づけ。** ここで挙動が変わっていたら確認項目 2 の差分内訳を疑う（`apps/web/` に `start.ts` 以外の差分が入っている可能性）。永続化は in-memory なので、プロセスを止めたデータは消える（仕様どおり）。

## エッジケース・異常系

### 1. 検査コマンドの合否の向きを取り違える

確認項目 3（0 件）/ 4（件数一致）/ 5（1 件以上）は**合否の形が 3 種類ある**。とくに危ないのは次の 3 つ。

- **AC-62 の 3 本は「1 件以上」が合格。** 0 件はスコープ外の記述を消してしまった失敗。
- **AC-65(b) の `declaredMimeType` は「1」が合格。** 0 件は `startBulkUpload` の宣言値まで落とした失敗（同ファイルの手順 1・手順 5・出力 DTO の説明段落が根拠を失う）。
- **AC-33 はファイル全体ではなく `SignInOAuthClient` の行だけを見る。** スコープ外の 2 件（`PasswordHasher` / `SecureTokenGenerator`）が必ず残るため、全体の 0 件検査は構造的に合格できない。

### 2. BRE と ERE を混ぜた grep が常に合格する / 常に落ちる

確認項目 4 の 1〜3 は `-E` 必須。`\|` を BRE でない文脈に渡す、あるいは ERE のグループを BRE に渡すと、**改訂前でも 0 件（常に合格）**または**永久に検出できない**状態になる。R1 で AC-20 の grep が、R2 で ADP 採番の grep が、それぞれこの形で壊れていた。検査を書き換えたら**実ファイルまたは合成ファイルで一度実行して期待件数が出ることを確かめる**こと。

### 3. `spec/adr/` の採番が先に消費されている

`ls spec/adr/` の最大採番は計画時点で **051**（`index.md` を除く 46 本。欠番 015 / 016 / 018 / 019 / 020 は永久欠番で再利用しない）。並行する作業が 052 以降を先に取っていたら、**6 本のブロックごと後ろへずらす**。ステップ 20 は A フェーズより前（実行順フェーズ F0）に置いてあるので、この判明は本文リンクを書く前に起きる。ずらした場合は確認項目 6 の `grep -rn "adr/05[2-7]-" spec/` のパターンも合わせて直すこと。

### 4. 新設 3 ファイルを辞書順の位置に挿入してしまう

`spec/testcases/*/*.md` の表に TC ID は 1 つも書かれておらず、**TC ID は `spec/inventory/test.md` の行位置だけで決まる**。`checkHandleAvailability.md` / `completeOAuthCallback.md` / `getProfile.md` を辞書順に挿入すると `TC-identity-024` 以降 280 行超が別の要素を指す。確認項目 7 の手順 1（`git diff spec/inventory/` の ID 列に差分が無い）がこれを検出する。

### 5. 同じ規則を破って `requestPasswordReset.md` の 2 行だけ既存ブロックへ挿入する

新設ファイルの側だけ末尾採番して、既存ファイルへの追加行を `TC-identity-187`〜`193` の中に入れると、そこから下の identity 群がすべて繰り下がる。確認項目 7 の手順 1 で同じく検出できる。`spec/adr/052` の本文にも「既存ファイルに行を足す場合も同じ」を書くこと（ADR-016 の決定 4）。

### 6. `README.md` と `CLAUDE.md` が別の現況を語る

ステップ 13 と 19 は**同じ事実**を書く。確認項目 3 の 4 番は 2 ファイルを同時に見るので片方だけ直すと落ちるが、「書いてある内容が食い違う」ことまでは検出できない。改訂後に 2 ファイルの「ランタイム」「ワークスペース」「テスト」の記述を並べて読むこと。とくに `README.md` は実在しない `pnpm db:generate` / `pnpm db:migrate` を「Quick Start」に載せているので、**手順として残さない**（root / `apps/web` / `packages/core` のどの `package.json` にも存在しない）。

### 7. フォローアップ起票の参照が完了コメントに揃わない

AC-23 / AC-60 は **新規 Issue 7 本と既存 Issue へのコメント 4 件**、合わせて 11 個の参照を本 Issue の完了コメントに列挙することを求める。起票そのものは確認項目に含めないが、完了前に `.thread/14/plan.md`「Phase 5 で起票するもの」の 11 項目と 1 対 1 で照合すること。

## 既存機能への影響確認

- **単体テストと適合スイート**: `pnpm test:unit` が **76 ファイル・925 passed・3 skipped** のまま緑であること（確認項目 1）。適合スイートは memory バックエンドに対して unit 速度で走るので、ポート契約の回帰はここで検出される。件数が増えていたらスコープ逸脱、赤になったら前提の崩れ（実装を変えずに止めて判断し直す）。
- **型検査**: `pnpm typecheck` が緑であること。JSDoc の書き換えは型に影響しないはずだが、TSDoc タグの壊れやコードブロックの閉じ忘れは `tsgo` が拾う。
- **Lint / 整形**: `pnpm lint` と `pnpm format:check` が緑であること。Biome は Markdown を対象にしないので、`spec/` の変更で落ちることはない（落ちたらコード側に意図しない差分がある合図）。
- **本番ビルドと起動**: `pnpm build` → `pnpm start` が通り、トップとサインイン画面が従来どおり描画されること（確認項目 11）。
- **CI との等価性**: `.github/workflows/ci.yml` は `pnpm lint` / `pnpm format:check` / `pnpm typecheck` / `pnpm test:unit` / `pnpm build:node` を回す。確認項目 1 と 11 はこの集合を含むので、ローカルで通れば CI も通る。
- **`spec/` の読み手への影響**: 本 Issue は `spec/inventory/` の既存 ID を 1 つも動かさない（確認項目 7）。動かすと `spec/` 本文・他 Issue の計画・レビュー記録からの参照がすべて別の要素を指すことになるため、ここが最大の後方互換性の境界になる。
