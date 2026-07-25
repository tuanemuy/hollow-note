# テストケース: signUpWithPassword

| 前提条件 | 操作 | 期待結果 | 実装ステータス |
|---|---|---|---|
| 未登録のメールアドレス | 有効なメール・パスワード・表示名・規約同意で登録する | `PendingUser` と `PasswordIdentity` が作られ、確認メールが送られ、`emailVerificationRequired: true` / `sessionToken: null` が返る | |
| 未登録のメールアドレス | 規約に同意せずに登録する | `ValidationError("TERMS_NOT_ACCEPTED")` が投げられ、利用者は作られない | |
| — | 形式が不正なメールアドレスで登録する | `BusinessRuleError(InvalidEmail)` が投げられる | |
| — | 7 文字のパスワードで登録する | `BusinessRuleError(WeakPassword)` が投げられる | |
| — | 128 文字のパスワード（英数字を含む）で登録する | 登録が成功する（上限の境界値） | |
| — | 129 文字のパスワードで登録する | `BusinessRuleError(WeakPassword)` が投げられる | |
| — | 数字のみ 10 文字のパスワードで登録する | `BusinessRuleError(WeakPassword)` が投げられる | |
| — | 空白のみの表示名で登録する | `BusinessRuleError(InvalidDisplayName)` が投げられる | |
| 既に登録済みのメールアドレス | 同じメールアドレスで登録する | 新しい利用者は作られず、`existingAccountNotice` のメールが送られ、応答は未登録のときと同じ | |
| 有効な招待トークンがあり、招待先と同じメールアドレス | 招待トークンつきで登録する | `ActiveUser` が作られ、確認メールは送られず、`sessionToken` が返る | |
| 有効な招待トークンがあり、招待先と異なるメールアドレス | 招待トークンつきで登録する | 通常の登録として扱われ、確認メールが送られる | |
| 期限切れの招待トークン | 招待トークンつきで登録する | 通常の登録として扱われ、エラーにはならない | |
| メール送信基盤が失敗する | 有効な入力で登録する | 登録は成功として返り、送信失敗が記録される | |
| 短時間に同一発信元から大量の試行がある | 登録する | `ValidationError("RATE_LIMITED")` が投げられる | |
| 同じメールアドレスで 2 つの要求が同時に走る | 両方が登録する | 片方は成功、もう片方は `ConflictError("EMAIL_ALREADY_USED")` になる | |
