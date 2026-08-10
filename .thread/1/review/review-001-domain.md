# Review 001 — Domain

対象: PR #12（`origin/main...HEAD`、376 変更ファイル）
観点: エンティティ・値オブジェクト・ドメインルール・不変条件・ポート契約
基準: CLAUDE.md / `spec/domains/{index,identity,note,conversion,workspace}.md` / `.thread/1/plan.md`

検証メモ: `packages/core/src/domain/` 全体で `new Date()` / `Date.now()` / `Math.random` / `crypto` の使用なし（`NoteAccessPolicy.ensureCanEdit` の `new Date(0)` は定数エポックで決定的）。application / adapters への逆向き import なし。domain 単体テスト 8 ファイル 134 件すべて通過を実行確認。

### Domain

#### Blockers

なし

spec/domains の契約との突き合わせ結果（主要確認点）:

- **AC-1**: `ScopeKey`（`application/scope.ts`）、`ScopeRouter` / `ScopeUnitOfWorkProvider`（scope 引数つき `run`、ネスト禁止を JSDoc で明文化）/ `GlobalUnitOfWorkProvider`、`ScopeCleanupAdmissionStore` / `AccountDeletionManifestStore` / `GlobalMaintenanceRunStore` / `MailSender` / `TimeZoneResolver` / `OAuthStateStore`（`take` の原子性契約明記）/ `IdempotencyStore(consumer, eventId)` — いずれもメソッド・型・契約が spec/domains/index.md と一致。
- **AC-2**: Identity 値オブジェクト 14 種すべて存在。Email 正規化（trim + 小文字化 + 254 字 + `local@domain`）、Handle（3–30・`[a-z0-9_-]`・先頭末尾英数・予約語 19 語一致・予約語判定を形式判定より先に）、PlainPassword（8–128 + 英字・数字各 1 以上）、`AuthTokenPurpose.ttlMs`（24h / 1h）、`LoginAttemptKey` の 2 ファクトリ限定生成 — 一致。`User`（pending/active/deleting/deleted の判別共用体、`DeletedUser` は PII なし tombstone、`assignHandle` の初回設定でも無条件発行、`authEpoch` 単調増加、`beginDeletion` で epoch+1、`rejectDeletion`/`finalizeDeletion` の operation ID 照合）、`Identity` / `Session`（TTL 30 日をドメイン所有、OCC なし）/ `AuthToken`（consume の期限検査、条件付き更新前提）— 一致。`IdentityPolicy`（上限 8・最終 UoW での再読基準を JSDoc 化）/ `AccountLinkingPolicy`（判定表どおり、未確認プロバイダーメールは既存利用者の状態に関わらず refuse）/ `LoginThrottlePolicy`（純関数導出、3 回目 1 秒〜上限 60 秒、10 回で `lastFailedAt`+15 分ロック、定数 4 種の正典化、テストで境界確認）— 一致。
- **AC-3**: Identity ポート 11 種（UserRepository / UserBatchReader / IdentityUniqueDirectory / IdentityRepository / SessionRepository / AuthTokenRepository / PasswordHasher / SecureTokenGenerator / SignInOAuthClient / LoginAttemptStore、横断の OAuthStateStore）すべて定義。`recordFailure` の単一原子操作禁止事項、`save(Consumed)` の条件付き更新 + `AUTH_TOKEN_ALREADY_CONSUMED`、reserve→activate→release の冪等性、`Session` に `save` を持たない理由 — いずれもエラー契約込みで JSDoc に明記され spec と一致。
- **AC-4**: Note 値オブジェクト 12 種（NoteTitle 空→「無題」・200 字超のみ例外、NoteHtml 800,000 バイト UTF-8、PlainTextContent 同上限、Excerpt 200 字、NoteHeading 1–6 / 100 字切り捨て / 200 件 cap、ShareLink のパスワード対保持を型で強制、SharePass 24h、NoteFailureReason = ConversionFailureReason − integrationRequired + canceled）— 一致。`Note`（lifecycle × content × visibility、`unlisted` は shareLink 必須を型で表現、`makePublic` のパスワード剥奪 + 休眠化、`makeUnlisted` の休眠復活→newLink→`ShareLinkRequired`、`reissueShareLink` のパスワード維持、`trash` の `purgeAfter = +30日`、TrashedNote への変更は型で遮断、reconstruct で「public + password 付き休眠リンク」を拒否）/ `NoteRevision`（`capture` の ready 検査）/ `NoteAccessPolicy`（所有→ゴミ箱遮断→public→unlisted+token→denied の評価順序、所有経路のみゴミ箱到達、`isPassValid` の 4 条件 + passwordUpdatedAt 世代照合）/ `NoteOwnershipPolicy` — 一致。`InitialContentState` は conversion.md の定義（failed 理由 3 種への Extract）と完全一致。
- **AC-5**: Note ポート群（HtmlProcessor / PdfRenderer / NoteExportComposer / NoteRepository / NoteRevisionRepository / LocalNoteQueryService / PublicNoteQueryService / LocalNoteProjectionWriter / PublicNoteProjectionWriter / NoteProjectionSnapshotReader / NoteProjectionRevisionStore / NoteRouteStore / NoteRouteFanOutReader / ShareTokenProtector / NoteMovePort）すべて定義され、シグネチャ・DTO・世代ベクトル比較規則・`highlightedExcerpt` の描画契約が spec と一致。
- ドメインイベント: Identity 8 種 / Note 14 種、payload とも spec の表と一致。

#### Warnings

- **[W-001]** spec の振る舞い表にない引数の追加（spec 内部矛盾の解決として妥当だが spec-sync 未記録）
  - 場所: `packages/core/src/domain/note/note.ts:149`（`createFromUpload` の `projectionRevision`）、`note.ts:193`（`createBlank` の `projectionRevision`）、`note.ts:373`（`moveTo` の `routeVersion`）
  - 理由: spec/domains/note.md の振る舞い表はこれらの引数を持たないが、同じ spec のイベント表が `note.created` に `projectionRevision`、`note.moved` に `routeVersion` を要求しており、集約が自力で採番できない以上引数で受けるしかない。実装の判断は正しい（`moveTo` にはコードコメントあり）。ただし spec の振る舞い表とシグネチャが恒久的に食い違ったままになる。
  - 提案: Issue #1 の spec-sync メモ（`IdentityErrorCode.IdentityLimitExceeded` の欠落と同列）にこの 3 シグネチャを追記し、spec/domains/note.md の振る舞い表を改訂対象として記録する。

- **[W-002]** `NoteMoveSnapshot` が opaque 型（`{ migrationId }` のみ）で、spec が定める内容物を持たない
  - 場所: `packages/core/src/application/ports/noteMovePort.ts:14-16`
  - 理由: spec/domains/note.md は snapshot の内容（Note / Revision、tag 表示名・正規化名、StoredFile metadata、BackupRecord、Usage delta）を定めている。AC-5 は「インターフェースが定義されている」ことを求めており、JSDoc で内容と「レイアウトは移動スライスで確定」の意図は明記されているが、DOM-note-066..070 の充足度としてはフィールドレベルで spec より弱い（Tag/Storage/Usage の型が本スライスに存在しない以上、完全定義は不可能なので判断自体は妥当）。
  - 提案: 現状維持でよいが、移動スライス（NoteMovePort 実装）の Issue にレイアウト確定を明示的に引き継ぐこと。見送り一覧（ADP-note-050..054）のコメントに「snapshot のフィールド定義も含む」と一言添える。

- **[W-003]** 共有トークンハッシュの比較が単純 `===`（spec は「定数時間比較」と明記）
  - 場所: `packages/core/src/domain/note/services/noteAccessPolicy.ts:109`
  - 理由: spec/domains/note.md の ShareLink 節は「閲覧要求では復号せずに入力全体のハッシュを定数時間比較する」とする。実装は提示トークンのハッシュと保存ハッシュを `===` で比較しており、タイミングで漏れるのは保存ハッシュのバイト列（そこからトークンを得るには原像攻撃が必要）のため実害はほぼないが、spec の文言との差分ではある。
  - 提案: 比較をどこで定数時間にするか（presentation/adapter で `timingSafeEqual` 相当を通した上でポリシーに渡す、またはポリシー側にコンパレータを注入）を共有・公開閲覧スライスまでに決め、当面はこの判断（hash-to-hash 比較なら timing leak は増幅不能）をコメントで残す。

#### カバレッジ

一覧: `/private/tmp/claude-501/-Users-hikaru-github-com-tuanemuy-hollow/745a12ca-2c12-4fee-b017-75c8d1afae23/scratchpad/changed-files.txt`（376 行）。確認 71 + スキップ 305 = 376。

確認（71 件）:

- `packages/core/src/domain/common/pagination.ts`, `packages/core/src/domain/common/time.ts`
- `packages/core/src/domain/conversion/valueObject.ts`, `packages/core/src/domain/job/valueObject.ts`, `packages/core/src/domain/storage/valueObject.ts`
- `packages/core/src/domain/identity/authToken.ts`, `errorCode.ts`, `events.ts`, `identity.ts`, `session.ts`, `user.ts`, `valueObject.ts`
- `packages/core/src/domain/identity/ports/authTokenRepository.ts`, `identityRepository.ts`, `identityUniqueDirectory.ts`, `loginAttemptStore.ts`, `passwordHasher.ts`, `secureTokenGenerator.ts`, `sessionRepository.ts`, `signInOAuthClient.ts`, `userBatchReader.ts`, `userRepository.ts`
- `packages/core/src/domain/identity/services/accountLinkingPolicy.ts`, `identityPolicy.ts`, `loginThrottlePolicy.ts`
- `packages/core/src/domain/identity/__tests__/identity.test.ts`, `loginThrottlePolicy.test.ts`, `policies.test.ts`, `user.test.ts`, `valueObject.test.ts`（テスト名の spec 境界対応を確認し、全件実行で通過）
- `packages/core/src/domain/note/errorCode.ts`, `events.ts`, `note.ts`, `noteRevision.ts`, `valueObject.ts`
- `packages/core/src/domain/note/ports/htmlProcessor.ts`, `localNoteProjectionWriter.ts`, `localNoteQueryService.ts`, `noteExportComposer.ts`, `noteProjectionRevisionStore.ts`, `noteProjectionSnapshotReader.ts`, `noteRepository.ts`, `noteRevisionRepository.ts`, `pdfRenderer.ts`, `publicNoteProjectionWriter.ts`, `publicNoteQueryService.ts`
- `packages/core/src/domain/note/services/noteAccessPolicy.ts`, `noteOwnershipPolicy.ts`
- `packages/core/src/domain/note/__tests__/note.test.ts`, `noteAccessPolicy.test.ts`, `valueObject.test.ts`（同上）
- `packages/core/src/domain/workspace/errorCode.ts`, `services/workspaceAuthorization.ts`, `valueObject.ts`
- `packages/core/src/application/scope.ts`, `packages/core/src/application/execution/unitOfWork.ts`
- `packages/core/src/application/ports/accountDeletionManifestStore.ts`, `globalMaintenanceRunStore.ts`, `idempotencyStore.ts`, `mailSender.ts`, `noteMovePort.ts`, `noteRouteFanOutReader.ts`, `noteRouteStore.ts`, `oauthStateStore.ts`, `scopeCleanupAdmissionStore.ts`, `scopeRouter.ts`, `shareTokenProtector.ts`, `timeZoneResolver.ts`
- `packages/core/src/application/identity/verifyEmail.ts`, `authenticateSession.ts`（authEpoch 不変条件のユースケース側 enforcement のみスポット確認。全体は usecase 観点に委譲）
- `packages/core/src/application/errors.ts`（ポート契約が参照するエラー種別の存在のみ確認。全体は application 観点に委譲）

スキップ（288 件、ディレクトリ単位）:

- `packages/core/src/domain/todo/**`（9 件・D）— todo 参照実装の削除のみ（AC-14）。契約なし
- `packages/core/src/adapters/conformance/**`（24 件）、`packages/core/src/adapters/memory/**`（37 件）、`packages/core/src/adapters/{aws,cloudflare,gcp,d1,libsql}/**`（31 件・D）— アダプター観点
- `packages/core/src/application/{identity,note,workers,di,__tests__}/**` の残り（39 件）、`application/errors.ts` 以外の `config.ts` / `di/types.ts` / `di/serverNode.ts` / `di/memoryRuntime.ts` 等 — ユースケース / DI 観点（うち verifyEmail / authenticateSession / errors.ts は上記スポット確認済みのため確認側に計上）
- `apps/web/**`（104 件）— presentation / frontend 観点
- `.thread/1/**`（5 件）、`docs/**`（7 件）、`.github/workflows/ci.yml` — ドキュメント / CI。設計意図の参照のみ
- `infra/**`（29 件・D）— インフラ削除（AC-14）
- ルート設定（`biome.json`, `package.json`, `pnpm-lock.yaml`, `pnpm-workspace.yaml`, `vitest.config*.ts`×3, `packages/core/package.json`）— ツーリング観点
