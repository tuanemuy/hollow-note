# テストケース: deleteAccount

| 前提条件 | 操作 | 期待結果 | 実装ステータス |
|---|---|---|---|
| ワークスペースの owner でない利用者 | 正しいメールアドレスを入力して削除する | 利用者が削除され、`user.deleted` が発行され、セッションが破棄される | |
| — | 誤ったメールアドレスを入力して削除する | `ValidationError("CONFIRMATION_MISMATCH")` が投げられ、削除されない | |
| 唯一の owner であるワークスペースがある | 削除する | `BusinessRuleError(LastOwnerCannotLeave)` が投げられ、削除されない | |
| owner が 2 名いるワークスペースの owner | 削除する | 削除が成功する | |
| 実行中の変換ジョブがある | 削除する | ジョブがキャンセルされてから削除される | |
| 取り消し対象の収集 | 引くクエリを確認する | `JobRepository.listActiveByRequester(userId)` と `JobRepository.listActiveByScope({ type: "user", userId })` の両方を引き、`jobId` で重複を除いてから `Job.cancel` する | |
| 自分の個人ノートを対象とする、自分が要求した実行中ジョブ | 削除する | 両方の一覧に現れるが重複が除かれ、`Job.cancel` は 1 回だけ適用される | |
| 自分の個人ノートに対する匿名の PDF 書き出しジョブが実行中 | 削除する | `requestedBy: null` は `listActiveByRequester` に現れないが、`listActiveByScope({ type: "user", userId })` で拾われて取り消される | |
| 参加ワークスペースのノートを対象に自分が要求した実行中ジョブ | 削除する | `scope` が `workspace` のため `listActiveByScope` には現れないが、`listActiveByRequester` で拾われて取り消される | |
| 他のメンバーが要求した、そのワークスペースのノートの実行中ジョブ | 削除する | どちらの一覧にも現れず、取り消されない | |
| 取り消し対象のワーカーがリース有効で実行中 | 削除する | `Job.cancel` はリースを検査せず終端化するため、ワーカーの生存を待たずに取り消される | |
| 取り消した `kind: "conversion"` のジョブの対象がワークスペース所有ノートで `processing` のまま | 削除する | 「共通: 強制終端の後始末」に従い `Note.markConversionFailed("canceled")` が同一 UoW で保存され、退会後もワークスペースに残るノート（AC-09）が「変換中」の表示で固定されない | |
| 取り消した `kind: "regeneration"` のジョブ | 削除する | 本文は `ready` のまま変更されない | |
| 取り消した batch 親（一括ダウンロードなど）に、既に成功した子がある | 削除する | 「共通: 強制終端の後始末」の 2 に従い、`JobRepository.listChildren` で引いた子のうち `succeeded` のものの artifact だけが `deleteFiles`（保管ファイルの削除手順）で破棄され、利用者の削除と同一 UoW で保存される | |
| 取り消した単体ジョブ（batch 親ではない） | 削除する | 生成物の回収は起きない。`Job.cancel` が受け取るのは `QueuedJob \| RunningJob` で、`artifact` を持つのは `succeeded` のジョブだけだからである | |
| 同時に別の要求が同じ利用者を更新した | 削除する | `ConflictError("OPTIMISTIC_LOCK_FAILURE")` が投げられ、削除されない | |
| 認証手段・セッション・トークンがある | 削除する | 同一ドメインの FK CASCADE で消える（購読ユースケースの対象外） | |
| ノート・タグ・連携・ジョブ・ファイル・クォータがある | 削除後に関連データを確認する | `identity.user.deleted` の購読ユースケース（`deleteNotesForOwner` / `deleteTagsForScope` / `deleteIntegrationsForUser` / `deleteJobsForRequester` / `deleteMembershipsForUser` / `deleteFilesByOwner` / `deleteQuota`）によって後始末される | |
| ワークスペース所有のノートを作成していた | 削除する | そのノートはワークスペースに残り、作成者は「退会した利用者」と表示される（AC-09。消えるのは個人所有のノートのみ） | |
| 公開ノートを持つ | 削除後にそのノートの URL を開く | 「見つかりません」が返る | |
| 限定公開の共有リンクを持つ | 削除後にそのリンクを開く | 「見つかりません」が返る | |
| Google Drive にバックアップがある | 削除する | 記録は `deleteIntegrationsForUser` が消すが、Drive 上のファイルは削除されない | |
| 削除後 | 同じメールアドレスで登録する | 新しい利用者として登録できる | |
