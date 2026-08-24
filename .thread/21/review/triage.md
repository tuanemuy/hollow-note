# 指摘台帳 — Issue #21 / PR #41

| Key | 初出 | 判定 | 理由（一行） | 再指摘 |
|---|---|---|---|---|
| `spec/database/index.md:identity_unique_reservations/claim_token列` | R1 | fix | 契約に足した `claimToken` を供給できる列が無く、最終基盤の表設計が契約を満たせない | 0 |
| `domain/ports/identityUniqueDirectory.ts:claimToken/型安全` | R1 | fix-editorial | 「無条件の取り壊しは型として表現できない」が素の `string` では成立しない。文言を実態に合わせる。公称型化は ADR-002 の契約の形を変えるため本 PR では採らない | 0 |
| `application/identity/identityRemovalRelease.ts:JSDoc/非対称の根拠` | R1 | fix-editorial | ADR-008 の Consequences 自身が要求したコメント 1 行の取りこぼし | 0 |
| `linkOAuthIdentity.ts,completeOAuthSignIn.ts:findOAuth/順序のテスト` | R1 | fix | 順序逆転の変異で全 green を 2 レビュアーが独立に確認。ADR-006 を経路 2 にも適用する | 0 |
| `domain/ports/identityUniqueDirectory.ts:claimToken/一意性の射程` | R1 | fix-editorial | 鍵をまたぐ一意性まで約束して読める。ADR-002 が契約した性質は 2 つだけ | 0 |
| `adapters/conformance/identityUniqueDirectory.ts:beginRelease/行なしの鍵` | R1 | fix | 契約にあるのにスイートが素通り（墓標を書く変異を検出できない） | 0 |
| `adapters/memory/store.ts:nextClaimToken/不透明の意味` | R1 | fix-editorial | 「不透明＝推測不能」の誤読余地。ADR-002 は etag / rowversion / カウンタを許す | 0 |
| `adapters/conformance/identityUniqueDirectory.ts:expect.any(String)/形骸化` | R1 | fix | 型が保証済みで拘束ゼロ | 0 |
| `spec/adr/060:影響/globalCleanup` | R1 | fix-editorial | ADR-004 が既に引き受けている帰結が canon の影響欄に無い | 0 |
| `spec/adr/index.md:前提依存マップ/ADR054` | R1 | fix-editorial | 060 の決定が ADR 054 に依存しているのに前提欄・依存マップの両方から欠落 | 0 |
| `spec/adr/060:影響/ワーカー経路の収束` | R1 | fix-editorial | ADR-007 の「隔離されない限り」の但し書きが canon から落ちている | 0 |
| `spec/usecases/identity.md:removeIdentity手順4/release の射程` | R1 | fix-editorial | 実装は `keep` の 3 分岐で `release` を呼ばない。主語を補う | 0 |
| `spec/adr/038,060:却下理由・影響/時制` | R1 | fix-editorial | `spec/index.md` の「廃止済みの判断・改訂履歴を置かない」への違反 | 0 |
| `spec/adr/060:題,spec/adr/index.md:一覧/第2の決定` | R1 | fix-editorial | 060 が 2 つの決定を持つのに題と索引が片方しか表さない。題の拡張で対応（061 分割は採らない） | 0 |

R1: 新規 14 / fix 4 / fix-editorial 10 / wont-fix 0 / defer 0 / 継承 0（方針フェーズ: 実施）
fix内訳（指摘の出所ごと）: domain 4 / usecase 3 / adapter 4 / spec 6 — 全観点で fix が出たため R2 は 4 観点すべてを起動する
