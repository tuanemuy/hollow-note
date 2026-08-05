# テストケース: pruneExpiredAuthState

| 前提条件 | 操作 | 期待結果 | 実装ステータス |
|---|---|---|---|
| 期限切れのセッションが 3 件、期限内が 2 件 | 実行する | 期限切れの 3 件だけが削除され、`sessions: 3` が返る | |
| `expiresAt` が基準時刻とちょうど同じセッション | 実行する | 削除される（境界は `expiresAt <= now`。`Session.isExpired` と同じ判定） | |
| `expiresAt` が基準時刻の 1 ミリ秒後のセッション | 実行する | 削除されない（境界値） | |
| 期限切れのセッションを削除した | 削除前後で `authenticateSession` を呼ぶ | どちらも `ValidationError("UNAUTHENTICATED")` になる（期限切れは元から認証されないため、削除で結果は変わらない） | |
| 期限切れの `email_verification` / `password_reset` トークンがある | 実行する | 削除され、`authTokens` に数えられる | |
| 消費済みで期限を過ぎたトークンがある | 実行する | 削除される（単回性は消費時の条件付き更新が担保しており、行の残存に依存しない） | |
| 消費済みだが期限内のトークンがある | 実行する | 削除されない（境界は `AuthToken.isExpired` と同じ `expiresAt <= now`） | |
| 期限切れのログイン試行記録がある | 実行する | 削除され、`loginAttempts` に数えられる | |
| ロック中の記録がある（`failureCount >= 10` かつ最終失敗から 15 分以内） | 実行する | 記録の期限（最終失敗から 24 時間）はロックの解除（同 15 分）より後に来るため削除されず、ロックの解除が早まらない | |
| コールバックが返らなかったサインイン用の認可フロー状態がある | 実行する | 削除され、`oauthFlowStates` に数えられる | |
| 連携用（`intent: "integration"`）の認可フロー状態も期限切れになっている | 実行する | 同じ `OAuthStateStore` に載るため同時に削除される（Integration 側に同種の定期掃除は置かない） | |
| 期限内の認可フロー状態がある | 実行する | 削除されず、コールバックで `take` できる | |
| 4 種とも対象が 0 件 | 実行する | すべて 0 件で成功する | |
| 直前に実行済み | 続けてもう一度実行する | 2 回目は対象が残っていないため 4 種とも 0 件で終わる（冪等） | |
| `AuthTokenRepository.deleteExpired` が失敗する | 実行する | 当該shard/tableの継続だけをbackoffし、他shard/tableの最低枠は進む | |
| あるshardの4表すべてが失敗する | 実行する | cursorを失わず再試行し、上限超過時はDLQと運用通知へ送る | |
| 実行時 | Unit of Work の利用を確認する | table削除を横断UoWへ入れず、routing catalog上のcontinuation cursor更新だけを原子的に保存する | |
| 実行時 | 基準時刻の取得元を確認する | 基準時刻は外部入力で受けず `clock` から得る | |
| 1 shardの各表に期限切れ行が250件ある | Cronを実行する | 1 commandは1表100件以下でyieldし、generation/table/shard cursorから継続して全件を回収する | |
| 100件削除後に応答を失う | continuationを再実行する | 同じkeysetから冪等に再開し、他表・他shardの最低処理枠も維持する | |
| target shardで100件削除後、run checkpoint前に停止する | continuationを再実行する | 保存済み入力cursorから同じDELETEを安全に再実行し、cursor checkpointと次Queue outboxだけをcatalog transactionでcommitする | |
| reshard中 | 実行する | 旧新generationを最大32 shard・同時6接続で処理し、cursor generationを混在させない | |
| 同じhourのCronが同時に2回起動する | 実行する | 同じrun leaseを原子的にclaimし、片方はno-opとなってactive laneは最大6のまま | |
| 32 shardのrunが次hourにも未完了 | 次hourのCronを起動する | 新しいrunを作らず最古running runの固定`asOf` / positionを再開し、kind全体でactive laneを6以下に保つ | |
| lane owner停止後に10分leaseが切れる | 次Cronで回復する | 同じrun/table/cursor positionを新ownerがclaimし、重複runを作らず完了まで進める | |
| completed maintenance runが30日を越えて250件ある | Cronを実行する | `(expiresAt, runId)` keysetで100件ずつ回収し、running runは削除しない | |
| completed runの`expiresAt`が固定`asOf`と同時刻 | 共通prunerを実行する | `expiresAt <= asOf`として回収し、1ミリ秒後の行は残す | |
| completed runが101件あり、最初の100件commit後に応答を失う | 共通prunerを再実行する | 同じcursorから冪等に再実行し、100+1件を欠落なく回収する | |
| LoginAttempt/OAuthStateが同じ`expiresAt`で101件ある | 実行する | それぞれ`key` / `state`をtie-breakにした複合keysetで100+1件を重複・欠落なく回収する | |
