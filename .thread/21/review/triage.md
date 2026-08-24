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

## R2

| Key | 初出 | 判定 | 理由（一行） | 再指摘 |
|---|---|---|---|---|
| `uniqueness.ts:observeActiveUniqueKey/所有者ガードのテスト` | R2 | fix | 所有者比較を削っても全 green（変異注入で別利用者の claim を実際に奪えることを実測）。canon が主張する「解放要求が持ち主から鍵を奪わない」が無拘束 | 0 |
| `conformance:not.toBe("")/契約超過` | R2 | fix | R1 の置換先が契約に無い値域制約になった。契約側に「非空」を足す案は ADR-002 が 2 性質で閉じた契約を広げるので採らず、行を落とす | 0 |
| `conformance:kind/区別の欠落` | R2 | fix | 契約の穴ではなくスイートの穴。`kind` を落とす変異が 21 ケース全通過 | 0 |
| `completeOAuthSignIn.test.ts:TC-344/セッション発行の主張` | R2 | fix | `sessionToken.length > 0` は UoW 前に作る値で空振り。AC-5 の 1 点が無拘束 | 0 |
| `spec/database/index.md:claim_token/状態遷移での引き継ぎ` | R2 | fix-editorial | 「行を新規に書くたび採番」が `activate` の UPDATE での再採番を許す読みを残す | 0 |
| `ports/identityUniqueDirectory.ts:claimToken/実装例` | R2 | fix-editorial | row version / ETag の例示が「張り直しで必ず変わる」と両立しない | 0 |
| `identityRemovalRelease.ts:JSDoc/beginRelease の説明` | R2 | fix-editorial | 「別利用者だけを弾く」は CAS 化で偽 | 0 |
| `identityRemovalRelease.ts:keep分岐/release を呼ばない根拠` | R2 | fix-editorial | 安全性が「keep 理由は `releasing` 上で到達不能」に依存しているのに根拠が無い。構造変更は振る舞い変更でスコープ外 | 0 |
| `memory/store.ts:nextClaimToken/JSDoc の射程` | R2 | fix-editorial | global UoW は `run` ごとにファクトリを呼ぶため「once per container」は実態より緩い | 0 |
| `spec/adr/060:Issue番号・進捗記述/canon-purity` | R2 | fix-editorial | `spec/` で唯一のトラッカー番号参照＋「持ち越す」は進捗ログ | 0 |
| `spec/inventory/*.md:最終同期/ledger-header` | R2 | fix-editorial | 生成元と台帳を同時更新しているのにヘッダーが 08-22 のまま | 0 |
| `spec/adr/038:却下理由/adr-consistency` | R2 | fix-editorial | 「ポート・適合スイートの変更に波及し」が ADR 060 で実際に払ったコストと食い違う。`.thread/21/adr.md` ADR-001 の限定文言も実態に合わせる | 0 |
| `spec/usecases/identity.md:deleteAccount/globalCleanup` | R2 | fix-editorial | 「全 reservation を release」が無条件のままで ADR 060 影響節と canon 同士が矛盾 | 0 |
| `spec/adr/060:現行実装の記述/canon-present-tense` | R2 | fix-editorial | 「現行の実装は 2 件目の identity 行を生やし」が本 PR 後は偽 | 0 |

R2: 新規 14 / fix 4 / fix-editorial 10 / wont-fix 0 / defer 0 / 継承 0（方針フェーズ: 実施）
fix内訳（指摘の出所ごと）: domain 4 / usecase 2 / adapter 4 / spec 6 — 全観点で fix が出たため R3 は 4 観点すべてを起動する

要確認の裁定（メイン）: B-001 は単位1 のテスト追加のみで閉じ `releaseObservedUniqueKey` の構造変更は採らない / W-006 はコメント 1 行にとどめ `release` を判定の外へ出す振る舞い変更は採らない / W-011 は spec を直したうえで `.thread/21/adr.md` ADR-001 の限定文言も実態に合わせる

## R3

| Key | 初出 | 判定 | 理由（一行） | 再指摘 |
|---|---|---|---|---|
| `spec/domains/identity.md,ports/identityUniqueDirectory.ts:claimToken/「書き込みごとの UUID」の例示` | R3 | fix-editorial | 適合機構の例示が直前の「claim 生存中は不変」と字義どおり両立しない。例示の表現だけを正す（契約の 2 性質は不変） | 0 |

R3: 新規 1 / fix 0 / fix-editorial 1 / wont-fix 0 / defer 0 / 継承 0（方針フェーズ: 省略 — 新規 1 件・独立・fix-editorial のみ）
fix内訳（指摘の出所ごと）: domain 0 / usecase 0 / adapter 0 / spec 0 — **全観点で fix ゼロ。fix-editorial 1 件は適用済みで品質ゲート緑のため完了条件を満たす（APPROVED）**

品質ゲート（R3 完了時点）: typecheck 緑 / lint 緑（infos 2・既存）/ format:check 緑（446 files）/ test 76 files・970 passed・3 skipped
