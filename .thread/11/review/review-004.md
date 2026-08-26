# PR Review #004 — [adapter] Cloudflare D1・Durable Objects・R2 アダプターを追加する

**PR:** #46
**Date:** 2026-08-26
**Round:** 4回目

## Summary

- Blockers: 2（重複を束ねると 1 件）
- Warnings: 14
- Verdict: **BLOCKED**

## レイヤー別ファイル

- UoW / 実行機構・SQL 土台: review-004-uow.md（B: 1 / W: 1）
- Identity / directory / operation（D1 control plane）: review-004-identity.md（B: 0 / W: 1）
- Routing / outbox / scope インフラ: review-004-routing.md（B: 1 / W: 3）
- Scope business / 投影・全文検索 / R2: review-004-scope.md（B: 0 / W: 4）
- 合成・スキーマ・テストハーネス・spec/docs: review-004-composition.md（B: 0 / W: 5）

## カバレッジ

- 確認申告ゼロのファイル: なし（166 ファイルすべてに 1 体以上の「確認」申告あり）

## 指摘一覧

### Blockers

- [B-01] `do/scopeObject.ts:constructor` / `do/alarm.ts:254-263` — **Round 3 で入れた due index republish の再試行 alarm が、object 再構築時の constructor の `rescheduleAlarm` に `deleteAlarm` で消される**（既定＝レジストリ空配備の cold start）。uow / routing の両方が独立に検出し、uow は実機で確認済み。`spec/platform/index.md:201` と `do/dueIndex.ts:38-43` が実装と食い違い、`alarm.test.ts:515` は live インスタンスしか観測していないため塞げていない

### Warnings

**UoW / SQL 土台**
- [W-U01] `do/scopeObject.ts:armAndPublish:publishDueIndex` — 同一 scope への並行 publish が古いスライスで新しいスライスを上書きしうる（routing W-001 と同一）

**Identity / directory**
- [W-I01] `accountDeletionManifestStore.ts:268-283` / `distributedOperationStore.ts:178-195` — `writeHeader` と `beginOrResume` の guard 敗北再読みが production の呼び出し経路から 1 つも到達しない（全呼び出し側が staged session 経由で `session.write` が投げない）。唯一の観測 `globalConcurrency.test.ts` は autocommit session 構成

**Routing / outbox / scope インフラ**
- [W-R01] `do/scopeObject.ts:105-115,156-177` — D1 の `await` で input gate が開くため、同一 scope の並行 commit で古い slice が新しい slice を上書きしうる。publish は成功扱いなので再試行 alarm も張られない（W-U01 と同一）
- [W-R02] `spec/platform/index.md:197` — AC-6 の fencing 決着文「複数 worker プロセスは引き金ではない」が中央 runner 配備で不成立。並走する runner 起動は同じ due index から同じ scope を掴む
- [W-R03] `do/repositories/scopeTaskScheduler.ts:146-159` — `claimDue` 候補読みのコメントがコードの持たない性質を主張。同一 unit の 2 度目の `claimDue` が同じ行を再選択し、memory と振る舞いが割れる

**Scope business / 投影・検索 / R2**
- [W-S01] `projection/snapshotWriter.ts:redactAuthor` + `do/repositories/noteProjection.ts:bump` — OCC guard を持つ 2 経路に割り込みテストが無く、guard を外しても全テストが緑のまま
- [W-S02] `__tests__/deleteFilesByOwner.test.ts:56` — AC-5 テストの冒頭コメントが「実測値は予算文書に属さない」と ADR 056 決定 3 を根拠に主張しており、実測値を載せた `spec/platform/index.md:155`（決定 2）と正反対
- [W-S03] `domain/note/ports/publicNoteProjectionWriter.ts:44:removeForPurge` — ポート JSDoc の「acknowledged under the operation」に対し D1 は 3 引数とも未使用、memory の ack 表は誰も読まない
- [W-S04] `search/highlight.ts:72:mapPositions` — 未認証の公開検索 1 ページで書記素クラスタ単位の NFKC 正規化が最大 16 万回。ASCII 速路で解消可能

**合成・スキーマ・ハーネス・spec/docs**
- [W-C01] `spec/domains/note.md:620` — 投影 writer 2 ポートのエラー契約を JSDoc だけ広げ、spec の「エラーケース」行が `SystemError(DatabaseError)` のまま
- [W-C02] `spec/platform/index.md:197` — `spec/domains/index.md` に存在しない `ScopeTaskScheduler` 節を参照している
- [W-C03] `d1/migrations/0001_global_schema.sql` + `do/schema.ts` — `FOREIGN KEY` を置かない決定が作業ログにしか無く、`spec/database/index.md:14` は物理制約の指示のまま
- [W-C04] `docs/runtime_node.md:5` + `cleanup/{personalCleanup,participants}.ts` — スライス着地後も `#11` を未来形で指す参照が残存
- [W-C05] `spec/inventory/*.md:4` — 行を書き換えたのに「最終同期」日付が未更新
