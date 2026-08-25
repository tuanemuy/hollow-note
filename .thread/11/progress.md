# 残存課題 — Issue #11

実装は完了し、受け入れ基準はすべて満たしている。以下は既知の制限と、後続に引き継ぐ事項。

## 本 Issue のスコープ外として残したもの（plan.md「含まれないもの」の通り）

- **Cloudflare への本番配備一式** — `apps/web/app/server.cloudflare.ts`、`vite.config.cloudflare.ts`、本番 `wrangler.jsonc`、Workers Assets での静的配信、`deploy` script。DI 合成（`application/di/cloudflareRuntime.ts`）までは本 Issue で閉じており、残るのは entry point と配備設定。
- **Queue consumer / Cron ハンドラ** — ワーカー本体はランタイム非依存で既存のものを使うため、Cloudflare 側で要るのは「ハンドラの外枠」だけ。配備一式と一緒に動く。
- **未実装ドメインのアダプター** — Workspace / Tag / Job / Integration は `spec/database/index.md` に表があるがコードにポートが無い。#3〜#10 のスライスがポートを足したとき、その Cloudflare 実装は各スライスの担当。
- **物理 shard**（`note coordination shard` / `user coordination shard` / 32 shard の wave 読み）— 単一 D1（単一 generation）で契約を満たしており、shard 化は容量閾値に触れた時点の別作業。

## 実装上の既知の制限

### `applied_operations` の行が回収されない

`kind = 'command'` / `expires_at IS NULL` として実装した。コマンドの再配送は outbox の attempts で有界だが壁時計では有界でない（quarantine の再駆動、継続の再駆動）ため、expiry を入れると遅れて届いた再配送が二重適用になる。結果としてこれらの行は scope の生存期間ぶん蓄積する。`result` を実際に使うスライスが、そのコマンドの再駆動窓から保持期間を定める（`spec/database/index.md` に記載済み）。

### `assertActorWritable` の membership removal prepare lock が未実装

`spec` の `membership_removal_locks` 表を書くポートが今日存在しない（Workspace ドメインにポートが無い）ため、memory の空 `actorLocks` と同じ観測可能挙動になっている。コード内に理由をコメントで残してある。Workspace スライスが担当。

### `readRows` のオーバーレイは呼び出し側の述語に依存する

`matches` / `compare` が SQL の `WHERE` / `ORDER BY` とずれると、未 commit の自分の書き込みだけが見えなくなる（素の SQL 結果は正しいまま）。ADR-009 のトレードオフとして記録済み。

### `listByOwner` 系は同一 UoW 内の未 commit 書き込みを見ない

notes / stored_files の `listByOwner` は OFFSET ページングのため素通しの `query` を使う。ページを読む呼び出し元はいずれも書く前に読むため実害はない（ADR-009）。

### `_occ_guard` の発火はどの guard かを区別できない

同時実行に負けた側は一律 `OPTIMISTIC_LOCK_FAILURE` になる（ADR-008 のトレードオフ）。固有のコンフリクト符号が要る箇所は、ステージ時に読んだ値で先に判定して投げている（ADR-013）。

### `deleteFilesByOwner` は 3 文で書けない

実測は `4n + 3` 文（commit 自体は件数によらず 1 回）。契約側の理由（一括削除メソッドが無い、OCC の版トークンは `findById` でしか採れない、`listByOwner` が `PaginationResult` を返す）による。`spec/platform/index.md` の実行予算行を実測値へ改めた（ADR-025 / AC-5）。

### 公開検索のページングは関連度順ではない

`note_id` キーセットで行う。bm25 ランクのカーソルにしていない理由は ADR-023。plan.md がスコープ外と明記した項目。

## 後続に引き継ぐ観測

- **`spec/inventory/adapter.md` に ADP 行が無いポートがある** — `ScopeTaskScheduler` / `ScopeTaskQueue` / `OutboxRepository` / `DistributedOperationStore` / `AppliedOperationStore`。2026-08-25 の生成時点からの既存の穴で、本 Issue が作ったものではない。spec-sync の対象。
- **`MemoryRuntime` の `AppRuntime` 適合はテスト 1 ケースだけで固定されている** — 型注釈は `memoryRuntime.ts` に置くのが自然だが、AC-7（既存 Node ランタイムを触らない）のため見送った。
- **`cloudflareRuntime.ts` は 2 つの tsconfig にまたがる例外として列挙されている** — 同種のファイルを 2 つ目に足すときは両方の編集が要る（ADR-030）。
- **`conformanceCoverage.test.ts` の判定はテキスト走査で行頭の呼び出しだけを数える** — 入口ファイルが平坦な呼び出しの並びである限り成立するが、ループや関数で包むと検知できない（ADR-031）。
- **`d1/repositories/globalMaintenanceRunStore.ts` は keyset cursor の区切りに NUL バイトを直接埋め込んでいる** — 実装として正しく自己整合しているが、`rg` などがこのファイルをバイナリ扱いする。
- **workers プロジェクトの実行時に `uncaught exception` のログが 2 種類出る** — harness の scope 不一致ケースと durability の CHECK 違反ケース。いずれも RPC 越しの拒否を workerd が再報告しているだけで、テストは緑。
