# 進捗メモ — Issue #1（ステップ12: 仕上げ）

最終検証はすべて緑: `pnpm typecheck` / `pnpm lint:fix`（fix なし）/ `pnpm format`（差分なし）/ `pnpm test:unit`（388 件）/ `pnpm build`。マニュアルテスト（testing.md の全項目 + エッジケース）は前チャンクで e2e スモークとして完走済み。仕上げでの `inputValidator` → `validator` 改名（後述）は TanStack Start 内部で同一オプションに写る純粋なエイリアスであり、改名後に typecheck / test:unit / build と本番ビルドのルート応答（`/` `/signin` `/terms` 200、`/_serverFn/*` 到達）を再確認した。

## ステップ12 で実施した追加変更

- `createServerFn().inputValidator()` の deprecation 追随: `@tanstack/start-client-core` 1.170 で `inputValidator` が `@deprecated Use "validator" instead` になったため、呼び出し 4 箇所（`SignUpForm/action.ts` / `SignInForm/action.ts` / `VerifyEmailPanel/action.ts` / `routes/notes/-action.tsx`）を `.validator()` へ改名し、presentation のコメント 3 箇所と `docs/{frontend,backend}_implementation_example.md` 内の記載も追随させた。挙動は同一（フレームワーク側は両キーを同じ値に設定し `validator` を優先読み取り）。

## Issue コメント用: 見送り・縮退・期待値変更の一覧

実装フェーズの成果物として整理。Issue #1 のチェックリスト消化コメントに転記する（本チャンクでは投稿していない）。

### 見送った ADP 行（基準は ADR-006: 外部技術結合 + 本スライスに実行経路も TC もない）

- ADP-note-001..007 — HtmlProcessor / PdfRenderer / NoteExportComposer。取り込み・編集・書き出しスライスで対応 TC とともに実装。
- ADP-note-050..054 — NoteMovePort。移動スライスで実装。`NoteMoveSnapshot` の中身（spec/domains/note.md が定める snapshot フィールド定義: Note / Revision / tag 名 / StoredFile metadata / BackupRecord / Usage delta）の実装も移動スライスに含む（W-002）。
- ADP-identity-033/034 — SignInOAuthClient。startOAuthFlow / completeOAuthSignIn が本スライス外で、実装本体は OAuth プロトコル結合。OAuth スライスで実装。
- いずれもポート定義（DOM 行）は本スライスで実装済み。永続化ストア系（AccountDeletionManifestStore 全 14 メソッド / ScopeCleanupAdmissionStore の削除フロー系を含む）はシナリオで実行されなくても memory 実装 + 適合テストまで実施済み。

### 見送った PAGE 行（UI 上は対応要素を出さない。無効ボタンの placeholder も作らない）

- PAGE-p01-003 / PAGE-p02-003 — Google OAuth（startOAuthFlow が本スライス外）。
- PAGE-p02-004 — パスワード再設定（P-04 が本スライス外）。
- PAGE-p02-006 — 確認メール再送（resendVerificationEmail が本スライス外）。
- PAGE-p11-008/010/011/013 — styleMode 変更 / 再生成 / バックアップ / ゴミ箱（対応 UC が本スライス外）。

### 見送った TC 行

- TC-note-055..057,066 / TC-note-166,167,174,175 — workspace 権限・viewer/editor 前提（スライス #3）。
- TC-note-179..186 — references / storage / conversion 前提（取り込みスライス）。
- TC-note-188,189 — getPublicNote / getSharedNote（公開閲覧スライス）。
- TC-identity-256..258 — invitation 前提（スライス #3）。
- TC-identity-260 — RATE_LIMITED（レート制限バインディングは CF スライス）。

### スコープ外として実施しなかったもの

- `pruneExpiredAuthState` のランタイム配線 — usecase とテストは実装済みだが、Node runner へのスケジュール登録と continuation コマンドのルーティングは行っていない（runner の pruner 役は `pruneOutbox` のみ、consumer no-op。配線は CF cron スライス）。
- サインアウトの UC-identity-009 本体 — UI のサインアウトは Cookie 破棄のみの presentation glue（ADR-008）。セッション行は期限まで残り prune が回収する。
- createBlankNote / getNote の workspace 分岐 — `WORKSPACE_NOT_FOUND` 返却まで（権限評価はスライス #3）。

### 縮退（仕様との既知の差分）

- LOCKED 表示の「パスワード再設定への導線」は文言のみでリンクなし（P-04 不在のため）。
- セッション Cookie の `Secure` 属性は dev（http）でのみ条件付き無効化（spec は無条件付与。本番ビルド + https では付与される）。

### マニュアルテストで skip / 期待値変更した手順

- account.md TC-02 手順2 の空状態 — アップロード導線を除き新規作成導線のみで判定（アップロードは本スライス外・placeholder 禁止方針）。
- account.md AC-01 異常系「確認前の再サインアップ → 確認メール再送」 — 再送されず既存アカウント通知メールになるのが正（spec 内部不整合。usecase / TC-identity-255 側を正とした）。
- editing.md — ED-01 の新規作成部分のみ実行（エディタ・自動保存はスライス #7）。
- organize.md — OR-11 のみ実行。

## spec-sync 対象の集約

plan.md / adr.md に散在するメモの一覧。spec-sync スキルでの同期候補。

- spec/scenario/account.md AC-01 異常系の「確認メール再送」 — usecases/identity.md と TC-identity-255（既存アカウント通知メール）に合わせて改訂（plan.md リスク欄）。
- **メール確認の着地状態に「確認済み・サインインが必要」を追加**（ADR-038 / R3-SC-B-301）— セッション発行を確認要求元ブラウザーに束縛したため、別端末・別ブラウザーで確認リンクを開いた場合は「メール確認は成立するがサインイン状態にはならない」経路が生まれた。反映先は 3 か所: `spec/scenario/account.md` AC-01#5（「確認リンク → サインイン状態でノート一覧」に同一ブラウザー条件を付す）、同 AC-02#2（確認後のサインイン導線）、`spec/pages/index.md#P-03` の状態直和（処理中 / 成功 / **確認済み・サインインが必要** / 使用済み / 期限切れ / 無効 / 一時障害）。あわせて P-03 に一時障害（`failed`、system / unknown の再試行導線）の状態も無い（R3-FE-W-004）。
- spec/domains/identity.md の `IdentityErrorCode` enum — `IdentityLimitExceeded` の記載漏れを追記（steps.md 設計節）。
- spec/domains/note.md の `Note.createBlank` / `createFromUpload` に `projectionRevision`、`moveTo` に `routeVersion` 引数を追記（ADR-011）。
- ShareTokenProtector の失敗エラー — 契約 JSDoc が言う `ExternalServiceError` が `SystemErrorCode` に存在せず `DataIntegrityError` に写した（ADR-017）。
- `VerifyEmailView.sessionToken` — alreadyVerified 経路のため `string | null`（spec の出力表は表現不能 — ADR-021）。
- `SignInView` / `VerifyEmailView` への `expiresAt` 追加検討 — 現状は presentation が `Session.ttlMs` から Cookie 期限を再導出（ADR-024）。
- ScopeCleanupAdmissionStore / AccountDeletionManifestStore の状態機械の解釈確定分 — 削除スライス実装時に usecase 側と齟齬が出れば適合スイート側を正として spec に反映（ADR-017）。AccountDeletionManifestStore の `allRollbackReleased` と `personalAbort` receipt の関係（spec/domains/index.md の receipt 集合解釈 — rollback の正本に receipt を含めるか release ack のみか）も削除スライスで確定する（W-026）。
- `PROVIDER_ACCOUNT_ALREADY_LINKED` の担保箇所の確定 — memory では provider-account 一意性を IdentityUniqueDirectory 側で担保しており、IdentityRepository は契約上の `ConflictError("PROVIDER_ACCOUNT_ALREADY_LINKED")` を送出しない。OAuth スライスで repo 層に担保を実装するか、契約を IdentityUniqueDirectory 側へ寄せる旨を spec/domains/identity.md で確定（W-028）。
- resolveMany の上限超過時挙動の spec 明文化 — UserBatchReader（100件）・NoteRouteStore（500件）とも `SystemError(DatabaseError)` で reject に統一済み（R2-TS-W-002。上限超過は呼び出し側のプログラミングエラーであり並行状態の衝突ではないため、409 になる `ConflictError` は不適当。造語だった `NOTE_ROUTE_BATCH_TOO_LARGE` は廃止）。両ポートの `Error contract:` 行と適合スイートは統一後の内容。spec/domains/{identity,note}.md 側にも明記する（W-013）。
- spec/presentation/index.md の「公開ページのセキュリティヘッダー」表に `Cache-Control: private, no-store` を追記 — `apps/web/app/server.node.ts` の `SECURITY_HEADERS` へ既定として追加済み（R2-SC-W-203。GET server function + Cookie 認証の応答に freshness 指示が無く、前段キャッシュに他人の応答を配られうるため）。公開ノートだけ緩める方針は公開閲覧スライスで確定する。
- **CLAUDE.md の全面改訂**（前チャンクからの申し送り。ステップ12 に記載がないため実装せず記録）: 旧 4 ランタイム構成（Cloudflare / AWS / GCP のエントリ・DI・docs 参照）、todo 参照実装（`apps/web/app/components/todo/` / `routes/todo/` / `TodoBoard`）、`infra/*` ワークスペース、`docs/runtime_{cloudflare,aws,gcp}.md`、`serverAction` の `inputValidator` 記述が現状（Node + memory 一本、Identity / Note ドメイン、`.validator()`）と乖離している。
- docs/backend_implementation_example.md / docs/frontend_implementation_example.md — Todo ドメイン前提の実装例のまま（`di/serverCloudflare.ts` / `TodoEvent` / `createTodoFn` 等）。パターン自体は現行実装と同型だが、例示を Identity / Note ベースへ差し替えるか「歴史的な例」と明記する改訂が必要。`.inputValidator` の記載のみ本チャンクで `.validator` へ機械的に追随済み。
- TC-identity-261 の改訂 — `spec/testcases/identity/signUpWithPassword.md` と `spec/inventory/test.md:400` は「同一メールの並行2要求で片方は `ConflictError("EMAIL_ALREADY_USED")`」と規定しているが、実装は応答同一化（ユーザー列挙耐性・AC-15）を優先し、一意性違反を `IdentityUniqueDirectory` のポート契約として保持したまま `signUpWithPassword` が一律応答へ畳む形にした。TC-261 の期待結果を「利用者はちょうど1人・応答 shape は同一・decoy id は別値」へ改訂する必要がある。
- **TC-identity-174 の期待挙動の変更**（ADR-039 / ADP-common-030）— 「lease 失効後は continuation コマンドの再投入で同じ lane を再開する」から「次の cron が失効 lane を自動回収して run を完走する」へ変わった（リース失効時に `claimed` lane が cursor / table 位置を保ったまま `pending` へ戻るのがポート契約になったため）。`spec/inventory/test.md:313` の期待結果「同じ run/table/cursor position を新 owner が claim し、重複 run を作らず完了まで進める」とは整合するが、テスト実装が検証している経路（回収の起点）が変わっているので、`spec/testcases/identity/pruneExpiredAuthState.md` の TC-identity-174 記述が continuation 前提になっていないか確認し、必要なら追随させる。
- 文字数の数え方の明文化 — `spec/domains/note.md` の「200文字以内」「100文字以内」が UTF-16 コード単位である旨を明記する必要がある（実装は `.length` で検査し、切り詰めはサロゲートペアを割らない）。
- `spec/design/tokens.md §10` のフォーカスリング改訂 — accent 背景でフォーカスリングが判別できない（`--shadow-focus` が同色）。トークン定義そのものの改訂（内側リング/オフセット）と `spec/design/pages/*.html` モック群への波及が必要。加えて `apps/web/app/components/auth/formStyles.ts` の `inputClass` に残る `focus:outline-none` が forced-colors 対策を打ち消す件も同じ改訂に含める。
- `spec/pages/` の L-02 要件 — サインイン済みで `/terms` `/privacy` を訪れても「サインイン / はじめる」CTA が出続ける。`PublicShell.signedIn` は到達しない分岐だったため prop ごと削除した。サインイン済み利用者への CTA 抑止を要件とするなら spec 側で起こし直す必要がある。

## フォローアップ

- Issue #1 への見送り一覧コメントの投稿（上記「Issue コメント用」節を転記。チェックリストの消化率確定と同時に行う）。
- 開発マシンにステップ11 チャンクの `pnpm dev`（port 3000）が残存していたため、本チャンクの本番スモークは port 3100 で実施した。残存プロセスは停止していない（他セッションの所有物のため）。
