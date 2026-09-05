# テストケース: restoreNoteRevision

| 前提条件 | 操作 | 期待結果 | 実装ステータス |
|---|---|---|---|
| 版が複数あるノート | 過去の版を指定して戻す | 本文・タイトル・スタイルがその版の内容になる | |
| 戻した後 | 応答の `title` / `html` を確認する | 読み直した姿（`getNote`）と一致し、`html` はサニタイズ後の本文である（画面はこの応答をそのまま面へ載せるため、追加の読み取りなしに描き直せる） | |
| 戻した後 | 版の一覧を確認する | 戻す直前の内容が `reason: "restore"` で記録されている | |
| 他のノートの版 ID を指定する | 戻す | `NotFoundError("REVISION_NOT_FOUND")` が投げられる | |
| 存在しない版 ID | 戻す | `NotFoundError("REVISION_NOT_FOUND")` が投げられる | |
| viewer である | 戻す | `NotFoundError("NOTE_NOT_FOUND")` が投げられる | |
| 公開中のノート | 戻す | 公開ステータスと共有リンクは変わらない | |
| タグが付いたノート | 戻す | タグは変わらない | |
| 他者が先に更新した | 古い `expectedVersion` で戻す | `ConflictError("OPTIMISTIC_LOCK_FAILURE")` が投げられる | |
| 版を復元した | 保存までの経路を確認する | 版の HTML を `HtmlProcessor.process` に通してから `Note.updateBody` に渡す（`NoteRevision` は HTML しか持たず、`updateBody` は `ProcessedHtml` を要求する） | |
| 版を復元した | 復元後の `excerpt` / `headings` を確認する | 復元した本文から作り直されている（復元前の値が残らない） | |
| 取り込み**前**の版に戻す（取り込みは版を作らないため、直近の版は取り込み前のものになる） | 戻す | 本文の参照が外部 URL に戻り、`data-imported-stylesheet` だった痕跡が `data-stylesheet-href` に戻る | |
| 同上 | 復元後のジョブを確認する | 内部を指さない参照が 1 件以上あるため参照取り込みジョブが登録される（本文に未取得の参照が残ったまま誰も取りに行かない状態を作らない） | |
| 同上 | 復元後の取得記録を確認する | `ReferenceAttempt` の行は消えない（記録は URL ごとの「最後に試したときどうだったか」であり、本文が巻き戻っても事実は変わらない。再取り込みが走れば同じ鍵で上書きされる） | |
| 復元後の本文に外部参照がない | 戻す | 参照取り込みジョブは登録されない | |
| 同じノートに未終端の `referenceImport` ジョブがある | 戻す | 新しいジョブは登録されない（`updateNoteBody` と同じ重複防止） | |
| ゴミ箱のノート | 版を復元する | `BusinessRuleError(NoteIsTrashed)` が投げられ、ノートは変わらない |  |
| 実行中の再生成ジョブがあるノート | 版を復元する | `BusinessRuleError(NoteLockedByJob)` が投げられ、本文も版も変わらない（復元も `Note.updateBody` を当てる本文の書き込みなので、`updateNoteBody` と同じ門を通る） | |
