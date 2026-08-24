# 既決の見送り判定（再指摘しないこと）

このラウンドまでに `wont-fix` / `defer` と判定した指摘はありません（R1 の 14 件はすべて `fix` / `fix-editorial` として反映済み）。

なお以下は**計画時に本 Issue のスコープ外として決着済み**です。蒸し返さないでください:

| Key | 判定 | 理由 |
|---|---|---|
| `releasing行のTTL/旧handle固着の回収手段` | wont-fix（別 Issue 候補） | `updateProfile` が `beginRelease`〜`release` 間で落ちた場合の固着。スコープ外 |
| `completeOAuthSignIn:createNew分岐/同一メール利用者の重複` | wont-fix（別 Issue 候補） | 両鍵とも `reserved` 失効時の `createNew` 落ちで同一メールの利用者が 2 人生える件。スコープ外 |
| `steps.md:OAuth identity同定述語の3形` | wont-fix | 3 経路の述語統一は本 Issue の 2 経路を閉じるのに必須でなくスコープを越える |
| `domain/ports/identityUniqueDirectory.ts:claimToken/公称型化` | wont-fix | `ClaimToken` の公称型化・`beginRelease` の引数形の変更は ADR-002 が確定させた契約の形を変えるため本 PR では採らない（R1 の要確認で決着） |
