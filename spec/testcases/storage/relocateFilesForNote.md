# テストケース: relocateFilesForNote

| 前提条件 | 操作 | 期待結果 | 実装ステータス |
|---|---|---|---|
| source/media/referenceを持つNote | `snapshotSource` | current source scopeから3件のportable metadataを返し、まだ削除しない | |
| artifactもある | snapshotする | artifactは含めずJob scopeに残す | |
| targetをstageする | `stageTarget` | 同じR2 object keyを指すmetadataをtarget ownerで登録し、R2 copyを行わない | |
| 同じmigration IDでstageを再実行 | 実行する | `applied_operations` により二重metadataを作らない | |
| route switch前にstageが失敗 | 読み取る | active routeはsourceのためstaged metadataは利用者から見えない | |
| route switch後 | `retireSource` | source metadataを消すがR2 delete eventは出さない | |
| retire応答を失う | 再実行する | target参照を保ったまま冪等にsourceだけを掃除する | |
| avatarがある | snapshotする | Noteに属さないため対象外 | |
