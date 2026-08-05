# テストケース: updateProfile

| 前提条件 | 操作 | 期待結果 | 実装ステータス |
|---|---|---|---|
| `ActiveUser` がいる | 表示名と自己紹介を更新する | 値が更新され、公開ページの表示に反映される | |
| 公開ノートを持つ `ActiveUser` | 表示名を変更する | `identity.user.profileUpdated` が発行され、`projectNoteChanges` が読み取りモデルの著者表示名を更新する（検索結果・公開ページの著者名に反映される） | |
| 公開ノートを持つ `ActiveUser` | 表示名は変えず自己紹介だけを更新する | `identity.user.profileUpdated` は発行されず、読み取りモデルは更新されない | |
| ハンドル未設定の `ActiveUser` | 未使用のハンドルを設定する | ハンドルが設定され、`User.assignHandle` が `identity.user.handleChanged`（`previousHandle: null`）を**初回設定でも無条件で**発行する | |
| ハンドル未設定のままワークスペース所有の公開ノートを作っていた `ActiveUser` | ハンドルを初めて設定する | `note_routes(created_by)` のbounded fan-outが各Noteをversion付き完全snapshotで再投影し、`author_handle` が埋まる | |
| 初回設定後 | `searchPublicNotes` の結果を確認する | 該当ノートに著者リンクが出る | |
| ハンドルを設定済みから別の値に変更する | 変更する | 同じく `identity.user.handleChanged`（`previousHandle` は旧ハンドル）が発行され、購読側は初回設定と変更を区別せず現在値で上書きする | |
| 他の利用者が使用中のハンドル | そのハンドルを設定する | `ConflictError("HANDLE_ALREADY_USED")` が投げられる | |
| 新handle reservation後・UserId shard更新前に失敗する | 再試行する | 同じoperation IDで予約を再利用し、User更新後にactivateする | |
| UserId shard更新後・reservation activate応答を失う | recoveryする | User versionと値が一致するためactivateし、旧handle reservationをreleasingへ進める | |
| — | 2 文字のハンドルを設定する | `BusinessRuleError(InvalidHandle)` が投げられる | |
| — | 3 文字のハンドルを設定する | 成功する（長さの境界値） | |
| — | 30 文字のハンドルを設定する | 成功する（長さの境界値） | |
| — | 31 文字のハンドルを設定する | `BusinessRuleError(InvalidHandle)` が投げられる | |
| — | 予約語（`settings`）をハンドルに設定する | `BusinessRuleError(HandleReserved)` が投げられる | |
| — | 大文字を含むハンドルを設定する | 小文字に正規化されて保存される | |
| ハンドル設定済み | ハンドルを空文字列にする | ハンドルが解除され、`user.handleChanged` が発行される | |
| ハンドル設定済みで公開ノートがある | ハンドルを変更する | 旧ハンドルの URL は「見つかりません」になり、新しい URL で到達できる | |
| `PendingUser` | 更新する | `ValidationError("EMAIL_NOT_VERIFIED")` が投げられる | |
| — | 51 文字の表示名にする | `BusinessRuleError(InvalidDisplayName)` が投げられる | |
| — | 501 文字の自己紹介にする | `BusinessRuleError(InvalidBio)` が投げられる | |
| 同時に別の要求が同じ利用者を更新した | 更新する | `ConflictError("OPTIMISTIC_LOCK_FAILURE")` が投げられる | |
