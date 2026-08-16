# レビュー R2 — ドメイン・ポート契約

対象: PR #22 / `origin/main...HEAD`。既出判定 `.thread/14/review/triage.md` の `wont-fix`（M-50）・`defer`（M-06）と、Phase 5 へ切り出し済みの項目（plan スコープ節 12〜15）は再指摘していない。

## ドメイン・ポート契約

### Blockers

- **[B-001]** `IdentityErrorCode` に `InvalidAvatarUrl` を足したが、それを投げる規則（`AvatarUrl` 値オブジェクト / `SameOriginPolicy` ドメインサービス）が `spec/` のどこにも無い
  - 場所: `spec/domains/identity.md:566`（union）、`spec/domains/identity.md:94`（`UserBase.avatarUrl`）、`spec/domains/identity.md:134`（`updateProfile` の振る舞い行）、`spec/inventory/domain.md`（identity 群に対応行なし）
  - 理由: 本 PR は AC-32 / AC-58(b) で 2 つのことを同時にやっている — (a) union に `InvalidAvatarUrl` を追加し、(b) `packages/core/src/domain/identity/errorCode.ts` の冒頭コメント（`InvalidAvatarUrl` の受け皿が spec に無いと名指ししていた唯一の記録）を全文削除した。結果、**spec には「投げられうるコード」だけが載り、それを投げる不変条件・値オブジェクトが 1 つも無い**状態になった。これは M-07（`AccountDeletionRetryPolicy`）で Blocker と判定した「名前だけが宙に浮く」状態（AC-66）そのもので、同じ編集で追加した他の 2 コードは受け皿を持つ（`IdentityLimitExceeded` → `IdentityPolicy.ensureAddable`、`AccountDeletionRetryLimitExceeded` → 新設 `AccountDeletionRetryPolicy`）ため、3 コード中この 1 つだけが非対称に浮いている。
    実装は `packages/core/src/domain/identity/valueObject.ts:168-192` に `AvatarUrl`（trim 後 1〜上限文字、`/` 始まりは `SameOriginPolicy.isSameOriginPath`、絶対 URL は `appUrl` と同一 origin）を持ち、`packages/core/src/domain/identity/services/sameOriginPolicy.ts` はドメインサービスとして実在するのに `spec/domains/identity.md` の「値オブジェクト」節にも「ドメインサービス」節にも `spec/inventory/domain.md` にも行が無い。
    さらに振る舞い表の記述が実装と食い違う: `spec/domains/identity.md:134` は `updateProfile` の引数を `avatarUrl?: string \| null` とし「指定された項目のみ **VO を再構築して**更新」と書くが、実装 `packages/core/src/domain/identity/user.ts:152-171` は `avatarUrl?: AvatarUrl \| null` を受け取り、**エンティティ側では再構築しない**（`AvatarUrl.create` は `appUrl` 設定を要するため `application/identity/updateProfile.ts:163` が呼ぶ）。`displayName` / `bio` だけが表の記述どおりに再構築される。
  - 提案: `spec/domains/identity.md` の「値オブジェクト」節に `AvatarUrl`（フィールド・上限文字数・同一オリジン規則・違反時 `BusinessRuleError(InvalidAvatarUrl)`・`appUrl` を引数で受けて設定を読まないこと）を足し、`SameOriginPolicy` を「ドメインサービス」節に既存 4 サービスと同じ様式で足す。`spec/inventory/domain.md` の identity 群末尾に 2 行を採番する（`DOM-identity-064` / `065`。ADR 052 の末尾採番規則）。`UserBase.avatarUrl` を `AvatarUrl \| null` にし、`updateProfile` の振る舞い行の引数型を `avatarUrl?: AvatarUrl \| null` に改めて「`avatarUrl` は構成（`appUrl`）を要するのでユースケース側で構築して渡す」を 1 句添える。分量が本 PR の枠を超えると判断する場合でも、**削除した errorCode.ts の記録に代わる追跡先を Phase 5 の起票に必ず足す**こと（現状はどこにも追跡が無い）。

- **[B-002]** 適合スイートと台帳の対応規約が「`describe` 名」と書かれているが、実物は `it` 名にしか ADP ID が無く、規約どおりに追うと 0 件になる
  - 場所: `spec/adr/052-adapter-inventory-granularity.md` のコンテキスト節・決定 1・影響節（いずれも「`describe` 名に ADP ID を含める命名規約」）、`spec/inventory/adapter.md:5`（本 PR が新設したヘッダー規則）
  - 理由: ADR 052 は「適合ケースには ID を採番しない／対応は `describe` 名に ADP ID を含める命名規約で追う」を**唯一の追跡手段**として規範化し、`spec/inventory/adapter.md` のヘッダーも同じ文言を正典として掲げている。しかし実測で `packages/core/src/adapters/conformance/` の `describe(...)` 31 本のうち ADP ID を含むものは **0 件**（すべて `` `XxxRepository conformance [${backendName}]` `` の形）で、ID は `it` 名とファイル冒頭の JSDoc にしか無い。R1 の M-11 / U8 が付け替えたのも `it` 名である。**規約を読んで `describe` 名を検査した人は「どのケースも ID を名乗っていない」と結論する。**
    加えて ADR 052 はこの命名規約を「[ADR 026] が既に棄却している（… 対応は `describe` 名に ADP ID を含める命名規約で追う）」と ADR 026 に帰属させているが、`spec/adr/026-port-contract-and-conformance.md` には ADP ID にも命名規約にも言及が無い（`describeXxxContract(name, makeBackend)` というスイート関数名の話だけ）。存在しない前提を根拠にしている。
  - 提案: ADR 052 の 3 か所と `spec/inventory/adapter.md:5` の文言を実物に合わせて「`describe` / `it` 名に ADP ID を含める命名規約」（実際は `it` 名が主で、ポート群の範囲はファイル冒頭 JSDoc が示す）へ改める。ADR 026 への帰属も「ADR 026 はケース単位の spec 新設を棄却した」までに留め、命名規約は本 ADR の決定として書く。

### Warnings

- **[W-001]** `ADP-note-056` が連記の短縮形に埋もれ、ID として到達できない（M-11 の修正が片側だけ完了している）
  - 場所: `packages/core/src/adapters/conformance/noteProjection.ts:13`（ヘッダー `ADP-note-028..034, 055/056`）・`:87`（`it("ADP-note-055/056: ...")`）
  - 理由: `grep -rn "ADP-note-056" packages/core/src/adapters/conformance/` は **0 件**を返す（`ADP-note-055/056` は `ADP-note-055` と裸の `056` に分かれるため）。`.thread/14/adr.md` ADR-029 は連記を決めた際、Consequences に「`grep -o "ADP-[a-z]*-[0-9]*"` が採番済み ID を全数拾えるようになり、台帳 → スイートの到達性が回復する」と書いているが、その主張がこのケースで成立していない。`ADP-note-056`（`PublicNoteProjectionWriter.redactAuthor`）は本 PR が新規採番した行なので、M-11 が問題にした「採番したのにスイートのどこからも名乗られない ID」が 1 本残ったことになる。`ADP-identity-041/009` の `009` も同型だが、こちらは `:113` / `:125` が `ADP-identity-009` を単記しているので到達性は保たれている。
  - 提案: 連記は ID を省略せず全形で書く（`ADP-note-055/ADP-note-056`）。ヘッダーコメントも同様（`ADP-note-028..034, ADP-note-055, ADP-note-056`）。ADR-029 の Consequences が主張する grep が実際に全数を返すことを確認してから閉じる。

- **[W-002]** `ADP-identity-007` に新設した契約（`releasing` の鍵は奪えない）を拘束する唯一のケースが、その ID を名乗っていない
  - 場所: `spec/inventory/adapter.md:56`（`ADP-identity-007` の要点に「奪えるのは失効した `reserved` だけで、`releasing` の鍵は奪えない」を追記）、`packages/core/src/adapters/conformance/identityUniqueDirectory.ts:196`
  - 理由: 上の要点を拘束しているのは `it("ADP-identity-041: a releasing key stays blocked for another user until release")` の 1 本だけで、`ADP-identity-007` を名乗る 4 本（`:62` `:70` `:92` `:103`）はいずれも `releasing` を扱わない。主張の中身は「`beginRelease` 後の鍵に対して `reserve` が conflict を返す」であり、`beginRelease`（041）と `reserve`（007）の協調そのものなので、ADR-029 が `041/009` を認めたのと同じ根拠で連記が要る。台帳の要点だけが強くなり、スイート側から辿れない。
  - 提案: `:196` の `it` 名を `ADP-identity-041/ADP-identity-007` の連記へ改める（第一に拘束するのが `reserve` 側なら順を逆に）。

- **[W-003]** `continuationKey` の「identity 系でこの鍵を持たないのは 1 つだけ」という断定が、同じ diff で追加した継続要求と噛み合わない
  - 場所: `spec/domains/index.md:312`（規約段落の末尾）と `spec/domains/index.md:302`（本 PR が追加した `identity.personalCleanupHandoverContinued` の行）
  - 理由: 追加した文は「identity 系でこの鍵を持たないのは `identity.userAuthResidueCleanupContinued` だけで、理由はカーソルを持たない継続だからである」と書くが、同じ表に本 PR が足した `identity.personalCleanupHandoverContinued` の payload は `{ deletionOperationId }` で `continuationKey` を持たない（実装 `packages/core/src/application/workers/scopeTaskRunner.ts:29,55-62` — scope 平面の `scheduled_tasks` として `(kind, operationId)` で冪等化する）。既存の `identity.personalBarrierPruneContinued` も同じ。段落の直前の文が scope 平面は `operation_id` で導出すると述べているので**読み替えれば整合するが、断定の主語が「identity 系」（ドメイン軸）で、除外の軸（global outbox 平面か scope 平面か）と揃っていない**。M-22 で導出式の例外を明示したのと同じ精度が、この 1 文には掛かっていない。
  - 提案: 「**global outbox で運ぶ identity 系の継続要求のうち**この鍵を持たないのは `identity.userAuthResidueCleanupContinued` だけで」と平面を明示する（scope 平面の継続は `scheduled_tasks` の `operation_id` が同じ役割を担う旨は直前の文が既に述べている）。

- **[W-004]** M-23 で精密化した `reserve` の衝突条件が、`spec/usecases/identity.md` の `updateProfile` 手順 2 に伝播していない
  - 場所: `spec/usecases/identity.md:632`
  - 理由: 本 PR は `spec/domains/identity.md:405` と `packages/core/src/domain/identity/ports/identityUniqueDirectory.ts:22-26` の両側で「判定材料は operation ID であって利用者ではない／奪えるのは期限切れの `reserved` だけ」まで精密化した（M-23）。ところが `updateProfile` 手順 2 は「別 user の active/**reserved** 行があれば `ConflictError("HANDLE_ALREADY_USED")`」のままで、(a) 同じ利用者の別 operation からの再予約も衝突する事実、(b) `releasing` の行も奪えない事実、の両方を落としている。実装 `packages/core/src/adapters/memory/repositories/identityUniqueDirectory.ts:50-68` の判定は `existing.operationId !== input.operationId && !(reserved && 期限切れ)` である。**同じ「手順が新しいポート契約と噛み合わない」という指摘（M-20）は `linkOAuthIdentity` 手順 3 についてだけ修正され（`:344`）、構造的に同型の `updateProfile` 手順 2 が置き去りになっている。**
  - 提案: `:632` を `:344` と同じ粒度へそろえる（「handle reservation を operation ID 付きで確保する。既に別 operation が保持していれば `ConflictError("HANDLE_ALREADY_USED")`。奪えるのは期限切れの `reserved` だけで、`releasing` の行は奪えない」）。

- **[W-005]** `AuthTokenRepository.findPendingByUserAndPurpose` の JSDoc が、本 PR が spec 側で名指しした 2 つの呼び出し元のうち 1 つしか挙げていない
  - 場所: `packages/core/src/domain/identity/ports/authTokenRepository.ts:21-27`
  - 理由: 本 PR が追加した `spec/domains/identity.md:449` は「再送間隔の判定はここを通す（`resendVerificationEmail` / `requestPasswordReset`）」と 2 つを名指ししている。一方ポート JSDoc は "which is what the resend interval of `resendVerificationEmail` is measured from" と 1 つしか書かない。実装は両方が呼ぶ（`application/identity/resendVerificationEmail.ts:65` / `requestPasswordReset.ts:88`）。ADR 026 が契約の正本をポート定義に置いている以上、JSDoc だけを読んだ実装者は「パスワード再設定の 60 秒間隔はこの索引の担保外」と読みうる。M-03 / AC-45 で `requestPasswordReset` の 60 秒間隔を spec の正典に据えた分、片側だけ弱いまま残った。
  - 提案: JSDoc の当該文へ `requestPasswordReset` を併記する（1 語）。

### カバレッジ

- 確認: `packages/core/src/adapters/conformance/accountDeletionManifestStore.ts`, `packages/core/src/adapters/conformance/authTokenRepository.ts`, `packages/core/src/adapters/conformance/identityUniqueDirectory.ts`, `packages/core/src/adapters/conformance/noteProjection.ts`, `packages/core/src/adapters/conformance/objectStorage.ts`, `packages/core/src/adapters/conformance/scopeCleanupAdmissionStore.ts`, `packages/core/src/adapters/conformance/signInOAuthClient.ts`, `packages/core/src/application/di/containerStore.ts`, `packages/core/src/application/identity/completeOAuthCallback.ts`, `packages/core/src/application/identity/removeIdentity.ts`, `packages/core/src/application/identity/uniqueness.ts`, `packages/core/src/application/identity/view.ts`, `packages/core/src/application/ports/accountDeletionManifestStore.ts`, `packages/core/src/application/ports/scopeCleanupAdmissionStore.ts`, `packages/core/src/application/ports/shareTokenProtector.ts`, `packages/core/src/application/storage/__tests__/deleteFilesByOwner.test.ts`, `packages/core/src/domain/identity/errorCode.ts`, `packages/core/src/domain/identity/ports/identityRepository.ts`, `packages/core/src/domain/identity/ports/identityUniqueDirectory.ts`, `packages/core/src/domain/storage/errorCode.ts`, `spec/adr/052-adapter-inventory-granularity.md`, `spec/adr/053-account-deletion-rollback-completion.md`, `spec/adr/054-provider-account-uniqueness-owner.md`, `spec/database/index.md`, `spec/domains/identity.md`, `spec/domains/index.md`, `spec/domains/note.md`, `spec/domains/storage.md`, `spec/domains/usage.md`, `spec/inventory/adapter.md`, `spec/inventory/domain.md`, `spec/testcases/identity/checkHandleAvailability.md`, `spec/usecases/identity.md`, `.thread/14/plan.md`, `.thread/14/review/triage.md`（35 件）
- スキップ: `.thread/14/review/review-001-{docs,domain,general,inventory,presentation,usecase}.md`, `.thread/14/review/review-001.md` — レビュー中間成果物（7 件）
- スキップ: `.thread/14/adr.md`, `.thread/14/research.md`, `.thread/14/research-2.md`, `.thread/14/steps.md`, `.thread/14/testing.md` — 作業成果物。general 観点の担当（5 件）
- スキップ: `.dockerignore`, `apps/web/.dev.vars.example`, `apps/web/.env.aws.example`, `apps/web/.env.gcp.example` — 他ランタイム残骸の削除。ドメイン契約に無関係（4 件）
- スキップ: `CLAUDE.md`, `README.md`, `docs/backend_implementation_example.md`, `docs/frontend_implementation_example.md` — docs 観点の担当（4 件）
- スキップ: `apps/web/app/components/settings/DeleteAccountPanel/ticketStorage.ts`, `apps/web/app/presentation/oauthStateCookie.ts`, `apps/web/app/presentation/session.ts`, `apps/web/app/start.ts` — presentation 層のコメント差し替え。presentation 観点の担当（4 件）
- スキップ: `spec/adr/055-session-expiry-derivation.md`, `spec/adr/056-performance-budget-placement.md`, `spec/adr/057-manual-test-followthrough.md`, `spec/adr/index.md` — セッション期限 / 性能予算 / 手順書追随の ADR。presentation・docs 観点の担当（4 件）
- スキップ: `spec/inventory/frontend.md`, `spec/inventory/test.md`, `spec/inventory/usecase.md` — inventory 観点の担当（3 件）
- スキップ: `spec/manual-tests/account.md`, `spec/manual-tests/index.md` — 手順書。docs 観点の担当（2 件）
- スキップ: `spec/pages/index.md`, `spec/platform/index.md`, `spec/presentation/index.md`, `spec/scenario/account.md` — 画面 / 実行基盤 / 転送境界 / シナリオ。presentation 観点の担当（4 件）
- スキップ: `spec/testcases/identity/{addPasswordIdentity,completeOAuthCallback,completeOAuthSignIn,deleteAccount,getProfile,requestPasswordReset,signUpWithPassword,startOAuthFlow}.md`, `spec/testcases/storage/deleteFilesByOwner.md` — テストケース表。usecase 観点の担当（9 件。`checkHandleAvailability.md` のみ `resolve` 契約の検証のため確認側に入れた）
- スキップ: `spec/usecases/storage.md`, `spec/usecases/usage.md` — usecase 観点の担当（2 件）

合計 35 + 48 = 83 件（変更ファイル一覧と 1 対 1）。

## R1 修正の検証結果

| Key | 判定 | 根拠 |
| --- | --- | --- |
| M-01 `ExternalServiceError` → `ExternalApiError`（identity 側） | 正しく入っている | `grep -rn "ExternalServiceError" spec/usecases/identity.md spec/testcases/identity/ spec/inventory/test.md` の identity 分が 0 件。`spec/domains/identity.md:509` は `SystemError(ExternalApiError)`、実装 `application/errors.ts:184` に同名コードが実在。スコープ外の `PasswordHasher`（`:467`）/ `SecureTokenGenerator`（`:484`）は plan どおり据え置き |
| M-02 spec を名指しで否定する JSDoc | 正しく入っている | `uniqueness.ts:63` / `removeIdentity.ts:21` は `spec/adr/048` 参照へ、`view.ts:17-19` は否定句を削除。式・型・引数は無変更 |
| M-07 `AccountDeletionRetryPolicy` のドメインサービス定義 | 正しく入っている | `spec/domains/identity.md:344-362` が既存 3 サービスと同じ様式（責務 + メソッド表 + 定数表 + 依存ポート）。実装 `domain/identity/services/accountDeletionRetryPolicy.ts` と `retentionWindowMs = 120 日` / `maxTerminalAttempts = 8` / `windowStart(now)` / `ensureRetryable(terminalCount)` → `BusinessRuleError(AccountDeletionRetryLimitExceeded)` まで一致。`spec/inventory/domain.md:113` に `DOM-identity-063` を末尾採番、粒度も既存のドメインサービス行（1 サービス = 1 行）と一致 |
| M-20 `linkOAuthIdentity` 手順 3 と `resolve` の契約 | 正しく入っている（ただし同型の未修正が 1 か所 → W-004） | `spec/usecases/identity.md:344` が `resolve` の返す範囲と、`reserved` / `releasing` の衝突は後続 `reserve` が返す旨に書き換わり、実装 `linkOAuthIdentity.ts` の分岐と一致 |
| M-22 `continuationKey` の compact 例外 | 正しく入っている | `spec/domains/index.md:312` が「`phase` の位置に固定文字列 `compact` を置く」と明記。実装 `application/identity/continuations.ts:180-185` が `continuationKey(type, operationId, "compact", cursor)` を渡す |
| M-23 `reserve` のエラー条件（spec / JSDoc 両側） | 正しく入っている（伝播が 1 か所不足 → W-004） | `spec/domains/identity.md:405` と `domain/identity/ports/identityUniqueDirectory.ts:22-26` が「別の operation が保持（失効した `reserved` を除く）」へ。memory 実装 `identityUniqueDirectory.ts:54-68` の判定材料（`operationId` 一致 + 失効 `reserved` の例外）と一致 |
| M-11 適合スイートの ADP ID 付け替え | 不完全（W-001 / W-002。B-002 も同根） | 付け替えた 8 件は**すべて台帳の指す要素と一致**（下表）。ID の衝突・重複も 0（`packages/core/src/adapters/conformance/` 全体で同一 ID が 2 ファイルに現れる例なし）。ただし `ADP-note-056` が短縮連記で grep 到達不能、`ADP-identity-007` の新設主張を拘束するケースが 007 を名乗らない、規約の記述（`describe` 名）が実物（`it` 名）と食い違う |

### M-11 の 1 件ずつの照合（ID が指す要素 vs 台帳）

| ファイル | 付け替え後の ID | `spec/inventory/adapter.md` の要素 | 判定 |
| --- | --- | --- | --- |
| `accountDeletionManifestStore.ts:100` | `ADP-common-041` | `AccountDeletionManifestStore.describe` | 一致（`it` の主張は `describe` が継続の再開点を返すこと） |
| `scopeCleanupAdmissionStore.ts:132` | `ADP-common-040` | `ScopeCleanupAdmissionStore.describePersonalCleanup` | 一致 |
| `scopeCleanupAdmissionStore.ts:68` | `ADP-common-008`（据え置き + 主張追記） | `ScopeCleanupAdmissionStore.assertOwner` | 一致。台帳の要点も「完了済みの barrier も拒否する」へ追随済み |
| `identityUniqueDirectory.ts:179,196,210,226,238,256`（6 本） | `ADP-identity-041` / `041/009` | `IdentityUniqueDirectory.beginRelease` | 一致（`:196` のみ 007 の連記が要る → W-002） |
| `noteProjection.ts:87` | `ADP-note-055/056` | `Local/PublicNoteProjectionWriter.redactAuthor` | 一致（`056` が grep 到達不能 → W-001） |
| `objectStorage.ts:94` | `ADP-storage-024` | `ObjectStorage.publicUrl` | 一致 |
| `authTokenRepository.ts:81` | `ADP-identity-039` | `AuthTokenRepository.findPendingByUserAndPurpose` | 一致 |
| `signInOAuthClient.ts:81` | `ADP-identity-040` | `SignInOAuthClient.deriveCodeChallenge` | 一致 |

## 併せて確認して問題が無かった点

- **エラーコード union の集合一致**: `IdentityErrorCode`（spec 14 / 実装 14）、`StorageErrorCode`（8 / 8）、`NoteErrorCode`（13 / 13）、`UsageErrorCode`（5 / 5）がいずれも集合として一致
- **`terminal 行` の語彙**: `spec/usecases/identity.md:771` が `completed` / `rejected` の両方を明記、`spec/database/index.md:148` の `state NOT IN ('completed','rejected')` と `spec/domains/index.md:147` の 3 値、実装 `application/ports/distributedOperationStore.ts:10-11`（`completed` と `rejected` が terminal）まで一貫。memory 実装 `countTerminalSince` も `terminalAt !== null` で両方を数える
- **ポート型と実装の一致**: `ScopeCleanupAdmissionStore`（`PersonalCleanupComponent` / `PersonalCleanupProgress` / メソッド 9 本の並びと型）、`AccountDeletionManifestStore`（`AccountDeletionReceipt` / `AccountDeletionManifestHeader` 8 フィールド / `pruneTerminal` の `operationIds` 戻り値）、`IdentityUniqueDirectory`（4 メソッドの非対称 4 点）、`SignInOAuthClient`、`AuthTokenRepository`、`ObjectStorage`、`Local/PublicNoteProjectionWriter.redactAuthor` + `AuthorRedaction` がいずれも spec の interface 記述と一致
- **ドメイン不変条件と実装**: `Note` の公開⇄本文降格の双方向禁止（`domain/note/note.ts:90-102` の `ensurePrivate`）、`Note.reconstruct` の ready 必須列拒否（`:705-745` → `RehydrationError`）、`NoteTitle` 200 超過の `BusinessRuleError(InvalidTitle)`、`Excerpt` / `NoteHeading` のサロゲートペアを割らない切り詰め（`truncateWithoutSplittingPair`）、`StorageQuota.replaceTotals` の負値・非整数拒否、`UploadValidationPolicy.ensureAcceptable` の `{ purpose, body }` → `AcceptedUpload` すべて spec の記述どおり
- **ADR 053 / 054 の内容と実装**: `allRollbackReleased` は membership item の release ack のみ、`allRequiredAcknowledged` は全 item 完全 ack + 宣言 receipt（memory 実装 `accountDeletionManifestStore.ts:121-131`）。provider account の一意性は `IdentityUniqueDirectory` だけが担保し `IdentityRepository` は検査しない（実装も同じ）
- **振る舞いを変える差分が無いこと**: `git diff -U0 origin/main...HEAD -- packages/ apps/` からコメント / JSDoc / `it`・`describe` 名を除いた残りは、適合スイート `ADP-common-008` への追加アサーション 9 行（空行 1 含む）と `containerStore.ts` のエラーメッセージ 3 行、および `.env*.example` 3 本の削除のみ。`pnpm vitest run --root packages/core` は 65 ファイル / 857 件が緑
- **経緯・弁明の残置**: `spec/domains/`・`spec/inventory/{domain,adapter}.md`・ポート JSDoc・適合スイートに「レビュー」「以前は」「訂正」等の残置は 0 件
