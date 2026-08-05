# テストケース: leaveWorkspace

| 前提条件 | 操作 | 期待結果 | 実装ステータス |
|---|---|---|---|
| editor として参加している | 脱退する | directory edgeを`removing`にしてから`Membership`を削除する | |
| 唯一の owner である | 脱退する | `BusinessRuleError(LastOwnerCannotLeave)` が投げられる | |
| owner が 2 名いるうちの 1 人 | 脱退する | 脱退が成功する | |
| 参加していない | 脱退する | `NotFoundError("MEMBERSHIP_NOT_FOUND")` が投げられる | |
| 脱退後 | そのワークスペースのノートを開く | 「見つかりません」が返る | |
| 自分が作成したノートがある | 脱退する | ノートはワークスペースに残る | |
| 自分が要求した、そのワークスペースのノートの変換・再生成・バックアップジョブが実行中 | 脱退する | `removeMember` の手順 4 と同じ規則で `limit: 100` の網を引き、脱退者が要求した分だけが `Job.cancel` される | |
| 網が 100 件を返した | 脱退する | 脱退と同じ UoW で継続要求 `job.terminationContinued { origin: { path: "leaveWorkspace", workspaceId, memberUserId } }` を積む（`memberUserId` は脱退者自身）。続きは `continueForcedTermination` が引き受け、`removeMember` と同じ絞り込みを保つ | |
| 他のメンバーが要求した実行中ジョブが同じワークスペースにある | 脱退する | 触れられず、実行が続く | |
| そのワークスペースのノートに対する匿名の PDF 書き出しジョブが実行中 | 脱退する | `requestedBy: null` は脱退者と一致しないため取り消されない | |
| 脱退者が自分の個人ノートに対して持つ実行中ジョブがある | 脱退する | `scope` が `user` のため対象に入らず、取り消されない | |
| 取り消した `kind: "conversion"` のジョブの対象ノートが `processing` のまま | 脱退する | 「共通: 強制終端の後始末」に従い `Note.markConversionFailed("canceled")` が同一 UoW で保存され、ノートが `failed(canceled)` になる | |
| 取り消した `kind: "regeneration"` のジョブ | 脱退する | 本文は `ready` のまま変更されない | |
| 取り消した batch 親（脱退者が要求した一括ダウンロード）に、既に成功した子がある | 脱退する | 「共通: 強制終端の後始末」の 2 に従い、`JobRepository.listChildren` で引いた子のうち `succeeded` のものの artifact だけが `deleteFiles` で破棄される（脱退後もワークスペースのノート本文を含む中間生成物が手元に残らない） | |
| 取り消した単体ジョブ（batch 親ではない） | 脱退する | 生成物の回収は起きない（`Job.cancel` が受け取るのは未終端のジョブで、`artifact` を持つのは `succeeded` だけ。`removeMember` と同じ） | |
| 脱退した | 取り消しの契機を確認する | 取り消しは本ユースケースの手順内で行われる（`workspace.membership.removed` の購読で後から行うのではない） | |
| 脱退後 | `listUserWorkspaces` を呼ぶ | そのワークスペースが一覧に現れない | |
| 脱退後 | `resolveWorkspaceAccess` を呼ぶ | `role: null` が返る（再参加には新しい招待の受諾が必要） | |
| 脱退後 | 保留中の招待なしで `acceptInvitation` を試みる | 有効な招待トークンがないため `NotFoundError("INVITATION_NOT_FOUND")` が投げられる | |
| local脱退commit後にdirectory更新が失敗 | 再試行する | scopeでは既に権限なしで、global edgeはoperation IDで後から削除される | |
| Membership削除後にJob履歴正データまたはBackupRecordが残る | cleanupを確認する | edgeは`removing`のまま、scope Alarmでresidueを削除し `job.removed` を発行する | |
| residue cleanupがackした | directoryを確認する | edgeを削除し、以後account deletionがこのscopeを列挙しなくても利用者所有データは残らない | |
