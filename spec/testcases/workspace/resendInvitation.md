# テストケース: resendInvitation

| 前提条件 | 操作 | 期待結果 | 実装ステータス |
|---|---|---|---|
| owner で保留中の招待がある | 再送する | トークンと期限が更新され、メールが再送される | |
| 再送後 | 古い招待リンクを開く | 「無効です」として扱われる | |
| 受諾済みの招待 | 再送する | `ValidationError("INVITATION_NOT_PENDING")` が投げられる | |
| 取り消し済みの招待 | 再送する | `ValidationError("INVITATION_NOT_PENDING")` が投げられる | |
| 期限切れの招待 | 再送する | 新しい期限で再送される | |
| 他のワークスペースの招待 ID を指定する | 再送する | `NotFoundError("INVITATION_NOT_FOUND")` が投げられる | |
| editor である | 再送する | `BusinessRuleError(InsufficientRole)` が投げられる | |
| 新token予約後にlocal commitが失敗する | 再送する | 新reservationをabandonし、旧tokenは引き続き有効 | |
| local commit後にroute切替応答を失う | recoveryする | 同じoperation IDで旧route revoked / 新route activeを原子的に完了し、新tokenだけが到達可能 | |
