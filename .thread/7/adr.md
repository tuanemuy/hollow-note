# ADR — Issue #7: ノート本文・メディア・タイトル・ゴミ箱を編集する

## ADR-001: `HtmlProcessor` アダプターを本スライスで実装する

### Context

Issue #7 のチェックリストは UC / PAGE / TC 行だけで構成され、アダプター台帳（`spec/inventory/adapter.md`）の ADP 行を含んでいない。`HtmlProcessor` は `packages/core/src/domain/note/ports/htmlProcessor.ts` にポート定義だけがあり、その JSDoc は「Port definition only in the walking-skeleton slice — the adapter ships with the import slice」と書いている。import slice は Issue #6 で、#7 の依存には挙がっていない（#7 の依存は #1 のみ）。

一方、#7 のチェックリストのうち TC-note-682〜724（サニタイズの許可リスト・URL スキーム・CSS 宣言・壊れた HTML）と TC-note-001〜006 / 011〜012（テキストノードの経路解決・`expected` 不一致・`<style>` に経路を割り当てない）は、いずれもこのアダプターの振る舞いそのものを検証する行である。合わせて 70 行以上が、アダプターなしでは満たせない。

選択肢は 3 つあった。

1. #6 の完了を待って #7 を後ろへ回す
2. #7 の中で `HtmlProcessor` アダプターを実装する
3. 該当する TC 行を見送り、理由を Issue のコメントに残す

### Decision

2 を採る。#7 で `HtmlProcessor` アダプター（ADP-note-001〜005）を実装し、ポート JSDoc の「adapter ships with the import slice」を現状に合わせて書き換える。

1 は成立しない — #6 の側もこのアダプターに依存するので、どちらが先に着手されてもアダプターを作るのは先着したスライスになる。#7 のほうが先に着手されている。3 は Issue の完了条件（全行の実装、スタブ・部分実装は不可）を大きく削り、しかもチェックリストの中核（サニタイズ）を丸ごと外すため、スライスとして意味をなさなくなる。

### Consequences

- 良い点: #7 が自己完結する。#6 は完成した `HtmlProcessor` を前提に取り込み経路だけを書けばよくなり、二重実装の危険がない
- 良い点: サニタイズ規則（[ADR 013](../../spec/adr/013-html-sanitization-policy.md)）の唯一の適用点が本スライスで実物になり、TC 行が実際の振る舞いを検証するようになる
- トレードオフ: #7 のスコープが台帳上の割り当てより広がる。#6 の残作業がその分軽くなるので総量は変わらないが、#7 単体のレビュー負荷は上がる
- トレードオフ: `HtmlProcessor` は永続化ポートではないため conformance スイートの枠組みに乗らない。実装を差し替えても同じ表を通せるよう、アダプター単体テストをテーブル駆動で書く必要がある

---

## ADR-002: 不在の集約に依存する手順は、境界を切って本スライスの持ち分だけを実装する

### Context

#7 のチェックリスト行が指す spec の手順が、本リポジトリにまだ存在しない集約を要求している箇所が 4 つある。

- **Job 集約（Issue #5 / #6 の持ち分。`application/cleanup/participants.ts:44` に不在が明記）** — `spec/usecases/note.md#updateNoteBody` 手順 2・8（`JobRepository.listActiveByTarget` と参照取り込みジョブの登録）、`#applyTextNodeEdits` 手順 2、`#trashNote` 手順 2・3（`Job.cancel` と強制終端の後始末）
- **一括操作ジョブ** — `spec/usecases/note.md#emptyTrash` の 51 件以上の経路（`requestBulkNoteOperation`）
- **Tag 集約（`participants.ts:46` が "curation"（#8）へ handoff と宣言）** — UC-tag-013 `deleteAssignmentsForNote`
- **BackupRecord（`participants.ts:47` が "#4" へ handoff と宣言）** — UC-integration-013 `deleteBackupRecordsForNote`

後ろの 2 つはチェックリストに UC 行として明示的に載っており、`purgeNote` 手順 5 の `note.purged` 購読者としても spec に書かれている。前の 2 つはチェックリストに UC 行がないが、#7 の TC 行（TC-note-665 / 671〜676 / 728〜730 / 733 / 736〜740、TC-note-101〜107）が直接その振る舞いを検証する。

### Decision

依存の向きで扱いを分ける。

- **`note.purged` の購読者（UC-tag-013 / UC-integration-013）は本スライスで実装する。** これらは `note.purged` を入力とする追随処理であり、完全削除（ED-10 の「元ファイル・メディア・版の履歴も削除される」）の一部として #7 の受け入れ基準に入っている。Tag / BackupRecord の**書き込み側**（タグの付与・バックアップの作成）は #8 / #4 の持ち分のままで、本スライスが足すのは削除側の集約最小形とその購読者に限る。`participants.ts` の `absent(...)` は実装した分だけ `participant` へ移す
- **Job 集約に依存する手順は、Job 側のポートを呼ぶ形のまま実装し、集約そのものは作らない。** `updateNoteBody` / `applyTextNodeEdits` / `trashNote` の手順から Job への呼び出しを削らず、spec の手順のとおり書く。Job の実体がまだ無い状態でどう成立させるか（ポートを定義して不在アダプターを噛ませるのか、`participants.ts` と同じ「不在の宣言」の形にするのか）は実装フェーズがコードを読んで決める — 既存の `absent(...)` レジストリと `identity` の削除サガが、この repo が不在をどう表現しているかの先例になる
- **Job 集約が無いと成立しない TC 行（`NoteLockedByJob` の分岐、強制終端、参照取り込みジョブの登録、`emptyTrash` の 51 件以上）は、Job の実体が入るまで完全には満たせない。** 見送る行が確定した時点で、チェックせず理由を Issue #7 のコメントに残す（Issue の完了条件が定める手順）

### Consequences

- 良い点: `note.purged` の fan-out が本スライスで揃い、完全削除が「消したつもりで残る」状態にならない。`note.purged` は購読者が 1 件も登録されていないと `dispatchDomainEvent` が warn ログだけで ack してしまうため、ここを埋めないと欠落がテストで検出できない
- 良い点: Job への呼び出しを spec の手順どおり残すので、#5 / #6 が Job を入れたときに呼び出し側を書き直さずに済む
- トレードオフ: Tag / Integration の集約が、書き込み側を持たないまま削除側だけ先に生える。#8 / #4 が後から書き込み側を足すとき、本スライスが置いた形に合わせる必要がある
- トレードオフ: Job 依存の TC 行が #7 の完了時点で残る可能性がある。残る行は Issue のコメントで理由とともに明示し、#5 / #6 側で回収する

---

## ADR-003: ワークスペース文脈の編集ページ・ゴミ箱ページも本スライスに含める

### Context

本計画の初稿（2026-08-28）は、ワークスペース文脈（`/workspaces/:workspaceId/...` 配下の同構成）をスコープ外に置いていた。理由は「`application/note/accessControl.ts` の `WorkspaceAuthorization` はプレースホルダで Issue #3 の持ち分」というものだった。

その後 Issue #3（ワークスペース管理・公開）の PR #58 が main にマージされ、この前提は成り立たなくなった。現状を読んで確認した事実は次の 3 点である。

- `packages/core/src/application/note/accessControl.ts` は `domain/workspace/services/workspaceAuthorization` の実在の `WorkspaceAuthorization` を `createNoteAccessPolicy` に渡しており、`viewerFor` は `resolveWorkspaceAccess` でスコープ側の `Membership` から役割を引いている。プレースホルダは残っていない
- `apps/web/app/routes/workspaces/$workspaceId/notes/index.tsx` と `.../notes/$noteId.tsx` が実在し、個人側の `/notes` / `/notes/:noteId` と**同じコンポーネント**（`components/note/NoteList` / `NoteDetail`）を文脈プロップ付きで描いている。2 文脈が 1 つの画面を共有する形は #3 が既に確立している
- `spec/pages/index.md#URL の割り当て` は `/workspaces/:workspaceId/...` を「ワークスペース文脈の同構成（`notes` / `tags` / `trash`）」と定め、続けて「以下では文脈によらない**1 つの画面**として記述する」と明記している。P-12（ノート編集）と P-14（ゴミ箱）の節も文脈を分けて書いていない

選択肢は 3 つあった。

1. 初稿どおり個人文脈だけを実装し、ワークスペース文脈は後続スライスに回す
2. 両文脈を本スライスに含める
3. ワークスペース文脈のルートだけ先に置き、中身は個人文脈へリダイレクトする暫定形にする

### Decision

2 を採る。P-12 / P-14 を個人・ワークスペースの 2 ルートずつ（計 6 ルート）実装し、画面本体は #3 が確立した共有パターン（`components/note/` の 1 コンポーネント + 文脈プロップ、文脈ごとの断片 server function、`noteId` で定まるミューテーションは 1 本を共有）に倣う。

1 は成立しない。spec が両者を 1 つの画面として記述している以上、「ワークスペース文脈だけ編集できない・ゴミ箱が無い」状態はチェックリストの PAGE 行を満たしたことにならず、`spec/manual-tests/editing.md` の TC-23（ユーザー A / B の競合）・TC-24（保存時の除名）・TC-28（viewer の制限）・TC-32（viewer のゴミ箱）がそもそもワークスペース前提で書かれていて実行できない。3 は URL だけ生えて中身が個人文脈という嘘の構成になり、後続スライスがリダイレクトを剥がす作業を余分に負う。

### Consequences

- 良い点: 本スライスの完了時点で編集体験が両文脈で end-to-end に成立し、`spec/manual-tests/editing.md` の権限系・競合系 TC がそのまま実行できる
- 良い点: `NoteAccessPolicy` の削除権限（本スライスで追加する）が、実在の `WorkspaceAuthorization` に対して初めて実際に効く経路を持つ。個人文脈だけではワークスペース役割の分岐が一度も踏まれない
- 良い点: 追加するのはルートとシェルの差だけで、画面本体・ミューテーション・ユースケースはすべて共有される。#3 が先例を残しているので新しい設計判断は要らない
- トレードオフ: フロントエンドのルート数が P-12 / P-14 で倍になり、ステップ 10 / 11 の実装量とレビュー範囲が増える
- トレードオフ: ワークスペース側のゴミ箱は `getWorkspaceSettings` の読み取り・`foldScopeSelectionForUnavailable` の畳み込み・`workspaceUnavailability` の写像という #3 由来の作法を守る必要があり、個人側より手順が 1 段多い。ここを個人側と同じ形で書くと、権限のないワークスペースを開いたときに画面と引き継ぎ Cookie が別の結論を出す
