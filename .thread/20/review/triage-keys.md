# 既決の見送り判定 — Issue #20 / PR #34

以下は既に審議して**見送ると決めた**指摘。同じ Key の指摘は再提出しないこと。

| Key | 判定 | 理由 |
|---|---|---|
| `oauthStateBindingWiring.test.ts:163/空アサーション` | wont-fix | 指摘が誤り。`not.toContain(sha256(STATE))` は旧導出（`sha256(state)`）への退行を実際に捕まえる — 本 Issue が防ぐ当の退行そのもの。plan.md のテスト方針が明示要求した行でもある。代案の `Secure` / `Expires` 検証は AC-3 が「現状のまま」とした属性の新規検証で主題外 |

| `spec/testcases/identity/startOAuthFlow.md:TC-264/要素列の重複` | wont-fix | 台帳の「要素」列が既存行と重複するのは既存に2組あり容認済みの形。ADR 052/058 が TC の ID を識別子と定めており、期待結果列で対応は付く。実害のない整形要求 |
| `startOAuthFlow.test.ts:48/払い出し記録ラッパーによる独立性の証明` | wont-fix | plan.md AC-8 が担保範囲を「2本の否定アサーション」と定義済み。黒箱で「`state` から導けない」ことを一般に証明しにいくのは PR の膨張。表題を射程に寄せる対応で決着済み |
