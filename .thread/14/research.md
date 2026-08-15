# 調査結果 — Issue #14

対象 HEAD: `55a5bb9`（PR #17 / Issue #2 マージ済み）。すべての判定は実ファイルを読んで裏を取った。

## あるべきアーキテクチャ（spec/ と CLAUDE.md から読み取ったもの）

### spec/ の構造と各ファイルの責務

| ディレクトリ | 責務 | 記述様式 |
| --- | --- | --- |
| `spec/index.md` | 設計インデックス。「`spec/` は現在有効な要件と設計の正典。進捗・レビュー記録・日付つき改訂履歴・廃止済みの判断は置かない」 | リンク集 |
| `spec/scenario/{category}.md` | 利用者視点のシナリオ（AC-01…）。基本フロー番号つき ＋ 異常系・エッジケース箇条書き | 見出し ＋ 番号リスト |
| `spec/pages/index.md` | 画面（P-01…）とレイアウト（L-01…）。**目的 / 機能 / 状態** の 3 節が定型。状態は「A / B / C」の直和を 1 行で書く | 見出し ＋ 箇条書き ＋ `**状態**:` 行 |
| `spec/domains/{domain}.md` | 値オブジェクト・エンティティ・**振る舞い表**（`メソッド / 引数 / 戻り値 / 処理`）・**不変条件**（箇条書き）・ポート定義（TS interface コードブロック ＋ 直後の説明段落 ＋ `**エラーケース**:` 行）・ドメインイベント表・エラーコード union | 表 ＋ コードブロック |
| `spec/domains/index.md` | 横断の型と規約、`ScopeKey` と永続化境界、横断ポート、**継続要求**表 | 同上 |
| `spec/usecases/{domain}.md` | 入出力 DTO 表・処理フロー（番号）・**エラーケース表**（`条件 / 結果`） | 表 |
| `spec/presentation/index.md` | 転送境界。Cookie 属性表・CSRF 規約表・セキュリティヘッダー表・エラー→ステータス表 | 表 |
| `spec/testcases/{domain}/{usecase}.md` | `前提条件 / 操作 / 期待結果 / 実装ステータス` の 4 列表（4 列目は全行が空）。行が TC-{domain}-{n} に対応 | 表 |
| `spec/inventory/{domain,adapter,usecase,frontend,test}.md` | **`spec/` からの生成物**。`| ID | 要素 | 定義場所 | 実装されるべき振る舞いの要点 |` の 4 列。ヘッダーに「生成元」と「最終同期」日付を持つ。**1 行 = 1 要素**（ポートなら 1 メソッド、TC なら 1 ケース） | 表 |
| `spec/adr/{NNN}-{slug}.md` | 現在有効な非自明の設計判断。`ステータス / コンテキスト / 前提 / 決定 / 検討した代替案 / 影響` の 6 節。`spec/adr/index.md` に一覧と前提依存マップ | 見出し |
| `spec/manual-tests/{category}.md` | 手順表（`# / 操作 / 期待結果`） | 表 |

### 本 Issue を統べる ADR

`spec/adr/046-port-contract-divergence.md` が乖離の扱いを定めている。

- 一律に「JSDoc に寄せる」でも「実装に寄せる」でもなく、**その振る舞いの正本がどこにあるか**で倒す向きを決める
- 正本が実装側なら契約から約束を落とす、正本が設計側なら契約を必須として書き直す
- 「乖離は『見つけたら倒す』対象になり、**記録して先送りする選択肢を残さない**」

→ progress.md が「後続スライスで確定（記録のみ）」としていた項目（SYNC-13 / 14 / 15）は、Issue #2 で実装と適合スイートが確定したため、本 Issue で**決着させる**のが ADR-046 に沿う。

`spec/adr/026-port-contract-and-conformance.md` は「契約の正本はポート定義、検証は共有適合スイート」と定め、`spec/testcases/ports/` を新設しない判断を含む（`.thread/1/adr.md` ADR-003 由来）。

### 実装側の現況（CLAUDE.md の記述が古い箇所の裏取り）

- `apps/web/app/` のサーバーエントリは `server.node.ts` **1 本のみ**
- `apps/web/app/worker/` は `node/runner.ts` のみ
- `packages/core/src/application/di/` は `containerStore.ts` / `env.ts` / `memoryRuntime.ts` / `serverNode.ts` / `types.ts`
- `apps/web/scripts/` は `listen.node.ts` **1 本のみ**（`migrate.*.ts` は存在しない）
- `docs/` は `backend_implementation_example.md` / `frontend_implementation_example.md` / `runtime_node.md` / `test.md`
- `infra/` ディレクトリは**存在しない**。`pnpm-workspace.yaml` の packages は `apps/*` と `packages/*` のみ
- `apps/web/app/components/todo/` / `routes/todo/` は**存在しない**
- `packages/core/src/adapters/` は `memory/` `node/` `oauth/` `conformance/`（D1 / Drizzle / libSQL / Turso は 1 行も無い）
- `packages/core/src/domain/` は `common` `conversion` `identity` `job` `note` `storage` `usage` `workspace`
- UoW は二面（`GlobalUnitOfWorkProvider.run(fn)` / `ScopeUnitOfWorkProvider.run(scope, fn)`、ADR-023）
- root scripts は `dev/build/start`（＋ `:node`）/ `lint*` / `format*` / `typecheck` / `test*`。`:cf` `:aws` `:gcp` は存在しない

---

## 乖離項目の台帳

`.thread/1/progress.md` の「spec-sync 対象の集約」（L58〜L81）の 24 行に SYNC-01〜24 を採番した。SYNC-25 / 26 は調査および計画レビュー R1 で見つかった同種の乖離、SYNC-27 はスコープ外として記録するもの。

**Issue #2（PR #17）由来の spec-sync 候補は本台帳の対象外**。ユーザー判断で本 Issue のスコープに含めることになったが、台帳は `research-2.md` に 201 番台で別途採番する（本ファイルの SYNC-* と衝突させない）。Issue #14 のコメントは 38 件と書いているが、ID 単位でほどいた実数は **44 件**（`research-2.md` の集計）。

判定の凡例: **残** = まだ乖離あり（本 Issue で直す） / **済** = 既に解消済み（何もしない） / **外** = スコープ外（別 Issue）

### SYNC-01 — AC-01 異常系の「確認メール再送」 【残】

- spec: `spec/scenario/account.md:24`「確認前に再度サインアップを試みた場合は、確認メールを再送する」
- 同ファイル `:22` は既登録メールについて「『このアドレスは既に登録済みです』という案内メールを送る」と書いており、**同一分岐に 2 つの結末が書かれている**（spec 内部の自己矛盾）
- 実装: `packages/core/src/application/identity/signUpWithPassword.ts:118-121` で `identityUniqueDirectory.resolve("email", …)` がヒットすれば `existingAccountResponse()`（`:40-64`）へ直行。`template.kind: "existingAccountNotice"` を送るだけで `emailVerification` の再送は行わない。未確認（pending）でも email 予約は commit 後に activate されるためヒットする
- テスト: `__tests__/signUpWithPassword.test.ts:160-181`（TC-identity-255）が `["emailVerification", "existingAccountNotice"]` を固定
- 反映先: `spec/scenario/account.md:24` の 1 行のみ。`spec/usecases/identity.md:60` / `spec/testcases/identity/signUpWithPassword.md:13` / `spec/inventory/test.md:394` は既に整合済み（変更不要）

### SYNC-02 — メール確認の着地状態（2 状態の追加） 【残】

- spec の現記述
  - `spec/scenario/account.md:16`（AC-01 #5）「リンクを開くと、…**サインイン状態で**ノート一覧に着地する」— 同一ブラウザー条件なし
  - `spec/scenario/account.md:36`（AC-02 #2）同上。AC-02 異常系（`:40-44`）に該当状態なし
  - `spec/pages/index.md:176`（P-03）`**状態**: 処理中 / 成功（アプリへ遷移）/ 期限切れ（再送）/ 使用済み（サインインへ）/ 無効` — **5 状態**
- 実装が返す状態の直和は **7 つ**（`apps/web/app/components/auth/VerifyEmailPanel/index.tsx:31-38`）:
  `processing` / `succeeded` / `verifiedSignInRequired`（`:140-148`）/ `alreadyVerified` / `expired` / `invalid` / `failed`（`:176-188`、`kind === "system" || "unknown"` で再試行ボタン）
- セッション発行の束縛は `VerifyEmailPanel/action.ts:34-44`（`shouldIssueVerificationSession(readPendingVerificationUserId(), view)`）
- 根拠 ADR: `spec/adr/029-verification-session-binding.md:22`（決定 4）と `:48-49`（縮退の受容）— **ADR が正、下流 spec が未追随**
- 反映先: `spec/scenario/account.md:16` `:36` ＋ AC-02 異常系、`spec/pages/index.md:176`、`spec/inventory/frontend.md:17`（PAGE-p03-001）`:18`（PAGE-p03-002）
- `spec/manual-tests/account.md` TC-02 は同一ブラウザーでの手順なので現状のまま正しい（変更不要）。ただし**新規に足す 2 つの異常系には対応手順が無い**ため、別ブラウザーでの確認を TC-42 として追加し、一時障害は「対象外」として理由を残す（計画レビュー R1 arch:P-006 / adr.md ADR-010、ステップ 18）

### SYNC-03 — `IdentityErrorCode` の記載漏れ 【残・差は拡大】

- spec: `spec/domains/identity.md:519-525` は 11 コード
- 実装: `packages/core/src/domain/identity/errorCode.ts:6-22` は 14 コード。超過は `IdentityLimitExceeded`（`:19`）/ `InvalidAvatarUrl`（`:12`）/ `AccountDeletionRetryLimitExceeded`（`:20-21`）。ファイル冒頭 `:1-5` に「spec の記載漏れとして扱った」旨のコメント
- spec 内の他箇所は既に使用済み: `spec/domains/identity.md:267`、`spec/usecases/identity.md:264,275,302,477`（限度超過）、`:663,706`（retry limit）、`spec/database/index.md:222`
- `InvalidAvatarUrl` は #2 由来（`updateProfile` の同一オリジン URL 制約、ADR-051）、`AccountDeletionRetryLimitExceeded` も #2 由来 → **SYNC-03 として直すのは `IdentityLimitExceeded` のみ**。他 2 件も**本 Issue のスコープ内**（Issue #2 由来。台帳は `research-2.md` の **SYNC-244**）だが、同じ 1 つの union を 2 ステップが触ると競合するため**ステップ 2 でまとめて足す**（plan.md のスコープ節 / AC-32）
- 反映先: `spec/domains/identity.md:519-525`、波及候補 `spec/inventory/domain.md:65`（DOM-identity-019）

### SYNC-04 — `projectionRevision` / `routeVersion` の引数 【残】

- spec: `spec/domains/note.md:181`（`createFromUpload`）`:182`（`createBlank`）に `projectionRevision` なし、`:189`（`moveTo`）に `routeVersion` なし
- 実装: `packages/core/src/domain/note/note.ts:164-174`（`projectionRevision: number` = `:173`）、`:208-215`（`:214`）、`:390-395`（`moveTo(note, owner, routeVersion, now)`）。呼び出し側 `application/note/createBlankNote.ts:71-79` が UoW 内で採番して渡す
- 根拠 ADR: `spec/adr/027-projection-revision-numbering.md:13`（決定）と `:34`（「ドメインのメソッド表に spec には現れない引数が 2 か所増える」と乖離を自認）
- 反映先: `spec/domains/note.md:181,182,189` の 3 セル

### SYNC-05 — 降格 2 メソッドの非公開ガード 【残】

- spec: `spec/domains/note.md:184`（`markConversionFailed`）`:185`（`markAwaitingIntegration`）にエラー記載なし。不変条件 `:170-176` は公開側からの一方向のみ
- 実装: `note.ts:96-103` の `ensurePrivate` が `visibility.status !== "private"` で `BusinessRuleError(CannotPublishEmptyNote, "A shared note cannot drop back to a non-ready body")`。`:305`（`markConversionFailed`）と `:323`（`markAwaitingIntegration`）の冒頭で呼ぶ
- テスト: `domain/note/__tests__/note.test.ts:455-471`「both refuse to demote the body of a shared note」
- エラーコードは新設せず `CannotPublishEmptyNote` を再利用（同一不変条件の両方向のため）
- 反映先: `spec/domains/note.md:184,185` ＋ 不変条件節（`:172` を双方向に書き直す）

### SYNC-06 — `reconstruct` が ready 本文の必須列欠落を拒否する 【残】

- spec: `spec/domains/note.md` に `reconstruct` / `RehydrationError` の語が **1 件も存在しない**
- 実装: `note.ts:722-744` の `reconstructContent` が `ready` で `html` / `text` / `excerpt` のいずれか欠落なら `throw invalid("ready note requires html, text, and excerpt")` → `:658-663` で `RehydrationError` に包む。`:723-725` のコメントが「`""` で埋めると次の OCC 保存で穴を本文として永続化する」と理由を記録。`headings` は `?? []` を許す
- テスト: `note.test.ts:602-647`（空文字は許容 / 3 列とも欠落を拒否 / headings 欠落は `[]`）
- 反映先: `spec/domains/note.md` の不変条件節に 1 項目追加

### SYNC-07 — ポート契約 2 件（fan-out の列挙 state / `listByOwner` の順序） 【残】

- `NoteRouteFanOutReader`
  - spec: `spec/domains/note.md:625-629`（interface）と `:659`（説明段落）に**列挙 state への言及なし**。`:655` は `NoteRouteStore.resolve` 側の記述
  - 実装契約: `packages/core/src/application/ports/noteRouteFanOutReader.ts:18-28`「Enumerates every route whose creation has committed — `active`, `moving` and `purging` — and skips only `reserved`」「deliberately wider than `NoteRouteStore.resolve`」「`tombstone` rows are unspecified」
  - memory: `adapters/memory/repositories/noteRouteFanOutReader.ts:42` が `row.state !== "reserved"` のみ
  - 適合: `adapters/conformance/noteRouteFanOutReader.ts:98`「ADP-note-046/047: enumerates committed routes (active / moving / purging) and skips reservations」、`:143-147`
- `NoteRepository.listByOwner`
  - spec: `spec/domains/note.md:406-420` に順序記述なし（`:483` の `updatedAt DESC, noteId` は `PublicNoteQueryService.searchPublic` の話で別物）
  - 実装契約: `domain/note/ports/noteRepository.ts:28-33`「Ordered `updatedAt DESC, id DESC`. The `id` tiebreak is what makes the order total…」
  - memory: `adapters/memory/repositories/noteRepository.ts:79-83`
  - 適合: `adapters/conformance/noteRepository.ts:127`「ADP-note-015: listByOwner pages a total updatedAt DESC, id DESC order」
- 反映先: `spec/domains/note.md` のポート説明段落 2 か所。波及 `spec/inventory/domain.md:265`（DOM-note-031）`:296,297`（DOM-note-062/063）、`spec/inventory/adapter.md:192`（ADP-note-015）`:223,224`（ADP-note-046/047）

### SYNC-08 — `reconstruct` の visibility × content 交差検査 【外】

- 実装: `note.ts:771-804` の `reconstructVisibility` は `contentStatus` を参照せず、`reconstructContent` も visibility を見ない。`{ visibilityStatus: "public", contentStatus: "failed" }` の行はそのまま復元される（`:792-794` の検査は「public + dormant のパスワード保持」のみ）
- 書き込み経路は `ensureReady`（`:78-88`）/ `ensurePrivate`（`:96-103`）が両方向を守るため、正常経路では作れない状態
- **spec に「拒否する」と書くなら実装変更が必要** → ドキュメント同期ではない。本 Issue はスコープ外とし、実装 Issue へ切り出す（adr.md ADR-006）

### SYNC-09 — ラウンド4で追加した適合ケースの ADP ID 採番 【残・判断が必要】

- `spec/inventory/adapter.md` の最終同期は **2026-08-09**、R4（`faab0f2`）は **2026-08-10** → 未反映
- フォーマット: `| ID | 要素 | 定義場所 | 実装されるべき振る舞いの要点 |`。**1 行 = 1 ポートメソッド**、`ADP-{domain}-{3桁}` をポート定義の出現順で採番。ケース単位の行は 1 つも存在しない
- 現在の最大採番: `ADP-common-039` / `ADP-note-054`（次は 040 / 055）
- `spec/testcases/ports/` は**存在しない**。`spec/adr/026`（`.thread/1/adr.md` ADR-003 由来）が「新規ドキュメントを作らず、コードの共有スイート自体を契約の実行形とする」「ADP 行との対応は describe 名に ADP ID を含める命名規約で追う」と既に棄却済み
- 相乗りしているケースの実体
  | ケース | 場所 | 対応 ADP 行の現記述 |
  | --- | --- | --- |
  | `ADP-note-015: listByOwner pages a total updatedAt DESC, id DESC order` | `conformance/noteRepository.ts:127` | `adapter.md:192`「owner と lifecycle で Note をページングする」（順序なし） |
  | `ADP-note-021: highlightedExcerpt escapes the projection's markup` | `conformance/localNoteQueryService.ts:114` | `adapter.md:198`（エスケープ契約なし） |
  | `ADP-note-046/047: enumerates committed routes … skips reservations` | `conformance/noteRouteFanOutReader.ts:98` | `adapter.md:223,224`（state 集合なし） |
  | `ADP-common-012: a replayed begin preserves everything already recorded` | `conformance/accountDeletionManifestStore.ts:73` | `adapter.md:18`「冪等に開始する」（概ね充足） |
  | `ADP-common-017/019/021: the cleanup lane is what finalizes membership items` | 同 `:509-571` | `adapter.md:23,25,27`。**3 行のどれにも書けない横断的な振る舞い** |
- 判断: 新規 ADP ID は採番せず、契約本文（`spec/domains/index.md`）に書いて inventory の要点欄を追随させる（理由は adr.md ADR-002）

### SYNC-10 — CSRF 規律の無条件化 【残】

- spec: `spec/presentation/index.md:124`（`## CSRF` → `### 規約` 表の 2 行目）が「**`FormData` を受けるサーバー関数を作る場合は `Origin` ヘッダーの検証を必須とする**」と条件付き。`createCsrfMiddleware` への言及ゼロ
- 実装: `apps/web/app/start.ts:15-19` が `createCsrfMiddleware({ filter: (ctx) => ctx.handlerType === "serverFn" })` を `requestMiddleware` に登録し、**全 server function** に無条件で適用。`:5-11` のコメントが「Without it every server function accepts `multipart/form-data` / `application/x-www-form-urlencoded`（both CORS safelisted）」と、条件が常に成立することを明記
- `spec/adr/029-verification-session-binding.md:13-15`（前提）は既に無条件版で書かれている → **ADR が正、presentation/index.md が未追随**
- **AC-15 は spec に存在しない**。`spec/scenario/account.md` の AC は AC-01〜AC-10 のみで、`grep -rn "AC-1[1-9]" spec/` は 0 件。AC-15 は `.thread/1/plan.md:32` の受け入れ基準 ID で、`apps/web/app/start.ts:10` のコメントがそれを参照している（計画凍結時に `.thread/1/` が消えると宙に浮く dangling 参照）→ コメントを `spec/presentation/index.md` の CSRF 規約への参照へ差し替える

### SYNC-11 — ShareTokenProtector の失敗エラー 【残】

- ポート JSDoc: `packages/core/src/application/ports/shareTokenProtector.ts:11-12`「Error contract: `SystemError(ExternalServiceError)`（unknown key version, corrupt ciphertext）」
- 実 enum: `packages/core/src/application/errors.ts:180-185` は `DatabaseError` / `DataIntegrityError` / `NetworkError` / `ExternalApiError` の 4 つ。**`ExternalServiceError` は存在しない**
- 実装: `adapters/memory/shareTokenProtector.ts:32-36`（未知 keyVersion）と `:68-72,79-84`（ciphertext 破損）はいずれも `DataIntegrityError`
- spec 側: `spec/domains/note.md:663` の `ShareTokenProtector` 節に**エラーケース行が無い**。唯一この port に触れる `spec/presentation/index.md:90` は既に `SystemError(DataIntegrityError)` と書いており実装と一致
- 反映: JSDoc を `DataIntegrityError` へ是正 ＋ `spec/domains/note.md:663` の段落に `**エラーケース**:` 行を追加

### SYNC-12 — `VerifyEmailView.sessionToken` の型 【残】

- spec: `spec/usecases/identity.md:101` の出力 DTO 表が `| sessionToken | string |`。ただし同ファイル `:108`（手順 3）と `:121`（エラーケース表）は「`alreadyVerified: true` で返す（**セッションは発行しない**）」— **spec 内部で矛盾**
- 実装: `packages/core/src/application/identity/view.ts:16-27` が `sessionToken: string | null`（JSDoc に「spec の出力表は non-null だがその経路を表現できない」）。`verifyEmail.ts:117`（正常系）/ `:123`（`alreadyVerified` = `null`）
- 反映先: `spec/usecases/identity.md:101` を `string | null` に。`spec/inventory/usecase.md:12`（UC-identity-002）は既に整合

### SYNC-13 — `SignInView` / `VerifyEmailView` への `expiresAt` 追加検討 【乖離なし・記録のみで決着】

- spec も実装も `expiresAt` を持たない（`spec/usecases/identity.md:96-102,168-173,246-251` ／ `application/identity/view.ts:16-27,36-39,72-77`）→ **乖離は無い**
- presentation は `apps/web/app/presentation/session.ts:94-101` の `sessionCookieExpiry(now)` が `Session.ttlMs` から再導出。呼び出し元は `SignInForm/action.ts:35` / `VerifyEmailPanel/action.ts:39` / `routes/auth/-action.tsx:108`
- 「View に載せず ttl 定数から再導出する」判断が実装コメントにしか無い → 決着として `spec/usecases/identity.md` の手順文に 1 行残す（adr.md ADR-007）

### SYNC-14 — `allRollbackReleased` と `personalAbort` receipt の関係 【残・決着可能】

- spec: `spec/domains/index.md:124`「全 prepare/release/cleanup/redaction item ack と personal/global receipt 集合が finalize/**rollback** の正本」、`spec/usecases/identity.md:669`「`allRollbackReleased` が全 workspace release ack と**personal abort ack を確認した後だけ**」→ rollback の正本に receipt を含める
- **ポート契約 JSDoc も spec と同じ側**（計画レビュー R1 arch:P-001 で追加）: `packages/core/src/application/ports/accountDeletionManifestStore.ts:95-98`「the full set of item acks plus the personal/global receipt set is the source of truth for finalize / rollback (`allRequiredAcknowledged` / `allRollbackReleased`)」。したがって本項目は「実装 ＋ 契約 JSDoc ＋ 適合スイート」ではなく「**実装 ＋ 適合スイート**（JSDoc は要是正）」が正本。`spec/adr/046` の分類でいえば「JSDoc が実装より強い」ケース
- 実装: `adapters/memory/repositories/accountDeletionManifestStore.ts:121-122`
  ```ts
  const allRollbackReleased = (operationId: string): boolean =>
    membershipItems(operationId).every(membershipReleased);
  ```
  **release ack のみ。receipt を見ない。** 対して `:124-131` の `allRequiredAcknowledged` は `requiredReceipts.every(...)` を含む。`compactItems` のゲート `:392-397` も同様
- 適合スイート: `adapters/conformance/accountDeletionManifestStore.ts:495-506` が「beginRollback → release ack 2 件 → `allRollbackReleased === true`」を期待値として固定
- `personalAbort` は `application/cleanup/participants.ts:68` で `Exclude<AccountDeletionReceipt, "personalAbort">` として除外されているが、**これは `globalCleanupParticipants`（= `allRequiredAcknowledged` が使う finalize の必須 receipt 集合）の型注釈**であり、「rollback と無関係」の根拠にはならない。`.thread/2/progress.md:263` 自身が「`personalAbort` は **rollback 側の receipt** なので必須集合の対象外」と書いている（計画レビュー R1 arch:P-003 で訂正）
- **rollback / prepare 経路そのものは application 層に未配線**。`workers/subscribers.ts:75-133` は `cleanup` / `redaction` / `finalize` の 3 phase のみで、`beginRollback` / `allRollbackReleased` / `abortPersonalAccountDeletion` を呼ぶ application コードは**リポジトリ内に 1 つも存在しない**（参照はポート定義・memory 実装・適合スイートに閉じている）
- 決着方向: **2 層に分ける**（adr.md ADR-004、計画レビュー R1 で決定を差し替え）。ポート述語 `allRollbackReleased` の判定対象は release ack のみ（実装 ＋ 適合スイートが正本 → `spec/domains/index.md` と JSDoc を追随させる）。ユースケースの復帰ゲート（User を `active` へ戻す前に personal barrier の abort ack を確認する）は実装が存在しないため spec が正本のまま残す（`spec/usecases/identity.md` から落とさない）

### SYNC-15 — `PROVIDER_ACCOUNT_ALREADY_LINKED` の担保箇所 【残・決着可能】

- spec: `spec/domains/identity.md:379`（`IdentityRepository` のエラーケース）が `ConflictError("PROVIDER_ACCOUNT_ALREADY_LINKED")` を挙げる一方、`:369`（`IdentityUniqueDirectory` を含む群）は `EMAIL_ALREADY_USED` / `HANDLE_ALREADY_USED` のみ — **担保の所在が spec 上で逆転**
- 実装（#2 で OAuth 実装後も変わらず）:
  - `adapters/memory/repositories/identityRepository.ts` は `createOccRepository` + `listByUserId` のみで**一意性検査を一切持たない**
  - `adapters/memory/repositories/identityUniqueDirectory.ts:9-13,22-28` の `CONFLICT_CODES.providerAccount` が唯一の担保
  - application の事前検査: `application/identity/linkOAuthIdentity.ts:96-105`
  - JSDoc も 2 系統: `domain/identity/ports/identityRepository.ts:6-8`（実態と不一致）/ `identityUniqueDirectory.ts:22-25`（一致）
- ADR 整合: `spec/adr/038` の claim = 索引という立場、`spec/adr/048:23` の予約 ID の扱いはいずれも directory 前提 → **ADR は実装側を支持**
- 反映: `spec/domains/identity.md:379` から当該コードを外し `:369` 側へ移す ＋ `identityRepository.ts:6-8` の JSDoc 是正

### SYNC-16 — `resolveMany` の上限超過時挙動 【残】

- note 側: `spec/domains/note.md:657` は「最大 500 NoteId」を書くが超過時の挙動が無い。**`:609` 以降のポート節には `**エラーケース**:` 行そのものが存在しない**（note.md のエラーケース行は `:371,385,404,420,434,531,607` の 7 か所）
  - 実装契約: `application/ports/noteRouteStore.ts:34-39`「`SystemError(DatabaseError)` — the latter also covers a `resolveMany` batch over the 500-id cap, which is a caller programming error rather than a concurrent-state conflict」
  - memory `:15,85-94`、適合 `conformance/noteRouteStore.ts:280-294`（500 成功 / 501 reject）
- identity 側: `spec/domains/identity.md:365` は「入力最大 100 UserId」だけ。`:369` のエラーケース行は `UserRepository` / `UserBatchReader` / `IdentityUniqueDirectory` の**3 ポート共用**で `SystemError(DatabaseError)` を含むため明示的な矛盾はないが、非自明な判断が読み取れない
  - 実装契約: `domain/identity/ports/userBatchReader.ts:11-15`、memory `:13,21-26`
- 造語コード `NOTE_ROUTE_BATCH_TOO_LARGE`: `packages/` にも `spec/` にも**残っていない**（ヒットは `.thread/1/` の作業メモ 3 件のみ）→ 廃止は完了済み
- 反映先: `spec/domains/note.md:657` 付近と `spec/domains/identity.md:365` 付近。波及 `spec/inventory/domain.md:286`（DOM-note-052）`:72`（DOM-identity-026）、`spec/inventory/adapter.md:213`（ADP-note-036）

### SYNC-17 — `Cache-Control: private, no-store` 【残】

- spec: `spec/presentation/index.md:175-181`（「その他のヘッダー」表）は `X-Content-Type-Options` と `Referrer-Policy` の 2 行のみ。`grep -rn "Cache-Control\|no-store" spec/` は **0 件**
- 実装: `apps/web/app/server.node.ts:69-78` の `SECURITY_HEADERS` に `["Cache-Control", "private, no-store"]`（`:72`）。`:80-84` の `withSecurityHeaders` は既存値を上書きしない。理由は `:63-68` のコメント（Cookie 認証で利用者固有の応答を前段キャッシュに配らせない）
- 「対象」節 `:137,139` の書きぶり（公開レイアウト配下 vs サービス全体の既定）も語尾の整合確認が要る
- 反映先: `spec/presentation/index.md:177-181` ＋ `spec/inventory/frontend.md:168`（PAGE-p47-001）

### SYNC-18 — `CLAUDE.md` の全面改訂 【残】

乖離の全量（agent 検証済み）:

| 節 | 乖離 |
| --- | --- |
| Workspace layout L19-22 | `infra/aws` `infra/cloudflare/pulumi` `infra/gcp` は存在しない。`pnpm-workspace.yaml` にも元から無い。`apps/web` の wrangler / drizzle / Dockerfile も存在しない（vite.config.node.ts のみ） |
| Development Commands L27-37 | 概ね一致。`dev:node` / `build:node` / `start:node` が未記載 |
| Layers L45-52 | `packages/core/src/` の実構成（domain の 8 ドメイン、application の `cleanup/` `workers/` `execution/` `scope.ts`、adapters の `conformance/`、層外の `config.ts`）が未反映 |
| Frontend L56-62 | `components/todo/` `routes/todo/` `TodoBoard` は存在しない。現行の同型実装は `routes/notes/index.tsx` と `components/settings/IdentityList/board.tsx`。`ui/Skeleton` と `router.tsx` の pending 設定は一致 |
| Key concepts L68-71 | UoW は二面（`GlobalUnitOfWorkProvider` / `ScopeUnitOfWorkProvider`、ADR-023）。outbox は継続要求も運ぶ（ADR-040/041）＋ `maxAttempts` 超過の quarantine。retry は「ユースケース個別のリトライは可」（`createBlankNote.ts:103-105`、`spec/usecases/usage.md:120`）。`serverAction` という関数は存在せず（export は `loadServerDeps` / `serverData`）、`inputValidator` は `.validator()` へ改名済み |
| Reference runtimes L86-99 | Cloudflare / AWS / GCP のエントリ・worker・DI・`docs/runtime_*.md`・`migrate.*.ts`・`:cf`/`:aws`/`:gcp` スクリプトが**すべて存在しない**。「Node.js + libSQL」も誤り（Node + in-memory） |
| 全体 | `spec/` への言及がゼロ（`grep "spec/" CLAUDE.md` → 0 件）。`spec/adr/` **46 本**（`index.md` を除く実測。最大採番は 051 で、廃止した 015 / 016 / 018 / 019 / 020 は欠番のまま）、`docs/test.md` も未参照。`apps/web/app/presentation/` の実ファイルは 21 本で、記述の 4 種では足りない（`serverFragment.tsx` / `session.ts` / `start.ts` など） |
| `README.md` | `CLAUDE.md` と**同根の陳腐化**（`infra/`、「four reference runtime wirings」「Node.js + libSQL」、`:cf` / `:aws` / `:gcp` suffix、`/todo` ルート、Drizzle ORM、two-tier vitest）。差分は 10 行程度。ユーザー判断で本 Issue のスコープに含める（ステップ 19 / AC-25） |

`AGENTS.md` は `CLAUDE.md` へのシンボリックリンクなので 1 ファイル改訂で両方に効く。

### SYNC-19 — `docs/{backend,frontend}_implementation_example.md` 【残】

参照元（CLAUDE.md 以外）: `README.md:47`、`spec/usecases/usage.md:120`（規範として引用）、`apps/web/app/presentation/pagination.ts:5`。

- backend（457 行 / Todo 言及 5 箇所）: Todo より**ランタイム前提の陳腐化が深刻**。File Layout（L7-64）が `di/serverCloudflare.ts` / `packages/core/src/presentation/` / `adapters/d1/*` を並べる。`## Adapter Layer`（L351-394）が D1 + Drizzle + PendingBatch + `_occ_guard` 前提で現行に対応物が無い。`IdempotencyStore` 説明（L410）も `processed_events` テーブル前提。UoW 節は単一 UoW 前提。domain 層の書き方（brand VO / `create` ファクトリ / `EventDraft` 収集）は現行と同型で生きている
- frontend（880 行 / Todo 言及 67 箇所）: 参照パスは 1 つも実在しない。**しかしパターンは全て現行と同型**で読み替え可能 — loader ＋ `renderServerComponent` ＋ `Suspense` ＋ `Deferred` → `routes/notes/index.tsx`、`cache(serverData(...))` → `components/note/NoteList/action.ts`、server function のインライン宣言 → 14 箇所で現行そのまま、リスト所有権のクライアント島 → `components/settings/IdentityList/board.tsx`。`serverData` / `loadServerDeps` の表（L266-272）は実 export と完全一致。`.validator` への追随は済み
- 現行にあって未記載: `renderServerFragment`（`presentation/serverFragment.tsx`、ADR-031）、`start.ts` の CSRF ミドルウェア、`formStyles.ts` / `panelStyles.ts`

### SYNC-20 — TC-identity-261 の改訂 【残】

- spec: `spec/testcases/identity/signUpWithPassword.md:19`「片方は成功、もう片方は `ConflictError("EMAIL_ALREADY_USED")` になる」、`spec/usecases/identity.md:80`「email reservation の競合 → `ConflictError("EMAIL_ALREADY_USED")`」、`spec/inventory/test.md:400`
- 実装テスト: `application/identity/__tests__/signUpWithPassword.test.ts:207-242` — 2 本同時実行で**両方が同一応答**（`emailVerificationRequired: true` / `sessionToken: null`）、`first.userId !== second.userId`（decoy）、`users.size === 1`、メールは `["emailVerification", "existingAccountNotice"]`。同テスト `:231-241` が `identityUniqueDirectory.reserve` を直接叩き**ポート層では今も `ConflictError("EMAIL_ALREADY_USED")` が上がる**ことを別途アサート
- 畳み込み地点: `signUpWithPassword.ts:147`
- 根拠 ADR: `spec/adr/028-account-enumeration-resistance.md:20`「一意性 directory は衝突で `ConflictError` を投げ続ける。これはポート契約として保持し、適合スイートで検証する…列挙耐性はユースケース層の責務とする」→ **ADR が正、3 か所が未追随**
- `spec/inventory/adapter.md` の identity 行（ADP-identity-007 相当）は**変更不要**

### SYNC-21 — TC-identity-174 の期待挙動 【既に解消済み】

- spec: `spec/testcases/identity/pruneExpiredAuthState.md:29` の操作欄は既に「**次 Cron で回復する**」。continuation 前提の行は `:24,25`（TC-identity-169/170）として正しく分離済み
- 実装テスト: `application/identity/__tests__/pruneExpiredAuthState.test.ts:709-764` — lease 失効後に `cron(h)` を実行して run 1 本のまま完走することを検証（continuation の実行はセットアップ）
- `spec/inventory/test.md:313` / `spec/inventory/adapter.md:36`（ADP-common-030）も現状で正しい
- → **何もしない**。plan.md の受け入れ基準から外す

### SYNC-22 — 文字数が UTF-16 コード単位であること 【残】

- spec: `spec/domains/note.md:27`（NoteTitle 200）`:49`（Excerpt 200）`:54`（NoteHeading 100）に単位の明記なし。「UTF-16」「コード単位」「サロゲート」は note.md に 0 件（リポジトリ全体でも `spec/adr/033` と `spec/adr/index.md:38` のみ）
- 実装: `domain/note/valueObject.ts:59,156`（`.length` 検査）、`:99-112` の `truncateWithoutSplittingPair`（末尾が上位サロゲートなら `limit - 1`）、`:164-170`（`Excerpt.fromText`）、`:205`（`NoteHeading`）
- 根拠 ADR: `spec/adr/033-character-count-unit.md:11,13`。`:28` は「絵文字が多いテキストでは『200 文字』が見かけ上 100 字程度になる」という**利用者可視の帰結**まで述べており、値オブジェクトの制約を読む人が知る必要がある
- 反映先: `spec/domains/note.md:27,49,54`。波及 `spec/inventory/domain.md:237,241,242`

### SYNC-23 — `spec/design/tokens.md §10` のフォーカスリング改訂 【外】

- トークン実値: `spec/design/tokens.md:255,520` と `apps/web/app/styles/tokens.css:129` がいずれも `--shadow-focus: 0 0 0 2px var(--color-accent)`。accent は `oklch(37.1% 0 0)`
- 問題は実在する: accent 塗りのボタンが焦点を得ると、リングがボタン塗りと**完全に同色・オフセット無し**で描かれ、ボタンが 2px 太くなっただけに見える。WCAG 2.2 focus appearance の内側隣接色コントラストが 1:1
- accent 塗りの focusable は実装 11 ファイル 12 箇所、モックは 29 ページ。オフセット/二重リングの回避策はリポジトリ内に 0 件
- `apps/web/app/components/auth/formStyles.ts:4` の `focus:outline-none` は `apps/web/app/styles/index.css` の forced-colors 対策（透明 outline）を input でだけ打ち消す。`outline-none` は app 全体でこの 1 箇所のみ。加えて `focus:`（`focus-visible:` ではない）で出しており tokens.md §10 の「`:focus-visible` のみ」とも乖離（ただしモック 35 ページはすべて `.input:focus` なので、どちらを正とするかの判断が要る）
- 影響ファイル: モック HTML 43（`spec/design/pages/*.html` 35 ＋ `spec/design/drafts/*.html` 8。各自トークンをインライン複製）、設計ドキュメント 2（`tokens.md` 3 箇所 / `design/index.md` 2 箇所）、実装 CSS 3、実装 TS 1 → 最小でも 47 ファイル
- **ドキュメント同期ではなくデザイントークンの再設計 ＋ 実装変更** → スコープ外（adr.md ADR-006）

### SYNC-24 — `spec/pages/` の L-02 要件 【外】

- spec: `spec/pages/index.md:98`「サインイン済みで訪れた場合はアプリへ戻る導線を表示」、**`:103`**「**状態**: 通常 / サインイン済み」— **明示的に 2 状態を要求**（当初 `:105` と記録していたが実測は `:103`。計画レビュー R1 arch:S-008）
- 実装: `apps/web/app/components/layout/PublicShell/index.tsx:10-12` に `signedIn` prop なし、`:26-38` で「サインイン」「はじめる」を無条件レンダー。利用者は `components/layout/LegalPage/index.tsx:19`（`/terms` `/privacy`）と `routes/index.tsx:29`
- `/terms` `/privacy` はセッションを一切読まない。`/` は `routes/index.tsx:12-17` の `beforeLoad` でサインイン済みを `/notes` へ redirect するため、`signedIn` 分岐が到達不能だった（prop 削除の直接原因）
- 削除コミットは `ea0fddb`（Issue #1 R2）。`git log -S"signedIn" -- .../PublicShell` は初出 `06b7610` と削除の 2 件のみで、**#2 で復活していない**
- 「到達しない分岐」という削除理由は `/` にしか当てはまらない。`PublicShell` は `LegalPage` 経由で `/terms` `/privacy` にも使われており、そこでは分岐が到達する
- **spec が正 → 実装変更（両ルートに session 読み取りを足す）が必要** → スコープ外（adr.md ADR-006）。将来 L-02 配下に増える P-41〜P-45 も同じ要件を継ぐ
- **本項目の対象は L-02 だけ**。同じ「サインイン済み」要件でも P-40（トップ）は性質が異なり、SYNC-26 として本 Issue で閉じる

### SYNC-25 — NoteTitle の上限超過時の挙動（調査中に発見） 【残】

- spec: `spec/domains/note.md:27`「前後の空白を除去して 200 文字以内。空になった場合は `"無題"` に置き換える（**例外を投げない**）」
- 実装: `domain/note/valueObject.ts:59-64` は 200 文字超で `BusinessRuleError(NoteErrorCode.InvalidTitle)` を **throw する**（切り詰めない）
- `NoteErrorCode.InvalidTitle` は `spec/domains/note.md:690` のエラーコード一覧にあるのに、振る舞い表・値オブジェクト節のどこからも投げられる場所が読み取れない
- SYNC-22 と同じ行（`:27`）の修正なので同一ステップで扱う

### SYNC-26 — P-40（トップ）のサインイン済み状態が spec 内部で矛盾している 【残】

計画レビュー R1（arch:P-009）で追加。SYNC-24 の調査が L-02 だけを見ていたため、同じ要件を持つ P-40 が台帳から漏れていた。

- spec 内部の矛盾（**同一ファイル**）:
  - `spec/pages/index.md:20`（URL 表）`| /` | トップ（未サインイン）/ **ノート一覧へのリダイレクト（サインイン済み）** | 公開 |`
  - `spec/pages/index.md:571`（P-40）`**状態**: 通常 / サインイン済み（**アプリへの導線を表示**）`
- 実装: `apps/web/app/routes/index.tsx:12-17` の `beforeLoad` が `sessionUserFn()` を読み、サインイン済みなら `/notes` へ redirect する → **URL 表と一致**
- 波及: `spec/inventory/frontend.md:143`（`PAGE-p40-001`「sign-in 済みには app への導線を出す」）、`:146`（`PAGE-p40-004`「アプリへ戻る」）
- **L-02（SYNC-24）とは性質が違う**。L-02 は `/terms` `/privacy` で分岐が到達するのに実装が `signedIn` prop ごと落とした側（spec が正）。P-40 は redirect によって分岐が到達せず、spec 内部で URL 表と状態行が食い違っている（SYNC-01 / SYNC-12 と同型の自己矛盾）
- 決着方向: 実装と一致する URL 表側へそろえる。実装変更を伴わないので**本 Issue で閉じる**（adr.md ADR-009）。反映先は `spec/pages/index.md:571` ＋ `spec/inventory/frontend.md:143,146`

### Issue #2 由来の spec-sync 候補（台帳は `research-2.md`）

`.thread/2/progress.md` の「spec-sync 候補」（ID 単位でほどくと 42 件。`research-2.md` が +2 件を追加発見して**台帳は 44 件**）（`AuthTokenRepository.findPendingByUserAndPurpose` の追加、`IdentityUniqueDirectory.beginRelease` と `releasing` 状態、`ScopeCleanupAdmissionStore.describePersonalCleanup`、`AccountDeletionManifestStore.describe` / `pruneTerminal` の戻り値、`getProfile` / `checkHandleAvailability`、継続 kind `identity.personalCleanupHandoverContinued`、TC-identity-268 の `InvalidProvider` 呼称ずれ、manual-tests の TC-26 / TC-13 ほか）。

**ユーザー判断で本 Issue のスコープに含めることになった**（Issue #14 のコメント）。台帳は `research-2.md` に 201 番台で採番し、受け入れ基準（AC-31 以降）とステップ（22 番以降）は後続の統合作業で追加する。本ファイルでは扱わない。

ただし、ステップ 1〜20 と**同一ファイル・同一節に触れる 3 件**は編集競合を避けるためステップ 1〜20 では触らない（plan.md のスコープ節に明示）:

- `spec/domains/identity.md:519-525` の enum に `InvalidAvatarUrl` / `AccountDeletionRetryLimitExceeded` が無い（SYNC-03 と同じ 1 つの表 = SYNC-244）
- `spec/domains/identity.md:357-362` の `IdentityUniqueDirectory` interface に `beginRelease` が無い（SYNC-15 と同じ節 = SYNC-205）
- `spec/domains/index.md` の `ScopeCleanupAdmissionStore` / `AccountDeletionManifestStore` interface に `describePersonalCleanup` / `describe` が無い（SYNC-14 と同じ節 = SYNC-206 / SYNC-208）

**統合作業（2026-08-15）で解消済み**: 上記 3 件を含む `research-2.md` の台帳は plan.md の AC-31 以降・steps.md のステップ 22 以降へ落とし、同一ファイルに触れるものは既存ステップ（1 / 2 / 3 / 4 / 6 / 7 / 8 / 9〜12 / 18）へ統合した。したがって「ステップ 1〜20 では触らない」という上記の制約は**もう適用されない**（ステップ 2 / 3 が該当項目を含む形に改訂済み）。

### SYNC-27 — `ExternalServiceError` という存在しないエラーコード名 【一部外】

- `spec/` 全域で 20 箇所以上（`spec/domains/index.md:172` MailSender、`spec/domains/note.md:371,385,404`、`spec/domains/storage.md:305,324,334`、`spec/domains/integration.md` 6 箇所、`spec/domains/conversion.md` 5 箇所、`spec/usecases/storage.md:125,360`、`spec/inventory/test.md` 6 行）
- コード側 JSDoc でも 7 箇所（`application/ports/{mailSender,shareTokenProtector}.ts`、`domain/note/ports/{pdfRenderer,htmlProcessor,noteExportComposer}.ts`、`domain/identity/ports/{secureTokenGenerator,passwordHasher}.ts`）
- 実 enum には無い。実アダプターの写像は 2 系統（外部 API 通信は `ExternalApiError`、鍵・データ整合は `DataIntegrityError`）で、「spec の `ExternalServiceError` をどちらへ写すか」を定義した節が spec に無い
- 本 Issue が扱うのは progress.md が名指しした **ShareTokenProtector 1 件（SYNC-11）のみ**。未実装ドメイン（conversion / integration / storage / job）の語は、実装が無く「どちらへ写すか」の裏づけが取れないため触らない。全域の語彙整合は別 Issue（adr.md ADR-006）

---

## 集計

| 分類 | 件数 | ID |
| --- | --- | --- |
| まだ乖離あり（本 Issue で直す） | **21** | SYNC-01,02,03,04,05,06,07,09,10,11,12,14,15,16,17,18,19,20,22,25,26 |
| 既に解消済み（何もしない） | **1** | SYNC-21 |
| 乖離なし・記録のみで決着 | **1** | SYNC-13 |
| スコープ外（実装変更・別 Issue） | **3** | SYNC-08,23,24 |
| スコープ外（全域語彙の整合・別 Issue） | **1** | SYNC-27 |

progress.md 由来の 24 件（SYNC-01〜24）の内訳は「残 19 / 済 1 / 乖離なし 1 / 外 3」。SYNC-25 は本調査で追加、SYNC-26（P-40 のサインイン済み状態が spec 内部で矛盾）は計画レビュー R1 で追加、SYNC-27 は境界の記録。Issue #2 由来の 44 件は本 Issue のスコープ内だが台帳は `research-2.md`（201 番台）。両台帳を合わせた実数は **70 件**（重複 SYNC-225 = SYNC-15 を 1 件として数えた場合）で、内訳は「要修正 59 / スコープ外 8 / 解消済み 2 / 乖離なし 1」。

**Issue #2（PR #17）のマージで解消された項目は 0 件**。PR #17 が `spec/` に加えた変更は `spec/adr/*.md` の 30 ファイル追加のみで（`git diff --stat cea6134..HEAD -- spec/`）、`spec/domains/` `spec/usecases/` `spec/testcases/` `spec/inventory/` はいずれも `cea6134`（2026-08-09）のまま。SYNC-03 と SYNC-14 はむしろ差が広がった。

## 依存関係

- `spec/inventory/*.md` はヘッダーに「生成元」と「最終同期」日付を持つ生成物。本文（`spec/domains/` `spec/pages/`）を直したら inventory の要点欄と最終同期日を追随させる
- `AGENTS.md` は `CLAUDE.md` へのシンボリックリンク
- `docs/*_implementation_example.md` は `CLAUDE.md`（Examples 節）と `README.md:47` と `spec/usecases/usage.md:120` と `apps/web/app/presentation/pagination.ts:5` から参照される
- `.thread/1/plan.md` は計画凍結時に削除されるため、`apps/web/app/start.ts:10` の AC-15 参照は本 Issue で spec への参照に差し替えないと宙に浮く
