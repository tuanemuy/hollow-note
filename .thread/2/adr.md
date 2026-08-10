# ADR — Issue #2: [account] アカウント管理と認証手段

## ADR-001: 見送り基準を「他スライスが所有するドメインの本体実装を要するか」で引く

### Status
Proposed

### Context
チェックリストは `deleteAccount` の委譲先として `deleteMembershipsForUser`（Workspace）/ `deleteJobsForRequester`（Job）/ `deleteIntegrationsForUser`（Integration）を含むが、対応するドメイン（`Membership` 集約、`Job` 集約と削除マニフェスト、`ExternalConnection` / `BackupRecord` / `CredentialResolver`）はコードに存在せず、それぞれ Issue #3 / #5 / #4 が所有する。これらを本 Issue で実装すると、後続スライスのドメイン設計を先取りしたうえに、その大半が「削除経路だけ実装され通常経路は無い」という、完了条件が禁じる部分実装になる。一方 Issue #1 は ADR-006 で「外部技術結合は見送り、永続化ストア契約は実装する」という基準を作っており、その基準は本 Issue の状況（ドメイン境界をまたぐ見送り）を判定できない。

### Decision
見送り基準を次のとおり拡張して一貫適用する。

- **実装する**: 本 Issue が所有するドメイン（Identity / Usage）と、チェックリストの UC が直接必要とする最小の誘発作業（Storage の avatar 経路、認証残渣掃除コンシューマー、継続コマンドのランタイム配線）。
- **見送る**: 実装本体が**他スライスが所有するドメインの集約・ポートの新設**を要するもの。対象は `deleteMembershipsForUser`（#3）/ `deleteJobsForRequester`（#5）/ `deleteIntegrationsForUser`（#4）と、その前提を必要とする TC 行、および workspace membership を前提とする `deleteAccount` / `getUsageSnapshot` の TC 行。
- **見送らない**: 「本 Issue のシナリオで実行経路が無い」だけの行（ADR-006 と同じく、永続化・オーケストレーション契約は実装する）。

見送り行は Issue コメントに ID 単位で理由つきで残し、チェックを付けない。スタブ・no-op のダミー ack は作らない（ADR-002 参照）。

### Consequences
- 良い点: 見送り判断が「どのスライスがそのドメインを所有するか」という検証可能な基準になり、行単位の恣意性が消える。後続スライスは自分のドメインと一緒に削除経路を実装できる。
- トレードオフ: チェックリストの消化率が 100% にならない。`deleteAccount` は「personal + global 経路は完結、workspace wave は #3 で完成」という段階的完成になり、#3 が本 Issue のオーケストレーションに追記する形になる。

---

## ADR-002: personal scope cleanup の必須 component 集合を DI で宣言する（ダミー ack を作らない）

### Status
Proposed

### Context
`ScopeCleanupAdmissionStore.markCompleted` は Issue #1 の ADR-017 で「8 component（job / note / tag / storage / backup / usage / localProjection / outbox）全 ack を要求し、未達は ConflictError」と確定した。しかし本 Issue 時点で cleanup 参加者を持つドメインは storage / usage だけで、job / tag / backup は該当ドメイン自体が無く、note の `deleteNotesForOwner` も未実装（localProjection / outbox に ack 主体が無いことは ADR-018 で確定した）。8 ack を満たすには (a) 存在しない component を無条件 ack するダミーを置く、(b) 必須集合を実際に配線された参加者から決める、のどちらかが要る。(a) は完了条件が禁じる仮実装であり、しかも後続スライスが participant を足したときにダミーを外し忘れると「掃除したつもりで消えていない」という検出困難な欠陥になる。

### Decision
(b) を採る。`PersonalCleanupComponent` の enum（8 値）は spec どおり据え置き、**そのビルドで必須となる部分集合を composition root（`di/memoryRuntime.ts`）が宣言し、`ScopeCleanupAdmissionStore` の生成時に渡す**。

ただし宣言は「参加者を登録する」という**追加式にしない**。必須集合を「登録された participant」からだけ導出すると、後続スライスが登録を忘れたとき (i) そのドメインへ cleanup コマンドが配送されず、かつ (ii) 必須集合にも入らないため、`markCompleted` が素通りする — (a) 案を退けた理由（掃除していないのに完了する）が別経路で復活する。

そこでレジストリを `Record<PersonalCleanupComponent, Participant | AbsentReason>` の**全数宣言**にする（`application/cleanup/participants.ts`）。8 値のいずれかが欠けると型エラーになるので、新しい component 値を足したときも、後続スライスが `AbsentReason` を `Participant` に差し替え忘れたときも、宣言の存在自体は型が保証する。`AbsentReason` は「不在の理由 + 担当 Issue」を持つ値で、必須集合は `Participant` の側から導出する。本 Issue の `Participant` は **`storage` / `usage` の 2 つ**、`AbsentReason` は `job`（#5）/ `note`（編集・整理スライス）/ `tag`（整理スライス）/ `backup`（#4）/ `localProjection` / `outbox`（後 2 者の判断は ADR-018）。

適合スイート（`ADP-common-*` の admission store ケース）は「宣言された集合の全 ack で completed、1 つでも欠けると ConflictError」という形に一般化し、8 値固定の assert を外す。必須集合は `ConformanceBackendOptions` の新オプション経由でバックエンドへ渡す。

### Consequences
- 良い点: 「掃除されていない component が ack されている」状態が構造的に作れない。全数宣言なので、後続スライスの登録漏れは「黙って completed する」ではなく「`AbsentReason` が残っている」という**読める形**で表面化し、component 値の追加はコンパイルエラーで検出される。
- トレードオフ: spec（8 固定）と実装（宣言的部分集合）にずれが生まれるので、spec/domains/index.md に「必須集合は配備に存在する参加者の集合」と書き足す spec-sync が要る。`AbsentReason` のまま放置しても型は通る（不在であること自体は正当な状態なので型では禁じられない）ため、`AbsentReason` の一覧を Issue コメントの縮退記録に必ず載せる運用が要る。

---

## ADR-003: `SignInOAuthClient` は実 Google アダプターを本体とし、ローカル用の dev IdP アダプターを明示的な opt-in で併設する

### Status
Proposed

### Context
`SignInOAuthClient` は #1 で「OAuth プロトコル結合」としてアダプター見送り（ADR-006）になっており、本 Issue が唯一の実装機会。完了条件は仮実装を禁じるが、`spec/manual-tests/account.md` TC-05 は「Google の同意画面に遷移する」というブラウザー検証を要求し、実行には Google Cloud のクライアント ID / シークレットが要る。参照ランタイムは Node + memory 一本（spec/adr/025）で、本番配備は Issue #11 / #15 の担当。選択肢は (a) 実 Google アダプターのみ実装し、手動検証には資格情報を必須とする、(b) fake だけを置く、(c) 実アダプターを本体としつつローカル用の別プロバイダー実装を併設する。

### Decision
(c) を採る。

- `adapters/oauth/googleSignInOAuthClient.ts` — Google の OIDC エンドポイントに対する実装（認可 URL 構築 + PKCE、`code` 交換、`id_token` からの `providerAccountId` / `email` / `email_verified` / プロフィール抽出）。
- `adapters/oauth/devSignInOAuthClient.ts` — ループバックの開発用 IdP。これは「Google の代替プロバイダー実装」であって Google 実装の縮退版ではない（memory バックエンドを正規アダプターと位置づけた ADR-024 と同じ扱い）。
- **選択規則**（`di/serverNode.ts` の env スキーマと `di/memoryRuntime.ts` の 1 箇所に閉じる。資格情報は `AppConfig` に載せない — ADR-006 と同じ理由で `AppConfig` は SSR メタデータの器）:
  1. `OAUTH_DEV_MODE=true` → dev IdP。ただし `NODE_ENV=production` と併用された場合は**起動時エラー**にする（配線規律だけでは production 混入を止められないため、実効的なガードを 1 つ置く）。
  2. それ以外で `GOOGLE_OAUTH_CLIENT_ID` / `GOOGLE_OAUTH_CLIENT_SECRET` が揃っていれば Google。
  3. どちらでもなければ**起動時に失敗**する（黙って fake に落ちない）。
- `apps/web/.env.example` は `OAUTH_DEV_MODE=true` を既定の開発設定として記載する。これにより Google 資格情報を持たない開発者・マニュアルテスト実行者も `pnpm dev` をそのまま起動でき、必須 env は `APP_URL` + `OAUTH_DEV_MODE` の 2 つに留まる。
- 適合スイート `describeSignInOAuthClientContract` は、プロトコル詳細ではなく**ポート契約**（`buildAuthorizationUrl` が state / PKCE challenge / redirect_uri を含む、交換失敗は `ExternalServiceError`、拒否は `OAUTH_CODE_INVALID`、`emailVerified` の伝播）を検証する。**dev アダプターは無条件に実行し、Google アダプターは `GOOGLE_OAUTH_CLIENT_ID` / `GOOGLE_OAUTH_CLIENT_SECRET` が揃っているときだけ実行する**（skip 条件を 1 箇所に書き、登録行は常に置く）。ネットワークも資格情報も要らない `deriveCodeChallenge` の S256 契約だけは両アダプターで無条件に実行する。受け入れ基準（AC-6）はこの形で書き、「両方が通る」とは書かない — 既定の CI は資格情報を持たないので、文面どおりには決して満たされない基準になってしまう。
- ユースケーステストは `createTestHarness({ requestOverrides })` でポートを差し替える既存パターンを使う（アダプターに依存しない）。

### Consequences
- 良い点: 「実装本体が外部プロトコル結合」という #1 の見送り理由が本 Issue で正面から解消され、チェックリストの ADP-identity-033/034 相当が仮実装なしで埋まる。資格情報のない開発機でも OAuth の全状態（成功 / キャンセル / state 不一致 / 期限切れ / 通信失敗）をブラウザー検証でき、マニュアル TC-40（同意のキャンセル）が実行可能になる。**ただしこれはアダプター単体では成立しない** — dev IdP が返す「同意画面」の実体をアプリ内ルートとして持つ必要がある（ADR-021）。
- トレードオフ: アダプターが 2 本になり、選択ロジック（env による分岐）が composition root に増える。`packages/core` はビルド無しで `.ts` を直接 export する構成なので、composition root が両方を静的 import する限り tree-shaking では dev IdP を落とせない — 実行時の起動ガード（規則 1）とレビューで守る。Google 実装そのものの e2e 検証は資格情報のある環境でしか行えない（適合スイートの Google 側は既定で skip される。縮退として記録する）。
- **DX への影響**: 現行 `apps/web/.env.example` の必須項目は `APP_URL` 1 つだけなので、**規則 3 は既存の手元 `.env`（コミットされない）をそのまま起動不能にする**。`.env.example` の更新に加えて、Issue コメント（ステップ 34）と `docs/runtime_node.md` に「既存の `.env` に `OAUTH_DEV_MODE=true` を 1 行足す」を明記する。黙って fake に落ちないことを優先した結果の意図的な破壊的変更であり、起動時エラーメッセージにもこの 1 行を含める。

---

## ADR-004: Storage は avatar 経路に限った最小コアを本 Issue で新設する

### Status
Proposed

### Context
（本 ADR で「AC-07」と書くのは `spec/scenario/account.md#AC-07`（シナリオ）であり、plan.md の受け入れ基準 AC-7 ではない。）

チェックリストの UC-storage-004（`storeAvatar`）と UC-storage-013（`deleteFilesByOwner`）は、`StoredFile` エンティティ・`StorageOwner` / `FileName` / `MimeType` / `ByteSize` / `FileProvenance` VO・`StoredFileRepository`・`ObjectStorage`・`UploadValidationPolicy` を要求するが、`domain/storage/` は `StoredFileId` の VO スタブのみで、DOM-storage-* / ADP-storage-* の行は本 Issue のチェックリストに含まれない（Storage ドメイン本体は取り込みスライス #6 の所有）。シナリオ AC-07 は「アイコン 5 MB / PNG・JPEG・WebP」を明示しており、アバターなしで P-21 は成立しない。

### Decision
Storage ドメインのうち **avatar 経路が通るのに必要な最小コア**を本 Issue で新設する（ADR-001 の「誘発作業」枠）。含むもの: `StoredFile` エンティティ（register / delete）、上記 VO 群、`UploadValidationPolicy`（purpose 別の MIME / サイズ表。本 Issue では `avatar` の行のみ埋め、他 purpose は #6）、`StoredFileRepository`（`TransactionalRepository` 継承の `insert` / `findById` / `delete(id, expectedVersion)` + `listByIds` / `listByOwner` / `sumSizeByOwner` — 形は ADR-022 が確定する）、`ObjectStorage`（**`put` / `get` / `deleteMany` / `publicUrl` — メソッド構成は ADR-011 が本 ADR を上書きする**）、共有手続き `deleteFiles`、`storage.fileStored` / `storage.fileDeleted` イベントとその `deleteStoredObjects` サブスクライバー。含まないもの: `storeUpload` / `startBulkUpload` / `storeMedia` / artifact 回収 / orphan media 回収 / 変換連携（すべて #6）。

memory `ObjectStorage` はプロセス内のバイト列ストアとし、`apps/web` に配信ルートを 1 本置いて `url` を解決する（本番は R2 の公開 URL — #11）。

VO は `spec/domains/storage.md` の列挙どおり `StorageOwner` / `FileName` / `MimeType` / `ByteSize` / `FileProvenance` に加えて **`ObjectKey`（`ObjectKey.build(owner, purpose, fileId, extension)`）/ `Checksum` / `FilePurpose`** を含む。`publicUrl(key: ObjectKey)` / `deleteMany(keys)` / `put(key, body, meta)` / `StoredFile.register` はこの 3 つが無いと型として書けない。リポジトリの形（OCC トークンの取得経路・`listByOwner` の戻り値）は ADR-022 で確定する。

### Decision の帰結として本 Issue で扱わないもの
`applyStorageDelta`（UC-usage-003、チェックリスト外）を実装しないため、アバター保存時に `StorageQuota.consumedBytes` は増えない。**同じ理由で `noteCount` も増減しない**（`spec/usecases/usage.md` は `note.created` / `note.purged` による件数更新も `applyStorageDelta` に置く）。したがって TC-usage-059（ゴミ箱のノートも数える）の根拠は `recalculateStorageUsage` の `countByOwner(owner, "all")` 側にしか無い。整合は `recalculateStorageUsage`（チェックリスト内）で取る。この縮退は Issue コメントに記録する。

### Consequences
- 良い点: シナリオ AC-07（`spec/scenario/account.md#AC-07`）と TC-storage-167, 170..174 が仮実装なしで通り、#6 は同じエンティティ・ポートの上に upload 系 UC を足すだけになる（TC-storage-168 / 169 は workspace アイコンで #3 へ見送り — ADR-014）。`deleteFilesByOwner` も同じコアで実装でき、personal cleanup の `storage` participant が本物になる。
- トレードオフ: `UploadValidationPolicy` の表が purpose 1 行だけの状態で先行する（#6 が埋める）。「Storage ドメインの一部が本 Issue で決まる」ため、#6 の設計自由度がその分下がる。memory ObjectStorage は dev サーバー再起動でアバターが消える（walking skeleton と同じ受容）。

---

## ADR-005: 削除の継続コマンドは in-process の scheduled task ランナーで駆動する

### Status
Proposed

### Context
`deleteAccount` は `identity.accountDeletionManifestBuildContinued` / `...DispatchContinued` / `...ManifestCompactContinued` / `identity.userAuthResidueCleanupContinued` / `identity.personalBarrierPruneContinued` と、scope 側の `storage.ownerDeleteContinued` / `usage.userCleanupContinued` という 7 種の継続入力を持つ。CF 実装ではこれらは Queue と DO Alarm に載るが、本スライスの Node ランタイムには queue 配線が無く、#1 は `pruneExpiredAuthState` の配線を明示的に見送っている（ADR-020 は cron 分岐を「その invocation 内で完走」させる形で in-process 実行モデルを既に採用済み）。

### Decision
ADR-020 の in-process 実行モデルを継続コマンド全体へ拡張する。`ScopeTaskScheduler`（scope 平面）と既存の outbox / relay（global 平面）を継続の運搬路とし、Node runner に「保存済み継続タスクを期限順に取り出して同じユースケースへ再投入する」ランナー役を 1 つ足す。継続の**粒度・冪等性・checkpoint 保存は spec どおり**（1 コマンド = 100 件、継続タスクの保存は同一 UoW）に保ち、変わるのは運搬路だけにする。ユースケース側は「入力が来たら 1 ターン処理して次を保存する」形のままなので、#11 は運搬路を Queue / Alarm に差し替えるだけで載る。

`ScopeTaskScheduler` は**新設ポート**であり（現行コードに存在しない）、`ScopeUnitOfWorkContext` に載せる。「期限順に取り出して再投入する」だけのランナーでは `spec/domains/index.md` の継続要求 4 規約を満たせないので、次の 3 点をポート契約に含めて適合スイートで固定する。

- `operation_id` は生成元（operation / event / command ID + 対象 ID + version + cursor）から決定的に導出し、`(kind, operationId)` で **upsert** する（応答喪失後の再実行で継続が増殖しない）。
- 対象が残っているのに 1 件も処理できなかったときは新しい継続を積まず、**同じ行の `attempt` / `dueAt` を指数 backoff で更新**する。
- backoff の上限に達したら `failed` へ遷移させる（恒久失敗の 1 件が継続を無限に増やさない）。

personal barrier の prune task（`identity.personalBarrierPruneContinued`）の**発行主体は、`markCompleted` を呼ぶ完了ユースケース**とする。`ScopeCleanupAdmissionStore` 側に積ませない — 単一表のストアが別ポートの表へ書くことになり memory アダプターの表ごとの独立性が崩れるうえ、適合スイートも 2 ポートの結合を検証する形になる。両ポートとも `ScopeUnitOfWorkContext` に載るので、ユースケースが同一 UoW で `markCompleted(operationId, retainUntil)` と `scopeTaskScheduler.schedule({ kind, operationId: 決定的導出, dueAt: retainUntil })` を並べれば `spec/database/index.md` の「このcommitと同じUoWで登録する」を満たせる。`application/ports/scopeCleanupAdmissionStore.ts` の JSDoc（「Completion stores (in the same UoW) a prune task」）は、この主体の違いを反映して書き直す。

**駆動側（誰がどの scope を叩くか）には新しいポートを 1 つ足す。** `ScopeTaskScheduler` は `ScopeUnitOfWorkContext` に載る＝`scopeUnitOfWorkProvider.run(scope, fn)` に **scope を渡さないと触れない**。ところが `ScopeUnitOfWorkProvider` は scope を引数に取るだけで列挙 API を持たず、`ScopeRouter` も `forScope` / `resolveNote` のみ、`WorkerContainer` にも scope の一覧は無い（`MemoryBackend.scopeEntries()` はアダプター内部のメソッドで worker からは見えない）。CF 実装ではこれは DO Alarm＝scope 自身が起きるので問題にならないが、in-process ランナーに置き換えた瞬間に「期限が来た scope task を持つ scope を列挙する」手段が要る。当初の但し書き（「ポート自体は追加しない」）はこの点を見落としていたので撤回する。

`application/ports/scopeTaskQueue.ts` に `ScopeTaskQueue.listDue(now, limit): Promise<readonly { scope: ScopeKey; kind: string; operationId: string }[]>` の 1 メソッドだけを置き、`WorkerContainer` に載せる。**読み取り専用で claim も処理もしない** — claim は従来どおり scope UoW 内の `ScopeTaskScheduler.claimDue` が行う。ランナーは `listDue` の各行について `scopeUnitOfWorkProvider.run(scope, …)` を開き、その中で claim → 再投入 → `complete` / `backoff` を行う。

代替案（running な `distributed_operations` から `userId → user:{id}` を導いて polling する）は新ポートを増やさずに済むが、**`identity.personalBarrierPruneContinued` は operation が `completed` になった 120 日後に期限が来る**ため、running 集合からは導出できない。この 1 種類のために例外規則を作るより、汎用の列挙ポートを 1 つ持つほうが #3 以降の participant にも素直に効く。#11 の DO Alarm 実装では `listDue` は空配列を返す（scope 自身が起きるので中央からの列挙が不要）。

`pruneExpiredAuthState` の cron 配線は本 Issue のチェックリスト外なので引き続き見送る（Issue #15 の担当）。

### Consequences
- 良い点: `deleteAccount` が `pnpm dev` 上で実際に完走し、マニュアルテスト TC-14 が実行可能になる。継続の契約（冪等・checkpoint）がテストで固定され、#11 の差し替えが運搬路に閉じる。`listDue` が読み取り専用なので、claim の直列化規律（scope UoW の中だけ）は崩れない。
- トレードオフ: ランナーが単一プロセスなので、削除中にプロセスが落ちると再起動まで継続が止まる（回復は次回起動時のタスク再取得で成立する設計にする）。in-process 実行はレイテンシーの観測値が本番と乖離する。ポートが 1 つ増え、#11 では「中央からは列挙しない」実装（空配列）を書く必要がある — 実装が空になるポートを持つことの説明責任は JSDoc に書く。

---

## ADR-006: 削除 status ticket は presentation が署名し、application は operationId + status しか返さない

### Status
Proposed

### Context
`deleteAccount` は要求受理と同時にセッションを失効させるため、利用者は自分の削除進捗を読む手段を失う。`spec/presentation/index.md` は「202 Accepted + 30 分の署名済み status ticket」を規定するが、ticket の署名・検証・スコープ制限をどの層が持つかは書かれていない。application が ticket を作ると、application が署名鍵と transport 形式（HTTP ヘッダー / Cookie / body）を知ることになり、CLAUDE.md の「エラーは transport 関心を持たない」と同型の原則に反する。

### Decision
- application の `deleteAccount` は `{ operationId, status }` のみを返す（spec の出力どおり）。進捗照会は `getAccountDeletionStatus(operationId)` 相当の読み取り経路として application に置く。
- ticket の発行・検証は presentation（`apps/web/app/presentation/deletionTicket.ts`）が担う。**鍵は composition root が供給し、presentation は渡されたものを使う**。`spec/presentation/index.md` は「秘密・鍵は `AppConfig` から供給する」と定めており、これは「配備が供給する設定として渡す」という趣旨である。実装側の `AppConfig` 型（`di/types.ts`）は `appUrl` / `siteName` / `defaultTitle` / `defaultDescription` / `twitterHandle` / `themeColor` の 6 項目で、`RequestContainer.config` として `head.ts` が SSR の `<meta>` を組み立てるための器になっている — ここへ秘密を混ぜるのは筋が悪い。一方 SharePass の鍵は既に `MemoryRuntimeOptions.shareTokenKeyRing`（composition root のオプション、既定 `ephemeralKeyRing()`）から供給されており、これが本リポジトリにおける「配備が鍵を供給する形」の先例である。**削除 ticket の鍵も同じ経路に揃える**: `di/serverNode.ts` の env スキーマが `DELETION_TICKET_KEY` を読み → `createMemoryRuntime({ deletionTicketKeyRing })` → `RequestContainer.deletionTicketKeyRing` として presentation に届く。`presentation/deletionTicket.ts` は `process.env` を読まない。**未設定でも起動は失敗させず、プロセス毎のランダム鍵にフォールバックする** — `shareTokenKeyRing` の既定と揃え、再起動でデータごと消える memory ランタイムの性質に合わせる。
  - 当初案（presentation が `process.env.DELETION_TICKET_KEY` を直読みする）は撤回する。先例として挙げていた `presentation/session.ts:32` は `process.env.NODE_ENV`（Cookie の `secure` フラグ）1 箇所だけで**秘密ではなく**、これを根拠にすると秘密の供給経路が composition root と presentation の 2 系統に割れる。
  - 「実装の `AppConfig` 型は SSR メタ専用で、鍵は composition root が供給する」という点は spec の文面（`AppConfig` の表に鍵を並べる）とずれるので、ステップ 34 の spec-sync 候補に加える。
- ticket は `operationId` と `expiresAt` のみを含み、**その 1 件の status 読み取り以外の権限を持たない**。P-25 の進捗ポーリングはこの ticket を添えて status 読み取り server function を呼ぶ。
- ticket は HttpOnly Cookie ではなく応答 body で返し、クライアント（"use client" island）が保持する。Cookie にするとセッション破棄と同時に別の自動送信クレデンシャルを増やすことになり、SharePass / ExportTicket の扱い（Cookie にしない）と不揃いになる。
- **削除実行後はナビゲートしない**。`AccountMenu` のサインアウトは `window.location.assign("/")` によるフル遷移（#1 ADR-028 — router キャッシュを物理破棄する意図的な設計）だが、P-25 で同じことをすると ticket を保持している island がその場でアンマウントされ、正常系の 1 手目で進捗照会の手段が消える。P-25 では「即時サインアウト」をサーバー応答の `Set-Cookie`（セッション Cookie 破棄）だけで実現し、画面は P-25 に留まってポーリングを続け、**完了表示に到達してから**フル遷移する。ticket は `sessionStorage` にも退避してリロードから復帰できるようにする。
- **P-25 の削除実行は `router.invalidate()` を行わない、三層規律の唯一の例外**とする。CLAUDE.md は「全てのミューテーションは `router.invalidate()` で再基底化する」と定めるが、この操作は同じ応答でセッションを失効させるため、invalidate するとローダーが `UNAUTHENTICATED` で落ちて進捗表示ごと消える。再基底化の役割は、完了表示に到達したあとのフル遷移（`window.location.assign("/")`）が担う。P-25 以外の新規画面（P-21 / P-22 / P-04 / P-05）は通常どおり `router.invalidate()` を呼ぶ。

### Consequences
- 良い点: application が transport / 署名を知らないまま、セッション失効後の進捗照会が成立する。既存の 2 種の ticket と同じ扱い（Cookie にしない・鍵は配備側の composition root が供給）に揃い、`AppConfig` は SSR メタデータの器のまま保たれる。必須 env は増えない（未設定はプロセス毎ランダム鍵）。
- トレードオフ: 削除実行から完了表示までの間、router キャッシュにはサインアウト済みセッションの RSC ペイロードが残る（同じタブの同じ利用者しか見られない状態で、離脱時のフル遷移で破棄される）。鍵が未設定の配備ではプロセス再起動で ticket が失効するので、P-25 は「ページを閉じても削除は進む」旨を表示して縮退させる。

---

## ADR-007: OAuth コールバックは 1 ルートで 2 ユースケースへ分岐させる（`state` の intent が唯一の分岐根拠）

### Status
Proposed

### Context
`/auth/callback/:provider` は `completeOAuthSignIn`（intent: signIn）と `linkOAuthIdentity`（intent: linkIdentity）と、後続スライスの `completeIntegrationOAuth`（intent: integration）の 3 つに繋がる。分岐根拠として URL のパス・クエリー・現在のセッション有無のいずれかを使う案があるが、いずれも攻撃者が操作できる面（クエリー）か、フロー開始時点と一致する保証のない面（セッション）を分岐に使うことになる。

### Decision
分岐根拠は `OAuthStateStore.take(state)` が返した `OAuthFlowState.intent` **のみ**とする。ルート側は state を取り出して 1 本の server function に渡し、application 側のディスパッチャーが intent でユースケースを選ぶ。`take` は 1 回消費（原子的）なので、intent はフロー開始時にサーバーが決めた値であることが保証される。パスの `:provider` は表示・ログ用途に留め、`state` の provider と不一致なら `OAUTH_STATE_INVALID` に倒す。

### Consequences
- 良い点: 「サインイン中かどうか」でユースケースが変わる曖昧さが消え、TC-identity-121（intent: signIn の state で linkOAuthIdentity を呼ぶ）が構造的に拒否される。#4 の integration intent が同じルートに追加できる。
- トレードオフ: intent ごとに応答の形（セッション Cookie 発行 / 識別子返却 / 連携完了）が変わるので、server function の戻り値が判別共用体になる。

---

## ADR-008: サインアウトは ADR-008（#1）の Cookie 破棄 glue を正規実装へ置き換える

### Status
Proposed

### Context
Issue #1 の ADR-008 は、UC-identity-009 がチェックリスト外だったため、サインアウトを presentation の Cookie 破棄のみに留めた。本 Issue は UC-identity-009 をチェックリストに含む。

### Decision
`signOut`（セッショントークンから行を解決して削除、不在・不正でもエラーにしない）を application に実装し、`AccountMenu` のサインアウトはこれを呼ぶ。ADR-028（#1、フル遷移で router キャッシュを破棄する）は維持する。`signOutOtherSessions` は同じ画面（P-22）から呼ぶ別ユースケースとして実装し、`authEpoch` バンプ + 現セッションの `refreshAuthEpoch` + 残渣掃除タスクの発行という spec どおりの形にする。

### Consequences
- 良い点: #1 が意図的に残した縮退が解消し、セッション行が期限まで残る問題が消える。
- トレードオフ: なし（#1 の ADR-008 は本 ADR で supersede）。

---

## ADR-009: 投影は「発行側まで」を本 Issue の検証境界とする

### Status
Proposed

### Context
`updateProfile` の TC は期待結果に投影の**購読側**を含むものが混ざっている。TC-identity-272「公開ページの表示に反映される」、273「`projectNoteChanges` が読み取りモデルの著者表示名を更新する」、278「購読側は初回設定と変更を区別せず現在値で上書きする」、276「`note_routes(created_by)` の bounded fan-out が各 Note を再投影する」、277「`searchPublicNotes` の結果に著者リンクが出る」、289「旧ハンドルの URL は『見つかりません』になり、新しい URL で到達できる」。`projectNoteChanges` は `spec/usecases/note.md` の UC で本 Issue のチェックリスト外、`/@handle` の公開ページと公開検索は #9。ところが当初の計画は 276/277 だけを見送り、272/273/278 を実装対象にしており、同じ依存を持つ行の扱いが揃っていなかった。`Local/PublicNoteProjectionWriter` のポートと memory 実装は #1 で完成済みなので、「書き込み契約」だけは本 Issue でも直接検証できる。

### Decision
線を「イベントの発行側か、購読側か」で引く。

- **本 Issue の検証範囲**: ユースケースが発行するイベントの**有無と payload**（`identity.user.profileUpdated` は表示名が変わったときだけ発行、`identity.user.handleChanged` は初回設定でも `previousHandle: null` で無条件発行、変更時は旧ハンドルを載せる）。加えて、投影ポートの**書き込み契約**（`replaceSnapshotIfNewer` に古い `authorVersion` を渡しても旧値が復活しない）は、ポートを直接叩いて検証してよい（TC-identity-082 はこの形で消化する）。
- **見送り**: 購読側の UC（`projectNoteChanges` の実行）と、読み取りモデル / 公開ページ / 公開検索の表示に到達して初めて判定できる行 — TC-identity-276（fan-out 再投影 + workspace 所有ノート）、277（公開検索）、289（`/@handle` の到達性）。マニュアル TC-10 手順 5〜7 と TC-35 も同じ理由で skip。

AC-18 の対象は TC-identity-272..275, 278..288, 290..293（19 行）とし、AC 本文に検証境界を明記する。

### Consequences
- 良い点: 同じ依存を持つ行が同じ判断になり、「実装したことにしたが読み取りモデルは誰も更新しない」という部分実装が構造的に起きない。発行側の契約（payload・発行有無）は本 Issue で固定されるので、購読側スライスはそれを入力として実装できる。
- トレードオフ: TC-272/273/278 は spec の期待結果の一部（表示への反映）を本 Issue では確認しない。AC 本文と Issue コメントに検証境界を書かないと「通っているのに見えない」という誤解を生む。

---

## ADR-010: PKCE の `codeChallenge` 導出は `SignInOAuthClient` に置く

### Status
Proposed

### Context
`SignInOAuthClient.buildAuthorizationUrl` は `codeChallenge: string` を引数で受ける形（spec/domains/identity.md と実コードが一致）で、`spec/usecases/identity.md` の `startOAuthFlow` は「`state` と `codeVerifier` を `SecureTokenGenerator.issue` で作り、`codeChallenge` を算出する」と書く。しかし application 層に SHA-256 の導出手段は無く、最も近い `SecureTokenGenerator.hashOf` は `TokenHash`（memory 実装では hex 文字列）を返す。PKCE S256 は `base64url(sha256(verifier))` なので、このまま実装すると「アダプターのハッシュ表現に暗黙依存した hex → bytes → base64url 変換」が application 層に入る。

### Decision
`SignInOAuthClient` に `deriveCodeChallenge(codeVerifier: string): string` を足し、Google / dev IdP の両アダプターが S256 を実装する。application は `codeVerifier` を `SecureTokenGenerator.issue` で作り、challenge の算出はこのポートに委ねる。適合スイートで「43 文字の base64url を返す / 同じ verifier からは同じ値 / 異なる verifier では異なる値 / `buildAuthorizationUrl` の URL に `code_challenge_method=S256` が含まれる」を固定する。

`SecureTokenGenerator` を拡張しない理由: あちらは「利用者に渡す秘密とその保存ハッシュ」を担うポートで、保存表現（`TokenHash`）が実装の自由。PKCE の challenge は保存用ハッシュではなく**プロトコルが規定する表現**なので、プロトコルを知っているアダプターに置くのが正しい所有者になる。

### Consequences
- 良い点: application 層がハッシュ表現を一切知らずに済み、S256 以外の method を使うプロバイダーが来てもアダプター内で完結する。
- トレードオフ: spec/domains/identity.md のポート定義に 1 メソッド増える（spec-sync 候補）。ポートが「URL 構築 + コード交換 + challenge 導出」の 3 責務になるが、いずれも同じ OAuth プロトコル結合の範囲に収まる。

---

## ADR-011: 配信 URL の組み立ては `ObjectStorage` に閉じる

### Status
Proposed

### Context
`storeAvatar` の出力 DTO は `url: string` だが、本 Issue のポート案は `put` / `get` / `delete` だけで、URL は「配信ルートのパスで組む」としていた。これだと application が `apps/web` のルート形（`/storage/$key`）を知ることになり、#11 で R2 の公開 URL に差し替えるとき usecase に波及する。spec の `ObjectStorage` には `createDownloadUrl(key, { fileName, expiresInMs })` があるが、これは 5 分の期限つきダウンロード URL（`issueDownloadUrl` 用）で、プロフィールに埋め込む長命なアバター URL には使えない。

### Decision
`ObjectStorage` に `publicUrl(key: ObjectKey): string` を足し、`storeAvatar` は `objectStorage.publicUrl(objectKey)` を返す。memory アダプターは配信ルートのパス（`/storage/{key}`）を返し、R2 アダプター（#11）は公開ドメインの URL を返す。あわせて削除メソッド名を spec に合わせて `deleteMany(keys)` にする（削除の唯一の経路が `storage.fileDeleted` のまとまりを受ける `deleteStoredObjects` なので、1 件用の `delete` は置かない）。

### Consequences
- 良い点: 配備ごとの URL 形がアダプターに閉じ、#11 の差し替えが usecase に波及しない。期限つき URL（`createDownloadUrl`）と公開 URL（`publicUrl`）の用途が型で分かれる。
- トレードオフ: spec/domains/storage.md の `ObjectStorage` に 1 メソッド増える（spec-sync 候補）。`publicUrl` は「その鍵が公開配信される」ことを前提にするので、非公開ファイルに使わない規律が要る（本 Issue の呼び出し元は `storeAvatar` のみ）。

---

## ADR-012: scope 平面の operation 重複排除は専用ポートを新設する

### Status
Proposed

### Context
TC-identity-089 は「同じ operation ID で再配送され、`applied_operations` により二重適用されず再開する」を期待結果に持ち、`spec/database/index.md` は `applied_operations` を「note move・membership command・account deletion の operation ID を scope ごとに重複排除する」scope DO の表と定める。既存の `IdempotencyStore` は `markProcessed(consumer, eventId)` で `EventId` をキーにし、`WorkerContainer` にしか無く、契約上「本処理と同じ plane の同じ UoW」を要求する。scope の cleanup コマンドは event ではなく operationId + commandKey で配送されるので、そのままでは使えない。

### Decision
`application/ports/appliedOperationStore.ts` に `AppliedOperationStore` を新設し、`markApplied({ operationId, commandKey }): Promise<boolean>`（未適用なら記録して `true`、適用済みなら `false`）を持たせて `ScopeUnitOfWorkContext` に載せる。`IdempotencyStore` の契約は広げない — キーの意味（イベント配送の重複 vs. operation コマンドの重複）も配置される平面も違い、片方を汎用化すると両方の JSDoc の約束が緩む。

**spec の `applied_operations` との突き合わせ**（`spec/database/index.md`）:

- spec の PK は `operation_id` **単独**。本ポートは `(operationId, commandKey)` の 2 値を受けるが、**保存キーは `appliedOperationId = sha256(operationId + ":" + commandKey)` の 1 列に畳む**。`scheduled_tasks.operation_id` が「生成元の安定 ID から決定的に導出する」と定められているのと同じ導出規則で、#11 で D1 実装に載せるときも PK の形が変わらない。
- spec の `result`（NOT NULL、「同じ command の再試行へ返す JSON」）は**持たない**。本 Issue の scope cleanup コマンドは値を返さず、ack の正本は manifest 側の receipt なので、保存しても読む者がいない。値を返すコマンド（note move 等）を #7 が足す時点で `result` を加える。この欠落は逸脱としてステップ 34 の spec-sync 候補に載せる。
- spec の `applied_operations` は `kind = 'accountDeletionBarrier'` の行として **barrier 本体**も持つが、コード側でそれを担うのは既存の `ScopeCleanupAdmissionStore` である。つまり spec の 1 表がコードでは 2 ポートに分かれる。これも spec-sync 候補に載せる。

### Consequences
- 良い点: scope cleanup コマンドの冪等性が「本処理と同一 UoW の 1 行 insert」として型で表現され、適合スイートで固定できる。PK が単一列なので spec / #11 の D1 実装と同形。#3 / #5 / #4 が自分の cleanup 参加者を足すときも同じポートを使える。
- トレードオフ: 重複排除の仕組みが 2 つ（event 用 / operation 用）になる。どちらを使うかの判断基準を両ポートの JSDoc に書く必要がある。`result` を持たないので「保存済み結果を返す」形の再試行は本 Issue では成立せず、再試行は必ずコマンドの再実行になる（本 Issue のコマンドはすべて冪等なので成立する）。

---

## ADR-013: `DistributedOperationStore` を新設して削除の control plane を持たせる

### Status
Proposed

### Context
`spec/domains/index.md` は「scope をまたぐ note move と account deletion は `DistributedOperationStore` が持つ operation ID / state で再開する」と定め、`spec/usecases/identity.md` の deleteAccount 手順 2 は `distributed_operations(kind, partitionKey: userId, requestKey: requestId, state)` の作成を要求する。ところがこのポートは `packages/core/src` に 1 行も存在しない。#1 が完成させたのは `AccountDeletionManifestStore` / `ScopeCleanupAdmissionStore` / `GlobalMaintenanceRunStore` で、manifest header（operationId / userId / status / cursor / receipts / terminalAt / retainUntil）には `requestKey` が無く、利用者ごとの rejected attempt 件数も持てない。つまり「#1 で土台は完成済み、本 Issue はオーケストレーションの記述だけ」という前提が control plane については成り立たない。

### Decision
`application/ports/distributedOperationStore.ts` を新設し、memory 実装 + 適合スイート + `ConformanceBackend` 配線 + `MemoryBackend` の表追加まで本 Issue のテーマ A（削除の実装より前）で行う。`GlobalUnitOfWorkContext` に載せる（手順 2 が `beginDeletion` と同一 UserId shard transaction を要求するため）。契約:

- `beginOrResume({ kind, partitionKey, requestKey, payload })` — 同一 requestKey は既存 operation を返す / running があれば別 requestKey でも既存を返す / rejected 後の新 requestKey だけが新規を作る。返り値は `{ operation, resumed: boolean }`。**`terminalCountInWindow` は返さない**（下記のとおり判定は作成の前に済ませる）。
- `countTerminalSince(kind, partitionKey, since: Date): Promise<number>` — 保持中の terminal 行を数える**観測専用**の読み取り。しきい値も窓幅も知らない。
- `markState(operationId, state)` / `findByOperationId(operationId)`。
- `deleteTerminal(operationId)` — terminal prune が manifest header と同一 transaction で消せる形。
- **`payload`** — 新規作成時に固定され、resume では**上書きされない**状態機械の入力（`spec/database/index.md`「payload は状態機械の入力を固定し、再開時に利用者入力を読み直さない」）。accountDeletion では uniqueness key を載せる（ADR-020）。適合スイートは「同じ requestKey で payload 違いを渡しても初回の値が返る」を固定する。

`beginOrResume` の戻り値に観測値を混ぜない理由: 混ぜると「作ってから判定する」形にしかならず、`spec/usecases/identity.md` 手順 2 の「8 件なら新 operation を作らない」に反する（作成の巻き戻しに依存する）。ポート面は 1 通りに固定する。

**業務規則（120 日 / 8 件）はポートに置かない。** 当初案はこの判定をポート契約＝各アダプター実装に置いていたが、`IdentityUniqueDirectory` が担う一意性（構造的制約であり、実装が担保するのが自然）とは性質が違い、**しきい値と保持期間は業務上の決定**である。アダプター実装に置くと同じ数値が memory / D1 / 将来の実装へ複製され、変更が 3 箇所に散る。したがって:

- ポートは観測値（`countTerminalSince`）だけを返す。適合スイートは「`since` 以降の terminal 行を正しく数える」ところまでを固定し、数値 8 と 120 日は焼き込まない。
- 判定は `domain/identity/services/accountDeletionRetryPolicy.ts` に置く。`retentionWindowMs`（120 日）と上限（8）はここが正典で、`ensureRetryable(count)` が超過時に `BusinessRuleError(AccountDeletionRetryLimitExceeded)` を投げる。境界（7 / 8 / 9）はドメインの単体テストで見る。
- 受理経路は「`countTerminalSince(now - retentionWindow)` で数える → `ensureRetryable` で判定 → `beginOrResume` で作る」の順に呼ぶ。resume（既存 operation の再開）の場合は新しい terminal 行を増やさないので、判定は「新規を作りうる場合」だけに掛かる。steps.md のステップ 6（ポート実装）とステップ 28（受理経路）はこの順序・この API に揃える。
- **本 Issue では `AccountDeletionRetryPolicy` / `AccountDeletionRetryLimitExceeded` は到達不能な先行実装**である。しきい値が発火するには同一利用者の terminal 行が 8 件必要だが、`completed` は 1 件しか作れず（完了＝アカウント消滅）、`rejected` を作る経路は #3 依存で見送っている。根拠行 `TC-identity-052` も見送り側にある。したがってドメインサービス・エラーコード・文言辞書エントリは実装するが、**本 Issue の受け入れ基準はドメイン単体テスト（7 / 8 / 9 の境界）とポート適合スイート（`countTerminalSince` の計数）までしか要求しない**。この点は plan.md の縮退に記録し、行としての検証は #3 の `TC-identity-052` で行う。
- **`IdentityErrorCode` に `AccountDeletionRetryLimitExceeded` を追加する。** 現行 enum は 12 値でこの値を持たない（steps.md の「`IdentityErrorCode` の追加は不要」は誤りだったので訂正済み）。
- 計数を manifest header ではなく `distributed_operations` に置いたこと（spec/database はこの計数を `account_deletion_manifests` の `(user_id, state, expires_at)` 索引に割り当てている）は、ステップ 34 の spec-sync 候補に加える。

### Consequences
- 良い点: TC-identity-050 / 053 / 105 が「オーケストレーションの書き方」ではなく**ポートの契約**として固定され、適合スイートで検証できる。しきい値がドメインの 1 箇所に集まるので、バックエンドを増やしても値が複製されない。note move（#7）も同じポートを再利用できる。
- トレードオフ: テーマ A に 1 ステップ増え、`MemoryBackend` の表が 1 つ増える。ポート境界を 1 つ増やす分、deleteAccount 受理経路が触るストアは 4 つ（distributed operation / manifest / admission / user）になる。件数の観測とその判定が別レイヤーに分かれるので、受理経路が「数える → 判定 → 作る」の順を守る責任を負う（同一 transaction 内なので競合は起きない）。なお TC-identity-052（8 件上限そのもの）は `rejected` を作る経路が #3 依存のため行としては見送りで、本 Issue で検証するのはドメインサービスとポートの契約まで。

---

## ADR-014: `storeAvatar` の workspace 主体は `BusinessRuleError(InsufficientRole)` で拒否する

### Status
Proposed

### Context
`storeAvatar` は `subjectType: "user" | "workspace"` を受け、workspace の場合は `manageWorkspace` 権限の確認を要求する。`WorkspaceAuthorization` は `domain/workspace/services/workspaceAuthorization.ts` に interface だけが存在し、実装は #3。本 Issue の TC-storage-168/169（workspace アイコン）は見送りだが、workspace 主体で呼ばれたときの振る舞いは決めておく必要がある。当初案は `ForbiddenError` に倒すとしていたが、spec/usecases/storage.md のエラー表は権限不足を `BusinessRuleError(InsufficientRole)` と定めている。

### Decision
workspace 主体は **`BusinessRuleError(InsufficientRole)`** で拒否する。`WorkspaceAuthorization` が未注入の間は「権限を確認できない = 権限なし」として無条件に拒否し、#3 が実装を注入した時点で分岐の中身だけが本物になる（エラー種別も呼び出し側の扱いも変わらない）。

### Consequences
- 良い点: エラー種別が最初から spec どおりなので、#3 での書き換えが「判定ロジックの差し替え」だけで済み、presentation の文言辞書も作り直さない。安全側（拒否）に倒れている。
- トレードオフ: #3 が来るまで workspace アイコンは常に失敗する。縮退として Issue コメントに記録する。

---

## ADR-015: `IdentityUniqueDirectory` に active 予約の key ベース解放を足す

### Status
Proposed

### Context
実コードの `IdentityUniqueDirectory`（`domain/identity/ports/identityUniqueDirectory.ts`）は `resolve` / `reserve` / `activate` / `release(operationId)` の 4 メソッドで、memory 実装の `release` は `state === "reserved"` の行だけを消し **`active` 行は素通りする**。`DirectoryRow.state` も `"reserved" | "active"` の 2 値で、`spec/database/index.md` の `identity_unique_reservations.state CHECK IN ('reserved','active','releasing')` にある `releasing` が無い。

一方、本 Issue の 3 経路はいずれも **active な予約の解放**を必要とする。

- `removeIdentity`（`spec/usecases/identity.md` 手順 4）— global consumer が OAuth event の `providerAccountKey` を使って reservation を `releasing → release` する。
- `updateProfile`（同 手順 4）— 新 handle を activate した後、旧 handle を `releasing` へ進める。
- `deleteAccount`（同 手順 4 の global cleanup）— handle / email / 最大 8 件の providerAccount 予約を finalize 時に `releasing → release` する。

さらに解放は **`normalizedKey` を鍵に行う必要がある**。予約行の `operationId` は `sha256(親operationId + ":" + kind + ":" + normalizedKey)` で、旧予約の親 operation は過去の操作なので、新しい操作から `operationId` を導出できない。ステップ 1 で受領（`IdentityRemovalReceipt`）に `providerAccountKey` を持たせる設計はここまで正しいが、それを渡す先の API が存在しない。現状のポートのままでは TC-identity-093 / 094（削除後の同一メール・同一 provider account での再登録）は構造的に通らない。

### Decision
ポートを次のとおり拡張する。**ステップ 1（テーマ A）で行い、単独コミットで既存の適合スイートを緑にしてから先へ進む**（19 / 23 / 30 の 3 ステップが共有するため）。

- `beginRelease({ kind, normalizedKey, expectedUserId, operationId }): Promise<void>` — `active` 行を `releasing` へ進める。所有者（`userId`）不一致・行不在は **no-op**（他人の予約を奪えない / 再送で壊れない）。同一 `operationId` の再送は冪等。**このとき行の `operationId` を渡された解放 operation の ID へ差し替える**（memory 実装の `release(operationId)` は行の `operationId` 一致で対象を引くため、差し替えないと後続の `release` が対象を見つけられず `releasing` のまま残り、その key を二度と reserve できなくなる）。この差し替えは契約であり、適合スイートで固定する。
- `release(operationId)` を `reserved` に加えて `releasing` の行も削除する形へ広げる。既存の「失敗時に reserved を消す」用法は変わらない。
- `DirectoryRow.state` に `"releasing"` を追加する（spec/database と同形になる）。
- 適合スイート（`adapters/conformance/identityUniqueDirectory.ts`）に「active → `beginRelease` → `release` の後は別 user が同じ key を `reserve` できる」「`releasing` の間は別 user の `reserve` が通らない」「所有者違いの `beginRelease` は効かない」「同じ `operationId` の再送で冪等」を追加する。

key ベースの 1 本（`release({ kind, normalizedKey, expectedUserId, operationId })`）にまとめる案も検討したが、既存の `release(operationId)` の呼び出し側（予約サガの失敗時解放）が全部書き換わるうえ、2 相（`releasing` を挟む）という spec の状態機械が型から消える。2 メソッドに分ける。

**`deleteAccount` における解放の位置**（ADR 内の説明が spec と逆向きに読めた点の確定）。`removeIdentity` 手順 4 の「正データ削除後にだけ解放する」は **removeIdentity の規則**であって、`deleteAccount` にそのまま適用しない。`spec/usecases/identity.md` 手順 4 の global cleanup は「User の handle / email と最大 8 件の providerAccount reservation を **finalize 時に** releasing→release する」、手順 5 の finalize continuation は「**全 uniqueness release を含む必須 receipt を検査する。揃えば** … PII を削除し」と定める。つまり順序は

1. global cleanup phase が `beginRelease` → `release` を実行し、完了時に `uniquenessRelease` receipt を積む
2. finalize continuation が必須 receipt 集合（ADR-017）を検査する
3. 揃っていれば directory edge / PII を削除し `finalizeDeletion` → `identity.user.deleted`

であり、**解放は finalize の前**（receipt を積む側）。これを逆にすると receipt が永久に揃わない循環になる。steps.md ステップ 30 の本文もこの順序で書く。

### Consequences
- 良い点: `removeIdentity` / `updateProfile` / `deleteAccount` の 3 経路が同じ API で解放でき、2 相（`releasing` を挟む）の状態機械が適合スイートで固定される。TC-identity-093 / 094 / 184 / 278 が構造的に通るようになる。
- トレードオフ: #1 が完成させた既存ポート・既存 memory 実装・既存適合スイートに手が入る。本 Issue で #1 の完成物を書き換えるのは、ここに加えて `ScopeCleanupAdmissionStore`（ADR-002 / ADR-018）と `AccountDeletionManifestStore`（ADR-017）の 3 ポート。いずれも「単独コミットで既存スイートを緑にしてから先へ進む」規律で扱う。`state` が 3 値になるので、`resolve` の「`active` だけを返す」判定を `releasing` も含めて見直す必要がある。

---

## ADR-016: アバター URL は `publicUrl` のアプリ相対パスを `updateProfile` 経由で `User.avatarUrl` へ運ぶ

### Status
Proposed

### Context
`spec/usecases/storage.md` の `storeAvatar` は `{ fileId, url }` を返すだけで、`User.avatarUrl` を書くのは `updateProfile`（入力 `avatarUrl: string | null`、バリデーションは「**同一オリジンの URL**」— `spec/usecases/identity.md`）である。一方 ADR-011 の `ObjectStorage.publicUrl` は memory 実装で `/storage/{key}` という**相対パス**を返す設計にした。この 2 つの関係（相対パスを「同一オリジンの URL」として受理するのか、`appUrl` を前置して絶対 URL にするのか）と、アップロード結果が `User` に到達する経路が計画に無く、決めないままだと「アップロードは成功するがプロフィールに反映されない」「保存時に弾かれる」という形で P-21 とマニュアル TC-10 / TC-36 が落ちる。

### Decision
- **保存する値はアプリ相対パス**（`/storage/{key}`）とする。`updateProfile` の `avatarUrl` 検証は VO 構築（`AvatarUrl`）で行い、受理するのは (a) `/` で始まりスキームも `//` も含まないアプリ相対パス、(b) `AppConfig.appUrl` と同一オリジンの絶対 URL、の 2 つ。`appUrl` は VO へ引数で渡す（VO が設定を読まない）。相対パスを正とするのは、配備のオリジンが変わっても保存済みの値が壊れないため。#11 で R2 の公開ドメインへ移るときは (b) の絶対 URL 形が使われる。
- **到達経路は P-21 のフォームが 2 段で運ぶ**: `uploadAvatarFn`（`storeAvatar`）が返した `url` を、同じフォームの `avatarUrl` として `updateProfileFn`（`updateProfile`）へ渡す。`storeAvatar` に `User` を書かせない（spec の出力 DTO を変えない / Storage が Identity を書かない）。
- **旧アイコンの削除**（spec 手順 4 / TC-storage-174）は `StoredFileRepository.listByOwner(owner, "avatar", pagination)` の purpose 絞り込みで引く（形は ADR-022）。`deleteFilesByOwner`（TC-storage-049「用途によらずすべて削除される」）は `purpose: null` で呼ぶ。

### Consequences
- 良い点: 配備ごとの URL 形が `ObjectStorage` アダプターに閉じたまま、`User.avatarUrl` の値が配備非依存になる。Storage → Identity の書き込み依存が生まれない。`avatarUrl` の検証が VO の 1 箇所に閉じる。
- トレードオフ: P-21 のアイコン更新が 2 回のサーバー往復になる（アップロード → プロフィール保存）。アップロードだけ成功して保存前に離脱すると、参照されない `StoredFile` が 1 件残る（次回のアイコン差し替え時に「既存アイコン」として消えるとは限らない — orphan 回収は #6 の担当なので、縮退として扱う）。`sumSizeByOwner` には算入されるので `recalculateStorageUsage` の値には現れる。

---

## ADR-017: finalize の必須 receipt 集合も composition root の宣言から導出する

### Status
Proposed

### Context
`AccountDeletionManifestStore.allRequiredAcknowledged` は `markCompleted`（成功終端）と成功側 `compactItems` の前提条件で、実コードの memory 実装（`adapters/memory/repositories/accountDeletionManifestStore.ts` の `REQUIRED_FINALIZE_RECEIPTS`）は `personalCleanup` / `authResidue` / `externalConnections` / `jobHistory` / `uniquenessRelease` の 5 receipt を**ハードコードで必須**にしており、適合スイート（`adapters/conformance/accountDeletionManifestStore.ts`）も同じ集合を焼き込んでいる。本 Issue には Integration（#4）も Job（#5）も無いので `externalConnections` / `jobHistory` を ack する主体が存在せず、このままでは finalize に到達できない（TC-identity-090 / 091 / 102 / 103、AC-26 / AC-27 / AC-29 が構造的に落ちる）。ADR-002 が宣言集合化したのは `ScopeCleanupAdmissionStore` の personal component だけで、global 側の receipt は未決だった。

### Decision
ADR-002 と同型の判断を `AccountDeletionManifestStore` にも適用する。

- `application/cleanup/participants.ts` に personal component の全数宣言と並べて、**global receipt の全数宣言** `Record<Exclude<AccountDeletionReceipt, "personalAbort">, GlobalParticipant | AbsentReason>` を置く。`personalAbort` は rollback 側の receipt で finalize の必須集合には入らないため対象外にする。
- 本 Issue の `GlobalParticipant` は `personalCleanup`（scope→global ブリッジ — ADR-018）/ `authResidue`（`authResidueCleanupConsumer`）/ `uniquenessRelease`（global cleanup の解放 — ADR-015）の 3 つ、`AbsentReason` は `externalConnections`（#4）/ `jobHistory`（#5）。必須集合は `GlobalParticipant` の側から導出する。
- memory アダプターのファクトリー `createMemoryAccountDeletionManifestStore(backend, { requiredFinalizeReceipts })` が宣言集合を受け取り、`REQUIRED_FINALIZE_RECEIPTS` の定数を置き換える。適合スイートは `ConformanceBackendOptions.requiredFinalizeReceipts` から同じ集合を受け取り、「宣言された全 receipt の ack で `allRequiredAcknowledged` が true / 1 つでも欠ければ false・`markCompleted` は ConflictError」という形へ一般化する（5 値固定の assert を外す）。
- ダミー ack は置かない（ADR-002 と同じ理由: 後続スライスが participant を足したときに外し忘れると「掃除したつもりで消えていない」状態が検出困難になる）。

### Consequences
- 良い点: 本 Issue の配備で finalize が到達可能になり、#4 / #5 は `AbsentReason` を `GlobalParticipant` に差し替えるだけで必須集合に入る。宣言が全数なので差し替え忘れは「`AbsentReason` が残っている」という読める形で表面化する。
- トレードオフ: #1 が完成させた manifest アダプターと適合スイートに手が入る（ADR-015 / ADR-002 と合わせて 3 ポート）。spec（5 receipt 固定）との差は spec-sync 候補に載せる。

---

## ADR-018: personal cleanup の participant は `storage` / `usage` の 2 つに絞り、`personalCleanup` receipt は cleanup dispatcher が scope→global へ渡す

### Status
Proposed

### Context
ADR-002 は本 Issue の `Participant` を `storage` / `usage` / `localProjection` / `outbox` の 4 つと宣言していたが、後 2 者を**誰がいつ ack するのか**が決まっていなかった。宣言集合が 4 のままでは `markCompleted` が永久に成立せず、TC-identity-084 / 086 / 087 が落ちる。あわせて `spec/usecases/identity.md` 手順 4 は「全 ack が揃った最後の scope-local UoW で `markCompleted` と prune task を保存し、**その commit ack を受けた後だけ** UserId shard manifest へ `personalCleanup` receipt を記録する」と定めるが、scope 平面の完了を global 平面へ運ぶ経路が計画に無かった。

実コードを確認した結果:

- `localProjection`（削除由来の local 投影 task）を積む主体は `deleteNotesForOwner` の `note.purged` 起点の投影タスクと `projectNoteChanges` で、どちらも本 Issue 外。本 Issue で personal scope の投影に触れるのは author redaction だが、これは manifest の item ack（`localRedactionAckedAt`）として**別勘定で既に finalize の必須条件に入っている**。同じ作業を barrier component としても数えると二重勘定になる。
- `outbox`（削除由来 event の必須配送 ack）を scope 平面から観測する手段が無い。`ScopeUnitOfWorkContext` に outbox の読み側は無く、memory バックエンドでは scope の event は単一 outbox 表へ flush されて global relay が配送する（`adapters/memory/scopeUnitOfWork.ts`）。本 Issue の削除由来 scope event は `storage.fileDeleted` のみで、その配送は `deleteStoredObjects` 購読者の冪等処理が担保する。

### Decision
- **`localProjection` / `outbox` は `AbsentReason`** に落とす（理由と引き継ぎ先は上記のとおり。`localProjection` → 編集・整理スライス / Note スライス、`outbox` → scope 平面の outbox 読み側ポートを持つスライス（#11 の運搬路差し替えを含む））。本 Issue の必須集合は **`storage` / `usage` の 2 つ**。TC-identity-085 の「1 component 未 ack」はこの 2 値で読み替えて検証する。
- **scope→global ブリッジ**は `application/identity/deleteAccount/cleanupDispatch.ts` が担う。cleanup phase の継続ハンドラーは (1) scope UoW を開いて component コマンドを適用・ack し、全 ack が揃っていれば同じ UoW で `markCompleted(operationId, now + 120 日)` と `identity.personalBarrierPruneContinued` の task を保存して `{ completed: true }` を返す → (2) **その戻り（＝ commit ack）を受けてから** global UoW で `accountDeletionManifestStore.acknowledgeReceipt(operationId, "personalCleanup")` と次 phase の継続イベントを保存する。2 つの UoW をネストしない（UoW 契約）。
- 応答喪失からの再駆動を冪等にするため、`ScopeCleanupAdmissionStore` に**読み取り 1 本**を足す: `describePersonalCleanup(operationId): Promise<{ status: "running" | "completed"; acknowledged: readonly PersonalCleanupComponent[] } | null>`（別 operation が所有している / receipt が無い場合は `null`）。あわせて `markCompleted` は同一 operationId ですでに completed なら**冪等な no-op**とし、`acknowledgePersonalComponent` は completed 済み receipt への再送を**成功として no-op**にする（spec の「retention 窓内の遅延重複は安全に no-op」に合わせる）。適合スイートにこの 3 点を追加する。
- これにより再駆動は「`describePersonalCleanup` を読む → running なら未 ack component だけ処理 → completed なら (2) の global ack だけを再実行」で閉じる。

### Consequences
- 良い点: 宣言集合が実際に ack される 2 つに一致するので `markCompleted` が到達可能になり、「掃除していない component を ack する」も「二重勘定」も起きない。ブリッジが 1 ファイルに閉じ、応答喪失の再開経路が読み取り 1 本で表現できる。
- トレードオフ: `ScopeCleanupAdmissionStore` に手が入る（ADR-017 / ADR-015 と同じく #1 の完成物の書き換え）。`localProjection` / `outbox` が `AbsentReason` として残るので、Issue コメントの縮退記録に必ず載せる（ADR-002 の運用）。scope commit と global ack の間で落ちると `personalCleanup` receipt だけが未記録で残るが、継続の再実行が (2) をやり直すので回復する。

---

## ADR-019: global 平面の継続イベント ID は生成元から決定的に導出する

### Status
Proposed

### Context
`spec/database/index.md` は「continuation は生成元 ID と cursor を材料にする … このため transaction の応答喪失後に同じ page を再実行しても同じ PK / outbox ID へ upsert され、重複 task も増やさない」と定める。ADR-005 が決定的導出を課したのは `ScopeTaskScheduler` だけで、global 平面の継続（`identity.accountDeletionManifestBuildContinued` / `...DispatchContinued` / `...ManifestCompactContinued`）は既存 outbox に載る。ところが実コードの outbox は保存時採番（`attachEventIds(drafts, () => backend.mintEventId())`）なので、ack transaction の応答喪失後に再実行すると継続チェーンが 2 本走る。TC-identity-096 / 101 / 105 がまさにこの経路。

### Decision
継続イベントの payload に `continuationKey: string`（`sha256` 不要 — `"{eventType}:{operationId}:{phase}:{cursor ?? "-"}"` の連結で十分）を載せ、**採番時にこのキーから `EventId` を導出する**。

- 導出関数 `mintEventIdFor(draft, mint)` を `application/execution/eventId.ts` に置き、`draft.payload.continuationKey` が文字列なら `EventId.create(continuationKey)`、そうでなければ `mint()` を返す。`EventId` は非空文字列を受ける不透明値（`domain/common/event.ts`）なので追加の制約は要らない。
- `adapters/memory/{globalUnitOfWork,scopeUnitOfWork}.ts` の `attachEventIds(drafts, () => backend.mintEventId())` をこの関数経由に差し替える。memory の `OutboxRepository.save` は `table.set(event.id, …)` なので、同じ ID の再保存は**同じ行への upsert** になり、チェーンが 2 本にならない。二重配送そのものは既存の `processed_events`（`(consumer, eventId)`）が吸収する。
- ドメイン・ユースケースのインターフェースは変えない（`collectEvents(drafts)` のまま）。「イベント ID の採番方針」は採番者＝アダプター側の関心なので、共有関数を application に置いて両アダプターが呼ぶ形にする。#11 の D1 実装も同じ関数を使う。
- 適合スイートではなくユニットテストで固定する（「同じ continuationKey の draft を 2 回 collect すると outbox 行が 1 件」）。spec との整合は取れているが、`continuationKey` という payload 項目の追加は spec-sync 候補に載せる。

### Consequences
- 良い点: 応答喪失後の再実行が継続を増殖させない、という spec の不変条件が global 平面でも成立する。変更点が 1 関数 + 2 アダプター行に閉じ、ユースケース側は payload に 1 項目足すだけになる。
- トレードオフ: 同じ ID の再保存が `processedAt` を null へ戻すので、配送済みの継続が 1 度だけ再配送されうる（消費側は冪等なので害はないが、「outbox 行の再利用」という挙動を JSDoc に書く必要がある）。payload に運搬用の項目が 1 つ増える。

---

## ADR-020: 受理経路は resume を先に決め、uniqueness key を operation payload に固定する

### Status
Proposed

### Context
実コードの `User.beginDeletion(user: ActiveUser, operationId: string, now: Date)` は **`ActiveUser` 限定**で、しかも `operationId` を引数に取る（＝ operation の決定が先）。当初のステップ 28 は `userRequest` を無条件に「`beginDeletion` → `beginOrResume`」の順で書いていたが、TC-identity-050（同一 requestId の再要求）/ 053（running 中の別 requestId）/ 042・064（応答喪失からの再実行）では User は既に `deleting` なので型が通らず、通せば `authEpoch` を二重にバンプして走行中の cleanup（「現世代を消さない」不変条件）を壊す。

もう 1 点、`spec/usecases/identity.md` 手順 4 は uniqueness 解放について「応答喪失は **operation payload に固定した key** から再開する」と定めるが、`AccountDeletionManifestStore` の item は membership / authorRoute の 2 種だけで uniqueness key の置き場が無い。email / handle は finalize で PII を消した後には再構築できないため、置き場が無いままだと応答喪失後の再開で予約が `releasing` のまま残り、TC-identity-093 / 094 の再開系が落ちる。

### Decision
- **受理経路の順序**を「(1) `countTerminalSince` → `AccountDeletionRetryPolicy.ensureRetryable`（新規を作りうる場合のみ）→ (2) `distributedOperationStore.beginOrResume` で operation を決める → (3) 新規作成時のみ `User.beginDeletion`（`deleting` + epoch バンプ）、resume 時は `user.status === "deleting"` かつ `user.deletionOperationId === operation.id` の一致確認だけ → (4) personal barrier の `beginPersonalAccountDeletion` を ack と同一ローカル transaction で受領（冪等）」に確定する。一致しない場合は `ConflictError`（別 operation が所有）。
- **uniqueness key は `DistributedOperationStore` の `payload` に固定する**（ADR-013 で `payload` を契約に追加した理由がこれ）。受理時、PII がまだ生きている時点で `{ email: normalizedEmailKey, handle: normalizedHandleKey | null, providerAccounts: readonly string[] }`（Identity は最大 8 件なので配列長は有界）を payload へ書く。global cleanup（ステップ 30）と応答喪失後の再開はこの payload だけを読み、`IdentityRepository` / PII を読み直さない。
- 適合スイートは「payload は新規作成時に固定され、resume では初回の値が返る」を固定する。

### Consequences
- 良い点: 4 つの再要求 / 再開系 TC が同じ 1 本の経路で説明でき、`ActiveUser` 限定の型が要求どおりに働く（resume で `beginDeletion` を呼べない形）。uniqueness 解放が PII 生存期間に依存しなくなる。
- トレードオフ: 受理経路が読むストアが増える（distributed operation / user / manifest / admission）。payload に PII 由来の正規化キーが 120 日残る（ハッシュ化された normalizedKey であり、`identity_unique_reservations` に同じ値が同期間残るのと同じ扱い）。

---

## ADR-021: dev IdP の同意画面はアプリ内ルートとして提供する

### Status
Proposed

### Context
ADR-003 は「資格情報のない開発機でも OAuth の全状態をブラウザー検証でき、マニュアル TC-40（同意のキャンセル）が実行可能になる」と主張したが、`spec/manual-tests/account.md` の TC-05 は「同意画面に遷移する」「アカウントを**選び、許可する**」、TC-40 は「**同意せずに戻る（キャンセルする）**」を要求する。dev アダプターが `buildAuthorizationUrl` から直接コールバックへ返す（自動承認）実装にすると、この 2 つの手順が実行できず AC-30 の実行対象 30 件のうち TC-05 手順 1-2 と TC-40 が満たせない。

### Decision
dev IdP の認可エンドポイントをアプリ内のルートとして 1 本置く。

- `apps/web/app/routes/dev/oauth/authorize.tsx` — `validateSearch` で `client_id` / `redirect_uri` / `state` / `code_challenge` / `code_challenge_method` / `scope` を受け、メールアドレス入力・`email_verified` トグル・表示名入力・「許可する」「キャンセル」の 2 ボタンを出す。許可は `redirect_uri` へ `code`（dev アダプターが復号できる自己完結トークン）+ `state` を付けて遷移、キャンセルは `error=access_denied` + `state` を付けて遷移する。
- `devSignInOAuthClient.buildAuthorizationUrl` はこのルートの URL を返す。`exchangeCode` は `code` を検証して `providerAccountId` / `email` / `emailVerified` / `displayName` を返し、不正な code は `OAUTH_CODE_INVALID` に倒す。
- **ADR-003 の production ガードはこのルートにも掛ける**: `OAUTH_DEV_MODE` が真でなければルートは 404 を返す（`NODE_ENV=production` との併用は起動時エラーなので、production ビルドにこのルートが有効な状態は存在しない）。判定は composition root が供給する 1 つのフラグ（`RequestContainer` 経由）を読むだけにして、ルート側で env を直読みしない。
- `redirect_uri` は `AppConfig.appUrl` と同一オリジンのパスのみ受理する（開いた redirector にしない）。

### Consequences
- 良い点: TC-05 / TC-40 が資格情報なしでブラウザー実行でき、`/auth/callback/$provider` の成功・キャンセル・state 不一致の各状態が実際の遷移で検証できる。dev IdP が「Google の代替プロバイダー実装」であるという ADR-003 の位置づけとも一致する（同意画面を持つのが自然）。
- トレードオフ: `apps/web` にルートが 1 本増え、production では常に 404 になるコードを持つ。ガードの検証（フラグ off で 404）をプレゼンテーションテストに 1 本足す必要がある。

---

## ADR-022: `StoredFileRepository` は spec の形を保ち、削除は `findById` の OCC トークン経由で行う

### Status
Proposed

### Context
`spec/domains/storage.md` は `StoredFileRepository extends TransactionalRepository<StoredFile, StoredFileId>` と定め、実コードの `ExpectedVersion` は「アダプターが `findById` の中でのみ発行する」（`domain/common/transactionalRepository.ts` の JSDoc）不透明トークンである。当初の計画の `deleteFiles` は「`listByIds` → 行削除」で、`listByIds` は `readonly StoredFile[]` を返すためトークンが取れず型が通らない（`deleteFilesByOwner` の 100 件バッチも同じ）。あわせて `listByOwner` の形を `(owner, { purpose?, limit })` と素の配列にしていたが、spec は `listByOwner(owner, purpose: FilePurpose | null, pagination: Pagination): PaginationResult<StoredFile>` であり、素の配列では「ちょうど `batchSize` 件で残件なし」と「`batchSize` 件でまだ残る」を区別できず TC-storage-038（ちょうど 100 件では継続を積まない）を満たせない。

### Decision
spec の形をそのまま採り、逸脱を作らない。

- `StoredFileRepository extends TransactionalRepository<StoredFile, StoredFileId>` とし、本 Issue が実装するのは `insert` / `findById` / `delete(id, expectedVersion)`（基底）+ `listByIds` / `listByOwner(owner, purpose, pagination)` / `sumSizeByOwner`。他のメソッド（`listByNote` / `listExpired` ほか）は #6。
- 共有手続き `deleteFiles(fileIds, deletionOperationId)` は **1 件ずつ `findById` → `delete(id, expectedVersion)`** で消し、不在 ID は無視して `storage.fileDeleted` を収集する。1 バッチ最大 100 件なので N+1 は許容範囲で、OCC 契約（「書く意図の読みは `findById` を通る」）を曲げない。
- `listByOwner` は `PaginationResult<StoredFile>`（`items` + 次 cursor / `hasNext` 相当）を返す。`deleteFilesByOwner` はこの残件情報で「継続を積むか / 正常終端か」を決め、TC-storage-038 の境界を判定する。purpose 絞り込みは `purpose: FilePurpose | null` の第 2 引数で表す（`storeAvatar` は `"avatar"`、`deleteFilesByOwner` は `null`）。

### Consequences
- 良い点: spec からの逸脱が 0 になり（spec-sync 候補が増えない）、OCC 契約と境界判定の両方が型と戻り値で表現される。#6 は同じ interface にメソッドを足すだけで済む。
- トレードオフ: 削除が 1 件ずつの読み書きになる（memory では無視できるコスト、D1 では 1 バッチ 100 往復）。`Pagination` / `PaginationResult` を Storage でも使うので、cursor の形を Note 側（`domain/common/pagination.ts`）と揃える必要がある。

---

## ADR-023: scope 継続タスクランナーは 1 秒間隔 + commit kick で駆動する

### Status
Proposed

### Context
ADR-005 は `ScopeTaskQueue.listDue` を駆動側のポートとして決めたが、**どの周期で回すか / commit 直後に起こすか**を決めていなかった。既存 Node runner の既定は relay 60 秒間隔 + commit 時 kick（`createInProcessRelayTrigger`）、prune 24 時間（`apps/web/app/worker/node/runner.ts`）。scope 平面の継続を relay と同じ 60 秒に合わせると、継続 1 ラウンドごとに最大 60 秒待つことになり、AC-29 の「`pnpm dev` 上で進捗が `accepted` → `running` → `completed` と進む」（マニュアル TC-14）が実用的な時間で終わらない（削除 1 件で数分待ちになる）。

### Decision
- `NodeWorkerRunnerTuning` に `scopeTaskIntervalMs`（既定 **1,000 ms**）を足し、ランナーに scope task tick を 1 本追加する。1 tick は `scopeTaskQueue.listDue(now, limit)` の各行について `scopeUnitOfWorkProvider.run(scope, …)` を開き、`claimDue` → ユースケース再投入 → `complete` / `backoff` を行う。tick は重ならないよう直列化し、`unref()` してテスト / スクリプトからプロセスを掴まない（relay tick と同じ規律）。
- `RelayTrigger` と同型の `ScopeTaskTrigger` を late-bind する（`bindNodeScopeTaskTrigger(trigger)` を `boot()` が呼ぶ）。`ScopeTaskScheduler.schedule` を呼んだ scope UoW の**commit 後**に `kick()` し、同時 kick は 1 回の tick に畳む。これで継続チェーンは秒未満で次段へ進み、間隔値は「kick を落としたときの上限待ち時間」になる。
- `pruneCompleted` 相当の長周期タスク（`identity.personalBarrierPruneContinued` は 120 日後）も同じキューに乗るが、`listDue` が期限で絞るので tick の頻度は影響しない。

### Consequences
- 良い点: AC-29 のブラウザー検証が数秒で完走し、kick を落としても 1 秒後には拾える。運搬路の差し替え（#11 の DO Alarm）に触らない tuning 値なので、`listDue` が空配列を返す実装では tick が実質 no-op になる。
- トレードオフ: dev サーバーが 1 秒ごとに空クエリーを回す（memory では table 走査 1 回）。tuning 値が 1 つ増える。

---

## ADR-024: 購読者の冪等性は「本処理そのものが冪等か」で決め、本 Issue の 2 購読者は `IdempotencyStore` を通さない

### Status
Proposed

### Context
plan.md の未解決事項に「購読者レジストリのどのハンドラーが `IdempotencyStore.markProcessed(consumer, eventId)` を通すか」が残っていた。想定は「非可換な副作用を持つ `authResidueCleanup` / `identityRemovalRelease` は通し、キー削除だけの `deleteStoredObjects` は通さない」だったが、実装時に 2 つの購読者（ステップ 3 の `authResidueCleanup`、ステップ 8 の `deleteStoredObjects`）の実際の効果を見ると、どちらも**加減算ではなく削除**である。`application/ports/idempotencyStore.ts` の JSDoc は「本質的に冪等な購読者（上書き / 削除）はこのストアを使わず、冪等性の根拠を自分のユースケースに書く」と定めている。

### Decision
判断基準を「購読者名」ではなく**効果の可換性**に置き、本 Issue の 2 購読者はいずれも `IdempotencyStore` を通さない。根拠は各ユースケースの JSDoc に書く。

- `authResidueCleanup` — 効果は「payload の世代より古い行を最大 100 件消す」。再配送しても 2 度目は消す対象が無く、終端状態は同じ。現世代の行は決して消さない。
- `deleteStoredObjects` — 効果は「イベントが運ぶ `objectKey` を消す」。鍵の削除は冪等で、行を読み直す必要もない。

`markProcessed` を「念のため」通さない理由は 2 つある。契約上その記録は本処理と同一 UoW でなければならないが、`deleteStoredObjects` の本処理は UoW の外（オブジェクトストレージ）であり同一トランザクションに入れられない。そして `authResidueCleanup` に通すと、継続チェーンの各ターンが「配送 1 回」に縛られ、応答喪失後の再配送で続きが進まなくなる。加減算を行う購読者（`applyStorageDelta` — #6）が最初の実利用者になる。

### Consequences
- 良い点: 未解決事項が「実装を見て決める」ではなく規則で閉じ、後続スライスも同じ基準で判断できる。冪等性の根拠が購読者のコード上に残る。
- トレードオフ: `IdempotencyStore` は本 Issue でも実利用者を持たないまま（適合スイートのみ）残る。`WorkerContainer` に UoW プロバイダーが載ったので、次に加減算購読者を足す人が正しく使える状態にはなっている。

---

## ADR-025: 認証残渣クリーンアップの継続イベントには `continuationKey` を載せない

### Status
Proposed

### Context
ADR-019 は「global 平面の継続イベント ID を生成元から決定的に導出する」と定め、`mintEventIdFor` が `payload.continuationKey` からイベント ID を作る形を決めた。`identity.userAuthResidueCleanupContinued` は cursor を持たない継続（削除そのものが対象を母集合から外すため）なので、決定的キーの材料は `userId` / `authEpoch` / `table` しかない。ところが同じ表の次ページを表す継続は**現在処理中のイベントとまったく同じキー**になる。memory の outbox は `table.set(event.id, …)` の upsert で、リレーはハンドラーが正常終了した後に `finalize({ processed: [id] })` で同じ行に `processedAt` を書く。つまり「同じ ID で保存した次の継続」を、その直後の finalize が処理済みに倒して消してしまう。

### Decision
この継続には `continuationKey` を載せず、イベント ID は通常どおり採番する（`mintEventIdFor` の fallback）。冪等性は ADR-024 の根拠（削除は再実行しても終端が同じ）で担保する。重複配送で 2 系列が並走しても、両系列とも「残っているものを 100 件消す」だけで、対象が尽きた側から順に終わる。

**決定的キーが使えるのは、キーがターンごとに変わる継続に限る**（cursor / phase を含むもの）。同じ phase を繰り返す継続（`identity.accountDeletionDispatchContinued` のような、同じ phase で次の 100 件へ進む形）に決定的キーを与えるときは、ターンを識別する材料（cursor・ページ番号）をキーに含めなければ同じ罠を踏む。ステップ 30 / 31 はこの制約の上で書く。

### Consequences
- 良い点: 継続チェーンが「保存した直後に処理済みへ倒される」欠陥を構造的に避けられる。ADR-019 の適用条件がキー設計の言葉で明確になる。
- トレードオフ: 応答喪失後の再配送でこの継続だけは 2 系列に増えうる（害は無いが outbox 行が数行増える）。ADR-019 の「global 平面の継続は決定的 ID」という一文が例外を 1 つ持つ。

---

## ADR-026: `DistributedOperationStore` は保持期限の列を持たず、terminal の回収は manifest の prune に従う

### Status
Proposed

### Context
`spec/database/index.md` の `distributed_operations` は `expires_at`（terminal は `terminal_at + 120 日`）と `attempts` / `next_attempt_at` を持ち、`account manifest pruner` が header と operation を同じ UserId-shard transaction で消す、と定める。一方 plan.md の縮退で「受理応答を落としたときの再駆動主体（recovery Cron）は本 Issue に置かない」ことが確定しており、`next_attempt_at` を書く者も読む者も居ない。`expires_at` も、回収の起点が manifest header 側の `retainUntil` である以上、operation 側に複製すると「2 か所の期限がずれる」状態を作れてしまう。

### Decision
ポートは `terminalAt` だけを持ち、`expiresAt` / `attempts` / `nextAttemptAt` は持たない。

- 保持中の terminal 行の観測は `countTerminalSince(kind, partitionKey, since)`（呼び出し側が窓を渡す）で行う。窓幅の正典は `AccountDeletionRetryPolicy.retentionWindowMs`。
- 回収は manifest の terminal prune が `deleteTerminal(operationId)` を同一 transaction で呼ぶ形に限る。terminal でない行の `deleteTerminal` は `ConflictError` で拒む（running operation を prune が消せない）。
- `markState(operationId, state, at)` は時刻を引数で受ける（アダプターが環境時計を読まない、既存 `AccountDeletionManifestStore.markCompleted(operationId, terminalAt, retainUntil)` と同じ形）。terminal state のときだけ `terminalAt` を刻む。

### Consequences
- 良い点: 期限の正典が manifest 側 1 か所に残り、2 つの表がずれた期限を持つ状態が作れない。ポート面が 5 メソッドに収まる。
- トレードオフ: spec の列構成との差（`expires_at` / `attempts` / `next_attempt_at` の不在）が spec-sync 候補に 1 件増える。recovery Cron を足すスライスは `next_attempt_at` をこのポートに追加する必要がある。

---

## ADR-027: `ObjectStorage` の本体はバイト列に限り、ストリームを受けない

### Status
Proposed

### Context
`spec/domains/storage.md` の `ObjectStorage.put` は `ReadableStream<Uint8Array> | Uint8Array` を受け、`get` は `{ stream, meta }` を返す。本 Issue が通す唯一の経路はアバター（上限 5 MB、ADR-004）で、memory 実装はプロセス内の `Map` である。ストリームを受ける形にすると、memory 実装は「ストリームを読み切ってバイト列にする」分岐を持ち、`get` は「毎回新しいストリームを作る」ことになる — どちらも本 Issue に読者の居ないコードになる。

### Decision
本 Issue の `ObjectStorage` は `put(key, body: Uint8Array, meta)` / `get(key): { bytes, meta } | null` とし、ストリームを扱わない。大きなファイル（`source` 50 MB / 音声 200 MB / artifact 1 GB）を通す取り込みスライス（#6）が、その要求とともにストリーム対応の形へ広げる。`createDownloadUrl` を持たないのも同じ理由（期限付きダウンロードは #6 / エクスポート経路）。

### Consequences
- 良い点: memory アダプターも適合スイートも「バイト列を入れて取り出す」だけで書け、検証されない分岐が残らない。
- トレードオフ: #6 がポート定義とアダプターを広げる（呼び出し側は `storeAvatar` のみなので影響は小さい）。spec との差は spec-sync 候補に 1 件。

---

## ADR-028: `resolve` は `releasing` の予約を解決しない

### Status
Proposed

### Context
ADR-015 が `DirectoryRow.state` に `releasing` を足した結果、`IdentityUniqueDirectory.resolve` の「`active` だけを返す」判定を `releasing` について決め直す必要が生じた（ADR-015 の Consequences が積み残していた点）。`releasing` は「解放操作が始まったが、まだ鍵は消えていない」状態である。

### Decision
`resolve` は `active` の行だけを返し、`releasing` は `null` を返す。理由は、`releasing` へ進むのは正データ（Identity 行 / User の handle・email）が既に消えた後だからで、この間に所有者を返すと「解除済みの provider account でサインインすると存在しない identity の持ち主に解決される」経路ができる。

一方 `reserve` は `releasing` の行を**塞いだままにする**（他の利用者が同じ鍵を取れない）。解放が完了して行が消えたときにだけ再予約が通る。この非対称（読みは null / 予約は衝突）は 2 相解放の途中状態を安全側へ倒すためのもので、適合スイートで両方を固定する。

### Consequences
- 良い点: 解放中の鍵で他人が予約を取れず、同時に「消えかけの所有者」も観測されない。TC-identity-093 / 094 の再登録が、解放完了を待ってから通る形になる。
- トレードオフ: 解放が途中で止まると鍵は誰にも使えないまま残る（`release` の再送で回復する。恒久失敗の扱いは継続タスクの backoff に委ねる）。

---

## ADR-029: 棚卸しによる置き換えは `StorageQuota.replaceTotals` として持つ

### Status
Proposed

### Context
`recalculateStorageUsage`（AC-22）は `sumSizeByOwner` と `countByOwner` の走査結果で消費量とノート件数を**置き換える**が、`spec/domains/usage.md` の `StorageQuota` の振る舞い表には `add` / `subtract` / `incrementNotes` / `decrementNotes` / `changeLimit` しかない。差分メソッドの組み合わせで置き換えを表現すると「現在値を読んで差分を計算する」処理がユースケース側に出て、0 丸め（防御的措置）と棚卸し（正本の上書き）の区別が消える。

### Decision
`StorageQuota.replaceTotals(quota, { consumedBytes, noteCount }, now)` を足す。負値・非整数は `BusinessRuleError(InvalidDelta)` で拒み、版を 1 つ進める。差分メソッドと違い「走査結果が正本」であることをメソッド名で示す。

### Consequences
- 良い点: 棚卸しの意味がドメイン側の名前で表現され、ユースケースは走査結果を渡すだけになる。OCC の版更新も他の遷移と同じ形になる。
- トレードオフ: spec の振る舞い表に 1 行増える（spec-sync 候補）。

---

## ADR-030: 設定画面への導線は、対象ルートが生成されるまで素のリンクで置く

### Status
Proposed

### Context
ステップ 9 が P-20 のタブ列と `AccountMenu` の設定導線を作るが、遷移先の 4 ルート（`/settings/{profile,auth,usage,danger}`）を作るのはテーマ E / F / G / H である。TanStack Router の `Link` の `to` は生成済みルートツリーの union 型なので、存在しないルートへのリンクは**型エラーになる**（実測で確認済み）。選択肢は (a) ステップ 9 で 4 ルートの空実装を置く、(b) 型を回避するキャストを書く、(c) 素の `<a href>` で置く。

### Decision
(c) を採る。タブ列（`components/layout/SettingsTabs`）と `AccountMenu` の設定導線は `<a href>` とし、遷移先の href を `SETTINGS_TABS` の 1 配列に集約する。`AccountMenu` はその先頭（`/settings/profile`）を入口に使う。各行に「対象ルートが生成された後に `Link` へ差し替える」という理由をコメントで残す。

(a) は完了条件が禁じる placeholder 実装であり、しかも所有ステップ（22 / 25 / 27 / 32）のファイルと衝突する。(b) はキャストで型の保証を捨てるだけで、実在しないルートへのリンクという事実は変わらない。

### Consequences
- 良い点: ステップ 9 がテーマ E / F / G / H を待たずに完結し、各テーマは自分のルートを足すだけでよい。タブの href が 1 箇所に集まっているので、差し替えも 1 ファイルで済む。
- トレードオフ: 4 ルートが揃うまでタブ遷移はフルナビゲーションになる（ルーターキャッシュを使わない）。差し替えを忘れると設定タブだけ体感が重いままになるので、ステップ 34 の確認項目として記録する。
