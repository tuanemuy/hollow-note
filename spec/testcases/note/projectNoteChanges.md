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
| 本文・タイトル・タグが更新された | 更新系のイベントを処理する | `note_search` 本体・`note_search_tags`・FTS 索引が 1 バッチでアトミックに更新される | |
| FTS 索引の書き換え | 取り消しに渡す旧値を確認する | bigram 前処理済みのテキストは列に保存されていないため、`note_search` の生テキスト列（`title` / `text` / `tag_names`）に前処理関数を再適用して求める。前処理は純関数なので書き込み時の値と必ず一致する | |
| 2 つの投影が同時に配送される | 並行して処理する | 起こらない。投影の消費者は同時実行数 1 の専用キュー（`events-projection`）に固定されている。並行して呼ばれると「現在の状態を読み直して上書きする」形はロストアップデートを起こすため、この直列化は設計上の要件である | |
| 同じイベントを 2 回受け取る | 2 回処理する | 現在の状態を読んで上書きするため結果が変わらない（冪等） | |
| イベントが順不同で届く（`updated` が `created` より先） | 処理する | 現在の状態から上書きされるため矛盾しない | |
| ノートが完全削除された | `note.purged` を処理する | 読み取りモデルの行が削除される | |
| 対象ノートが既に削除済み | 更新系のイベントを処理する | 何もせず成功として返る | |
| タグが付与された | `tag.assigned` を処理する | 対象ノートのタグを表示名と正規化名の組（`{ name, normalized }`）で引き直し、`updateTags` が呼ばれる | |
| タグの付与が外れた | `tag.unassigned` を処理する | 同じく `updateTags` が呼ばれ、そのタグが投影から外れる | |
| `updateTags` が呼ばれた | 読み取りモデルを確認する | `note_search.tag_names` / `note_search_tags` / `tag_display_names` の 3 列と FTS 索引の `tag_names_fts` 列が同一バッチで更新される。関連度用の列と `note_search_tags.normalized` には `normalized`、一覧の表示名には `name` が入る | |
| タグが削除された | `tag.deleted` を処理する | 何もしない（購読しない。付与 1 件ごとに併発される `tag.unassigned` が更新を担う） | |
| タグ名が変更された | `tag.renamed` を処理する | 対象ノートを 1 ページ（200 件）だけ列挙し、1 件につき `projection.reprojectRequested` を積む。ここでは `updateTags` を呼ばない（件数に比例したクエリを 1 実行で発行しないため） | |
| タグが 500 ノートに付いている | `tag.renamed` を処理する | 200 件ぶんの再投影要求と、カーソル付きの `projection.tagFanOutContinued` が 1 件積まれる。続きは次の配送で処理され、最終的に 500 件すべてが再投影される | |
| `projection.tagFanOutContinued` を受け取る | 処理する | カーソルの続きから列挙する。対象ノートは削除されないため、この継続だけはカーソルを持つ | |
| `projection.reprojectRequested` を受け取る | 処理する | `findById` で現在の状態を読み、`upsert` と `updateTags` の 2 呼び出しで投影を作り直す。ノートが存在しなければ何もせず成功として返る | |
| タグが統合された | `tag.merged` を処理する | 対象ノートは `TagAssignmentRepository.listByTag(targetTagId)` で 1 ページだけ列挙し、`tag.renamed` と同じく再投影要求を積む | |
| `tag.merged` の対象ノートの列挙 | `sourceTagId` で引いた場合と比べる | merge の時点で `sourceTagId` の付与は `targetTagId` へ付け替え済み（衝突する行は削除済み）のため `sourceTagId` では 0 件になり、投影が更新されない。payload は両方の ID を運ぶため `targetTagId` を使う | |
| タグ付きのノート | ノート本体だけが変わるイベント（`note.contentUpdated` / `note.renamed` / `note.moved`）を処理する | `upsert` はタグの 3 列に一切触れないため、既存のタグ投影が消えない（タグの更新は `updateTags` の専任）。FTS 索引に書き戻す `tag_names_fts` は `note_search.tag_names` の現在値から求める | |
| 利用者がハンドルを変更した | `identity.user.handleChanged` を処理する | payload の新旧ハンドルを使わず、`userId` で `UserRepository.findById` を引いて現在の表示名とハンドルの組を解決し、`updateAuthor(userId, displayName, handle)` を呼ぶ。`author_handle` が更新され、FTS 対象列に触れないため FTS 更新は行われない | |
| 利用者が表示名を変更した | `identity.user.profileUpdated` を処理する | payload は `displayName` しか運ばないため、同じく `findById` でハンドルを含む現在値の組を解決してから `updateAuthor` を呼ぶ。`author_display_name` が更新される | |
| `identity.user.handleChanged` が配送順の入れ替わりで古くなっている | 処理する | payload の値ではなく解決した現在値を書くため、古い値が復活しない | |
| ワークスペースのイベント（`workspace.slugChanged` / `published` / `unpublished` / `profileUpdated`） | 処理する | `workspaceId` で `WorkspaceRepository.findById` を引き、`name` / `slug` / `published` の組を解決してから `updateWorkspace` を呼ぶ（payload は変化の通知にとどまる） | |
| ワークスペースが作られた | `workspace.created` を処理する | 購読しない（`createWorkspace` はノートを 1 件も作らないため投影対象の行が存在せず、`updateWorkspace` は必ず 0 行更新になる） | |
| 利用者が作られた | `identity.user.created` を処理する | 同じ理由で購読しない。購読する Identity のイベントは `identity.user.handleChanged` / `identity.user.profileUpdated` / `identity.user.deleted` の 3 つに限られる | |
| 利用者が退会した | `identity.user.deleted` を処理する | `updateAuthor(userId, "退会した利用者", null)` が呼ばれ、`created_by` がその利用者である行の著者表示だけが置き換わる。行は消さない（個人所有ノートの行は `deleteNotesForOwner` が発行する `note.purged` 経由で消える） | |
| 退会者が作成したワークスペース所有ノートがある | `identity.user.deleted` を処理する | 行は残り、著者表示が「退会した利用者」・ハンドルが `null` になる（AC-09） | |
| 同じ `identity.user.deleted` を 2 回受け取る | 2 回処理する | 同じ値の上書きのため結果が変わらない（冪等）。`deleteNotesForOwner` との到着順にも依存せず、対象行が既に消えていれば 0 行更新で成功する | |
| `created_by` の利用者が既に退会していて解決できない | 更新系のイベント（`note.contentUpdated` / `note.moved`）を処理する | `upsert` の `author` に既定値 `{ displayName: "退会した利用者", handle: null }` が埋まる（`author_display_name` は NOT NULL であり、旧表示名は復活しない） | |
| ワークスペースが名前を変更した | `workspace.profileUpdated` を処理する | そのワークスペースのノートの `workspace_name` が更新される | |
| ワークスペースがスラッグを変更した | `workspace.slugChanged` を処理する | そのワークスペースのノートの `workspace_slug` が更新される | |
| ワークスペースが公開された | `workspace.published` を処理する | そのワークスペースのノートの `workspace_published` が更新される | |
| 書き込みが失敗する | 処理する | `SystemError(DatabaseError)` が投げられ、再配送に委ねられる | |
