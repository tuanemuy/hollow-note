# テストケース: getSharedNote

| 前提条件 | 操作 | 期待結果 | 実装ステータス |
|---|---|---|---|
| パスワードなしの限定公開ノート | 有効な共有トークンで引く | 本文が返る | |
| locator が canonical な NoteId を含む有効な共有リンク | 引く | D1 routeを1点参照し、対象scope DOでID取得とtoken hash照合を行う | |
| locatorだけを別NoteIdへ改ざんしたリンク | 引く | 対象Noteのhashと一致せず `NotFoundError("NOTE_NOT_FOUND")`。他scopeは探索しない | |
| パスワード保護された限定公開ノート、通過証なし | 引く | `passwordRequired: true` が返り、タイトルも本文も含まれない | |
| パスワード保護され、有効な通過証がある | 引く | 本文が返る | |
| 通過証の `passwordUpdatedAt` がノート側と異なる | 引く | `passwordRequired: true` が返る | |
| 発行から 25 時間経過した通過証 | 引く | `passwordRequired: true` が返る | |
| 発行から 23 時間経過した通過証 | 引く | 本文が返る（有効期間の境界値） | |
| 存在しない共有トークン | 引く | `NotFoundError("NOTE_NOT_FOUND")` が投げられる | |
| 再発行されて無効になったトークン | 引く | `NotFoundError("NOTE_NOT_FOUND")` が投げられる | |
| 非公開に戻されたノートのトークン | 引く | `NotFoundError("NOTE_NOT_FOUND")` が投げられる | |
| 削除されたノートのトークン | 引く | `NotFoundError("NOTE_NOT_FOUND")` が投げられる | |
| サインイン済みで編集権限を持つ利用者 | 共有トークンで引く | `permissions.canEdit: true` が返る | |
| 公開ステータスのノートの休眠トークン | 引く | 公開ノートとして本文が返る | |
