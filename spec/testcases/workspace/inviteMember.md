# テストケース: inviteMember

| 前提条件 | 操作 | 期待結果 | 実装ステータス |
|---|---|---|---|
| owner である | 未参加のメールアドレスを editor で招待する | `PendingInvitation` が作られ、招待メールが送られ、招待 URL が返る | |
| owner である | owner ロールで招待する | 招待が作られる | |
| editor である | 招待する | `BusinessRuleError(InsufficientRole)` が投げられる | |
| 既にメンバーのメールアドレス | 招待する | `ConflictError("ALREADY_MEMBER")` が投げられる | |
| 同じメールアドレスに保留中の招待がある | 再度招待する | 再送として扱われ、トークンと期限が更新される | |
| — | 形式が不正なメールアドレスで招待する | `BusinessRuleError(InvalidEmail)` が投げられる | |
| — | 未知のロールで招待する | `BusinessRuleError(InvalidRole)` が投げられる | |
| 直近 24 時間に 50 件招待済み | 招待する | `ValidationError("RATE_LIMITED")` が投げられる | |
| メール送信基盤が失敗する | 招待する | 招待は成立し、送信失敗が記録される | |
| 招待作成直後 | 有効期限を確認する | 発行から 14 日後になっている | |
