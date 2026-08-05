# テストケース: removeMember

| 前提条件 | 操作 | 期待結果 | 実装ステータス |
|---|---|---|---|
| owner で、対象が editor | 除名する | `Membership` が削除され、`membership.removed` が発行される | |
| owner が 1 名で、その owner を対象にする | 除名する | `BusinessRuleError(LastOwnerCannotLeave)` が投げられる | |
| owner で、自分自身のメンバーシップを対象にする（owner は 2 名いる） | 除名する | `BusinessRuleError(CannotRemoveSelf)` が投げられ、`leaveWorkspace` の利用を案内される | |
| editor である | 除名する | `BusinessRuleError(InsufficientRole)` が投げられる | |
| 除名後 | 対象がそのワークスペースのノートを開く | 「見つかりません」が返る | |
| 除名対象が作成したノートがある | 除名する | ノートはワークスペースに残る | |
| 除名対象がノートを編集中 | 除名後に保存する | 保存が拒否される | |
| 除名対象が要求した、そのワークスペースのノートの変換・再生成・バックアップジョブが実行中 | 除名する | current workspace scopeで `listActiveByRequester(memberUserId, 100)` を引き、対象だけが `Job.cancel` される | |
| cleanupが完了していない | directoryを確認する | edgeは `removing` のまま残り、Job正データ・BackupRecord・security cleanupのack後だけ削除される | |
| 網が 100 件を返した | 除名する | 除名と同じ UoW で継続要求 `job.terminationContinued { origin: { path: "removeMember", workspaceId, memberUserId } }` を積む。続きは `continueForcedTermination` が引き受ける | |
| 継続要求の `origin` | 内容を確認する | `memberUserId` を必ず運ぶ。スコープだけを運ぶ形では、続きが他のメンバーのジョブと匿名ジョブまで取り消してしまい、上の 2 行（「触れられず、実行が続く」「取り消されない」）を 2 巡目で破る | |
| 他のメンバーが要求した実行中ジョブが同じワークスペースにある | 除名する | 触れられず、実行が続く | |
| そのワークスペースのノートに対する匿名の PDF 書き出しジョブが実行中 | 除名する | `requestedBy: null` は除名対象と一致しないため取り消されない | |
| 除名対象が自分の個人ノートに対して持つ実行中ジョブがある | 除名する | `scope` が `user` のため対象に入らず、取り消されない | |
| 除名対象が別のワークスペースで持つ実行中ジョブがある | 除名する | `scope` が異なるため取り消されない | |
| 取り消し対象のワーカーがリース有効で実行中 | 除名する | `Job.cancel` はリースを検査せず終端化するため、ワーカーの生存を待たずに取り消される | |
| 取り消した `kind: "conversion"` のジョブの対象ノートが `processing` のまま | 除名する | 「共通: 強制終端の後始末」に従い `Note.markConversionFailed("canceled")` が同一 UoW で保存され、ノートが `failed(canceled)` になる（ワークスペースに残るノートが「変換中」の表示で固定されない） | |
| 取り消した `kind: "regeneration"` のジョブ | 除名する | 本文は `ready` のまま変更されない | |
| 取り消した batch 親（除名対象が要求した一括ダウンロード）に、既に成功した子がある | 除名する | 「共通: 強制終端の後始末」の 2 に従い、`JobRepository.listChildren` で引いた子のうち `succeeded` のものの artifact だけが `deleteFiles` で破棄される（回収しないと、アクセス権を失った利用者の個人ストレージにワークスペースのノート本文を含む一括ダウンロードの生成物が 7 日残る） | |
| 取り消した単体ジョブ（batch 親ではない） | 除名する | 生成物の回収は起きない。`Job.cancel` が受け取るのは `QueuedJob \| RunningJob` で、`artifact` を持つのは `succeeded` のジョブだけだからである | |
| 除名対象が既に組み立て終えた ZIP や成功済みの PDF が期限内に残っている | 除名する | 終端させる集合が未終端のジョブだけであるため破棄されず、期限の経過による `collectExpiredArtifacts` の自動回収に委ねられる | |
| 除名した | 取り消しの契機を確認する | 取り消しは本ユースケースの手順内で行われる（`workspace.membership.removed` の購読で後から行うのではない） | |
| 存在しないメンバーシップ ID | 除名する | `NotFoundError("MEMBERSHIP_NOT_FOUND")` が投げられる | |
| 除名と対象者Job終端 | transactionを確認する | 同じworkspace DOのlocal transactionで成立し、他workspaceのJobを触らない | |
| local commit後にdirectory更新が遅延 | 対象者が操作する | 一覧に一時表示されてもworkspace scopeのMembership再確認で拒否される | |
| 古いrole eventが後着 | directoryを更新する | source version条件により削除済みedgeを復活させない | |
