# レビュー — PR #22（ドメイン・ポート契約）

観点: `spec/domains/*.md` とポート定義（`packages/core/src/domain/**/ports/`・`packages/core/src/application/ports/`）の一致、変更された JSDoc / コメントの真偽、適合スイート追加の実効性、新規採番ポートメソッドの実在、エラーコード union の集合一致。

## 前提と検証方法

`spec/adr/046`（正本のある側へ倒す）と `.thread/14/plan.md` の受け入れ基準を基準に、**spec の記述を実装コードに突き合わせて**検証した。読み合わせた実装は以下（差分外）:

- `packages/core/src/adapters/memory/repositories/{scopeCleanupAdmissionStore,accountDeletionManifestStore,identityUniqueDirectory,noteRouteStore,noteRouteFanOutReader,noteRepository,noteProjection}.ts`
- `packages/core/src/domain/note/{note.ts,valueObject.ts,errorCode.ts}`、`packages/core/src/domain/identity/{errorCode.ts,services/identityPolicy.ts,ports/*.ts}`、`packages/core/src/domain/storage/{errorCode.ts,services/uploadValidationPolicy.ts}`、`packages/core/src/domain/usage/storageQuota.ts`
- `packages/core/src/application/ports/{noteRouteStore,noteRouteFanOutReader,objectStorage,appliedOperationStore,distributedOperationStore}.ts`、`application/identity/{continuations,uniqueness,removeIdentity,linkOAuthIdentity,completeOAuthSignIn}.ts`、`application/workers/scopeTaskRunner.ts`、`application/storage/{deleteFilesByOwner,storeAvatar}.ts`、`application/usage/recalculateStorageUsage.ts`
- `apps/web/app/presentation/session.ts`、`apps/web/app/server.node.ts`
- 適合スイートは `pnpm vitest run -t "ADP-common-008"` で緑を確認（1 passed）

### 一致を確認できたもの（主要なもののみ）

| spec の主張 | 実装 | 判定 |
| --- | --- | --- |
| `IdentityErrorCode` 14 コード | `domain/identity/errorCode.ts` 14 コード | 集合一致 |
| `StorageErrorCode` 8 コード（`InvalidChecksum` 追加） | `domain/storage/errorCode.ts` 8 コード | 集合一致 |
| `NoteErrorCode` / `UsageErrorCode`（本 PR で未変更） | 実装と集合一致（回帰なし） | OK |
| 新規採番 8 メソッド（`describePersonalCleanup` / `describe` / `findPendingByUserAndPurpose` / `deriveCodeChallenge` / `beginRelease` / `publicUrl` / `redactAuthor` ×2） | すべて実在し、引数・戻り値・null 条件までシグネチャ一致 | OK |
| `IdentityUniqueDirectory` の非対称 4 点（resolve / reserve / beginRelease / release） | `adapters/memory/repositories/identityUniqueDirectory.ts:40-146` の全分岐と一致（`reserve` が奪えるのは失効した `reserved` のみ、`release` は `active` に触れない） | OK |
| `allRequiredAcknowledged` / `allRollbackReleased` の非対称 | `membershipFullyAcked = prepareAckedAt && cleanupAckedAt` / `membershipReleased = prepareDispatchedAt === null \|\| releaseAckedAt !== null` と一致 | OK |
| `assertOwner` が completed を拒否 | `requireOwner` が `status !== "running"` を弾く。追加された適合ケースが実効的に拘束している | OK |
| `NoteTitle` 200 / `Excerpt` / `NoteHeading` の UTF-16 コード単位・サロゲート非分割 | `truncateWithoutSplittingPair`（`valueObject.ts:99-112`）と一致 | OK |
| `Note.reconstruct` が ready 必須列の欠落を `RehydrationError` で拒否 | `note.ts:722-736` + `:658` の wrap と一致 | OK |
| `markConversionFailed` / `markAwaitingIntegration` の `ensurePrivate` ガード | `note.ts:96-103,305,323` と一致 | OK |
| `listByOwner` の `updatedAt DESC, id DESC` | memory 実装のソートと一致 | OK |
| `resolveMany` 上限超過 → `SystemError(DatabaseError)`（500 / 100） | port JSDoc・memory 実装・`ADP-note-036` と一致 | OK |
| `NoteRouteFanOutReader` の列挙集合（`reserved` のみ除外、`tombstone` unspecified） | port JSDoc と memory 実装（`row.state !== "reserved"`）と一致 | OK |
| `redactAuthor` の 3 no-op 条件 | `noteProjection.ts:56-70` の `redactedRow` と一致 | OK |
| `ShareTokenProtector` → `SystemError(DataIntegrityError)` | `adapters/memory/shareTokenProtector.ts:31,67,80` と一致（`ExternalServiceError` は実在しない） | OK |
| `continuationKey` の導出式・`userAuthResidueCleanupContinued` だけ鍵を持たない理由 | `application/identity/continuations.ts:91-96` と一致（ただし W-005） | 概ね OK |
| sub-operation ID の合成 `` `${parent}:${kind}:${normalizedKey}` `` | `uniqueness.ts:76` と一致 | OK |
| `AppliedOperationStore` を鍵の意味で分ける | `ports/appliedOperationStore.ts` の `(operationId, commandKey)` と一致 | OK |
| `DistributedOperationStore.state` 3 値 | `ports/distributedOperationStore.ts:11` と一致 | OK |
| `UploadValidationPolicy.ensureAcceptable({ purpose, body }) → AcceptedUpload` | `services/uploadValidationPolicy.ts:101-133` と一致（署名判定は PNG/JPEG/WebP のみ、という但し書きも実装どおり） | OK |
| `StorageQuota.replaceTotals`（負値・非整数は `InvalidDelta`） | `storageQuota.ts:76-90` + `ensureNonNegativeDelta` と一致 | OK |
| `deleteFilesByOwner` / `deleteQuota` の `ScopeCleanupTurn` 戻り値 | 実装の 4 status と一致 | OK |
| ADR 055 のセッション期限再導出 | `apps/web/app/presentation/session.ts:101` と一致 | OK |
| ADR 053 の「rollback 経路は application へ未配線」 | `beginRollback` / `allRollbackReleased` / `markRejected` の呼び出しはポート定義のみ。前提は正確 | OK |
| `containerStore.ts` の runtime entry 記述 | `apps/web/app` に `server.node.ts` のみ実在 | OK |
| `start.ts` の参照先 | `spec/presentation/index.md` の CSRF 規約表に `createCsrfMiddleware` の規律が実在 | OK |

`spec/inventory/{domain,adapter}.md` の新規 16 行（DOM 8 / ADP 8）は**各群の末尾**に採番されており、既存 ID の指す要素は動いていない。要点欄の記述もすべて上表の実装と一致していた。

---

## Blockers

- **[B-001]** `SignInOAuthClient` のエラー語彙をポート契約だけ直し、同じ失敗を指す identity 側の 3 か所を取り残したため、**spec 内部に新しい矛盾が生まれている**
  - 場所: `spec/domains/identity.md:489`（変更後 = `SystemError(ExternalApiError)`）に対して
    - `spec/usecases/identity.md:277`（`completeOAuthSignIn` エラーケース表「コード交換の失敗」）= `SystemError(ExternalServiceError)`
    - `spec/testcases/identity/completeOAuthSignIn.md:18` = `SystemError(ExternalServiceError)`
    - `spec/inventory/test.md:178`（TC-identity-037）= `SystemError(ExternalServiceError)`
  - 理由: `ExternalServiceError` は `SystemErrorCode` に存在しない（`packages/core/src/application/errors.ts:180-190` は `DataIntegrityError` / `ExternalApiError` のみ）。実装 `adapters/oauth/googleSignInOAuthClient.ts:37-38` は `SystemErrorCode.ExternalApiError` を投げる。したがって TC-identity-037 は**どのバックエンドでも満たせない期待値**になり、テストを書く人は存在しないコードを assert することになる。plan がこれを SYNC-27（全域語彙整合）として先送りした根拠は「未実装ドメイン（conversion / integration / storage / job）は写し先の裏づけが取れない」であり、**identity の OAuth クライアントは実装済み**なのでこの根拠が当たらない。同一ドメイン内で、ポート契約とその失敗を参照する下流 3 文書が食い違う状態は、AC-33 が直そうとした乖離と同じ種類のものを別の場所へ移しただけになっている
  - 提案: identity 側の 3 か所を `SystemError(ExternalApiError)` に置換する（`ShareTokenProtector` を AC-18 で 1 件だけ直したのと同じ扱い）。触るファイルが `spec/usecases/identity.md` / `spec/testcases/identity/completeOAuthSignIn.md` / `spec/inventory/test.md` の 3 か所に閉じるので、SYNC-27 の残り（conversion / integration / storage / job / `PasswordHasher` / `SecureTokenGenerator`）はそのままフォローアップ Issue に残せる。`spec/domains/identity.md:447,464` の 2 件を残す判断（plan のテスト方針で明示）とも矛盾しない

- **[B-002]** 実装コメントが「spec は `sha256(...)` と書いている」と述べたまま残っており、本 PR がその spec を合成式へ書き換えた結果、**コメントの主張が事実に反する状態になった**
  - 場所: `packages/core/src/application/identity/uniqueness.ts:63-64`、`packages/core/src/application/identity/removeIdentity.ts:21-23`
    ```
    * Composed rather than hashed (the spec writes `sha256(parent + ":" +
    * kind + ":" + normalizedKey)`): ...
    ```
  - 理由: 本 PR は `spec/database/index.md:57` を `` `${parentOperationId}:${kind}:${normalizedKey}` `` に、`spec/usecases/identity.md:576` を `` `removeIdentity:${identityId}` `` に書き換えた。したがって「the spec writes sha256(...)」はもう真ではない。AC-67 が掲げた目的は grep の 0 件ではなく「実装が spec を名指しで否定している状態を解消する」であり、spec 側だけ直した結果、**否定の向きが逆になっただけで状態は解消していない**（次に読む人は「spec と実装のどちらが古いのか」をまた調べ直すことになる）。加えてこれは、本 PR が `domain/identity/errorCode.ts` / `domain/storage/errorCode.ts` の冒頭コメントを全文削除した理由（乖離の経緯・弁明はコードに残さない）とまったく同じ種類の記述であり、同じ PR の中で扱いが割れている
  - 提案: 2 ファイルの当該カッコ書きを落とし、「合成で決定性と識別性が得られ、application 層にハッシュ実装を持ち込まない」という**理由だけ**を残す（`spec/adr/048` へのリンクで足りる）。コード差分は 9 → 11 ファイルになるが、AC-63 の趣旨（振る舞いを変える差分 0）は保たれる。ファイル数の上限を優先して事実に反するコメントを残すのは、この PR の目的と反する

---

## Warnings

- **[W-001]** 新設した `resolve` の契約（`reserved` / `releasing` は `null`）が、既存のユースケース手順と噛み合っていない
  - 場所: `spec/domains/identity.md:374`（`resolve` は恒久 claim だけを返す）↔ `spec/usecases/identity.md:343`（`linkOAuthIdentity` 手順 3「providerAccount directory を解決し、**別 userId の active/reserved 行があれば** `ConflictError("PROVIDER_ACCOUNT_ALREADY_LINKED")`」）
  - 理由: 新しい契約では `resolve` から `reserved` 行は観測できない。実装 `application/identity/linkOAuthIdentity.ts:96-105,117` も `resolve`（= active のみ）で他人所有を弾き、`reserved` 行との衝突は後続の `reserve` が投げる形になっている。手順 3 は「解決して reserved を見る」と読めるので、この PR が resolve の非対称を明文化したことで**手順 3 が実装不能な記述として浮き上がった**。AC-31 が意図した「4 メソッドの非対称を取り違えない」ための説明が、下流で取り違えを誘発する
  - 提案: 手順 3 を「directory を解決して別 userId の恒久 claim があれば `PROVIDER_ACCOUNT_ALREADY_LINKED`。なければ reservation を確保する（進行中の予約や `releasing` との競合は `reserve` が同じコードで返す）」に直す。1 行の修正で、`spec/domains/identity.md` の非対称 4 点とそのまま対応する

- **[W-002]** 本 PR が採番した ADP ID の**どれ 1 つも**適合スイートの `describe` / `it` 名に現れず、しかも既存ケースが**別メソッドの ID** を名乗ったままになっている
  - 場所:
    - `adapters/conformance/scopeCleanupAdmissionStore.ts:132` — `describePersonalCleanup` のケースが `ADP-common-009`（= `acknowledgePersonalComponent`）を名乗る。正しくは新設の `ADP-common-040`
    - `adapters/conformance/accountDeletionManifestStore.ts:100` — `describe` のケースが `ADP-common-012`（= `begin`）。正しくは `ADP-common-041`（plan の相乗り (a) で把握済み）
    - `adapters/conformance/identityUniqueDirectory.ts:179,210,226,238,256` — `beginRelease` のケース **5 本**が `ADP-identity-009`（= `release`）。正しくは `ADP-identity-041`
    - `adapters/conformance/noteProjection.ts:87` — `redactAuthor` のケースが `ADP-note-028`（= `replaceSnapshotIfNewer`）。正しくは `ADP-note-055` / `056`
    - `adapters/conformance/authTokenRepository.ts:81`（`findPendingByUserAndPurpose`）、`signInOAuthClient.ts:80`（`deriveCodeChallenge`）— ADP ID を持たない
    - `adapters/conformance/objectStorage.ts:22-23` — ヘッダーが `(ADP-storage-018..020 + \`publicUrl\`)` のまま（plan の相乗り (b) で把握済み）
  - 理由: 本 PR が新設した `spec/adr/052` は「適合ケースに ID は振らず、**対応は `describe` 名に ADP ID を含める命名規約で追う**」を決定として書き、`spec/inventory/adapter.md` のヘッダーにも明文化した。その規約を規範化した当の PR が採番した 8 行について、規約が 1 件も成立していない。さらに 4 か所は**他メソッドの ID を名乗っている**ので、ID から逆引きすると誤ったケースに当たる（無印より悪い）。plan の相乗り 2 件（`ADP-common-012` / `objectStorage` ヘッダー）は把握されているが、`ADP-common-009` / `ADP-identity-009` ×5 / `ADP-note-028` / 無印 2 件は台帳にも Issue にも載っていない
  - 提案: コード差分の枠を守るなら、フォローアップ Issue（plan「Phase 5 で起票するもの」6.）の相乗りリストを上記**全件**に差し替える。枠を動かせるなら `it` 名の書き換えは振る舞いを変えない機械的修正なので本 PR で済ませるほうが安い

- **[W-003]** 追加した適合ケースの主張が `it` 名に反映されていない
  - 場所: `packages/core/src/adapters/conformance/scopeCleanupAdmissionStore.ts:68`（`it("ADP-common-008: assertOwner rejects a different id and a missing receipt")`）に対して `:74-84` で completed barrier の拒否を追加
  - 理由: 追加された主張自体は実効的（`requireOwner` が `status !== "running"` を弾くため、この振る舞いを落とすとケースが赤くなることを確認した）。ただし ADR 052 の下では `it` 名が台帳行への唯一のリンクであり、名前が主張を網羅していないと「ADP-common-008 の何が拘束されているか」を名前から読めない。`spec/inventory/adapter.md` の ADP-common-008 行は「完了済みの barrier も拒否する」と更新済みなので、スイート側だけが追随していない
  - 提案: `it("ADP-common-008: assertOwner rejects a different id, a missing receipt, and a completed barrier")` に変更する（1 行）

- **[W-004]** 採番規則のヘッダー明文化が `adapter.md` / `test.md` にしか無く、同じ末尾採番を受けた `domain.md` / `usecase.md` に無い
  - 場所: `spec/inventory/domain.md:3`、`spec/inventory/usecase.md:3`（ヘッダーは「生成元 / 最終同期」のみ）↔ `spec/inventory/adapter.md:5`、`spec/inventory/test.md:5`（規則あり）
  - 理由: 本 PR は `domain.md` に 8 行（`DOM-common-041,042` / `DOM-identity-060〜062` / `DOM-note-071,072` / `DOM-storage-038`）、`usecase.md` に 3 行を**群の末尾**へ採番している。ADR 052 の決定は DOM / ADP / UC / TC すべてに掛かるのに、規則が書いてある台帳と書いていない台帳が生まれた。計画レビュー R3（arch:S-001）が `test.md` について潰した非対称と同型のものが 2 ファイル分残っている。読み手は `domain.md` の行順と ID 順の不一致を「並べ間違い」と読みうる
  - 提案: `adapter.md` と同じ 1 行（「新規要素は各群の末尾に採番し、出現順に挿入して既存 ID を繰り下げない。ID は行位置ではない」＋ ADR 052 へのリンク）を `domain.md` / `usecase.md` のヘッダーにも置く

- **[W-005]** `continuationKey` の導出式が、3 つの継続要求のうち 1 つに当てはまらない
  - 場所: `spec/domains/index.md:312`（`` `${eventType}:${operationId}:${phase}:${cursor ?? "-"}` ``）、payload 定義は同ファイル `:301`
  - 理由: `identity.accountDeletionManifestCompactContinued` の payload は `{ operationId, cursor, continuationKey }` で **`phase` を持たない**。実装 `application/identity/continuations.ts:180-185` は `phase` の位置にリテラル `"compact"` を渡している。式をそのまま読むと、この 1 種類だけ payload から鍵を再導出できない（表側の payload 定義とも噛み合わない）。決定性という性質自体は満たされているので実害は小さいが、「commit 応答を失ったターンが同じ鍵を再導出する」という説明の検証可能性が落ちる
  - 提案: 「`phase` を持たない継続（compact）では `phase` の位置に固定文字列（`compact`）を置く」を式の直後に半行足す

- **[W-006]** `IdentityUniqueDirectory` のエラーケースの条件が実装よりわずかに狭い（低）
  - 場所: `spec/domains/identity.md:385`（「鍵を**別の利用者**が持っている」）
  - 理由: memory 実装 `identityUniqueDirectory.ts:53-66` は、行が失効していない限り**同じ利用者**が別 operation ID で再予約した場合も同じ `ConflictError` を投げる（判定材料は `operationId` の一致であって `userId` ではない）。ポート JSDoc も同じ表現なので**本 PR が矛盾を新設したわけではない**が、AC-31 で `reserve` の奪取条件を精密に書いた段落と並ぶと、条件が 1 段粗いのが目立つ
  - 提案: 「別の operation が保持している（失効した `reserved` を除く）」に寄せる。spec と JSDoc を同時に直す必要があるので、B-002 の修正と同じコミットに載せられる

---

## スコープ確認

- `.thread/14/plan.md`「含まれないもの」の非侵食は成立していた: `grep -n "createDownloadUrl" spec/domains/storage.md` は 3 件（interface 行・説明段落・`expiresInMs` 段落）、`spec/usecases/usage.md` の `workspaceCursor` / `nextWorkspaceCursor`、`spec/database/index.md` の `next_attempt_at` / `attempts` / `expires_at`、P-25 の機能行はいずれも残存。**実装の縮退を spec へ書き写した箇所は見つからなかった**
- コード差分は plan が宣言した 9 ファイルに収まっており、振る舞いを変える差分は 0（`containerStore.ts` は JSDoc とエラーメッセージ文言、適合スイートの追加ケースは memory 実装が既に満たす）。ただし B-002 のとおり、**9 ファイルという枠自体が 2 ファイル足りていない**
- `spec/domains/index.md` に `DistributedOperationStore` の interface が新設されていないこと（ADR 015 の維持）、`AppliedOperationStore` が 1 行言及にとどまること（AC-66）も確認した

## カバレッジ

- 確認: `packages/core/src/adapters/conformance/scopeCleanupAdmissionStore.ts`, `packages/core/src/application/di/containerStore.ts`, `packages/core/src/application/ports/accountDeletionManifestStore.ts`, `packages/core/src/application/ports/scopeCleanupAdmissionStore.ts`, `packages/core/src/application/ports/shareTokenProtector.ts`, `packages/core/src/domain/identity/errorCode.ts`, `packages/core/src/domain/identity/ports/identityRepository.ts`, `packages/core/src/domain/storage/errorCode.ts`, `apps/web/app/start.ts`, `spec/domains/identity.md`, `spec/domains/index.md`, `spec/domains/note.md`, `spec/domains/storage.md`, `spec/domains/usage.md`, `spec/database/index.md`, `spec/inventory/domain.md`, `spec/inventory/adapter.md`, `spec/inventory/usecase.md`（採番規則・UC 新規 3 行のみ）, `spec/inventory/test.md`（TC-identity-037 行と採番規則ヘッダーのみ）, `spec/usecases/identity.md`（ポート・ドメイン契約に関わる箇所のみ）, `spec/usecases/storage.md`, `spec/usecases/usage.md`, `spec/presentation/index.md`（`AppConfig` 例外と CSRF 規約 — `start.ts` の参照先確認のため）, `spec/platform/index.md`, `spec/testcases/storage/deleteFilesByOwner.md`, `spec/adr/052-adapter-inventory-granularity.md`, `spec/adr/053-account-deletion-rollback-completion.md`, `spec/adr/054-provider-account-uniqueness-owner.md`, `spec/adr/055-session-expiry-derivation.md`, `spec/adr/056-performance-budget-placement.md`, `spec/adr/index.md`
- スキップ: `.thread/14/{plan,adr,research,research-2,steps,testing}.md` — 判定基準として `plan.md` / `adr.md` は読んだが、レビュー対象の成果物としてはドメイン契約の記述ではない（6 件）
- スキップ: `CLAUDE.md`, `README.md`, `docs/backend_implementation_example.md`, `docs/frontend_implementation_example.md` — 開発者向けドキュメントで、ドメイン・ポート契約を定義しない（4 件）
- スキップ: `spec/adr/057-manual-test-followthrough.md` — マニュアルテスト運用の判断でドメイン契約に触れない
- スキップ: `spec/inventory/frontend.md` — 画面台帳（PAGE 行）で観点外
- スキップ: `spec/manual-tests/account.md`, `spec/pages/index.md`, `spec/scenario/account.md` — 画面・手順書・シナリオ層で、ポート契約を規定しない（3 件）
- スキップ: `spec/testcases/identity/{checkHandleAvailability,completeOAuthCallback,getProfile,requestPasswordReset,signUpWithPassword,startOAuthFlow}.md` — テストケース定義（テスト観点のレビュー範囲）。ただし `completeOAuthSignIn.md` の 1 行は B-001 の根拠として参照した（6 件）

確認 31 件 ＋ スキップ 21 件 = 52 件（変更ファイル一覧と 1 対 1）。
