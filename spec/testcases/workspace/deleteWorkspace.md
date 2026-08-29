# テストケース: deleteWorkspace

| 前提条件 | 操作 | 期待結果 | 実装ステータス |
|---|---|---|---|
| owner である | 正しいワークスペース名を入力して削除する | operation IDとacceptedが返り、manifest/cleanup完了後にワークスペースが削除されてoperation ID付き`workspace.deleted`が発行される | |
| `beginDeletion`をcommitする | acceptedを返す | 同じUoWで最初の`workspace.deletionLocalContinued { operationId }`が保存され、accepted後に停止してもAlarmから開始できる | |
| — | 誤った名前を入力して削除する | `ValidationError("CONFIRMATION_MISMATCH")` が投げられ、削除されない | |
| editor である | 削除する | `BusinessRuleError(InsufficientRole)` が投げられる | |
| 実行中の変換ジョブがある | 削除する | ジョブがキャンセルされてから削除される | |
| 取り消し対象の収集 | 引くクエリを確認する | `JobRepository.listActiveByScope({ type: "workspace", workspaceId })` だけを `limit: 100` で引き、返ったすべてに `Job.cancel` を適用する（要求者では絞らない） | |
| 網が 100 件を返した | 削除する | 100 件を終端させ、`origin: { path: "deleteWorkspace", workspaceId, deletionOperationId }`の継続を積む | |
| 網が 40 件を返した | 削除する | 40 件を終端させ、継続要求は積まない | |
| 継続要求の `origin` | 内容を確認する | 選択用workspaceIdに加えてadmission用deletionOperationIdを運び、各turnでowner一致を確認する | |
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
| メンバーシップと招待がある | 削除する | userId/tokenHash/local IDをmanifestへ固定し、local edgeを100件ずつ消してからRESTRICT下でWorkspaceを最後に消す | |
| ノート・タグ・ファイル・クォータがある | 削除後に関連データを確認する | `workspace.deleted` の購読ユースケース（`deleteNotesForOwner` / `deleteTagsForScope` / `deleteFilesByOwner` / `deleteQuota`）によって後始末される | |
| ワークスペース所有ノートのタグが個人スコープのタグと同名 | 削除する | `deleteTagsForScope` はワークスペーススコープのタグと付与だけを消し、個人スコープの同名タグは残る | |
| ワークスペース所有ノートのバックアップ記録がある | 削除する | `workspace.deleted` は購読されず、`deleteNotesForOwner` が 1 件ずつ発行する `note.purged` を購読する `deleteBackupRecordsForNote` が削除する（`backup_records` は owner 列を持たない） | |
| 削除後 | 同じスラッグで新しいワークスペースを作る | 作成できる | |
| directory tombstoneを保存する | rowを確認する | `slug = null`・表示PII redactedであり、tombstone確定後にslug reservationをreleaseする | |
| workspaceを削除する | 物理境界を確認する | Job終端・Workspace/Membership/Invitation削除・cleanup task登録は1つのworkspace DOで複数bounded UoWに分ける | |
| local削除後にglobal更新が遅延 | 公開slugを開く | `workspace_directory` tombstoneによりnot foundとなり、旧scopeへ権限を与えない | |
| directory cleanupの応答を失う | recoveryを実行する | local manifestのuserId/tokenHashとoperation IDでslug / invitation route / membership edgesを冪等に削除する | |
| メンバー・招待が数千件ある | 削除する | manifest作成/local削除/global cleanupを100件pageで継続し、Workspace親DELETEへ一括CASCADEしない | |
| 最後のlocal edge削除後・Workspace削除前に停止する | recoveryする | manifestのlocal ackから再開して子0件を確認し、Workspaceとeventを1回だけ保存する | |
| Workspace行削除後にlocal cleanup taskが再開する | taskを処理する | payloadの削除operation IDがcompleted前のmanifest ownerと一致する場合だけcontinuationを受理する | |
| Workspace行削除後に通常writeまたは別operation IDのcleanupが届く | 処理する | manifest header/tombstoneにより`WORKSPACE_DELETING`またはoperation不一致として拒否する | |
| deletionを受理してmanifestを構築中 | 招待発行・受諾、member変更、Note/Job作成を試す | 永続`deleting(operationId)` admissionにより全て`WORKSPACE_DELETING`で拒否され、cursor後方へ新規対象が入らない | |
| manifest page commit後にworkerが停止する | recoveryする | 保存済みcursorと同じoperation IDから再開し、workspaceをactiveへ戻さない | |
| manifest buildまたはlocal edge削除が100件で続く | taskを確認する | page/cursor/ackと次の`workspace.deletionLocalContinued`を同じUoWで保存する | |
| global reservation直後にdeletingへ切り替わる | invite/acceptのlocal commitを試す | 2回目のadmission検査で拒否し、確保済みreservationをabandonする | |
| global directoryをreshard中 | 削除する | manifestの各route keyを旧新generationへdeleteし、ack後にだけmanifestを消す | |
| local/global ack済みmanifest itemが101件ある | 縮約する | 100件を消して`workspace.deletionManifestCompactContinued`を再登録し、残り1件の後にheaderをcompletedにする | |
| ack済みmanifest itemが数千件ある | 縮約する | 各Alarm turnのDELETEは100件以下で、header遷移に全item削除を同居させない | |
| 最終100件削除の応答を失う | recoveryする | 同じoperation IDでitem 0件を確認し、completed tombstoneを1回だけ保存する | |
| workspace内ノートの移動がstage済み、または切替後の後処理中である | 削除する | `WorkspaceOperationLockStore.hasActiveMove` が競合を検出し、移動を完了またはabortするまで `ConflictError("WORKSPACE_MOVE_IN_PROGRESS")` で削除を拒否する | |
| 改名の切替を恒久的に失った workspace を削除する | 削除する | global cleanup は turn が運ぶ候補 2 つ（scope の `slug` と `workspace_directory` の広告値）の両方を `release` するので、`active` のまま取り残された鍵が回収される | |
| directory tombstone の shard が答えない | 削除する | global turn はそこで止まって backoff し、slug 予約を保持したまま directory 行を `active` のまま残す。shard が答え直せば同じ task 行が最後まで運ぶ（広告している URL と解放済みの鍵が同時に存在する窓を作らない） | |
| `workspace_directory` が広告値を答えられない | 削除する | 受理せず `ConflictError("WORKSPACE_DIRECTORY_UNAVAILABLE")` を返し、scope の lifecycle も継続 task も動かさない。答えられるようになってから受理すれば、取り残されていた鍵まで解放される | |
