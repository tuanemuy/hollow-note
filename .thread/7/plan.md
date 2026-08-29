# 実装計画 — Issue #7: ノート本文・メディア・タイトル・ゴミ箱を編集する

**Issue:** #7
**作成日:** 2026-08-28
**規模:** 通常
**実装方針:** steps.md

---

## 目的

3 種の編集モード（ビジュアル / HTML / WYSIWYG）、メディア挿入、タイトル・表示スタイルの変更、版の復元、ゴミ箱の復元・完全削除までを通し、ノート編集体験を end-to-end で成立させる。

## 受け入れ基準

Issue #7 は `<!-- spec-slice -->` 付きの縦スライスで、要件の正典は Issue 本文の実装チェックリストと、その各行が指す `spec/` の節である。ここでは基準を全行の転記に代えず、次の形で置く。

| # | 基準（検証可能な形で） | 由来 | 対応ステップ |
|---|---|---|---|
| AC-1 | 実装チェックリスト全行が実装されている（Issue #7 本文参照。スタブ・仮実装・部分実装は不可）。各行の判定は行が指す `spec/` の節を正典とする | Issue #7「完了条件」 | 1–12 |
| AC-2 | **ED-02**: ノート詳細から編集を開きビジュアルモードでテキストを書き換えて保存すると、元の構造・`class` / `style` / `data-*` を保ったまま本文が更新される。要素の追加・削除は不可で、`script` / `style` の中身は編集対象にならない | `spec/scenario/editing.md#ED-02` | 1, 3, 10 |
| AC-3 | **ED-03**: HTML モードでソースを編集して保存すると、サニタイズを経て本文が更新され、除去された要素・属性・URL・CSS 宣言が保存後に一覧表示される。800 KB 超は拒否される。外部参照の取り込み可否を選べ、既定は「取り込む」 | `spec/scenario/editing.md#ED-03` | 1, 3, 10 |
| AC-4 | **ED-04**: WYSIWYG モードで編集できる。HTML 由来のノートでは装飾が失われうる警告が出て、了解して進むと保存前に版が保持され、版から戻せる | `spec/scenario/editing.md#ED-04` | 1, 3, 5, 10 |
| AC-5 | **ED-05**: 編集画面でモードを切り替えられる。未保存の変更があれば確認が出る。編集可能なテキストノードがない本文ではビジュアルモードを選択できない。選択したモードは端末に保持され、次に既存ノートの編集を開くときの既定になる（新規作成は常に WYSIWYG） | `spec/scenario/editing.md#ED-05` | 10 |
| AC-6 | **ED-06**: HTML / WYSIWYG モードでツールバーまたはドロップから画像・動画をアップロードでき、完了すると保存先 URL を参照する要素が本文に挿入される。対応形式外・サイズ上限超・容量不足は弾かれ、SVG はサニタイズされて保存される。失敗時はプレースホルダーが除去され再試行できる | `spec/scenario/editing.md#ED-06` | 2, 6, 10 |
| AC-7 | **ED-07**: ノート詳細および編集画面でタイトルをインラインで書き換えると自動保存され、一覧・詳細の表示に反映される。空は「無題」、200 文字超は拒否される | `spec/scenario/editing.md#ED-07` | 4, 10, 11 |
| AC-8 | **ED-08**: 編集中は自動保存され「保存中 / 保存済み / 未保存」が表示される。明示保存・破棄ができ、保存のたびに版が記録されて直近 20 版から復元できる。競合・権限喪失・通信エラーはそれぞれ専用の状態として提示される | `spec/scenario/editing.md#ED-08` | 3, 5, 10 |
| AC-9 | **ED-09**: ノート詳細のメニューから削除するとゴミ箱に移り、一覧から消え、直後は「元に戻す」で取り消せる。公開中のノートは警告が出て、削除後は公開・共有 URL からアクセスできなくなる | `spec/scenario/editing.md#ED-09` | 7, 11 |
| AC-10 | **ED-10**: `/notes/trash` を開くと削除日時の新しい順に一覧と残り日数が並び、個別の復元・完全削除と「ゴミ箱を空にする」ができる。完全削除で元ファイル・メディア・版・タグ付与・バックアップ記録が消え、51 件以上は一括削除ジョブとして予約され文言が分かれる。空状態・権限なしを表示する | `spec/scenario/editing.md#ED-10` | 7, 8, 9, 11 |
| AC-11 | **ED-11**: ノート詳細のメニューから表示スタイル（既定スタイルを適用 / 元の装飾のみ）を切り替えられ、その場で表示が変わり、一覧・公開ページ・書き出しに反映される。編集権限がなければ表示のみになる | `spec/scenario/editing.md#ED-11` | 4, 11 |
| AC-12 | `pnpm typecheck && pnpm lint:fix && pnpm format` が通り、`pnpm test` が両プロジェクト green | Issue #7「検証」 | 12 |
| AC-13 | `spec/manual-tests/editing.md` の TC-04〜TC-34 のうち本スライスの対象シナリオに属する手順が実機で PASS する | Issue #7「検証」 | 12 |

## スコープ

### 含まれないもの

- **ED-01（白紙のノートを新規作成する）** — 依存 Issue #1 で実装済み。本スライスは `/notes/new` の編集体験（PAGE-p12-002）だけを扱い、`createBlankNote` 自体は触らない
- **取り込み・変換・再生成**（IM-xx / UC-note の `runConversion` / `runRegeneration` / `importExternalReferences`）— Issue #6 の持ち分。本スライスは「実行中ジョブがあれば編集を拒否する」判定側だけを持つ
- **検索・タグ管理・一括操作の UI**（P-10 の検索、P-16、OR-09）— Issue #8 の持ち分。本スライスが触れるのは `note.purged` に追随する `deleteAssignmentsForNote` の 1 行だけ
- **共有・公開の設定変更**（SH-xx / `changeNoteVisibility` / `setSharePassword`）— Issue #9。本スライスは trash / purge が公開・共有経路を閉じることだけを保証する
- **書き出し**（EX-xx / `exportNote` 以降）— Issue #10
- **ワークスペース文脈**（`/workspaces/:workspaceId/...` 配下の同構成）— `application/note/accessControl.ts` の `WorkspaceAuthorization` は現在プレースホルダで Issue #3 の持ち分。本スライスは個人所有ノートの経路を正とし、ワークスペースの分岐は既存のプレースホルダの形を崩さずに残す

## リスクと注意点

- **`HtmlProcessor` アダプターが未実装で、本スライスのチェックリストに行がない。** `packages/core/src/domain/note/ports/htmlProcessor.ts` はポート定義のみで、JSDoc は「adapter ships with the import slice」（#6）と書いている。台帳上も ADP-note-001〜005 は `spec/inventory/adapter.md:187-191` にあり、Issue #7 のチェックリストは UC / PAGE / TC 行しか含まない。しかし TC-note-001〜017（テキストノード編集）と TC-note-682〜741（サニタイズ）は全行がこのアダプターの振る舞いそのものを検証するため、#7 でこれを実装しないと 70 行以上が満たせない。→ 扱いは adr.md ADR-001
- **`Job` 集約が存在せず、`updateNoteBody` / `applyTextNodeEdits` / `trashNote` の手順がそれを前提にしている。** `spec/usecases/note.md#updateNoteBody` の手順 2・8 と `#trashNote` の手順 2・3 は `JobRepository.listActiveByTarget` / `Job.cancel` / `Job.enqueue` を要求するが、Job 集約は Issue #5 の持ち分で `application/cleanup/participants.ts:44` に不在が明記されている。TC-note-728/729/730/733/736〜740/665/671〜676 が直接ここに当たる。→ 扱いは adr.md ADR-002
- **`Tag` / `BackupRecord` 集約が存在しないのに UC-tag-013 / UC-integration-013 がチェックリストにある。** `participants.ts:46-47` は tag を "curation"（#8）、backup を "#4" へ handoff すると宣言している。→ 扱いは adr.md ADR-002
- **`emptyTrash` の 51 件以上の経路は `requestBulkNoteOperation`（一括操作ジョブ）を呼ぶ。** これも Job 集約側にあり、TC-note-101〜107 / 340〜347 がそこに当たる。→ ADR-002 と同じ扱い
- **`purgeNote` は本スライス中もっとも重い。** route CAS（`NoteRouteStore.beginPurge` / `abortPurge` / `finishPurge`）、内部 operation ID の決定的採番、forward recovery、public projection の `removeForPurge` まで含み、TC-note-348〜372 の大半が中断・再送・回収の窓を突く。既存の `deleteFilesByOwner.ts` の `ScopeCleanupTurn` と、`identity` の削除サガが唯一の参考実装になる
- **`StoredFileRepository` のポートが本スライスの必要を満たしていない。** JSDoc に「the import slice adds the note / artifact / expiry listings」とあり、現在は `listByIds` / `listByOwner` / `sumSizeByOwner` のみ。`deleteFilesForNote` と `collectOrphanMedia` はノート単位・期限切れの列挙を要求するため、ポート追加 → memory / cloudflare 両アダプター → conformance スイートの 3 点セットが要る（[ADR 026](../../spec/adr/026-port-contract-and-conformance.md)）
- **`UploadValidationPolicy` の `RULES` に `media` 行がない**（`avatar` のみ）。マジックバイト判定も PNG / JPEG / WebP のみで、GIF / SVG / MP4 / WebM が未対応。SVG サニタイズは実装が一切ない（TC-storage-176〜178）
- **`note.purged` の購読者が 1 件も登録されていない。** `application/workers/subscribers.ts` の `domainEventSubscribers` は `identity.identity.removed` と `storage.fileDeleted` の 2 件のみで、`dispatchDomainEvent` は未購読イベントを warn ログだけで ack する。したがって購読者を足し忘れても既存テストは緑のまま通る
- **`NoteAccessPolicy` に `ensureCanDelete` がない。** `ensureCanEdit` はあるが、trash / purge / emptyTrash が要求する削除権限の判定は追加になる
- **フロントは P-12 / P-14 とも 0 から。** 既存のノート系コンポーネントは閲覧専用の最小形で、エディタ・アップローダー・版一覧・ゴミ箱一覧はいずれも存在しない。3 モードのエディタは本スライス最大の UI 実装で、ビジュアルモードはアダプターの `path` 規約（body ルートからのドット区切り 0 始まり子インデックス）とクライアント側の DOM 走査が一致していないと編集が全件 `pathNotFound` に落ちる
- **自動保存 × 楽観ロック × React 19 プリミティブ。** `CLAUDE.md` の「Frontend」節どおり、保存は server component → `"use client"` 島 → `useActionState` / `useOptimistic` の三層で、`ConflictError("OPTIMISTIC_LOCK_FAILURE")` は握り潰さず競合状態として提示する必要がある。`version` を握るのは編集画面の所有者側であり、リーフに持たせると自動保存のたびに版がずれる

## テスト方針

`docs/test.md` のテスト層・命名・fake ポリシーに従う。チェックリストの TC 行は 4 群に分かれ、それぞれ担保する層が違う。

- **アダプター層（`HtmlProcessor`）** — TC-note-001〜017 の一部（経路解決・`expected` 不一致・`<style>` の経路不割り当て）と TC-note-682〜724 のサニタイズ行の実体はアダプターの振る舞い。`HtmlProcessor` は永続化ポートではないので conformance スイートの対象ではなく、`packages/core/src/adapters/{provider}/__tests__/` のアダプター単体テストで押さえる。ただし ADR 013 の規則そのものが正典なので、実装を差し替えても同じ表を通せる形（テーブル駆動）で書く
- **永続化ポート（`StoredFileRepository` の追加メソッド）** — `packages/core/src/adapters/conformance/` にケースを足し、memory と cloudflare の両方が同じスイートを通る（[ADR 026](../../spec/adr/026-port-contract-and-conformance.md)）。片側だけのテストは書かない
- **ユースケース層（`node` プロジェクト・大多数）** — TC-note-001〜017 / 018〜029 / 067〜082 / 098〜115 / 220〜227 / 340〜372 / 398〜406 / 463〜484 / 662〜741、TC-storage-016〜036 / 051〜075 / 175〜189、TC-tag-023〜032、TC-integration-016〜025。`createTestHarness()` で memory バックエンドを通し、テスト名に TC ID を含める（`docs/test.md`「Naming」）。リポジトリ / UoW の fake は作らない — 使う二重化は `FakeIdGenerator` / `FakeLogger` と `TestClock` だけ
- **並行・中断の窓（TC-note-350〜355 / 361 / 370 / 372、TC-note-113〜114、TC-storage-186、TC-note-016 / 406 / 477 / 681 / 731）** — `docs/test.md`「Injecting into a concurrency window」に従い、`createTestHarness()` が返したコンテナのポートを 1 つだけ実アダプターに委譲する薄いラッパーへ差し替え、決まった位置で 1 回だけ干渉させる。実装側に分岐を足さない
- **重複配送の冪等性（TC-note-082 / 360、TC-storage-061 / 068 / 069、TC-tag-030、TC-integration-021）** — 同じイベントを 2 回投げて 2 回目が no-op になることを購読者ごとに確認する。`note.purged` は購読者が複数いるので、購読者単位で独立に冪等であることを個別に押さえる
- **フロントエンド** — `docs/test.md`「Frontend: the bare minimum」に従い、新規のコンポーネントテストは書かない。例外は `apps/web/app/presentation/` の純関数で、本スライスが `errorDisplay` に足すエラー文言（`NoteIsTrashed` / `NoteLockedByJob` / `ContentTooLarge` / `InvalidTitle` / `InvalidStyleMode` / `NOTE_NOT_TRASHED` / 楽観ロック競合）と、それに対応する HTTP ステータス写像には `apps/web/app/presentation/__tests__/` にケースを足す
- **手動検証** — `spec/manual-tests/editing.md`（TC-04〜TC-34）を実機で走らせる。挙動を変えた手順があれば同ファイルを更新してから走らせる（stale な手順書は正しい実装を FAIL と判定するため）
