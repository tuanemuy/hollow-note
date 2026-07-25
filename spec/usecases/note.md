# ユースケース: Note

ドメインの詳細は [domains/note.md](../domains/note.md)。共通の約束は [usecases/identity.md](./identity.md) の冒頭と同じ。

## 共通: 閲覧者コンテキストの解決

ノートに触れるすべてのユースケースは、先頭で次を行う。

1. `NoteId.create(input.noteId)` を構築する
2. `NoteRepository.findById` で引く。不在なら `NotFoundError("NOTE_NOT_FOUND")`
3. ノートの所有者がワークスペースなら `resolveWorkspaceAccess`（Workspace）でロールを引き、`NoteViewer` を組み立てる
4. `NoteAccessPolicy.evaluate(note, viewer, credential, now)` を呼び、必要な権限がなければ `NotFoundError("NOTE_NOT_FOUND")`（存在を漏らさない）

以下の各ユースケースでは、この手順を「閲覧者コンテキストを解決する」と記す。

## createBlankNote

### 概要

白紙のノートを作る（ED-01）。

### 入力DTO

| フィールド | 型 | 必須 | バリデーション |
| --- | --- | --- | --- |
| `userId` | `string` | ○ | — |
| `ownerType` | `"user" \| "workspace"` | ○ | 既知の値 |
| `ownerWorkspaceId` | `string \| null` | — | `ownerType === "workspace"` のとき必須 |
| `title` | `string \| null` | — | `NoteTitle` の規則 |

### 出力DTO

`noteId`, `title`, `ownerType`, `ownerId`, `visibility`, `styleMode`, `createdAt`

### 処理フロー

1. `NoteOwner` を組み立てる。ワークスペースなら `WorkspaceAuthorization.ensureCan(role, "createNote")`
2. `title` が空なら `NoteTitle.auto("無題")`、指定があれば `NoteTitle.manual(title)`
3. `Note.createBlank` を作り、`UnitOfWorkProvider.run` で保存してイベントを収集する

### エラーケース

| 条件 | 種類 |
| --- | --- |
| ワークスペースの権限不足 | `BusinessRuleError(InsufficientRole)` |
| ワークスペース不在 | `NotFoundError("WORKSPACE_NOT_FOUND")` |
| タイトルの違反 | `BusinessRuleError(InvalidTitle)` |

## getNote

### 概要

ノート詳細を表示するために、ノート本体と権限を引く（OR-11）。

### 入力DTO

`noteId: string`, `userId: string | null`

### 出力DTO

| フィールド | 型 |
| --- | --- |
| `noteId` | `string` |
| `title` | `string` |
| `content` | `{ status: "processing" \| "awaitingIntegration" \| "failed" \| "ready"; html: string \| null; failureReason: string \| null }` |
| `styleMode` | `"default" \| "preserve"` |
| `visibility` | `"private" \| "unlisted" \| "public"` |
| `hasSharePassword` | `boolean` |
| `shareUrl` | `string \| null` |
| `ownerType`, `ownerId` | `string` |
| `createdBy` | `string` |
| `sourceFileId` | `string \| null` |
| `headings` | `{ level: number; text: string; anchorId: string }[]` |
| `permissions` | `{ canEdit: boolean; canDelete: boolean; canChangeVisibility: boolean }` |
| `createdAt`, `updatedAt` | `Date` |

### 処理フロー

1. 閲覧者コンテキストを解決する
2. `content.status === "ready"` なら `content.headings` をそのまま射影に含める（保存時に算出済み）
3. `shareUrl` は `canChangeVisibility` が真の閲覧者にのみ含める

### エラーケース

| 条件 | 種類 |
| --- | --- |
| 不在・権限なし・ゴミ箱（他人） | `NotFoundError("NOTE_NOT_FOUND")` |

## getSharedNote

### 概要

共有リンクからノートを引く（SH-05 / SH-06）。

### 入力DTO

`shareToken: string`, `userId: string | null`, `pass: { tokenHash: string; passwordUpdatedAt: Date; issuedAt: Date } | null`

### 出力DTO

`getNote` と同じ形に加えて `passwordRequired: boolean`。

### 処理フロー

1. `SecureTokenGenerator.hashOf(shareToken)` を求め、`NoteRepository.findByShareToken` で引く。不在なら `NotFoundError("NOTE_NOT_FOUND")`
2. `ShareCredential` を組み立てる
3. `NoteAccessPolicy.evaluate` を呼ぶ
   - `passwordRequired` → 本文もタイトルも含めず `passwordRequired: true` だけを返す
   - `denied` → `NotFoundError("NOTE_NOT_FOUND")`
   - `granted` → 射影を返す
4. サインイン済みで編集権限を持つ場合は `permissions.canEdit` を真にする

### エラーケース

| 条件 | 種類 |
| --- | --- |
| トークン不在・再発行済み・非公開化・削除 | `NotFoundError("NOTE_NOT_FOUND")`（区別しない） |

## verifySharePassword

### 概要

共有リンクのパスワードを照合し、通過証を発行する（SH-06）。

### 入力DTO

`shareToken: string`, `password: string`, `clientKey: string`

### 出力DTO

`pass: { tokenHash: string; passwordUpdatedAt: Date; issuedAt: Date }`

### 処理フロー

1. レート制限を `LoginThrottlePolicy` と同じ規則で判定する
2. トークンで引き、限定公開かつパスワードが設定されていることを確認する
3. `PasswordHasher.verify` が偽なら失敗を記録して `ValidationError("INVALID_SHARE_PASSWORD")`
4. `NoteAccessPolicy.issuePass(shareLink, now)` の結果を返す

### エラーケース

| 条件 | 種類 |
| --- | --- |
| パスワード相違 | `ValidationError("INVALID_SHARE_PASSWORD")` |
| 連続失敗 | `ValidationError("RATE_LIMITED")` |
| トークン不在・パスワード未設定 | `NotFoundError("NOTE_NOT_FOUND")` |

## getPublicNote

### 概要

公開ノートを誰でも読める形で引く（SH-07 / DS-06）。

### 入力DTO

`noteId: string`, `userId: string | null`

### 出力DTO

`getNote` と同じ形に加えて、著者（`handle` / `displayName` / `avatarUrl`）とワークスペース（`slug` / `name`）、メタ情報（`description`, `canonicalUrl`）。

### 処理フロー

1. `NoteRepository.findById` で引く。不在または `lifecycle !== "active"` または `visibility.status !== "public"` なら、削除済みかどうかを区別して `NotFoundError("NOTE_NOT_FOUND")` または `NotFoundError("NOTE_GONE")` を返す（後者は検索エンジンへのインデックス削除に使う）
2. 著者を `getPublicProfile` 相当で、ワークスペースを `getPublicWorkspace` 相当で解決する
3. `description` は `excerpt` から生成する

### エラーケース

| 条件 | 種類 |
| --- | --- |
| 非公開・不在 | `NotFoundError("NOTE_NOT_FOUND")` |
| かつて公開されていて削除された | `NotFoundError("NOTE_GONE")` |

## searchNotes

### 概要

現在の文脈のノートを検索・絞り込みして一覧する（OR-01〜OR-05, OR-10）。

### 入力DTO

| フィールド | 型 | 必須 | バリデーション |
| --- | --- | --- | --- |
| `userId` | `string` | ○ | — |
| `ownerType` | `"user" \| "workspace"` | ○ | 既知の値 |
| `ownerWorkspaceId` | `string \| null` | — | — |
| `lifecycle` | `"active" \| "trashed"` | ○ | 既定は `active` |
| `keyword` | `string \| null` | — | 2 文字未満は `null` に落とす |
| `tagNames` | `string[]` | — | 各 50 文字以内、最大 10 件 |
| `month` | `{ year: number; month: number } \| null` | — | `month` は 1〜12 |
| `timeZone` | `string` | ○ | 不正な値は `"UTC"` に落とす |
| `sort` | `NoteSortKey` | ○ | 既定は `keyword` があれば `relevance`、なければ `updatedDesc` |
| `page`, `limit` | `number` | ○ | `limit` は 1〜100 |

### 出力DTO

`items: NoteSummary[]`, `count: number`

### 処理フロー

1. `NoteOwner` を組み立て、ワークスペースなら `viewNote`（`lifecycle === "trashed"` なら `viewTrash`）の権限を確認する
2. `month` があれば `TimeZoneResolver.monthRange` で `DateRange` に解決する
3. `NoteQueryService.search` を呼ぶ

### エラーケース

| 条件 | 種類 |
| --- | --- |
| 非メンバー・権限不足 | `BusinessRuleError(InsufficientRole)` |
| 検索のタイムアウト | `SystemError(TimeoutError)` |
| ページング値の範囲外 | `ValidationError("INVALID_PAGINATION")` |

## searchPublicNotes

### 概要

全利用者の公開ノートを横断して検索する（DS-05）。公開ページ内の検索にも使う（DS-04 / WS-09）。

### 入力DTO

`keyword: string | null`, `tagNames: string[]`, `ownerHandle: string | null`, `workspaceSlug: string | null`, `from: Date | null`, `to: Date | null`, `page`, `limit`

### 出力DTO

`items: PublicNoteSummary[]`, `count: number`

### 処理フロー

1. `ownerHandle` があれば利用者を、`workspaceSlug` があれば公開ワークスペースを解決して `ownerFilter` を組み立てる
2. `NoteQueryService.searchPublic` を呼ぶ

### エラーケース

| 条件 | 種類 |
| --- | --- |
| ハンドル・スラッグの不在 | `NotFoundError("OWNER_NOT_FOUND")` |
| 検索語が 2 文字未満かつタグも期間も未指定 | `ValidationError("QUERY_TOO_SHORT")` |
| レート制限 | `ValidationError("RATE_LIMITED")` |

## countNotesByCreationDate

### 概要

ノートが存在する月の一覧と、指定した期間の日ごとの作成件数を引く（OR-02 のカレンダー表示と OR-05 の月セレクターが使う）。

### 入力DTO

`userId`, `ownerType`, `ownerWorkspaceId`, `month: { year; month }`, `timeZone: string`

### 出力DTO

`availableMonths: { year; month }[]`, `days: { day: string; count: number }[]`

### 処理フロー

1. 権限を `viewNote` で確認する
2. `TimeZoneResolver.monthRange` で範囲を解決する
3. `NoteQueryService.listMonthsWithNotes` と `countByDay` を呼ぶ

### エラーケース

`searchNotes` と同じ。

## updateNoteBody

### 概要

HTML / WYSIWYG エディタからの保存を適用する（ED-03 / ED-04 / ED-08）。

### 入力DTO

| フィールド | 型 | 必須 | バリデーション |
| --- | --- | --- | --- |
| `noteId`, `userId` | `string` | ○ | — |
| `rawHtml` | `string` | ○ | 2 MB 以内（サニタイズ前） |
| `expectedVersion` | `number` | ○ | 楽観ロックのために必須 |
| `reason` | `"manualEdit" \| "wysiwygConversion"` | ○ | 版の記録理由 |
| `importReferences` | `boolean` | — | 新規の外部参照を取り込むか |

### 出力DTO

`noteId`, `version`, `removed: { kind; name; reason }[]`, `referenceImportJobId: string | null`

### 処理フロー

1. 閲覧者コンテキストを解決し、`canEdit` を確認する。`TrashedNote` なら `BusinessRuleError(NoteIsTrashed)`
2. `HtmlProcessor.process(rawHtml)` を呼ぶ
3. 現在の本文が `ready` なら `NoteRevision.capture(reason)` を作る
4. `Note.updateBody` を適用する
5. `UnitOfWorkProvider.run` で版とノートを保存し、イベントを収集する
6. `NoteRevisionRepository.deleteOlderThanNewest(noteId, 20)` を呼ぶ
7. `importReferences` が真なら、`HtmlProcessor.extractExternalReferences` の結果が空でない場合に限り参照取り込みジョブを登録する

### エラーケース

| 条件 | 種類 |
| --- | --- |
| 権限なし | `NotFoundError("NOTE_NOT_FOUND")` |
| ゴミ箱のノート | `BusinessRuleError(NoteIsTrashed)` |
| サニタイズ後が 1 MB 超 | `BusinessRuleError(ContentTooLarge)` |
| 版の競合（他者が更新） | `ConflictError("OPTIMISTIC_LOCK_FAILURE")` |

## applyTextNodeEdits

### 概要

ビジュアルエディタの編集を、構造を保ったまま適用する（ED-02）。

### 入力DTO

`noteId`, `userId`, `edits: { path: string; expected: string; text: string }[]`, `expectedVersion: number`

### 出力DTO

`noteId`, `version`, `skipped: { path: string; reason: string }[]`

### 処理フロー

1. 閲覧者コンテキストを解決し、`canEdit` を確認する
2. 現在の本文が `ready` でなければ `BusinessRuleError(CannotCaptureEmptyContent)`
3. `HtmlProcessor.editTextNodes(html, edits)` を呼ぶ
4. `NoteRevision.capture("manualEdit")` を作る
5. `Note.updateBody` を適用して保存する

### エラーケース

`updateNoteBody` と同じ。加えて、すべての編集が `skipped` になった場合も成功として返す（版は作らない）。

## renameNote

### 概要

タイトルを変更する（ED-07）。

### 入力DTO

`noteId`, `userId`, `title: string`, `expectedVersion: number`

### 出力DTO

`noteId`, `title`, `version`

### 処理フロー

1. 閲覧者コンテキストを解決し、`canEdit` を確認する
2. `Note.rename` を適用して保存する（由来は `manual`）

### エラーケース

| 条件 | 種類 |
| --- | --- |
| 権限なし | `NotFoundError("NOTE_NOT_FOUND")` |
| 200 文字超 | `BusinessRuleError(InvalidTitle)` |
| 版の競合 | `ConflictError("OPTIMISTIC_LOCK_FAILURE")` |

## changeNoteStyleMode

### 概要

既定スタイルの適用を切り替える（ED-11）。

### 入力DTO

`noteId`, `userId`, `styleMode: "default" | "preserve"`, `expectedVersion: number`

### 出力DTO

`noteId`, `styleMode`, `version`

### 処理フロー

1. 閲覧者コンテキストを解決し、`canEdit` を確認する
2. `Note.changeStyleMode` を適用して保存する

### エラーケース

| 条件 | 種類 |
| --- | --- |
| 未知の値 | `BusinessRuleError(InvalidStyleMode)` |
| 権限なし | `NotFoundError("NOTE_NOT_FOUND")` |

## moveNote

### 概要

ノートの所属先を移す（OR-12）。

### 入力DTO

`noteId`, `userId`, `targetOwnerType: "user" | "workspace"`, `targetWorkspaceId: string | null`, `expectedVersion: number`

### 出力DTO

`noteId`, `ownerType`, `ownerId`, `droppedTagNames: string[]`, `version`

### 処理フロー

1. 閲覧者コンテキストを解決し、`canEdit` を確認する
2. 移動先の `NoteOwner` を組み立て、ワークスペースなら `createNote` の権限を確認する
3. `NoteOwnershipPolicy.ensureMovable` を呼ぶ
4. `Note.moveTo` を適用する
5. `UnitOfWorkProvider.run` でノートを保存し、`note.moved` を収集する
6. `note.moved` の購読者が後続を担う
   - Tag の `relocateAssignmentsForNote` — タグの付け替え
   - Storage の `relocateFilesForNote` — 保管ファイルの所有者の付け替え
   - Usage の `applyStorageDelta` — ノート件数の付け替え

   外れるタグ名は移動前に `TagRelocationPolicy.plan` で算出して応答に含める

### エラーケース

| 条件 | 種類 |
| --- | --- |
| 移動元・移動先の権限不足 | `BusinessRuleError(AccessDenied)` / `BusinessRuleError(InsufficientRole)` |
| 変換処理中 | `BusinessRuleError(CannotMoveWhileProcessing)` |
| 移動先が同じ | 変更もイベントもなく成功として返す |
| 版の競合 | `ConflictError("OPTIMISTIC_LOCK_FAILURE")` |

## changeNoteVisibility

### 概要

公開ステータスを変更する（SH-01 / SH-02）。

### 入力DTO

`noteId`, `userId`, `visibility: "private" | "unlisted" | "public"`, `expectedVersion: number`

### 出力DTO

`noteId`, `visibility`, `shareUrl: string | null`, `hasSharePassword: boolean`, `version`

### 処理フロー

1. 閲覧者コンテキストを解決し、`canChangeVisibility` を確認する
2. `public` に変える場合、`UserRepository.findById(createdBy)`（個人所有）または所有ワークスペースを調べ、公開ハンドル／スラッグが未設定なら `ValidationError("PUBLIC_HANDLE_REQUIRED")`
3. `unlisted` に変えるとき、休眠リンクがなければ `SecureTokenGenerator.issue` で新しい `ShareLink` を作る
4. `Note.makePrivate` / `makeUnlisted` / `makePublic` を適用して保存する

### エラーケース

| 条件 | 種類 |
| --- | --- |
| 本文が空 | `BusinessRuleError(CannotPublishEmptyNote)` |
| 公開ハンドル未設定 | `ValidationError("PUBLIC_HANDLE_REQUIRED")` |
| 権限なし | `NotFoundError("NOTE_NOT_FOUND")` |
| 版の競合 | `ConflictError("OPTIMISTIC_LOCK_FAILURE")` |

## setSharePassword

### 概要

共有リンクのパスワードを設定・変更・解除する（SH-03）。

### 入力DTO

`noteId`, `userId`, `password: string | null`, `expectedVersion: number`

### 出力DTO

`noteId`, `hasSharePassword`, `version`

### 処理フロー

1. 閲覧者コンテキストを解決し、`canChangeVisibility` を確認する
2. `password` が非 `null` なら `PlainPassword.create` と `PasswordHasher.hash` を実行する
3. `Note.setSharePassword` を適用して保存する

### エラーケース

| 条件 | 種類 |
| --- | --- |
| 限定公開でない | `BusinessRuleError(NotUnlisted)` |
| パスワード強度の違反 | `BusinessRuleError(WeakPassword)` |

## reissueShareLink

### 概要

共有リンクを再発行して古いリンクを無効にする（SH-04）。

### 入力DTO

`noteId`, `userId`, `expectedVersion: number`

### 出力DTO

`noteId`, `shareUrl`, `version`

### 処理フロー

1. 閲覧者コンテキストを解決し、`canChangeVisibility` を確認する
2. `SecureTokenGenerator.issue` で新しいトークンを作る
3. `Note.reissueShareLink` を適用して保存する

### エラーケース

| 条件 | 種類 |
| --- | --- |
| 限定公開でない | `BusinessRuleError(NotUnlisted)` |
| 権限なし | `NotFoundError("NOTE_NOT_FOUND")` |

## trashNote

### 概要

ノートをゴミ箱に移す（ED-09）。

### 入力DTO

`noteId`, `userId`, `expectedVersion: number`

### 出力DTO

`noteId`, `trashedAt`, `purgeAfter`

### 処理フロー

1. 閲覧者コンテキストを解決し、`canDelete` を確認する
2. `JobRepository.listActiveByTarget({ type: "note", noteId })` を引き、あればすべて `Job.cancel` する
3. `Note.trash` を適用して保存し、イベントを収集する

### エラーケース

| 条件 | 種類 |
| --- | --- |
| 権限なし | `NotFoundError("NOTE_NOT_FOUND")` |
| 既にゴミ箱 | 変更なしで成功として返す |
| 版の競合 | `ConflictError("OPTIMISTIC_LOCK_FAILURE")` |

## restoreNote

### 概要

ゴミ箱のノートを元に戻す（ED-10）。

### 入力DTO

`noteId`, `userId`, `expectedVersion: number`

### 出力DTO

`noteId`, `visibility`

### 処理フロー

1. 閲覧者コンテキストを解決し、`canDelete` を確認する
2. `Note.restore` を適用して保存し、イベントを収集する

### エラーケース

| 条件 | 種類 |
| --- | --- |
| ゴミ箱にない | `ValidationError("NOTE_NOT_TRASHED")` |
| 権限なし | `NotFoundError("NOTE_NOT_FOUND")` |

## purgeNote

### 概要

ノートを完全に削除する（ED-10）。

### 入力DTO

`noteId`, `userId`, `expectedVersion: number`

### 出力DTO

なし。

### 処理フロー

1. 閲覧者コンテキストを解決し、`canDelete` を確認する
2. ゴミ箱にない場合は `ValidationError("NOTE_NOT_TRASHED")`
3. `UnitOfWorkProvider.run` でノートを削除し、`NoteEvents.purged` を収集する
4. 版・タグ付与・保管ファイル・バックアップ記録・読み取りモデルは `note.purged` を購読するワーカーが削除する

### エラーケース

`restoreNote` と同じ。

## emptyTrash

### 概要

現在の文脈のゴミ箱をすべて完全削除する（ED-10）。

### 入力DTO

`userId`, `ownerType`, `ownerWorkspaceId`

### 出力DTO

`purgedCount: number`

### 処理フロー

1. 権限を `deleteNote`（ワークスペースの場合）で確認する
2. `NoteRepository.listByOwner` でゴミ箱のノートを取り、500 件ずつ `purgeNote` と同じ手順で削除する
3. 500 件を超える場合は `requestBulkNoteOperation` の `{ kind: "purge" }` として一括削除ジョブを登録し、`purgedCount` に登録件数を返す

### エラーケース

| 条件 | 種類 |
| --- | --- |
| 権限不足 | `BusinessRuleError(InsufficientRole)` |

## purgeExpiredTrash

### 概要

保持期限を過ぎたゴミ箱のノートを回収する。定期ワーカーから呼ばれる。

### 入力DTO

`limit: number`

### 出力DTO

`purgedCount: number`

### 処理フロー

1. `NoteRepository.listPurgeable(now, limit)` を引く
2. 1 件ずつ `UnitOfWorkProvider.run` で削除し、`note.purged` を収集する。1 件の失敗は他に影響させない

### エラーケース

| 条件 | 種類 |
| --- | --- |
| 個々の削除の失敗 | 記録して継続 |

## listNoteRevisions

### 概要

版の一覧を引く（ED-08）。

### 入力DTO

`noteId`, `userId`

### 出力DTO

`revisions: { revisionId; createdAt; createdBy; createdByName; reason; excerpt }[]`

### 処理フロー

1. 閲覧者コンテキストを解決し、`canEdit` を確認する
2. `NoteRevisionRepository.listByNote(noteId, 20)` を引く
3. 作成者の表示名を `UserRepository.listByIds` で解決する

### エラーケース

| 条件 | 種類 |
| --- | --- |
| 権限なし | `NotFoundError("NOTE_NOT_FOUND")` |

## restoreNoteRevision

### 概要

過去の版に本文を戻す（ED-04 / IM-06 の「元に戻す」）。

### 入力DTO

`noteId`, `userId`, `revisionId`, `expectedVersion: number`

### 出力DTO

`noteId`, `version`

### 処理フロー

1. 閲覧者コンテキストを解決し、`canEdit` を確認する
2. `NoteRevisionRepository.findById` を引き、`noteId` の一致を確認する
3. 現在の本文から `NoteRevision.capture("restore")` を作る
4. 版の HTML・タイトル・スタイルで `Note.updateBody` と `Note.changeStyleMode`、必要なら `Note.rename` を適用して保存する

### エラーケース

| 条件 | 種類 |
| --- | --- |
| 版が不在・他ノートのもの | `NotFoundError("REVISION_NOT_FOUND")` |
| 権限なし | `NotFoundError("NOTE_NOT_FOUND")` |
| 版の競合 | `ConflictError("OPTIMISTIC_LOCK_FAILURE")` |

## exportNote

### 概要

ノートを 1 件ダウンロードする（EX-01 / EX-04）。所有者からも閲覧者からも呼ばれる。

### 入力DTO

| フィールド | 型 | 必須 | バリデーション |
| --- | --- | --- | --- |
| `noteId` | `string \| null` | — | 所有者・公開ページからの要求 |
| `shareToken` | `string \| null` | — | 共有リンクからの要求 |
| `userId` | `string \| null` | — | サインイン中なら指定 |
| `pass` | `SharePass \| null` | — | パスワード通過証 |
| `format` | `"html" \| "markdown" \| "pdf"` | ○ | 既知の値 |

`noteId` と `shareToken` はどちらか一方が必須。

### 出力DTO

| フィールド | 型 |
| --- | --- |
| `kind` | `"immediate" \| "job"` |
| `fileName` | `string` |
| `mimeType` | `string` |
| `body` | `Uint8Array \| null`（`kind === "immediate"` のとき） |
| `jobId` | `string \| null`（`kind === "job"` のとき） |

### 処理フロー

1. `shareToken` があれば `NoteRepository.findByShareToken`、なければ `findById` で引く
2. 閲覧者コンテキストを解決し、`granted` でなければ `NotFoundError("NOTE_NOT_FOUND")`。`passwordRequired` なら `ValidationError("SHARE_PASSWORD_REQUIRED")`
3. 本文が `ready` でなければ `ValidationError("NOTE_CONTENT_NOT_READY")`
4. `format` による分岐
   - `html` → `NoteExportComposer.composeSelfContainedHtml` で 1 ファイルにまとめて即時に返す。`resolveAsset` はサービス内のストレージを指す参照だけを解決する。`styleMode === "default"` のときだけ既定スタイルを埋め込む。解決できなかった参照は元の URL のまま残す
   - `markdown` → `MarkdownRenderer.toMarkdown(html)` の結果を即時に返す
   - `pdf` → 既存の生成物（`purpose: "artifact"`、期限内、同じノートの同じ版）があればその `fileId` を返す。なければ `Job.enqueue(kind: "pdfExport")` を登録して `jobId` を返す
5. ファイル名は `NoteTitle` から生成し、使えない文字を置き換える。空になればノート ID を使う

### エラーケース

| 条件 | 種類 |
| --- | --- |
| 不在・権限なし | `NotFoundError("NOTE_NOT_FOUND")` |
| パスワード未通過 | `ValidationError("SHARE_PASSWORD_REQUIRED")` |
| 本文が空（処理中・要 LLM 連携・失敗） | `ValidationError("NOTE_CONTENT_NOT_READY")` |
| 閲覧者からの要求のレート制限 | `ValidationError("RATE_LIMITED")` |

## runNoteExport

### 概要

PDF 生成ジョブの本体（EX-01）。ジョブワーカーから呼ばれる。

### 入力DTO

`jobId`, `noteId`

### 出力DTO

`fileId`, `expiresAt`

### 処理フロー

1. ジョブを引き、終端状態なら何もせず返す。`Job.start` を保存する
2. ノートを引く。不在・本文が `ready` でなければ `Job.fail("targetMissing")`
3. `PdfRenderer.render`（新設のポート、Note ドメイン）で本文を PDF にする。`styleMode` に従ってスタイルを当てる
4. `ObjectStorage.put` と `StoredFile.registerEphemeral(ttl: 24 時間)` で保管する
5. `Job.succeed(artifact)` を保存する

### エラーケース

| 条件 | 種類 |
| --- | --- |
| ノート不在・本文が空 | `Job.fail("targetMissing")` |
| 描画の失敗・タイムアウト | `Job.fail("unknown")` / `Job.fail("timeout")` |
| 保管の失敗 | `Job.fail("storageError")` |

## requestBulkExport

### 概要

複数のノートをまとめてダウンロードするジョブを登録する（EX-02）。

### 入力DTO

`userId`, `noteIds: string[]`, `format: "html" | "markdown" | "pdf"`

### 出力DTO

`jobId`, `targetCount: number`, `skipped: number`

### 処理フロー

1. 件数が 500 を超えれば `ValidationError("TOO_MANY_TARGETS")`
2. `NoteRepository.listByIds` で引き、閲覧できるものだけに絞る。本文が `ready` でないものは対象から外して `skipped` に数える
3. 合計サイズの見積もりが 1 GB を超えれば `ValidationError("EXPORT_TOO_LARGE")`
4. `JobConcurrencyPolicy.ensureBulkExportSlot(runningBulkExports)` を呼ぶ
5. `Job.enqueueBatch(kind: "bulkExport", total)` と、対象ごとの子ジョブを作って保存する

### エラーケース

| 条件 | 種類 |
| --- | --- |
| 件数・サイズの上限超過 | `ValidationError("TOO_MANY_TARGETS")` / `ValidationError("EXPORT_TOO_LARGE")` |
| 対象が 0 件 | `ValidationError("NO_EXPORTABLE_TARGET")` |
| 一括ダウンロードが既に実行中 | `BusinessRuleError(BulkExportInProgress)` |

## runBulkExport

### 概要

一括ダウンロードの親ジョブが、すべての子の完了後に ZIP を組み立てる（EX-02 / EX-03）。

### 入力DTO

`parentJobId`

### 出力DTO

`fileId`, `expiresAt`, `includedCount`, `failedCount`

### 処理フロー

1. 親ジョブを引き、`summarizeChildren` で全件が終端であることを確認する。未完了なら何もせず返す
2. 成功した子の生成物を集め、ZIP に詰める。ファイル名が重複する場合は連番を付ける
3. 失敗した対象の一覧をテキストとして同梱する
4. `ObjectStorage.put` と `StoredFile.registerEphemeral(ttl: 7 日)` で保管する
5. `Job.succeed(artifact)` を保存する
6. 実行中に削除されたノートは除外して続行する

### エラーケース

| 条件 | 種類 |
| --- | --- |
| 成功した子が 0 件 | `Job.fail("unknown")` |
| ZIP 生成・保管の失敗 | `Job.fail("storageError")` |

## requestBulkNoteOperation

### 概要

複数のノートに対する一括操作を登録する（OR-09）。タグ・公開ステータス・移動・削除を扱う。

### 入力DTO

| フィールド | 型 | 必須 | バリデーション |
| --- | --- | --- | --- |
| `userId` | `string` | ○ | — |
| `noteIds` | `string[]` | ○ | 1〜500 件 |
| `operation` | `BulkOperation` | ○ | 下記の判別ユニオン |

```
BulkOperation =
  | { kind: "addTag"; tagName: string }
  | { kind: "removeTag"; tagName: string }
  | { kind: "changeVisibility"; visibility: "private" | "unlisted" | "public" }
  | { kind: "move"; targetOwnerType: "user" | "workspace"; targetWorkspaceId: string | null }
  | { kind: "trash" }
  | { kind: "purge" }        // ゴミ箱の完全削除。emptyTrash が 500 件を超える場合に使う
```

### 出力DTO

`jobId`, `targetCount: number`, `skipped: { noteId: string; reason: string }[]`, `warnings: string[]`

### 処理フロー

1. 件数の上限を確認する
2. `NoteRepository.listByIds` で引き、操作に必要な権限（`canEdit` / `canChangeVisibility` / `canDelete`）を持つものだけに絞る。外れたものは `skipped` に積む
3. 操作ごとの事前検査を行う
   - `changeVisibility: "public"` → 公開ハンドル／スラッグが未設定なら全体を中止して `ValidationError("PUBLIC_HANDLE_REQUIRED")`
   - `move` → 移動先の権限を確認し、移動で閲覧できなくなる利用者が出る場合と外れるタグがある場合を `warnings` に載せる
4. `Job.enqueueBatch(kind に対応するもの, total)` と対象ごとの子ジョブを作って保存する
5. 対象が 1 件だけの場合もジョブとして扱い、経路を 1 本にする

### エラーケース

| 条件 | 種類 |
| --- | --- |
| 件数の上限超過 | `ValidationError("TOO_MANY_TARGETS")` |
| 対象が 0 件（すべて権限外） | `BusinessRuleError(AccessDenied)` |
| 公開ハンドル未設定 | `ValidationError("PUBLIC_HANDLE_REQUIRED")` |
| 未知の操作 | `ValidationError("INVALID_OPERATION")` |

## runBulkNoteOperationItem

### 概要

一括操作の子ジョブ 1 件を実行する（OR-09）。ジョブワーカーから呼ばれる。

### 入力DTO

`jobId`, `noteId`, `operation: BulkOperation`

### 出力DTO

`outcome: "succeeded" | "failed"`, `failureReason: string | null`

### 処理フロー

1. ジョブを引き、終端状態なら何もせず返す。`Job.start` を保存する
2. ノートを引き、権限を再確認する。失っていれば `Job.fail("permissionRevoked")`
3. 操作に応じて `assignTag` / `unassignTag`（Tag）、`changeNoteVisibility`、`moveNote`、`trashNote`、`purgeNote` を呼ぶ
4. `Job.succeed` または `Job.fail` を保存する
5. 既に目的の状態になっている場合は成功として扱う（同じジョブを 2 回受け取っても結果が変わらない）

### エラーケース

| 条件 | 種類 |
| --- | --- |
| ノートが削除済み | `Job.fail("targetMissing")` |
| 権限を喪失 | `Job.fail("permissionRevoked")` |
| ドメインの規則違反（本文が空で公開など） | `Job.fail("unknown")`（理由を `detail` に記録） |
| 版の競合 | 1 度だけ読み直して再適用し、それでも競合すれば `Job.fail("unknown")` |

## listSitemapEntries

### 概要

サイトマップ用に公開ノートを列挙する（DS-06）。利用者とワークスペースの公開ページは `listPublicProfiles`（Identity）と `listPublicWorkspaces`（Workspace）が列挙する。

### 入力DTO

`cursor: string | null`, `limit: number`

### 出力DTO

`entries: { noteId; updatedAt }[]`, `nextCursor: string | null`

### 処理フロー

1. `NoteQueryService.listPublicSitemapEntries` を呼ぶ

### エラーケース

`SystemError(DatabaseError)`

## projectNoteChanges

### 概要

ドメインイベントを受け取って読み取りモデルを更新する（[ADR 009](../adr/009-read-models.md)）。イベント購読ワーカーから呼ばれる。

### 入力DTO

`event: NoteEvent | TagEvent | IdentityEvent | WorkspaceEvent`

### 出力DTO

なし。

### 処理フロー

1. イベントの種別で分岐する
   - Note の作成・更新・改名・公開変更・移動・ゴミ箱・復元 → `NoteRepository.findById` で現在の状態を読み、`NoteProjectionWriter.upsert` で上書きする
   - `note.purged` → `NoteProjectionWriter.remove`
   - `tag.assigned` / `tag.unassigned` → 対象ノートのタグ名を引き直して `updateTags`
   - `tag.renamed` / `tag.merged` / `tag.deleted` → そのタグが付いていたノートのタグ名を引き直して `updateTags`
   - `identity.user.handleChanged` とプロフィール更新 → `updateAuthor`
   - `workspace.created` / `slugChanged` / `published` / `unpublished` → `updateWorkspace`
2. 現在の状態を読んでから上書きするため、同じイベントを 2 回受け取っても結果は変わらない

### エラーケース

| 条件 | 種類 |
| --- | --- |
| 対象が既に削除済み | 何もせず成功として返す |
| 書き込みの失敗 | `SystemError(DatabaseError)`（再試行される） |

## rebuildNoteProjection

### 概要

読み取りモデルを書き込みモデルから作り直す。運用操作。

### 入力DTO

`ownerType: "user" | "workspace" | null`, `ownerId: string | null`, `batchSize: number`

### 出力DTO

`processedCount: number`

### 処理フロー

1. 対象の絞り込みに従って `NoteRepository.listByOwner` を順に読む
2. タグ名・著者・ワークスペースを解決して `NoteProjectionWriter.upsert` を呼ぶ

### エラーケース

| 条件 | 種類 |
| --- | --- |
| 個々の失敗 | 記録して継続 |
