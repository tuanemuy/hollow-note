# PR Review #005 — [adapter] Cloudflare D1・Durable Objects・R2 アダプターを追加する

**PR:** #46
**Date:** 2026-08-26
**Round:** 5回目

## Summary

- Blockers: 0
- Warnings: 22
- Verdict: **APPROVED**（Blocker ゼロ）。ただし完了判定は台帳の `fix` ゼロなので、Warning を仕分けて処理する

## レイヤー別ファイル

- UoW / 実行機構・SQL 土台: review-005-uow.md（B: 0 / W: 4）
- Identity / directory / operation（D1 control plane）: review-005-identity.md（B: 0 / W: 4）
- Routing / outbox / scope インフラ: review-005-routing.md（B: 0 / W: 5）
- Scope business / 投影・全文検索 / R2: review-005-scope.md（B: 0 / W: 3）
- 合成・スキーマ・テストハーネス・spec/docs: review-005-composition.md（B: 0 / W: 6）

## カバレッジ

- 確認申告ゼロのファイル: なし（175 ファイルすべてに 1 体以上の「確認」申告あり）

## 受け入れ基準の実測（composition が確認）

- AC-7: 非改変差分は空（`adapters/memory` / `apps/web`）
- AC-2 / AC-3: `test:workers` 22 ファイル / 356 passed（実バインディング）
- `test:node` 77 ファイル / 983 passed
- `grep -rn "\.thread" packages apps spec docs README.md` は 0 件
- migration は `0001` 1 本のみ。物理スキーマは改訂後の `spec/database/index.md` と列・CHECK・索引まで 1 対 1、`FOREIGN KEY` は 0 件

## 指摘一覧

### Blockers

なし

### Warnings

**UoW / SQL 土台**
- [W-U01] `do/scopeObject.ts:armAndPublishNow` — republish 再試行 alarm を、それが守る publish の**前に**無条件で削除している（delete と publish の間で落ちると scope が `listDue` から永久に消える）／composition W-004 と同根
- [W-U02] `sql/session.ts:readRows` / `execution/writeSet.ts:RowMutation` — ステージした行イメージが読み文の射影と一致しないとき、集合読みが黙って行を落とし順序を壊す（`readRow` と違い失敗が観測できない）
- [W-U03] `do/scopeObject.ts:armAndPublish` — 直列鎖が publish を合流させず、同一 scope の継続 arming が D1 往復 1 本ずつに serialize する（slice は全置換なので冗長）／routing W-005 と同一
- [W-U04] `do/repositories/scopeTaskScheduler.ts:publishDueIndex` / `do/scopeStub.ts:apply` — autocommit 経路は due index を publish するが alarm を張らないため、object 駆動配備では継続が誰にも起こされない（今日は production 呼び出し元なしの潜在）／routing W-002 と同根

**Identity / directory**
- [W-I01] `identitySupport.ts:84` / `accountDeletionManifestStore.ts:336,767` / `globalMaintenanceRunStore.ts:747` — cursor の null ガードを `OR` で書いたため keyset がレンジ述語にならず、ページングが二次オーダーになる
- [W-I02] `spec/database/index.md:309,325,341,354,697` — 期限索引を「keyset で回収する」と書いているが、ポート契約は表キー順でページングするので索引は順序を与えられない（AC-9）
- [W-I03] `identitySupport.ts:103,149` — 有界削除が選択述語を DELETE へ持ち越さず（TOCTOU）、かつ 1 行 1 文で発行している（`json_each` 1 文の共通規約に反する）
- [W-I04] `__tests__/globalConcurrency.test.ts:116-128` — `beforeEach` が `GLOBAL_WIPE_STATEMENTS` を使わず手書きの 6 表に限っており `account_deletion_manifest_items` が漏れている

**Routing / outbox / scope インフラ**
- [W-R01] `spec/database/index.md:1110` — autocommit publish 経路の利用者を「中央 runner の claim / settle」と書いているが、runner は staged 経路を通る（実装コメントとも矛盾）
- [W-R02] `do/repositories/scopeTaskScheduler.ts:101-124` — autocommit の due index publish だけ直列化の外にあり、非対称ドリフトを再び開きうる（W-U04 と同根）
- [W-R03] `do/scopeObject.ts:86-101` — constructor の再武装が「実際に張る」側を観測するテストが無い（`armForStoredRows` を no-op にしても全緑）
- [W-R04] `do/scheduledTasks.ts:89-104` — due index スライスの並び順が `COALESCE(lease_expires_at, due_at)` なのに spec は「`due_at` の早い 25 行」
- [W-R05] `do/scopeObject.ts:172-177` — `armAndPublish` に合流が無く、同一 scope への並行 commit が publish 回数ぶんの待ちを積む（W-U03 と同一）

**Scope business / 投影・検索 / R2**
- [W-S01] `projection/viewerCalendar.ts:formatterFor` — `Intl.DateTimeFormat` を行ごとに構築している（不正 TZ 時は行あたり 2 回＋例外 2 回）
- [W-S02] `r2/objectStorage.ts:sha256Of` — `crypto.subtle.digest` は view の範囲を尊重するので本文全体の複製は不要、かつコメントの根拠が事実と違う
- [W-S03] `search/highlight.ts:highlightBody` — 窓が UTF-16 ユニット境界で切られ、サロゲートペアを割って対にならないサロゲートを返しうる

**合成・スキーマ・ハーネス・spec/docs**
- [W-C01] `do/schema.ts:43-46` — scope 検証の範囲を「全 scope 表」と書いており、本 PR 自身が改めた `spec/database/index.md:22` の帰属列除外規約と食い違う
- [W-C02] `spec/platform/index.md:796` — 「どのバックエンドが届かないか」を ADR 056 のコンテキストへ委譲したが、ADR 056 は撤回済みの「3 文」目標と in-memory のみの一覧のまま
- [W-C03] `domain/note/ports/{local,public}NoteQueryService.ts` — 「タグ名の重複は 1 件と同じ」を JSDoc に新設したが適合スイートにも `spec/domains/note.md` にも降りていない（AC-8）
- [W-C04] `do/scopeObject.ts:112-121` → `do/alarm.ts:254-263` — 「Alarm を消す地点は turn の出口 1 か所に限る」に反し commit 経路でも削除する。中央 runner 配備で publish 再試行 Alarm が commit ごとに消え、`deleteAlarm` 後・publish 完了前のクラッシュで恒久的な索引欠落が残る（W-U01 と同根）
- [W-C05] `.thread/11/adr.md` — ADR-026 が欠番のまま（重複・順序の乱れは無し）
- [W-C06] `spec/inventory/frontend.md:3` — 行を改訂したのに最終同期日だけ据え置き
