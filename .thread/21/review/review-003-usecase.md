# Round 3 レビュー — Use Case

**Blocker なし / Warning なし。**

## Use Case

### Blockers

なし

### Warnings

なし

## 検証したこと

### 観測の位置と CAS（AC-4）

`identityRemovalRelease` は `observeActiveUniqueKey` を解放判定 UoW の**前**に呼び、`releaseObservedUniqueKey` が観測した `claimToken` で `beginRelease` を条件付けている。順序が正しさの本体である以上、目視ではなく実行形で拘束されていることを変異注入で確認した。

- 変異: 観測を `globalUnitOfWorkProvider.run` の**後ろ**（`releaseObservedUniqueKey` の直前）へ移す
- 結果: `TC-identity-342` が fail（`directoryRow` が `undefined` になる）。変異は元に戻した（独立 worktree で実施し、本体ツリーには触れていない）

CAS が外れたときは `beginRelease` が no-op になるだけでエラーにならず、`identityRemovalRelease` は例外を投げずに終わる。再配送が止まらず隔離までカウントが進む形にはなっていない。

### 「解放する」判定時の無条件 `release(operationId)`（AC-8）

`releaseObservedUniqueKey` は `observed === null` でも `release(params.operationId)` を必ず呼ぶ。

- 変異: `observed === null` で早期 return
- 結果: `TC-identity-345` が fail（`releasing` 行が回収されず、別利用者の `reserve` が通らない）。変異は元に戻した

`updateProfile` / `deleteAccount.globalCleanup` の `releaseActiveUniqueKey` 経由でも同じ無条件 `release` が保たれている。`globalCleanup` の解放 operation ID は `reservationOperationId(input.operationId, key)` で決定的なので、`beginRelease` 済み・`release` 前で落ちた自分の残骸は再配送で回収できる。`beginRelease` が `releasing` 行を除外するようになった（旧実装は `reserved` だけを除外していた）影響も、この経路では無条件 `release` が肩代わりするので回帰しない。

### 所有者ガード / セキュリティ

`observeActiveUniqueKey` が `claim.userId !== expectedUserId` で `null` を返すため、他人の claim には `beginRelease` が届かない。`TC-identity-346`（解放後に別利用者が同じ provider account を取り直したあとの再配送）が実行形として拘束している。`release(operationId)` は operation ID 一致行しか落とさず、削除の operation ID は `removeIdentity:${identityId}`、予約の operation ID は `${parentOperationId}:${kind}:${key}` なので衝突しない。

治癒経路も他人の行に届かない。`linkOAuthIdentity` は flow の `userId`、`attachToExistingUser` は `AccountLinkingPolicy` が返した `decision.userId` の identity 集合だけを `IdentityPolicy.findOAuth` で引いている。

### 治癒経路の順序と状態遷移（AC-5）

`linkOAuthIdentity` / `completeOAuthSignIn.attachToExistingUser` のどちらも `findOAuth` を `ensureAddable` の**前**に置いている。順序が拘束されていることを確認した。

- 変異: `attachToExistingUser` で `ensureAddable` を `findOAuth` の前に足す
- 結果: `TC-identity-344` が fail（`IdentityLimitExceeded`）。変異は元に戻した

`TC-identity-343` / `344` はどちらも残骸行を 8 件目に置いているので、治癒を消す変異でも上限を先に見る変異でも落ちる。状態遷移も揃っている。

- claim の復旧: 両テストが `resolve("providerAccount", key)` で `active` 復帰を主張
- ID 採番: `343` は返る `identityId` が既存行の ID であること（＝行を作り直していないこと）を主張
- セッション発行: `344` は healing 分岐でも session 行が 1 件増え、返るトークンのハッシュが一致することを主張

治癒分岐は UoW 内で書き込みを行わない（`linkOAuthIdentity`）か session insert だけを行う（`attachToExistingUser`）ので、`committedVersion` に使う `fresh.entity.version` は `activate` の条件として妥当。応答喪失時は `activateUniqueKeys` の `confirm` が現行 version で読み直す既存経路に乗る。治癒分岐が `identity.linked` を再 enqueue しないのも正しい（最初の commit 済みサガが既に collect している）。

### 二平面 Unit of Work

directory 呼び出し（`resolveClaim` / `beginRelease` / `release`）はすべて UoW の**外**にあり、`run` のネストは無い。`identityRemovalRelease` の判定 UoW は global プレーンの `identityRemovalReceiptStore` / `identityRepository` しか触らず、イベント enqueue も無い。`TC-identity-342` の割り込みラッパーも `realProvider.run` が resolve した**後**に別の `run` を走らせる形で、ネストにはなっていない（`identity.identity.removed` の subscriber は `identity.identityRemovalRelease` 1 件だけなので、割り込み点が判定 UoW であることも一意に決まる）。

### 例外・エラーの扱い

新しい `try / catch` は増えていない。`releaseObservedUniqueKey` / `observeActiveUniqueKey` は catch を持たず、失敗はワーカー境界（`worker → root`）まで素通りする。ドメインエラー（`IdentityLimitExceeded`）はユースケース境界で再翻訳されていない。CLAUDE.md の cross-layer catch policy に沿っている。

### 冪等性・部分失敗

再配送で到達しうる列を追った。

- 解放完了後の再配送: 観測 null → `beginRelease` skip → `release` は該当行なしで no-op
- 二重配送の同時実行: 先着が `releasing` へ、後着は `row.state !== "active"` で no-op、双方の `release` が収束
- `beginRelease` 済みで落ちた配送 → 再配送: 観測 null でも `release` で回収（TC-345）
- 解放 → 本人の再連携 → 旧配送の再送: 判定 UoW の `stillClaimed` が `keep` に倒す（既存テスト）
- 判定 commit 直後に解放＋再連携が割り込む: claimToken 不一致で no-op（TC-342）

`keep` 分岐が `release` を呼ばない点は triage で決着済み（`identityRemovalRelease.ts:release を判定の外へ出す`）なので再指摘しない。

### スコープ

差分はすべて計画のステップ上にある。`IdentityPolicy.findOAuth` の追加と `existingLinkId` の寄せ替えは計画本文が明記した範囲、`plantOAuthIdentities` はテストヘルパーの抽出、`store.ts` の `claimToken` は契約に必要な最小追加。「含まれないもの」（D1/DO アダプター、application レベル OCC リトライ、TTL 設計、`releasing` 行の期限、`resolve` 全面置換、3 経路の述語統一）への越境は無い。

### 残す必要のない記述

コード・コメントに指摘への弁明や修正経緯の記述は無い。追加されたコメントはいずれも WHY（順序が正しさの本体である理由、`release` を無条件に呼ぶ理由、`findOAuth` を `ensureAddable` より前に置く理由、memory の claimToken を backend 側に置く理由）で、普遍的な内容に収まっている。

### 回帰

分離した worktree（`HEAD` の detached コピー）で全量を実行し、`Test Files 76 passed / Tests 970 passed | 3 skipped` を確認した。`checkHandleAvailability` の `beginRelease` 直接呼び出しは `resolveClaim` の実観測を渡す形になっており、ダミートークンなら `available: true` の主張が落ちる（no-op → 行が `active` のまま）ので、主張の実効性は保たれている。

（本体ツリーでは並行して別観点のレビューが変異注入中だったため、検証はすべて `git worktree` で切った独立コピーで行い、終了後に worktree を削除した。本体ツリーには一切書き込んでいない。）

## カバレッジ

- 確認: `packages/core/src/application/identity/identityRemovalRelease.ts`, `packages/core/src/application/identity/uniqueness.ts`, `packages/core/src/application/identity/linkOAuthIdentity.ts`, `packages/core/src/application/identity/completeOAuthSignIn.ts`, `packages/core/src/application/identity/__tests__/removeIdentity.test.ts`, `packages/core/src/application/identity/__tests__/linkOAuthIdentity.test.ts`, `packages/core/src/application/identity/__tests__/completeOAuthSignIn.test.ts`, `packages/core/src/application/identity/__tests__/checkHandleAvailability.test.ts`, `packages/core/src/domain/identity/ports/identityUniqueDirectory.ts`, `packages/core/src/domain/identity/services/identityPolicy.ts`, `packages/core/src/adapters/memory/repositories/identityUniqueDirectory.ts`, `packages/core/src/adapters/memory/store.ts`, `packages/core/src/adapters/conformance/identityUniqueDirectory.ts`, `spec/usecases/identity.md`, `spec/testcases/identity/removeIdentity.md`, `spec/testcases/identity/linkOAuthIdentity.md`, `spec/testcases/identity/completeOAuthSignIn.md`
  - 差分外で判断に使った関連ファイル: `packages/core/src/application/identity/removeIdentity.ts`, `packages/core/src/application/identity/updateProfile.ts`, `packages/core/src/application/identity/deleteAccount/globalCleanup.ts`, `packages/core/src/application/workers/subscribers.ts`, `packages/core/src/domain/identity/ports/signInOAuthClient.ts`
- スキップ: `spec/adr/060-conditional-unique-claim-teardown.md` — ADR 本文の正確性は spec 観点の担当
- スキップ: `spec/adr/038-provider-account-claim-and-identity-row.md` — 同上
- スキップ: `spec/adr/054-provider-account-uniqueness-owner.md` — 同上
- スキップ: `spec/adr/index.md` — 一覧・前提依存マップの整合は spec 観点の担当
- スキップ: `spec/database/index.md` — 物理設計の記述は spec / adapter 観点の担当
- スキップ: `spec/domains/identity.md` — ポート契約・ドメインサービスの記述は domain 観点の担当
- スキップ: `spec/inventory/adapter.md` — 台帳の網羅性は spec 観点の担当
- スキップ: `spec/inventory/domain.md` — 同上
- スキップ: `spec/inventory/test.md` — 同上
- スキップ: `spec/inventory/usecase.md` — 同上（記載された 3 ユースケースの振る舞いは上のコード側で確認済み）
