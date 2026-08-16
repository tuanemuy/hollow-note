# テストケース: deleteAccount

| 前提条件 | 操作 | 期待結果 | 実装ステータス |
|---|---|---|---|
| 通常の利用者 | 正しいメールアドレスを入力して削除する | usecaseは`operationId` / `status: accepted`を返し、presentationが読み取り専用status ticketを署名して202応答へ加える。Userは直ちに`deleting`、session / tokenは失効する | |
| session/token行が各10,000件ある | 削除を受理する | `authEpoch`更新で全件を即時失効し、物理行は各100件pageのack完了までfinalizeを待つ | |
| Session/AuthToken旧世代行が各101件ある | residue cleanupする | payloadの`table`でSessionを100+1件処理してからAuthTokenへ切り替え、AuthToken残件0確認後だけreceiptをackする | |
| Session→AuthToken phase切替の応答を失う | recoveryする | 保存済み`table`から再開し、Session phaseへ戻らずfinalize条件を満たす | |
| cleanup中にさらに`authEpoch`が進む | 継続する | payload世代より新しい資格行を削除せず、User世代を巻き戻さない | |
| personal Note writeがbarrier commandより先にDOへ到着する | 削除を開始する | writeを先に確定し、barrier ack後のowner scanがその行も回収する | |
| personal Note/Tag/Storage/Usage writeがbarrier後に到着する | commitする | 共通`assertWritable`が`ACCOUNT_DELETING`で拒否し、cleanup cursor後方へ新規行を差し込まない | |
| account deletion cleanupが長期化する | local receiptをpruneする | running barrierは`expires_at = NULL`で回収されず、全local ackまでowner検査を継続できる | |
| 全local cleanup ack後 | receiptを完了する | completedへ縮約して120日保持し、遅延重複をno-op化してから最大100件ずつ回収する | |
| session失効後 | status ticketで進捗を読む | 当該operationの状態だけが返り、他operationや利用者データは読めない | |
| — | 誤ったメールアドレスを入力する | `ValidationError("CONFIRMATION_MISMATCH")`。operationは作られない | |
| 同じ利用者が同じ`requestId`で削除を再要求する | 同じ確認入力で実行する | 新しいoperationを作らず既存 `operationId` / status ticketを返し、terminal結果はticketから読める | |
| 唯一ownerでrejected後、owner移譲を済ませる | 新しい`requestId`で再要求する | 旧rejected headerを120日保持したまま新operation/manifestを作り、削除を再試行できる | |
| 120日の窓に保持中のterminal行（`completed` / `rejected`）が8件ある | 9つ目の新しい`requestId`で再要求する | `BusinessRuleError(AccountDeletionRetryLimitExceeded)`となり、terminal control-plane rowを利用者単位で8件以下に保つ | |
| running中に別`requestId`で再要求する | 実行する | running operationは1件に保ち、そのoperation IDを返す | |
| `requestId`がUUID形式でない | userRequestを送る | `ValidationError("INVALID_REQUEST_ID")`でoperationを作らない | |
| 唯一のownerであるworkspaceがある | prepareする | 全prepare lock/barrierをreleaseしてUserは`active`へ戻り、manifest item縮約後にoperationが`rejected`になる。scope cleanupは始まらない | |
| 全scopeのprepare前 | 別ownerが脱退・降格する | local owner集合とlock取得が直列化され、prepareかowner変更の片方だけが成功する | |
| 全scope prepare後 | 別ownerが脱退・降格・除名される | `MEMBERSHIP_REMOVAL_PREPARED`で拒否され、commitはLastOwnerにならず完了できる | |
| 3scope中2scopeをprepare後に3つ目が失敗する | rollback prepareする | 2scopeのlockを冪等にreleaseし、Membership/Job/個人データは一切削除されていない | |
| prepare失敗時にpersonal barrier解除応答を失う | recoveryする | 同じoperation IDで`abortPersonalAccountDeletion`を再送し、workspace lockとbarrier双方の解除ack後だけUserをactiveに戻す。operation rejectedはmanifest縮約後だけ公開する | |
| 数千membership item固定後にprepareが失敗する | rollbackする | 全lock/barrier release ack後に`compactingRejected`へ進み、itemsを100件ずつ消して0件時だけoperation/manifestをrejectedにし、headerを120日保持する | |
| 250 workspace lock取得後に次scopeのprepareが失敗する | `rollbackRelease`を進める | release未ack itemを100+100+50件、外部接続最大6のwaveで配送し、全release ack前はUser active/manifest compactへ進まない | |
| release 100件のack transaction後に応答を失う | rollback continuationを再実行する | 保存済みrelease ackを飛ばして残件だけを再配送し、二重releaseなく収束する | |
| workspace prepareはcommitしたがUserId manifestへのprepare ack応答を失い、同waveの別scopeが失敗する | rollbackする | 送信前の`prepareDispatchedAt`を正本に当該workspaceもreleaseし、孤児lockを残さない | |
| prepare / commit応答を失う | recoveryする | 同じoperation IDで保存済みphaseを返し、二重lock・二重削除なしで再開する | |
| prepareから10分を越える | 実行する | 2分ごとのrenewでlockを維持し、全scopeの残存5分以上を確認するまでcommitへ入らない | |
| renew応答を失う | 実行する | destructive cleanupを開始せず、global recoveryがoperation stateを確認してrenewする | |
| rejected後にrelease応答を失う | membershipを変更する | 期限だけでlockを無視せず、recoveryがrejectedを確認してreleaseした後に成功する | |
| committed後にorchestratorが停止する | recoveryする | lockは自動失効せず、LastOwner invariantを保ったままcleanupを再開する | |
| personal scopeに実行中Jobが150件ある | 削除する | 100件をlocal transactionで終端・後始末し、`scheduled_tasks` とAlarmで残りを継続する。他scopeのJobを同じtransactionに入れない | |
| 同scopeに大量の期限回収・projection taskがある | 削除cleanupを進める | security cleanupはpriority 0の最低枠で先行し、低優先taskに飢餓させられない | |
| personal scopeに匿名PDF Jobがある | 削除する | `listActiveByScope(user)` で拾われて取り消される | |
| workspace scopeに本人が要求したJobがある | 削除する | directoryで列挙されたそのscopeの `listActiveByRequester` で拾われる | |
| 先行する脱退のdirectory edgeが`removing` | 削除する | そのscopeも固定し、先行cleanupのackを待ってからfinalizeする | |
| pending membership reservationがある | prepare後に別scopeで失敗する | prepare中はreservation変更lockだけを取り、rollback releaseで元のpending状態を保つ。取消はcommit後だけ行う | |
| 過去に脱退済みでdirectory edgeが消えている | residueを確認する | そのscopeに本人のJob正データ・BackupRecordは残っていない（edge削除前cleanupの不変条件） | |
| workspace scopeに他メンバーのJobがある | 削除する | 取り消されない | |
| activeな変換JobのNoteが`processing` | scope cleanupを実行する | Job終端と `Note.markConversionFailed("canceled")` が同じscope-local transactionで保存される | |
| batch親に成功済みartifactがある | scope cleanupを実行する | 強制終端の後始末に従い同じscopeでartifact metadataを回収する | |
| workspace所有Noteを作成していた | workspace cleanupを実行する | Noteは残り、local著者投影が「退会した利用者」へ変わってからMembershipを削除する | |
| 過去に脱退したworkspaceに本人作成のNoteが残る | 削除する | membership edgeではなく`note_routes(created_by)`から発見し、local/public両方の著者表示を消去する | |
| 本人作成routeが数千件ある | author redactionする | 100件のキーセットpageと個別要求で有界に進み、全local/public ack前はfinalizeしない | |
| redaction完了後に削除前のNote eventが遅延到着する | 投影する | `redactionVersion`より古いauthorVersionでは旧表示名・handleを復活させない | |
| personal Note / Tag / File / Backup / Usageがある | personal scope cleanupを実行する | current scopeだけで全データを削除し、完了ackを返す | |
| personal cleanupの全正データとlocal task/event ackが揃う | 最終local UoWをcommitする | barrierをcompletedへ進めて120日保持し、そのDO ack後だけUserId manifestの`personalCleanup` receiptを記録する | |
| job/note/tag/storage/backup/usage/localProjection/outboxのうち1 componentが未ack | barrier完了を試す | operation専用component flagが不足するためrunningのまま。別operationのtask完了やscope全体のtask空判定で代用しない | |
| 各componentの最終pageが0件になる | cleanupを継続する | そのcomponent ackと次taskなしを同じscope-local UoWで保存し、応答喪失時も二重完了しない | |
| barrier完了commit後にDO応答を失う | cleanup commandを再送する | 同じoperation IDのcompleted receiptを返し、UserId manifestへackしてrunning barrierを永久残存させない | |
| Google Drive連携と複数scopeのbackup記録がある | 削除する | global connectionと各scopeのrecordを別々に削除する。Drive上のファイルは削除しない | |
| 1つのscope commandの応答が失われる | recoveryを実行する | 同じoperation IDで再配送され、`applied_operations` により二重適用されず再開する | |
| 一部scopeが未完了 | finalizeを試す | Userは`deleting`のままでPIIを削除せず、再試行時刻を記録する | |
| 全scopeとglobal cleanupが完了 | finalizeする | IdentityのPIIを削除し、Userを`deleted` tombstoneにして `identity.user.deleted` を発行する | |
| 公開personal Noteがあった | 完了後にURLを開く | route / public projectionがtombstoneになり「見つかりません」 | |
| 完了後 | 同じメールアドレスで登録する | uniqueness reservationが解放済みで、新しいUserとして登録できる | |
| OAuth Identityを持つ利用者 | 削除完了後に同じprovider accountで登録する | providerAccount reservationも解放済みで、deleted Userへlookupされない | |
| active/removing/pendingのmembership edgeが合計250件ある | manifestを構築する | edge keysetを100+100+50件で固定し、各pageのcursorと次taskを同じtransactionで保存する | |
| membership pageのcommit後に応答を失う | build continuationを再実行する | 同じoperation ID+edge keyで重複せず、保存済みcursorから次pageへ進む | |
| 250 workspaceのprepareが必要 | dispatchする | 1page最大100件、外部scope同時6接続以下のwaveで処理し、全prepare ackまでauthor route scanへ進まない | |
| actorのworkspace Note createがprepare barrierより先にcommitする | author route manifestを構築する | 全barrier ack後にroute scanするため作成済みrouteを固定し、local/public redaction対象に含める | |
| actorのworkspace writeがprepare barrier後に到着する | commitする | `assertActorWritable`が拒否し、author route scan後方へ対象が増えない | |
| author routeが250件ある | manifestを構築する | 署名generation cursorで100+100+50件を固定し、各itemのlocal/public ackを保存する | |
| author route pageのcommit後に応答を失う | build continuationを再実行する | operation ID+NoteIdで重複せず、headerの署名cursorから次pageへ進む | |
| ack済みaccount manifest itemが101件ある | compactする | 100件削除してcontinuationを保存し、次turnの1件後だけheaderをcompletedにする | |
| ack済みaccount manifest itemが1,000件ある | compactする | 10 turnに分け、各transactionを100件以下に保つ | |
| completed/rejected account manifest headerが期限到達済みで101件ある | terminal prunerを実行する | `(expiresAt, operationId)` keysetの100+1件で回収し、running/building/compacting headerは残す | |
| terminal header 100件の削除commit後に応答を失う | prune continuationを再実行する | 同じ固定`asOf`/cursorから冪等に再開し、未回収headerを欠落させない | |
| 32 UserId shardにterminal headerがありrunが次hourまで未完了 | 次Cronで再開する | `accountManifestPrune`の同じrun/generation/shard positionを再開し、kind全体のactive laneを最大6に保つ | |
| UserId shardでterminal DELETE後、run checkpoint前に停止する | laneを再実行する | 同じ入力cursorのDELETEを冪等再実行し、次cursor/Queue outboxをcatalog transactionでcheckpointする | |
| rejected header/operationが120日を越える | terminal prunerを実行する | matching manifestとdistributed operation/request keyを同じUserId-shard transactionで回収し、running operationには触れない | |
| terminal headerの`expiresAt`が固定`asOf`と同時刻 | pruneする | 120日境界到達として回収し、1ミリ秒後のheaderは残す | |
| completed personal barrierが120日を迎える | scope Alarmを実行する | 固定`asOf`で最大100件を回収し、running barrierは対象にしない | |
| barrier完了とprune task保存の直後に応答を失う | Alarm/recoveryする | 同じscope-local UoWにtaskが残るため、期限後にcompleted receiptを回収できる | |
