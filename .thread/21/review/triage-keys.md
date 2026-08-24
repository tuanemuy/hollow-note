# 既決の見送り判定（再指摘しないこと）

R1・R2 の 28 件はすべて `fix` / `fix-editorial` として反映済みで、`wont-fix` / `defer` に落ちた指摘はありません。

以下は**本 Issue のスコープ外・または設計判断として決着済み**です。蒸し返さないでください:

| Key | 判定 | 理由 |
|---|---|---|
| `releasing行のTTL/旧handle固着の回収手段` | wont-fix（別 Issue 候補） | `updateProfile` が `beginRelease`〜`release` 間で落ちた場合の固着。スコープ外 |
| `completeOAuthSignIn:createNew分岐/同一メール利用者の重複` | wont-fix（別 Issue 候補） | 両鍵とも `reserved` 失効時の `createNew` 落ちで同一メールの利用者が 2 人生える件。スコープ外 |
| `OAuth identity同定述語の3経路統一` | wont-fix | 3 経路の述語統一は本 Issue の 2 経路を閉じるのに必須でなくスコープを越える |
| `domain/ports/identityUniqueDirectory.ts:claimToken/公称型化` | wont-fix | `ClaimToken` の公称型化・`beginRelease` の引数形の変更は、確定させた契約の形（不透明な `string` の 2 段引数）を変えるため本 PR では採らない |
| `conformance:claimToken/非空・値域の主張` | wont-fix | 契約は 2 性質（claim 生存中は不変 / 張り直しで必ず変化）で閉じており、非空・推測困難性・`kind` 間のトークン相違はいずれも契約に含まない。スイートで要求しない |
| `uniqueness.ts:releaseObservedUniqueKey/引数の形の変更` | wont-fix | `expectedUserId` を呼び出し側の期待値から取る構造変更は採らない。所有者ガードは TC-identity-346 が拘束済み |
| `identityRemovalRelease.ts:release を判定の外へ出す` | wont-fix | `release(operationId)` を常に呼ぶ形への構造変更は振る舞い変更で AC-8 の射程に触れる。`keep` 分岐の安全性は WHY コメントで明示済み |
