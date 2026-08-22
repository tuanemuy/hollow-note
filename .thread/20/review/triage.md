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

| `routes/auth/-action.tsx:133/コメントと実装の逆転` | R2 | fix-editorial | コメント1文目が実装・ADR-005 と逆の規則を書き、同じコメント3文目とも自己矛盾 | 0 |
| `oauthStateBindingWiring.test.ts:287/常真アサーション` | R2 | fix | `errorResponseMiddleware` が必ず包み直すので `not.toBe(failure)` は常真。`toBeInstanceOf(TypeError)` で実際に観測する | 0 |
| `routes/auth/-action.tsx:abandonOAuthFlowFn/障害耐性` | R2 | fix | R1 の同キー fix（ADR-011）の残件。`loadServerDeps` が `try` の外で、loader の裸 await 越しに P-05 が落ちる経路が残る。裁定 (i) を採る | 1 |
| `adapters/conformance/oauthStateStore.ts:take/state 述語の非拘束` | R2 | fix | 変更前から在った穴だが本 PR が現実的にした（述語が1本→2本になり `state = ?` 落ちが「他ブラウザーの行を消費する」実害に直結） | 0 |
| `application/identity/view.ts:AbandonOAuthFlowView/JSDoc の偽` | R2 | fix-editorial | 「一致×期限切れ」で行は解放されるのに `abandoned:false`。`take` の戻り型拡張は ADR-009 に反するので採らない | 0 |
| `.thread/20/progress.md:残存課題1/解消済み` | R2 | fix | 4行とも更新済みを確認。記述が成果物と食い違う | 0 |
| `spec/adr/034:前提/決定の自己参照` | R2 | fix-editorial | 「照合が消費と同一の原子操作」は決定2そのもの。他 ADR の前提欄は全て外部事実 | 0 |
| `oauthStateStore:D1 実装ノートの期限判定落ち` | R2 | fix-editorial | `DELETE … RETURNING *` だけでは「一致×期限切れ→`null`」を満たせない。3か所（spec/database・spec/domains・ポート JSDoc）を1件に統合 | 0 |
| `spec/usecases/identity.md:277,322/エラーケース表の欠行` | R2 | fix-editorial | 台帳（UC-024）だけが「束縛の不一致」を主張し生成元の表に無い | 0 |
| `spec/manual-tests/account.md:535/ADR 057 追随` | R2 | fix | ADR 057 決定は「usecase のエラーケースが増えたら対応表に行を足す／再現不能は `対象外` と理由」を義務づけている。裁定により3行追加 | 0 |
| `.thread/20/steps.md:40,57/計画と実装の齟齬` | R2 | fix-editorial | ADR-009 が取り消した主張が計画側に残り、実際にこのラウンドの誤読源になった | 0 |
| `startOAuthFlow.test.ts:48/表題の過剰宣言` | R2 | fix-editorial | 表題と射程のずれは事実。ただし払い出し記録ラッパーによる「独立性の証明」は却下（plan AC-8 が担保範囲を2本の否定と定義済み、PR の膨張）。表題とコメントを射程に寄せるだけ | 0 |
| `spec/testcases/identity/startOAuthFlow.md:TC-264/要素列の重複` | R2 | wont-fix | 台帳の「要素」列の重複は既存に2組あり容認済みの形。ADR 052/058 が ID を識別子と定め、期待結果列で対応は付く。実害なしの整形要求 | 0 |
| `application/ports/oauthStateStore.ts:take/原子性の但し書き` | R3 | wont-fix | 同じ段落の冒頭が `take` … must be atomic と規範的に言い切っており、第2の形は「判定の順序は規範ではない」の下にある。原子性は `spec/domains/index.md` にも同文で載る。ポートへ複写すると二重管理 | 0 |
| `spec/testcases/identity/completeOAuthSignIn.md/束縛不一致 TC 欠落` | R3 | fix | `completeOAuthSignIn` は自分で `take` を呼び不一致で `OAUTH_STATE_INVALID` を投げるので spec の行は真。裏打ちの TC とテストだけが無く、指す先の無い約束になっている | 0 |

R1: 新規 11（生の指摘17件を重複統合）/ fix 4 / fix-editorial 6 / wont-fix 1 / defer 0 / 継承 0（方針フェーズ: 実施。要確認1件はメインが裁定 — `abandonOAuthFlow` の障害耐性は server function 境界で catch + logger の best-effort に倒す）
fix内訳: application 0→休止（全指摘が他観点と重複統合され、単独 fix ゼロ）/ adapter 2 / presentation 2 / spec 6
R2: 新規 12（生の指摘13件を重複統合）/ fix 5 / fix-editorial 6 / wont-fix 1 / defer 0 / 継承 0（`routes/auth/-action.tsx:abandonOAuthFlowFn/障害耐性` は R1 と同キーだが、適用済み fix の残件として再度 fix。再指摘 +1）（方針フェーズ: 実施。要確認2件はメインが裁定 — (i) `loadServerDeps` を try 内へ移す / (ii) `spec/manual-tests/account.md` は W-003 と連動して3行追加）
fix内訳: adapter 2 / presentation 3 / spec 5 / general 1 / application 0→休止（R1 から継続）
R3: 新規 2 / fix 1 / fix-editorial 0 / wont-fix 1 / defer 0 / 継承 0（方針フェーズ: 実施 — 2件だが spec 側が前ラウンドの修正との整合判断を含むため省略しなかった。要確認1件はメインが裁定 — 案A（TC とテストを足す）を採る）
fix内訳: adapter 0→休止 / presentation 0→休止 / application 0→休止 / spec 1
R4: 新規 0 / fix 0 / fix-editorial 0 / wont-fix 0 / defer 0 / 継承 0（方針フェーズ: 省略 — 新規指摘ゼロ。**fix ゼロのラウンドを観測したためレビュー完了・APPROVED**）
fix内訳: spec 0 / general 0（休止中の adapter・presentation・application を引き継ぐ確認ラウンドとして実施）
