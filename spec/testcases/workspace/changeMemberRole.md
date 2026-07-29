# テストケース: changeMemberRole

| 前提条件 | 操作 | 期待結果 | 実装ステータス |
|---|---|---|---|
| owner で、対象が editor | viewer に変更する | ロールが変わり、`membership.roleChanged` が旧ロールつきで発行される | |
| owner が 1 名で、その owner を対象にする | editor に変更する | `BusinessRuleError(LastOwnerCannotLeave)` が投げられる | |
| owner が 2 名で、片方を対象にする | editor に変更する | 変更が成功する | |
| 自分自身を対象にする | 変更する | `BusinessRuleError(CannotChangeOwnRole)` が投げられる | |
| editor である | 他人のロールを変更する | `BusinessRuleError(InsufficientRole)` が投げられる | |
| 他のワークスペースのメンバーシップ ID | 変更する | `NotFoundError("MEMBERSHIP_NOT_FOUND")` が投げられる | |
| — | 未知のロールを指定する | `BusinessRuleError(InvalidRole)` が投げられる | |
| 同じロールを指定する | 変更する | 変更もイベントも起きず成功する（ジョブの取り消しも起きない） | |
| 対象を editor から viewer にした後 | 対象がノートを編集する | 編集が拒否される | |
| 対象（editor）が要求した、そのワークスペースのノートの `conversion` / `regeneration` / `referenceImport` の未終端ジョブがある | viewer に降格する | `listActiveByScope({ type: "workspace", workspaceId })` のうち `requestedBy` が対象で、降格後のロールに許されない kind のものが `Job.cancel` される（run 系は実行時に権限を再確認しないため、取り消さないと降格後も本文が書き換わる） | |
| 対象が要求した `bulkMove` / `bulkVisibility` / `bulkTag` / `bulkDelete` の未終端ジョブがある | viewer に降格する | いずれも editor を要する kind のため取り消される | |
| 対象が要求した `driveBackup` / `bulkBackup` の未終端ジョブがある | viewer に降格する | いずれも editor を要する kind（[ADR 004](../../adr/004-workspace-roles.md) のロール表）のため取り消される。バックアップはノートに紐づく共有状態（`BackupRecord`）を書き換え、`downloadNote` の範囲を超えるため | |
| 対象が要求した `pdfExport` / `bulkExport` の未終端ジョブがある | viewer に降格する | viewer でも実行できる kind（`downloadNote`）のため取り消されない。要求者個人に帰属する生成物を作るだけでノート側に何も書かない | |
| 対象が owner で、editor に降格する | 降格する | 取り消しは 1 件も起きない（owner だけに許される操作に対応する `JobKind` が存在しないため） | |
| 対象が viewer で、editor に昇格する | 昇格する | 取り消しは起きない（降格の場合だけ対象を集める） | |
| 他のメンバーが要求した実行中ジョブが同じワークスペースにある | 降格する | `requestedBy` が一致しないため触れられない | |
| そのワークスペースのノートに対する匿名の PDF 書き出しジョブが実行中 | 降格する | `requestedBy: null` は対象と一致せず、そもそも viewer でも実行できる kind のため取り消されない | |
| 対象が自分の個人ノートに対して持つ未終端ジョブがある | 降格する | `scope` が `user` のため `listActiveByScope({ type: "workspace" })` に現れず、取り消されない | |
| 取り消し対象のワーカーがリース有効で実行中 | 降格する | `Job.cancel` はリースを検査せず終端化するため、ワーカーの生存を待たずに取り消される | |
| ジョブの取り消しとロールの変更 | 保存の境界を確認する | すべて同一 UoW で保存される（ロールだけが下がってジョブが走り続ける中間状態を作らない） | |
| 取り消した `kind: "conversion"` のジョブの対象ノートが `processing` のまま | 降格する | 「共通: 強制終端の後始末」に従い `Note.markConversionFailed("canceled")` が同一 UoW で保存され、ノートが `failed(canceled)` になる | |
| 取り消したジョブ | 破棄された生成物を確認する | 「共通: 強制終端の後始末」の 2 を規則どおり適用するが、この経路の回収対象は実際には空になる。取り消すのは editor を要する `kind` だけで、生成物（`purpose: "artifact"`）を持つのは viewer でも実行できる `pdfExport` / `bulkExport` だからである（降格した利用者は閲覧・ダウンロードの権限を保つため、生成済みの ZIP・PDF が手元に残っても差し支えない）。取り消し対象に `bulkBackup` の batch 親が含まれる場合も、規則 2 が引く成功済みの子（`runBackup`）は Drive 上にファイルを作るだけで `artifact` を持たないため回収対象は空のままである | |
