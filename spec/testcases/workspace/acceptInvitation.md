# テストケース: acceptInvitation

| 前提条件 | 操作 | 期待結果 | 実装ステータス |
|---|---|---|---|
| activeなinvitation routeがある | preview/acceptする | `resolveActive`で1つのworkspace scopeだけを解決する | |
| local受諾とmembership edge activationが完了 | 完了する | `consume`でrouteがrevokedになり、同じtokenは再利用できない | |
| consumeの応答を失う | recoveryする | 同じoperation IDで再試行し、既にrevokedなら成功する | |
| 有効な保留中の招待、サインイン済み | 受諾する | `Membership` が作られ、招待が `accepted` になり、指定ロールが付く | |
| 招待されたメールと異なるアカウントでサインイン中 | 受諾する | 受諾が成功する（リンクを認可の根拠とする） | |
| 存在しないトークン | 受諾する | `NotFoundError("INVITATION_NOT_FOUND")` が投げられる | |
| 期限切れの招待 | 受諾する | `BusinessRuleError(InvitationExpired)` が投げられる | |
| 取り消し済みの招待 | 受諾する | `ValidationError("INVITATION_NOT_PENDING")` が投げられる | |
| 既にメンバー | 受諾する | 招待は `accepted` になり、既存のロールは変更されない | |
| ワークスペースが削除済み | 受諾する | `NotFoundError("WORKSPACE_NOT_FOUND")` が投げられる | |
| 同じ招待で 2 つの要求が同時に走る | 両方が受諾する | `Membership` は 1 件だけ作られる | |
| 受諾後 | そのワークスペースのノート一覧を開く | ロールに応じた操作が可能になる | |
| invitation token | routeを確認する | global `invitation_routes` からworkspace scopeを解決し、正データはそのDOで読む | |
| Userがdeleting | 受諾する | pending membership reservationを作らず拒否する | |
| pending edgeを予約後、account deletionがprepare lockを取得した | activationをclaimする | UserId shardの条件付き更新が拒否し、workspaceへlocal commitしない | |
| activation claim後・workspace commit前にaccount deletionが始まる | 両Sagaを継続する | account deletionはactivating edgeの解決を待ち、acceptがactiveへ収束した後にそのworkspaceをmanifestへ固定する | |
| activation claim後にworkerが停止してleaseが切れる | recoveryする | operation IDでworkspace正データを照合し、commit済みならactive、未commitならabandonedへ100件以下で収束する | |
| account deletion開始とactivation claimが同時 | 実行する | UserId shardで直列化され、activation成功→削除がactive edgeを固定、または削除成功→activation拒否のどちらかになる | |
| pending edge作成後にlocal commit失敗 | recoveryを実行する | edgeを解放しInvitationはpendingのまま | |
| local commit後にactivation応答を失う | 再試行する | 同じoperation IDでedgeをactiveにしMembershipを二重作成しない | |
