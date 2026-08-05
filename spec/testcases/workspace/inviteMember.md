# テストケース: inviteMember

| 前提条件 | 操作 | 期待結果 | 実装ステータス |
|---|---|---|---|
| owner である | 未参加のメールアドレスを editor で招待する | `PendingInvitation` が作られ、招待メールが送られ、招待 URL が返る | |
| owner である | owner ロールで招待する | 招待が作られる | |
| editor である | 招待する | `BusinessRuleError(InsufficientRole)` が投げられる | |
| 既にメンバーのメールアドレス | 招待する | `ConflictError("ALREADY_MEMBER")` が投げられる | |
| 同じメールアドレスに保留中の招待がある | 再度招待する | `resendInvitation` を呼ぶ末尾呼び出しになり、トークンと期限が更新される。`inviteMember` は手順 5 までに書き込みを行わないため `run` の入れ子は生じず、新しい招待行は作られない | |
| 保留中の招待が editor で、owner を指定して再度招待する | 再度招待する | ロールは editor のまま変わらない（変えたい場合は取り消してから招待し直す）。返る `role` も既存の招待の値 | |
| — | 形式が不正なメールアドレスで招待する | `BusinessRuleError(InvalidEmail)` が投げられる | |
| — | 未知のロールで招待する | `BusinessRuleError(InvalidRole)` が投げられる | |
| 直近 24 時間に 49 件招待済み | 招待する | 招待が成立する（上限 50 件の境界値） | |
| 直近 24 時間に 50 件招待済み | 招待する | `ValidationError("INVITATION_LIMIT_REACHED")` が投げられる（境界値。レート制限ではなくクォータであり、解除までの時間は添えない） | |
| 上限に達した状態で招待が 1 件受諾される | 招待する | 未処理の件数が減るため成功する（時間の経過を待たずに枠が空く） | |
| メール送信基盤が失敗する | 招待する | 招待は成立し、送信失敗が記録される | |
| 招待作成直後 | 有効期限を確認する | 発行から 14 日後になっている | |
| 新規招待 | route処理を確認する | global reserved → local Invitation commit → global activeの順で、active後にメールを送る | |
| route予約後にlocal commitが失敗する | 再試行する | reservationをabandonし、Invitationもメールも残らない | |
| local commit後にactivate応答を失う | recoveryする | 同じoperation IDでactive化し、Invitationを二重作成しない | |
