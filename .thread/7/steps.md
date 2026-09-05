# 実装手順 — Issue #7

Issue #7 は spec-slice である。設計は `spec/` で決着済みで、ここに新しい設計は起こさない。以下の「設計」節は各チェックリスト行の**定義がどこにあるか**の索引であり、DTO のフィールド・エラー分岐・境界値・処理手順は spec の当該節を読んで実装フェーズが決める。

## 設計

### ドメインモデルへの影響

Note 集約の状態遷移は `packages/core/src/domain/note/note.ts` に既に揃っている（`updateBody` / `rename` / `changeStyleMode` / `trash` / `restore`）。`NoteRevision`・値オブジェクト・`note.*` イベントも実装済みで、本スライスが**ドメイン層に足すのは不足分だけ**である。

| 対象 | 定義の場所 |
| --- | --- |
| Note の不変条件・状態遷移・`processing` 中の編集拒否 | `spec/domains/note.md` |
| HTML サニタイズ規則（許可リスト・URL スキーム・CSS 宣言） | [ADR 013](../../spec/adr/013-html-sanitization-policy.md) |
| 外部スタイルシート痕跡の 3 状態 | [ADR 014](../../spec/adr/014-import-result-provenance.md) |
| 既定スタイルの自動判定 | [ADR 007](../../spec/adr/007-default-style-isolation.md) |
| メディアの対応形式・サイズ上限 | `spec/scenario/editing.md#ED-06`, `spec/domains/storage.md` |
| ゴミ箱の保持期間（30 日） | `spec/scenario/editing.md#ED-10`, `domain/note/note.ts` の `TRASH_RETENTION_MS` |

不足しているのは次の 3 点。いずれも spec が既に要求している振る舞いで、新規の設計判断ではない。

- `NoteAccessPolicy` に削除権限の判定（`ensureCanEdit` の対に当たるもの）— `spec/domains/note.md` の権限表と [ADR 004](../../spec/adr/004-workspace-roles.md)
- `UploadValidationPolicy` の `RULES` に `media` 行と、GIF / SVG / MP4 / WebM のマジックバイト判定 — `spec/domains/storage.md`
- SVG サニタイズ — `spec/scenario/editing.md#ED-06` と [ADR 013](../../spec/adr/013-html-sanitization-policy.md)

### ユースケース / アプリケーションロジック

| 台帳 ID | 定義の場所 |
| --- | --- |
| UC-note-009 `updateNoteBody` | `spec/usecases/note.md#updateNoteBody` |
| UC-note-010 `applyTextNodeEdits` | `spec/usecases/note.md#applyTextNodeEdits` |
| UC-note-011 `renameNote` | `spec/usecases/note.md#renameNote` |
| UC-note-012 `changeNoteStyleMode` | `spec/usecases/note.md#changeNoteStyleMode` |
| UC-note-017 `trashNote` | `spec/usecases/note.md#trashNote` |
| UC-note-018 `restoreNote` | `spec/usecases/note.md#restoreNote` |
| UC-note-019 `purgeNote` | `spec/usecases/note.md#purgeNote` |
| UC-note-020 `emptyTrash` | `spec/usecases/note.md#emptyTrash` |
| UC-note-021 `purgeExpiredTrash` | `spec/usecases/note.md#purgeExpiredTrash` |
| UC-note-022 `deleteNotesForOwner` | `spec/usecases/note.md#deleteNotesForOwner` |
| UC-note-023 `listNoteRevisions` | `spec/usecases/note.md#listNoteRevisions` |
| UC-note-024 `restoreNoteRevision` | `spec/usecases/note.md#restoreNoteRevision` |
| UC-storage-003 `storeMedia` | `spec/usecases/storage.md#storeMedia` |
| UC-storage-007 `deleteFiles` | `spec/usecases/storage.md#deleteFiles`（実装済み — TC 行の充足のみ） |
| UC-storage-008 `deleteStoredObjects` | `spec/usecases/storage.md#deleteStoredObjects`（実装済み — TC 行の充足のみ） |
| UC-storage-010 `collectOrphanMedia` | `spec/usecases/storage.md#collectOrphanMedia` |
| UC-storage-012 `deleteFilesForNote` | `spec/usecases/storage.md#deleteFilesForNote` |
| UC-tag-013 `deleteAssignmentsForNote` | `spec/usecases/tag.md#deleteAssignmentsForNote` |
| UC-integration-013 `deleteBackupRecordsForNote` | `spec/usecases/integration.md#deleteBackupRecordsForNote` |

横断する規約は spec 本文の共通節が正典 — `spec/usecases/note.md` の「共通: 閲覧者コンテキストの解決」「共通: ユースケースを合成するときの副作用の範囲」、`spec/usecases/identity.md` の「UoW の合成と、ユースケースどうしの呼び出し」、二面 UoW は [ADR 023](../../spec/adr/023-two-plane-unit-of-work.md)、継続要求の運搬は [ADR 040](../../spec/adr/040-continuation-transport.md) / [ADR 041](../../spec/adr/041-deterministic-continuation-event-id.md)。

### アダプター / 永続化 / 外部連携

- `HtmlProcessor`（ADP-note-001〜005、`spec/inventory/adapter.md:187-191`）— 未実装。契約は `packages/core/src/domain/note/ports/htmlProcessor.ts` の JSDoc と [ADR 013](../../spec/adr/013-html-sanitization-policy.md) / [ADR 014](../../spec/adr/014-import-result-provenance.md)。チェックリストに行はないが本スライスの前提になる（adr.md ADR-001）
- `StoredFileRepository` — ノート単位・期限切れの列挙メソッドが未定義。ポート JSDoc と conformance スイートの両方を触る（[ADR 026](../../spec/adr/026-port-contract-and-conformance.md)）
- `NoteRepository` / `NoteRevisionRepository` / `NoteRouteStore` / `PublicNoteProjectionWriter` — 必要なメソッドは memory / cloudflare とも実装済み。conformance も通っている
- `note.purged` の購読者登録は `packages/core/src/application/workers/subscribers.ts` の `domainEventSubscribers` が唯一の場所

### UI / プレゼンテーション

| 台帳 ID | 定義の場所 |
| --- | --- |
| PAGE-p11-002 タイトルを変更 | `spec/pages/index.md#P-11: ノート詳細` |
| PAGE-p12-001〜008 | `spec/pages/index.md#P-12: ノート編集` |
| PAGE-p14-001〜004 | `spec/pages/index.md#P-14: ゴミ箱` |

URL の割り当ては `spec/pages/index.md#URL の割り当て` が正典（`/notes/new`, `/notes/:noteId/edit`, `/notes/trash` と、同節が「ワークスペース文脈の同構成」と定める `/workspaces/:workspaceId/notes/{new,:noteId/edit,trash}`）。デザインは `spec/design/index.md` / `spec/design/tokens.md` と `spec/design/pages/*.html` のモック。実装パターンは `docs/frontend_implementation_example.md`、三層ミューテーションと所有権の規則は `CLAUDE.md`「Frontend」。

#### 2 文脈のルートが 1 つの画面を共有する形（#3 が確立した先例）

adr.md ADR-003 のとおり本スライスは両文脈を実装する。新しい形は起こさず、`routes/notes/*` と `routes/workspaces/$workspaceId/notes/*` の既存 4 ルートがとっている次の形に倣う。

- **画面本体は `components/note/` の 1 コンポーネント。** 文脈は呼び出し側がプロップで渡し、既定値が個人（`NoteDetail` の `context = PERSONAL_NOTE_DETAIL_CONTEXT`、`NoteList` の `owner = PERSONAL_NOTE_LIST_OWNER`）。コンポーネントが URL から文脈を読むことはしない
- **server function は文脈ごとに 1 本ずつ、別ファイルに置く。** 個人は `routes/notes/-action.tsx`、ワークスペースは `routes/workspaces/$workspaceId/-action.tsx`（設定レイアウトの子ではないので `settings/-action.tsx` とは分ける）。`renderNoteList` / `renderWorkspaceNoteList` のように、同じ断片を別の入力検証（`workspaceId` を含む / 含まない）で包む
- **ミューテーションの server function は 1 本を両文脈で共有する。** `noteId` が対象を一意に決めるので文脈を取らない（`moveNoteFn` は `routes/notes/-action.tsx` にあり、共有コンポーネント `NoteDetail/menu.tsx` が文脈によらず import している）
- **シェルの差だけがルート側に残る。** 一覧系は `AppShell`（ワークスペースは `scope={{ kind: "workspace", ... }}`）、読む画面は `ReaderShell`（ワークスペースは `workspaceId` を渡す）
- **ワークスペース側でワークスペース自身を読むかは、画面が何を必要とするかで決まる。** シェルの名前・スラッグ・公開状態や書き込み可否（`WorkspaceRole.atLeast(role, "editor")`）が要る一覧型は `getWorkspaceSettings` を読み、失敗時に `scopeCookie.foldScopeSelectionForUnavailable` を呼んでから再送出し、`errorComponent` は `workspaceUnavailability` で「開けません」に畳む。ノート 1 件だけを扱う画面は読まない — 認可は `getNote` が持ち、非メンバーも削除済みも `NOTE_NOT_FOUND` に収斂する
- **正規 URL への送り直しは `NoteDetail` の `NoteUrlNormalizer` が 1 か所で行う**（OR-12）。編集画面も同じ判断を二重に持たない

### 既存ドキュメントへの影響

- `spec/manual-tests/editing.md`（TC-04〜TC-34）は本スライスの実装が初めて実機で走る対象になる。実装の過程で手順・期待結果が実際とずれた箇所は同ファイルを更新する（stale な手順書は正しい実装を FAIL と判定するため）
- `packages/core/src/application/cleanup/participants.ts` の `note` / `tag` / `backup` / `localProjection` の `absent(...)` 宣言は、本スライスが埋めた分だけ `participant` へ移す。ここは型で網羅性が固定されているので、宣言を書き換えないとビルドか完了判定のどちらかが正しく動かない
- `packages/core/src/domain/note/ports/htmlProcessor.ts` と `packages/core/src/domain/storage/ports/storedFileRepository.ts` の「後続スライスで追加する」旨の JSDoc は、実装した時点で現状に合わせて書き換える

---

## 実装ステップ

依存方向の順（domain → adapter → usecase → frontend → test）に並べる。各ステップの TC 行は、そのステップの中で実装する（`docs/test.md` の命名に従いテスト名に TC ID を含める）。

### 1. `HtmlProcessor` アダプターを実装する

- **対象ファイル:** `packages/core/src/adapters/{provider}/htmlProcessor.ts`（配置は既存のアダプター群の慣行に合わせる）、`packages/core/src/application/di/`、`packages/core/src/domain/note/ports/htmlProcessor.ts`（JSDoc の更新）
- **台帳 ID:** ADP-note-001〜005（チェックリスト外。adr.md ADR-001）。TC-note-682〜724 / TC-note-001〜006 / 011〜012 の実体
- **spec:** `packages/core/src/domain/note/ports/htmlProcessor.ts` の JSDoc、[ADR 013](../../spec/adr/013-html-sanitization-policy.md)、[ADR 014](../../spec/adr/014-import-result-provenance.md)、`spec/testcases/note/updateNoteBody.md`
- **変更内容:** `process` / `extractExternalReferences` / `rewriteReferences` / `inlineStylesheets` / `editTextNodes` の 5 メソッド。DI コンテナへ配線し、テーブル駆動のアダプター単体テストを付ける
- **理由:** 本文編集の全経路がこのポートを通る。これが無いと以降のステップ 3・5 が実装できない

### 2. ドメイン層とポートの不足を埋める

- **対象ファイル:** `packages/core/src/domain/note/services/noteAccessPolicy.ts`、`packages/core/src/domain/storage/services/uploadValidationPolicy.ts`、`packages/core/src/domain/storage/ports/storedFileRepository.ts`、`packages/core/src/adapters/{memory,cloudflare}/**/storedFileRepository.ts`、`packages/core/src/adapters/conformance/storedFileRepository.ts`
- **spec:** `spec/domains/note.md` の権限表、[ADR 004](../../spec/adr/004-workspace-roles.md)、`spec/domains/storage.md`、`spec/scenario/editing.md#ED-06`、[ADR 026](../../spec/adr/026-port-contract-and-conformance.md)
- **変更内容:** 削除権限の判定を `NoteAccessPolicy` に足す。`UploadValidationPolicy` に `media` の規則（形式・サイズ上限）とマジックバイト判定を足し、SVG サニタイズを加える。`StoredFileRepository` にノート単位・期限切れの列挙を足し、ポート JSDoc → conformance スイート → memory / cloudflare 両実装の 3 点を同時に更新する
- **理由:** ステップ 6〜9 が前提にする契約。ポートだけ足して conformance を書かないと backend 間の乖離が検出できない

### 3. 本文編集のユースケース（UC-note-009 / 010）

- **対象ファイル:** `packages/core/src/application/note/updateNoteBody.ts`, `applyTextNodeEdits.ts`, `view.ts`, `__tests__/`
- **台帳 ID:** UC-note-009, UC-note-010 / TC-note-001〜017, TC-note-682〜741
- **spec:** `spec/usecases/note.md#updateNoteBody`, `#applyTextNodeEdits`, `spec/testcases/note/updateNoteBody.md`, `spec/testcases/note/applyTextNodeEdits.md`
- **変更内容:** 2 ユースケースと DTO 射影。ジョブ連動の手順（`listActiveByTarget` / 参照取り込みジョブの登録）は adr.md ADR-002 の扱いに従う
- **理由:** ED-02 / ED-03 / ED-04 / ED-08 の中核

### 4. タイトルと表示スタイル（UC-note-011 / 012）

- **対象ファイル:** `packages/core/src/application/note/renameNote.ts`, `changeNoteStyleMode.ts`, `__tests__/`
- **台帳 ID:** UC-note-011, UC-note-012 / TC-note-398〜406, TC-note-018〜029
- **spec:** `spec/usecases/note.md#renameNote`, `#changeNoteStyleMode`, `spec/testcases/note/renameNote.md`, `spec/testcases/note/changeNoteStyleMode.md`
- **変更内容:** 2 ユースケース。読み取りモデルへの反映は `note.renamed` / `note.styleModeChanged` 経由であり、直接書かない
- **理由:** ED-07 / ED-11

### 5. 版の一覧と復元（UC-note-023 / 024）

- **対象ファイル:** `packages/core/src/application/note/listNoteRevisions.ts`, `restoreNoteRevision.ts`, `view.ts`, `__tests__/`
- **台帳 ID:** UC-note-023, UC-note-024 / TC-note-220〜227, TC-note-470〜484
- **spec:** `spec/usecases/note.md#listNoteRevisions`, `#restoreNoteRevision`, `spec/testcases/note/listNoteRevisions.md`, `spec/testcases/note/restoreNoteRevision.md`
- **変更内容:** 版一覧（作成者の解決を含む）と復元。復元後の `excerpt` / `headings` の作り直しと外部参照の扱いは spec の手順どおり
- **理由:** ED-04 の「元に戻す」と ED-08 の 20 版保持

### 6. メディアのアップロード（UC-storage-003）

- **対象ファイル:** `packages/core/src/application/storage/storeMedia.ts`, `__tests__/`
- **台帳 ID:** UC-storage-003 / TC-storage-175〜189
- **spec:** `spec/usecases/storage.md#storeMedia`, `spec/testcases/storage/storeMedia.md`
- **変更内容:** 既存の `storeAvatar.ts` と同じ形で、ステップ 2 で足した `media` の検証規則・SVG サニタイズ・容量判定・route の状態（`purging` / move 直後）を通す
- **理由:** ED-06

### 7. ゴミ箱への移動と復元（UC-note-017 / 018）

- **対象ファイル:** `packages/core/src/application/note/trashNote.ts`, `restoreNote.ts`, `__tests__/`
- **台帳 ID:** UC-note-017, UC-note-018 / TC-note-662〜681, TC-note-463〜469
- **spec:** `spec/usecases/note.md#trashNote`, `#restoreNote`, `spec/usecases/job.md` の「共通: 強制終端の後始末」、`spec/testcases/note/trashNote.md`, `spec/testcases/note/restoreNote.md`
- **変更内容:** 2 ユースケース。ジョブの強制終端と `excludingJobId` の扱いは adr.md ADR-002 に従う。手順 3 を手順 4 より先に適用する順序は spec が理由付きで固定している
- **理由:** ED-09 と ED-10 の前半

### 8. 完全削除と `note.purged` の波及（UC-note-019, UC-storage-012, UC-tag-013, UC-integration-013）

- **対象ファイル:** `packages/core/src/application/note/purgeNote.ts`, `packages/core/src/application/storage/deleteFilesForNote.ts`, `packages/core/src/application/tag/deleteAssignmentsForNote.ts`, `packages/core/src/application/integration/deleteBackupRecordsForNote.ts`, `packages/core/src/application/workers/subscribers.ts`, `packages/core/src/application/cleanup/participants.ts`
- **台帳 ID:** UC-note-019, UC-storage-012, UC-tag-013, UC-integration-013, UC-storage-007 / 008（既実装の TC 充足）/ TC-note-348〜372, TC-storage-051〜075, TC-storage-030〜036, TC-tag-023〜032, TC-integration-016〜025
- **spec:** `spec/usecases/note.md#purgeNote`, `spec/usecases/storage.md#deleteFilesForNote` / `#deleteFiles` / `#deleteStoredObjects`, `spec/usecases/tag.md#deleteAssignmentsForNote`, `spec/usecases/integration.md#deleteBackupRecordsForNote`, [ADR 008](../../spec/adr/008-domain-boundaries.md), [ADR 021](../../spec/adr/021-scope-sharded-data-plane.md)
- **変更内容:** `purgeNote` の route saga（`beginPurge` / `abortPurge` / `finishPurge`・決定的 operation ID・forward recovery・public projection の `removeForPurge`）と、`note.purged` の 5 購読者のうち本スライスが持つ 4 つ。購読者は `subscribers.ts` に登録し、`participants.ts` の `absent(...)` 宣言を更新する。Tag / BackupRecord 集約の不在は adr.md ADR-002 の扱いに従う
- **理由:** ED-10 の「完全に削除」。本スライスで最も重く、中断・再送の窓が最も多い

### 9. 一括・自動の回収（UC-note-020 / 021 / 022, UC-storage-010）

- **対象ファイル:** `packages/core/src/application/note/emptyTrash.ts`, `purgeExpiredTrash.ts`, `deleteNotesForOwner.ts`, `packages/core/src/application/storage/collectOrphanMedia.ts`, `packages/core/src/application/workers/scopeTaskRunner.ts`, `packages/core/src/application/cleanup/participants.ts`
- **台帳 ID:** UC-note-020, UC-note-021, UC-note-022, UC-storage-010 / TC-note-098〜115, TC-note-340〜347, TC-note-067〜082, TC-storage-016〜029
- **spec:** `spec/usecases/note.md#emptyTrash` / `#purgeExpiredTrash` / `#deleteNotesForOwner`, `spec/usecases/storage.md#collectOrphanMedia`, `spec/platform/index.md` の「実行予算と分割単位」, [ADR 040](../../spec/adr/040-continuation-transport.md) / [ADR 041](../../spec/adr/041-deterministic-continuation-event-id.md)
- **変更内容:** 4 ユースケースと、それらが要求する scope task kind の定義・登録。`emptyTrash` の 50 件以下は `purgeNote` の合成、51 件以上のジョブ登録経路は adr.md ADR-002 に従う。`deleteNotesForOwner` は `deleteFilesByOwner.ts` の継続ターンが参考実装
- **理由:** ED-10 の残り（保持期限・ゴミ箱を空にする）と、退会・ワークスペース削除への追随

### 10. P-12 ノート編集ページ

- **対象ファイル:** `apps/web/app/routes/notes/new.tsx`, `apps/web/app/routes/notes/$noteId.edit.tsx`, `apps/web/app/routes/workspaces/$workspaceId/notes/new.tsx`, `apps/web/app/routes/workspaces/$workspaceId/notes/$noteId.edit.tsx`, `apps/web/app/routes/notes/-action.tsx`, `apps/web/app/routes/workspaces/$workspaceId/-action.tsx`, `apps/web/app/components/note/NoteEditor/`（3 モード・モード切替・自動保存状態・メディア挿入・版一覧・破棄）
- **台帳 ID:** PAGE-p12-001〜008
- **spec:** `spec/pages/index.md#P-12: ノート編集`（機能表・状態表）, `spec/pages/index.md#URL の割り当て`, `spec/scenario/editing.md#ED-02`〜`#ED-06` / `#ED-08`, `spec/design/index.md`, `spec/design/tokens.md`, `docs/frontend_implementation_example.md`
- **変更内容:** 状態表の全状態（新規未保存 / 読み込み中 / 編集中 / 保存中・保存済み・未保存 / 保存失敗 / 復元の提案 / WYSIWYG 警告 / サニタイズ通知 / 競合 / 処理中で編集できない / 権限喪失 / メディアアップロード中・失敗 / ビジュアル不可）を持つ。ミューテーションは `CLAUDE.md`「Frontend」の三層で、`version` は編集画面の所有者側が握る。モードの既定は端末に保持しサーバーへ永続化しない
- **文脈:** 個人とワークスペースの 2 本ずつ計 4 ルートを、上記「2 文脈のルートが 1 つの画面を共有する形」に従って作る。`NoteEditor` は文脈プロップ（既定は個人）だけを受け、URL からは読まない。断片 server function は `renderNoteEditor` / `renderWorkspaceNoteEditor` の 2 本、保存・自動保存・メディア挿入・版の復元・破棄のミューテーションは `noteId` で対象が定まるので `routes/notes/-action.tsx` の 1 本を両文脈で共有する。`/notes/new` 相当のワークスペース版は作成先スコープを URL から取り、既存の `CreateNoteButton` の `workspaceId` プロップと同じ渡し方に合わせる。編集画面はノート 1 件だけを扱うので、詳細と同じくワークスペース自身は読まない（認可は usecase 側、失敗は `NOTE_NOT_FOUND` へ収斂 — TC-28 手順 3 の「URL を直接開くと見つからない」はこの経路）
- **注意:** TanStack のファイルベースルーティングで `new.tsx` は `$noteId.tsx` と同階層に置くと静的セグメントが優先される。既存の `routes/notes/$noteId.tsx` / `routes/workspaces/$workspaceId/notes/$noteId.tsx` と衝突しない命名（`$noteId.edit.tsx`）を守る
- **理由:** ED-02〜ED-06 / ED-08 の唯一の入口

### 11. P-11 のタイトル編集・表示スタイル・削除導線と P-14 ゴミ箱ページ

- **対象ファイル:** `apps/web/app/components/note/NoteDetail/`, `apps/web/app/routes/notes/trash.tsx`, `apps/web/app/routes/workspaces/$workspaceId/notes/trash.tsx`, `apps/web/app/routes/workspaces/$workspaceId/-action.tsx`, `apps/web/app/components/note/TrashList/`
- **台帳 ID:** PAGE-p11-002, PAGE-p14-001〜004
- **spec:** `spec/pages/index.md#P-11: ノート詳細`, `#P-14: ゴミ箱`, `spec/scenario/editing.md#ED-07` / `#ED-09` / `#ED-10` / `#ED-11`
- **変更内容:** P-11 にはタイトルのインライン編集と、本スライスが担うメニュー項目（編集・表示スタイル・削除）を、既存の `NoteDetail/menu.tsx`（いまは「移動」だけ）に足す — タグ / 共有 / ダウンロード / 再生成は他スライスの持ち分なので出さない。P-14 は一覧・残り日数・復元・完全削除・ゴミ箱を空にする（`mode` による文言分岐）・空状態・権限なしを持つ。削除直後の「元に戻す」は一覧を握る島が所有する（楽観的な除去がリーフを unmount するため、`CLAUDE.md`「Frontend」の所有権の規則）
- **文脈:** P-11 は既存の `NoteDetail` が両文脈で共有済みなので、足すのはメニュー項目とタイトル編集だけ（`noteId` で対象が定まるミューテーションなので server function は 1 本を共有）。P-14 は `/notes/trash` と `/workspaces/:workspaceId/notes/trash` の 2 ルートを作り、`TrashList` を文脈プロップで共有する。ゴミ箱はワークスペース側で**書き込み可否がシェルと表示の両方に効く**ので、一覧型と同じく `getWorkspaceSettings` を読み、`WorkspaceRole.atLeast(role, "editor")` で判定する（`spec/pages/index.md` の L-01「viewer にゴミ箱を出さない」と TC-32）。失敗時の `foldScopeSelectionForUnavailable` → `workspaceUnavailability` の畳み方も一覧と同じにする。スコープトークン（`components/layout/ScopeToken`）のゴミ箱への導線も、権限で使えないときは並べずに消す
- **理由:** ED-07 / ED-09 / ED-10 / ED-11

### 12. 検証と手順書の同期

- **対象ファイル:** `spec/manual-tests/editing.md`、`packages/core/src/application/cleanup/participants.ts`、各ポートの JSDoc
- **変更内容:** `pnpm typecheck && pnpm lint:fix && pnpm format` と `pnpm test`（両プロジェクト）を通す。`spec/manual-tests/editing.md` の TC-04〜TC-34 を実機で走らせ、手順・期待結果が実装とずれた箇所を更新する。ステップ 1〜9 で書き換え忘れた「後続スライスで追加する」旨の JSDoc と `absent(...)` 宣言を洗い出して現状に合わせる
- **理由:** Issue #7「検証」と、手順書 / 宣言の stale が後続スライスの判断を誤らせるため
