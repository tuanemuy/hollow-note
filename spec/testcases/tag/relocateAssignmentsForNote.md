# テストケース: relocateAssignmentsForNote

| 前提条件 | 操作 | 期待結果 | 実装ステータス |
|---|---|---|---|
| sourceにTag assignmentがある | `snapshotSource` | 表示名・正規化名・assignedByをportable snapshotへ含め、source行を残す | |
| targetに同名Tagがある | `stageTarget` | 正規化名で解決してtarget Tagへ付与する | |
| targetに同名Tagがない | stageする | 新規Tagを作らずdropとして記録する | |
| 大文字小文字だけ違うTag | stageする | 正規化して同一Tagへ付与する | |
| 同じmigration IDを2回stage | 実行する | assignmentを二重作成しない | |
| route切替後 | `retireSource` | source assignmentを削除する | |
| tagが0件 | 各phaseを実行する | 0件で冪等に成功する | |
