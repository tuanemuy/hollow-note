# 実装計画 — Issue #1: [skeleton] アカウント作成から白紙ノート閲覧までを通す

**Issue:** #1
**作成日:** 2026-08-09
**複雑度:** 中〜大規模
**実装方針:** steps.md

---

## 目的

共通ドメイン基盤（ScopeKey・二平面 Unit of Work・横断ポート）、Identity / Note ドメイン、in-memory アダプター + ポート適合テスト、アプリシェルを整え、アカウント作成 → サインイン → 白紙ノート作成 → 閲覧を Node ランタイム上で end-to-end に成立させる。以降のスライスが同じ設計・テスト基盤へ積み上がる状態を作る。

## 受け入れ基準

| # | 基準（検証可能な形で） | 由来 | 対応ステップ |
|---|---|---|---|
| AC-1 | 共通基盤: `ScopeKey` / `ScopeRouter` / `ScopeUnitOfWorkProvider`（scope 引数つき `run`、ネスト禁止）/ global UoW / `ScopeCleanupAdmissionStore` / `AccountDeletionManifestStore` / `GlobalMaintenanceRunStore` / `MailSender` / `TimeZoneResolver` / `OAuthStateStore` / `IdempotencyStore(consumer, eventId)` の型・契約が spec/domains/index.md どおり定義されている | DOM-common-001..040 | 2 |
| AC-2 | Identity ドメイン: 値オブジェクト14種の不変条件（Email 正規化、Handle 予約語、PlainPassword 8–128 + 英数 等）、`User/Identity/Session/AuthToken` の判別共用体と遷移、`IdentityPolicy`（上限8）/ `AccountLinkingPolicy` / `LoginThrottlePolicy`（3回目から段階待機・10回で15分ロック・導出ロック）が spec/domains/identity.md どおり実装され、単体テストが通る | DOM-identity-001..021 | 3 |
| AC-3 | Identity ポート11種のインターフェースがメソッド・エラー契約（`recordFailure` 原子性、reserve→activate→release、`save(Consumed)` の条件付き更新等）込みで定義されている | DOM-identity-022..059 | 3 |
| AC-4 | Note ドメイン: 値オブジェクト12種（NoteTitle 空→「無題」、NoteHtml ≤800KB 等）、`Note`（lifecycle × content × visibility）/ `NoteRevision`、`NoteAccessPolicy`（評価順序と NOT_FOUND 収斂）/ `NoteOwnershipPolicy` が spec/domains/note.md どおり実装され、単体テストが通る | DOM-note-001..016 | 4 |
| AC-5 | Note ポート群（HtmlProcessor / PdfRenderer / NoteExportComposer / NoteRepository / NoteRevisionRepository / QueryService×2 / 投影 Writer・Reader・RevisionStore / NoteRouteStore / NoteRouteFanOutReader / ShareTokenProtector / NoteMovePort）のインターフェースが定義されている | DOM-note-017..070 | 4 |
| AC-6 | ポート適合テスト: バックエンド差し替え可能な共有スイートが存在し、in-memory アダプターが全スイートを通過する | Issue 目的「ポート適合テスト」+ ADP 全行 | 5 |
| AC-7 | in-memory アダプター: ADP-common-001..039 / ADP-identity-001..032,035..038 / ADP-note-008..049 が契約どおり実装されている（`reserveCreate→activateCreate` サガ、`take` の原子性、lane/lease を含む。ADP-identity-033/034 は見送り確定 — ADR-006） | ADP 各行 | 6 |
| AC-8 | `signUpWithPassword`: 未登録メール→PendingUser + 確認メール、登録済みメール→応答同一のまま既存アカウント通知メール、email 予約→UoW→activate の recovery、メール失敗でも登録成功。対象 TC が通る | UC-identity-001, TC-identity-247..255,259,261..263 | 7 |
| AC-9 | `signInWithPassword`: 成功でセッション発行・失敗記録 clear、失敗で原子的 recordFailure、THROTTLED（待機秒）/ LOCKED（解除時刻）の分離、login_attempts は UoW 外。対象 TC が通る | UC-identity-004, TC-identity-213..237 | 7 |
| AC-10 | `authenticateSession`: 完全読み取り専用、期限・epoch 不一致・不在いずれも `UNAUTHENTICATED` に収斂。TC-identity-008..016 が通る | UC-identity-008 | 7 |
| AC-11 | `pruneExpiredAuthState`: cron / continuation の3入力、GlobalMaintenanceRunStore の run 再開・lane claim・checkpoint・lease 回復、1コマンド=1シャード1表・100件上限。対象 TC が通る（156: 消費済み・期限内トークンの非削除境界、160: `intent:"integration"` の認可フロー状態も同じ `OAuthStateStore` で削除、を含む全行） | UC-identity-021, TC-identity-150..178 | 7 |
| AC-12 | `createBlankNote`: 個人所有で route reserve→scope UoW→activate、タイトル省略→「無題」、201字→InvalidTitle、存在しないワークスペース ID→`WORKSPACE_NOT_FOUND`、recovery 3経路（commit 失敗 release / activate 応答喪失の同一 operation ID 再試行 / reserved 期限切れ回復）。対象 TC が通る | UC-note-001, TC-note-054,058..065 | 7 |
| AC-13 | `getNote`: route→scope→NoteAccessPolicy、他人の非公開・不在・権限なしは `NOTE_NOT_FOUND` に収斂、所有者はゴミ箱ノートを閲覧可、限定公開の所有者には shareUrl を復号 reveal、公開ノートは匿名閲覧者にも本文を返し shareUrl は含めない。対象 TC が通る | UC-note-002, TC-note-165,168..173,176..178,187 | 7 |
| AC-14 | DI / ランタイム: `adapters/memory/` を配線した Node ランタイムで `pnpm dev` / `pnpm build` が動作し、todo 参照実装と他ランタイム（libsql/d1/cf/aws/gcp のアダプター・entry）が削除されている（削除はステップ1 に前倒し — ADR-004 改訂。memory 配線はステップ8） | Issue 目的「アプリシェル」 | 1, 8 |
| AC-15 | セッション運搬: HttpOnly / Secure / SameSite=Lax / Path=/ / 期限 = Session.expiresAt の Cookie、認証ガード（未認証→/signin→元の遷移先へ復帰）、`UNAUTHENTICATED`→401 / `THROTTLED|LOCKED|RATE_LIMITED`→429 / `NOTE_GONE`→410 のコード例外マッピング。CSRF 規律: ミューテーションはすべて JSON POST の server function（`FormData` を受ける経路を作る場合は `Origin` 検証必須）、状態を変更する GET 経路を作らない（verify-email のトークン消費を含む） | spec/presentation/index.md | 9 |
| AC-16 | P-01 サインアップ（項目エラー・送信完了・全体エラーの状態、サインインへの導線）と P-02 サインイン（認証失敗共通文言・未確認・待機中・ロック中の状態分離、サインアップへの導線）が L-03 レイアウトで動作する | PAGE-p01-001,002,004 / PAGE-p02-001,002,005, AC-01, AC-04 | 10 |
| AC-17 | メール確認リンク → ActiveUser + サインイン状態でノート一覧へ着地（AC-01 の e2e 成立に必要な glue: verifyEmail（UC-identity-002）+ /verify-email 最小ルート。ページ描画は GET、トークン消費は POST — ADR-007） | spec/scenario/account.md#AC-01 | 10 |
| AC-18 | ノート一覧（最小）から「新規作成」で白紙ノートが作られ、「ノートを開く」で P-11 ノート詳細（本文 Shadow DOM 表示・スケルトン・見つかりません状態）が閲覧できる | PAGE-p10-005, PAGE-p11-001, ED-01（最小）, OR-11 | 11 |
| AC-19 | P-46（存在と権限を区別しない共通表示・安全な再試行・トップ/一覧への導線）と P-47（/terms /privacy 静的表示）が動作する | PAGE-p46-001..003, PAGE-p47-001 | 9 |
| AC-20 | `pnpm typecheck && pnpm lint:fix && pnpm format` が通り、対象 unit テストが全て通る。Issue 検証項の「対象の integration test」は memory バックエンドの適合テスト（unit 速度で実行）が兼ねる（ADR-002/003） | Issue 検証 | 全ステップ |

## スコープ

### 含まれないもの

- **見送る ADP 行**（Issue コメントに理由を残す。見送り基準は ADR-006 に明文化）: ADP-note-001..007（HtmlProcessor / PdfRenderer / NoteExportComposer — 実装本体が外部技術結合で、対応 TC は取り込み・編集・書き出しスライス）、ADP-note-050..054（NoteMovePort — 移動スライス）、ADP-identity-033/034（SignInOAuthClient — startOAuthFlow / completeOAuthSignIn が本スライス外で実行経路がなく、実装本体は OAuth プロトコル結合。OAuth スライスで実装）。ポート**定義**（DOM 行）は本スライスで行う。永続化ストア系（AccountDeletionManifestStore / ScopeCleanupAdmissionStore の削除フロー系メソッド含む）はシナリオで実行されなくても memory 実装 + 適合テストまで行う（ADR-006 の基準どおり）。
- **見送る PAGE 行**: PAGE-p01-003 / PAGE-p02-003（Google OAuth — startOAuthFlow が本スライス外）、PAGE-p02-004（パスワード再設定 — P-04 が本スライス外）、PAGE-p02-006（確認メール再送 — resendVerificationEmail が本スライス外）、PAGE-p11-008/010/011/013（changeNoteStyleMode / requestRegeneration / requestBackup / trashNote が本スライス外）。UI 上は対応する要素を出さない（無効ボタンの placeholder は作らない）。
- **見送る TC 行**（全 ID 列挙で確定。実装∪見送り＝チェックリスト全行）: TC-note-055..057,066（workspace の権限評価・route `created_by` 前提 — スライス #3）、TC-note-166,167,174,175（workspace viewer / editor 前提 — スライス #3）、TC-note-179..186（references / storage / conversion 前提 — HtmlProcessor・StoredFileRepository が取り込みスライス）、TC-note-188,189（getPublicNote / getSharedNote — 公開閲覧スライスの UC）、TC-identity-256..258（invitation 前提）、TC-identity-260（RATE_LIMITED — レート制限バインディングは CF スライス）。TC-identity-156 / 160 は実装対象（AC-11）、TC-note-061（`WORKSPACE_NOT_FOUND` 分岐 — 本スライスで実装する分岐の検証行）は AC-12、TC-note-177 / 178（shareUrl reveal・匿名 viewer の public 経路 — 実装部品はすべて本スライス対象で seed のみで実行可能）は AC-13 に含める。各行の見送り理由は上記のとおり確定済みで、実装完了時に Issue コメントへ転記する。
- ワークスペース所有の Note 作成・閲覧（createBlankNote / getNote の workspace 分岐は `NotFoundError("WORKSPACE_NOT_FOUND")` 返却までを実装し、権限評価はスライス #3。`WORKSPACE_NOT_FOUND` 分岐の TC-note-061 は実装対象 — AC-12）。
- WYSIWYG エディタ（P-12）・自動保存（ED-01 の完全形はスライス #7。本スライスは「新規作成 → 白紙ノート詳細」まで）。
- コマンドパレットの検索・絞り込み機能本体（シェルにトリガー UI のみ。DS スライス）。
- Cloudflare D1 / DO / R2 アダプターと CF ランタイム（Issue #11）。
- レート制限バインディング相当（サインアップの粗いレート制限）— CF スライスで導入。
- `pruneExpiredAuthState` のランタイム配線: usecase とテスト（AC-11）は本スライスで実装するが、Node runner へのスケジュール登録と continuation コマンドのルーティングは行わない（consumer no-op のまま。配線は後続スライス — CF cron。Issue コメントの見送り一覧に記載）。
- サインアウト（UC-identity-009 `signOut`）。UI のサインアウトは Cookie 破棄のみの presentation 限定 glue とし、セッション行の削除（usecase の本体）は行わない — UC-identity-009 の部分実装の先取りを避ける（ADR-008）。
- **縮退の記録**（Issue コメントの見送り理由一覧に含める）: LOCKED 表示の「パスワード再設定への導線」は P-04 不在のため文言のみ（PAGE-p02-004 の見送りとは別のエラー表示側の縮退）。Cookie の `Secure` 属性は dev（http）でのみ条件付き無効化（spec は無条件付与）。

## リスクと注意点

- **チェックリストと UC 一覧の内部矛盾**: verifyEmail（UC-identity-002）不在のままでは AC-01 が e2e にならないため glue として追加する（AC-17）。ノート一覧も同様に最小 read を仮設する（AC-18）。レビューで「チェックリスト外の実装」と誤検知されないよう、この2点は本計画が根拠。
- **spec 内部の不整合（再サインアップ時の再送）**: spec/scenario/account.md AC-01 異常系は「確認前に再度サインアップ → 確認メールを再送」を要求するが、spec/usecases/identity.md の signUpWithPassword 手順と TC-identity-255 は Pending / Active を区別せず既存アカウント通知メールを送る。本計画は usecase / TC 側を正とする（spec-sync 対象としてメモ）。マニュアルテストで「再送されない」ことを失敗と誤判定しない。
- **削除の規模**: todo 参照実装 + libsql/d1/cf/aws/gcp アダプター・server entry・integration 設定の削除は影響が広い。`vitest.config.integration*.ts` / root スクリプト / wrangler・drizzle 設定 / docs の参照切れに注意。削除はステップ1 に前倒しし、残存参照元の暫定スタブ化（`unitOfWork` / `di/{types,serverNode}` / `eventRelayWorker` / `server.node.ts` / `__root.tsx` / `routes/index.tsx` — 完全な列挙は steps.md 手順1）+ `routeTree.gen.ts` の再生成 + npm scripts / 依存の整理（`postinstall: wrangler types` を含む）で typecheck / build を既知断なしで緑に保つ（steps.md 手順1、ADR-004 改訂）。ステップ1〜8 の間は `pnpm test` ではなく `pnpm test:unit` を使う（root scripts の最終形はステップ8 で確定）。
- **`docs/test.md` の「リポジトリ fake 禁止」方針との衝突**: in-memory アダプターは fake ではなく適合テストを通る正規アダプターとして位置づけ、docs/test.md を改訂する（adr.md ADR-002）。
- **GlobalMaintenanceRunStore / AccountDeletionManifestStore の in-memory 実装は契約が重い**（lane / lease / keyset カーソル / 状態機械）。TC-identity-168..178 が事実上の適合テストになる。工数の主要リスク。
- **`__root.tsx` の副作用 import**: "use client" island からのみ到達する server function は RSC manifest 登録のため root で side-effect import が必要（todo 参照実装の gotcha）。新ページでも踏襲しないとビルド後に server fn が 404 になる。
- **in-memory の永続性**: dev サーバー再起動でデータが消えるのは仕様（walking skeleton）。マニュアルテストは 1 プロセス内で完結させる。
- **セッション Cookie とリダイレクト**: 認証後の「元の遷移先へ復帰」はオープンリダイレクトにしない（同一オリジンのパスのみ許可）。

## テスト方針

- **domain 単体テスト**: VO・エンティティ遷移・ドメインサービス（LoginThrottlePolicy の境界: 3回目待機 / 10回ロック / 15分解除、NoteAccessPolicy の評価順序）を `packages/core/src/domain/{identity,note}/__tests__/` に。既存 todo テストの形式（`.test.ts` + 必要なら `.property.test.ts`）を踏襲。
- **ポート適合テスト**: 共有スイート（ステップ5）を in-memory バックエンドで実行。`LoginAttemptStore.recordFailure` の並行 10 件（TC-identity-227）、`OAuthStateStore.take` の原子性、`IdentityUniqueDirectory` の reserve/activate/release、`NoteRouteStore` サガ、OCC を必須ケースに含める。
- **usecase テスト**: `spec/testcases/{identity,note}/*.md` の対象行を in-memory コンテナで実装（TC ID をテスト名に含めて対応を機械的に追えるようにする）。UoW 境界の検証（TC-identity-236,166）と clock 供給源の検証（TC-identity-167）を含む。
- **検証コマンド**: `pnpm typecheck && pnpm lint:fix && pnpm format && pnpm test:unit`。Issue 検証項の integration test は、memory バックエンドでは適合テスト（unit 側で実行）が兼ねる（AC-20 / ADR-002/003）。
- **usecase テストの seed 注意**: getNote 系で本文ありノートを seed する場合（TC-note-165 等）、`references` への assert は置かない — 本スライスでは HtmlProcessor 見送り + 白紙ノートのみのため本文由来参照が存在しないことが空返却の根拠（steps.md 参照）。TC-note-177 / 178 の前提状態は `Note.makeUnlisted` / `makePublic`（DOM-note-013 で全遷移実装）+ ShareTokenProtector（memory）で seed する — 共有・公開の UC 群は不要。
- **マニュアルテスト（部分実行）**: `spec/manual-tests/account.md`（AC-01, AC-04 系 TC）、`editing.md`（ED-01 の新規作成部分のみ）、`organize.md`（OR-11 のみ）を `pnpm dev` で実行。既知の期待値変更: account.md TC-02 手順2 の空状態は「アップロード導線」を除き新規作成導線のみで判定（アップロードは本スライス外・placeholder 禁止方針）、再サインアップ時の再送は行われない（上記 spec 内部不整合）。skip / 期待値変更した手順の一覧はステップ12 で整理し Issue コメントに残す。
