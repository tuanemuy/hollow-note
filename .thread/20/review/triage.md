# PR レビュー指摘台帳 — Issue #20 / PR #34

| Key | 初出 | 判定 | 理由（一行） | 再指摘 |
|---|---|---|---|---|
| `adapters/conformance/oauthStateStore.ts:take/契約カバレッジ` | R1 | fix | 「一致×期限切れでも削除」象限が未検証。反対の実装でも全緑になることを実測（ADR-009 の「観測差が出ない」前提が事実として誤り） | 0 |
| `adapters/conformance/oauthStateStore.ts:take/不一致×期限切れ` | R1 | fix | 「不一致は常に行を残す」は normative。隣に1ケース足すだけで4象限が1:1になる | 0 |
| `ports/oauthStateStore.ts:take/例示SQLの列名` | R1 | fix-editorial | `binding_hash` → `state_binding_hash` に統一。正典どうしの食い違い | 0 |
| `spec/usecases/identity.md:abandonOAuthFlow/期限切れの記述` | R1 | fix-editorial | 「行は残したままにする」が「一致×期限切れ」で実装・契約に対し偽 | 0 |
| `spec/adr/034:影響/列挙漏れ` | R1 | fix-editorial | 列挙をやめて理由を言い切る（列挙は増え続ける） | 0 |
| `routes/auth/-action.tsx:abandonOAuthFlowFn/障害耐性` | R1 | fix | 変更前は I/O 無しで throw しなかったものが loader の裸 await 越しにストア I/O になり、P-05 の「キャンセル」が描けなくなる回帰。裁定 (b) を採る（ADR-011 に記録） | 0 |
| `spec/inventory/test.md:TC-identity-035/追随漏れ` | R1 | fix-editorial | 生成元の文言と不一致で「最終同期: 2026-08-22」を偽にする | 0 |
| `spec/inventory/usecase.md:UC-identity-006,007/UC-integration-001,002/説明文` | R1 | fix-editorial | 旧記述のまま。AC-6 が `spec/inventory/` の各行を対象に挙げている | 0 |
| `oauthStateBindingWiring.test.ts:242/空振りケース` | R1 | fix | mutation で実証済み（早期 return でも緑）。`take` の呼び出し回数を足す | 0 |
| `spec/testcases/identity/startOAuthFlow.md:TC-identity-264/TC対応` | R1 | fix-editorial | テストは足さず、期待結果の文言を TC-336 の行へ寄せる（plan.md AC-8 の設計どおり） | 0 |
| `oauthStateBindingWiring.test.ts:163/空アサーション` | R1 | wont-fix | 指摘が誤り。`not.toContain(sha256(STATE))` は旧導出への退行を実際に捕まえる（本 Issue が防ぐ当の退行）。plan.md のテスト方針が明示要求した行でもあり、代案の `Secure`/`Expires` 検証は AC-3 が「現状のまま」とした属性の新規検証で主題外 | 0 |

R1: 新規 11（生の指摘17件を重複統合）/ fix 4 / fix-editorial 6 / wont-fix 1 / defer 0 / 継承 0（方針フェーズ: 実施。要確認1件はメインが裁定 — `abandonOAuthFlow` の障害耐性は server function 境界で catch + logger の best-effort に倒す）
fix内訳: application 0→休止（全指摘が他観点と重複統合され、単独 fix ゼロ）/ adapter 2 / presentation 2 / spec 6
