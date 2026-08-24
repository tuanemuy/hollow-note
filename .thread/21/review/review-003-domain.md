# レビュー 003 — Domain

## Domain

**Blocker なし / Warning なし。**

### Blockers

なし

### Warnings

なし

### 検証したこと

ゼロベースで契約・純粋性・型による不変条件・テストの実効性を確認した。指摘に足る欠陥は見つからなかった。以下は「問題なし」と判断した根拠。

#### ポート契約の内部整合と実装可能性

- `resolveClaim` の可視条件（`active` のみ）と `beginRelease` の CAS 条件（`active` かつ所有者一致かつトークン一致）が閉じている。呼び出し側が観測できる唯一の状態が `active` なので、「観測なしに取り壊せない」という契約の主張が構造として成立する。
- `claimToken` に課す性質が 2 つ（claim 生存中は不変 / 張り直しで必ず変化。同じ operation ID でも）に限定され、非適合例（`operationId` 由来・行内容由来・削除で振り出しに戻る版番号）が明示されている。D1 / DO でも `reserve` の INSERT 時採番 + 状態遷移 UPDATE での引き継ぎで実装可能で、`spec/database/index.md` の `claim_token` 記述と一致する。
- 「`releasing` 行のトークンは未規定」と「`releasing` を落とせるのは付け替えた operation の `release` だけ」が、`releasing` 行が `resolveClaim` から見えないことと矛盾なくつながっている。
- 契約に書かれていない暗黙の前提を memory 実装が持っていないか確認した。`nextClaimToken` は `MemoryBackend` 上の単調カウンタで、UoW のロールバックで巻き戻らないが、契約が要求するのは「claim ごとに新しい値」だけなので巻き戻り不要（むしろ巻き戻ってはならない）。`idGenerator` を使わない理由も WHY として妥当。
- 契約が実装不能な要求をしていないか: 「他の鍵のトークンとの相違」「推測困難性」を明示的に契約外に置いているので、バックエンドの自由度が残る。

#### `IdentityPolicy.findOAuth` の粒度・純粋性

- `readonly Identity[]` を受けて `OAuthIdentity | null` を返す純関数。I/O・時刻・ID 生成への依存なし。import は `domain/` 内のみ（`OAuthIdentity` / `OAuthProvider`）。既存の `findPassword` と同じ形。
- 「1 利用者の集合内の重複」と「全利用者にまたがる一意性（`IdentityUniqueDirectory`）」の責務分割が `spec/domains/identity.md` と ADR 054 / ADR 060 で一貫している。担保元は動いていない。
- 型ガードで `OAuthIdentity` に絞っているので、呼び出し側が `provider` / `providerAccountId` を再検査せずに使える。

#### 不変条件の型表現

- `expectedClaimToken` を必須にしたことで「無条件の取り壊し」が型として書けない。
- `ObservedUniqueClaim | null` が観測失敗を呼び出し側に強制的に扱わせる。`releaseObservedUniqueKey` が `null` でも `release(operationId)` を必ず走らせる形（AC-8）は JSDoc に WHY として明示済み。
- `ReleaseDecision` から `userId` / `normalizedKey` が落ち、解放対象が「判定より前に観測した claim」だけであることが型に出た。判定結果から鍵を組み直す経路が消えている。

#### セキュリティ（担当範囲）

- `claimToken` はディレクトリのポート・memory アダプター・`uniqueness.ts` の外に出ていない（リポジトリ全体で grep 済み。イベント・受領・ログ・transport への露出なし）。ADR 048 の「鍵の値を外のシンクへ出さない」に整合し、トークン自体も鍵から導出していない。
- 所有者ガード（`observeActiveUniqueKey`）が無いと他人の claim を奪える経路が開くが、TC-identity-346 が実行形で拘束している（下の変異注入 M1 で実証）。

#### 変異注入（すべて元に戻し済み。作業ツリーは PR の状態）

`pnpm vitest run packages/core/src/application/identity packages/core/src/adapters/memory`（552 件）を基準に、確認した挙動が実効的なテストで守られているかを検証した。**すべての変異が red になった**ため、テスト不足の指摘は挙げない。

| # | 変異 | 落ちたテスト |
|---|---|---|
| M1 | `observeActiveUniqueKey` から所有者ガード（`claim.userId !== params.expectedUserId`）を削る | TC-identity-346 |
| M2 | memory `beginRelease` からトークン比較を削る | TC-identity-342 / ADP-identity-041（superseded token） |
| M3 | memory `beginRelease` の `state !== "active"` を `state === "reserved"` に緩める（`releasing` 行の奪取を許す） | ADP-identity-041（releasing row not taken over） |
| M4 | `identityRemovalRelease` の観測を判定 UoW の**後ろ**へ移す | TC-identity-342 |
| M5/M6 | `linkOAuthIdentity` / `completeOAuthSignIn` で `ensureAddable` を `findOAuth` の**前**に置く | TC-identity-343 / TC-identity-344 |
| M7 | `releaseObservedUniqueKey` を観測 `null` で早期 return させる | TC-identity-345 |
| M8 | `IdentityPolicy.findOAuth` から `providerAccountId` 比較を落とす | TC-identity-007 / 027 / 125 / 126 / 343 / 344 |

`findOAuth` の `provider` 比較だけは、`OAuthProvider = "google"` が単一値の型なので現時点では反証不能。型が広がったときに初めて意味を持つ検査であり、欠陥ではない。

#### スコープ・記述

- 差分は plan.md の「含まれないもの」を越えていない。`releasing` 行の期限、OCC リトライ、`resolve` の全面置換、`createNew` 分岐の同一メール重複はいずれも手つかずで、ADR 060 の「影響」と plan の「リスク」に残存リスクとして記録されている。
- 追加されたコメントはすべて WHY（順序が load-bearing である理由、`release` を必ず呼ぶ理由、トークンを `idGenerator` から取らない理由、適合ケースで同じ operation ID を使う理由）。指摘への弁明・修正経緯・レビュー履歴の痕跡は見当たらない。

### カバレッジ

- 確認: `packages/core/src/domain/identity/ports/identityUniqueDirectory.ts`, `packages/core/src/domain/identity/services/identityPolicy.ts`, `packages/core/src/adapters/conformance/identityUniqueDirectory.ts`, `packages/core/src/adapters/memory/repositories/identityUniqueDirectory.ts`, `packages/core/src/adapters/memory/store.ts`, `packages/core/src/application/identity/uniqueness.ts`, `packages/core/src/application/identity/identityRemovalRelease.ts`, `packages/core/src/application/identity/linkOAuthIdentity.ts`, `packages/core/src/application/identity/completeOAuthSignIn.ts`, `packages/core/src/application/identity/__tests__/checkHandleAvailability.test.ts`, `packages/core/src/application/identity/__tests__/completeOAuthSignIn.test.ts`, `packages/core/src/application/identity/__tests__/linkOAuthIdentity.test.ts`, `packages/core/src/application/identity/__tests__/removeIdentity.test.ts`, `spec/adr/060-conditional-unique-claim-teardown.md`, `spec/adr/038-provider-account-claim-and-identity-row.md`, `spec/adr/054-provider-account-uniqueness-owner.md`, `spec/adr/index.md`, `spec/domains/identity.md`, `spec/database/index.md`, `spec/inventory/domain.md`, `spec/inventory/adapter.md`, `spec/usecases/identity.md`
- スキップ: `spec/inventory/test.md` — テスト台帳の行追加のみで、ドメイン契約の主張は `spec/domains/identity.md` とポート定義で確認済み
- スキップ: `spec/inventory/usecase.md` — ユースケース台帳。手順の正典は `spec/usecases/identity.md` 側で確認済み
- スキップ: `spec/testcases/identity/completeOAuthSignIn.md` — テストケース表の行追加。ドメイン契約の記述を含まない
- スキップ: `spec/testcases/identity/linkOAuthIdentity.md` — 同上
- スキップ: `spec/testcases/identity/removeIdentity.md` — 同上
