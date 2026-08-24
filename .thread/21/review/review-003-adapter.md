# レビュー 003 — Adapter

Round 3 / ゼロベース。ポート契約（`domain/identity/ports/identityUniqueDirectory.ts` の JSDoc + `spec/domains/identity.md#ポート`）と適合スイート、memory 実装、`spec/database/index.md` の `claim_token` 記述を突き合わせ、memory 実装への変異注入 16 本で穴の有無を実証した。

## Adapter

### Blockers

なし

### Warnings

なし

---

### 検証: 契約 ↔ 適合スイートの 1 対 1 対応

ポート JSDoc の各主張と、それを拘束するケースの対応。契約にあってスイートに無い項目、スイートにあって契約に無い要求はいずれも見つからなかった。

| 契約（JSDoc / `spec/domains/identity.md`） | 拘束するケース |
|---|---|
| `claimToken` は claim が生きているあいだ不変（冪等 `activate` を挟んでも） | `ADP-identity-042: the token stays the same for as long as the claim lives` |
| 取り壊して張り直した claim のトークンは前と異なる — **同じ `operationId` でも** | `ADP-identity-042/041: a re-taken claim carries a different token` |
| `resolveClaim` は `active` の行だけが答える（`reserved` / `releasing` / 行なしは `null`） | `ADP-identity-042: resolveClaim answers with owner and token for an active claim only` |
| `resolve` は `resolveClaim` の射影（4 状態すべてで一致） | `ADP-identity-042/006: resolve is a projection of resolveClaim in every state` |
| `beginRelease` はトークン不一致で no-op | `ADP-identity-041: beginRelease quoting a superseded token leaves the current claim intact` |
| `beginRelease` は `releasing` 行を no-op（正しい観測値を引用しても奪えない） | `ADP-identity-041: a releasing row is not taken over by another operation` |
| `beginRelease` は別利用者の行を no-op | `ADP-identity-041: beginRelease by a non-owner leaves the claim intact` |
| `beginRelease` は `reserved` 行・行なしを no-op | `ADP-identity-041: ... leaves a still-reserved row alone` / `... on an unknown key is a no-op` |
| `beginRelease` は行を解放側 operation へ付け替え、続く `release` が落とす | `ADP-identity-041/009: beginRelease then release frees an activated claim for another user` |
| `release` は operation の `reserved` / `releasing` を落とし `active` に触れない | `ADP-identity-009: release does not tear down an activated claim` ほか |
| 鍵は `(kind, normalizedKey)` の対（別 kind の同一 normalizedKey は別 claim） | `ADP-identity-042: the same normalized key is a separate claim per kind` |
| 「別の鍵のトークンは一致してよい」「推測困難性は要らない」 | 許容側の主張。スイートは要求していない（過剰拘束なし） |

`spec/inventory/adapter.md` の ADP-006 / ADP-041 の書き換えと ADP-042 の新設も、上の契約文とずれていない。

### 検証: 変異注入（memory 実装 / store）

`packages/core/src/adapters/memory/__tests__/conformance.test.ts -t "IdentityUniqueDirectory"`（22 ケース）に対して注入。**変異はすべて元に戻し、注入後に全体スイート 970 passed を再確認済み。**

KILLED（＝スイートが拘束できている）:

- `beginRelease` のトークン条件を外す
- `beginRelease` の所有者条件を外す
- `beginRelease` の `state !== "active"` 条件を外す
- `reserve` のトークンを `claim-${operationId}` に導出させる
- `nextClaimToken` を定数にする
- `activate` の冪等ガードを外してトークンを再採番する
- `resolveClaim` が `reserved` 行にも答える / `releasing` 行にも答える
- `resolve` を `resolveClaim` と独立に（任意 state の `userId` を返す）実装する
- `beginRelease` が `operationId` を付け替えない
- `release` が `reserved` 行を落とさない
- `CONFLICT_CODES.providerAccount` を別コードに差し替える（＝ユースケース層で拘束済み）

SURVIVED は 3 本あったが、いずれも**契約に照らして等価変異**であり穴ではない:

- `activate` が冪等ガードを保ったままトークンを再採番する — `reserved` 行のトークンはポートから観測できないため、外から区別できない。JSDoc が「どの書き込みでトークンを採番するかは契約が問わない」と明示しており、意図どおり
- `reserve` が失効 `reserved` 行のトークンを引き継ぐ — 直前の行は `reserved` で、そのトークンは一度も観測されていない。`active` 行は `reserve` に奪われない（conflict）ので、観測済みトークンが再利用される経路は存在しない
- `beginRelease` が `expiresAt` を明示 `null` にしない — `activate` が既に `null` にしているので実質的に等価

補足として `beginRelease` の state 条件を「`releasing` だけ除外」に緩めた変異（＝`reserved` 行の取り壊しを許す）は SURVIVED するが、`resolveClaim` が `reserved` 行を返さない拘束（上記 KILLED）がある以上、呼び出し側が `reserved` 行のトークンを入手する経路が無く、ポート越しには到達不能。ADR 060 の「影響」節が「行なし」「`reserved`」の no-op はトークン条件に吸収されて適合スイートから独立に識別できなくなる、と明記しており、スイートのコメント（`identityUniqueDirectory.ts:429-431`, `448-449`）も同じことを正直に書いている。契約・ADR・スイートが一致しているので指摘にはしない。

### 検証: memory 実装の契約適合

- `claimToken` の採番は `reserve` の行書き込み時のみ（`repositories/identityUniqueDirectory.ts:97`）。`activate` / `beginRelease` は `...row` スプレッドで引き継ぐので、冪等 `activate` でトークンが動かない
- `release` が行ごと削除するため、同じ `operationId` の再 `reserve` でも新しい行＝新しいトークンになる（AC-3(b) の強い形）
- `nextClaimToken` を `MemoryBackend` 側に置いた判断は正しい。ディレクトリのファクトリはリクエスト / ワーカーコンテナごと、さらに global UoW の `run` ごとに生成されるので、ファクトリ局所のカウンタでは同じトークンが 2 度出る。`idGenerator` を使わない理由（決定的 ID 列に依存するテストをずらさない）も妥当
- カウンタがトランザクションのロールバックで巻き戻らないのは**正しい**。巻き戻すとトークンの再利用が起きる。逆に `MemTable` のロールバックで復元される行は「同じ claim が同じトークンで戻る」形なので、CAS の意味も壊れない
- `DirectoryRow.claimToken` を必須フィールドにしたことで、行の構築点はアダプター 1 か所だけ（他ファイルは `values()` / `filter()` の読みのみ）。「`active` 行は必ずトークンを持つ」が実行時分岐ではなく型の性質になっている
- エラー翻訳: `CONFLICT_CODES` による kind → `ConflictError` は従来どおりで、`resolveClaim` / `beginRelease` は memory ではドライバ由来の失敗経路を持たない。契約の `SystemError(DatabaseError)` はリモートバックエンド側の義務として残る形で妥当

### 検証: `spec/database/index.md` の `claim_token`

`identity_unique_reservations` に `claim_token text NOT NULL, reserve の行挿入時に採番` を追加し、本文で「`activate` / `beginRelease` の状態遷移の `UPDATE` では既存値を引き継ぐ」「`operation_id` や `updated_at` からの導出は契約を満たさない」を明示している。D1 で実装するのに過不足はない:

- 失効 `reserved` 行の奪取は PK 衝突で `ON CONFLICT DO UPDATE` になるが、除外リストが `activate` / `beginRelease` に限定されているので「`reserve` の書き込みは採番する」と読める。仮に引き継ぐ実装にしても、`reserved` 行のトークンは観測不能なので契約は破れない（上の等価変異と同じ議論）
- 採番方式として何が適合するか（単調カウンタ / 書き込みごと UUID）は `spec/domains/identity.md#ポート` 側に書かれており、相互参照も張られている
- `release` が行を DELETE する前提なので、張り直しは必ず新規 INSERT ＝新トークンになり、AC-3(b) を D1 でも満たせる
- `beginRelease` の `operation_id` 付け替えと `operation_id UNIQUE` の共存は、本番呼び出し元 3 か所（`identityRemovalRelease` は event の `operationId` 1 鍵、`updateProfile` は `handleReleaseOperationId(userId, handle)` 1 鍵、`globalCleanup` は `reservationOperationId(deletionOp, key)` で鍵ごとに別 ID）がいずれも 1 operation = 1 行なので破綻しない

### 検証: スコープ / 受け入れ基準

- アダプター層の変更は「適合スイート・memory 実装・memory の行型」の 3 点に限られ、`spec/platform` の Cloudflare アダプター実装（スコープ外）には手が入っていない
- AC-2 の「観測手段がポートにあり、契約がポート定義 JSDoc と `spec/domains/identity.md#ポート` の両方に書かれている」— 満たしている。両者の記述内容も一致している
- AC-3 の 6 点（a〜f）はすべて適合スイートのケースとして存在し、memory が通る（上表参照）
- AC-7 のうちアダプター側インベントリ（`spec/inventory/adapter.md`）— ADP-042 が identity 群の末尾に採番され、ADR 052 の「ID は行位置ではない」に従っている

### 検証: 残す必要のない記述

アダプター層のコメント（`store.ts` の `claimToken` / `nextClaimToken` の JSDoc、`repositories/identityUniqueDirectory.ts` の `reserve` / `beginRelease` のコメント、適合スイートの load-bearing 注記）はいずれも WHY / 隠れた制約の説明で、指摘への弁明や修正経緯を残した記述は無い。

## カバレッジ

- 確認: `packages/core/src/adapters/conformance/identityUniqueDirectory.ts`, `packages/core/src/adapters/memory/repositories/identityUniqueDirectory.ts`, `packages/core/src/adapters/memory/store.ts`, `packages/core/src/domain/identity/ports/identityUniqueDirectory.ts`, `packages/core/src/application/identity/uniqueness.ts`, `packages/core/src/application/identity/identityRemovalRelease.ts`, `spec/adr/060-conditional-unique-claim-teardown.md`, `spec/database/index.md`, `spec/domains/identity.md`, `spec/inventory/adapter.md`
- スキップ: `packages/core/src/application/identity/__tests__/checkHandleAvailability.test.ts` — ユースケース層のテストで Test 観点
- スキップ: `packages/core/src/application/identity/__tests__/completeOAuthSignIn.test.ts` — 同上
- スキップ: `packages/core/src/application/identity/__tests__/linkOAuthIdentity.test.ts` — 同上
- スキップ: `packages/core/src/application/identity/__tests__/removeIdentity.test.ts` — 同上
- スキップ: `packages/core/src/application/identity/completeOAuthSignIn.ts` — Usecase 観点
- スキップ: `packages/core/src/application/identity/linkOAuthIdentity.ts` — Usecase 観点
- スキップ: `packages/core/src/domain/identity/services/identityPolicy.ts` — Domain 観点
- スキップ: `spec/adr/038-provider-account-claim-and-identity-row.md` — Spec 観点（ADR 060 との整合のみ間接確認）
- スキップ: `spec/adr/054-provider-account-uniqueness-owner.md` — Spec 観点
- スキップ: `spec/adr/index.md` — Spec 観点（一覧と前提依存マップ）
- スキップ: `spec/inventory/domain.md` — Domain 台帳で Domain 観点
- スキップ: `spec/inventory/test.md` — Test 台帳で Test 観点
- スキップ: `spec/inventory/usecase.md` — Usecase 台帳で Usecase 観点
- スキップ: `spec/testcases/identity/completeOAuthSignIn.md` — Test 観点
- スキップ: `spec/testcases/identity/linkOAuthIdentity.md` — Test 観点
- スキップ: `spec/testcases/identity/removeIdentity.md` — Test 観点
- スキップ: `spec/usecases/identity.md` — Usecase 観点
