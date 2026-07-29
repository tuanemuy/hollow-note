# テストケース: verifySharePassword

| 前提条件 | 操作 | 期待結果 | 実装ステータス |
|---|---|---|---|
| パスワード保護された限定公開ノート | 正しいパスワードを送る | 通過証が返り、`passwordUpdatedAt` がノート側と一致する | |
| — | 誤ったパスワードを送る | `ValidationError("INVALID_SHARE_PASSWORD")` が投げられる | |
| 連続して失敗している | 再度失敗する | `ValidationError("RATE_LIMITED")` が投げられる | |
| — | レート制限の鍵を確認する | `LoginAttemptKey.forSharePassword(tokenHash, clientKey)` で `share:{共有トークンのハッシュ}:{clientKey}` の形に組み立てられる。材料は `TokenHash` であり、素の共有トークンを鍵に残さない | |
| — | 判定と記録の順序を確認する | `signInWithPassword` と同じ順序（`LoginAttemptStore.get` →（`null` なら `initial`）→ `LoginThrottlePolicy.evaluate` → 失敗なら `put` / 成功なら `clear`）に従う | |
| 照合に失敗した | 記録を確認する | `LoginAttemptStore.put(recordFailure(attempt, now), attemptTtlMs)` が呼ばれ、TTL は 24 時間になる | |
| 照合に成功した | 記録を確認する | `LoginAttemptStore.clear(key)` が呼ばれる | |
| 同じ共有リンクに別の `clientKey` から失敗する | 照合する | 鍵が異なるため別の行になり、互いの待機・ロックに影響しない | |
| 同じ端末が別の共有リンクで失敗している | 照合する | `tokenHash` が異なるため別の行になる | |
| 同じ利用者がパスワードサインインで失敗している | 照合する | 名前空間が `share:` と `signIn:` で分かれているため同じ行に集まらず、互いのロックを誘発しない | |
| 待機中・ロック中と判定された | 照合する | `PasswordHasher.verify` に進まずに `RATE_LIMITED` を返す | |
| `LoginAttemptStore` への書き込み | トランザクションの境界を確認する | `signInWithPassword` と同じく Unit of Work には入れない。書き込みの失敗は記録して継続し、照合の結果は変えない | |
| パスワードが設定されていない限定公開ノート | 照合する | `NotFoundError("NOTE_NOT_FOUND")` が投げられる | |
| 存在しない共有トークン | 照合する | `NotFoundError("NOTE_NOT_FOUND")` が投げられる | |
| 通過証を取得した後に所有者がパスワードを変更した | その通過証で閲覧する | 再度パスワードが求められる | |
| 通過証を取得した後に所有者がパスワードを解除した | その通過証で閲覧する | パスワードなしで閲覧できる | |
