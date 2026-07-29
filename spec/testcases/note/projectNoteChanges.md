# テストケース: projectNoteChanges

| 前提条件 | 操作 | 期待結果 | 実装ステータス |
|---|---|---|---|
| 個人所有のノートが作られた | `note.created` を処理する | 読み取りモデルに行が作られ、`created_by` の利用者から著者列（表示名・ハンドル）が最初から埋まる（ワークスペース列は `null`） | |
| ワークスペース所有のノートが作られた | `note.created` を処理する | 著者列に加えてワークスペース列（名前・スラッグ・公開状態）も最初から埋まる | |
| ノートがワークスペースへ移動された | `note.moved` を処理する | `NoteRepository.findById` で現在の状態を読み、`author`（`created_by` の利用者）と `workspace`（移動先の名前・スラッグ・公開状態）を解決し直して `upsert` する。所有者列とワークスペース列が更新され、著者列は `created_by` の利用者のまま保たれる | |
| ノートがワークスペースから個人へ移動された | `note.moved` を処理する | `workspace` が `null` として解決され、ワークスペース列が空になる（所有者列は個人になる） | |
| `note.moved` の投影 | payload との関係を確認する | payload の `previousOwner` / `currentOwner` をそのまま書かず、`findById` で読み直した現在の状態から著者・ワークスペースを解決して上書きする（配送順が入れ替わっても結果が変わらない） | |
| 本文が更新された | `note.contentUpdated` を処理する | 読み取りモデルのテキストと抜粋が更新される | |
| 変換が「要 LLM 連携」で止まった | `note.awaitingIntegration` を処理する | `NoteRepository.findById` で現在の状態を読んで `upsert` し、`content_status` が `awaitingIntegration` に更新される（購読しないと `processing` のまま残り、`countByContentStatus` を根拠とする `completeIntegrationOAuth` の「要 LLM 連携の N 件」が常に 0 件になる） | |
| 表示スタイルが切り替えられた | `note.styleModeChanged` を処理する | 同じく `upsert` で `style_mode` が更新される（購読しないと ED-11 の切り替えが一覧に反映されない） | |
| 変換に失敗した | `note.conversionFailed` を処理する | `content_status` が `failed` に更新される | |
| `content_status` / `style_mode` を変える振る舞い | 発行イベントを網羅する | `applyConversionResult` / `updateBody`（`note.contentUpdated`）、`markConversionFailed`（`note.conversionFailed`）、`markAwaitingIntegration`（`note.awaitingIntegration`）、`changeStyleMode`（`note.styleModeChanged`）のいずれかが発行され、1 つでも欠けると読み取りモデルが恒久的に古くなる | |
| ノートが公開された | `note.published` を処理する | 購読しない（`note.visibilityChanged` と必ず併発し、用途はサイトマップだけのため） | |
| 共有リンクが再発行された | `note.shareLinkReissued` を処理する | 購読しない（投影列を 1 つも変えない） | |
| 共有リンクのパスワードが変更された | `note.sharePasswordChanged` を処理する | 同じく購読しない | |
| 同じ公開操作で併発した `note.visibilityChanged` | 処理する | こちらは購読し、`visibility` 列が更新される（サイトマップだけを用途とする `note.published` との役割の分かれ目） | |
| 本文・タイトル・タグが更新された | 更新系のイベントを処理する | `note_search` 本体・bigram 前処理済み列・FTS 索引が 1 バッチでアトミックに更新される | |
| 同じイベントを 2 回受け取る | 2 回処理する | 現在の状態を読んで上書きするため結果が変わらない（冪等） | |
| イベントが順不同で届く（`updated` が `created` より先） | 処理する | 現在の状態から上書きされるため矛盾しない | |
| ノートが完全削除された | `note.purged` を処理する | 読み取りモデルの行が削除される | |
| 対象ノートが既に削除済み | 更新系のイベントを処理する | 何もせず成功として返る | |
| タグが付与された | `tag.assigned` を処理する | 対象ノートのタグを表示名と正規化名の組（`{ name, normalized }`）で引き直し、`updateTags` が呼ばれる | |
| タグの付与が外れた | `tag.unassigned` を処理する | 同じく `updateTags` が呼ばれ、そのタグが投影から外れる | |
| `updateTags` が呼ばれた | 読み取りモデルを確認する | `note_search.tag_names` / `tag_names_fts` / `note_search_tags` の 3 経路と表示名列が同一バッチで更新される。関連度用の列と `note_search_tags.normalized` には `normalized`、一覧の表示名には `name` が入る | |
| タグが削除された | `tag.deleted` を処理する | 何もしない（購読しない。付与 1 件ごとに併発される `tag.unassigned` が更新を担う） | |
| タグ名が変更された | `tag.renamed` を処理する | そのタグが付くすべてのノートで `updateTags` が呼ばれ、表示名と正規化名の両方が更新される | |
| タグが統合された | `tag.merged` を処理する | 対象ノートは `TagAssignmentRepository.listByTag(targetTagId)` で列挙し、ノートごとにタグを引き直して `updateTags` を呼ぶ | |
| `tag.merged` の対象ノートの列挙 | `sourceTagId` で引いた場合と比べる | merge の時点で `sourceTagId` の付与は `targetTagId` へ付け替え済み（衝突する行は削除済み）のため `sourceTagId` では 0 件になり、投影が更新されない。payload は両方の ID を運ぶため `targetTagId` を使う | |
| タグ付きのノート | ノート本体だけが変わるイベント（`note.contentUpdated` / `note.renamed` / `note.moved`）を処理する | `upsert` はタグの 3 経路と表示名に一切触れないため、既存のタグ投影が消えない（タグの更新は `updateTags` の専任） | |
| 利用者がハンドルを変更した | `identity.user.handleChanged` を処理する | payload の新旧ハンドルを使わず、`userId` で `UserRepository.findById` を引いて現在の表示名とハンドルの組を解決し、`updateAuthor(userId, displayName, handle)` を呼ぶ。`author_handle` が更新され、FTS 対象列に触れないため FTS 更新は行われない | |
| 利用者が表示名を変更した | `identity.user.profileUpdated` を処理する | payload は `displayName` しか運ばないため、同じく `findById` でハンドルを含む現在値の組を解決してから `updateAuthor` を呼ぶ。`author_display_name` が更新される | |
| `identity.user.handleChanged` が配送順の入れ替わりで古くなっている | 処理する | payload の値ではなく解決した現在値を書くため、古い値が復活しない | |
| ワークスペースのイベント（`workspace.created` / `slugChanged` / `published` / `unpublished` / `profileUpdated`） | 処理する | `workspaceId` で `WorkspaceRepository.findById` を引き、`name` / `slug` / `published` の組を解決してから `updateWorkspace` を呼ぶ（payload は変化の通知にとどまる） | |
| 利用者が退会した | `identity.user.deleted` を処理する | `updateAuthor(userId, "退会した利用者", null)` が呼ばれ、`created_by` がその利用者である行の著者表示だけが置き換わる。行は消さない（個人所有ノートの行は `deleteNotesForOwner` が発行する `note.purged` 経由で消える） | |
| 退会者が作成したワークスペース所有ノートがある | `identity.user.deleted` を処理する | 行は残り、著者表示が「退会した利用者」・ハンドルが `null` になる（AC-09） | |
| 同じ `identity.user.deleted` を 2 回受け取る | 2 回処理する | 同じ値の上書きのため結果が変わらない（冪等）。`deleteNotesForOwner` との到着順にも依存せず、対象行が既に消えていれば 0 行更新で成功する | |
| `created_by` の利用者が既に退会していて解決できない | 更新系のイベント（`note.contentUpdated` / `note.moved`）を処理する | `upsert` の `author` に既定値 `{ displayName: "退会した利用者", handle: null }` が埋まる（`author_display_name` は NOT NULL であり、旧表示名は復活しない） | |
| ワークスペースが名前を変更した | `workspace.profileUpdated` を処理する | そのワークスペースのノートの `workspace_name` が更新される | |
| ワークスペースがスラッグを変更した | `workspace.slugChanged` を処理する | そのワークスペースのノートの `workspace_slug` が更新される | |
| ワークスペースが公開された | `workspace.published` を処理する | そのワークスペースのノートの `workspace_published` が更新される | |
| 書き込みが失敗する | 処理する | `SystemError(DatabaseError)` が投げられ、再配送に委ねられる | |
