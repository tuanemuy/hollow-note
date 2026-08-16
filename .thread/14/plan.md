# 実装計画 — Issue #14: spec と実装の乖離を同期する（skeleton スライスで蓄積した分）

**Issue:** #14
**作成日:** 2026-08-15
**複雑度:** 大規模
**実装方針:** steps.md

---

## 目的

Issue #1（walking skeleton）**と Issue #2（アカウント管理・認証 / PR #17）**の実装・レビュー・検証を通じて `spec/` と実装のあいだに蓄積した乖離を、`spec/adr/046`（正本のある側へ倒す）の判定規則に沿って解消し、`spec/` と `CLAUDE.md` / `docs/` を現在の実装の正典として読める状態に戻す。

Issue タイトルは「skeleton スライスで蓄積した分」だが、**Issue #2 由来の分もユーザー判断でスコープに含む**（Issue #14 のコメント）。

## 前提: 乖離項目の台帳

台帳は 2 本に分かれる。**両方とも本 Issue のスコープ内**で、受け入れ基準とステップは 1 つの計画に統合済み。

> **`research.md` / `research-2.md` は本 Issue では調査の足場ではなく成果物である。** 70 件の乖離台帳そのもので、AC-1〜69 の由来欄とステップの「台帳 ID」欄が SYNC ID で直接参照している（ID を辿れないと、どの受け入れ基準がどの乖離を閉じるのかが読めなくなる）。したがって**計画凍結時に `plan-review/` と一緒に削除しない**。削除してよいのは `plan-review/`（レビュー記録）だけで、`adr.md` の長寿命な判断は `spec/adr/052`〜`057` へ昇格させて残す（ステップ 20）。

- **skeleton スライス由来（SYNC-01〜27）** — `.thread/1/progress.md` の「spec-sync 対象の集約」24 行に SYNC-01〜24 を採番し、全件を実ファイルで検証した（台帳と根拠は `research.md`）。受け入れ基準は AC-1〜AC-30、ステップは 1〜20
- **Issue #2（PR #17）由来（SYNC-201〜244）** — Issue #14 のコメントで持ち込まれた spec-sync 候補。Issue コメントは 38 件と書くが、ID 単位でほどいた実数は **44 件**（台帳と根拠は `research-2.md`）。受け入れ基準は AC-31 以降、ステップは 22 以降（＋既存ステップへの統合分）

| 台帳 | 分類 | 件数 | ID |
| --- | --- | --- | --- |
| SYNC-01〜27 | まだ乖離あり（本 Issue で直す） | **21** | 01,02,03,04,05,06,07,09,10,11,12,14,15,16,17,18,19,20,22,25,26 |
| SYNC-01〜27 | 既に解消済み（何もしない） | **1** | 21 |
| SYNC-01〜27 | 乖離なし・記録のみで決着（**決着の 1 文を spec へ残す作業がある** — AC-11 / ステップ 4-3・7-3） | **1** | 13 |
| SYNC-01〜27 | スコープ外（実装変更を伴う） | **3** | 08,23,24 |
| SYNC-01〜27 | スコープ外（全域語彙の整合） | **1** | 27 |
| SYNC-201〜244 | まだ乖離あり（本 Issue で直す） | **38** | 201〜213,215〜220,222〜224,226〜230,233〜236,238〜244 |
| SYNC-201〜244 | 既に解消済み（何もしない） | **1** | 232 |
| SYNC-201〜244 | スコープ外（後続スライスの未実装 / 実装修正） | **4** | 214,221,231,237 |
| SYNC-201〜244 | SYNC-01〜27 と重複（二重計上しない） | **1** | 225（= SYNC-15） |
| **合計（重複を 1 件として数えた実数）** | | **70** | 要修正 **59** / スコープ外 **8** / 解消済み **2** / 乖離なし **1** |

`SYNC-244`（`IdentityErrorCode` union の `InvalidAvatarUrl` / `AccountDeletionRetryLimitExceeded`）は統合作業で採番した。`.thread/2/progress.md` の箇条書きに独立項目として現れず、`research.md` の SYNC-03 が「#2 由来」と脇に置いていたため、どちらの台帳にも行が無かった（`research-2.md` の I 群）。

SYNC-225 は `research.md` の SYNC-15 と同一項目なので、統合後も **AC-8 / ステップ 2 で決着させる**（受け入れ基準を新設しない）。SYNC-25 は調査中に見つかった同種・同一行の乖離（`NoteTitle` の上限超過時に throw する件）。SYNC-26 は P-40（トップ）のサインイン済み状態が spec 内部で矛盾している件（`spec/pages/index.md` の URL 表は「ノート一覧へのリダイレクト」、P-40 の状態行は「アプリへの導線を表示」）。SYNC-21 は `spec/testcases/identity/pruneExpiredAuthState.md` の該当行が既に「次 Cron で回復する」と書いており、実装テストと一致していたため受け入れ基準から外した。

**Issue #2（PR #17）のマージで SYNC-01〜27 のうち解消された項目は 0 件**。PR #17 が `spec/` に加えた変更は `spec/adr/*.md` の 30 ファイル追加のみで、`spec/domains/` `spec/usecases/` `spec/testcases/` `spec/inventory/` は 2026-08-09 の状態のまま。

## 受け入れ基準

| # | 基準（検証可能な形で） | 由来 | 対応ステップ |
|---|---|---|---|
| AC-1 | `spec/domains/note.md` の振る舞い表で、`createFromUpload` / `createBlank` の引数に `projectionRevision: number` が、`moveTo` の引数に `routeVersion: number` が現れている（SYNC-04 / ADR 027） | progress.md L61 | 1 |
| AC-2 | `spec/domains/note.md` の振る舞い表の `markConversionFailed` / `markAwaitingIntegration` の「処理」欄に、`visibility.status !== "private"` なら `BusinessRuleError(CannotPublishEmptyNote)` で拒否する旨が書かれ、不変条件節の「`content.status !== "ready"` のノートは公開・限定公開にできない」が双方向（公開中のノートは本文を降格できない）として読めるようになっている（SYNC-05） | progress.md L62 | 1 |
| AC-3 | `spec/domains/note.md` の不変条件節に、`Note.reconstruct` が ready 本文の必須列（`html` / `text` / `excerpt`）の欠落を空文字で補完せず拒否する旨が書かれている（SYNC-06） | progress.md L65 | 1 |
| AC-4 | `spec/domains/note.md` のポート節に、(a) `NoteRouteFanOutReader` が列挙する state（`active` / `moving` / `purging`、`reserved` のみ除外、`resolve` と異なる理由、`tombstone` は unspecified）と、(b) `NoteRepository.listByOwner` の順序（`updatedAt DESC, id DESC` と id タイブレークの理由）が書かれている（SYNC-07） | progress.md L64 | 1 |
| AC-5 | `spec/domains/note.md` の `NoteRouteStore` 節と `spec/domains/identity.md` の `UserBatchReader` 節に、`resolveMany` の上限（500 / 100）超過が `SystemError(DatabaseError)` になること（呼び出し側のプログラミングエラーであり並行状態の衝突ではない）が書かれている。`NOTE_ROUTE_BATCH_TOO_LARGE` が `spec/` にも `packages/` にも存在しない（SYNC-16） | progress.md L73 | 1, 2 |
| AC-6 | `spec/domains/note.md` の `NoteTitle` / `Excerpt` / `NoteHeading` の文字数制約に、単位が UTF-16 コード単位であること（切り詰めはサロゲートペアを割らない）が書かれ、`NoteTitle` の 200 文字超過が `BusinessRuleError(InvalidTitle)` になることが読める（SYNC-22 / SYNC-25 / ADR 033） | progress.md L79 + 調査 | 1 |
| AC-7 | `spec/domains/identity.md` の `IdentityErrorCode` union に `IdentityLimitExceeded` が含まれている（SYNC-03） | progress.md L60 | 2 |
| AC-8 | `spec/domains/identity.md` のポート節で `ConflictError("PROVIDER_ACCOUNT_ALREADY_LINKED")` が `IdentityUniqueDirectory` 側のエラーケースに置かれ、`IdentityRepository` 側からは外れている。`packages/core/src/domain/identity/ports/identityRepository.ts` の JSDoc も同じ形になっている（SYNC-15 / adr.md ADR-005） | progress.md L72 | 2, 8 |
| AC-9 | `spec/domains/index.md` の `AccountDeletionManifestStore` 節に、(a) `allRollbackReleased` の判定対象が membership item の release ack のみで `personalAbort` receipt を含まないこと、(b) finalize 側（`allRequiredAcknowledged`）と非対称である理由、(c) membership item の完全 ack は cleanup phase の ack を含む（prepare ack ＋ 宣言 receipt だけでは `allRequiredAcknowledged` にならない）ことの 3 点が書かれている（SYNC-14 / adr.md ADR-004） | progress.md L71 | 3 |
| AC-9b | `spec/usecases/identity.md` の rollback 手順で、**ポート述語の判定対象**（`allRollbackReleased` = release ack のみ）と**ユースケースの復帰ゲート**（personal barrier の abort ack を確認してから User を `active` へ戻す）が別物として読める。personal abort ack の確認は手順から落ちていない（SYNC-14 / adr.md ADR-004） | progress.md L71 | 4 |
| AC-10 | `spec/usecases/identity.md` の `verifyEmail` 出力 DTO 表で `sessionToken` の型が `string \| null` になっており、`alreadyVerified` 経路で `null` になることが表から読める（SYNC-12） | progress.md L69 | 4 |
| AC-11 | `spec/usecases/identity.md` の `verifyEmail` 手順 7 と `signInWithPassword` 手順 8 の **2 か所とも**に、セッション Cookie の期限を View の `expiresAt` ではなく `Session.ttlMs` から再導出する旨が書かれている（SYNC-13 / adr.md ADR-007） | progress.md L70 | 4 |
| AC-12 | `spec/testcases/identity/signUpWithPassword.md` の TC-identity-261 の期待結果が「利用者はちょうど 1 人・応答 shape は同一・decoy id は別値」になっている。`spec/usecases/identity.md` の `signUpWithPassword` エラーケース表では、`ConflictError("EMAIL_ALREADY_USED")` が**ユースケースの結果としては現れず**、`IdentityUniqueDirectory` のポート契約由来として既登録メールと同一の応答へ畳まれると読める（同ファイルの `AUTH_TOKEN_ALREADY_CONSUMED` 行と同じ様式 — 条件列にコード、種類列に畳み込み結果）（ADR 028）（SYNC-20） | progress.md L77 | 4, 7 |
| AC-13 | `spec/scenario/account.md` の AC-01 異常系から「確認前に再度サインアップ → 確認メールを再送」が消え、既存アカウント通知メールに統一されている（同ファイル内の自己矛盾が解消している）（SYNC-01） | progress.md L58 | 5 |
| AC-14 | `spec/scenario/account.md` の AC-01 #5 / AC-02 #2 に同一ブラウザー条件が付き、AC-02 異常系に「確認済み・サインインが必要」と「一時障害（再試行導線）」が加わっている（SYNC-02 / ADR 029） | progress.md L59 | 5 |
| AC-15 | `spec/pages/index.md` の P-03 の `**状態**` 行が実装の 7 状態（処理中 / 成功 / **確認済み・サインインが必要** / 使用済み / 期限切れ / 無効 / **一時障害**）の直和になっている（SYNC-02） | progress.md L59 | 6 |
| AC-16 | `spec/presentation/index.md` の CSRF 規約表から `FormData` を受ける場合という条件が消え、全 server function 呼び出しに同一オリジン検証を強制する（`createCsrfMiddleware`）規律になっている。`apps/web/app/start.ts` のコメントが存在しない AC-15 ではなく `spec/presentation/index.md` を参照している（SYNC-10 / ADR 029） | progress.md L67 | 7, 8 |
| AC-17 | `spec/presentation/index.md` のセキュリティヘッダー表に `Cache-Control: private, no-store` の行があり、Cookie 認証の応答を前段キャッシュに配らせないという理由が添えられている（SYNC-17） | progress.md L74 | 7 |
| AC-18 | `spec/domains/note.md` の `ShareTokenProtector` 節に `**エラーケース**: SystemError(DataIntegrityError)`（未知の keyVersion / ciphertext 破損）が書かれ、`packages/core/src/application/ports/shareTokenProtector.ts` の JSDoc から実在しない `ExternalServiceError` が消えている（SYNC-11） | progress.md L68 | 1, 8 |
| AC-19a | `spec/inventory/domain.md` / `adapter.md` / `test.md` / `frontend.md` の該当行が本文修正（ステップ 1〜7）に追随し、**4 ファイルそれぞれ**のヘッダーの「最終同期」日付が更新されている。**この範囲（SYNC-01〜27 の波及）では**新しい DOM / ADP / TC / PAGE ID は採番されていない（adr.md ADR-002）。**統合後は AC-55 / AC-56 が上書きする** — 対象は 5 ファイルになり、Issue #2 由来の新規ポートメソッド 8 本と新規ユースケース 3 本には採番する（adr.md ADR-011） | progress.md L66 + 各項目の波及 ＋ 統合作業 | 9〜12 |
| AC-19b | ラウンド4の適合ケース 8 本（`ADP-note-015` / `ADP-note-021` / `ADP-note-046` / `ADP-note-047` / `ADP-common-012` / `ADP-common-017` / `ADP-common-019` / `ADP-common-021`）の要点欄が、対応する describe 名の主張を読める内容になっている。本文修正を伴わない 2 本（`ADP-note-021` のエスケープ契約は `spec/domains/note.md` に既述、`ADP-common-012` の replayed begin）も対象に含む（SYNC-09） | progress.md L66 | 10 |
| AC-20 | `CLAUDE.md` に Cloudflare / AWS / GCP のエントリ・DI・`docs/runtime_*.md`・`migrate.*.ts`・`:cf`/`:aws`/`:gcp` スクリプト・`infra/*` ワークスペース・`components/todo/` / `routes/todo/` / `TodoBoard`・`serverAction` の `inputValidator` の記述が存在せず、実在するもの（Node ＋ memory 一本、二面 UoW、Identity / Note ほか 8 ドメイン、`adapters/conformance/`、`.validator()`、`spec/` と `spec/adr/`）が書かれている。下記「テスト方針」の**実在しない固有名 grep が 0 件**（SYNC-18） | progress.md L75 | 13 |
| AC-21 | `docs/backend_implementation_example.md` の File Layout と Adapter Layer 節が現行構成（`adapters/{memory,node,oauth,conformance}/`、`apps/web/app/presentation/`、二面 UoW）で書かれ、D1 / Drizzle / `serverCloudflare` への参照が残っていない（SYNC-19 / adr.md ADR-003） | progress.md L76 | 14 |
| AC-22 | `docs/frontend_implementation_example.md` の参照パス・識別子がすべて実在するもの（`routes/notes/index.tsx`、`components/note/*`、`components/settings/IdentityList/board.tsx` ほか）に差し替わっており、`grep -in "todo" docs/frontend_implementation_example.md` が 0 件（SYNC-19 / adr.md ADR-003） | progress.md L76 | 15 |
| AC-23 | スコープ外とした 4 件（SYNC-08 / SYNC-23 / SYNC-24 / SYNC-27）が**それぞれ独立した新規 Issue**として起票され、4 つの Issue 番号が本 Issue の完了コメントに列挙されている。各 Issue は現状・根拠（research.md の該当節）・選択肢とトレードオフを含む。**統合後の起票は AC-60 が追加分（新規 3 本 ＋ 既存 4 Issue へのコメント）を担う** | adr.md ADR-006 | 16 |
| AC-24 | `pnpm typecheck` / `pnpm lint:fix` / `pnpm format` / `pnpm test:unit` / `pnpm build` がすべて緑（JSDoc とコメントの変更が typecheck / lint を壊していないことを確認する）。**コード差分の範囲と件数は AC-63 が上書きする**（レビュー R2 の修正まで含めた実測は 35 ファイル） | 品質ゲート | 17 |
| AC-25 | `README.md` から実在しない記述（`/todo` ルート、Drizzle ORM、`infra/`、4 ランタイム、two-tier vitest、`:cf` / `:aws` / `:gcp`）が消え、`CLAUDE.md` と同じ現況（Node ＋ in-memory の単一参照ランタイム、`apps/*` と `packages/*` の 2 ワークスペース）を語っている。下記「テスト方針」の実在しない固有名 grep が `README.md` でも 0 件（SYNC-18 と同根） | 計画レビュー R1（coverage:P-002 / arch:S-007） | 19 |
| AC-26 | `spec/pages/index.md` の P-40 の `**状態**` 行が URL 表（`/` = サインイン済みはノート一覧へリダイレクト）および実装と整合し、`spec/inventory/frontend.md` の `PAGE-p40-001` / `PAGE-p40-004` の要点がそれに追随している。**L-02 の該当行（`**状態**: 通常 / サインイン済み` とヘッダーの導線）は触っていない**（SYNC-26。L-02 = SYNC-24 はスコープ外） | 計画レビュー R1（arch:P-009） | 6, 12 |
| AC-27 | `packages/core/src/domain/identity/errorCode.ts` 冒頭コメントから `IdentityLimitExceeded` を spec の記載漏れと呼ぶ記述が消えている（ステップ 2 で spec に足したため）。~~`InvalidAvatarUrl` に関する記述は残っている（Issue #2 由来）~~。**統合後、後半は AC-58 が上書きする** — SYNC-244 で `InvalidAvatarUrl` も spec の union に足すため冒頭コメントは全文削除になり、残す記述が無くなる。判定は AC-58 で行う | 計画レビュー R1（arch:P-007）＋ 統合作業 | 8 |
| AC-28 | `packages/core/src/application/ports/accountDeletionManifestStore.ts` の JSDoc が、finalize（item ack ＋ 宣言 receipt）と rollback（membership release ack のみ）を非対称に書き分けており、`spec/domains/index.md` の記述と一致している | 計画レビュー R1（arch:P-001） | 8 |
| AC-29 | 本 Issue で下した長寿命の設計判断が `spec/adr/052`〜`055` と `spec/adr/057` として存在し、`spec/adr/index.md` の一覧と前提依存マップに載っている。各 ADR は `spec/inventory/adapter.md` / `spec/domains/index.md` / `spec/domains/identity.md` / `spec/usecases/identity.md` / `spec/presentation/index.md` / `spec/manual-tests/account.md`（057）の該当箇所からリンクされている。**057 は計画レビュー R2（arch:S-001）で追加した**（`spec/manual-tests/` の追随ルール。adr.md ADR-010） | 計画レビュー R1（coverage:P-007）＋ R2（arch:S-001） | 2, 3, 4, 7, 10, 18, 20 |
| AC-30 | `spec/manual-tests/account.md` に、別のブラウザーで確認リンクを開いたときの手順（TC-42）があり、`### 観点チェックリスト` に登録されている。「一時障害」を対象外とした理由が同ファイルに 1 行残っている | 計画レビュー R1（arch:P-006） | 18 |

### Issue #2（PR #17）由来（AC-31 以降）

由来欄の SYNC ID は `research-2.md` の台帳を指す。

| # | 基準（検証可能な形で） | 由来 | 対応ステップ |
|---|---|---|---|
| AC-31 | `spec/domains/identity.md` のポート節で、`AuthTokenRepository` interface に `findPendingByUserAndPurpose(userId, purpose): Promise<PendingAuthToken \| null>`、`SignInOAuthClient` interface に `deriveCodeChallenge(codeVerifier: string): string`、`IdentityUniqueDirectory` interface に `beginRelease({ kind, normalizedKey, expectedUserId, operationId })` の 3 メソッドが現れている。あわせて `releasing` 状態と **4 メソッドの非対称**が説明段落から読める — `resolve`（merely reserved / releasing は `null`）/ `beginRelease`（reserved は no-op）/ `release`（reserved と releasing を落とす）/ **`reserve`（`releasing` 行は奪えず conflict を返す。奪えるのは失効した `reserved` のみ）** | SYNC-201, 202, 205 | 2 |
| AC-32 | `spec/domains/identity.md` の `IdentityErrorCode` union が実装（`packages/core/src/domain/identity/errorCode.ts`）の 14 コードと一致している（AC-7 の `IdentityLimitExceeded` に加えて `InvalidAvatarUrl` / `AccountDeletionRetryLimitExceeded`）。`grep -c` ではなくコード名の集合として一致すること | SYNC-244（＋ AC-7） | 2 |
| AC-33 | `spec/domains/identity.md` の `SignInOAuthClient` の `**エラーケース**:` 行から `SystemError(ExternalServiceError)` が消え、`SystemError(ExternalApiError)`（通信・応答不正）になっている。`ValidationError("OAUTH_CODE_INVALID")` は残っている | SYNC-222 | 2 |
| AC-34 | `spec/domains/index.md` の interface で、`ScopeCleanupAdmissionStore` に `describePersonalCleanup(operationId): Promise<PersonalCleanupProgress \| null>`、`AccountDeletionManifestStore` に `describe(operationId): Promise<AccountDeletionManifestHeader \| null>` が現れ、`pruneTerminal` の戻り値が `Readonly<{ operationIds: readonly string[]; nextCursor: string \| null }>` になっている（`removed: number` ではない） | SYNC-206, 208, 209 | 3 |
| AC-35 | `spec/domains/index.md` の `assertOwner` の記述（interface 近傍または `:124` の説明段落）に、**completed した barrier の所有権主張も拒否する**ことが書かれている。~~`packages/core/src/application/ports/scopeCleanupAdmissionStore.ts` の JSDoc の該当文にも `completed` が加わっている~~ → **JSDoc 側の判定は AC-58(a) に一本化する**（計画レビュー R2 coverage:S-003。AC-27 → AC-58 の整理と同じ） | SYNC-207（spec 側） | 3 |
| AC-36 | `spec/domains/index.md` の `acknowledgePersonalComponent` の引数型と `:124` の説明段落から **8 component 固定**の直書きが消え、「配備が宣言した集合」（`application/cleanup/participants.ts` が composition root から渡す）に置き換わっている。`acknowledgeReceipt` 側も同様に宣言集合になり、`personalAbort` が **rollback 側の receipt であって finalize の必須集合に入らない**ことが読める | SYNC-228, 229 | 3 |
| AC-37 | `spec/domains/index.md` の継続要求表で、(a) identity 系 3 kind（`accountDeletionManifestBuildContinued` / `accountDeletionDispatchContinued` / `accountDeletionManifestCompactContinued`）の payload に `cursor: string \| null` と `continuationKey: string` が載り、(b) `identity.userAuthResidueCleanupContinued` だけが `continuationKey` を持たない理由（カーソル無しで常に前へ進む）が書かれ、(c) `identity.personalCleanupHandoverContinued` の行（payload と唯一の購読者）が存在する | SYNC-216, 217, 236 | 3 |
| AC-38 | `spec/domains/index.md:121` の `DistributedOperationStore` の言及が 1 行のまま残り、**interface は新設されていない**（adr.md ADR-015）。**その言及に、`state` が `running` / `completed` / `rejected` の 3 値であり `preparing` / `committing` は manifest header 側の state である旨の但し書きが添えられている**（ステップ 3-9 の肯定側。計画レビュー R2 coverage:P-008）。`spec/database/index.md` の `distributed_operations.state` 欄に `running` / `completed` / `rejected` の 3 値が書かれ、`attempts` / `next_attempt_at` / `expires_at` の 3 行は**削除されていない** | SYNC-231（残の部分） | 3, 26 |
| AC-39 | `spec/domains/note.md` の `LocalNoteProjectionWriter` / `PublicNoteProjectionWriter` の両 interface に `redactAuthor(input: AuthorRedaction): Promise<boolean>` があり、「著者や workspace の一括行更新は提供しない」の説明段落との関係（redaction は退会既定値への置換で、行が無い / 別人 / 既に同世代以降はすべて no-op）が書かれている | SYNC-210 | 1 |
| AC-40 | `spec/domains/storage.md` の `ObjectStorage` interface が `put(key, body: Uint8Array, meta)` / `get(key): Promise<ObjectBody \| null>`（`ObjectBody = { bytes: Uint8Array; meta }`）/ `deleteMany` / `publicUrl(key): string` を持ち、ストリーム経路を落としたことが説明段落に引き継ぎとして残っている。**`createDownloadUrl` の行は削除されていない**（未実装であってスコープ外 — SYNC-203(3)） | SYNC-203(1)(2) | 22 |
| AC-41 | `spec/domains/storage.md` の `StorageErrorCode` union に `InvalidChecksum` が含まれ（実装の 8 コードと一致）、`UploadValidationPolicy.ensureAcceptable` の振る舞い表が引数 `{ purpose, body }` / 戻り値 `AcceptedUpload = { mimeType, size }` になっている。MIME を先頭バイトの署名で、サイズを実バイト長で決めることが「処理」欄から読める | SYNC-211, 240 | 22 |
| AC-42 | `spec/domains/usage.md` の `StorageQuota` 振る舞い表に `replaceTotals(quota, { consumedBytes, noteCount }, now)` の行があり、スキャン結果を差分ではなく正本として上書きする用途が「処理」欄から読める | SYNC-204 | 23 |
| AC-43 | `spec/usecases/identity.md` の OAuth 3 節が実装と一致している: (a) `startOAuthFlow` の出力 DTO 表に `state: string` の行、(b) 同エラーケース表に「非 active な主体の `linkIdentity` → `UnauthorizedError("UNAUTHENTICATED")`」の行と「未知のプロバイダー」行のコード名 `BusinessRuleError(InvalidProviderAccount)`（`InvalidProvider` ではない）、(c) `completeOAuthSignIn` / `linkOAuthIdentity` の両エラーケース表に `ConflictError("PROVIDER_ACCOUNT_RELEASE_PENDING")`、(d) **`completeOAuthCallback` の判別共用体の `linkIdentity` arm に `redirectTo`**（`linkOAuthIdentity` の出力 DTO は `identityId` の 1 行のまま。実装 `application/identity/view.ts:90-93,166-168` に合わせる — 計画レビュー R2 arch:P-002） | SYNC-243, 219, 223, 226, 218 | 4 |
| AC-44 | `spec/usecases/identity.md` に `getProfile` / `checkHandleAvailability`（`updateProfile` の直後）と `completeOAuthCallback`（`completeOAuthSignIn` と `linkOAuthIdentity` のあいだ）の 3 節が既存様式（目的 / 入出力 DTO / 処理フロー / エラーケース表）で存在する。`completeOAuthCallback` の節は flow state の `intent` だけで分岐すること（`spec/adr/035`）と、返り値が intent 付き判別共用体であることを書いている | SYNC-238, 239 | 4 |
| AC-45 | `spec/usecases/identity.md` の `requestPasswordReset` の処理フローに **60 秒の発行間隔**（`findPendingByUserAndPurpose` で測る）が書かれている。`addPasswordIdentity` の処理フローに**再認証（Google 再認可）の手順**があり、エラーケース表に `NotFoundError("USER_NOT_FOUND")` / `ValidationError("ACCOUNT_UNAVAILABLE")` の 2 行がある。`spec/scenario/account.md:127` / `spec/pages/index.md#P-22` / `spec/manual-tests/account.md` と矛盾しない。**`spec/testcases/identity/requestPasswordReset.md` に発行間隔の境界 2 行（直近 59 秒以内 / 直近 61 秒前）があり、`resendVerificationEmail.md` の既存 2 行と同じ粒度になっている**（計画レビュー R2 coverage:S-001） | SYNC-220, 221（spec 側のみ）, 201（テストケース表） | 4, 32 |
| AC-46 | `spec/usecases/identity.md` の (a) `:27` 付近の sub-operation ID の導出が `sha256(...)` ではなく `` `${parentOperationId}:${kind}:${normalizedKey}` `` の合成になり、この ID をログへ出さない旨（`spec/adr/048`）が添えられている、(b) `deleteAccount` の手順で `distributed_operations` の state が `running` / manifest header の state が `preparing` / `committing` と書き分けられている、(c) finalize の必須 receipt 集合が宣言集合として書かれている | SYNC-224, 231(a), 229(:669) | 4 |
| AC-47 | `spec/usecases/storage.md` の `storeAvatar` 入力 DTO から `declaredMimeType` / `size` が消え（`spec/adr/050`）、`deleteFilesByOwner` の出力 DTO が `ScopeCleanupTurn & { deletedCount: number }`（`status` を含む）になっている。`batchSize` の説明段落から「3 文」の内訳が消え、リンクが実在する `spec/platform/index.md` の `### Scope DO` を指している（`#クエリ予算` は存在しない見出し） | SYNC-212, 215, 227, 240（付随） | 24 |
| AC-48 | `spec/usecases/usage.md` の `recalculateStorageUsage` 入力 DTO に実行者 `userId` があり、主体ではなく実行者であること（`assertActorWritable` が要求する）が読める。`deleteQuota` の「出力 DTO: なし」が `ScopeCleanupTurn`（`status` と `personalCleanupCompleted`）になっている。**`getUsageSnapshot` の workspace ページング（入力 `workspaceCursor` / `workspaceLimit`、出力 `workspaces` / `nextWorkspaceCursor`、手順 2・3）は削られていない**（SYNC-214 はスコープ外） | SYNC-213, 215 | 25 |
| AC-49 | `spec/database/index.md` の 4 点が実装と一致している: (a) `identity_unique_reservations` 節の予約 operation ID が合成導出、(b) `applied_operations` の `kind='accountDeletionBarrier'` 説明が宣言集合（8 固定ではない）、(c) `account_deletion_manifests` の 8 件 / 120 日の計数が `distributed_operations` 側の観測（`countTerminalSince`）であること、(d) `applied_operations` が 2 ポート（`ScopeCleanupAdmissionStore` / `AppliedOperationStore`）に分かれ、`result` 列が「値を返すコマンドを足すスライスが使う」列として位置づけられていること | SYNC-224, 228, 230, 233 | 26 |
| AC-50 | `spec/presentation/index.md` の `AppConfig` 節に、削除 status ticket の署名鍵は `AppConfig` に載せず composition root が供給する（`spec/adr/047`）という例外が、`:23` の「秘密と鍵は本文書の `AppConfig` に置く」に対する明示的な但し書きとして書かれている。エラー → ステータス表に `PROVIDER_ACCOUNT_RELEASE_PENDING` が載っている | SYNC-234, 226（波及） | 7 |
| AC-51 | `spec/pages/index.md` の P-25 に、**この 1 画面だけが認証ガードの明示的な例外**であること（受理と同時にセッションが消えるため。読み取り権限は status ticket が持ち、セッションが無い状態では他の導線を描かない — `spec/adr/047`）が書かれている。**P-25 の「削除されるもの / されないもの」の機能行は狭められていない**（SYNC-237 はスコープ外） | SYNC-235 | 6 |
| AC-52 | `spec/testcases/identity/startOAuthFlow.md` の TC-identity-268 の期待結果が `BusinessRuleError(InvalidProviderAccount)` になっている。**identity 側 3 か所**（同ファイル / `spec/usecases/identity.md` のエラー表 / `spec/inventory/test.md` の TC-identity-268 行）に `InvalidProvider` が 0 件（下記「テスト方針」の grep）。4 列目（実装ステータス）は空のまま。**integration 側 3 か所**（`spec/usecases/integration.md:37` / `spec/testcases/integration/startIntegrationOAuth.md:7` / `spec/inventory/test.md` の TC-integration-170 行）は**本 Issue では触らない** — `IntegrationErrorCode` union にも `InvalidProvider` は無いが、未実装ドメインなので SYNC-27 と同じ扱いでステップ 16-4 の Issue に相乗りさせる（計画レビュー R2 coverage:P-001） | SYNC-223 | 27 |
| AC-53 | `spec/testcases/storage/deleteFilesByOwner.md` の TC-storage-043 の期待結果から**文の数が消え**、「列挙は 1 回 / `storage.fileDeleted` は削除できたファイル 1 件につき 1 件 / いずれも件数に比例した追加の往復を要求しない」という観測可能な性質になっている。文の数（列挙 1 ＋ 多行 DELETE 1 ＋ 多行 outbox INSERT 1）は `spec/platform/index.md` の `### Scope DO` の表の直後の段落に、上限ではなく設計目標として移っている（adr.md ADR-014） | SYNC-227 | 28, 29 |
| AC-54 | `spec/manual-tests/account.md` の TC-26 の手順が「開いて新しいパスワードを送信する」／期待結果が「送信が拒否され、リンクが無効である旨と再申請への導線が出る」になっている（GET は状態を変えない）。TC-13 手順 2 の期待結果が「解除を受理した旨が表示される」（件数表示ではない）になっている | SYNC-241, 242 | 18 |
| AC-55 | `spec/inventory/{domain,adapter,usecase}.md` に新規 **22 行**（`DOM-common-041,042` / `DOM-identity-060〜065` / `DOM-note-071,072` / `DOM-storage-038` の **11 行** ＋ `ADP-common-040,041` / `ADP-identity-039〜041` / `ADP-note-055,056` / `ADP-storage-024` の **8 行** ＋ `UC-identity-022〜024` の **3 行**）が**各群の末尾に**追加され、**既存 ID の指す要素が 1 つも変わっていない**（adr.md ADR-011）。**件数は実測が正**（レビュー R1 で `DOM-identity-063` = `AccountDeletionRetryPolicy` が、R2 で `DOM-identity-064` = `AvatarUrl` / `065` = `SameOriginPolicy` が加わり、当初の 19 行から増えた。列挙に無い行が出たら逸脱、ではなく**実測と列挙が一致するか**で見る）。検査は ID 集合の差分で行う — 各ファイルについて `origin/main` との ID 集合の差が上の 22 行と一致し、**消えた ID が 0 件**であること。`StorageQuota.replaceTotals` と `UploadValidationPolicy.ensureAcceptable` には新規行を作っていない（`DOM-usage-006` / `DOM-storage-012` の要点更新のみ）。**`AppliedOperationStore.markApplied` にも新規行を作らない**（interface を新設しないため。adr.md ADR-015 の追補 — AC-66）。**新設テストケースの TC 行は AC-64 が担当する**（同じ「群の末尾に採番」規則。adr.md ADR-016） | ADR-011 | 9, 10, 31 |
| AC-56 | `spec/inventory/usecase.md` の `UC-identity-005/006/007` / **`UC-identity-011`（60 秒の発行間隔を `findPendingByUserAndPurpose` で測る）** / **`UC-identity-013`（再認証を求める）** / `UC-storage-004,013` / `UC-usage-005,007` の要点欄が、ステップ 4 / 24 / 25 の本文改訂に追随している（`UC-identity-011` / `013` は計画レビュー R2 coverage:P-005 で追加）。ヘッダーの「最終同期」日付が更新されている（**統合により inventory の対象は 4 ファイル → 5 ファイルに増える**。AC-19a の「4 ファイル」を上書きする） | SYNC-212,213,215,218,219,226,243 の波及 | 31 |
| AC-57 | `spec/inventory/{domain,adapter,test,frontend}.md` の既存行が Issue #2 由来の本文改訂に追随している（`DOM-storage-032〜035` / **`DOM-storage-006`** / `DOM-usage-006` / `DOM-storage-012` / **`ADP-common-008`** / **`ADP-common-025`** / **`ADP-storage-018〜021`** / `TC-identity-268` / `TC-storage-043` / `PAGE-p21-001,002` / `PAGE-p25-001,003`）。**ADP 行 4 群はステップ 10 の統合分**（計画レビュー R2 coverage:P-006 — AC-57 が `spec/inventory/adapter.md` を対象に挙げながら ADP ID を 1 つも列挙していなかった）。**`PAGE-p25` の participant 文言は狭めていない**（SYNC-237） | SYNC-203,204,211,223,227,235,238,240 の波及 | 9, 10, 11, 12 |
| AC-58 | コード側の 3 ファイルが spec と一致している: (a) `packages/core/src/application/ports/scopeCleanupAdmissionStore.ts` の JSDoc が `assertOwner` の拒否条件に completed を含む、(b) `packages/core/src/domain/identity/errorCode.ts` の冒頭コメントが**全文削除**されている（`IdentityLimitExceeded` も `InvalidAvatarUrl` も spec の union に入るため。AC-27 の後半を上書き）、(c) `packages/core/src/domain/storage/errorCode.ts` の冒頭コメント（`InvalidChecksum` を spec の記載漏れと呼ぶ 2 行）が削除されている | SYNC-207, 244, 211 | 8 |
| AC-59 | `packages/core/src/adapters/conformance/scopeCleanupAdmissionStore.ts` の `ADP-common-008` のケースに「completed した barrier への `assertOwner` は `ConflictError`」の主張が 1 つ足され、`pnpm test:unit` が緑（memory アダプターは既にこの振る舞いを持つので実装変更は発生しない）。**適合スイートへの追加はこの 1 ケースだけ**（adr.md ADR-012） | SYNC-207 | 30 |
| AC-60 | Issue #2 由来のスコープ外 7 件（**新規 Issue 3 本 ＋ 既存 Issue 4 件へのコメント**）と、**レビューの修正ラウンドで見つかった新規 5 本**（下記スコープ節の 12〜16。**16 は R2 の V9 / M-70 で追加**）について起票・コメントが済み、**12 の参照**（Issue 番号 / コメント URL）が本 Issue の完了コメントに列挙されている（下記スコープ節の一覧と 1 対 1）。**5. の起票は必須**（R1 の `usecase:B-004` を defer した唯一の受け皿）。6. / 7. / 9. に足した相乗り 3 件は、親項目の Issue 本文 / コメントに含まれていればよく、独立した参照を要求しない | ADR-013 / ADR-014 / ADR-015 / レビュー R1 トリアージ M-06 / R2 トリアージ M-70 | 16 |
| AC-61 | `spec/adr/056-performance-budget-placement.md` が存在し（adr.md ADR-014）、`spec/adr/index.md` の一覧と前提依存マップに載っている。**056 が `spec/usecases/storage.md`（`batchSize` 段落）/ `spec/testcases/storage/deleteFilesByOwner.md` / `spec/platform/index.md`（`### Scope DO` の新設段落）の 3 か所からリンクされている**（計画レビュー R2 coverage:S-005 / arch:S-002 — 052〜055 と粒度をそろえる）。`spec/adr/052-adapter-inventory-granularity.md` の本文に、**適合ケースは採番せず新規ポートメソッドは通常どおり採番する**という切り分けと「ID は行位置ではない」、**および TC ID も同じ規則で群の末尾に採番する**ことが 1 段落として書かれている（adr.md ADR-011 ＋ ADR-016）。AC-29 の 052〜055 / 057 と合わせて `ls spec/adr/05[2-7]-*.md` が **6 ファイル**を返す | ADR-011 / ADR-014 / ADR-016 | 10, 18, 20, 28, 29 |
| AC-62 | スコープ外に置いた 4 件について spec が狭められていないことを確認できる: `grep -n "createDownloadUrl" spec/domains/storage.md` が 1 件以上、`grep -n "workspaceCursor\|nextWorkspaceCursor" spec/usecases/usage.md` が 1 件以上、`grep -n "next_attempt_at" spec/database/index.md` が 1 件以上、`spec/pages/index.md` の P-25 機能行に「削除されるもの / されないもの」が残っている | SYNC-203(3), 214, 231, 237 | 17 |
| AC-63 | `git diff --name-status $(git merge-base origin/main HEAD) -- packages/ apps/`（**コミット済みと未コミットの両方を含む最終差分**）が **35 ファイル = 変更 32 / 削除 3 / 追加 0** で、下記「コード差分の内訳」の集合と 1 対 1 で一致している。**振る舞いを変える差分は 0** で、それは機械検査で示せる — `git diff -U0` の追加・削除行から**コメント / JSDoc 行**と **`describe` / `it` の第 1 引数**を除いた残りを数える（コマンドの実体は steps.md ステップ 17-3。表のセルに入れるとパイプのエスケープでコピーできなくなるので置かない）。残りが **14 行**だけで、その内訳は (a) 適合スイート `ADP-common-008` ケースへの追加アサーション **9 行**（区切りの空行 1 を含む。ステップ 30 / AC-59。memory 実装が既に満たす）、(b) `containerStore.ts` のエラーメッセージ文字列 **3 行**（ADR-024。投げる条件も型も変えない）、(c) **削除したコメントブロックに続いていた空行 2 行**（`__tests__/{getProfile,checkHandleAvailability}.test.ts`。R2 の V8 / M-67 がコメントを全文削除した際の余白で、フィルタがコメント行だけを落として空行が残る）に限られる。**それ以外の追加・削除行はすべてコメント / JSDoc 行か `describe` / `it` の第 1 引数文字列**。削除 3 本は他ランタイム用の `.env*.example` で、これらを読むコードは 0 件（レビュー R1 M-46 で実測）。**AC-24 / ステップ 17-3 の件数を上書きする** | ADR-012, ADR-024, レビュー R1 トリアージ M-61 / R2 トリアージ M-80 | 17, 30 |

### 計画レビュー R2 で追加した基準（AC-64 以降）

| # | 基準（検証可能な形で） | 由来 | 対応ステップ |
|---|---|---|---|
| AC-64 | 新設 3 ユースケースに対応する `spec/testcases/identity/{getProfile,checkHandleAvailability,completeOAuthCallback}.md` が既存様式（`前提条件 / 操作 / 期待結果 / 実装ステータス` の 4 列、4 列目は空）で存在し、`ls spec/testcases/identity/*.md \| wc -l` が **24**、`grep -c "^\| UC-identity-" spec/inventory/usecase.md` が **24** になっている（「1 ユースケース = 1 テストケースファイル = 1 UC 行」が identity でも保たれる）。対応する TC 行は `spec/inventory/test.md` の **identity 群の末尾**に `TC-identity-305` 以降で採番され、**既存 TC ID の指す要素が 1 つも変わっていない**（`TC-identity-024` は `completeOAuthSignIn` の 1 件目、`TC-identity-304` は `verifyEmail` の並行消費のまま）。**採番対象は新設 3 ファイルの行に閉じない**（同じ末尾採番規則が既存ファイルへの追加にも掛かる。既存ブロック `TC-identity-187`〜`193` の中に挿入しない — adr.md ADR-016 の決定 4。計画レビュー R3 coverage:S-002）。**実測は `TC-identity-305`〜`335` の 31 行 ＋ `TC-usage-073` の 1 行 = 32 行**で、内訳は `getProfile` 6（`305`〜`309`, `329`）/ `checkHandleAvailability` 8（`310`〜`315`, `326`, `327`）/ `completeOAuthCallback` 6（`316`〜`320`, `328`）/ `requestPasswordReset` 2（`321`, `322`）/ `addPasswordIdentity` 3（`323`〜`325`。R1 の M-05）/ `completeOAuthSignIn` 1（`330`。R2 の M-64）/ `linkOAuthIdentity` 1（`331`。同）/ `updateProfile` 4（`332`〜`335`。R2 の M-87）/ `recalculateStorageUsage` 1（`TC-usage-073`。R2 の M-65）。**列挙に無い行が出たら逸脱、ではなく実測と列挙が一致するかで見る**（AC-55 と同じ）。**`spec/inventory/test.md` のヘッダーに TC 採番規則の 1 行がある**（`spec/inventory/adapter.md` だけに書く非対称を作らない — 計画レビュー R3 arch:S-001）。**採番起点の実測**: `grep -oE "TC-identity-[0-9]+" spec/inventory/test.md \| sort -u \| tail -1` = `TC-identity-304`、`grep -c "^\| TC-identity-" spec/inventory/test.md` = **304** — identity 群は 001〜304 が連番で埋まっているので `TC-identity-305` 起点は穴を空けない | 計画レビュー R2（arch:P-001）/ R3（coverage:S-002 / arch:S-001）/ adr.md ADR-016 | 11, 31, 32 |
| AC-65 | `spec/usecases/storage.md` が改訂後の `spec/domains/storage.md` と矛盾しない。**適用範囲は「受理判定の時点で実体を握る」呼び出しだけ**（`spec/adr/050` の前提）: (a) `ensureAcceptable` の呼び出しのうち **`storeUpload`（`:90`）/ `storeMedia`（`:145`）/ `storeAvatar`（`:176`）の 3 か所**から宣言値の引数が消えている（`grep -cF 'ensureAcceptable({ purpose: "source", mimeType, size })' spec/usecases/storage.md` が **0**。修正前の実測は 1。`:90` は `:145` / `:176` と同じ `{ purpose: "source", ... }` の省略記法にそろえる — ステップ 24-4）、(a2) **`startBulkUpload` 手順 3（`:38`）の一般記述は据え置かれている**（このユースケースはバイト列を持たず、`spec/adr/050` の前提『受理判定の時点で実体を握っていること』が成立しない。`spec/adr/046` の「実装が未実装の側で spec を狭めない」— 計画レビュー R3 arch:P-001）、(b) `grep -c "declaredMimeType" spec/usecases/storage.md` が **1**（残るのは `startBulkUpload` の `files` 列 `:22` のみ。`storeUpload` の `:74` / `storeMedia` の `:136` / `storeAvatar` の `:167` が落ちている。修正前の実測は 4）、(b2) **`size` も同じ 3 か所でだけ落ち、`startBulkUpload` の `files[].size` は残っている**（手順 1 の「合計サイズが 500 MB を超えれば `UPLOAD_TOO_LARGE`」と手順 5 の暫定判定の根拠。計画レビュー R3 arch:S-002）、(c) `storeUpload` 手順 5 の「宣言サイズと実サイズが食い違う場合は実サイズを採用する」が消えている、(d) **`storeUpload` 入力 DTO の `body: ReadableStream<Uint8Array>` は削られていない**（ステップ 22 の引き継ぎ段落がここを「ポートを再び広げる要求元」として名指しする。ステップ 24-4 が `:90` を省略記法に留めるのはこの (d) と矛盾しないため） | 計画レビュー R2（arch:P-003）＋ R3（arch:P-001 / P-002 / S-002） | 22, 24 |
| AC-66 | `AppliedOperationStore` の名前が `spec/` の中で定義を持つ: `spec/domains/index.md` の `ScopeKey と永続化境界` 節の箇条書きに `DistributedOperationStore` と**同じ粒度の 1 行言及**があり（interface は新設しない）、`spec/database/index.md` の `applied_operations` の記述はその言及と同じ名前を使っている。`grep -c "AppliedOperationStore" spec/domains/index.md` が 1 以上。**inventory 行は採番しない**（adr.md ADR-015 の追補） | 計画レビュー R2（arch:P-008） | 3, 26 |
| AC-67 | `spec/usecases/identity.md` の `removeIdentity` 手順 3 の operation ID が `sha256("removeIdentity:" + identityId)` ではなく合成 `` `removeIdentity:${identityId}` `` になっている（実装 `application/identity/removeIdentity.ts:20-30` が spec を名指しで否定している状態を解消する）。`grep -rn 'sha256("removeIdentity' spec/` が 0 件 | 計画レビュー R2（coverage:P-004）/ SYNC-224(c) | 4 |
| AC-68 | `steps.md`「実行順」の表が本文の順序制約と一致している: **F0（ステップ 20 の採番確定）が A より前**にあり、A の**内部順 5 組**（`3 → 4 → 26` / `29 → 24` / `27` が `InvalidProviderAccount` の文面の基準 / `22 → 24` / **`4 → 32`**）が表に書かれ、直後の「これ以外」の列挙（`1, 2, 5, 6, 7, 23, 25, 28`）から**内部順を持つステップが除かれている**（`4 → 32` は計画レビュー R3 arch:P-003 で追加 — ステップ 32 の本文が「ステップ 4 の後に実行する」と宣言しているのに表では制約なしの側に列挙されていた）。`grep -rn "adr/05[2-7]-" spec/` の参照先ファイルがすべて実在する（ステップ 17-9） | 計画レビュー R2（arch:P-006 / arch:P-007）＋ R3（arch:P-003） | 17, 20 |
| AC-69 | `spec/adr/057-manual-test-followthrough.md` が存在し（adr.md ADR-010 の昇格）、`spec/adr/index.md` の一覧と前提依存マップに載り、`spec/manual-tests/account.md` の TC-42 からリンクされている。本文は「`spec/manual-tests/` は scenario の下流成果物として追随させ、追随の要否は表の軸（usecase エラーケース / テスト観点）で決める」を決定として書いている | 計画レビュー R2（arch:S-001） | 18, 20 |

## スコープ

### Issue #2（PR #17）由来の統合（完了。本 Issue のスコープ内）

Issue #14 のコメントで持ち込まれた分（`.thread/2/progress.md` の「spec-sync 候補」節が出典）。台帳は `research-2.md` の **SYNC-201〜244**（44 件）。受け入れ基準は **AC-31〜AC-63**（計画レビュー R2 で **AC-64〜AC-69** を追加）、ステップは **22〜31** ＋ 既存ステップへの統合分（計画レビュー R2 で **32** を追加）。

**既存ステップへ統合した項目**（同一ファイルを 2 ステップが触ると編集が競合するため、既存ステップ番号を維持したまま変更内容を足した）。

| 既存ステップ | ファイル | 追加した台帳 ID |
| --- | --- | --- |
| 1 | `spec/domains/note.md` | SYNC-210 |
| 2 | `spec/domains/identity.md` | SYNC-201, 202, 205, 222, 244（SYNC-225 は SYNC-15 と重複なので二重計上しない） |
| 3 | `spec/domains/index.md` | SYNC-206, 207, 208, 209, 216, 217, 228, 229, 231(a), 236 |
| 4 | `spec/usecases/identity.md` | SYNC-218, 219, 220, 221(spec 側), 223(エラー表), 224(a), 226, 229(:669), 231(a), 238, 239, 243 |
| 6 | `spec/pages/index.md` | SYNC-235 |
| 7 | `spec/presentation/index.md` | SYNC-226(波及), 234 |
| 8 | コード JSDoc / コメント | SYNC-207, 211, 244（対象ファイルが 5 → 7 に増える） |
| 9〜12 | `spec/inventory/{domain,adapter,test,frontend}.md` | 新規 16 行の採番 ＋ 既存行の追随 |
| 18 | `spec/manual-tests/account.md` | SYNC-241, 242 |
| 20 | `spec/adr/` | ADR-011 ＋ ADR-016（TC 採番）を 052 の本文に、ADR-014 を 056 として、**ADR-010 を 057 として**追加（057 は計画レビュー R2 arch:S-001） |

**新設したステップ**: 22（`spec/domains/storage.md`）/ 23（`spec/domains/usage.md`）/ 24（`spec/usecases/storage.md`）/ 25（`spec/usecases/usage.md`）/ 26（`spec/database/index.md`）/ 27（`spec/testcases/identity/startOAuthFlow.md`）/ 28（`spec/testcases/storage/deleteFilesByOwner.md`）/ 29（`spec/platform/index.md`）/ 30（適合スイート 1 ケース）/ 31（`spec/inventory/usecase.md`）/ **32（`spec/testcases/identity/` の新設 3 ファイル ＋ `requestPasswordReset.md` の境界 2 行。計画レビュー R2 arch:P-001 / coverage:S-001）**。**21 は欠番**。

### Phase 5 で起票するもの（spec が正 = 実装修正が必要／裏づけが取れない）

**spec 本文は触らない**（実装の縮退を spec へ書き写さない — `spec/adr/046`）。ステップ 16 で起票し、参照を本 Issue の完了コメントに列挙する（AC-23 / AC-60）。**合計: 新規 Issue 12 本 ＋ 既存 Issue へのコメント 4 件**（1〜4 / 5〜7 / 12〜16 が新規、8〜11 がコメント）。6. / 7. / 9. の配下の箇条書きは**親項目に相乗りさせる論点**で、独立した Issue にはしない。

SYNC-01〜27 由来（既存 4 本。すべて新規 Issue）:

1. `Note.reconstruct` の visibility × content 交差検査をどう扱うか（SYNC-08）
2. フォーカスリングが accent 背景で判別できない（SYNC-23）
3. L-02 のサインイン済み状態が実装されていない（SYNC-24）
4. `ExternalServiceError` の全域語彙整合（SYNC-27）

Issue #2 由来（新規 3 本 ＋ 既存 Issue へのコメント 4 件）:

5. **新規（起票必須）** — `addPasswordIdentity` に Google 再認可（再認証）を実装する（SYNC-221）。**本 Issue では spec の内部矛盾解消のみ。実装は本 Issue のスコープ外**（adr.md ADR-013）。**レビュー R1 の `usecase:B-004`（triage M-06）を defer した唯一の受け皿がこの Issue なので、起票を落とすと `ValidationError("REAUTHENTICATION_REQUIRED")`（adr.md ADR-022 で新設した語彙）が実装に到達しないまま追跡先を失う。** 骨子: 「`spec/scenario/account.md` の AC-06 / P-22 の『再認証要求』状態 / manual TC-07 が求める Google 再認可を `addPasswordIdentity` が行っていない。`startOAuthFlow` の intent と再認証状態の保持（`spec/adr/034` / `035` の束縛）に触れるため、OAuth 往復を含む実装スライスとして起票する」
6. **新規** — `distributed_operations` の `attempts` / `next_attempt_at` / `expires_at` と recovery Cron を実装し、あわせて **`spec/` に定義も inventory 行も持たない 5 ポート**（`DistributedOperationStore` / `AppliedOperationStore` / `IdentityRemovalReceiptStore` / `OutboxRepository` / `ScopeTaskScheduler`）の interface を `spec/domains/index.md` に新設し、`spec/inventory/{domain,adapter}.md` に行を採番し、適合スイートの `describe` / `it` 名に ADP ID を付ける（SYNC-231。adr.md ADR-015 / ADR-016）
   - ~~**相乗りさせる 2 件**（ステップ 17 の最終確認で検出。コード差分 9 ファイルの枠を超えるため本 Issue では直さない）~~ → **この 2 件は本 Issue で閉じた**（レビュー R1 M-11 / U8）。`accountDeletionManifestStore.ts` の `ADP-common-012` → `041` も `objectStorage.ts` のヘッダーコメントの `ADP-storage-024` も反映済み。本 PR の採番が作った **ID の衝突**を残したままマージするのは順序が逆、という判断で枠を広げた（AC-63 を実測へ改めた分に含む）。この Issue が引き続き担うのは、**そもそも ADP ID を持たない 5 ポート**（下記リスク節）への採番だけ
   - **（レビュー R1 / U8 で追加）適合スイート全体への ADP ID 網羅を規約化するかもここで決める。** U8 が付け替えたのは本 PR の採番が壊した分だけで、**無印のケースは既存スイートに広く残っている**（`adapters/conformance/` の他ファイルにも）。[ADR 026](../adr/026-port-contract-and-conformance.md) / [ADR 052](../adr/052-adapter-inventory-granularity.md) を「全ケースが ADP ID を名乗る」まで強めるのか、「台帳に行を持つメソッドを拘束するケースだけが名乗る」に留めるのかは、5 ポートの採番と同じ判断面にある。**1 ケースが複数メソッドを拘束するときの連記は本 Issue で決着済み**（adr.md ADR-029）なので、残るのは網羅の要否だけ
7. **新規** — P-25 の「削除されるもの / されないもの」と完了文言を participant 完備の形へ戻す（SYNC-237）。受け皿が複数スライス（#3 / #4 / #5 / #7）に跨るため 1 本にまとめ、各スライスが自分の participant を足した時点で該当行を戻す
   - **（レビュー R1 / U5 で追加）同じ Issue に `rejected` の表示を含める。** `spec/presentation/index.md` は P-25 の `rejected` を「事前条件の不成立で、UI は解消方法を示す」と定めるが、実装 `DeleteAccountPanel/index.tsx` は `rejected` を `settled`（「削除を完了できませんでした」）の終端表示へ畳んでおり、解消方法を示さない。**spec が正で実装が追随すべき側**なので spec には書き写さず（`spec/adr/046`）、実装側の課題として残した。受け皿が同じ 1 画面・同じコンポーネントなので、participant 完備の作業と同じ Issue で扱う
8. **既存 Issue #6 へコメント** — `ObjectStorage.createDownloadUrl` が未実装（SYNC-203(3)）。`issueDownloadUrl` / `exportNote` を持つスライスが実装で追いつく
9. **既存 Issue #3 へコメント** — `getUsageSnapshot` の workspace ページングが `never[]` に縮退している（SYNC-214）
   - **（レビュー R1 / U1 で追加）同じコメントに 2 件足す。** (a) `recalculateStorageUsage` の workspace 主体は membership 検査を通らない（`recalculateStorageUsage.ts:40-46` は `subjectType === "user"` のときだけ実行者一致を検査する）。同じスライスの `storeAvatar.ts:71` は同じ状況を fail-closed で扱っており縮退の向きが逆。U1（M-28）は spec 側から「未実施」という実装ステータスの追認を落とし、検査の担い手（`WorkspaceAuthorization`）だけを正典として書いたので、**追跡はこのコメントが唯一の受け皿**。(b) `application/usage/recalculateStorageUsage.ts` の JSDoc 末尾（"Workspace membership itself stays unchecked until `WorkspaceAuthorization` exists."）が実装の縮退を述べたまま残っている。**adr.md ADR-030 と同じ形の記述だが、こちらは spec が正・実装が未実装の側なので本 Issue では直さない**（直すには workspace 認可の実装が要る）
10. **既存 Issue #18 へコメント** — `requestPasswordReset` の `passwordResetUnavailable` 分岐が送信間隔を通らない（SYNC-220 付随）
11. **既存 Issue #11 へコメント** — TC-storage-043 から移した「3 文」の設計目標を D1 実装で再検証する（SYNC-227 付随。adr.md ADR-014）

レビュー R1 の修正ラウンドで新たに見つかった分（**新規 4 本**。上の 1〜11 とは重複しない）:

12. **新規** — `spec/adr/048-uniqueness-reservation-operation-id.md` の前提節が陳腐化した（U7 が発見）。同 ADR は「設計文書上の表記はハッシュだが、導出するのは application 層である」という前提で書かれているが、本 PR が `spec/database/index.md` / `spec/usecases/identity.md` を**合成式**へ改訂した（AC-46 / AC-49 / AC-67）ので、その前提は偽になった。骨子: 「ADR 048 の前提節を『設計文書も実装も合成式である』へ改め、決定の本文（ハッシュを採らない理由 / この ID をログへ出さない制約）が前提の変化に耐えるかを確認する。`spec/adr/index.md` の前提依存マップで 048 に掛かる ADR も同時に見る」。**本 Issue で直さない理由**: `spec/adr/` の改訂はステップ 20 で 052〜057 の新設に限る取り決めで、既存 ADR の本文改訂は前提依存マップ全体の再確認を伴う
13. **新規** — リポジトリ設定ファイルに残る、実在しないファイルの規則（U9 が発見。M-46 の残り）。骨子: 「(a) `.gitignore:14-17` が `scripts/render-wrangler.ts` によって生成されると説明したうえで `wrangler.staging.toml` / `wrangler.production.toml` を無視しているが、その 3 ファイルはいずれも実在しない（`.wrangler/` の 1 行も同様）。(b) リポジトリに `Dockerfile` が 1 本も無いのに `.dockerignore` だけが残っている — 本 PR は失効した規則の行だけを落としたが、**ファイルごと削除するか**は別の判断（コンテナ配備を将来やる想定があるか）なので手を付けていない」。[ADR 025](../adr/025-single-reference-runtime.md) の「1 つを選んで他は消す」に対して現物が残っている同じ面で、本 PR が閉じたのは `apps/web/.env*.example` 3 本と `.dockerignore` の 3 行（他ランタイム用の 2 行 ＋ 対象を失った `!.env.*.example`）まで
14. **新規** — `spec/inventory/test.md` に「要素」列が**完全に重複する行が 2 組**ある（U2 が発見。`HEAD` にも `55a5bb9` にも存在する既存の問題で、本 PR が持ち込んだものではない）。実測: `requestBulkExport: 閲覧権限のないノートを含む — 要求する` と `runConversion: 変換結果に外部参照がある — 実行する`。骨子: 「同じ要素を指す TC 行が 2 本ずつあり、片方が余剰なのか、期待結果が違う別ケースなのに要素名が同じなのかを `spec/testcases/` の本文で判定する。前者なら TC ID を欠番にして 1 本へ、後者なら要素名を区別する。**ID の繰り下げはしない**（adr.md ADR-016）」。本 Issue で直さない理由: 本 PR が触っていない未実装ドメイン（note の一括書き出し / conversion）の行で、判定に本文の読み直しが要る
15. **新規** — `linkOAuthIdentity` 手順 3 の**自己所有分岐**が spec に無い（U1 が発見）。実装 `linkOAuthIdentity.ts:100-115` は `resolve` が返した owner が**実行者自身**のとき、`ConflictError` にせず既存 Identity の `identityId` を返して正常復帰する（再送の冪等性）。`spec/usecases/identity.md` の手順 3 は「別 userId の active 行があれば `PROVIDER_ACCOUNT_ALREADY_LINKED`」までしか書かず、自分自身のときに何が起きるかを述べていない。骨子: 「手順 3 に自己所有の分岐を足し、`spec/testcases/identity/linkOAuthIdentity.md` に対応行を採番する（`TC-identity-` 群の末尾）」。**本 Issue で直さない理由**: U1 の担当範囲は M-20（`resolve` の契約と手順の噛み合わせ）で、自己所有分岐は台帳にも R1 の指摘にも無い別項目。spec の追記は実装の追認ではなく**契約の拡張**（冪等性の約束を新たに書く）にあたるので、ユースケース節の再設計として切る

レビュー R2 の修正ラウンドで新たに見つかった分（**新規 1 本**。上の 1〜15 とは重複しない）:

16. **新規** — 削除 operation の「再試行不能と確定した」状態の表現を決める（V5 / M-70 が発見）。`spec/presentation/index.md:236` が P-25 の表示要求に挙げる `failed` に、**生成する遷移が `spec/` のどこにも無い**。実測では `running` / `completed` / `rejected` の 3 値が `application/ports/distributedOperationStore.ts` の `DistributedOperationState`・`spec/database/index.md` の `distributed_operations.state` の CHECK・`spec/domains/index.md` に一貫しており、`accepted` は 202 応答の transport status として説明が付くが、`failed` だけがどちらの語彙にも属さない。骨子: 「`failed` を `distributed_operations.state` の語彙に足して `deleteAccount` の手順で遷移を定義するか、`rejected` に畳んで P-25 の状態直和から落とすかを決める。同型の欠落が `spec/inventory/frontend.md` の `PAGE-p23-003`（`disconnectIntegration` の poll）にもある — `retrying` は presentation の状態語彙にも `DistributedOperationState` にも無く、`accepted` が欠けている。`spec/presentation/index.md` が `deleteAccount` と `disconnectIntegration` を同じ 202 operation 系列として並記している以上、202 operation 系列の表示語彙をまとめて決めること」。**本 Issue で直さない理由**: `failed` を落とす向きは spec を狭める（`spec/adr/046`）ので採らず、CHECK を 4 値へ広げる向きも生成する遷移が設計に無い以上「実装に無い遷移を spec が新設する」ことになるため採らない。本 Issue は語彙の帰属を `spec/presentation/index.md` に明記するところまでで、どちらへ寄せるかの決定は状態遷移の再設計として切る

### 含まれないもの

- **SYNC-08（`Note.reconstruct` の visibility × content 交差検査）** — 現実装は検査しない。spec に「拒否する」と書けば実装変更、「再検査しない」と書けばドメイン不変条件の適用範囲を狭める設計判断になる。どちらもドキュメント同期ではない（adr.md ADR-006）
- **SYNC-23（`spec/design/tokens.md §10` のフォーカスリング改訂）** — `--shadow-focus: 0 0 0 2px var(--color-accent)` が accent 塗りのコントロール上で判別できない問題は実在するが、最小構成でも 47 ファイル（実装 CSS 2 / 実装 TS 1 / 設計ドキュメント 2 / モック HTML 43）に及ぶデザイントークンの再設計を伴う。`apps/web/app/components/auth/formStyles.ts` の `focus:outline-none` の除去も同じ改訂に含まれる（adr.md ADR-006）
- **SYNC-24（`spec/pages/` の L-02 要件）** — `spec/pages/index.md` の L-02 が「サインイン済みで訪れた場合はアプリへ戻る導線を表示」「**状態**: 通常 / サインイン済み」を明示要件として持ち、実装が `PublicShell.signedIn` prop ごと落としている。**spec が正で実装が追随すべき側**なので spec 本文は触らず、実装 Issue として切り出す（adr.md ADR-006）。同じ「サインイン済み」要件でも P-40（トップ）は spec 内部の矛盾であり実装変更を要さないため、SYNC-26 として**本 Issue で閉じる**（AC-26 / adr.md ADR-009）
- **SYNC-21（TC-identity-174）** — 既に解消済み。`spec/testcases/identity/pruneExpiredAuthState.md` の該当行の操作欄は既に「次 Cron で回復する」で、continuation 前提の行（TC-identity-169/170）とも正しく分離されている。`spec/inventory/test.md` の TC-identity-174 行 / `spec/inventory/adapter.md` の ADP-common-030 行も現状で正しい
- **SYNC-27（`ExternalServiceError` の全域語彙整合）** — `spec/` 全域 20 箇所以上とコード JSDoc 7 箇所で使われているが、実 `SystemErrorCode` に存在しない名前（実体は `ExternalApiError` と `DataIntegrityError` の 2 系統）。本 Issue が扱うのは progress.md が名指しした ShareTokenProtector 1 件（AC-18）のみ。未実装ドメイン（conversion / integration / storage / job）は「どちらへ写すか」の実装的裏づけが取れないため触らず、**ステップ 16 でフォローアップ Issue を起票する**（AC-23）
  - 起票内容の骨子: 「`ExternalServiceError` は `SystemErrorCode` に存在しない。`spec/` 20 箇所超と JSDoc 6 箇所（ShareTokenProtector を除く）を、外部 API 通信＝`ExternalApiError` / 鍵・データ整合＝`DataIntegrityError` のどちらへ写すかを、各ドメインのアダプター実装時に決めて置換する」
- ~~**`spec/inventory/usecase.md`**~~ — SYNC-01〜27 の範囲では対象外だった（`UC-identity-001` / `002` / `020` の要点欄は改訂後も真のまま）。**統合により対象に入る**（SYNC-212 / 213 / 215 / 218 / 219 / 226 / 243 の波及と `UC-identity-022〜024` の新設）。inventory の追随対象は domain / adapter / test / frontend / **usecase** の **5 ファイル**（AC-56 が AC-19a の「4 ファイル」を上書きする）
- ~~**`spec/manual-tests/account.md` の全面改訂**~~ — TC-26 / TC-13 の手順ずれは #2 由来で、**統合により本 Issue のスコープに入る**（SYNC-241 / 242 = AC-54、ステップ 18）。ステップ 18 が触るのは TC-42 の追加（AC-30）と TC-26 / TC-13 の 2 行（AC-54）だけで、全面改訂は行わない
- **Issue #2 由来のスコープ外 7 件** — 上の「Phase 5 で起票するもの」5〜11。いずれも spec が正（実装の縮退・未実装）なので、**spec 本文を狭めない**ことが受け入れ基準になっている（AC-62）

## リスクと注意点

- **同一ファイルへの複数項目の編集が競合する**。統合後の集中度は `spec/domains/index.md` が最大（AC-9, 34〜38 の 6 テーマ・11 項目）、次いで `spec/usecases/identity.md`（AC-9b, 10, 11, 12, 43〜46 の 8 テーマ・16 項目）、`spec/domains/identity.md`（AC-5, 7, 8, 31, 32, 33）、`spec/domains/note.md`（AC-1〜6, 18, 39）。steps.md はファイル単位でグルーピングしてあるので、**ステップを分割・並列化しないこと**
- **既存ステップに後から項目を足してある**（ステップ 1, 2, 3, 4, 6, 7, 8, 9〜12, 18, 20）。ステップ番号は Issue #2 由来の統合前と同じなので、**番号だけを見て「前に読んだ内容」と決めつけない**。各ステップの「台帳 ID」欄に 201 番台が入っていれば統合分を含む
- **ステップの実行順は番号順ではない**。22〜29 の本文ステップは inventory（9〜12, 31）より**先**に走らせる。steps.md の「実行順」節が正本
- **`spec/inventory/*.md` は本文からの生成物**。本文（`spec/domains/` `spec/pages/` `spec/testcases/`）を直したら、対応する DOM / ADP / UC / PAGE / TC 行の「要点」欄とヘッダーの「最終同期」日付を必ず追随させる。特に見落としやすいのは `spec/inventory/frontend.md:17,18`（PAGE-p03-001/002 の状態列挙）と `:168`（PAGE-p47-001 のヘッダー）
- **ADP / DOM / UC ID の採番は 2 種類ある**（adr.md ADR-002 ＋ ADR-011）。**適合ケースには採番しない**（ADR-002。`spec/inventory/adapter.md` は「1 行 = 1 ポートメソッド」の不変を持つ生成物で、ケース単位の行を持ち込むと生成規則が壊れる）。一方 **Issue #2 由来の新規ポートメソッド 8 本と新規ユースケース 3 本には通常どおり採番する**（ADR-011）。両者を混同しないこと。採番は各群の**末尾に追加**し、出現順に挿入して既存 ID を繰り下げない。**同じ規則は TC にも当てる**（adr.md ADR-016）— `spec/inventory/test.md` の TC ID は**テストケースファイル名のアルファベット順**で振られており（実測: `addPasswordIdentity`=001 → `authenticateSession`=008 → `changePassword`=017 → `completeOAuthSignIn`=024 → …）、`checkHandleAvailability.md` / `completeOAuthCallback.md` / `getProfile.md` を足すと `TC-identity-024` 以降が全部繰り下がる。新規 TC 行は **identity 群の末尾（`TC-identity-305` 以降）**に採番する
- **コード差分は 35 ファイル**（変更 32 / 削除 3。内訳は下記「コード差分の内訳」）。振る舞いは 1 行も変えない。適合スイートに足すのは `ADP-common-008` の 1 主張だけで、memory 実装は既にこれを満たす（adr.md ADR-012）。**件数だけを見て合否を決めない** — AC-63 の合否は件数の一致と、追加・削除行がコメント / JSDoc / `describe`・`it` 名に閉じているという機械検査の**両方**である
- **`apps/web/app/start.ts` の `AC-15` は spec に存在しない ID**。`.thread/1/plan.md` の受け入れ基準 ID で、計画凍結時に `.thread/1/` が消えると dangling 参照になる。AC-16 で `spec/presentation/index.md` への参照に差し替える
- **`AGENTS.md` は `CLAUDE.md` へのシンボリックリンク**。実体を書き換えれば両方に効くので、リンクを壊さないこと
- **`docs/*_implementation_example.md` は 4 か所から参照されている**（`CLAUDE.md` の Examples 節、`README.md`、`spec/usecases/usage.md`、`apps/web/app/presentation/pagination.ts`）。特に `spec/usecases/usage.md` は backend の記述を**規範として引用**しているので、該当箇所（ユースケース個別のリトライを認める記述）を消さないこと
- ~~**コード変更はステップ 8 の 5 ファイルのみ**~~ → ~~**統合後は 9 ファイル**~~ → ~~**レビュー R1 の修正まで含めた実測は 27 ファイル**~~ → **レビュー R2 の修正まで含めた実測は 35 ファイル**（AC-63 が AC-24 / ステップ 17-3 を上書き）。内訳は下記「コード差分の内訳」。これ以外にコード差分が出たらスコープ逸脱を疑う
- **`spec/domains/note.md` のポート節（`LocalNoteQueryService` 以降）には `**エラーケース**:` 行が 1 つも無い**（note.md のエラーケース行は Note / Revision / ShareLink 側の 7 か所に閉じている）。AC-5 / AC-18 で新設する行は、既存 7 か所の書式に合わせること
- **行番号アンカーはドリフトする**。ステップ 1〜7 が本文を編集した時点で、それ以降のステップの行番号は全部ずれる。steps.md の編集箇所は**見出し・ID・引用文言**を第一のアンカーとし、行番号は補助情報としてのみ扱う（`spec/pages/index.md` の L-02 状態行、`spec/presentation/index.md` の「対象」段落と「その他のヘッダー」表、`spec/inventory/domain.md` の Excerpt / NoteHeading 行は、計画時点で既に 1〜2 行ずれていた）
- **`spec/adr/` の番号は永久割り当て**。廃止した ADR（015 / 016 / 018 / 019 / 020）は削除されて番号が空いたままで、**再利用されていない**。ステップ 20 は最大採番（051）の次から **052〜057 を連番で確保する**（統合で 4 → 5 本、計画レビュー R2 で 5 → 6 本。056 = adr.md ADR-014、057 = adr.md ADR-010）。**採番の再確認（`ls spec/adr/`）はステップ 20 の先頭で行い、番号入りリンクを本文へ書くどのステップよりも前に置く**（実行順フェーズ F0 を A より前に固定した理由。arch:P-007）。ずれていたらブロックごと後ろへずらす
- **`spec/usecases/storage.md:492` のリンク `spec/platform/index.md#クエリ予算` は既にリンク切れ**（その見出しは存在しない）。ステップ 24 / 29 で実在する `### Scope DO` へ直す。同種のリンク切れを新たに作らないよう、`spec/` 内アンカーを書くときは見出しの実在を確認すること
- **`spec/domains/index.md` のポートは記述粒度が揃わないまま残る**（adr.md ADR-015 / ADR-016）。実測すると、実装に存在して**`spec/inventory/` に 1 行も無いポートが 5 つ**ある — `DistributedOperationStore`（`spec/domains/index.md:121` に 1 行言及のみ）/ `AppliedOperationStore` / `IdentityRemovalReceiptStore` / `OutboxRepository` / `ScopeTaskScheduler`。適合スイートもこの 5 本だけ `describe` / `it` 名に ADP ID を持たない（`adapters/conformance/` の他 20 本は持つ）。本 Issue は `AppliedOperationStore` に 1 行言及を足して「名前だけが宙に浮く」状態を作らないところまでにとどめ、**5 ポートの interface 化と inventory 行・ADP ID 付与は Phase 5 の recovery Cron Issue（下記 6.）にまとめて追跡する**。ADR-011 の「D1 実装者が実装すべきメソッドの全数を台帳から数えられる」はこの 5 ポートについては本 Issue 完了後も成立しない

### コード差分の内訳（AC-63 の実測。変更 32 / 削除 3 / 追加 0 = 35 ファイル）

**計画時の 9 ファイル**（ステップ 8 の 8 ＋ ステップ 30 の 1）:

| # | ファイル | 変更の種類 |
| --- | --- | --- |
| 1 | `packages/core/src/application/ports/shareTokenProtector.ts` | ポート JSDoc |
| 2 | `packages/core/src/domain/identity/ports/identityRepository.ts` | ポート JSDoc |
| 3 | `packages/core/src/application/ports/accountDeletionManifestStore.ts` | ポート JSDoc |
| 4 | `packages/core/src/application/ports/scopeCleanupAdmissionStore.ts` | ポート JSDoc |
| 5 | `packages/core/src/domain/identity/errorCode.ts` | 冒頭コメントの全文削除 |
| 6 | `packages/core/src/domain/storage/errorCode.ts` | 冒頭コメントの全文削除 |
| 7 | `apps/web/app/start.ts` | コメント（`AC-15` → `spec/presentation/index.md`） |
| 8 | `packages/core/src/application/di/containerStore.ts` | JSDoc ＋ エラーメッセージ文字列（ADR-024） |
| 9 | `packages/core/src/adapters/conformance/scopeCleanupAdmissionStore.ts` | `ADP-common-008` ケースへの主張追加 ＋ `it` 名（ステップ 30 / U8 の両方が触る） |

**レビュー R1 の修正で増えた分**（`review/triage.md` の U7 / U8 / U9。**すべてコメント・JSDoc・`it` 名の文字列のみ**）:

| # | ファイル | 単位 | 変更の種類 |
| --- | --- | --- | --- |
| 10 | `packages/core/src/application/identity/uniqueness.ts` | U7 (M-02) | JSDoc（`sha256(...)` の名指し → `spec/adr/048`） |
| 11 | `packages/core/src/application/identity/removeIdentity.ts` | U7 (M-02) | 同上 |
| 12 | `packages/core/src/application/identity/view.ts` | U7 (M-02) | JSDoc（spec の出力表を否定する 1 句の削除） |
| 13 | `packages/core/src/application/identity/completeOAuthCallback.ts` | U7 (M-31) | JSDoc（`provider` は表示・ログ専用ではなく state 照合の入力） |
| 14 | `packages/core/src/domain/identity/ports/identityUniqueDirectory.ts` | U7 (M-23) | ポート JSDoc（`reserve` の conflict 条件を実装の判定材料へ） |
| 15 | `apps/web/app/presentation/session.ts` | U7 (M-42) | コメント（dangling `ADR-110` → `spec/adr/037`） |
| 16 | `apps/web/app/presentation/oauthStateCookie.ts` | U7 (M-42) | コメント（`ADR-110` → `037` / `ADR-099` → `034`） |
| 17 | `apps/web/app/components/settings/DeleteAccountPanel/ticketStorage.ts` | U7 (M-42) | コメント（`ADR-006/095/112` → `spec/adr/047`） |
| 18 | `packages/core/src/adapters/conformance/accountDeletionManifestStore.ts` | U8 (M-11) | ヘッダーコメント ＋ `it` 名（`ADP-common-012` → `041`） |
| 19 | `packages/core/src/adapters/conformance/identityUniqueDirectory.ts` | U8 (M-11) | `it` 名 5 本（`ADP-identity-009` → `041` 単記 / `041/009` 連記） |
| 20 | `packages/core/src/adapters/conformance/noteProjection.ts` | U8 (M-11) | ヘッダーコメント ＋ `it` 名（`ADP-note-028` → `055/056`） |
| 21 | `packages/core/src/adapters/conformance/objectStorage.ts` | U8 (M-11) | ヘッダーコメント ＋ `it` 名（無印 → `ADP-storage-024`） |
| 22 | `packages/core/src/adapters/conformance/authTokenRepository.ts` | U8 (M-11) | ヘッダーコメント ＋ `it` 名（無印 → `ADP-identity-039`） |
| 23 | `packages/core/src/adapters/conformance/signInOAuthClient.ts` | U8 (M-11) | ヘッダーコメント ＋ `it` 名（無印 → `ADP-identity-040`） |
| 24 | `packages/core/src/application/storage/__tests__/deleteFilesByOwner.test.ts` | U8 (M-12) | `it` 名（改訂後の行を指さない `TC-storage-043:` を外す） |
| 25 | ~~`apps/web/.dev.vars.example`~~ | U9 (M-46) | **削除**（Cloudflare 用。読むコード 0 件） |
| 26 | ~~`apps/web/.env.aws.example`~~ | U9 (M-46) | **削除**（AWS 用。同上） |
| 27 | ~~`apps/web/.env.gcp.example`~~ | U9 (M-46) | **削除**（GCP 用。同上） |

**レビュー R2 の修正で増えた分**（`review/triage.md` の V7 / V8 / V12。**すべてコメント・JSDoc・`it` 名の文字列のみ**。V7 が触る 2 ファイルは 19 / 20 と重複するので新規参入は 8 ファイル）:

| # | ファイル | 単位 | 変更の種類 |
| --- | --- | --- | --- |
| 28 | `packages/core/src/application/identity/getProfile.ts` | V8 (M-67) | JSDoc（"has no usecase in the spec" の削除 ＋ `UC-identity-022` / spec 節への参照） |
| 29 | `packages/core/src/application/identity/__tests__/getProfile.test.ts` | V8 (M-67) | コメント（"It has no spec TC of its own" の全文削除） |
| 30 | `packages/core/src/application/identity/__tests__/checkHandleAvailability.test.ts` | V8 (M-67) | 同上 |
| 31 | `apps/web/app/components/settings/ProfileForm/action.ts` | V8 (M-67) | コメント（`UC-identity-017` → `UC-identity-022`） |
| 32 | `packages/core/src/domain/identity/ports/authTokenRepository.ts` | V8 (M-75) | ポート JSDoc（呼び出し元に `requestPasswordReset` を併記） |
| 33 | `packages/core/src/application/identity/addPasswordIdentity.ts` | V8 (M-76) | JSDoc（`UC-identity-014` → `013`） |
| 34 | `packages/core/src/application/identity/changePassword.ts` | V8 (M-76) | JSDoc（`UC-identity-013` → `014`） |
| 35 | `packages/core/src/application/identity/__tests__/updateProfile.test.ts` | V12 (M-87) | `it` 名 3 本（`TC-identity-332` / `333 / 334` / `335` を名乗る） |

V7 が触る 2 ファイル（`conformance/noteProjection.ts` = 20、`conformance/identityUniqueDirectory.ts` = 19）と V8 が触る `apps/web/app/presentation/session.ts`（= 15）は R1 で既に差分に入っているので、R2 で**新規参入したのは上の 8 ファイル**。27 ＋ 8 = **35**。

**`packages/` / `apps/` の外**にもう 1 件、`.dockerignore` の **3 行削除**（`**/.wrangler` / `infra/aws/cdk.out` は U9 / M-46、`!.env.*.example` は V9 / M-85）がある。リポジトリ設定ファイルなので AC-63 の 35 件には数えないが、**同じ「他ランタイムの残骸」の是正**なので取りこぼしと読まれないようここに記録する。

## テスト方針

- ドキュメント同期が主体。**自動テストの追加は適合スイートの 1 ケースだけ**（SYNC-207 / AC-59 / ステップ 30。adr.md ADR-012）で、それ以外は既存の緑を壊さないことを確認する
- `pnpm typecheck` / `pnpm lint:fix` / `pnpm format` / `pnpm test:unit` / `pnpm build`（AC-24）
- 台帳の追随漏れを機械的に検査する grep（ステップ 17）。**合否の形は 3 種類ある**（計画レビュー R3 coverage:S-001。前置きを「すべて 0 件」と断言していたが、配下の実態と食い違っていた）。**どれに当たるかを取り違えないこと**:
  - **0 件検査** — 直すべき記述が残っていないこと（下記の大半）
  - **1 件以上検査** — spec を狭めていないこと（AC-62。**合否の向きが逆**）
  - **件数一致検査** — 採番・追随の件数が想定どおりであること（AC-55 の 8 / 8 / 3、AC-64 の 24 / 24、AC-65(b) の 1、`ls spec/adr/05[2-7]-*.md` の 6）
  - このほかに**出力を人が読む確認が 4 つ**ある（ステップ 17 が担当する。機械判定にできないものを無理に grep へ畳まない）— AC-27 の「コメント部分にヒットが無い」/ inventory 5 ファイルの「最終同期」日付 / `spec/adr/index.md` の 2 表に 6 行 / AC-68 のリンク先実在
- 0 件が合否の検査:
  - `grep -rn "NOTE_ROUTE_BATCH_TOO_LARGE" spec/ packages/ apps/` → 0 件
  - `grep -n "ExternalServiceError" packages/core/src/application/ports/shareTokenProtector.ts` → 0 件
  - **実在しない固有名の検査**（AC-20 / AC-22 / AC-25）:
    `grep -rniE "serverCloudflare|serverAws|serverGcp|infra/aws|infra/cloudflare|infra/gcp|components/todo|routes/todo|TodoBoard|TodoList|TodoItem|TodoShell|TodoRepository|inputValidator|libSQL|Turso|drizzle|migrate\.(cf|aws|gcp|node)|runtime_(cloudflare|aws|gcp)" CLAUDE.md README.md docs/frontend_implementation_example.md docs/backend_implementation_example.md` → 0 件
    - 検査語を「実在しない固有名」に絞ってあるのは、`cloudflare` 単体（最終ターゲットとして残す）や `todo` 単体（英文中の一般語）が正当にヒットするため。**`-E` の選択は `|` であって `\|` ではない**（`\|` を渡すとリテラル `|` を含む 1 本の文字列を探すことになり、改訂前でも常に 0 件＝常に合格になる）
  - `grep -n "AC-15" apps/web/app/start.ts` → 0 件
  - `grep -rn "IdentityLimitExceeded" packages/core/src/domain/identity/errorCode.ts` の**コメント部分**にヒットが無い（AC-27。enum の値定義行は残る）
  - `spec/inventory/{domain,adapter,test,frontend,usecase}.md` の **5 ファイル**の「最終同期」日付が更新されている（統合により `usecase.md` が対象に入った — AC-56）
  - `spec/adr/index.md` の一覧に 052〜057 の 6 行があり、`ls spec/adr/05[2-7]-*.md` が **6 ファイル**を返す（AC-29 / AC-61 / AC-69。計画レビュー R2 arch:S-001 で 057 = ADR-010 の昇格が加わった）
  - **Issue #2 由来の追加検査**（すべて「ヒット 0 件」が合否）:
    - `grep -n "ExternalServiceError" spec/domains/identity.md | grep -c "通信・応答不正"` → **0 件**（AC-33。`SignInOAuthClient` の `**エラーケース**:` 行だけを見る）。あわせて向きの逆の 1 本 `grep -c "ExternalApiError" spec/domains/identity.md` → **1 件以上**（修正前の実測は 1 / 0）
      - **ファイル全体の 0 件検査にはしない**（計画レビュー R3 coverage:P-001）。同ファイルの `ExternalServiceError` は実測 **3 件**で、ステップ 2-7 が直すのは `:465`（`SignInOAuthClient`）の 1 行だけである。残る `:426`（`PasswordHasher`。暗号処理の失敗）と `:443`（`SecureTokenGenerator`）は **SYNC-27（全域語彙整合）としてステップ 16-4 の Issue へ送る**スコープ外の 2 件で、ステップ 8 の注意も対応する JSDoc を触らないと明記している。全域 0 件にすると全ステップを正しく終えても 2 件を返して落ちる（R2 の AC-52 で潰したのと同型の欠陥）
    - `grep -rn "InvalidProvider\b" spec/usecases/identity.md spec/testcases/identity/startOAuthFlow.md spec/inventory/test.md | grep -v InvalidProviderAccount | grep -v "TC-integration-"` → 0 件（AC-52）
      - **対象を identity 側 3 か所に絞ってある。** `spec/` 全域を見る形（旧案）では、本 Issue が触らない integration 側 3 か所（`spec/usecases/integration.md:37` / `spec/testcases/integration/startIntegrationOAuth.md:7` / `spec/inventory/test.md` の TC-integration-170 行）が必ず残るため、全ステップを正しく終えても 3 件を返して落ちる。修正前の実測は **3 件**（identity 側のみ）で、3 ステップ（4-5 / 11 / 27）を終えると 0 件になる
    - `grep -rn "多行 outbox INSERT" spec/testcases/storage/deleteFilesByOwner.md spec/usecases/storage.md spec/inventory/test.md` → 0 件（AC-53）
      - **検査語を実際の文言に合わせてある。** 旧案の `3 文\|3文` は (1) `spec/inventory/test.md` の `TC-identity-283 … **3 文字**のハンドル` に誤ヒットして常に落ち、(2) 実際に直す `spec/usecases/storage.md:492` の本文（「列挙 1 + 多行 DELETE 1 + 多行 outbox INSERT 1 **= 3**」）は「3 文」を含まないため取りこぼす。`多行 outbox INSERT` は 3 ファイルすべての該当行に現れ、`updateProfile` の行には無い。修正前の実測は **3 件**（3 ファイルに 1 件ずつ）
      - ステップ 29 が `spec/platform/index.md` に足す段落は同じ語を意図的に含むので、**検査対象を 3 ファイルに限定する**（`spec/` 全域で引かない）
    - `grep -rn 'sha256("removeIdentity' spec/` → 0 件（AC-67。修正前の実測は 1 件 = `spec/usecases/identity.md:524`）
    - `grep -n "クエリ予算" spec/usecases/storage.md` → 0 件（存在しない見出しへのリンクを消す。AC-47）
    - `grep -rn "sha256(parentOperationId" spec/` → 0 件（AC-46 / AC-49。修正前の実測は 2 件 = `spec/usecases/identity.md:27` / `spec/database/index.md:57`）
    - `grep -cF 'ensureAcceptable({ purpose: "source", mimeType, size })' spec/usecases/storage.md` → 0 件（AC-65(a)。修正前の実測は 1 件 = `:90`。**引数を明示的に書いている唯一の呼び出し**で、他の 3 か所は `{ purpose: "…", ... }` の省略記法）
  - **`declaredMimeType` の残置検査**（AC-65(b)。**0 件ではなく 1 件が合否** — 計画レビュー R3 arch:P-001）:
    - `grep -c "declaredMimeType" spec/usecases/storage.md` → **1**（修正前の実測は 4 = `:22` / `:74` / `:136` / `:167`）
    - 残す 1 件は `startBulkUpload` の `files` 列（`:22`）。**このユースケースはバイト列を持たない**ので `spec/adr/050` の前提「受理判定の時点で実体を握っていること」が成立せず、`files[].declaredMimeType` / `size` は受理判定の入力ではなく**手順 1 の合計サイズ検査と手順 5 の暫定判定のヒント**である。落とすと同じファイルの手順 1・手順 5・出力 DTO の説明段落が根拠を失う（`spec/adr/046`「実装が未実装の側で spec を狭めない」）。`spec/usecases/conversion.md:198` の `declaredMimeType`（`FormatDetector.detect` のヒント）を除外したのと同じ切り分け
  - **spec を狭めていないことの検査**（すべて「ヒット 1 件以上」が合否。AC-62。上の 0 件検査と**合否の向きが逆**なので取り違えないこと）:
    `grep -n "createDownloadUrl" spec/domains/storage.md` / `grep -n "workspaceCursor" spec/usecases/usage.md` / `grep -n "next_attempt_at" spec/database/index.md`
  - 新規 inventory 行の採番検査（AC-55）。**3 本とも `-E` に統一する**（BRE と ERE を混ぜない）:
    - `grep -cE "DOM-common-04[12]|DOM-identity-06[012]|DOM-note-07[12]|DOM-storage-038" spec/inventory/domain.md` → 8
    - `grep -cE "ADP-common-04[01]|ADP-identity-0(39|4[01])|ADP-note-05[56]|ADP-storage-024" spec/inventory/adapter.md` → 8
    - `grep -cE "UC-identity-02[234]" spec/inventory/usecase.md` → 3
    - **旧案の ADP 行は壊れていた。** BRE に ERE のグループ `(39|4[01])` を混ぜていたため `ADP-identity-039〜041` の 3 行を永久に検出できず、8 行すべてを正しく採番した合成ファイルに対する実測が **5**（期待 8）だった。`-E` を付けた形は同じ合成ファイルで **8** を返す。現状の 3 ファイルに対しては 3 本とも **0**（未採番なので正しい）
  - `grep -rn "adr/05[2-7]-" spec/` の参照先ファイルがすべて実在する（AC-68。ADR 番号がずれたときに本文リンクだけが取り残されるのを検出する。現状は 0 件）
  - **新設テストケースの採番検査**（AC-64）: `ls spec/testcases/identity/*.md | wc -l` が **24**、`grep -c "^| UC-identity-" spec/inventory/usecase.md` が **24**、新規 TC 行が `TC-identity-305` 以降で、`grep -n "^| TC-identity-024 " spec/inventory/test.md` が `completeOAuthSignIn` の行を指したまま（現状は 21 / 21 / `completeOAuthSignIn`）
- マニュアルテストの実行は不要（UI の挙動を変えない）。ただし手順書側（`spec/manual-tests/account.md`）は scenario の下流成果物なので、AC-02 の新規異常系に TC-42 を追随させ（AC-30）、TC-26 / TC-13 の 2 行を実装・usecase 側の正本に合わせる（AC-54）
