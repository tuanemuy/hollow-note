# テストケース: deleteWorkspace

| 前提条件 | 操作 | 期待結果 | 実装ステータス |
|---|---|---|---|
| owner である | 正しいワークスペース名を入力して削除する | ワークスペースが削除され、`workspace.deleted` が発行される | |
| — | 誤った名前を入力して削除する | `ValidationError("CONFIRMATION_MISMATCH")` が投げられ、削除されない | |
| editor である | 削除する | `BusinessRuleError(InsufficientRole)` が投げられる | |
| 実行中の変換ジョブがある | 削除する | ジョブがキャンセルされてから削除される | |
| 取り消し対象の収集 | 引くクエリを確認する | `JobRepository.listActiveByScope({ type: "workspace", workspaceId })` だけを引き、返ったすべてに `Job.cancel` を適用する（要求者では絞らない） | |
| 他のメンバーが要求した、そのワークスペースのノートの実行中ジョブ | 削除する | `scope` が一致するため `listActiveByScope` で拾われて取り消される | |
| そのワークスペースの公開ノートに対する匿名の PDF 書き出しジョブが実行中 | 削除する | `requestedBy: null` でも `scope` が一致するため `listActiveByScope` で拾われて取り消される | |
| メンバーが自分の個人ノートを対象に要求した実行中ジョブ | 削除する | `scope` が `user` のため `listActiveByScope({ type: "workspace" })` には現れず、取り消されない | |
| 取り消し対象のワーカーがリース有効で実行中 | 削除する | `Job.cancel` はリースを検査せず終端化するため、ワーカーの生存を待たずに取り消される | |
| 取り消した `kind: "conversion"` のジョブの対象ノートが `processing` のまま | 削除する | 「共通: 強制終端の後始末」に従い `Note.markConversionFailed("canceled")` が同一 UoW で保存される（対象ノートごと消える経路のため結果的に無意味だが、規則を経路ごとに分けない） | |
| 取り消した batch 親（一括ダウンロードなど）に、既に成功した子がある | 削除する | 「共通: 強制終端の後始末」の 2 に従い、`JobRepository.listChildren` で引いた子のうち `succeeded` のものの artifact だけが `deleteFiles` で破棄され、ワークスペースの削除と同一 UoW で保存される | |
| 取り消した単体ジョブ（batch 親ではない） | 削除する | 生成物の回収は起きない。`Job.cancel` が受け取るのは `QueuedJob \| RunningJob` で、`artifact` を持つのは `succeeded` のジョブだけだからである | |
| 公開ノートを持つ | 削除後にそのノートの URL を開く | 「見つかりません」が返る | |
| メンバーが 3 名いる | 削除する | 全員がそのワークスペースにアクセスできなくなる | |
| ゴミ箱にノートがある | 削除する | ゴミ箱の内容も削除される | |
| メンバーシップと招待がある | 削除する | 同一ドメインの FK CASCADE で消える（購読ユースケースの対象外） | |
| ノート・タグ・ファイル・クォータがある | 削除後に関連データを確認する | `workspace.deleted` の購読ユースケース（`deleteNotesForOwner` / `deleteTagsForScope` / `deleteFilesByOwner` / `deleteQuota`）によって後始末される | |
| ワークスペース所有ノートのタグが個人スコープのタグと同名 | 削除する | `deleteTagsForScope` はワークスペーススコープのタグと付与だけを消し、個人スコープの同名タグは残る | |
| ワークスペース所有ノートのバックアップ記録がある | 削除する | `workspace.deleted` は購読されず、`deleteNotesForOwner` が 1 件ずつ発行する `note.purged` を購読する `deleteBackupRecordsForNote` が削除する（`backup_records` は owner 列を持たない） | |
| 削除後 | 同じスラッグで新しいワークスペースを作る | 作成できる | |
