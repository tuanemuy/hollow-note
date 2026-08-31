# テストケース: purgeNote

| 前提条件 | 操作 | 期待結果 | 実装ステータス |
|---|---|---|---|
| ゴミ箱にあるノート | 完全削除する | ノートが削除され、`note.purged` が発行される | |
| purgeを開始する | routeを確認する | D1 routeがoperation ID付き `purging` になり、外部read/mutationを先に閉じる | |
| 認可確認後・beginPurge前にrestoreが勝つ | local deleteする | expected version/lifecycle競合となり、同じoperation IDでrouteをactiveへabortして復旧する | |
| local delete前にactorのMembershipが変わる | 再確認する | 削除せずrouteをactiveへabortする | |
| abort応答を失う | recoveryする | Noteが残ることを確認して同じoperation IDのabortを再試行する | |
| local delete後・public remove前に停止する | recoveryする | 同じoperation IDでpublic removeを再開し、古いeventはpublic行を復活させない | |
| local deleteのcommit後に応答を失う | 完全削除する | abortせずrouteを`purging`のまま残す（Noteは消え`note.purged`は1件出る）。同じコマンドの再送がpublic remove以降を再開し、`note.purged`は二重にならない | |
| public removeがackした | 完了する | routeが30日保持の`tombstone`になり、再配送しても同じ結果になる | |
| remove ackの応答を失う | Cron recoveryする | public削除とoperation ackを冪等に再実行し、ack後だけtombstoneへ進む | |
| 完全削除後 | 版（`note_revisions`）を確認する | DB の FK CASCADE で同時に削除される | |
| 完全削除後 | タグ付与を確認する | Tag の `deleteAssignmentsForNote` が `note.purged` を受けて削除する | |
| 完全削除後 | 保管ファイル（`source` / `media` / `reference`）を確認する | Storage の `deleteFilesForNote` が回収する | |
| 完全削除後 | バックアップ記録を確認する | Integration の `deleteBackupRecordsForNote` が削除する | |
| scope cleanupで同じNote purgeを再配送する | 実行する | `sha256("ownerPurge:" + deletionOperationId + ":" + noteId)`の同じ内部operation IDから再開する | |
| 通常purgeが`purging`切替後に応答を失う | 再送する | routeに保存済みoperation ID/phaseを再利用し、新しいpurge operationを作らない | |
| personal cleanup対象がactive Noteでactorは`DeletingUser` | 内部purgeする | cleanup ownerとscope/owner一致を確認し、trashed/active User制約を要求せず削除する | |
| workspace cleanupでWorkspace/Membership行が既に削除済み | 内部purgeする | manifest ownerとNote owner一致から続行し、削除済みMembershipを要求しない | |
| 通常利用者がactive Noteをpurgeする | 実行する | `NOTE_NOT_TRASHED`で拒否する | |
| 完全削除後 | 読み取りモデルを確認する | Note の `projectNoteChanges` が該当の行を削除する | |
| 完全削除後 | 使用量を確認する | Usage の `applyStorageDelta` で保存容量とノート件数が減る | |
| Drive にバックアップがある | 完全削除する | Drive 上のファイルは残る（記録だけが消える） | |
| ゴミ箱にないノート | 完全削除する | `ValidationError("NOTE_NOT_TRASHED")` が投げられる | |
| viewer である | 完全削除する | `NotFoundError("NOTE_NOT_FOUND")` が投げられる | |
| 同じノートで 2 つの要求が同時に走る | 両方が完全削除する | 片方は成功、もう片方は `NotFoundError` になり、二重に減算されない | |
| global recoveryに複数kindのdue operationが10,000件滞留 | Cronを実行する | kind別最低枠を保ち、claim lease付きで最大100 operations/400 queriesだけ処理して残りをQueue continuationへ渡す | |
| 前回Cronのclaim lease中に次のCronが起動 | 同じoperationをclaimする | lease中はno-opとなり、二重orchestratorを走らせない | |
