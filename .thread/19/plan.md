# 実装計画 — Issue #19: [runtime] ScopeTaskScheduler に priority と lease を足し、spec/database の scheduled_tasks に揃える

**Issue:** #19
**作成日:** 2026-08-23
**規模:** 通常
**実装方針:** steps.md

---

## 目的

#2 が縮退として先送りした `scheduled_tasks` の 2 点 — `priority` による枠取りと `running`（リース）— を、`ScopeTaskScheduler` / `ScopeTaskQueue` のポート契約・適合スイート・memory アダプターに反映し、#11 が D1 / Durable Object を書く前提となる契約を確定させる。

## 受け入れ基準

| # | 基準（検証可能な形で） | 由来 | 対応ステップ |
|---|---|---|---|
| AC-1 | `ScopeTask` が `priority` を持ち、`schedule` / `backoffOrSchedule` が `priority` を必須で受ける。値域は `spec/database` の 4 分類（security cleanup=0 / outbox relay=1 / projection=2 / 期限回収=3）に型で閉じている | Issue 範囲 1 | 1, 8 |
| AC-2 | `claimDue` は「priority 昇順に各 priority 最低 1 枠 → 残りを `(priority, dueAt, kind, operationId)` 昇順で充填」で選び、**返す順序も `(priority, dueAt, kind, operationId)` 昇順**である。priority 3 の行が大量に先に期限到来していても、同じ turn で priority 0 の行が claim される | Issue 影響「飢餓」/ `spec/platform/index.md:181` | 1, 3, 5, 6 |
| AC-3 | 予約枠が**下限**として働く: priority 0 の行が budget を超えて滞留していても、priority 3 の行が 1 turn に最低 1 件 claim される | `spec/platform/index.md:181` | 1, 3, 5, 6 |
| AC-4 | 予約枠は**上限ではない**: 候補が priority 0 だけのとき `claimDue(limit: 10)` は 10 件返す（`limit / クラス数` に切られない） | `spec/platform/index.md:181` / ADR-001 | 1, 3, 5, 6 |
| AC-5 | `limit` が候補 priority クラス数を下回るとき、返るのは厳密 priority 昇順の先頭 `limit` 件になる（例: priority 0..3 が各 1 件あって `limit: 2` なら priority 0 と 1）。かつ**予約枠が各 priority から取る 1 件は `(dueAt, kind, operationId)` 最小の行**なので、`limit` がクラス内候補数を下回っても返却集合が一意に定まる（priority 0 に `dueAt` 1 / 2 の 2 件・priority 3 に 1 件で `limit: 2` なら `dueAt` 1 の行と priority 3 の行） | ADR-001 | 1, 3, 5, 6 |
| AC-6 | `listDue` が scope 横断で同じ規則に従う: (a) priority 0 の行を大量に持つ scope が複数ある状況で `listDue(now, limit)` を呼んでも、priority 3 の行しか持たない scope が結果に 1 件載る、(b) リース中の行はどの scope のものも結果に現れない | Issue 範囲 1 | 2, 3, 5, 7 |
| AC-7 | `claimDue` は claim した行を `running` にし、`leaseExpiresAt = now + leaseMs` を持たせる。同じ `now` で再度 `claimDue` / `listDue` を呼んでも同じ行は返らない | Issue 影響「同時実行」 | 1, 3, 6, 7 |
| AC-8 | `leaseExpiresAt` を過ぎた `running` 行は再び claim される。**`dueAt`**・payload・priority・attempt は claim 前と変わらない（`dueAt` が保たれるので同 priority 内の位置も変わらない） | Issue 範囲 1（reclaim）/ ADR-002 | 1, 3, 6 |
| AC-9 | `pending → running → pending / failed` の遷移がポート JSDoc に規定され、5 操作すべてについて `priority` の扱いが明記されている（`schedule` = 上書き / `backoffOrSchedule` = mint 時のみ・既存行は不変 / `backoff` `claimDue` = 不変）。stall した行を別 priority で `backoffOrSchedule` しても claim 順が変わらない | Issue 範囲 1 / ADR-009 | 1, 3, 6 |
| AC-10 | 入力境界がポート JSDoc に規定されている: `limit <= 0` は空配列を返す（`claimDue` **と `listDue` の両方**に書かれ、選択規則を共有する 1 つの純粋関数で実装される。適合スイートで拘束）、`leaseMs` が正であることは呼び出し側の責務でありリース超過時の実害も JSDoc に書かれている | ADR-005 | 1, 2, 3, 5, 6 |
| AC-11 | ハンドラ未登録の kind の行は、claim されたあとリース中は `listDue` / `claimDue` に現れず、リース失効後に再び現れる。attempt は増えず `failed` にも落ちない | Issue 影響「同時実行」の副作用 / ADR-004 | 1, 8, 10 |
| AC-12 | AC-1〜AC-10 の観測可能な性質が `adapters/conformance/scopeTaskScheduler.ts` の追加ケースとして拘束され、memory バックエンドが緑で通る（AC-11 / AC-13 はハンドラ登録簿を要するので application 層の担当） | Issue 範囲 2 + 範囲 3（memory 分）/ ADR 026 | 3, 5, 6, 7 |
| AC-13 | settle しないハンドラを持つ kind の行に対し、同じ clock で `runDueScopeTasks` を 2 回続けて実行したとき、(1) ハンドラは 1 回しか走らず、(2) 2 本目は `processed: 0` を返し、(3) **リース中の行の `attempt` と `dueAt` が 1 本目の claim 直後から変化しない**。`clock.advance(SCOPE_TASK_LEASE_MS)` 後の 3 本目では 2 回目のハンドラ実行が起きる | Issue 影響「不要な指数バックオフ」/ ADR-005 | 10 |
| AC-14 | リースが spec の両方の正本に届いている: (a) `spec/database/index.md#scheduled_tasks` に `lease_expires_at` 列・再 claim 条件・`due_at` が状態によらず実行予定時刻であること（＝ `spec/platform/index.md:186` の「priority 0 の最古 task age 1 分」SLO が `due_at` から測れる）・リース失効走査用の索引 1 本が書かれている、(b) `spec/platform` の Alarm 起床規則（`setAlarm()` 文と Alarm handler 規則 4）が「pending の最小 `due_at` と running の最小 `lease_expires_at` の小さい方」になっており、spec 内で Alarm の記述が矛盾しない。**Alarm 起床を述べる spec の全出現**が勘定に入っていること — `spec/platform` の 2 か所に加え `spec/adr/021-scope-sharded-data-plane.md:88`（「最も早い時刻に 1 つの alarm を設定する」）についても改訂要否の結論が 1 行残っている | ADR-002 / ADR-008 | 11 |
| AC-15 | ポート JSDoc から縮退記述 3 文がすべて消え、確定した契約に置き換わっている: (a)「`claimDue` は scope オブジェクトが single writer である前提にのみ依存して `dueAt` 順に読む」（`application/ports/scopeTaskScheduler.ts:32-34`）、(b)「`dueAt` が並び順の全て」（同 34-36）、(c)「priority と lease は複数 writer を配備するランタイムへ先送り」（同 36-38）。かつ #11 へ引き継ぐ 4 点（下記スコープ節）が spec / ポート JSDoc / Issue コメントのいずれかに残っている | Issue 範囲 1 / #2 の縮退記録 | 1, 2, 11, 12 |
| AC-16 | アカウント削除の完走（既存の scope task 駆動）が回帰しない。`pnpm test` / `pnpm typecheck` / `pnpm lint` が緑 | 既存機能の保護 | 8, 9, 10, 12 |
| AC-17 | `leaseMs` を配備側が選べる: `SCOPE_TASK_LEASE_MS` 環境変数が `OUTBOX_LEASE_MS` と同じ経路（`TuningEnv` → `NodeServerEnv` → runner tuning → `runDueScopeTasks`）で `claimDue` まで届き、未設定なら `SCOPE_TASK_LEASE_MS` 定数が使われ、正でない値は boot が拒否する。`apps/web/.env.example` に既定値つきで記載がある | ADR-005 / ADR-010 | 9 |

## スコープ

### 含まれないもの

- **D1 / Durable Object 実装（Issue 範囲 3 の後半）** — このリポジトリに Cloudflare アダプターは存在せず、唯一のランタイム配線は Node + in-memory（[ADR 025](../../spec/adr/025-single-reference-runtime.md)、CLAUDE.md「Reference runtime」）。#11 の持ち分とし、本 Issue は**契約 + 適合スイート + memory アダプター + `spec/database` の列**までで完了とする。#11 は同じスイートを import して同一に通す（[ADR 026](../../spec/adr/026-port-contract-and-conformance.md)）
- **#11 への引き継ぎ事項**（adr.md に根拠、ステップ 11 / 12 で残す）: ①リースは `dueAt` と別に持ち、`spec/database` の `lease_expires_at` 列と `spec/platform` の Alarm 起床規則に置く（ADR-002 / ADR-008。memory は行の判別共用体で同じ原則を実装する）、②settle は fencing token を持たない — **複数 writer を実配備する前に要否を決着させること**（未決着のまま配備しない。ADR-005）、③枠取りは「priority ごとに `LIMIT 1` + 残りを 1 本」の 2 段クエリになり、返却順と返却集合まで契約に凍結されている（ADR-001）、④runner の round 内 budget 配分は本 Issue で変えていない（ADR-007）
- **runner の round 内 budget 配分の変更** — `claimDue` の枠取りは 1 scope の turn の中で閉じる。中央 runner が先頭 scope に残 budget を丸ごと渡す点は本 Issue では変えない（ADR-007。理由: spec の飢餓回避規定は scope Alarm の 1 turn に対するもので、最終プラットフォームには中央 runner が存在しない）
- **`last_error` 相当のエラーテキスト保存** — `spec/database` の列にはあるがポートに受け口が無い。#2 からの既存の欠落で、本 Issue が扱う飢餓 / 同時実行とは独立
- **attempt 上限到達時の global 運用イベント通知** — `spec/platform/index.md:183` / `spec/domains/index.md:322` が定めるが未実装。独立の欠落
- **未実装の継続 kind（note / tag / job / workspace 系）の追加** — ユースケース側が未実装であることに由来する
- **`spec/domains/` / `spec/inventory/adapter.md` への 2 ポートの行の追加** — この 2 ポートは spec 全域に 1 件も記載が無い（#2 の新設時からの状態）。ドキュメントの正確性は spec-sync の持ち分
- **`spec/` のその他の変更** — priority の値域・分類・枠取り・`status` 3 値・SLO・1 turn の上限はいずれも spec の記述どおりに実装するため触らない。改訂するのは `scheduled_tasks` の lease 列・リース索引・その注記と、**`spec/platform` の Alarm 起床規則 2 か所**（ADR-002 が起床経路を 2 本にした帰結。片方だけ直すと spec が自己矛盾する）だけ（adr.md ADR-008）

## リスクと注意点

- **未処理 kind の再来周期が変わる**。現行は「毎 tick（1 秒）」だが、claim がリースを取るためリース失効（既定 5 分）まで戻らない。`application/workers/scopeTaskRunner.ts:76-84` の JSDoc は「standing log line」＝毎 tick 立ち続けることを可視性の担保として明記しており、この根拠が成立しなくなる。JSDoc をリース周期の性質へ書き直し、**停滞の検知はログ頻度ではなく `dueAt` から測る最古 task age に拠る**ことを #11 へ引き継ぐ（adr.md ADR-004）。`application/workers/__tests__/scopeTaskRunner.test.ts:204` の「leaves a task whose kind has no handler due」がこの前提に直接乗っており、更新が必要
- **`leaseMs` は 1 回の claim バッチ全体を覆う必要がある**。runner は最大 100 行を 1 回の claim で取り、順に処理する。リース超過時の実害は「継続の鎖が止まる」では済まず、personal cleanup なら barrier が開いたまま・User が `deleting` のまま残り、reference runtime には自動復旧経路が無い（adr.md ADR-005）。既定 5 分は outbox の `DEFAULT_LEASE_MS` に合わせた値で、配備側は `SCOPE_TASK_LEASE_MS` 環境変数で選び直せる（adr.md ADR-010）。値が最悪ケースの turn を上回るかは型でも zod でも縛れず、配備側の判断のまま残る
- **runner の budget 会計は「claim 件数 ≤ その round で処理する件数」の不変条件に暗黙に依存している**。現行は `claimDue(now, budget)` の直後に同じ `budget` を減らしながら回すので算術的に破れないが、リース導入後に破れたときの代償は「次 tick で拾い直し」から「**リース期間ぶん（既定 5 分）ロックされたまま放置**」へ跳ね上がる。ステップ 8 で WHY コメントとして残す
- **AC-2〜AC-6 はポート単体の性質**。runner の 1 ラウンドは先頭 scope に残 budget を丸ごと渡すため、ラウンド全体での予約枠は保証されない（priority 0 で埋まった scope が先頭に来た round では他 scope は次 tick まで待つ）。ラウンド配分は #11 の実配備で再評価する（adr.md ADR-007）
- **`ScopeTask` にフィールドが 2 つ増える**（`priority` / `leaseExpiresAt`）。`dueAt` は意味も型も変わらないので破壊的変更にはならない（adr.md ADR-003）
- **memory の行は判別共用体になる**。`failed` 行は `dueAt` を持たなくなるため、生行の `dueAt` を読むテスト（`deleteAccount.cleanup.test.ts:126` / `deleteAccount.terminalPrune.test.ts:345` / `deleteFilesByOwner.test.ts:353`）は状態で絞ってから読む形へ直す必要がある（型エラーで検出できる）。**逆に書き込み側は型で捕まらない**: spread で状態を跨ぐと残留フィールド（`failed` に残る `dueAt` 等）が値に残ったままエラーにならないので、状態遷移は明示構築にする（steps.md ステップ 6）
- **`claimDue` が書き込みになる**。scope UoW の中で呼ばれる前提は変わらないが、読み取り専用と思って呼ぶ経路があれば壊れる（現状は runner のみ）
- **priority と kind の対応はレビュー頼み**（型は 4 値に閉じるが、どの kind がどの分類かまでは縛れない — adr.md ADR-006）。既存 4 kind の分類: `storage.ownerDeleteContinued` / `usage.userCleanupContinued` / `identity.personalCleanupHandoverContinued` = 0（security cleanup）、`identity.personalBarrierPruneContinued` = 3（期限回収）
- **値域の半分は利用者ゼロで入る**。`outboxRelay`(1) / `projection`(2) は `spec/platform` では scope Alarm の仕事だが、本リポジトリの outbox relay は global の `eventRelayWorker` が担い、private projection は scope task として存在しない。実装済み 4 kind はすべて 0 か 3 に落ちる。spec の分類をそのまま写す判断（adr.md ADR-006）の帰結であって実装漏れではない
- **予約枠の副作用**: 予約枠は**下限**なので（AC-4）、priority 0 の候補が budget を埋め尽くさない限り低 priority は充填パスで何件でも進む。「budget 100 のとき低 priority の前進は 1 turn 1 件」は**アルゴリズムが低 priority を 1 件に切る**という意味ではなく、**priority 0 が budget を埋め尽くした最悪ケースで低 priority に保証される下限が 1 turn 1 件だけ**という意味である。実装済み 4 kind では priority 0 が 100 件溜まる状況自体が稀で、`identity.personalBarrierPruneContinued` が通常 1 件に切られるわけではない。この下限で期限回収が足りるかは #11 の実配備で再評価する
- **spec の改訂が 2 ファイルに入る**。`spec/database` は列 1 つ（`lease_expires_at`）と索引 1 本、`spec/platform` は Alarm 起床規則 2 か所。#11 の D1 / DO スキーマと Alarm 実装がこの前提になる。書き込み側の索引更新が 1 本ぶん増える（claim と settle のたび）

## テスト方針

- **適合スイート**（`packages/core/src/adapters/conformance/scopeTaskScheduler.ts`）が主戦場。ADR 026 のとおり、観測可能な結果（どの行が返るか / 返らないか / どの順で返るか）だけを assert し、保存表現は凍結しない。追加するケース:
  - priority 順（同 dueAt / 逆 dueAt の両方で priority が勝つ）と返却順が `(priority, dueAt, kind, operationId)` 昇順であること（AC-2）
  - 予約枠が下限として働く（低 priority 大量滞留下で高 priority が取れる / 高 priority 大量滞留下でも低 priority が 1 件取れる）（AC-3）
  - 予約枠が上限にならない（1 クラスしか無ければ `limit` 全部を取る）（AC-4）
  - `limit` がクラス数未満のとき厳密 priority 順に縮退する（AC-5）
  - 予約枠が取る 1 件はクラス内の `(dueAt, kind, operationId)` 最小の行である（priority 0 に `dueAt` 違いの 2 件 + priority 3 に 1 件、`limit: 2` で返却集合が一意）（AC-5）
  - claim がリースを取る（同じ `now` の再 claim・`listDue` から消える）（AC-7）
  - リース失効後の reclaim（`dueAt` / payload / priority / attempt が保たれ、同 priority 内の位置も変わらない）（AC-8）
  - running 行に対する `schedule` / `backoff` / `backoffOrSchedule` / `complete` の遷移（AC-9）
  - `backoffOrSchedule` に既存行と別の priority を渡しても claim 順が変わらない / `schedule` は上書きする（AC-9）
  - `limit <= 0` は空配列（AC-10）
  - `listDue` にも同じ priority 枠取りとリース不可視が効く（AC-6）
- **既存ケースの維持**: upsert・dueAt 順・backoff の指数・attempt 上限で `failed`・`complete` / `backoff` の no-op は現行のまま通ること
- **application 層**: settle しないハンドラを注入して `runDueScopeTasks` を同じ clock で 2 回連続実行し、ハンドラ 1 回 / `processed: 0` / 行の `attempt` と `dueAt` が不変を assert する。リース失効後は 2 回目が走る（AC-13）。ハンドラ未登録 kind の行がリース中は `listDue` に出ず、失効後に戻り、`failed` に落ちないこと（AC-11）
- **env 配線（AC-17）**: `OUTBOX_LEASE_MS` の先例が専用テストを持たないので、`SCOPE_TASK_LEASE_MS` にも新しいテストを足さない（先例に揃える）。検証は「`TuningEnv` → `NodeServerEnv` → runner tuning → `runDueScopeTasks` の 1 本道が実際に繋がっていること」「`.env.example` に既定値つきで載っていること」「`pnpm typecheck` が通ること」で行う
- **回帰**: アカウント削除の完走テスト（`scopeTaskRunner.test.ts` / `deleteAccount.*.test.ts` / `deleteFilesByOwner.test.ts` / `deleteQuota.test.ts`）が緑であること。`pnpm typecheck && pnpm lint:fix && pnpm format` を最後に通す
