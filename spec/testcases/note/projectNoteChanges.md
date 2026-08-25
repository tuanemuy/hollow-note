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
| 異なる2つのscopeで投影が発生する | 並行して処理する | 各scope DOのAlarmが独立にlocal projectionを更新し、互いを直列化しない | |
| 同じscopeで2つのlocal投影が発生する | 処理する | そのDOが順序付け、`processed_events` とcurrent stateの上書きで収束する | |
| public投影が並行配送される | 処理する | `route_version` / `projection_revision` / `author_version` / `workspace_version` の世代ベクトルにより古い配送が新しい列を上書きしない | |
| workspaceからpersonalへNoteを移し、旧workspaceVersionが0より大きい | target投影する | 大きいrouteVersionを先に比較してowner contextをリセットし、workspaceVersion 0のsnapshotを受理する | |
| version 100のworkspace Aからversion 3のworkspace Bへ移す | target投影する | routeVersionが大きいためworkspace Bの完全snapshotを受理し、永久にincomparableにならない | |
| move前scopeのeventがroute切替後に届く | public投影する | current routeと一致しないためno-opになり、旧ownerの公開行を復活させない | |
| 同じイベントを 2 回受け取る | 2 回処理する | 現在の状態を読んで上書きするため結果が変わらない（冪等） | |
| イベントが順不同で届く（`updated` が `created` より先） | 処理する | 現在の状態から上書きされるため矛盾しない | |
| ノートが完全削除された | `note.purged` を処理する | 読み取りモデルの行が削除される | |
| 対象ノートが既に削除済み | 更新系のイベントを処理する | 何もせず成功として返る | |
| タグが付与された | `tag.assigned` を処理する | 対象ノートのタグを引き直し、完全snapshot置換で本体・タグ・FTSを同じ世代へ更新する | |
| タグの付与が外れた | `tag.unassigned` を処理する | 同じ完全snapshot置換でそのタグが投影から外れる | |
| 完全snapshotを置換した | 読み取りモデルを確認する | `note_search.tag_names` / `note_search_tags` / `tag_display_names` と FTS `tag_names_fts` が同一transaction/batchで更新される | |
| タグが削除された | `tag.deleted` を処理する | 何もしない（購読しない。各operation pageのlocal/public再投影要求が更新を担う） | |
| タグ名が変更された | `tag.renamed` を処理する | 対象ノートを1ページ（200件）だけ列挙し、1件につきlocal taskとpublic outbox requestを同じUoWへ積む。ここでは投影を直接書かない | |
| タグが500ノートに付いている | `tag.renamed` を処理する | 200件ぶんのlocal/public再投影要求とカーソル付きlocal taskを積み、scope Alarmで500件すべてへ進む | |
| tag pageのoutbox relay応答を失う | 再実行する | plane・生成元ID・NoteId・revision由来のtask IDでlocal/publicとも増殖せず、public Queueへ確実に届く | |
| tag pageのpublic request保存後にNoteが別scopeへmoveする | 遅延requestを処理する | requestはrouteVersionを持たず、global consumerがcurrent routeの移動先snapshotを再投影して旧scope状態を復活させない | |
| `projection.tagFanOutContinued` を受け取る | 処理する | `listByTag(tagId, { afterNoteId, limit: 200 })` でカーソルの続きから列挙する。tag assignment継続では処理後も母集合が残るためkeyset cursorを使う | |
| 同上 | カーソルの解釈を確認する | `afterNoteId` はキーセット（`WHERE tag_id = ? AND note_id > ? ORDER BY note_id LIMIT 200`）であって `OFFSET` ではない。`listByTag` は `noteId` 昇順を契約として保証する | |
| ファンアウトの進行中に、カーソルより前の付与が `unassignTag` / `note.purged` / `mergeTags` の衝突行削除で消える | 処理する | キーセットなので後続のノートを飛ばさない（`OFFSET` だと消えた件数ぶん後ろのノートが静かに落ちる） | |
| タグがちょうど 200 ノートに付いている | `tag.renamed` を処理する | 200件ぶんとlocal continuationを積み、**次のAlarm turnの列挙は0件になる** | |
| 続きの列挙が 0 件で返った | 処理する | **継続を積まずに成功として返る。メッセージを失敗させない。** 付与の件数がちょうど 200 の倍数のとき最後のページが空になるのが正常な終わり方であり、「進捗がなければ継続しない」を字義どおり適用すると正常完了のたびに DLQ へメッセージが積まれる | |
| ファンアウトの進行中にタグそのものが削除された | 続きを処理する | 付与が FK CASCADE で消えるため次のページが 0 件になり、継続が正常に終わる（無限に回らない） | |
| ファンアウトの進行中に同じタグがもう一度リネームされた | 2 系列を処理する | どちらの系列が積んだ `projection.reprojectRequested` も `findById` で現在値を読み直すため、最後に書かれる値は 2 回目のリネーム後の名前になる（系列の交錯によらず収束する） | |
| ファンアウトの進行中にノートがそのタグを新たに付与された | 処理する | そのノートは `tag.assigned` の個別完全snapshotが別途拾うため、ファンアウトが取りこぼしても投影は正しくなる | |
| `projection.reprojectRequested` を受け取る | 処理する | current routeと全source versionを読み、local/publicとも `replaceSnapshotIfNewer` 1回で本体・tags・FTS・表示contextを同じ世代にする | |
| 同じprojectionRevisionを通知する重複eventが逆順で届く | public投影を処理する | atomicな完全snapshot置換またはno-opとなり、本体/tagの部分状態を作らない | |
| consumer Aがtag変更前snapshot/revisionを読み、consumer Bがtag変更後revisionを書いた後にAが書く | 競合する | Aは小さいprojectionRevisionでno-opとなり、新しいtag集合を巻き戻さない | |
| current routeが `purging` / `tombstone` | 更新eventを処理する | public行をremoveし、古いeventから復活させない | |
| タグが統合・削除された | 完了eventを処理する | 完了eventは監査のみ。各200件operation pageがrevision bumpと個別再投影taskを保存済みである | |
| タグ付きのノート | ノート本体だけが変わるイベントを処理する | atomic snapshotから現在のタグ集合も読み、完全snapshot置換後もタグ投影が維持される | |
| 利用者がハンドルを変更した | `identity.user.handleChanged` を処理する | `note_routes(created_by)` を200件ずつ読み、各Noteのpublic再投影とscope-local refreshを最大6 RPCで送る | |
| 利用者が表示名を変更し、作成済みworkspaceから既に離脱している | `identity.user.profileUpdated` を処理する | membership edgeではなく不変のroute `created_by` から旧workspaceを発見し、残るlocal表示も更新する | |
| 1利用者が数千scopeでNoteを作成している | author refreshする | routeを200件ずつキーセット継続し、1 invocationのRPCは同時6本までに制限する | |
| author routeが2page以上ある | `projection.authorRouteFanOutContinued`を処理する | opaque cursorを同じreaderへ渡し、全shardの続きへ漏れなく進む | |
| `identity.user.handleChanged` が配送順の入れ替わりで古くなっている | 処理する | payload の値ではなく解決した現在値を書くため、古い値が復活しない | |
| ワークスペースのイベント（`workspace.slugChanged` / `published` / `unpublished` / `profileUpdated`） | 処理する | scope routeを200件ずつ読み、version付きcurrent Workspaceを含む個別snapshotを再投影する | |
| workspace routeが2page以上ある | `projection.workspaceRouteFanOutContinued`を処理する | opaque cursorを同じreaderへ渡し、全shardの続きへ漏れなく進む | |
| ワークスペースが作られた | `workspace.created` を処理する | 購読しない（作成直後は対象routeが0件） | |
| Note snapshot読込後にIdentity更新snapshotが先に保存される | 古いNote snapshotを書こうとする | authorVersionが小さくベクトルがincomparableとなりno-op。全sourceを再読込して新Note＋新authorを保存する | |
| `identity.user.deleted` の投影後に削除前のNote eventが遅延到着する | 処理する | tombstoneのauthorVersionより古いため旧表示名・handleを復活させない | |
| account deletionから`projection.authorRedactionRequested`を受け取る | 処理する | current route上のlocal/public完全snapshotを退会者表示と`redactionVersion`で先に置換し、その成功応答後にuser shardへplane別ackする | |
| redaction投影後にuser shard ack応答を失う | 同じ要求を再処理する | 保存済みredactionVersionを確認してwriteはno-op、投影確定後にackだけを再送する | |
| author redaction対象Noteがmoveまたはpurge済み | 処理する | current routeへ再解決し、tombstoneなら投影を復活させずackする | |
| 利用者が作られた | `identity.user.created` を処理する | 同じ理由で購読しない。購読する Identity のイベントは `identity.user.handleChanged` / `identity.user.profileUpdated` / `identity.user.deleted` の 3 つに限られる | |
| 利用者が退会した | account deletion commandを処理する | membership edgeを消す前に各workspace scopeのlocal著者表示を置換し、global consumerはpublic著者表示を置換する。personal行はscope cleanupで消える | |
| 退会者が作成したワークスペース所有ノートがある | `identity.user.deleted` を処理する | 行は残り、著者表示が「退会した利用者」・ハンドルが `null` になる（AC-09） | |
| 同じ `identity.user.deleted` を 2 回受け取る | 2 回処理する | 同じ値の上書きのため結果が変わらない（冪等）。`deleteNotesForOwner` との到着順にも依存せず、対象行が既に消えていれば 0 行更新で成功する | |
| `created_by` の利用者が既に退会していて解決できない | 更新系のイベント（`note.contentUpdated` / `note.moved`）を処理する | `upsert` の `author` に既定値 `{ displayName: "退会した利用者", handle: null }` が埋まる（`author_display_name` は NOT NULL であり、旧表示名は復活しない） | |
| ワークスペースが名前を変更した | `workspace.profileUpdated` を処理する | そのワークスペースのノートの `workspace_name` が更新される | |
| ワークスペースがスラッグを変更した | `workspace.slugChanged` を処理する | そのワークスペースのノートの `workspace_slug` が更新される | |
| ワークスペースが公開された | `workspace.published` を処理する | そのワークスペースのノートの `workspace_published` が更新される | |
| 書き込みが失敗する | 処理する | `SystemError(DatabaseError)` が投げられ、再配送に委ねられる | |
