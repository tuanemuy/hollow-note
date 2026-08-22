# 既決の見送り判定 — Issue #20 / PR #34

以下は既に審議して**見送ると決めた**指摘。同じ Key の指摘は再提出しないこと。

| Key | 判定 | 理由 |
|---|---|---|
| `oauthStateBindingWiring.test.ts:163/空アサーション` | wont-fix | 指摘が誤り。`not.toContain(sha256(STATE))` は旧導出（`sha256(state)`）への退行を実際に捕まえる — 本 Issue が防ぐ当の退行そのもの。plan.md のテスト方針が明示要求した行でもある。代案の `Secure` / `Expires` 検証は AC-3 が「現状のまま」とした属性の新規検証で主題外 |
