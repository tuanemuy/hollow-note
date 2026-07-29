# テストケース: signInWithPassword

| 前提条件 | 操作 | 期待結果 | 実装ステータス |
|---|---|---|---|
| `ActiveUser` とパスワード認証手段がある | 正しいメールとパスワードでサインインする | セッションが発行され、失敗回数が 0 に戻る | |
| `ActiveUser` がある | 誤ったパスワードでサインインする | `ValidationError("INVALID_CREDENTIALS")` が投げられ、失敗回数が 1 増える | |
| 未登録のメールアドレス | サインインする | `ValidationError("INVALID_CREDENTIALS")` が投げられる（利用者不在と区別されない） | |
| Google のみで登録した利用者 | メールとパスワードでサインインする | `ValidationError("INVALID_CREDENTIALS")` が投げられる | |
| `PendingUser` がある | 正しいパスワードでサインインする | `ValidationError("EMAIL_NOT_VERIFIED")` が投げられ、セッションは発行されない | |
| 失敗が 2 回記録されている | 3 回目に失敗する | `ValidationError("LOGIN_THROTTLED")` が投げられ、待機秒数が添えられる | |
| 失敗が 9 回記録されている | 10 回目に失敗する | `ValidationError("LOGIN_LOCKED")` が投げられ、解除時刻が添えられる | |
| ロック中 | 正しいパスワードでサインインする | `ValidationError("LOGIN_LOCKED")` が投げられる | |
| ロックの期限が切れている | 正しいパスワードでサインインする | サインインが成功する | |
| — | レート制限の鍵を確認する | `LoginAttemptKey.forSignIn(email, clientKey)` で `signIn:{正規化済みメールアドレス}:{clientKey}` の形に組み立てられる | |
| 同じメールアドレスに別の `clientKey` から失敗する | 失敗を記録する | 鍵が異なるため別の行になり、互いの待機・ロックに影響しない | |
| 同じ利用者が共有リンクのパスワード照合で失敗している | サインインに失敗する | 名前空間が `signIn:` と `share:` で分かれているため同じ行に集まらず、互いのロックを誘発しない | |
| 認証に失敗した（利用者不在・手段なし・パスワード相違） | 失敗を記録する | `LoginAttemptStore.put(LoginThrottlePolicy.recordFailure(attempt, now), LoginThrottlePolicy.attemptTtlMs)` が呼ばれ、TTL は 24 時間になる | |
| 記録の TTL | ロック期間と比べる | 24 時間はロック期間の 15 分より十分長く、ロック中の記録が期限切れで消えて総当たりが続けられることがない | |
| 認証に成功した | 記録を確認する | `LoginAttemptStore.clear(key)` が呼ばれ、期限を待たず失敗の記録が消える | |
| `PendingUser` で正しいパスワードを送った | 記録を確認する | `put` は呼ばれない（資格情報は正しく、再送すれば通る状態のため失敗として記録しない） | |
| 待機中・ロック中と判定された | 照合の有無を確認する | `UserRepository.findByEmail` 以降の照合を行わずに `LOGIN_THROTTLED` / `LOGIN_LOCKED` を返す | |
| `LoginAttemptStore` への書き込み | トランザクションの境界を確認する | Unit of Work には入れない（記録は集約の不変条件に関与せず、例外を投げる経路でも書き込みが残らなければレート制限が機能しないため） | |
| `put` / `clear` の書き込みが失敗した | サインインする | 記録して継続し、認証の結果そのものは変えない | |
