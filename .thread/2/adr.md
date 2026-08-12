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

代替案（running な `distributed_operations` から `userId → user:{id}` を導いて polling する）は新ポートを増やさずに済むが、**`identity.personalBarrierPruneContinued` は operation が `completed` になった 120 日後に期限が来る**ため、running 集合からは導出できない。この 1 種類のために例外規則を作るより、汎用の列挙ポートを 1 つ持つほうが #3 以降の participant にも素直に効く。

> **ADR-103 で更新**: 起草時は「#11 の DO Alarm 実装では `listDue` は空配列を返す（scope 自身が起きるので中央からの列挙が不要）」としていたが、ADR-103 が正本を plan.md のテスト方針に置き、`listDue` を必須契約へ書き換えた。中央列挙を持たないランタイムも実装を求められる — 再起動後に未完の継続を拾う経路が他に無い以上、これは縮退ではなく要件。以下の Consequences のうち「実装が空になるポート」に関する記述も同様に置き換わっている。

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

## ADR-031: 再送の 60 秒間隔は pending トークンの `createdAt` から測る

### Status
Proposed

### Context
`spec/usecases/identity.md` の `resendVerificationEmail` 手順 2 は「直近 60 秒以内に同じ利用者へ発行していれば何もせず返す」と定めるが、現行の `AuthTokenRepository`（spec/domains/identity.md のポート定義そのまま）には最後の発行時刻を読む手段が無い。`findByTokenHash` は平文トークンを持つ側の経路で、再送の要求者はそれを持たない。`deleteByUserAndPurpose` は件数しか返さない。選択肢は (a) ポートに pending トークンの読み取りを足す、(b) `LoginAttemptStore` を汎用スロットルとして流用する、(c) 間隔制限を実装しない。

### Decision
(a) を採り、`AuthTokenRepository.findPendingByUserAndPurpose(userId, purpose): Promise<PendingAuthToken | null>` を足す。`auth_tokens` は (`user_id`, `purpose`) に対し `status = 'pending'` の部分 UNIQUE を持つ（spec/database/index.md）ので、この読み取りは高々 1 行で定義が一意に決まり、その `createdAt` が「最後にトークンを発行した時刻」そのものになる。

判定は**同一 UoW の中**で行う（spec 手順 2 は UoW の前に置いているが、手順 4 の再検査と同じ transaction に入れる）。pending 行の読み取り・置き換え・新規発行が 1 つの transaction に収まっていないと、並行する再送が「どちらも間隔を満たす」と判断して 2 件目の pending 行を作り、部分 UNIQUE 制約に触れる。

(b) は失敗カウンターの意味を曲げるうえ、`pruneExpiredAuthState` の `login_attempts` 掃除と干渉する。(c) は AC-3 と TC-identity-195/196 を落とす。

`resendVerificationEmail` の応答は空の DTO（`ResendVerificationEmailView = Readonly<Record<string, never>>`）にする。「メールを送ったか」を返した時点で列挙耐性（spec/adr/028）が壊れるので、返せるフィールドが 1 つも無いことを型で示す。

### Consequences
- 良い点: 間隔判定の材料が実データ 1 か所（pending トークン行）に定まり、別表の状態と食い違わない。適合スイート 1 本で全バックエンドに同じ意味を課せる。
- トレードオフ: `spec/domains/identity.md` の `AuthTokenRepository` 定義に無いメソッドを実装が持つことになる。ステップ 34 の spec-sync 候補として記録する（ポート定義とテストケース表の両方に追記が要る）。
- 追随: 同じ 60 秒規則をパスワード再設定へ広げる場合（テーマ D）は、`purpose: "password_reset"` で同じメソッドを呼べばよい。

## ADR-032: 再送導線は P-02 / P-03 が共有する 1 つの island に置く

### Status
Proposed

### Context
確認メールの再送は P-03（期限切れ・無効）と P-02（未確認）の 2 か所から出る（PAGE-p03-003 / PAGE-p02-006）。両者は「アドレスを知っているか」だけが違う: P-02 はサインインフォームに入力済みのアドレスがあり、P-03 はメールのリンクから来た訪問者なのでアドレスを知らない（モック P03 のボタンだけでは送信先が決まらない）。一方で「送信中 / 送信済み / クールダウン中」の三態とクールダウンの秒読みは完全に同じで、2 か所に複製すると片方だけ挙動が古くなる。

### Decision
`apps/web/app/components/auth/ResendVerificationForm/` を新設し、両ページがこれを使う。`email` prop が `string` ならボタンだけを、`null` ならメール入力欄付きで描画する。`variant`（`primary` / `outline` / `compact`）でモックの 3 種のボタン形を出し分ける。server function（`resendVerificationFn`）もこのディレクトリが持ち、`__root.tsx` の副作用 import は 1 行で済む。

クールダウンは**クライアント側の 60 秒タイマー**として表示する。usecase は列挙耐性のため全経路で同じ空の成功を返し、間隔にかかったかどうかを応答に載せない（ADR-031）ので、サーバーから残り時間を受け取る経路は原理的に無い。表示はあくまで案内で、早すぎる再送は無送信の成功になるだけである。

このコンポーネントは自前の live region を持たない。呼び出し元（P-03 の結果パネル・P-02 のアラート枠）が既に常設の `role="status"` の中にこれを置いており、入れ子の live region は同じ文言を二重に読み上げさせるため。秒読みだけは `aria-hidden` にして、毎秒の読み上げを止める。

### Consequences
- 良い点: 三態とクールダウンの実装が 1 本になり、P-02 / P-03 で挙動がずれない。テーマ C（P-01 / P-02 の Google 導線）が `SignInForm` を触っても再送側と衝突しない。
- トレードオフ: `components/auth/SignInForm/` の所有ステップ（12）が、ステップ 12 の対象ファイル一覧に無いディレクトリを 1 つ増やす。後続テーマ（15 / 17）は `SignInForm/index.tsx` の `PhaseAlert` に追記するだけでよく、再送側には触れない。

---

## ADR-033: `packages/core` の no-barrel 規約に合わせ、OAuth アダプターの選択は `adapters/oauth/signInOAuthClient.ts` が持つ

### Status
Accepted

### Context
steps.md ステップ 13 は `adapters/oauth/{googleSignInOAuthClient.ts,devSignInOAuthClient.ts,index.ts}` を対象ファイルに挙げていたが、`@repo/core` の `exports` は `"./*": "./src/*.ts"` の 1 行だけで、`@repo/core/adapters/oauth` は `src/adapters/oauth.ts` に解決される。ディレクトリの `index.ts` は import できない（CLAUDE.md「there is no barrel to import from」）。

### Decision
選択規則（`OAuthRuntimeConfig` と `createSignInOAuthClient`）は `packages/core/src/adapters/oauth/signInOAuthClient.ts` に置き、`@repo/core/adapters/oauth/signInOAuthClient` として import する。S256 導出だけは両アダプターが共有するので `adapters/oauth/pkce.ts` に分ける（`signInOAuthClient.ts` に置くと、それを import する 2 つのアダプターとの間で循環になる）。

### Consequences
- 良い点: 既存の「1 サブパス = 1 ファイル」の解決規則を崩さない。
- トレードオフ: steps.md のファイル名と 1 つずれる。後続で OAuth アダプターを増やす場合も `index.ts` は作らない。

---

## ADR-034: `SystemError(ExternalServiceError)` は既存 enum の `EXTERNAL_API_ERROR` に写す

### Status
Accepted

### Context
spec/domains/identity.md の `SignInOAuthClient` は通信失敗を `SystemError(ExternalServiceError)` と書くが、`application/errors.ts` の `SystemErrorCode` に `ExternalServiceError` は無く、外部サービス起因の枠は `ExternalApiError`（`EXTERNAL_API_ERROR`、retryable）である。

### Decision
新しいコードを足さず `SystemErrorCode.ExternalApiError` を使う。名前は違うが意味（外部サービスとの通信・応答の失敗、再試行可能）は同じで、コードを 2 つ持つと presentation の分類が二重になる。spec 側の呼称ずれはステップ 34 の spec-sync 候補として記録する。

### Consequences
- 良い点: 既存の retryable 判定・HTTP マッピングにそのまま乗る。
- トレードオフ: spec の文字列と実コードの enum 名が一致しない期間が残る。

---

## ADR-035: sub-operation ID は sha256 ではなく構成で導出する

### Status
Accepted

### Context
spec/usecases/identity.md「Identity uniqueness の物理shard境界」は `reservationOperationId = sha256(parentOperationId + ":" + kind + ":" + normalizedKey)` を規定する。しかしこの導出はユースケース（`application/identity/uniqueness.ts`）が行うもので、application 層に SHA-256 の実装（`node:crypto` か WebCrypto）を持ち込むことになる。application 層は横断的関心事をポート越しに扱う規約で、ハッシュを渡すためだけのポートを 1 本増やすのも過剰である。

### Decision
`${parentOperationId}:${kind}:${normalizedKey}` の構成で導出する。要求されている性質は「決定的であること」と「同一 parent 内で kind / key ごとに異なること」の 2 つだけで、`kind` は `:` を含まない閉じた列挙、自由文字列である `normalizedKey` は最後に来るため、構成だけで一意性は保たれる。

### Consequences
- 良い点: application 層がハッシュ実装を持たずに済み、応答喪失後の再導出も同じ値になる。
- トレードオフ: 予約行の `operation_id` 列が固定長でなくなる（実バックエンドでは最大 ~320 文字を見込む必要がある）。spec の記述との差はステップ 34 の spec-sync 候補として記録する。ステップ 20 / 23 / 30 も同じヘルパーを使うので、変えるなら 1 箇所で変えられる。

---

## ADR-036: OAuth コールバックのディスパッチャーを application に置き、ユースケースは spec の入力 DTO を保つ

### Status
Accepted

### Context
ADR-007 は「ルート側は state を取り出して 1 本の server function に渡し、application 側のディスパッチャーが intent でユースケースを選ぶ」と決めた。しかし `OAuthStateStore.take` は原子的な取り出し + 削除で、覗き見る手段が無い。一方 spec の `completeOAuthSignIn` / `linkOAuthIdentity` の入力 DTO はどちらも `{ state, code }` で、自分で `take` する形になっている。ディスパッチャーが先に `take` すると、ユースケースの入力 DTO を spec から変えることになる。

### Decision
2 つの入口を持たせる。

- `application/identity/completeOAuthCallback.ts` — ルートが呼ぶディスパッチャー。`take` して `intent` で分岐し、`provider` がパスと一致しなければ `OAUTH_STATE_INVALID`。
- `completeOAuthSignIn({ state, code })` — spec どおりの入口。自分で `take` し、`intent !== "signIn"` なら `OAUTH_STATE_INVALID`。本体は `completeOAuthSignInForFlow(container, flow, code)` に切り出し、ディスパッチャーはこちらを呼ぶ。

1 回の要求で `take` が走るのは常に 1 回だけ（入口はどちらか一方）で、二重消費は起きない。

### Consequences
- 良い点: TC-identity-024..038 は spec の入力 DTO のまま検証でき、ルートは ADR-007 の形（1 本の server function → intent 分岐）を保つ。ステップ 20 は `linkIdentity` の case を差し替えるだけで済む。
- トレードオフ: 同じ処理への入口が 2 つある。`completeOAuthSignInForFlow` を直接呼んでよいのはディスパッチャーだけ、という規約が JSDoc にしか無い。

---

## ADR-037: dev IdP の認可コードは署名しない

### Status
Accepted

### Context
dev IdP の同意画面（`apps/web`）が作る認可コードを、dev アダプター（`packages/core`）が復号する。両者は同一プロセスだが SSR / RSC で**別のモジュールグラフ**に載る（`server.node.ts` が ALS を `globalThis` に固定しているのはこのため）ので、モジュールレベルのランダム鍵で HMAC を付けると書き手と読み手で鍵が食い違う。

### Decision
コードは `base64url(JSON)` の素の封筒にし、署名を持たせない。改竄耐性の代わりに (a) 厳格なスキーマ検査（壊れた値は `OAUTH_CODE_INVALID`）と (b) **PKCE 検証**を置く: 封筒に認可要求の `code_challenge` を載せ、`exchangeCode` が `deriveCodeChallenge(codeVerifier)` と突き合わせる。これにより「リダイレクトから盗んだ code だけでは交換できない」という本番と同じ性質が dev でも成立する。

### Consequences
- 良い点: 鍵の受け渡し経路を作らずに済み、PKCE の往復が dev でも実際に検証される（適合スイートの `offline` 側がこれを固定する）。
- トレードオフ: dev IdP のコードは誰でも組み立てられる。`OAUTH_DEV_MODE` が真の環境でしか通らず、その環境は production と併用できない（ADR-003）ため許容する。

---

## ADR-038: P-05 の「キャンセル」はコールバック画面に留まり、サインインへは明示のリンクで戻す

### Status
Accepted

### Context
モック P05-oauth-callback.html の状態 2（キャンセル）は、コールバック画面に留まって「元の画面に戻る」ボタンを出す形になっている。一方 `spec/manual-tests/account.md` TC-40 手順 2 の期待結果は「サインイン画面に戻り、キャンセルされたことが示される」で、自動遷移とも読める。自動遷移にすると、キャンセルの事実を伝えるために `/signin` に検索パラメーターを足し、`SignInForm` にその表示を足すことになる（`SignInForm` はステップ 12 の所有で、ステップ 15 は追記のみの約束）。

### Decision
モックに従い、コールバック画面（P-05）にキャンセル状態を出し、主導線として `/signin` へのリンク「サインインに戻る」を置く。`/signin` 側には何も足さない。

### Consequences
- 良い点: 所有ステップの約束を破らずに済み、P-05 の 5 状態がすべて 1 画面に収まる。
- トレードオフ: TC-40 手順 2 の「サインイン画面に戻り」はワンクリック挟む形になる。マニュアルテスト実行時はこの読み替えで判定する。

---

## ADR-039: `startOAuthFlow` の `linkIdentity` は非 active な主体を `UnauthorizedError("UNAUTHENTICATED")` で断る

### Status
Accepted

### Context
TC-identity-266 は「削除開始済みまたは削除済みの利用者が `intent: "linkIdentity"` で開始する」→「OAuth state を作らず、認証済み利用者として扱わない」を求めるが、spec の `startOAuthFlow` エラー表には該当行が無い（未知プロバイダーと `INVALID_REDIRECT` の 2 行だけ）。

### Decision
`UnauthorizedError("UNAUTHENTICATED")` を投げる。期待結果の文言そのもの（「認証済み利用者として扱わない」）であり、presentation では 401 に写って既存の「サインインが必要です」に収束する。`pending` も同じ扱いにする（メール未確認の利用者は認証済みの主体ではない）。

### Consequences
- 良い点: 状態を漏らさず、既存のエラー表示辞書をそのまま使える。
- トレードオフ: spec のエラー表に行が 1 つ増える（ステップ 34 の spec-sync 候補）。

---

## ADR-040: パスワード再設定の server function は `ResetPasswordPanel` が持つ

### Status
Accepted

### Context
steps.md ステップ 17 の対象ファイルは「`routes/-action` 相当（新規）」だが、`/reset-password` は入れ子の無い単独ルートなので、置き場は `apps/web/app/routes/-action.tsx`（routes 直下）になる。これは「ルート群のディレクトリが自分の action を持つ」という `routes/auth/-action.tsx` / `routes/notes/-action.tsx` / `routes/dev/-action.tsx` の形と違い、routes 直下の全ルートで共有される名前になってしまう。

### Decision
`requestPasswordResetFn` / `resetPasswordFn` を `apps/web/app/components/auth/ResetPasswordPanel/action.ts` に置く。P-04 の 2 モードは 1 つの island（`ResetPasswordPanel`）が所有しており、`VerifyEmailPanel/action.ts` / `ResendVerificationForm/action.ts` と同じ「island が自分の server function を持つ」形になる。`__root.tsx` の副作用 import も 1 行で済む。

### Consequences
- 良い点: 既存 2 パターン（ルート群 / island）のうち実態に合う方を選べ、routes 直下に共有名の action モジュールを作らずに済む。
- トレードオフ: steps.md のファイル名と 1 つずれる。

---

## ADR-041: `requestPasswordReset` にも 60 秒の発行間隔を適用する

### Status
Accepted

### Context
TC-identity-192 は「同じメールアドレスへの要求が短時間に連続する」→「レート制限がかかり、メールは送られず成功として返る」を求めるが、`spec/usecases/identity.md` の `requestPasswordReset` 手順にはレート制限の材料が書かれていない（エラー表に「レート制限 → 何もせず成功として返る」の 1 行があるだけ）。`LoginAttemptStore` を流用する案は失敗カウンターの意味を曲げる。

### Decision
ADR-031 の「追随」節どおり、`AuthTokenRepository.findPendingByUserAndPurpose(userId, "password_reset")` の `createdAt` から 60 秒を測る。判定は発行 UoW の中で行う（`resendVerificationEmail` と同一の形）。応答は列挙耐性のため全経路で同じ空の DTO なので、間隔にかかったかどうかは載せない。

### Consequences
- 良い点: 確認メール再送と再設定申請で間隔判定の材料・置き場所・境界（59 秒 / 61 秒）が 1 つになる。
- トレードオフ: 60 秒という値の正典が spec ではなく実装（2 ユースケースの定数）にある。ステップ 34 の spec-sync 候補に、`requestPasswordReset` 手順への間隔規則の追記として載せる。

---

## ADR-042: `resetPassword` の成功応答でセッション Cookie を破棄する

### Status
Accepted

### Context
`resetPassword` は成功時に `authEpoch` を進めるので、実行したブラウザー自身のセッション（サインイン中にロック解除目的で再設定した場合）も同時に失効する。usecase は `userId` しか返さず、Cookie は presentation の関心なので、破棄する主体を決める必要がある。

### Decision
`resetPasswordFn`（POST）が成功後に `session.clearSessionCookie()` を呼ぶ。GET ではないので #1 の CSRF 規約（読み取り経路が認証状態を変えない）に触れない。island 側は成功後に `router.invalidate()` して、キャッシュ済みの認証状態を捨てる。

### Consequences
- 良い点: 認証できない値を送り続けるブラウザーが残らず、P-04 の実行成功から「サインインへ」への導線が実態と一致する。
- トレードオフ: `completeOAuthCallbackFn` に続いて Cookie を触る server function が 1 つ増える（破棄側なので発行の一元性は崩れない）。

---

## ADR-043: P-04 の強度表示は目安に留め、送信の可否はドメイン条件だけで決める

### Status
Accepted

### Context
モック P04 状態 3 は 4 本のバーと「強さ: 十分」を出すが、強度の定義は spec に無い。合否を決めるのは `PlainPassword`（8〜128 字・英字と数字を各 1 つ以上、違反は `BusinessRuleError(WeakPassword)`）だけである。

### Decision
バーは「ドメイン条件を満たしたうえでどれだけ余裕があるか」を 4 段階で見せる目安とし、score 0 =「ドメイン条件未達」でのみ送信ボタンを止める。長さ 12 / 16 と記号・大小混在で 1 段ずつ上がる。クライアント側の判定は表示のためだけで、正は常にサーバー側の VO 構築。

### Consequences
- 良い点: 画面の判定とサーバーの判定が食い違わず（クライアントが通したものはサーバーも通る）、TC-identity-208 の `WeakPassword` はサーバー由来のまま検証できる。
- トレードオフ: 段階の刻み方は仕様ではなく実装の判断なので、デザイン側の指定が入ったら差し替える。

---

## ADR-044: `removeIdentity` の operation ID も合成で導出し、`identityRemovalRelease` は `IdempotencyStore` を通さない

### Status
Accepted

### Context
`spec/usecases/identity.md` の `removeIdentity` 手順 3 は `operationId = sha256("removeIdentity:" + identityId)` と書く。一方 ADR-035 は sub-operation ID について「sha256 ではなく構成で導出する」と決めており、application 層にハッシュ実装を置かない方針が既にある（`reservationOperationId`）。また plan.md の未解決事項は「非可換な副作用を持つ `identityRemovalRelease` は `IdempotencyStore` を通す」を想定と記していたが、ADR-024 が判断基準を「購読者名」ではなく**効果の可換性**に置き直した。

### Decision
- `removalOperationId(identityId) = "removeIdentity:" + identityId` とする。固定接頭辞と `:` を含まない ID の 2 要素なので、合成だけで一意性と決定性が得られる。決定性は「同じ解除の再送が同じ受領・同じ directory 解放へ収束する」ために要るのであって、不可逆性は要らない。
- `identityRemovalRelease` は `IdempotencyStore` を通さない。効果は 1 つの key に対する `beginRelease` + `release` で、再配送しても解放するものが残っていないだけであり、`beginRelease` は受領の所有者以外の行に触れない。契約上 `markProcessed` は本処理と同一 UoW でなければならないが、directory は key shard 上にあり UserId shard の UoW には入らない。

### Consequences
- 良い点: application 層にハッシュ実装が入らず、ADR-035 と同じ規則で読める。冪等性の根拠が購読者のコード（JSDoc）に残る。
- トレードオフ: operation ID が `identityId` を平文で含む（内部 ID なので秘匿対象ではない）。spec の `sha256(...)` 表記との差が spec-sync 候補に 1 件増える（ADR-035 と同じ扱い）。

---

## ADR-045: OAuth コールバックの応答は intent 付きの判別共用体にし、`linkIdentity` は Cookie に触れない

### Status
Accepted

### Context
ADR-007 で `/auth/callback/$provider` は 1 ルート 2 ユースケースになり、テーマ C までは `OAuthCallbackView` が `{ intent: "signIn" } & CompleteOAuthSignInView` の 1 種類だった。ステップ 20 で `linkIdentity` が着地すると、その結果には `sessionToken` が無い（既に認証済みの要求なので新しいセッションを発行しない）。`completeOAuthCallbackFn` は現状 `view.sessionToken` を無条件に Cookie へ焼いている。

### Decision
- `OAuthCallbackView` を intent で判別する共用体に広げ、`linkIdentity` 側は `{ intent, redirectTo, identityId }` とする。`redirectTo` はユースケースの出力 DTO（spec は `identityId` のみ）ではなく**ディスパッチャーが flow から載せる** — 戻り先は「リンクしたこと」ではなく「どの flow だったか」に属する情報だから。
- `completeOAuthCallbackFn` も同じ判別共用体を返し、`signIn` のときだけ `setSessionCookie` / `clearPendingVerificationCookie` を実行する。`linkIdentity` は Cookie に一切触れない。
- P-05 の成功表示も intent で分岐する（「サインインしました」/「ログイン方法を追加しました」）。戻り先が `state` に無い場合の既定は intent ごとに違う（`/notes` / `/settings/auth`）。

### Consequences
- 良い点: 「セッション発行を伴わない intent」が型で表現され、Cookie を焼く経路が signIn の 1 本に閉じる。`integration`（#4）を足すときも同じ形で 1 arm 増やすだけになる。
- トレードオフ: `completeOAuthCallbackFn` の戻り値型を明示する必要があり（推論だと arm が広がる）、画面側にも分岐が 1 つ増える。

---

## ADR-046: P-22 の「追加」はダイアログ、「変更」はパネルにする

### Status
Accepted

### Context
steps.md は `AddPasswordForm` / `ChangePasswordForm` を「P-22 内のダイアログ」と書くが、モック `P22-settings-auth.html` は「パスワードを変更」を独立したパネルとして描いており、パスワード追加の UI はモックに存在しない（モックの主体は既にパスワードを持っている）。

### Decision
- **変更**はモックどおりパネルにする。恒常的に存在する操作で、一覧の下に並ぶことに意味がある（モックの 3 パネル構成をそのまま保つ）。
- **追加**はネイティブ `<dialog>` の `showModal()` で出す。パスワードを持たない利用者にしか現れない一時的な操作で、常設パネルにすると「追加」と「変更」の 2 つのパスワード欄が同時に並ぶ。フォーカストラップと Esc は要素側の仕様に任せ、自前の実装を持たない。
- 「解除」はモックに確認 UI が無いが、PAGE-p22-005 が「確認後削除」を要求するので、行内の 2 段階（解除 → 解除する / やめる）にする。モーダルを増やさずに確認を挟むため。

### Consequences
- 良い点: モックの完成イメージを崩さずに、モックが描いていない 2 状態（追加中 / 解除確認）を足せる。ダイアログの a11y を自作しない。
- トレードオフ: 同じ「パスワード入力」の見た目が 2 か所（ダイアログとパネル）に分かれる。共有するのは `components/auth/formStyles.ts` の入力 recipe と `components/settings/panelStyles.ts` のパネル / ボタン recipe まで。

---

## ADR-047: プロフィールの読み取りと handle の空き確認を `updateProfile` の対として application に置く

### Status
Accepted

### Context
P-21 は保存だけでなく **現在値の表示**（表示名 / 自己紹介 / アイコン / ハンドル）から始まるが、`bio` を射影するユースケースが実コードに存在しない。`AuthenticatedUserView`（`authenticateSession`）は `displayName` / `handle` / `avatarUrl` までで `bio` を持たず、`spec/usecases/identity.md` の `getPublicProfile` はハンドル鍵の公開読みなので、ハンドル未設定の利用者を引けない。プレゼンテーションから `RequestContainer.userReader` を直接叩けば書けてしまうが、それはリポジトリ読みをアプリケーション層の外へ出すことになる。

あわせて `spec/pages/index.md` の P-21 状態一覧と `spec/manual-tests/account.md` TC-10 手順 3 は「ハンドル欄に入力すると重複チェックが走り、使用可能であることが示される」を要求するが、保存前に空きを問い合わせる経路も無い。

### Decision
`application/identity/` に読み取り専用の 2 つを足す。どちらも `updateProfile` の対であり、新しいドメイン要素を導入しない。

- `getProfile(userId): ProfileView` — `updateProfile` の出力 DTO と同じ射影（`view.ts` の `ProfileView` / `toProfileView` を共有）。`DeletedUser` は `USER_NOT_FOUND`、`PendingUser` は `EMAIL_NOT_VERIFIED`。
- `checkHandleAvailability(userId, handle): HandleAvailabilityView` — `IdentityUniqueDirectory.resolve` の**目安**。`active` な claim しか見ないので、他者が `reserved` にした鍵は「空き」と読める。確定するのは `updateProfile` の予約だけで、UI もこの結果で送信可否を変えない。公開ハンドルは URL として公開される情報なので、`spec/adr/028-account-enumeration-resistance.md` が塞ぐ種類のオラクルには当たらない（呼び出しは認証済みセッションに限る）。

### Consequences
- 良い点: P-21 が層を飛ばさずに書け、`bio` の射影が 1 か所（`toProfileView`）に閉じる。空き確認が「目安」であることが型と JSDoc に残るので、後から「予約の代わり」に使われる誤解が起きにくい。
- トレードオフ: plan.md の 20 ユースケース表に無い読みが 2 つ増える（どちらも write を持たない）。`checkHandleAvailability` は保存時の判定と食い違いうるので、UI 側で「使用できます」を送信可否に結びつけない規律が要る。

---

## ADR-048: `storeAvatar` は宣言サイズを受け取らず、実バイト長で検査する

### Status
Accepted

### Context
`spec/usecases/storage.md` の `storeAvatar` の入力 DTO は `size` と `body` の両方を持つ。両方あると「宣言サイズは 4 MB、実体は 6 MB」という状態が表現でき、`UploadValidationPolicy.ensureAcceptable` をどちらで呼ぶかで上限の意味が変わる。宣言側で呼べば嘘の宣言で上限を越えられ、実体側で呼べば `size` は誰も読まないフィールドとして残る。

### Decision
入力 DTO から `size` を落とし、`ByteSize.create(body.byteLength)` を唯一のサイズとする。ADR-027 で `ObjectStorage` がバイト列しか受けないと決めた以上、ユースケースは必ず実体を握っており、宣言を信じる理由が無い。転送境界（`uploadAvatarFn`）は DoS 上限として 8 MB を持ち、業務上限（5 MB）より広く取る — 5〜8 MB は `UploadValidationPolicy` に届いて `FileTooLarge` になり、上限違反の理由がドメインの 1 か所に残る。spec との差分は spec-sync 候補に載せる。

### Consequences
- 良い点: 「宣言と実体が食い違う」状態が型として作れない。上限の判定点が 1 つになり、TC-storage-171 / 172 の境界がドメイン単体でも成立する。
- トレードオフ: spec の入力 DTO から 1 フィールド減る（spec-sync 候補 1 件）。ストリーム取り込み（#6）で「読み切る前に上限で切る」形が要るときは、そのスライスが `size` を戻すか別の手段を選ぶ。

---

## ADR-049: `updateProfile` の handle 予約 operation ID は利用者から合成する

### Status
Accepted

### Context
TC-identity-280 は「新 handle の予約後・UserId shard 更新前に失敗し、再試行すると**同じ operation ID で予約を再利用**する」ことを求める。`completeOAuthSignIn` のように親 operation ID を `idGenerator.next()` で採ると、再試行のたびに別 ID になる。memory の `IdentityUniqueDirectory.reserve` は「同じ鍵に別 operation の行があり、期限切れでもない」を `HANDLE_ALREADY_USED` として撥ねるので、**自分自身の予約に衝突して再試行が通らない**。

### Decision
親 operation ID を `identity.updateProfile:{userId}` として合成する（鍵ごとの sub-operation は既存の `reservationOperationId` が `:{kind}:{normalizedKey}` を足す）。旧ハンドルの解放も同じ規則で `…:release:handle:{旧ハンドル}` を導出する。ADR-019 / ADR-035 の「継続 ID は生成元から決定的に導出する」と同じ考え方で、ハッシュではなく構成で作る。

同一利用者の 2 つのプロフィール更新が同時に走ったときは、同じ鍵を同じ ID で予約する形になるが、`reserve` は同一 operation の再送を冪等 no-op として扱い、勝者は UoW 内の版検査（`OPTIMISTIC_LOCK_FAILURE`）が決めるので、二重に活性化されることはない。

### Consequences
- 良い点: 応答喪失からの再開が予約層でも成立し、TC-identity-280 / 281 が仮実装なしで通る。予約行が孤児になっても、同じ利用者の次の試行が必ず同じ ID で拾い直す。
- トレードオフ: 予約行の `operationId` が推測可能な文字列になる（`IdentityUniqueDirectory` は所有者一致を別に見るので、推測できても他人の鍵は動かせない）。

---

## ADR-050: 保管オブジェクトの配信は splat ルート `/storage/$` で受ける

### Status
Accepted

### Context
steps.md は配信ルートを `apps/web/app/routes/storage.$key.tsx` と書くが、`ObjectKey.build` が作る鍵は `users/{userId}/avatar/{fileId}.png` という**複数セグメント**で、単一の動的パラメーターでは受けられない。`publicUrl` を `encodeURIComponent` した形に変えると `%2F` を含むパスになり、前段のプロキシの正規化で壊れる。

### Decision
ファイル名を `routes/storage.$.tsx`（splat）にし、`params._splat` を `ObjectKey.create` に通す。ハンドラーは TanStack Start のルート `server.handlers.GET` で、`Response` を直接返す（HTML ルートではないので component を持たない）。形式違反の鍵は 400 ではなく 404 に倒す — 形の違いを区別すると鍵空間の探索の手掛かりになる。応答には `Cache-Control: public, max-age=31536000, immutable`（鍵にファイル ID が入るので中身は不変。差し替えは必ず別の鍵になる）と `X-Content-Type-Options: nosniff` / `Content-Security-Policy: sandbox; default-src 'none'` を付ける。

### Consequences
- 良い点: memory 配備でアイコンが実際に配信でき、`publicUrl` の形をアダプターに閉じたまま保てる。R2 等の公開ドメインへ移る配備ではこのルートごと落とせる。
- トレードオフ: steps.md のファイル名と 1 文字違う。splat なので `/storage` 配下の未定義パスもこのハンドラーに入る（不在は 404 を返すので実害は無い）。

---

## ADR-051: `getUsageSnapshot` の出力から workspace ページングの構造ごと落とす

### Status
Accepted

### Context
plan.md の縮退で「workspace セクションは常に空配列」と決めたが、spec の出力 DTO は `workspaces: WorkspaceUsageItem[]` と `nextWorkspaceCursor: string | null`、入力 DTO は `workspaceCursor` / `workspaceLimit` を持つ。空配列だけを返す実装でも、この 3 つのフィールドと `WorkspaceUsageItem`（`available` / `unavailable` の判別共用体）を型として置くことはできる。置けば「P-24 が読める形」に見えるが、`membership_directory` の keyset を引くポートが無いので、`nextWorkspaceCursor` は常に `null`、`workspaceCursor` は常に無視される — 値を持たない引数と、常に同じ答えを返すフィールドになる。

### Decision
入力から `workspaceCursor` / `workspaceLimit` を、出力から `nextWorkspaceCursor` と `WorkspaceUsageItem` を落とし、`workspaces: readonly never[]` だけを残す。`never[]` にするのは、要素を作る経路が本スライスに無いことを型で表すため — 要素型を先に決めておくと、#3 が実ポートに合わせて決める自由を奪う。#3 はこの 1 フィールドを広げ、cursor 系のフィールドを同時に足す。

### Consequences
- 良い点: 「常に `null` を返す cursor」という嘘のインターフェースを UI に見せない。PAGE-p24-002 を UI に出さない判断（無効ボタンの placeholder も置かない）と、DTO の形が一致する。
- トレードオフ: #3 は DTO の破壊的変更を伴う（フィールド追加ではなく `never[]` の置換）。呼び出し元は P-24 の 1 か所だけなので影響範囲は閉じている。

---

## ADR-052: `recalculateStorageUsage` の入力に主体とは別の実行者 `userId` を持たせる

### Status
Accepted

### Context
spec の入力 DTO は `subjectType` / `subjectId` だけで、実行者を持たない（運用操作として書かれているため）。一方 steps.md / AC-22 は「scope の通常 write 入口として `cleanupAdmission.assertWritable()` と `assertActorWritable(userId)` の 2 本を呼ぶ」ことを求め、後者は `UserId` を要る。主体（workspace かもしれない）から実行者を導くことはできない。

### Decision
入力に `userId`（実行者）を `subjectType` / `subjectId`（主体）と並べて持たせる。personal 主体では両者が一致するが、型としては別物として扱う — workspace 主体の再計算はメンバーが実行するので、主体から実行者を導く実装は #3 が membership を足した時点で誤りになる。本スライスは実行者と主体の一致を検査しない（`assertActorWritable` が actor ロックを見るだけ）。権限検査（誰が再計算してよいか）は `WorkspaceAuthorization` を持つ #3 の担当で、ADR-014 の `storeAvatar` と同じ扱いにはしない — こちらは値を作り直すだけで、新たな消費も外部への露出も生まない。

### Consequences
- 良い点: `assertActorWritable` を実装でき、TC-identity-045 が Usage 経路でも成立する。#3 が権限検査を足すときに引数を増やす必要が無い。
- トレードオフ: spec の入力 DTO と 1 フィールド差がある（ステップ 34 の spec-sync 候補）。

---

## ADR-053: manifest header に読み取り (`describe`) を足し、build continuation は自分の cursor を運ぶ

### Status
Accepted

### Context
`identity.accountDeletionManifestBuildContinued` の spec DTO は `{ operationId, phase }` だけで、page 位置は manifest header（`membershipCursor` / `authorRouteCursor`）に置くと定める。ところが実コードの `AccountDeletionManifestStore` に header を読む手段が無く、継続ハンドラーは (a) どの利用者の route を走査するか（`userId`）も (b) どこから再開するか（cursor）も知りようがない。さらに header の cursor だけで再開すると、**phase の最終 page を再配送されたときに cursor が `null` に戻っているためその phase を先頭から開き直す**（items は冪等 append なので壊れないが、`次 page へ進む` という TC-identity-096 / 101 の期待と食い違い、1 往復余計に回る）。

### Decision
2 点セットで解く。

- `AccountDeletionManifestStore.describe(operationId): Promise<AccountDeletionManifestHeader | null>` を足す（ADR-018 が `ScopeCleanupAdmissionStore.describePersonalCleanup` を足したのと同型の「再駆動を冪等にするための読み取り 1 本」）。継続ハンドラーはこれで `userId` と `status` を得る。`status !== "building"` なら late redelivery として即 return する。適合スイートに 1 ケース追加。
- build continuation の payload に `cursor: string | null` を載せる。1 つの継続イベントが 1 つの turn を完全に記述するので、再配送は**同じ page をもう一度固定する**（冪等 append）だけで済み、phase を巻き戻さない。ADR-019 の `continuationKey` が `cursor` を材料に含む以上、event ID と turn が 1:1 になるのはこの形でだけ成立する。header 側の cursor は「build がどこまで進んだか」の記録として維持する（author route の外部走査は UoW の外で行うため、`describe` が返す `userId` と合わせて必要）。

### Consequences
- 良い点: 応答喪失の再実行が「同じ turn の再実行」に閉じ、cursor の巻き戻りが構造的に起きない。header 読み取りは #4 / #5 / ステップ 30 の finalize / prune でも使える。
- トレードオフ: spec の継続 DTO と 1 フィールド差（`cursor`）ができ、ポートに読み取りが 1 本増える。どちらもステップ 34 の spec-sync 候補に載せる。

---

## ADR-054: 削除の継続ハンドラーは worker plane の consumer とし、`NoteRouteFanOutReader` は `WorkerContainer` に載せる

### Status
Accepted

### Context
steps.md / AC-31 は `NoteRouteFanOutReader` を `RequestContainer` に載せると書いていた。これは `deleteAccount(input)` を 6 variant すべてのディスパッチャーとして `ServiceArgs`（= `RequestContainer`）で書く前提に立っている。しかし実際の運搬路は global outbox → relay → `application/workers/subscribers.ts` であり、購読者ハンドラーの引数は `WorkerContainer` に固定されている（`authResidueCleanup` / `deleteStoredObjects` と同じ）。`RequestContainer` は購読者からは作れない。

### Decision
- `deleteAccount`（`ServiceArgs`, `RequestContainer`）は **`userRequest` の受理経路だけ**を担う。presentation が呼ぶのはこれ 1 つ。
- 継続 variant（manifest build / dispatch phase / compact / prune / personal barrier prune）はそれぞれ独立した関数として `WorkerContainer` を取り、購読者レジストリと（scope 平面は）タスクランナーから駆動する。`pruneExpiredAuthState` が `WorkerContainer` 用の Args 型を自前で持つのと同じ扱い。
- したがって `NoteRouteFanOutReader` の読み取りビュー（`Pick<…, "listByCreatedBy">`）は **`WorkerContainer`** に載せる。`RequestContainer` には載せない（使う者がいない配線を作らない）。header 読み取りは `WorkerContainer` が既に持つ `accountDeletionManifestStore` を UoW の外から使う。
- `deleteAccount/input.ts` は spec どおり 6 variant の判別共用体を型として保持する（DTO の契約）。ディスパッチャーが 1 つに集約されないだけで、型の網羅は失われない。
- scope cleanup のユースケース（`deleteQuota` / `deleteFilesByOwner`）も同じ理由で `WorkerContainer` を取る。

### Consequences
- 良い点: 未実装 phase のためのスタブ分岐が 1 つも要らない（存在しないハンドラーは購読エントリーが無いだけ）。読み取りポートが実際の利用者と同じ container に載る。
- トレードオフ: AC-31 の文言（「`NoteRouteFanOutReader` → `RequestContainer`」）と実装がずれる。ステップ 34 で AC-31 の該当行を「`WorkerContainer`」と読み替えて記録する。

---

## ADR-055: scope cleanup の 1 turn は自分の継続タスクを自分で決着させ、結果を呼び出し元へ返す

### Status
Accepted

### Context
spec は「継続タスクの保存は本処理と同一 UoW」と定める一方、ADR-005 のランナーは「`claimDue` → ユースケース再投入 → `complete` / `backoff`」と書かれている。`ScopeTaskScheduler.schedule` は `(kind, operationId)` の upsert なので、turn が残件のために同じ行を再 upsert した直後にランナーが `complete` を呼ぶと、**積んだばかりの継続が消える**。

### Decision
turn 側を正とし、結果でランナーに伝える。

- 残件があれば turn が同じ行を `schedule` で再武装して `status: "continued"` を返す。ランナーはこの turn の claim を **`complete` してはならない**。
- 仕事が尽きたら turn が component ack と `complete` を同一 UoW で行い `status: "settled"` を返す（`complete` の二重呼び出しは no-op なので、ランナーが重ねて呼んでも安全）。
- 対象が残っているのに 1 件も消せなかったときは turn が `backoff` を呼び `status: "stalled"` を返す（新しい継続は積まない — TC-storage-041）。
- 初回コマンド配送だけ `commandKey` を伴い、`AppliedOperationStore.markApplied` が偽を返したら `status: "alreadyApplied"` で何もしない。継続 turn は `commandKey` を持たない（同じ鍵で抑止されると 2 turn 目以降が進まなくなるため）。

### Consequences
- 良い点: 「同一 UoW で継続を保存する」という spec の要求と、claim/settle するランナーの両方が矛盾なく成立する。ステップ 31 は `status` を見るだけで書ける。
- トレードオフ: spec が出力 DTO を持たない `deleteQuota` にも戻り値ができる（`deletedCount` を持つ `deleteFilesByOwner` は spec の DTO に 1 フィールド追加）。ステップ 34 の spec-sync 候補。

---

## ADR-056: cleanup dispatcher は membership の `claimPending` を呼ばない

### Status
Accepted

### Context
spec 手順 4 の cleanup phase は `claimPending(operationId, "cleanup", 100)` で membership item のコマンド鍵を確定してから配送する。本 Issue には membership item を作る経路も、cleanup コマンドを受けて ack する受け手（Workspace）も無い。

### Decision
personal participant（`storage` / `usage`）への配送だけを行い、membership の `claimPending` は呼ばない。claim は「配送前に鍵と `dispatchedAt` を確定する」ための操作であり、配送先が無い状態で呼ぶと「dispatch 済みだが誰も ack しない item」を作るだけになる。#3 が受け手を足すときに、claim と配送と ack を 1 組で追加する。

### Consequences
- 良い点: manifest 上に宙ぶらりんの dispatch 記録を作らない。#3 の追加点が 1 か所にまとまる。
- トレードオフ: steps.md のステップ 29 (4) の記述（`claimPending("cleanup", 100)` から始める）と実装が異なる。#3 への引き継ぎとして本 ADR とコード上のコメントに残す。

---

## ADR-057: TC-storage-043 は「1 turn = 列挙 1 回 + ファイル 1 件につきイベント 1 件」として検証する

### Status
Accepted

### Context
TC-storage-043 の期待結果は「列挙 1 文 + 多行 DELETE 1 文 + 多行 outbox INSERT 1 文で、件数によらず 3 文」。しかし ADR-022 が確定したとおり、`deleteFiles` は OCC トークンを `findById` からしか得られないため 1 件ずつ読んで消す（N+1）。memory バックエンドには「発行 SQL 文数」という観測点も無い。

### Decision
この行は turn が保証する観測可能な性質——**列挙は 1 回だけ / 削除できたファイル 1 件につき `storage.fileDeleted` が 1 件 / どちらも件数に依存しない**——として検証する。多行 DELETE / 多行 INSERT へまとめるかはバックエンドの実装事項であり、OCC 契約（書く意図の読みは `findById` を通る）を優先する。spec と実装の差はステップ 34 の spec-sync 候補に載せる。

### Consequences
- 良い点: ADR-022 と矛盾しない形で行を消化でき、テストが実装の内部（文の数）ではなく契約（列挙回数とイベント数）を固定する。
- トレードオフ: spec の「3 文」という性能上の約束は本スライスでは検証されない。D1 実装を書くスライスが同じ行を再検証する必要がある。

---

## ADR-058: author redaction は投影ポートの `redactAuthor` 1 本で行う

### Status
Accepted

### Context
spec 手順 4 の author redaction は `projection.authorRedactionRequested` を local / public 両平面へ送り、受け手（`projectNoteChanges` — Note スライス、ADR-009 で見送り）が「著者を『退会した利用者』・`authorVersion` を `redactionVersion` とした完全 snapshot」で置換する。本 Issue には受け手が居ないので `deleteAccount` 自身が書くしかないが、`replaceSnapshotIfNewer` は完全 snapshot を要求する。既存 snapshot を読んで書き戻す形にすると (a) local は `NoteProjectionSnapshotReader` を Scope UoW に載せる必要があり、(b) public には entry を返す読み取りポートが存在せず、(c) 行が無い Note に対して「無から投影行を作る」危険がある。

### Decision
`LocalNoteProjectionWriter` / `PublicNoteProjectionWriter` に `redactAuthor({ noteId, createdBy, redactionVersion }): Promise<boolean>` を足す。契約は「保存済み行の著者表示だけを `{ displayName: "退会した利用者", handle: null, version: redactionVersion }` へ置換する。行が無い / 別の作成者 / 既に同世代以降なら no-op で `false`」。実 DB では単一 UPDATE（`WHERE created_by = ? AND author_version < ?`）に写る。

- `redactionVersion` は削除対象 User の現 `version`。受理時の `beginDeletion` がバンプ済みなので、削除前に発行された Note event が運ぶ `authorVersion` より必ず大きい（TC-identity-082）。
- 対象 scope は manifest の item ではなく `NoteRouteStore.resolve` で引き直す（spec「routeが移動していればcurrent routeへ再解決し、purged/tombstoneなら両planeをackする」）。そのため `Pick<NoteRouteStore, "resolve">` を `WorkerContainer` に載せる。
- 定数 `WITHDRAWN_AUTHOR_DISPLAY_NAME` はポート側に置き、両平面と将来の `projectNoteChanges` が同じ文言を使う。

### Consequences
- 良い点: 読み取りポートを 2 つ増やさずに済み、「無から投影行を作る」経路が型に存在しない。冪等性が `>=` 比較 1 つで表現でき、at-least-once 配送に耐える。
- トレードオフ: #1 の完成物である投影ポート 2 本に手が入る（ADR-015 / 002 / 017 の 3 ポートに続いて 4・5 本目）。`projectNoteChanges` を実装するスライスは、完全 snapshot 置換と `redactAuthor` のどちらで redaction を受けるかを選ぶ必要がある — spec-sync 候補。

---

## ADR-059: `pruneTerminal` は回収した operation ID を返す

### Status
Accepted

### Context
ADR-026 は「terminal の回収は manifest の terminal prune が `deleteTerminal(operationId)` を**同一 transaction**で呼ぶ形に限る」と定める。ところが `AccountDeletionManifestStore.pruneTerminal` は `{ removed: number; nextCursor }` を返すだけで、どの operation を消したかを呼び出し側が知る手段が無い（header を列挙する別の読み取りも無い）。

### Decision
`pruneTerminal` の戻りを `{ operationIds: readonly string[]; nextCursor: string | null }` にする。`removed` は `operationIds.length` と重複するので置き換える（2 つの値がずれる状態を作れなくする）。適合スイート ADP-common-025 も同じ形へ更新する。

### Consequences
- 良い点: 「header と operation を同じ transaction で消す」が呼び出し側のコードとして書ける。回収対象の列挙という読み取りポートを別に足さずに済む。
- トレードオフ: #1 の完成物の戻り値型が変わる（呼び出し側は適合スイートのみだった）。spec/database の列構成との差と合わせて spec-sync 候補。

---

## ADR-060: dispatch 継続は turn 識別子 `cursor` を運び、finalize の再試行は発行元で名前を分ける

### Status
Accepted

### Context
ADR-019 は global 平面の継続イベント ID を `continuationKey` から決定的に導出すると定め、ADR-025 は「同じ phase を繰り返す継続に決定的キーを与えるときは、ターンを識別する材料をキーに含めなければならない」と制約を付けた。ステップ 30 が足す継続のうち、**redaction**（100 件ずつ ack して次ページへ）と **compaction**（100 件ずつ削除して次ページへ）は同じ phase を繰り返す。加えて **finalize** は「必須 receipt が揃った時点で再試行する」形で、redaction 完了 / uniqueness 解放 / 認証残渣完了の 3 経路が同じ 1 つの試行を要求しうる。

### Decision
- `identity.accountDeletionDispatchContinued` の payload に `cursor: string | null` を足し、`identity.accountDeletionManifestCompactContinued` を新設して同じ形にする。redaction / compaction は turn 番号（`"1"`, `"2"`, …）を `cursor` に載せるので、`continuationKey` がターンごとに変わる。
- **finalize は自分自身を再発行しない**。代わりに receipt を完成させうる 3 経路が、それぞれ発行元名（`redaction` / `uniquenessRelease` / `authResidue`）を `cursor` に載せて finalize 試行を積む。同一キーの upsert にならないので、「配送中の行を上書きして直後の relay finalize に消される」競合が構造的に起きない。finalize は冪等（`status !== "built"` / user が `deleted` なら即 return）なので、3 経路が全部積んでも害は無い。
- 認証残渣の継続（`identity.userAuthResidueCleanupContinued`）は ADR-025 のとおり `continuationKey` を持たない。

### Consequences
- 良い点: 応答喪失後の再実行で継続チェーンが 2 本走らない、という ADR-019 の不変条件が redaction / compaction にも適用でき、同時に ADR-025 の罠を踏まない。finalize の再試行主体が「最後の ack を書いた者」に定まり、待ち合わせのための polling が要らない。
- トレードオフ: spec の継続 DTO と 1 フィールド差（`cursor`）が 2 種類増える（ADR-053 の build continuation と同じ扱い）。spec-sync 候補。finalize 試行が最大 3 イベントに増える。

---

## ADR-061: scope 継続タスクのランナーは kind → ハンドラーのレジストリで引く

### Status
Superseded by ADR-071（kind → ハンドラーのレジストリは残り、「ランナーは claim しない」だけが覆る）

### Context
ADR-005 / ADR-023 はランナーが `ScopeTaskQueue.listDue` で列挙し `scopeUnitOfWorkProvider.run(scope, …)` を開いて `claimDue` → 再投入 → `complete` / `backoff` を行うと書いていたが、ADR-055 が「turn 側が自分の継続タスクを自分で決着させる」を確定させた。ユースケース（`deleteFilesByOwner` / `deleteQuota`）は自分で scope UoW を開くので、ランナーが UoW の中でユースケースを呼ぶと UoW がネストする。

### Decision
`application/workers/scopeTaskRunner.ts` に `Record<kind, ScopeTaskHandler>` のレジストリを置き、ランナーは (1) `listDue` で列挙 → (2) kind でハンドラーを引く → (3) ハンドラーがユースケースを呼ぶ（ユースケースが自分で scope UoW を開き、`schedule` / `complete` / `backoff` まで済ませる）だけにする。ランナー自身は `claimDue` を呼ばない。

- 本 Issue が登録するのは `storage.ownerDeleteContinued` / `usage.userCleanupContinued` / `identity.personalBarrierPruneContinued` の 3 kind。
- scope→global ブリッジ（`personalCleanup` receipt の記録）は scope 平面から書けないので、ハンドラーが turn の戻り `personalCleanupCompleted` を見て `acknowledgePersonalCleanup` を別 UoW で呼ぶ。
- ハンドラーが無い kind は **due のまま残して警告する**。`complete` して黙って捨てると「掃除したつもりで動いていない」状態が見えなくなる。
- 1 タスクの失敗は他のタスクを止めない（worker → root の部分失敗許容。CLAUDE.md の catch 方針で broad catch が許される唯一の場所）。

### Consequences
- 良い点: UoW のネスト禁止と「継続の保存は本処理と同一 UoW」の両方が同時に成り立つ。kind を足す = レジストリに 1 行足す、になる。
- トレードオフ: `ScopeTaskScheduler.claimDue` の実利用者が本 Issue に居なくなる（適合スイートのみ）。複数プロセスでランナーを走らせる場合は claim による排他が要るので、そのときにランナー側へ戻す判断が必要 — #11 への引き継ぎ。

---

## ADR-062: `/settings` の認証ガードは P-25 だけ通す

### Status
Accepted

### Context
ADR-006 は「ticket を `sessionStorage` に退避してリロードから復帰できるようにする」と決めたが、P-25 は `/settings` レイアウトルートの子で、そのルートの `beforeLoad` が `requireAuthenticated` を通す。削除の受理はその応答でセッションを失効させるので、**受理後にリロードした利用者は必ず `/signin` へ飛ばされる** — 退避した ticket は到達不能なまま残り、ADR-006 の復帰は成立しない。TanStack Router の親 `beforeLoad` が投げる redirect は子が打ち消せないので、子ルート側では解けない。

### Decision
`/settings` の `beforeLoad` を「セッションが無く、かつ pathname が `/settings/danger` のとき **だけ** `{ user: null }` を返す」形にし、それ以外は従来どおり `/signin` へ redirect する。`user === null` のときレイアウトは `AppShell`（アカウントメニュー）とタブ列を描かず、中央カラムだけを出す — サインアウト済みの状態で他タブへの導線を出しても行き先がすべて redirect になるため。`AppShell` / `AccountMenu` / `SettingsTabs` には手を入れない。

「P-25 はセッションが無くても開ける」は抜け道ではなく設計上の性質である: 受理と同時にセッションが消える以上、進捗を読める画面は認証を要求できない。読み取りの権限は ticket が持ち、`getAccountDeletionStatus` は ticket が名指す 1 件しか返さない。

### Consequences
- 良い点: ADR-006 のリロード復帰が実際に成立する。変更が `routes/settings/route.tsx` 1 本に閉じる。
- トレードオフ: `/settings/danger` は未サインインでも 200 を返す（中身は説明文と確認フォームで、`deleteAccountFn` 自体は `requireSession()` を通すので操作はできない）。パスの直書きが 1 箇所増えるので、#3 がワークスペース設定タブ列を足すときにこの分岐を見落とさないこと。

---

## ADR-063: status ticket は失効の理由を 2 コードに分け、HTTP ステータスの例外表は増やさない

### Status
Accepted

### Context
`presentation/deletionTicket.ts` の検証失敗には「署名が合わない / 形が壊れている」と「署名は正しいが 30 分を過ぎた」の 2 種類がある。前者は実運用では起こらず（発行元は自分だけ）、後者は正常な経過である。steps.md のステップ 32 は対象ファイルに `presentation/errorResponse.ts` を挙げており、ticket 失効を HTTP ステータスの例外（401 など）に載せる余地があった。

### Decision
- コードは `DELETION_TICKET_INVALID` と `DELETION_TICKET_EXPIRED` の 2 つに分ける。P-25 が出す文言が違う（前者は「進捗を確認できませんでした」、後者は「確認できる期間を過ぎました」）ためで、どちらも「削除の処理はこのまま進みます」を添える。期限の判定は**署名の検証を通った後にだけ**行うので、偽造 ticket が `EXPIRED` として返ることはない。
- `presentation/errorResponse.ts` の `HTTP_STATUS_BY_CODE` には**足さない**。`spec/presentation/index.md#コードによる例外` は「この例外は上表の 5 行だけとし、増やすときはクライアントの振る舞いが実際に変わるかを基準にする」と定めており、ticket 失効でクライアントがすることは「ポーリングをやめて文言を出す」だけで、422 のままでも達成できる。したがってステップ 32 の対象ファイル一覧のうち `errorResponse.ts` は変更しない。

### Consequences
- 良い点: 秘密や状態を漏らさずに、正常な失効と異常な ticket を利用者向けに書き分けられる。spec の閉じた 5 行を守る。
- トレードオフ: steps.md の対象ファイル一覧と実際の変更が 1 本ずれる（ステップ 34 の記録対象）。

---

## ADR-064: `SignInOAuthClient` の適合スイートは資格情報の要否で 2 つに割る

### Status
Accepted

### Context
AC-6 は 2 つを同時に求める: (a) Google アダプターの適合スイートは資格情報の無い環境で `describe.skip` 相当になること、(b) `deriveCodeChallenge` の S256 契約（同一 verifier → 同一値 / 43 文字 base64url / 認可 URL に `code_challenge_method=S256`）は資格情報を要さない純関数の検証として**両アダプターで実行する**こと。ステップ 13 の実装は `enabled: false` をスイート全体に掛けていたため、(a) は満たすが (b) が満たされず、Google アダプターの S256 導出は既定の開発機と CI のどちらでも 1 度も実行されていなかった（スイートの JSDoc の「PKCE half runs for every adapter」も実態と食い違っていた）。

### Decision
`describeSignInOAuthClientContract` を 2 つの `describe` に割る。

- `SignInOAuthClient authorization request [adapter]` — `deriveCodeChallenge` と `buildAuthorizationUrl` の 2 ケース。どちらも外部と通信せず、資格情報も読まない（Google 実装は `client_id` を URL に載せるだけで、空文字でも契約は検証できる）ので、**常に**実行する。
- `SignInOAuthClient conformance [adapter]` — `exchangeCode` の 3 ケース。`enabled: false` のときスキップする。

### Consequences
- 良い点: AC-6 の 2 条件が同時に成立し、「資格情報が無い」ことでスキップされる範囲が実際に provider を要する部分だけに縮む。
- トレードオフ: 1 アダプターにつきスイート名が 2 つ出る。`live` provider が資格情報つきで走っても交換系 3 ケースは早期 return のままで、実際に交換を検証するのは `offline`（dev IdP）だけという構造は変わらない。

---

## ADR-065: outbox の `save` は id 衝突を「先着行をそのまま残す no-op」として契約する

### Status
Accepted

### Context
ADR-019 は継続イベントの ID を `continuationKey` から決定的に導出すると決め、その正しさの根拠を「同じ ID の再保存は同じ outbox 行への upsert になる」に置いた。ところがこの性質は `OutboxRepository.save` の契約に書かれておらず（JSDoc は「entity 変更と同一トランザクションで走る」だけ）、適合スイートにも重複 ID のケースが 1 件も無く、memory 実装の `table.set(event.id, …)` という実装特性だけが支えていた。しかもその実装は `attempts` / `processedAt` / `claimedAt` も初期値に戻すので、**配送済み・隔離済みの行を復活させる**（ADR-019 自身が「JSDoc に書く必要がある」と宿題にしていた挙動）。契約が無い以上、#11 の D1 実装は素の `INSERT`（UNIQUE 違反でビジネス transaction ごと巻き戻る）とも `INSERT OR IGNORE` とも書けてしまい、どちらも現行のテストでは検出できない。

### Decision
「`id` は outbox 行の同一性である。既に保存されている id のイベントは skip し、先着行（payload・`attempts`・再試行予定・claim・processed / 隔離の状態）をそのまま残す。これはエラーではなく、同一バッチの他イベントは通常どおり保存される」をポートの契約として明文化し、適合スイートで固定する（「再 save で行が増えない」「再 save が attempts と再試行予定を戻さない」「processed 済み id の再 save は再配送されない」の 3 ケース）。memory 実装は `table.has(event.id)` で skip する形、すなわち `INSERT … ON CONFLICT (id) DO NOTHING` と同じ意味に揃える。

**復活させない**ことを選んだ理由は 4 つある。

- ADR-019 が必要としているのは「行が 2 本にならない」ことだけで、既存行の書き換えは要らない。
- processed 行の復活は、応答喪失 1 回につきチェーンの**残り全部**を再実行させる（復活した turn がその後続 turn を再 save し、それも processed なので復活する、という連鎖）。
- ADR-025 の罠（同一キーの継続がリレー自身の `finalize` に消される）は save → finalize の**順序**に由来するので、upsert でも no-op でも結末は変わらない。復活は ADR-025 の救済にならない。むしろ ADR-025 が「決定的キーはターンごとに変える」を課している以上、**id が衝突する = 同じ論理イベントの再保存**が設計上の不変条件であり、その前提の下では先着優先の no-op が唯一健全な衝突解決になる。
- 隔離行（`failed_at`）の再 kick は `eventRelayWorker.ts` の JSDoc が運用作業として定めている。save が `attempts` を 0 に戻すと、再配送のたびに毒行の再試行予算が回復して隔離が意味を失う。

### Consequences
- 良い点: ADR-019 の不変条件がバックエンド横断の契約として固定され、#11 の D1 実装は `ON CONFLICT DO NOTHING` を書くしかなくなる。ADR-019 がトレードオフとして挙げていた「配送済みの継続が 1 度だけ再配送されうる」が消える。
- トレードオフ: 重複排除は行の寿命と等しく、`pruneProcessed` が id を解放した後は同じ id を再び保存できる。したがって outbox の保持期間は再配送窓を上回っている必要がある（既定では桁で上回る）。`spec/database/index.md` の「同じ PK / outbox ID へ upsert される」は「1 行に畳まれる」意図としては一致するが語が合わないので spec-sync 候補に載せる。ADR-019 の Decision 中の「memory の `save` は upsert なので〜」という根拠づけは本 ADR で置き換わる。

---

## ADR-066: 同一オリジン判定は `SameOriginPolicy` 1 本に集約し、ドメインに置く

### Status
Accepted

### Context
同一オリジン判定が 2 箇所にあり、片方だけが正しかった。`AvatarUrl.create` は「先頭が `/` で `//` でない」しか見ておらず、`startOAuthFlow.assertSameOriginPath` はそれに加えてバックスラッシュと C0 制御文字を弾いていた。URL パーサーは special scheme でバックスラッシュを区切りとして扱い、解決前に C0 制御文字を除去するので、`"/\evil.test/x.png"` と `"/<LF>/evil.test/x.png"`（先頭スラッシュ直後の制御文字）はどちらも `AvatarUrl` を通過して別オリジンへ解決していた（Node 22 で実測）。転送境界は長さ上限しか見ない設計（入力検証 2 点）なので、業務不変条件を持つのは VO 側だけであり、そこが抜けていた。

### Decision
述語を `packages/core/src/domain/identity/services/sameOriginPolicy.ts` の `SameOriginPolicy.isSameOriginPath(value: string): boolean` として 1 本化し、`AvatarUrl.create` の相対パス分岐をそれに寄せる。

- **ドメインに置く**: 「保存されるアバターの位置は自オリジンに限る」も「認可往復の後に再生する遷移先は自オリジンに限る」も業務不変条件であって transport の形の話ではない。`lib/` の構造的プリミティブでもない（`lib/` はエラー契約の土台であり、判断を持たない）。
- **真偽値を返す述語にする**: 呼び出し側でエラーの種類が違う（VO は `BusinessRuleError(InvalidAvatarUrl)`、`redirectTo` は `ValidationError(INVALID_REDIRECT)`）ので、述語は判定だけを持ち、どう倒すかは呼び出し側が決める。
- **絶対 URL 形は述語の対象外**: `AvatarUrl` が受ける「自オリジンの絶対 URL」は `URL.origin` の比較で判定でき、パス形の落とし穴とは別問題なので現行のまま残す。
- `startOAuthFlow.assertSameOriginPath` をこの述語へ寄せ替えるのは U-5 の担当。

### Consequences
- 良い点: 3 つの回避形（`//host`・バックスラッシュ・C0 / DEL）が 1 箇所でしか判定されなくなり、片方だけ知識が反映されない状態が作れない。境界値は `domain/identity/__tests__/policies.test.ts` が `new URL` の解決結果と対にして固定している。
- トレードオフ: 述語は必要より厳しい。`"/x<LF>/y.png"` のように制御文字が先頭スラッシュ直後でない値は同一オリジンに解決するが拒否する。アバターの位置にも遷移先にも制御文字が要る用途は無いので、緩めるより単純さを採る。

---

## ADR-067: 交換系適合スイートの gate は「資格情報の有無」ではなく「認可コードを発行できるか」で決める

### Status
Accepted（ADR-064 の Decision を一部置き換える）

### Context
ADR-064 はスイートを 2 つに割り、交換系だけを `enabled`（＝ Google 資格情報の有無）で gate した。しかしハーネス側の交換モードは `live` 固定で、3 ケースはいずれも本体先頭で `if (kind === "live") return;` していた。資格情報が**無い**環境では `describe.skip` が勝つので skip として報告されるが、資格情報を入れた瞬間に同じ 3 ケースが「アサーション 0 本の PASS」に化ける。ADR-064 自身がトレードオフ節でこの構造に触れているが、報告面（未検証が緑に見える）は宣言に含まれていなかった。資格情報があっても Google の認可コードはブラウザーの同意画面を経ないと発行されないので、「資格情報が揃えば交換系が検証できる」という gate の前提自体が成り立たない。

### Decision
gate の判定軸を資格情報から**ハーネスが認可コードを発行できるか**に移す。

- 交換モードをハーネスの戻り値から登録時の第 3 引数へ移し、`{ kind: "offline"; mintCode }` と `{ kind: "unverifiable"; reason }` の 2 値にする。`live` は消す。
- `offline` のときだけ交換系 `describe` を実行し、`unverifiable` では `describe.skip` で登録する。スイート名に `reason` を含めるので、レポートに「なぜ未検証か」が残る。
- ケース本体から早期 `return` を無くす。`describe.skip` も本体を収集するため minter は必要だが、`unverifiable` 側の minter は呼ばれたら throw する。gate を誤って広げたときに沈黙の緑ではなく失敗になる。
- AC-6 が要求する「資格情報が無い環境で skip される（skip 条件がコードで確認できる）」は登録側で維持する。`conformance.test.ts` が `GOOGLE_OAUTH_CLIENT_ID` / `GOOGLE_OAUTH_CLIENT_SECRET` を読み、無ければ `reason` を「資格情報が無い」に、あれば「Google は同意画面経由でしかコードを発行しない」に切り替える。

### Consequences
- 良い点: Google の交換系は環境によらず 3 件 skip として報告され、「緑だが無検証」が構造的に作れない。skip 件数は 3 のまま変わらない。
- 良い点: fake token endpoint を注入して Google の交換系を検証できるようにしたスライスは、登録を `offline` に差し替えるだけでよい。
- トレードオフ: 資格情報を入れても Google の交換系は 1 ケースも走らない。ADR-064 が「資格情報があれば走る」と読める余地を残していたのに対し、本 ADR は走らないことを明示的な契約にする。

---

## ADR-068: Google token endpoint 呼び出しにタイムアウト予算を置き、再試行はしない

### Status
Accepted

### Context
`exchangeCode` の `fetch` に `signal` が無く、プロバイダーがハングすると `/auth/callback/$provider` のリクエスト経路がそのままぶら下がっていた。アダプターは「transport 失敗 → `SystemError(EXTERNAL_API_ERROR)`」に翻訳する設計だが、タイムアウトが無いとその翻訳に到達しない。

### Decision
`AbortSignal.timeout` で token endpoint 呼び出しに予算（既定 10 秒、`GoogleOAuthClientOptions.tokenEndpointTimeoutMs` で上書き可）を与え、abort は既存の `catch` が拾って `SystemError(EXTERNAL_API_ERROR)` になる。**再試行は足さない**。

CLAUDE.md の「ドライバーレベルの一時エラーはアダプター内で再試行する」との整合は次のとおり: 認可コードは単回使用なので、タイムアウト後の再送はプロバイダーに「使用済みコード」として拒否される可能性が高く、再試行が成功に転じない。加えて呼び出し元は待っている HTTP リクエストなので、2 回目の予算を積むと利用者の待ち時間が倍になる。したがってこの外部呼び出しは再試行対象外であり、回復は利用者による再認可（P-05 の再試行導線）が担う。予算を設定可能にしたのは、ハングを `SystemError` に翻訳することを短い予算で検証できるようにするため。

### Consequences
- 良い点: 外部サービスのハングがリクエスト経路を無期限に占有しない。翻訳規約（provider-native なエラーを外に出さない）がタイムアウトにも及ぶ。
- トレードオフ: 予算内に返らない正当な交換は失敗になる。10 秒は Google の token endpoint に対しては十分に緩い。
- `GoogleOAuthCredentials` は資格情報だけを持つ型のまま残し、予算は別の options 引数にした（`OAuthRuntimeConfig` の判別ユニオンに運用パラメーターを混ぜないため）。composition root は既定値のまま使う。

---

## ADR-069: `uniquenessRelease` は receipt と finalize 継続を同一 UoW で書き、receipt 済みでも finalize 継続だけは再発行する

### Status
Accepted

### Context
`runAccountDeletionGlobalCleanup` は `acknowledgeReceipt("uniquenessRelease")` を UoW の外で直接ポートへ書き、finalize 継続をその後の別 UoW で発行していた。さらに冒頭で `header.receipts.includes("uniquenessRelease")` なら早期 return していた。この 2 つの組み合わせは、「receipt は残ったが finalize 継続は発行されなかった」応答喪失から回復できない: 再配送された cleanup コマンドは receipt を見て何もせずに抜け、finalize は「receipt を完成させた枝が再試行する」設計（ADR-060）なので、`uniquenessRelease` が最後の receipt だった場合に再試行する主体が誰もいなくなる。結果として利用者は `deleting` のまま PII を持ち続け、P-25 は永久に「処理中」を出す。同じ形の `acknowledgePersonalCleanup` は receipt と継続を同一 UoW で書いており、`authResidueCleanup` は UoW 外 ack を採る代わりに早期 return を持たず再配送で terminal turn へ再到達する。globalCleanup だけが両方の担保を欠いていた。

### Decision
両方入れる。

- receipt と finalize 継続を 1 つの `globalUnitOfWorkProvider.run` に入れる。`accountDeletionManifestStore` は Global UoW コンテキストに載っているので、`acknowledgePersonalCleanup` と同じ形が書ける。
- 冒頭の早期 return を「解放ループだけをスキップする」に変え、receipt が既にあるターンも finalize 継続の発行までは必ず通す。

一方だけでも穴は塞がるが、両方入れると「receipt があるのに finalize が来ない」が構造的に表現不能になる — 前者は 1 度も作らせず、後者はもし作られても再配送が必ず直す。

### Consequences
- 良い点: cleanup フェーズの再配送が、receipt の有無にかかわらず finalize を必ず要求する冪等なターンになる。`deleteAccount.globalCleanup.test.ts` が「解放が 1 度失敗して `uniquenessRelease` が最後の receipt になり、成功した回の finalize 継続が失われる」経路を固定する。
- トレードオフ: 既に finalize 済みの deletion に cleanup が再配送されると、無駄な finalize 継続が 1 件出る。ただし manifest が terminal なら冒頭の `status !== "built"` で抜けるので、実際に出るのは built のまま finalize 待ちの窓の中だけで、finalize 自身は receipt 集合が揃うまで何も書かない。ADR-065 の下では同じキーの再保存が no-op になるため、行が生きている限り重複行にもならない。

---

## ADR-070: author redaction の継続判定は claim した生の件数で行う

### Status
Accepted

### Context
`claimPending(operationId, "redaction", 100)` は `AccountDeletionManifestItem` のユニオンを返す。redaction のターンは戻りを `authorRoute` で絞ってから `targets.length === MANIFEST_PAGE_LIMIT` で「まだ続きがある」を判定していた。現行の memory 実装は redaction フェーズで authorRoute しか返さないので一致するが、その前提は型にもポート契約にも現れていない。membership item を扱うスライス（#3）が入ると、100 件フルのページに membership が混ざった時点で「短いページ = 終端」と誤読し、未 ack の authorRoute を残したまま finalize へ渡す。finalize は receipt 集合しか見ないので、この取りこぼしは検知されない。

### Decision
継続判定を `items.length === MANIFEST_PAGE_LIMIT`（フィルター前の生件数）で行い、`targets` は書き込み対象の絞り込みにだけ使う。「ページが満杯だった」は claim の結果そのものの性質であり、そのページから何を書いたかとは別の事実である。

型で表現不能にする案（`claimPending` の戻り型をフェーズで絞る）は採らない。ポートとアダプター 2 種・適合スイートに波及し、本 Issue の担当範囲を越えるため。

### Consequences
- 良い点: ページに authorRoute 以外が混ざっても、フェーズは自分の ack が終わるまで続く。`deleteAccount.redaction.test.ts` が、claim に membership を 1 件混ぜたコンテナで「99 件 ack + redaction 継続」を固定する。
- トレードオフ: そのフェーズが決して ack できない item を `claimPending` が返し続けるアダプターがあれば、終端に達せず同じページを回り続ける（未 ack を黙って捨てる代わりに止まる）。ポート契約違反であり、静かなデータ欠損より停止のほうが検知できるので、この向きの失敗を選ぶ。型で絞る案が実現した時点で本 ADR は不要になる。

---

## ADR-071: scope タスクのランナーは scope トランザクションで claim し、throw した turn を backoff する

### Status
Accepted（ADR-061 を supersede する）

### Context
ADR-061 は「ランナーは `claimDue` を呼ばず、`listDue` の結果を kind でハンドラーに渡すだけ」と決めた。UoW のネストを避けるという動機は正しかったが、claim を落とした帰結が 2 つ残った。

- ハンドラーが throw したとき、誰も `backoff` を呼ばない。行は `pending` / `attempt` 据え置きのまま残り、次の tick（既定 1 秒）でまた同じ行が駆動される。`attempt` が 0 のままなので `SCOPE_TASK_MAX_ATTEMPTS` に到達せず、`ScopeTaskScheduler` の JSDoc が約束する「一つの恒久的失敗が継続を無限に増やさない」が、その保証が要る唯一の失敗モードで働かない。到達経路は現実的で、`deleteFilesByOwner` 先頭の `assertOwner` が `ConflictError` を投げ続ける状態が該当する。
- `claimDue` / `ScopeTask.payload` / `ScopeTask.attempt` の実利用者が適合スイートだけになり、ポート JSDoc が説明する claim→settle モデルと実駆動が食い違う（AC-31「適合テスト専用のポートが残らない」の趣旨からも外れる）。

ADR-055 の「turn は自分の UoW を開いて自分の行を決着させる」は、claim を turn と**別**のトランザクションに置けば維持できる。ネストが禁じているのは同一呼び出し内での入れ子であって、claim の直列化そのものではない。

### Decision
`runDueScopeTasks` を次の形にする。

1. `scopeTaskQueue.listDue(now, budget)` で「work のある scope」を列挙する（scope を列挙できるのはここだけ — ADR-005）。
2. scope ごとに一度だけ `scopeUnitOfWorkProvider.run(scope, ctx => ctx.scopeTaskScheduler.claimDue(now, budget))` で claim する。
3. claim した行のハンドラーを呼ぶ。ハンドラーはこれまでどおりユースケースを呼び、ユースケースが自分の UoW で `schedule` / `complete` / `backoffOrSchedule` まで済ませる（ADR-055 は不変）。
4. ハンドラーが throw したら、ランナーが scope UoW を開いて `backoff(kind, operationId, now)` を呼ぶ。backoff 自体の失敗はログに留める（worker → root の部分失敗許容）。
5. `SCOPE_TASK_TICK_LIMIT` は scope 横断の budget として消費し、各 scope の claim には残り budget を渡す。
6. ハンドラーの無い kind は従来どおり **due のまま残して警告**する（backoff もしない。掃除漏れを backoff で見えにくくしない）。

あわせてポート契約を 2 点明文化する。`backoff` は行が無ければ no-op（`complete` 済みの turn には再試行するものが無い）。行が無い状態から再試行の駆動主体を作りたい stalled 経路のために `backoffOrSchedule(kind, operationId, payload, now)` を足す（W-A06: 初回コマンドは event で届くのでタスク行が存在しない）。

### Consequences
- 良い点: 恒久的に失敗するタスクが 8 回で `failed` に落ちる保証が実駆動でも成立し、1 Hz のホットループが構造的に消える。`claimDue` / `payload` / `attempt` が production の経路を持ち、契約と実駆動が一致する。
- トレードオフ: 1 ラウンドにつき scope ごとの claim トランザクションが 1 本増える（tick あたり scope 数分）。
- claim と turn が別トランザクションなので、**複数プロセスでランナーを走らせると同じ行を 2 本駆動しうる**。turn はいずれも冪等で収束するが、真の排他は claim と turn を同一トランザクションに置ける配備（Durable Object alarm など）で得る — #11 への引き継ぎ。ADR-061 の同じ引き継ぎを置き換える。

---

## ADR-072: 削除の terminal prune と removal receipt の期限切れ削除は Node runner の日次 prune tick が駆動する

### Status
Accepted

### Context
`pruneAccountDeletionManifests`（120 日）と `IdentityRemovalReceiptStore.deleteExpired`（30 日）を呼ぶ本番コードが無かった。`finalize` が `User` を tombstone にして PII を落とした後も、`distributed_operations` の payload には admission が凍結したメール / ハンドル / providerAccount キーが平文で残る（ADR-020）ので、駆動主体が無いと「アカウント削除」の中核的な約束が無期限に破られる。plan.md はこれを縮退にも「含まれないもの」にも書いていない（`pruneExpiredAuthState` の cron 未配線＝#15 とは別件）。

### Decision
`apps/web/app/worker/node/runner.ts` の prune tick（既定 24 時間）で、outbox prune に続けて 2 本を駆動する。3 本はそれぞれ独立した `try / catch` で囲み、1 本の失敗が他の保持期限を道連れにしないようにする。

- manifest 側は `input: { type: "cron" }` で呼ぶ。lease と lane checkpoint を自前で持ち、1 回の呼び出しが 100 コマンドで yield するので、日次の呼び出しだけで足りる。
- receipt 側は maintenance-run の lane を持たない素の keyset sweep なので、ページ上限（100 行 × 100 ページ）を runner 側で与える。次の tick は先頭から再開する（消すのは期限切れ行だけなので再開位置を覚える必要が無い）。

### Consequences
- 良い点: 120 日 / 30 日の保持が配備で実際に効く。どちらも既存の lease / checkpoint に乗るだけで、新しい調停機構を足さない。
- トレードオフ: #15 が `pruneExpiredAuthState` の cron を配線し `identity_removal_receipts` を sweep table に加えると、同じ表の駆動主体が 2 つになる。削除対象が期限切れ行だけなので冪等・無害だが、#15 側でどちらかに寄せる。
- receipt sweep は lease を持たないので、複数プロセス配備では同じページを 2 プロセスが読みうる（削除は冪等）。Node ランタイムは単一プロセス前提なので現状は問題にならない。

---

## ADR-073: dev IdP は `.env` の opt-in にし、`pnpm start` は自ら `NODE_ENV=production` を宣言する（ADR-003 の追補）

### Status
Accepted

### Context
ADR-003 は「`OAUTH_DEV_MODE=true` かつ `NODE_ENV=production` は起動時エラー」を production 混入への実効ガードと位置づけ、あわせて `.env.example` に `OAUTH_DEV_MODE=true` を既定の開発設定として書くと決めた。しかしこのリポジトリ自身の本番起動経路（`pnpm start` → `tsx apps/web/scripts/listen.node.ts`）は `NODE_ENV` をどこでも設定しない。ガードは `readNodeServerEnv` が**実行時の** `process.env` を読む形なので（`apps/web/app/presentation/session.ts` の `process.env.NODE_ENV === "production"` はリテラル参照で vite がビルド時に畳むが、`env.NODE_ENV` はプロパティ参照なので畳まれない）、運用者が明示的に `NODE_ENV=production` を渡した場合にしか発火しない。結果として `cp .env.example .env && pnpm build && pnpm start` が dev IdP を公開する — 攻撃者は同意画面に被害者のメールアドレスを打ち込むだけで任意アカウントのセッションを得られる。

### Decision
ガードの入力を配備者の申告に委ねず、起動経路が自分で宣言する。

- `apps/web/scripts/listen.node.ts` は dotenv より前に `process.env.NODE_ENV ??= "production"` を立てる。このスクリプトは production バンドルしか読み込まない（`session.ts` は既に `() => true` に畳まれている）ので、宣言はバンドルの実体と一致する。dotenv は既存値を上書きしないため、`.env` から production を降格できない。降格が要るときはコマンドラインの `NODE_ENV=development pnpm start` という明示行為に限る。
- `apps/web/.env.example` の `OAUTH_DEV_MODE=true` はコメントアウトし、開発機で自分で外す 1 行にする。ADR-003 の規則 3（どちらの設定も無ければ起動失敗）とヒント文言がそのまま案内になる。

### Consequences
- 良い点: 最短経路（`.env.example` をコピーして本番形で起動）が dev IdP を公開しなくなり、ADR-003 が守ろうとした性質が配線で満たされる。`pnpm dev` / `pnpm start` の双方で「今 production か」の答えが 1 つになる。
- トレードオフ: `pnpm dev` を初めて動かす開発者は必ず 1 度起動に失敗する（規則 3 のエラーが `OAUTH_DEV_MODE=true` を外すよう案内する）。ADR-003 の「必須 env は 2 つに留まり、コピーするだけで起動できる」という DX 上の主張はここで撤回する。本番形で dev IdP を使う検証は `NODE_ENV=development pnpm start` が要る。

---

## ADR-074: ランタイム singleton は「未初期化で使えない・別 env での再初期化は失敗・同一 env の再入は保つ」

### Status
Accepted

### Context
`di/serverNode.ts` の `memoryRuntime()` は `slot ??= createMemoryRuntime()` で、`MemoryRuntimeOptions.oauth` の既定が `{ mode: "dev" }` だった。`boot()` より先に何かが `memoryRuntime()` に触れれば（HMR、ツーリング、将来のモジュールスコープ初期化、別 entry の追加）、env 検証を一切通っていない dev IdP のランタイムがプロセス全体に固定され、`initNodeRuntime` の `??=` はそれを黙って通過する。フェイルの向きが危険側に開いていた。

### Decision
「設定し忘れが dev IdP に化ける」経路を型と起動順の両方で塞ぐ。

- `MemoryRuntimeOptions.oauth` を必須にする（既定を持たない）。env を持たない `createTestHarness` は `{ mode: "dev" }` を明示する。選択**規則**は引き続き env スキーマ側に閉じる（ADR-003）。
- `memoryRuntime()` は未初期化なら throw する。`getContainer()` と同じ扱いで、起動順の違反は回復可能なランタイムエラーではない。
- `initNodeRuntime` はスロットに env のダイジェストを添えて保持し、**別の env での再初期化を throw** する。同一 env での再入は `vite dev` のプログラム再読込（保存のたびに `boot()` が再実行される）なので、singleton とプロセスのデータを保って no-op で返す。「env を検証したのに適用されないまま起動する」ケースだけを正確に落とす。

### Consequences
- 良い点: 安全でない側が既定という構造が消え、env なしのランタイムがプロセスに固定される経路が無くなる。`??=` のサイレント no-op も、B-002 と重なったときの増幅も消える。
- トレードオフ: 単に throw にすると `pnpm dev` が保存のたびに 500 を返す（実測済み）ため、同一 env の再入だけを例外として許す判定が要る。ダイジェストは `NodeServerEnv`（平坦な文字列レコード）の安定 JSON 表現で取る。

---

## ADR-075: `identity_removal_receipts` は `AuthStateTable` の掃除対象として登録する

### Status
Accepted

### Context
`IdentityRemovalReceiptStore` はポート契約に「identity 行が消えてから 30 日」の保持と `deleteExpired` の keyset sweep を書いているが、`AuthStateTable` は `sessions` / `auth_tokens` / `login_attempts` / `oauth_flow_states` の 4 つのままで、新設表が `WorkerContainer.authStateSweeps` に載っていなかった。`pruneExpiredAuthState` の cron 配線自体は #15 だが、掃除対象の**登録**はポートを新設した側の責務で、落とすと #15 が cron を足してもこの表だけ永久に残る。ADR-072 は当座の駆動主体として Node runner の日次 prune tick を置き、「#15 が sweep table に加えると駆動主体が 2 つになる — #15 側でどちらかに寄せる」を宿題にしていた。

### Decision
`AuthStateTable` に `identity_removal_receipts` を足し、`authStateSweeps` / memory backend の `authStatePrune` 表順 / `PruneExpiredAuthStateView` の件数まで通す。`authStateSweeps` の型が `Record<AuthStateTable, ExpirySweep>` なので、以後この種の表を足すと登録漏れが型エラーで止まる。ADR-072 の宿題は「sweep table に寄せる」で確定し、cron が配線される #15 の時点で runner の receipt sweep を落とす。

### Consequences
- 良い点: 30 日保持の回収先が #15 の cron に確実に含まれる。`AuthStateTable` が「期限つき auth 系表の総覧」として機能し、次の表も型で捕まる。
- トレードオフ: #15 までは駆動主体が 2 つ（ADR-072 の runner tick と、未配線の cron lane）並ぶ。削除対象が期限切れ行だけで冪等なので観測できる差は無いが、#15 は runner 側を落とすまでが 1 単位。

---

## ADR-076: `updateProfile` は同じハンドルの再送を directory 照合つきの `reclaim` として扱う

### Status
Accepted

### Context
`planHandle` は「すでに自分が持っているハンドルの再設定」を `keep`（何もしない）に潰していた。これは directory の claim が健全なら正しい（自分の `active` 行に `reserve` すると `HANDLE_ALREADY_USED` になるため）が、UserId shard の commit 直後・`activate` の前に処理が止まると成立しない。新ハンドルの `reserved` 行は TTL で消え、User 行だけがそのハンドルを名乗る状態が残る。同じ入力で再送しても `keep` に潰れるので claim は永久に復旧せず、`resolve` は「空き」と答えるため**別の利用者がそのハンドルを `reserve` → `activate` できる**。`spec/usecases/identity.md` の手順 27 は「途中停止は operation payload に固定した全 sub-operation を照合して commit 済みなら全 activate へ収束させる」と定めるが、`updateProfile` は `DistributedOperation` を持たないので照合対象が無く、`activateUniqueKeys` の回復もプロセス内で `activate` が例外を投げた場合しか働かない。

### Decision
`planHandle` を非同期にし、`keep` へ潰す前に `holdsActiveUniqueKey`（`uniqueness.ts` に追加。`IdentityUniqueDirectory.resolve` の所有者一致判定）で「User 行のハンドルに対応する `active` claim が自分のものか」を確認する。claim が無ければ `keep` ではなく新しい plan `reclaim` を返し、`assign` と同じく reserve → commit → activate を走らせる。`profileOperationId` が決定的なので（ADR-049）再送は同じ予約行に収束する。

`reclaim` は User 行が既に名乗っているハンドルの claim を publish し直すだけなので、(a) UoW 内で `User.assignHandle` を呼ばない（版だけは `User.updateProfile` が進める。`handleChanged` を再発行しないのは、変わっていない事実をイベントにしないため）、(b) 直前ハンドルの解放を走らせない（`previousHandle` が今回 activate した鍵そのものなので、解放すると自分で publish した claim を落とす）。この 2 点を型で表すために、解放対象は `plan.kind === "assign" || plan.kind === "clear"` のときだけ `previousHandle` を取る `supersededHandle` として計算する。

照合を行うのは「明示的に現在と同じハンドルを送った」経路だけにする。`handle` を指定しない更新（表示名だけの変更など）まで照合すると、ハンドルを他人に取られた後の利用者が**プロフィールを一切更新できなくなる**（毎回 `HANDLE_ALREADY_USED` で落ちる）。

### Consequences
- 良い点: commit 済み・activate 前で止まった saga が、P-21 が同じフォームを再送するだけで収束する。他人がそのハンドルを奪える窓が閉じる。回帰テスト（`updateProfile.test.ts` の「re-sending the handle repairs a claim lost between the commit and the activation」）は、この状態から再送すると claim が `active` に戻り、別利用者の同ハンドル要求が `HANDLE_ALREADY_USED` になることまで検証する。
- トレードオフ: 現在と同じハンドルを送る更新に directory の読み取りが 1 回増える。
- 残る欠け: 停止時の**旧**ハンドルの `active` claim は解放されないまま残る（旧ハンドルは User 行から消えており、再送時にはどこにも記録が無いため導出できない）。所有者は本人のままなので他人には奪われず、影響は「本人が旧ハンドルへ戻せない」に留まる。完全な解消には `updateProfile` にも `DistributedOperation` payload を持たせて全 sub-operation を照合する形（手順 27 の本来の姿）が要るので、本 Issue の範囲外とする。

---

## ADR-077: `storeAvatar` は UoW が失敗したら put したオブジェクトを巻き戻す

### Status
Accepted

### Context
`objectStorage.put` はトランザクションの外・前で走る（オブジェクトストアは UoW に参加できない）。その後の scope UoW が barrier 閉鎖（`ACCOUNT_DELETING`）・actor lock 競合・OCC・プロセス落下のいずれかで失敗すると、バイト列だけが残り `stored_files` 行が無い状態になる。plan.md が縮退として記録している孤児（「アップロードしたがプロフィールを保存せず離脱」）は**行がある**ので `sumSizeByOwner` に算入され `deleteFilesByOwner` の owner scan で回収されるが、行の無いこの孤児は `storage.fileDeleted` も出ず、アカウント削除を完走させても残り続ける。回収経路そのものが無い。

### Decision
UoW を `try` で囲み、失敗したら `objectStorage.deleteMany([objectKey])` で巻き戻してから元のエラーを再送出する。巻き戻し自体が失敗したときはログに留め（元のエラーを潰さない）、`uniqueness.ts` の解放と同じ扱いにする。前段で barrier だけを読む軽い検査は置かない — OCC / 落下は前段検査では消えず、巻き戻しがある以上 2 つ目の判定点を持つ意味が無い。

`put` は同じ鍵への冪等な上書きで、`deleteMany` は不在鍵を許容し、鍵はこの実行が生成した `fileId` から作られてまだ誰にも渡っていない。したがって巻き戻しが他の実行の成果物を消すことはない。

### Consequences
- 良い点: 「メタデータ行を持たないオブジェクト」という、どの掃除にも掛からない状態がアバター経路から消える。#6 が同じ 2 段（put → UoW）を書くときの手本になる。
- トレードオフ: ユースケースに `try / catch` が 1 つ増える（CLAUDE.md の「広い catch を避ける」に対しては、UoW に参加できない資源の補償という明示的な境界として許容する）。プロセスが put と巻き戻しの間で落ちれば孤児は残る — その窓は残件として受容し、縮退の記録に含める。

---

## ADR-078: アバターの受理は申告 MIME ではなくバイト列の署名で判定する

### Status
Accepted

### Context
`storeAvatar` はサイズを実バイト長で測る（ADR-048）のに、MIME 型は `data.file.type`（クライアントの申告）をそのまま `MimeType.create` に通していた。`Content-Type: image/png` と申告した任意のバイト列（HTML / SVG / ZIP / polyglot）が `avatar` として保管され、配信ルートが `image/png` で返す。実害が限定的なのは配信ルートが `nosniff` + `Content-Security-Policy: sandbox; default-src 'none'` を付けているおかげで、防御が**配信側にしか無い**。`publicUrl` が R2 等の公開ドメインへ移る配備（#11）ではこのルートごと消えるので、その時点で防御がゼロになる。

### Decision
`UploadValidationPolicy.ensureAcceptable` の入口を `{ purpose, body }` に変え、戻り値を `{ mimeType, size }` にする。型は先頭バイトの署名（PNG / JPEG / RIFF+WEBP の 3 種）から決め、どれにも一致しなければ `BusinessRuleError(UnsupportedMimeType)`。サイズは従来どおり `body.byteLength`。ユースケースは返ってきた値しか記録できないので、申告値を保管する経路が型として消える（`StoreAvatarInput` から `declaredMimeType` を落とす）。

判定はドメインサービスに置く。上限 MIME 表を持つのは既に `UploadValidationPolicy` で、「受け入れてよいアップロードかを保管前に判定する」というその責務の内側にある。`spec/adr/008` が Conversion に置いた「ファイル形式の判定」は変換方針を決めるための分類で、ここでやるのは受理判定に必要な最小の裏取り（許可 3 形式の署名照合）に限る。署名表を持つのは埋まっている rule（今は `avatar`）だけで、署名を持たない形式（`text/markdown` 等）を許可する purpose を足す #6 が、そのとき入口の形を広げる。

### Consequences
- 良い点: 保管される `mimeType` が必ず実体と一致し、防御が配信ルートの有無に依存しなくなる。「申告と実体が食い違う」状態が `storeAvatar` の入力からも消える（ADR-048 の続き）。
- トレードオフ: `spec/domains/storage.md` の `ensureAcceptable` の引数・戻り値と差が出る（spec-sync 候補 1 件）。正しい PNG でもヘッダーが壊れていれば拒否になる（実際の画像デコードはしないので、署名以降の破損は検出しない）。#6 が署名を持たない形式を通すとき、入口を「署名があれば署名、無ければ申告」の形へ広げる作業が要る。

---

## ADR-079: `ObjectStorage.put` の契約は「実体から測った値を返す」を正とする

### Status
Accepted

### Context
ポート JSDoc は「`put` は計測した size と checksum を返す」と書いているのに、適合スイートは `ADP-storage-018: keeps a supplied checksum instead of recomputing it`（呼び出し側が宣言した checksum をそのまま返す）を契約として凍結しており、両者が逆を向いていた。しかも唯一の呼び出し元 `storeAvatar` は `checksum: null` を渡すので、この分岐は production で 1 度も通らない。size 側の「measured」も `meta.size === body.byteLength` の状態で assert していたため、宣言値をそのまま返す実装でも通る形骸化した検証だった。

### Decision
`spec/adr/026`（契約の正本はポート定義に置く）に従い、ポートの "measured" を正とする。

- ポート JSDoc に「`put` が返すのは**書いたバイト列から測った** size と checksum で、`meta` は『どう配信すべきか』と『呼び出し側が何だと思って送ったか』を運ぶだけ。誤った `meta` が結果に混ざることはない」と明記する。
- memory アダプターの `meta.checksum ?? 計算` を落とし、常に実体の sha256 を返す。
- 適合スイートから「宣言 checksum をそのまま返す」ケースを削り、`ADP-storage-018/019` を **`meta.size` に 0、`meta.checksum` に別の値をわざと入れて** `result.size === body.byteLength` / `result.checksum === sha256(body)` を assert する形にする。期待値は `crypto.subtle` で算出する（Node / workerd の双方にある web 標準で、バックエンドを選ばない）。

`ObjectMeta` の形（`size` / `checksum` を持つ）は spec のまま残す。R2 のような実バックエンドは配信ヘッダーの材料としてこれを使うため、フィールドを落とすと #11 が spec と実装の両方から外れる。

### Consequences
- 良い点: 契約が 1 方向になり、checksum を自前で計算するストア（R2 の `md5` / `sha256` ヘッダーを返す実装）がスイートを緩める交渉なしに通る。「measured」が観測可能な形で実際に固定される。
- トレードオフ: 呼び出し側が計算済み checksum を持っていても再計算になる（本 Issue の呼び出し元は `null` を渡すので現時点の差は無い）。重複保管の回避に checksum を使うスライスが現れたら、`meta.checksum` の意味づけを改めて決める必要がある。

---

## ADR-080: 公開配信は `avatar` に限り、判定は `ObjectKey` から読む

### Status
Accepted

### Context
`/storage/$` は `ObjectKey` の形式検査だけを通して `objectStorage.get(key)` の結果をそのまま返し、`public, max-age=31536000, immutable` を付けていた。ところが `ObjectStorage` は 1 つの鍵空間で、`FilePurpose` には `source` / `media` / `reference` / `artifact`（＝非公開）が既に定義されている。ポートの `publicUrl` は「本当に公開なオブジェクト — 今日はアバター — にだけ使え」と限定しているのに、配信側がその線を持っていない。`storeUpload` / `storeMedia`（#6）が同じ `put` を使った瞬間、鍵を知る者への無認可配信になる。

### Decision
`ObjectKey.purposeOf(key): FilePurpose | null` をドメインに足し（`ObjectKey.build` が組んだ形をそのまま読み戻す。形が違えば `null`）、配信ルートは `purposeOf(key) !== "avatar"` を 404 に倒す。鍵の形を知っているのは `build` を持つ VO なので、セグメントの切り出しを `apps/web` のルートに書かない。

`FilePurpose` は `FILE_PURPOSES` の const 配列から導出する形に変え、実行時の所属判定を型と 1 か所で共有する。`Cache-Control: public` は avatar に限られている限り妥当なので、purpose ガードとセットで残す。

### Consequences
- 良い点: 「公開なのは avatar だけ」がコードで守られ、#6 が非公開 purpose を `put` しても配信面が広がらない。将来 `source` / `media` を出す必要が出たら、同じルートに `StoredFileRepository` 越しの所有者検査を足す入口として使える。
- トレードオフ: `ObjectKey` に読み取り側のメソッドが 1 つ増える（spec の VO 定義との差は `build` と対になる派生なので spec-sync 候補には上げない）。`build` の形（`{owner}/{purpose}/{fileId}`）を変えると配信判定も一緒に直す必要がある。

---

## ADR-081: OAuth の認可往復は転送境界で「開始したブラウザー」に束縛する

### Status
Accepted

### Context
`startOAuthFlow` が発行する `state` はサーバー側の 1 行としか結び付いておらず、**どのブラウザーが開始したか**を持たない。攻撃者は自分のブラウザーで「Google で続ける」を押し、自分のアカウントで同意まで進めてから最終ナビゲーションだけを止め、`https://app/auth/callback/google?state=S&code=C` を手元に取れる。それを被害者に踏ませると、P-05 の `OAuthCallbackPanel` がマウント時に自オリジンから消費 POST を投げるので、`Origin` も `Sec-Fetch-Site` も CSRF トークンも正しく揃い、被害者のブラウザーに**攻撃者アカウントのセッションが焼かれる**。以降、被害者が書いたノートは攻撃者のアカウントに入る。

`spec/adr/029-verification-session-binding.md` がメール確認について「通常の CSRF 対策が原理的に効かない」と書いた条件がそのまま当てはまる。`OAuthStateStore.take` の原子性が防ぐのは他人の正規フローに別の code を差し込む向きだけで、攻撃者が自分の完成済みフローを被害者のブラウザーに持ち込む向きは防げない。PKCE も同様（verifier はサーバーが持っているので、攻撃者はむしろ正しく揃っている）。

### Decision
ADR-029 と同じ分担で**転送境界に閉じる**。`OAuthFlowState` にも `completeOAuthCallback` にもブラウザー束縛の概念を入れない。

1. `startOAuthFlow` の view に `state` を足す（`authorizationUrl` に既に載っている値。転送境界が URL を再パースせずに束縛値を作れるようにするため）
2. 開始の server function（`startOAuthSignInFn` / `startOAuthLinkFn`）が `hollow_oauth_state` Cookie を焼く。値は `state` そのものではなく **SHA-256**、属性は session cookie に揃えて `HttpOnly` / `SameSite=Lax` / `Path=/`（dev の平文 http を除き `Secure`）、寿命は state 行と同じ 10 分
3. `completeOAuthCallbackFn` が**ユースケースを呼ぶ前に**「要求本文の `state` の SHA-256 == Cookie」を照合する。不一致・Cookie 不在はどちらも `OAUTH_STATE_INVALID` に畳む
4. 成功して初めて Cookie を破棄する（use-once）

生成と照合は `apps/web/app/presentation/oauthStateBinding.ts` に純関数として置き（Cookie の運搬は `oauthStateCookie.ts`）、`deletionTicket` / `devOAuth` / `verificationSession` と同じくフレームワークを引き込まずに単体テストする。

`linkIdentity` intent にも同じ束縛を掛ける。こちらは `flow.userId` / `flow.userAuthEpoch` があるので攻撃者のセッションが焼かれる向きは元々成立しないが、束縛があると被害者に他人の provider account を紐づけさせる向きの state すり替えを一段防げる。

照合をユースケースより先に置くのは、通っていない `state` を消費させないため。攻撃者の URL を踏んだだけで `take` が走ると、正規のブラウザーの側でフローが壊れる（消費済みになる）。

Cookie に SHA-256 を載せるのは、`Path=/` の Cookie が同一オリジンの全要求に相乗りするため。単回消費の資格情報そのものを常時運ばせない。照合に必要なのは同値性だけなので、束縛の強さは変わらない。

### Consequences
- 良い点: 「コールバック URL を踏ませるだけでは被害者の認証状態が変わらない」が OAuth 経路でも成立する。攻撃者が被害者のブラウザーへ持ち込めないのは Cookie だけ、という ADR-029 と同じ根拠に乗る。
- 良い点: 失敗表示は既存の P-05 失敗状態（`OAUTH_STATE_INVALID` →「認可の手続きが途中で切れました」）をそのまま使うので、画面側の変更が要らない。
- トレードオフ: 束縛 Cookie は 1 本なので、**同一ブラウザーで 2 つの認可フローを並行して開始すると先に始めた方が完了できない**（後から焼いた Cookie が上書きするため）。「もう一度サインインからやり直してください」に倒れるだけで、認証状態は壊れない。ADR-029 の確認待ち Cookie が持つ縮退と同じ形。
- トレードオフ: 別端末で認可を完了する経路（PC で開始してスマートフォンで同意）は成立しない。OAuth の同意は開始したブラウザーの中で完結するのが通常の導線なので、メール確認の別端末フローと違い実質的な縮退にはならない。
- 中断されたフローの Cookie は 10 分（state 行と同じ）だけ残る。次の開始が上書きし、期限で消える。

---

## ADR-082: アイコン選択の事前チェックは「大きさだけ」に絞り、しきい値と文言は判定側から引く

### Status
Accepted

### Context
P-21 の島（`ProfileForm/editor.tsx`）はファイルを選んだ時点で MIME 許可リストと 5 MB 上限を自前の定数と自前の日本語で判定していた。判定の正典は `UploadValidationPolicy`（許可 MIME・5 MB）と `errorDisplay` の辞書（`STORAGE_FILE_TOO_LARGE` / `STORAGE_UNSUPPORTED_MIME_TYPE`）なので、同じ規則が値と文言の両方で二重化し、同じ拒否理由が経路によって別の日本語で出ていた。

さらに ADR-078 で受理判定が**申告 MIME からバイト列の署名**へ移ったため、島の `file.type` による先回りは「本当の規則」ではなくなった（拡張子だけ偽装したファイルは島を素通りしてサーバーで落ちる）。

### Decision
島の事前チェックを**大きさだけ**に絞る。

- しきい値は `AVATAR_MAX_BYTES`、`accept` は `AVATAR_ALLOWED_MIME_TYPES` を `@repo/core/domain/storage/services/uploadValidationPolicy` から import する（どちらも純粋モジュールなので `"use client"` から読める）。ヒント文の「N MB まで」も同じ定数から作る。
- 文言は辞書から引く。島は `renderErrorMessage({ kind: "business", code: StorageErrorCode.FileTooLarge, ... })` を使い、サーバーが同じ拒否を返したときと 1 文字も違わない文字列を出す。
- 形式の判定は先回りしない。`accept` は選択の目安として残し、拒否は署名判定を通ったサーバーの `UnsupportedMimeType` を `displayError` で出す。

大きさだけを残すのは、転送境界の DoS 上限（8 MB）を超えると形の検証で落ちて `FileTooLarge` に届かず、拒否理由が伝わらないため。5〜8 MB がサーバーで `FileTooLarge` になる意図（`-action.tsx`）はそのまま保たれる。

### Consequences
- 良い点: 上限値の定義が 1 か所（ドメイン）、拒否文言の定義が 1 か所（辞書）に収まる。`UploadValidationPolicy` が 5 MB を変えれば `accept`・ヒント文・事前チェックが同時に追随する。
- 良い点: 島が「申告 MIME」で判断しなくなったので、画面の挙動と実際の受理規則が食い違わない。
- トレードオフ: 許可されない形式のファイルを（`accept` を無視して）選んだ場合、拒否が分かるのは往復 1 回のあとになる。バイト列を読まない限り正しい判定はできないので、往復の前に出せるのは推測でしかない。

---

## ADR-083: 島の中で日付を整形するときは時間帯を明示する

### Status
Accepted

### Context
`IdentityList/board.tsx` は `"use client"` の島だが SSR で 1 度サーバー側で描かれ、そのあとブラウザーでハイドレートされる。`Intl.DateTimeFormat("ja-JP", …)` に `timeZone` を渡さないと基準が実行環境の時間帯になるので、UTC のサーバーと JST のブラウザーでは日付境界付近の `createdAt` が 1 日ずれ、ハイドレーション不一致とテキストの差し替えが起きる。サーバーコンポーネントである `UsagePanel` は 1 度しか描かれないため構造的にこの問題を持たない。

表示を島から出して RSC で整形済み文字列にする案もあるが、`IdentityBoard` は楽観追加の行を `createdAt: new Date()` で自前に組み立てるので、整形器は結局島に残る。

### Decision
島の中で残す代わりに `timeZone: "UTC"` を明示して決定的にする。`UsagePanel` のリセット日（課金期間が UTC 暦月なので UTC で読む）と同じ扱いに揃える。

`suppressHydrationWarning` は採らない。ずれを黙らせるだけで、サーバーが送った日付とブラウザーが描く日付が違う状態は残るため。

### Consequences
- 良い点: SSR とハイドレートで必ず同じ文字列になり、楽観追加の行も同じ整形器を通せる。
- トレードオフ: 端末の時間帯では日付が 1 日前に見える利用者がいる（JST の午前 9 時より前に追加した認証手段など）。「いつ追加したか」の粒度は日なので許容し、利用者の時間帯で読ませたくなった時点で、時間帯を持った表示層の仕組みとしてまとめて決める。

---

## ADR-084: P-05 の成功以外は intent 中立の文言と戻り先にする（ADR-038 の追補）

### Status
Accepted

### Context
ADR-038 は「P-05 のキャンセルはコールバック画面に留まり、サインインへは明示のリンクで戻す」と決めたが、その判断は intent が `signIn` の往復だけを見ていた。実装も成功アームだけが intent 別（`linkIdentity` なら「ログイン方法を追加しました」＋ `/settings/auth`）で、キャンセル・失敗は「**サインイン**をキャンセルしました」「**サインイン**に戻る」（`/signin`）に固定されていた。P-22 の「Google を追加」から来た利用者は、サインイン済みなのにサインインフォームへ流される（`/signin` は認証済みでもリダイレクトしない）。モック `P05-oauth-callback.html` 自体が連携フローの文言で書かれており、成功だけ intent を見る形は設計とも噛み合わない。

キャンセル・失敗の時点で intent が判らないのは構造的な理由による。intent は `OAuthFlowState` の中にあり、それを読む唯一の手段は `OAuthStateStore.take`（1 回消費・ADR-007）である。キャンセルでは `code` が無いので消費してはならず、失敗ではまさに消費に失敗している。

### Decision
成功以外のアームの文言と戻り先を intent 中立にする。

- キャンセル: 「手続きをキャンセルしました」、戻り先は `/`。`/` はサインイン済みなら `/notes` へ redirect し、未サインインならトップを出すので、どちらの intent から来ても行き止まりにならない唯一の導線になる。
- 失敗: 「手続きを完了できませんでした」＋「もう一度試す」＋ `/`。本文は辞書（ADR-085 と同じ規律）から引く。
- 再許可（`OAUTH_EMAIL_UNVERIFIED`）だけは intent 前提の文言と `startOAuthSignInFn` の再開導線を残す。このコードを投げるのは `completeOAuthSignIn` だけで、`linkIdentity` の往復では到達しないため。

採らなかった案:

- **`state` から intent だけを引く server function を足す**（レビューの案 a）— 往復が 1 つ増えるうえ、`state` を「消費せずに覗く」読み取り経路を `OAuthStateStore` に足すことになる。ADR-007 が「intent を読めるのは `take` だけ」に閉じた根拠が緩む。
- **`redirect_uri` に intent のフラグを載せる**（レビューの案 b）— Google は authorized redirect URI にクエリー文字列を許さないので実装できない。パスを分ける（`/auth/callback/$provider/link`）と redirect URI が provider 登録側でも 2 本になり、ADR-007 の「1 ルート」を崩す。

### Consequences
- 良い点: どちらの intent から来ても文言が嘘にならず、戻り先が必ず利用者の現在の認証状態に合った場所になる。往復も `OAuthStateStore` の契約も増えない。
- トレードオフ: 未サインインの利用者がキャンセルすると、サインインフォームまでは 1 クリック増える（`/` のトップから「サインイン」）。ADR-038 が受け入れた「ワンクリック挟む」と同種の縮退で、マニュアル TC-40 手順 2 の読み替えもそのまま通る。
- `routes/auth/callback.$provider.tsx` の `head` は `サインイン — {siteName}` のままで、これも signIn 前提の残り。ページのタイトルは導線ではないため本単位では触っていない（別単位が所有するファイル）。

---

## ADR-085: P-25 の失敗は「項目のエラー」と「パネルのエラー」に分け、恒久失効した ticket は捨てる

### Status
Accepted

### Context
P-25 は 2 種類の失敗を 1 つの表示枠に流し込んでいた。

1. **提出の失敗**: `deleteAccountFn` の失敗はすべてメールアドレス欄の項目エラー欄に出し、`aria-invalid` も付けていた。ADR-062 により `/settings/danger` は未サインインでも開けるので、その状態で押すと `UNAUTHENTICATED`（「サインインが必要です」）が**メールアドレス不一致用の枠**に出る。入力は正しいのに欄が不正扱いされる。
2. **進捗照会の失敗**: ポーリングの `catch` は理由を問わず ticket を `sessionStorage` に残していた。一時障害では再読込で再開できるので正しいが、`DELETION_TICKET_EXPIRED`（30 分）と `DELETION_TICKET_INVALID`（memory 配備ではプロセス再起動のたびに起きる）は恒久的で、復元 → 即失敗を繰り返してそのタブから削除フォームへ戻れなくなる。

### Decision
- 提出の失敗は `{ target: "field" | "panel"; message }` として持ち、**項目エラー欄に出すのは `CONFIRMATION_MISMATCH` だけ**にする。その欄はモックでも「メールアドレスが一致しません」の枠であり、他の失敗（認証切れ・競合・システム）はフォーム全体の常設 live region に出す。判定材料は `SerializedError.code` だけで、`instanceof` も原文 message も見ない。
- ポーリングの `catch` は `DELETION_TICKET_EXPIRED` / `DELETION_TICKET_INVALID` のときだけ ticket を捨てる。それ以外は従来どおり残して再読込での再開に賭ける。どちらの場合も表示は「削除の進捗を表示できません」で、削除自体はサーバー側で進み続ける旨を添える（辞書の文言）。
- `requestId` の採番は `crypto.randomUUID` がセキュアコンテキスト限定なので、`getRandomValues` から v4 を組む代替を持ち、採番自体も `try` の中に入れる。非セキュアコンテキスト（`http://<LAN IP>:3000` の実機確認）で全画面エラーに落ちるのを避けるため。UUID の形を保つのは、サーバーが `INVALID_REQUEST_ID` で形式を検査するため。

### Consequences
- 良い点: 入力と無関係な失敗が入力欄を不正扱いしなくなり、支援技術にも「どこが悪いか」が正しく伝わる。恒久失効した ticket を持つタブが削除フォームへ戻れる。ADR-062 が受け入れた「未サインインでも開ける」の帰結が、少なくとも誤誘導にはならない。
- トレードオフ: 転送境界の形式検査（`confirmationEmail` の長さ上限）で落ちた場合もパネル側に出る。項目に紐づく検査は業務不変条件の側（`CONFIRMATION_MISMATCH`）だけという線引きを取ったためで、DoS 上限に当たる入力は通常操作では起きない。
- 未サインインで `/settings/danger` を開いたときに削除フォームが出ること自体は ADR-062 の宣言どおりで、変更しない（本 ADR が直すのは押した後の見せ方だけ）。
- ticket の復元は `useEffect` で行うため、復元前の初回描画は `idle`（削除フォーム）になる。受理済みのタブを再読込すると、進捗表示に切り替わるまでのあいだ削除フォームが一度描かれる。

---

## ADR-086: 認証系メールの応答時間の等時化は実 `MailSender` と一緒に決める（Issue #18 へ defer）

### Status
Accepted（本 Issue では等時化を実装しない）

### Context
`resendVerificationEmail` / `requestPasswordReset` は応答**内容**を完全に同一化している（`UNIFORM_RESPONSE` の空 view。usecase も全分岐で同一値を返し、`resendVerificationEmail.test.ts` / `requestPasswordReset.test.ts` が TC-identity-194..199 / 187..193 でそれを固定している）。しかし経路の重さは 3 段階に分かれる — 未登録は directory 解決のみ、対象外（`active` / `deleting` 等）は + user 読み、対象（`pending` / パスワード手段あり）は + Global UoW（token 削除 + 発行）+ `mailSender.send` の await。`MailSender` が memory 実装のうちは差が小さいが、実 SMTP / API になる本番配備では最後の 1 行が数百 ms 規模になり、応答時間が「そのアドレスが登録済みで再送 / 再設定の対象か」のオラクルになる。

`spec/usecases/identity.md` の当該節は所要時間について何も書いていないので spec 違反ではない。ただし ADR-028 は「所要時間を揃える」を明示的な要求として立てており、`signInWithPassword` はダミーハッシュ検証でそれを実現済みなので、同じ ADR の下でこの 2 経路だけ等時化が無いという非対称が残る。

### Decision
本 Issue では等時化を実装せず、Issue #18 へ引き継ぐ。判断の実体（どちらの形を採るか）は実 `MailSender` の導入と同時に決める。

- **(a) `mailSender.send` を応答から外す**（`void` にして失敗はログのみ、あるいは outbox 経由の非同期送信）— 一番大きい差はこれで消えるが、配送失敗の観測性が下がる。
- **(b) ADR-028 のダミー検証と同じ発想で、全経路に同じ下限時間を消費させる** — 非対称そのものを消すが、下限値の正典をどこに置くかを決める必要がある。

いま (a) を入れないのは、memory `MailSender` の下では観測できる差がほとんど無く、失敗の観測性という実配備依存のトレードオフを、実配送手段が決まる前に一方向へ確定させたくないため。(b) を入れないのは、下限時間の値が実 `MailSender` のレイテンシー分布に依存し、いま置くと必ず後で置き直す定数になるため。どちらも「実 `MailSender` と一緒に決める横断的関心事」という同じ理由で #18 に寄せる。

本 Issue で確定させるのは、応答**内容**の同一性が全分岐でテストに固定されていること（上記 TC 群）と、この非対称が縮退として plan.md / Issue コメントに記録されていることまで。

### Consequences
- 良い点: 列挙耐性のうち内容側は spec どおり成立しており、残る差分が「時間」1 軸に絞られて #18 に引き継がれる。無記録のまま残らない。
- トレードオフ: 実 `MailSender` を先に配備すると、#18 が入るまでの間はアドレス登録有無の時間オラクルが本番で開く。memory `MailSender` のままの配備（本 Issue の到達点）では実害が無いので、#18 は実メール送信を入れるスライスの前提として扱う。
- ADR-028 の「所要時間を揃える」は `signInWithPassword` でのみ満たされている状態が続く。#18 がこの 2 経路を揃えた時点で、ADR-028 の要求が認証系入口の全体で成立する。

---

## ADR-087: intent 中立化と outbox 契約の語彙を、他単位が触れなかった文言まで揃える（ADR-084 / ADR-065 の追補）

### Status
Accepted

### Context
ADR-084（P-05 の成功以外は intent 中立）と ADR-065（outbox の `save` は先着優先の skip）は決定を確定させたが、決定を書いた単位の所有ファイルの外に、旧前提のままの文言が 3 か所残っていた。いずれも挙動には影響しないが、次に読む者が「実装はこう決まっている」と読み違える材料になる。

- `apps/web/app/routes/auth/callback.$provider.tsx` の `head` が `サインイン — {siteName}`。ADR-084 の Consequences 自身が「別単位が所有するファイルなので触っていない」と宿題にしていた。
- `apps/web/app/presentation/oauthStateBinding.ts` の JSDoc が「利用者の取れる行動は『もう一度**サインインから**やり直す』の 1 つ」。束縛失敗は `linkIdentity` の往復でも起きるので、ADR-084 が中立化した辞書文言とずれる。
- `packages/core/src/application/identity/continuations.ts` の `AccountDeletionManifestBuildContinuedEvent` の JSDoc が「replay **upserts** the same outbox row」。ADR-065 は upsert を明示的に棄却し「先着行をそのまま残す skip」を契約にしたので、根拠の語彙が古い。

### Decision
文言のみを揃える（挙動・型・テストは変えない）。

- `head` のタイトルを `認可 — {siteName}` にする。P-05 は signIn / linkIdentity の両 intent が通る 1 ルート（ADR-007）なので、タイトルも intent を名乗らない。ADR-084 の Consequences に残る「`head` は `サインイン — {siteName}` のまま」という記述は本 ADR で解消済みとする。
- `oauthStateBinding` の JSDoc を「もう一度やり直す」にし、intent が判らない時点の文言は中立に保つという ADR-084 の規律を根拠として添える。
- `continuations.ts` の JSDoc を「replay は先着行が残って skip され、1 つの outbox 行に畳まれる（ADR-065）」に直す。

### Consequences
- 良い点: 「決定は ADR に書いたが、コード上の説明は旧前提のまま」という食い違いが 3 か所とも消える。ADR-084 / ADR-065 の記述だけを読んで実装を推測しても外れない。
- トレードオフ: 無い（描画結果はタイトル文字列 1 つだけが変わる。P-05 の本文・導線・状態はいずれも ADR-084 の実装のまま）。

---

## ADR-088: 継続要求の購読者は型で網羅を縛る（レジストリをドメインイベントと分ける）

### Status
Accepted

### Context
`dispatchDomainEvent` は購読者 0 件のイベントを warn して ack する。ドメインイベントには正しい判断（誰も聞いていない通知は relay を止めるべきではない）だが、**継続要求は通知ではない** — 1 turn で終わらなかった仕事の残りを運ぶもので、`continuations.ts` が「exactly one subscriber」と定めている（spec/domains/index.md#継続要求）。購読者の登録漏れは「無視されたイベント」ではなく**削除チェーンの無言の停止**になり、警告ログ 1 行だけが残る。これは AC-29（未完の継続を拾って完走する）の核心なのに、`subscribers: readonly EventSubscriber[]` は網羅性の型制約を持たず、テストも `consumerName` の一意性しか固定していなかった（レビュー R2 / Adapter W-009）。

### Decision
継続要求の購読者だけを `continuationSubscribers` として切り出し、**継続イベント型をキーとする Record + キー毎に非空タプル**（`readonly [SubscriberFor<K>, ...SubscriberFor<K>[]]`）で型付ける。`subscribers` はドメインイベント購読者と `Object.values(continuationSubscribers).flat()` の連結として構成する。

- `IdentityContinuationEvent` に型を足して購読者を書き忘れると **キー欠落のコンパイルエラー**、購読者を消して空にすると **非空タプル違反のコンパイルエラー**になる。
- 1 つの継続型に複数の購読者を許すのは維持する（`accountDeletionDispatchContinued` は phase 毎に 4 つ登録され、自分の phase 以外を素通りする）。タプルの順序がそのまま実行順序になる。
- レジストリが実際に `subscribers` に流れ込んでいることは 1 本のテストで固定する（`Object.keys(continuationSubscribers)` の全てが `subscribers` の `eventType` 集合に含まれる）。型で縛れるのは「レジストリの網羅」までで、「レジストリが配線されている」ことは値の話なのでテスト側に置く。
- `dispatchDomainEvent` の 0 件 warn + ack はそのまま。継続の登録漏れが型で落ちる以上、この経路に残るのは本来のドメインイベントだけになる。

### Consequences
- 良い点: 継続の登録漏れが実行時のログではなくコンパイル時に出る。後続スライスが継続型を足すとき（#3 の workspace wave、#5 の job 終端）、購読者を書くまでビルドが通らない。
- トレードオフ: 購読者レジストリが 2 つに分かれる（ドメインイベント / 継続要求）。ただし両者は「聞き手が居なくてよいか」で規律が違うので、分かれていること自体が意図の表明になる。
- `continuationSubscribers` を export しているのはテストが網羅を読むためで、配送経路は引き続き `subscribers` 1 本。

---

## ADR-089: 決定的 operationId を共有する予約は、OCC 敗北時に補償解放しない

### Status
Accepted

### Context
`updateProfile` の一意性サガは `profileOperationId(userId)` を user 単位で決定的に組み、`reservationOperationId` が `parent:kind:normalizedKey` を足す（ADR-076 / ADR-019 と同じ「応答喪失後の再試行が同じ行を取り直せる」ための決定性）。その帰結として、**同一利用者が同一ハンドルを要求する 2 つの並行リクエストは、同じ `operationId` の予約行 1 件に相乗りする** — `IdentityUniqueDirectory.reserve` は同一 `operationId` を冪等に受けるので、両者とも「自分が予約を持っている」と信じる。

この状態で片方が UoW を commit し、もう片方が `OPTIMISTIC_LOCK_FAILURE` で倒れて補償解放（`releaseUniqueKeys` → `release(operationId)`）を打つと、**勝者がまだ `activate` していない `reserved` 行が消える**。結果は「一時的な過剰予約」ではなく整合性の破れで、(a) user 行はハンドルを名乗って確定、(b) directory に claim が無い、(c) 勝者の呼び出しは `ConflictError("UNIQUE_RESERVATION_NOT_FOUND")` を返す。しかもこの窓で別利用者がそのハンドルを取ると、元の利用者は `planHandle` の `reclaim` 経路で毎回 `HANDLE_ALREADY_USED` を踏み、ハンドル欄を常に送る P-21 のフォームからはプロフィール保存が恒久的に通らなくなる。

検討した案は 2 つ。

- **案 1**: `reserve` が「新規に確保したか / 既存行に相乗りしたか」を返し、`UniqueReservation` に載せて `releaseUniqueKeys` が相乗り分を飛ばす。
- **案 2**: `updateProfile` の catch で `OPTIMISTIC_LOCK_FAILURE` のときだけ解放しない。

### Decision
案 2 を採る。`updateProfile` の catch は、`OPTIMISTIC_LOCK_FAILURE` 以外の失敗でだけ `releaseUniqueKeys` を呼ぶ。

根拠は「決定的 `operationId` の下では、OCC 敗北は『同一 operation の別試行が進行中』を意味する」という一点。予約行の所有者はその進行中の試行であって、敗者ではない。逆に他の失敗（VO 不正・`USER_NOT_FOUND`・`EMAIL_NOT_VERIFIED`・ドライバー障害）は「この operation 全体が進んでいない」ことを意味するので、従来どおり即時に解放してよい。

案 1 を採らないのは、波及範囲が判断の大きさに見合わないため。`reserve` の戻り値を変えるとポート定義・memory アダプター・適合スイート・`reserveUniqueKeys` / `releaseUniqueKeys` の型がすべて動き、`completeOAuthSignIn` の 2 予約サガも巻き込む。いま直したいのは「決定的 parent id を持つ 1 ユースケースの補償条件」であって、ポートの語彙ではない。

### Consequences
- 良い点: 同一ハンドルの並行保存で、user 行のハンドルと directory の claim が必ず一致する。回帰は `TC-identity-293`（同名の同一 handle 版）が「敗者が補償する窓で勝者を止める」形の決定的インターリーブで固定しており、補償条件を戻すと `UNIQUE_RESERVATION_NOT_FOUND` で落ちることを実測で確認した。
- トレードオフ: OCC で敗れた試行が「自分だけが取った予約」を持っていた場合（勝者がハンドルを触らない更新だった場合）、その予約は解放されず TTL（`UNIQUE_RESERVATION_TTL_MS` = 10 分）まで残る。この間は他の利用者がそのハンドルを取れない。恒久的な破れを 10 分の過剰予約に置き換える取引で、`releaseUniqueKeys` の JSDoc が既に「解放が届かなくても TTL までキーが停まるだけ」と定めている許容範囲の内側にある。
- 補償の条件が `updateProfile` に閉じているので、`uniqueness.ts` の 5 手続きは契約も型も変わらない。決定的 parent id を持つ別のユースケースが同じ形を必要としたときに、そこで同じ 1 行を書けばよい。

---

## ADR-090: `User.avatarUrl` は `AvatarUrl` 型で持ち、`reconstruct` は「書き込み時に検証済み」として通す

### Status
Accepted

### Context
`UserBase` の 5 つのプロフィール項目のうち、`email` / `displayName` / `bio` / `handle` は値オブジェクト型（`Email` / `DisplayName` / `Bio` / `Handle`）なのに、`avatarUrl` だけが素の `string | null` だった。同一オリジンの不変条件（ADR-016）は `AvatarUrl.create` が持っているが、それを通す責任は `updateProfile` ユースケース 1 箇所にしかなく、`User.updateProfile` の引数も `avatarUrl?: string | null` なので、将来この集約メソッドを呼ぶ別経路（Storage 側からの直結など）が外部オリジン URL を保存しても型検査が止められない。CLAUDE.md の「不正状態を型で表現不能にする」「検証点は転送境界と値オブジェクト構築の 2 つ」から外れている。

`AvatarUrl.create(raw, appUrl)` が **`appUrl` を引数に取る**（値オブジェクトが設定を読みに行かないための設計）ことが、`reconstruct` の扱いを難しくする。`reconstruct` で再検証するには `User.reconstruct` に `appUrl` を渡す必要があり、ドメインの再構築に配備設定が漏れるうえ、他の 4 項目（`Email.create` などが引数だけで完結する）と形が揃わなくなる。

### Decision
- `UserBase.avatarUrl` を `AvatarUrl | null` に上げ、`User.updateProfile` も `avatarUrl?: AvatarUrl | null` を受ける。構築（`appUrl` を要する `AvatarUrl.create`）はこれまでどおりユースケース側に残す。
- `User.reconstruct` は「書き込み時に検証済み」として `AvatarUrl` へキャストする。`reconstruct` の入力型は永続化の生値なので `string | null` のまま。

`reconstruct` にだけ `RehydrationError` 化やフォールバックを入れないのは、この項目に限って再水和時の再検証を強めても、`appUrl` が変わった配備では過去に正当だった値が読めなくなるだけで、守れる不変条件が増えないため。守りたいのは「書き込み経路が検証を素通りできないこと」であり、それは型が担う。

### Consequences
- 良い点: `User.updateProfile` を呼ぶどの経路も `AvatarUrl` を作らないとコンパイルが通らない。同一オリジン検証の依存先がユースケース 1 箇所から型へ移り、5 項目すべてが「VO 型を持ち、生値からの構築は境界でだけ起きる」形に揃う。
- トレードオフ: `reconstruct` にキャストが 1 つ入る。DB に外部オリジンの URL を直接書き込まれた場合は素通りするが、それは書き込み経路を型で塞いだ後に残る「DB を直接触る」経路の話で、ドメインの再水和が防ぐべき範囲ではない（理由はその場に WHY コメントとして残した）。
- `AvatarUrl` はブランド付き `string` なので、`toProfileView` などの読み出し側（`string | null` を返す DTO）は変更不要。適合スイート・memory アダプターのマッピングにも波及しない。

---

## ADR-091: 「守れているか」を主張できないアサーションは、緑にせず名前と JSDoc で欠落を晒す

### Status
Accepted

### Context
レビュー 002（Test 観点 W-001 / W-002 / W-004、Adapter 観点 W-011）は、通っているのに何も守っていないテストを 4 種類挙げた。共通しているのは「緑であることが契約の担保になっていない」点で、原因はそれぞれ違う。

1. **許容側境界の握り潰し**: `codeOf` ヘルパー（`domain/usage/__tests__/quota.test.ts` と `domain/identity/__tests__/policies.test.ts` に同型の複写）が `catch` で `isBusinessRuleError(error) ? error.code : null` を返すため、`TypeError` で落ちても `null` になる。`expect(codeOf(...)).toBeNull()` が主張したいのは「境界の内側なので通る」だが、実際には「BusinessRuleError 以外で落ちた」場合も緑になり、headroom ちょうど / 残 60 回ちょうど（DOM-usage-006/007/008）の許容側が事実上無検証だった。
2. **見送り行の ID をテスト名に冠する**: `TC-identity-052` は見送り 89 行の 1 つ（rejected 経路が #3）なのに、`AccountDeletionRetryPolicy` のドメイン単体テストが名前に ID を冠していた。ドメイン境界を先に検証すること自体は plan.md の縮退どおりだが、AC-33 の機械照合（見送り行にチェックが付いていないこと）が「TC ID を持つテストの有無」で取れなくなる。
3. **適合スイートの契約範囲と実施の不一致**: `describeStoredFileRepositoryContract` の JSDoc は ADP-storage-001..005 を範囲と宣言しながら `save` を一度も呼ばない。memory は共有の `createOccRepository` 由来なので他スイート経由で偶然守られているだけで、SQL アダプターを足した時点で穴になる。
4. **構造的に到達不能な分岐**: `prunePersonalCleanupBarriers` のページ継続分岐（`removed === 100`）は、1 scope が barrier receipt を最大 1 件しか持たない以上どのテストからも通らない。

### Decision
4 つを 1 つの規律の適用として扱う。**テストが主張できないことは、緑で覆わずコード上に見えるようにする。**

- 許容側は「投げないこと」を確実に検証する。`codeOf` は `BusinessRuleError` 以外を **再 throw** する（`.not.toThrow()` への書き換えではなく、ヘルパー側の強化）。既存の呼び出しがそのまま強化され、許容側 / 拒否側の書き分けも変わらない。
- 見送り行の ID は**テスト名に冠さない**。ドメイン単体テストは残し、行としての検証がどこにあるか（`TC-identity-052` は #3）は名前ではなくコメントに書く。名前は照合の索引であって由来の記録ではない。
- 適合スイートが JSDoc で宣言した ADP ID は 1 ケース以上で実際に呼ぶ。`ADP-storage-003` は姉妹スイート（`ADP-usage-003` / `008`）と同じ形（stale トークンで `OPTIMISTIC_LOCK_FAILURE` / 有効トークンで値が反映される）で足す。
- 到達不能な分岐は**注入で無理に固定しない**。`pruneCompleted` の戻り値を差し替えられる形にすれば分岐は通せるが、それが固定するのは「注入した数値で if が成立する」ことだけで、契約（ページ上限で継続する）は backend 側の性質なので何も守れない。到達不能であることを JSDoc に明記して、複数 receipt を持ちうる backend を書くスライス（#11）へ引き継ぐ。

### Consequences
- 良い点: 許容側境界の緑が「BusinessRuleError を投げなかった」ではなく「何も投げなかった」を意味するようになる。見送り 89 行に TC ID 付きテストが 0 件になり、AC-33 の照合が機械的に取れる。`StoredFileRepository` の OCC 契約が他バックエンドにも要求できる形になる。
- トレードオフ: `TC-identity-052` のドメイン境界テストは、名前から辿れなくなる分だけコメントに依存する。到達不能分岐は引き続き無検証のまま残る — 引き継ぎ先を JSDoc に書くことが、その事実を消さずに次のスライスへ渡す唯一の手段になる。
- テスト名に「欠けている期待結果」を書く形（`TC-identity-090 (without the retry-time record)` / `TC-storage-043 (without the statement-count promise)`）も同じ規律の一部。ID を冠したまま期待結果の一部を欠くなら、欠落を名前に出して台帳側の記録（progress.md の ID 単位の縮退）と一致させる。

---

## ADR-092: パスワード規則の写しは UI 側に 1 モジュールだけ置き、強度の刻みと見た目も 3 画面で共有する

### Status
Accepted

### Context
`PlainPassword`（8〜128 字・英字と数字を各 1 つ以上）と同じ判定が、`SignUpForm` / `ResetPasswordPanel` / `ChangePasswordForm` の 3 か所に別々に書かれていた。刻み方が 3 通りに割れていて `Password123` が「強い」「ふつう」「弱い」と画面ごとに違う強度で出るうえ、`ChangePasswordForm` の写しには 128 字の上界が無く、200 字のパスワードが「とても強い」と表示され送信ボタンも有効なまま転送境界まで往復していた。長さの定数はドメイン側で module private だったため、`apps/web/app/components/auth/schema.ts` にも別の写しがあった。

### Decision
規則の正はドメインの `PlainPassword` のままとし、そこから引く形に一本化する。

- `PASSWORD_MIN_LENGTH` / `PASSWORD_MAX_LENGTH` をドメインから export する（`AVATAR_MAX_BYTES` と同じ扱い — 判定は VO が持ち、フォームは数値だけを借りる）。`schema.ts` の写しは消して import に置き換える。
- 強度の採点は `apps/web/app/components/auth/passwordStrength.ts` の純関数 1 本にまとめ、刻みは ADR-043 の定義（長さ 12 / 16、記号または大小混在で 1 段ずつ）を正典とする。入力欄に添える指摘（`passwordFieldError`）と規則の説明文（`PASSWORD_RULE_HINT`）も同じモジュールに置き、UI 側でドメイン規則を写す場所をこの 1 ファイルに閉じる。
- ゲートは ADR-043 のまま「`score === 0`（ドメイン条件未達）でのみ送信を止める」。1 以上の刻みは表示専用で、送信可否には一切効かない。
- 表示も `PasswordStrengthMeter` 1 つに寄せる。バーは `score >= 3` で success、それ未満は warning、文言は「強さ: …」。

### Consequences
- 良い点: 同じパスワードは 3 画面で必ず同じ強度になる（`Password123` → 2「ふつう」、`Abcdefgh1234` → 3「十分」）。`ChangePasswordForm` の 128 字上限の欠落が塞がり、超過は転送境界へ行く前に score 0 で止まる。規則を変えるときに触る場所がドメイン 1 か所になる。
- トレードオフ: モックの `.strength` は P-01 だけが warning → success の 2 色で、P-04 / P-22 の CSS は on のバーを常に success にしていた。共有した結果 P-04 / P-22 でも score 1〜2 が warning 色になるが、両モックが描いていたのは「十分」の状態だけなので、実際に描かれた状態はいずれも新しい規則と一致する。ラベルの接頭辞も P-04 / P-22 の「強さ:」に揃え、`SignUpForm` の「強度:」は落とした。
- ADR-046 が許容したのは「パスワード入力の見た目が 2 か所に分かれる」ことで、判定の分岐ではない。判定・刻み・文言はここで 1 つに戻し、以後の分岐は許容しない。

---

## ADR-093: dev リロードでは boot を作り直し、前の boot を retire してから差し替える

### Status
Accepted

### Context
レビュー 002（Adapter 観点 W-002 / W-004）は、Node ランタイムの起動配線に 2 つの欠落を挙げた。

1. **ランナーの多重起動**: `server.node.ts` は ALS を `globalThis` / `import.meta.hot.data` に退避してモジュール再評価を前提に書かれており、`initNodeRuntime` の JSDoc 自身も「`vite dev` が `boot()` を再実行する」と宣言している。ところが `bootPromise` と `process.once` のリスナーはモジュールスコープのままなので、再読込のたびに新しい `createNodeWorkerRunner` が `start()` され、前のランナーは `stop()` されない。relay / prune / scopeTask の `setInterval` と `process.on("SIGTERM"/"SIGINT")` がそのまま残り、同じランタイム singleton（＝同じストア）に対して 2 本目以降の tick が走る。relay は lease で守られるが `ScopeTaskScheduler.claimDue` はリースを持たず「scope は single writer」を前提にしているだけなので、2 本のラウンドが同じ turn を同時に実行しうる（`deleteFilesByOwner` なら後発が `page.items.length > 0 && deletedCount === 0` に落ち、進んでいるのに指数バックオフが掛かる）。
2. **保持期限回収が短命プロセスで走らない**: prune tick は 24 時間 interval の登録だけで、起動時に 1 度も走らない。本 Issue でこの tick に manifest terminal prune（120 日）と removal receipt sweep（30 日）という個人データの保持期限回収が乗ったので、`pnpm dev` の再起動や 24 時間より短い間隔のデプロイでは一度も実行されない。relay と scope task はどちらも起動時に即時ドレインしている。

### Decision
1. boot の slot を ALS と同じ規律（`globalThis` + `import.meta.hot.data`）に載せる。ただし**再ロード時に前の boot を再利用しない**。boot は `@tanstack/react-start/server-entry` の名前空間を `entryPromise` として抱えるので、再利用は「再読込後も旧プログラムを配る」ことになる。代わりに新しい boot の先頭で前の boot を `shutdown()` して retire し、そのうえで作り直す。前提は `runner.stop()` が interval と `process.off` まで完全に戻すことなので、runner の JSDoc にその責務を明記する。
2. signal リスナーはプロセスで 1 度だけ張り、slot 越しに現行 boot を見る（モジュールスコープの `bootPromise` を掴んだ古いリスナーが残らない）。
3. retire と start をログに出す（`[server.node] retiring the previous boot` / `[server.node] worker runner started`）。多重起動は「retiring を挟まない started が 2 本」として観測できる形にする。`docs/runtime_node.md` にこの読み方を書く。
4. `start()` で prune tick を 1 回打つ。relay / scope task と同じ即時ドレインで、`track()` に載せるので `stop()` は待つ。
5. 自動テストは runner 側に置く。boot の slot は `server-entry` の動的 import を抱えるためユニットで起こせないので、runner が公開する契約（`start()` の冪等 / `stop()` で timers と signal リスナーが完全に戻る / `start()` で prune が 1 回走る）を固定し、boot 側の差し替え規律は `pnpm dev` の実測で確認する。

### Consequences
- 良い点: リロードを何度繰り返しても走っているランナーは常に 1 本（実測: 5 boot に対し retire 4 本が交互に並び、`MaxListenersExceededWarning` なし）。scope task の二重実行と無駄なバックオフ、リスナー累積が消える。短命プロセスでも保持期限の回収が最低 1 回は走る。
- トレードオフ: リロードのたびに worker runner を作り直すので、進行中の relay / prune ラウンドは retire で drain され、その分だけ再読込後の最初のリクエストが遅れる（memory backend では体感差なし）。データはランタイム singleton 側にあるので retire では失われない。
- 起動時 prune が重くなる配備が出たら、短い遅延を挟む余地は `track()` の内側に残っている。
- runner 側のテストが固定するのは「差し替えられる側の契約」までで、「差し替える側（boot slot）」は引き続きブラウザー実測が唯一の担保になる。

---

## ADR-094: P-05 の「もう一度試す」は `state` を消費していないと判るときだけ出す（ADR-084 の追補）

### Status
Accepted

### Context
ADR-084 は失敗アームに「もう一度試す」を置くと決めたが、**何を再試行するか**は決めていなかった。実装は同じ `state` / `code` で `completeOAuthCallbackFn` を再 POST する形になっていた。`state` は単回消費（`OAuthStateStore.take` — ADR-007）なので、消費を通り抜けたあとに起きる失敗（`PROVIDER_ACCOUNT_ALREADY_LINKED`、交換拒否、利用者状態の拒否など）では 2 回目が必ず `OAUTH_STATE_INVALID` になり、利用者は最初とは別の、しかも実態を表さない文言を見て手詰まりになる。

失敗アームから認可をやり直す案（`startOAuthSignInFn` を呼ぶ）は採れない。この入口は intent を `signIn` に固定しており（`routes/auth/-action.tsx`）、失敗時点では intent が判らない（判る唯一の手段が消費済みの `state`）。P-22 から来た利用者が押すと、本人の知らないうちに別のフローへ移る。ADR-084 が失敗アームを intent 中立に倒した理由がそのまま当てはまる。

### Decision
失敗アームは再試行の種類まで型で持ち（`retry: "exchange" | "authorization" | null`）、出せると判るときだけボタンを出す。

- **交換の再試行**は「要求がサーバーに届いていない」と判るときだけ。判定材料は throw がエラー契約（`serialized`）を連れているかどうかで、サーバーが返した失敗は必ず連れてくる（`errorResponse` の 2 経路 — `AppServerError` とアダプター迂回 — がどちらも載せる）。連れていない throw は応答が返らなかった場合だけで、そのときに限り `take` を通っていないと言い切れる。`instanceof` にも文言にも依存しない構造的な判定にするのは、CLAUDE.md のエラー方針と揃えるため。
- **`code` / `state` が届いていない失敗**（`initialPhase` 由来）は `null`。交換を始める材料がそもそも無い。
- **再許可アーム（`OAUTH_EMAIL_UNVERIFIED`）の失敗**だけは `"authorization"` を出す。認可のやり直しは新しい `state` を作る操作なので何度でも押せるうえ、このコードを投げるのは `completeOAuthSignIn` だけ（＝ signIn の往復に限る）なので `startOAuthSignInFn` を呼ぶことが intent 的に正しい。ADR-084 が再許可アームだけ intent 前提を残したのと同じ根拠。
- 再試行が無いときは導線を「Hollow に戻る」1 本にし、キャンセルアームと同じ outline の見た目にする（無効ボタンの placeholder は置かない）。

### Consequences
- 良い点: 押しても必ず別の失敗になるボタンが消える。再試行が意味を持つ 2 つの場合（要求が届かなかった / 認可からやり直す）だけが残り、どちらも intent 中立の規律を崩さない。
- トレードオフ: ネットワーク断以外の失敗では画面上の操作が「Hollow に戻る」だけになる。行き止まりに見えるが、実際に行き止まりなのは `state` が消費済みだからで、ボタンを出しても同じところへ着く。やり直しは `/`（サインイン済みなら `/notes`）から改めて「Google で続ける」を押す経路が担う。
- 判定がエラー契約の有無に依存するので、将来 `serialized` を載せない失敗経路をサーバー側に作ると、それが「届いていない」と誤判定される。載せるのは `errorResponseMiddleware` 1 箇所なので、境界を増やさない限り成立する。

---

## ADR-095: P-25 の ticket は主体と一緒に退避し、一時障害は画面から追い直せるようにする（ADR-006 / ADR-085 の追補）

### Status
Accepted

### Context
2 点が未決のまま残っていた。

1. **復元が主体に紐づいていない**。島はマウント時に `sessionStorage` の ticket を無条件で読んで進捗表示へ入る。ticket が捨てられるのは終端に達したときだけなので、進行中に自分でナビゲートしたタブには残る。同じタブで別のアカウントにサインインして `/settings/danger` を開くと、削除フォームではなく「アカウントを削除しています」が出て、`completed` を読んだ瞬間に「アカウントを削除しました」を表示し、5 秒後にトップへ強制遷移する。生きているアカウントの利用者に破壊的操作の完了を 1 回必ず誤表示する。
2. **一時障害の再開手段が画面に無い**。ADR-085 は一時障害では ticket を残すと決めたが（再読込での再開が意図）、`settled` の画面が出す操作は「トップページへ」だけで、再読込すれば追い直せることはどこにも書かれていない。意図が利用者に到達しない。

### Decision
- **ticket の claims は変えない**。`operationId` と期限だけという ADR-006 の最小形（「権限を広げる材料がそもそも入っていない」）を保つ。主体は退避レコードの側に並べて持つ（`sessionStorage` に `{ ticket, userId }`）。ticket は署名済みだが暗号化されていないので、`userId` を claims に入れるとクライアントから読める識別子が 1 つ増える一方、この判定が決めるのは「**このタブの表示を復元してよいか**」だけである。status の読み取り権限は ticket 側で既に 1 件に閉じているので、改竄で得られるのは「自分の ticket を自分に見せる」ことだけになる。
- 復元は「**保存時の主体と今の主体が一致する**、または**今のセッションが無い**」ときだけ。主体は `/settings` の `beforeLoad` が context に載せた `user` から読む（ADR-062 によりここは `null` になりうる）。セッションが無い状態は、受理でセッションを失った当人しか到達しない — それが ADR-006 の復帰経路そのものなので通す。
- `settled` は再開に使える ticket を型で持つ（`resumeTicket: string | null`）。一時障害だけが非 null で、そのとき「進捗をもう一度確認する」を出し、押すと同じ ticket で `accepted` に戻してポーリングを再開する。恒久失効（ADR-085 の 2 コード）と終端（`completed` / `rejected`）では ticket を捨てているので `null` になり、ボタンも出ない。「ticket を捨てたのにボタンが出る」状態が型の上で作れない。

### Consequences
- 良い点: 生きているアカウントに他人の削除完了を見せる経路が消える。ADR-085 が ticket を残した意図が、再読込の知識を要求せずに画面上の操作として届く。ticket の claims と署名の実装（`presentation/deletionTicket.ts`）には手が入らない。
- トレードオフ: 退避レコードの形が生の文字列から JSON に変わるので、旧形式の値は復元されない。`sessionStorage` はタブ内でしか生きない値なので、配備更新をまたぐ復元は元々成立していない。
- トレードオフ: 主体を持たない退避（`userId` が読めないレコード）は、サインイン中には復元しない側に倒す。誤表示より復元漏れを選ぶ判断で、セッションが無ければ従来どおり復元される。

---

## ADR-096: 本文サイズの上限は Node 起動口（`listen.node.ts`）に置き、業務上の上限とは別段に保つ

### Status
Accepted

### Context
server function は本文を全量 `FormData` / `File` に実体化してから `validator` を回す。`uploadAvatarFn` の 8 MB 判定も `requireSession()` も、その実体化の**後**にしか走らない。つまり転送境界より手前に上限が無いと、`Origin` を手で付けただけの未認証クライアントが数百 MB の multipart を投げてプロセスにバッファさせられる。Node ランタイムはリクエスト平面とワーカー平面（削除継続の駆動を含む）が同一プロセスなので、ここが落ちると進行中のアカウント削除も止まる。

置き場所の候補は 3 つあった。(a) `app/server.node.ts` の fetch ハンドラー、(b) `presentation` のミドルウェア、(c) `scripts/listen.node.ts`。

### Decision
(c) `listen.node.ts` の fetch ラッパーに `MAX_REQUEST_BODY_BYTES = 12 MB` を置き、静的配信とアプリのどちらより先に判定する。

- `Content-Length` があるときは本文を 1 バイトも読まずに `413` を返す。Node の HTTP パーサーは宣言値を超える配送を許さないので、宣言値の判定だけで足りる。
- chunked（宣言が無い）ときは本文ストリームを `TransformStream` で包み、超えた時点でストリームをエラーにする。打ち切りはフレームワーク側の本文読み取りに現れて `500` に畳まれるので、打ち切ったことを呼び出し側へ返して応答を `413` に差し替え、上限違反の答えを 1 つに保つ。
- 12 MB は業務上の上限（アバター 8 MB、ドメインは 5 MB）より意図的に広い。5〜8 MB は `UploadValidationPolicy` の `FileTooLarge` に、8〜12 MB は転送境界の schema に届く。**「大きすぎる理由」を答えるのはドメイン側の 1 か所**という既存の分担を、DoS 上限が奪わないため。

(a) を採らなかったのは、`server.node.ts` の fetch は vite dev でも使われ、dev では vite の HTTP 層が前段にいて二重の関心になるため。(b) を採らなかったのは、これがアプリの認可判断ではなく**プロセスを守る転送層の関心**で、`presentation` の層（エラー整形・入力検証・セッション）とは寿命も理由も違うため。

### Consequences
- 良い点: 未認証の巨大 POST が本文を実体化する前に切れる。実測で 200 MB の `Content-Length` 付き POST は 0 バイト受信・80 ms で `413`、chunked も 12 MB 到達時点で打ち切って `413` になる。上限の三段（12 MB 転送 / 8 MB schema / 5 MB ドメイン）はいずれも従来どおり届く。
- トレードオフ: 上限が効くのは Node の**本番形だけ**で、`pnpm dev`（vite が listen する）には無い。他ランタイムはプラットフォーム側の上限（Cloudflare / API Gateway / Cloud Run）に委ねる。ランタイムごとの入口が違う以上、共通化するとかえって「どこで切れているか」が読めなくなるため、入口ごとに置く形を取る。
- 波及: 12 MB を超える本文を要する機能（大きな添付のアップロード等）を足すときは、この定数と `AVATAR_UPLOAD_MAX_BYTES` の関係を同時に見直す必要がある。

---

## ADR-097: 公開オブジェクトの配信は `private` キャッシュにし、`Content-Disposition` を明示する

### Status
Accepted

### Context
`/storage/$` はアバターを `public, max-age=31536000, immutable` で返していた。鍵にファイル ID が入るので中身は不変であり、キャッシュの正しさとしては問題が無い。しかし P-25 は「アップロード済みファイルは削除される」と利用者に約束していて、実際 `deleteFilesByOwner` → `storage.fileDeleted` → `deleteStoredObjects` でオリジンからは消える。`public` は前段の CDN / 共有プロキシに載ることを許すので、削除後も最長 1 年その URL で他人が読める配備があり得る。

### Decision
`Cache-Control: private, max-age=31536000, immutable` にし、あわせて `Content-Disposition: inline; filename="…"` を付ける。

- 鍵が不変である以上、キャッシュの実効はブラウザーキャッシュだけでも変わらない。`private` にしても再取得は増えない。
- `filename` は鍵の末尾セグメントから作るが、`ObjectKey.create` は引用符・制御文字を禁じていないので、ヘッダーに置く前に `[A-Za-z0-9._-]` 以外を落とす。鍵の形（`{fileId}.{ext}`）を通る限り情報は失われない。

### Consequences
- 良い点: 削除の約束が配信層まで一貫する。共有キャッシュに残った顔写真という形の「消えていない」経路が閉じる。`Content-Disposition` により、`nosniff` + CSP sandbox + マジックバイト由来の MIME に続く 4 枚目の防御が増える。
- トレードオフ: 将来 CDN を前段に置く配備では、アバターの配信がオリジンに当たり続ける。R2 等の公開ドメインへ移る配備ではこのルート自体が不要（`publicUrl` の形はアダプターに閉じている）なので、CDN を入れる判断とオブジェクトストレージを差し替える判断は同じ場面で行われる。
- 実測: `Cache-Control: private, max-age=31536000, immutable` / `Content-Disposition: inline; filename="{fileId}.png"` / `X-Content-Type-Options: nosniff` / `Content-Security-Policy: sandbox; default-src 'none'` を本番形で確認済み。

---

## ADR-098: `recalculateStorageUsage` の user 主体は actor に束縛し、workspace 主体は開けたままにする

### Status
Accepted

### Context
`recalculateStorageUsage` は actor（`userId`）と対象（`subjectType` / `subjectId`）を別々に受け、scope 側で `assertWritable()` と `assertActorWritable(actorUserId)` を呼ぶ。この 2 本が見るのは「その scope が削除 barrier で閉じていないか」「その actor が解除準備でロックされていないか」であって、**actor がその subject を操作してよいか**ではない。現在この UC を叩く server function は無いので到達不能だが、JSDoc が「`userId` は actor であって subject ではない」と明言している以上、転送境界に露出した瞬間に他人の scope の `storage_quota` を書ける形になる。

### Decision
`subjectType === "user"` のときだけ `subjectId === userId` を要求し、違えば `BusinessRuleError(WorkspaceErrorCode.InsufficientRole)` を投げる（`storeAvatar` と同じ形・同じコード）。workspace 主体は**拒否しない**。

`storeAvatar` は workspace 主体を丸ごと拒否している（ADR-014）が、こちらは AC-22 / TC-usage-072 が「workspace 対象も動く」ことを要求している。棚卸しは所有権の移動でも公開範囲の変更でもなく、実在する行を数え直すだけで、結果は `storage_quota` の 1 行に閉じる — メンバー相当の権限で足りるという ADR-052 の前提がそのまま残る。したがって「評価できない権限を『無い』と答える」判断の対象は user 主体側だけで、workspace 側は `WorkspaceAuthorization` が入るまで `assertActorWritable` の 1 本で保つ。

### Consequences
- 良い点: 露出前に閉じたので、#3 / #6 でこの UC を server function に配線するときに認可を思い出す必要が無い。`storeAvatar` と同じ位置・同じ例外なので、2 本のユースケースが同じ読み方で読める。
- トレードオフ: workspace 主体は依然として「メンバーか」を確かめない。`WorkspaceAuthorization` が入るまで、workspace の棚卸しは workspace ID を知る任意の利用者が起こせる（書ける先はその workspace の `storage_quota` 1 行で、実データの集計値に収束するだけ）。これは Workspace ドメインが本 Issue の範囲外であることに由来する既知の縮退で、user 主体側と違って**拒否すると AC-22 が壊れる**ため、開けたまま残す方を選ぶ。

---

## ADR-099: 束縛 Cookie の破棄は「照合を通った瞬間」と「消費されない往復」の 2 点に置く（ADR-081 の追補）

### Status
Accepted

### Context
ADR-081 は生成・照合・破棄の 3 経路で束縛を組んだが、破棄が `completeOAuthCallbackFn` の**成功パスにしか**無かった。プロバイダーがキャンセル（`error=access_denied`）を返した往復では消費 POST が発生せず、交換が失敗した往復では破棄行に到達しないので、`Path=/` の `hollow_oauth_state` が 10 分残る。残った Cookie は (a) 次の開始で上書きされるまで 1 つ目のコールバックを恒久的に `OAUTH_STATE_INVALID` にし、(b) 照合が `take` より前にある以上 `state` 行も未消費のまま残すので、one-shot 性が「1 回だけ」から「TTL 内なら開始ブラウザーから何度でも」に緩む。

### Decision
破棄の置き場所を 2 点にする。

1. **照合を通った直後**（`completeOAuthCallbackFn`）。`completeOAuthCallback` の最初の一手は `OAuthStateStore.take` なので、照合を抜けた時点でこの往復は必ず消費されるか、消費に失敗して二度と完了できないかのどちらかになる。つまり束縛の役目はそこで終わっており、ユースケースの成否を待つ理由が無い。`try / finally` で囲むのではなく呼び出しの**前**に置くのは、同じ保証を分岐なしで得られるため（ローカルの catch を増やさない — CLAUDE.md「Avoid broad try / catch」）。
2. **消費 POST が起きない往復**（`/auth/callback/$provider` の loader）。`error` が付いている、または `state` / `code` が欠けている組は画面がマウント後に POST を出さないので、ルートの loader が `abandonOAuthFlowFn` を叩いて捨てる。消費できる組では**捨てない** — 捨てると続く POST の照合が落ちる。

照合に**失敗した**ときは捨てない。不一致の Cookie は「別のブラウザー（＝正規の利用者）が進行中のフロー」のものなので、攻撃者のコールバック URL を踏ませるだけで被害者のフローを壊せてしまう。

**追補**: 2 点目（非消費経路）もこの原則の内側に入れる。当初の `abandonOAuthFlowFn` は引数を取らず**無条件に**捨てていたため、`<img src="…/auth/callback/google?error=x">` を踏ませるだけで被害者の進行中フローの Cookie を落とせた（GET ナビゲーションとして SSR されるので CSRF ミドルウェアも `SameSite=Lax` も止めない。影響は可用性のみで、サインインからやり直せば通る）。破棄の入口を「自分が焼いた Cookie だと確認できた往復」に狭める。

- `abandonOAuthFlowFn` は転送境界で `state`（1..512 文字）を検証したうえで受け取り、`deriveOAuthStateBinding(state)` が Cookie の値と一致したときだけ捨てる（`clearBoundOAuthStateCookie`）。不一致・不在では何もしない。
- `state` を伴わない往復（`state` 欠落、`error` だけの往復）は照合の材料が無いので**捨てず TTL 10 分に委ねる**。ルート側は `loaderDeps` で「非消費かつ `state` あり」のときだけ `state` を渡し、それ以外では server function を呼ばない（呼べない形にするため引数は nullable にしない）。

### Consequences
- 良い点: 成功・交換失敗・キャンセル・引数欠落のいずれでも束縛 Cookie が残らない。2 タブや戻るボタンの後の再試行が、前の往復の残骸で壊れなくなる。
- 良い点: 破棄が照合と対で置かれるので、「照合を通った `state` は必ず消費された」という読み方が転送境界だけで完結する。
- トレードオフ: 交換が失敗した往復は Cookie も `state` も戻らないので、利用者は必ずサインインからやり直す。`take` が単回消費である以上どのみち再試行はできないため、実質的な縮退にはならない。
- トレードオフ: キャンセルの往復で server function を 1 本余計に叩く。初回描画の loader なので SSR 中は同一プロセス内の直接呼び出しで済み、往復は増えない。
- 中断（タブを閉じる・戻らない）で残る Cookie は従来どおり TTL 10 分で消える。ブラウザーが戻ってこない以上、破棄の入口を置ける場所が無い。
- （追補）良い点: 破棄の 2 点がどちらも「照合を通った」ことを条件にするようになり、「踏ませるだけで状態が変わる」経路が転送境界から消えた。`oauthStateBindingWiring.test.ts` が「不一致の `state` では `Set-Cookie` が出ない / 一致では出る」の 2 ケースで固定する。
- （追補）トレードオフ: `state` の無いキャンセル往復では束縛 Cookie が最大 10 分残る。同じブラウザーの次の開始が上書きするので、残骸が壊すのは「放置した前の往復のコールバックへ後から戻ったとき」だけで、その往復はどのみち `state` 行が無く完了できない。
- （追補）トレードオフ: 消費前の `state` を入手した第三者は束縛を再現できるので破棄も通せる。これは ADR-081 が明記した束縛の非対称性そのままで、その相手はもともとコールバックを消費できる立場にある。

---

## ADR-100: server function の配線は 1 リクエスト分の実行文脈を組み立てて直接テストする

### Status
Accepted

### Context
ADR-081 の束縛は 3 つの純関数（`deriveOAuthStateBinding` / `assertOAuthStateBinding` / Cookie の読み書き）と、それを**正しい順序で並べた server function** から成る。純関数側は `oauthStateBinding.test.ts` が固めていたが、「開始 fn が Cookie を焼く」「照合が `take` より前に走る」という配線そのものはどのテストも見ておらず、その 2 行を消しても全テストが緑のまま通った。順序が壊れた瞬間に login CSRF が復活する以上、ここは回帰検知が要る。

ハンドラー本体を presentation の関数へ切り出して単体テストする案もあるが、それでも「切り出した関数を server function が呼んでいる」ことは誰も見ないので、消せば緑という性質は変わらない。テストできるのは実際にエクスポートされている server function だけ。

### Decision
`apps/web/app/presentation/__tests__/oauthStateBindingWiring.test.ts` が 1 リクエスト分の実行文脈を自前で組み立て、server function をそのまま呼ぶ。

- Cookie の読み書きはモックしない。`requestHandler`（`@tanstack/react-start/server`）で h3 event を張り、入力は `Cookie` ヘッダー、出力は応答の `Set-Cookie` で観測する。属性（`HttpOnly` / `SameSite=Lax` / `Path=/`）まで実物で確かめられる。
- Start context は `Symbol.for("tanstack-start:start-storage-context")` の AsyncLocalStorage に最小の文脈を積んで満たす。vitest には TanStack Start の vite プラグインが入らないため、コンパイル後にだけ現れる server 側の実行経路は再現できない — 走るのはハンドラー本体そのもので、`validator` と `errorResponseMiddleware` は通らない。転送境界の検証と直列化は別のテストの担当なので、この 1 本の射程は「ハンドラーの中の順序」に限る。
- 依存は `getContainer` と開始ユースケースだけを差し替える。`OAuthStateStore.take` はスパイなので、「照合に落ちたら `take` が呼ばれない」を呼び出しの有無として直接主張できる。

### Consequences
- 良い点: 照合行・Cookie 生成行のどちらを消しても 3 ケースが赤になる（確認済み）。ADR-081 の主張がテストで支えられる。
- トレードオフ: フレームワーク内部（ALS のグローバルキー、`requestHandler` の形）に依存するので、TanStack Start の更新で組み立て部分が壊れうる。壊れたときに直すのは `callServerFn` ヘルパー 1 か所で、赤くなること自体は検知として正しく働く。
- トレードオフ: `validator` を通らないので、この経路のテストは入力の形を保証しない。転送境界の検証は zod スキーマと `validateInput` の担当のまま。

---

## ADR-101: 予約 ID は合成のまま残し、ログに出す同一性は `{ parentOperationId, kind }` に分ける

### Status
Accepted

### Context
`reservationOperationId` は `` `${parentOperationId}:${kind}:${normalizedKey}` `` で、決定性（同じ親の再試行が同じ行を再利用する）はこの合成そのものに依っている。一方で `normalizedKey` はメールアドレス・ハンドル・provider account id の生値なので、`releaseUniqueKeys` / `activateUniqueKeys` の失敗ログにこの ID を載せると、ディレクトリの一時障害が 1 回起きるだけで登録試行中の利用者のメールアドレスが標準エラーへ出る。ログは DB とは保持期間も権限境界も別で、転送・集約基盤に出ていく。

ID をハッシュ化すれば両立するが、決定性の根拠を「合成の一意性」から「ハッシュの衝突困難性」に移すことになり、アプリケーション層にハッシュ実装を持ち込む（`reservationOperationId` の JSDoc がそれを避けた理由でもある）。`deleteAccount/globalCleanup` が同じ関数で ID を再導出しているため、形を変えると再導出側の互換も壊れる。

### Decision
ディレクトリに渡す ID は合成のまま変えず、**ログに載せる同一性だけを別に持つ**。`UniqueReservation` に `parentOperationId` を足し、失敗ログは `{ parentOperationId, kind }` を出す。親 ID は `identity.updateProfile:${userId}` のように主体と操作までは特定でき、鍵の値は含まない。`operationId` は「ディレクトリ呼び出しの引数」から出ない値と位置づけ、その規律を `reservationOperationId` と `handleReleaseOperationId` の JSDoc に残す。

### Consequences
- 良い点: 予約サガの冪等性（同じ親の再試行が同じ行を掴む）は完全に据え置き。呼び出し側 4 か所の署名も変わらない。
- 良い点: 障害調査に要る「どの操作のどの種類が落ちたか」はログに残る。鍵そのものが要る場面ではディレクトリ行を引ける。
- トレードオフ: 予約 1 件につき親 ID を重複して持つ。ログ用の同一性を型に載せることで、`operationId` を安易にログへ回す道を塞ぐ側の効果を取る。

---

## ADR-102: 保存エラーは「判断の対象になったハンドル」と対で保持する

### Status
Accepted

### Context
P-21 のハンドル重複は候補チップを出して**選ばせる**ための状態だが、`useActionState` の結果は次の送信まで残る。エラーを結果からだけ読むと、候補を押して入力が変わった後も欄に「使われています」と `aria-invalid` が残り続け、`checkHandleAvailability` が「使用できます」を返していてもそれが出ない。提示した一手を打った直後に画面が否定を言い続けるのは状態モデルの取り違えで、支援技術にも `invalid` が伝わる。

### Decision
`SaveError` に判断の対象になった `handle` を持たせ、欄側の表示（文言・`aria-invalid`）と候補チップは `saveFailure.handle === handle` のときだけ有効にする。入力が動いた時点で欄の判断はデバウンス済みの `checkHandleAvailability`（目安）に戻る。バーに出るフォーム全体の失敗（認証切れ・競合・システム）はハンドル欄の話ではないので畳まない。

### Consequences
- 良い点: 候補を選ぶ／打ち直すという次の一手が、そのまま古い否定の解除になる。
- 良い点: 「エラーは判断した値に紐づく」という規則が型に出るので、欄が増えても同じ形で足せる。
- トレードオフ: 同じ値に打ち直すと過去の失敗文言が戻る。実際に予約が落ちた値なので、表示としては正しい側。

---

## ADR-103: ポート契約と実装の乖離は、正本がどちらにあるかで倒す向きを決める

### Status
Accepted

### Context
レビュー R3 で、契約文（ポートの JSDoc）と実装・適合スイートが食い違う箇所が 2 つ出た。片方は JSDoc が実装より強く、もう片方は JSDoc が実装より弱い。

- `DistributedOperationStore.markState` の JSDoc は「不正な遷移は `ConflictError`」と約束しているが、memory 実装は未知 ID しか弾かず、適合スイートも遷移を拘束していない（`completed → running` が通り `terminalAt` が消える）。
- `ScopeTaskQueue.listDue` の JSDoc は「各 scope が自分で起きるランタイムは空配列を返す。それは完全な実装」と逃げ道を書いているが、適合スイートは無条件登録で内容と順序と limit を要求する。

どちらも「JSDoc を読んだ実装者が到達する振る舞い」と「スイートが通す振る舞い」がずれており、#7 / #11 の実装者が契約の解釈から始めることになる。

### Decision
**正本がどこにあるかで倒す向きを決める。**

- `markState`: 正本は実装側。JSDoc から "illegal transition" を落とし、「状態は呼び出し側が決める / ストアは状態機械ではない」と明記する。遷移を実装側で拒否するのは本 Issue の AC 外の強化なので行わない。
- `listDue`: 正本は plan のテスト方針（「`scopeTaskScheduler` スイートには `ScopeTaskQueue.listDue` の契約も含める」）。JSDoc の逃げ道を削り、必須契約として書き直す。スイートはゲートを足さずそのまま残す。

### Consequences
- 良い点: どちらの側も「JSDoc だけ読んで実装 → スイートが通る」が成立する（spec/adr/026 の決定 1）。
- 良い点: 契約を弱める側（`markState`）でも、弱めた事実が JSDoc に出るので、遷移を守る責務が呼び出し側にあることが読める。
- トレードオフ: `markState` は terminal → running を弾かないままなので、同ポートを再利用する #7（note move）が二重呼び出しを起こすと `terminalAt` が消えうる。引き継ぎとして progress.md に記録する。
- トレードオフ: `listDue` を必須にしたことで、中央列挙を持たないランタイムも実装を求められる。再起動後に未完の継続を拾う経路が他に無い以上、これは縮退ではなく要件。

## ADR-104: 予約解放の冪等性は「削除された ID の不在」ではなく「その鍵を名乗る現行 identity の不在」で判定する

### Status
Accepted

### Context
`identityRemovalRelease` は `identity.identity.removed` を受けて provider account の active 予約を解放する。冪等性の根拠は receipt の存在と `receipt.identityId` の行が消えていることの 2 点だった。

しかし再連携は**新しい `IdentityId`** を採番するため、旧 ID は恒久的に不在のままになる。「解除 → 解放 → 同じ Google アカウントを再連携 → 同じ removal イベントが再配送」の列で、ガードは素通りし、再連携で publish されたばかりの active 予約が `releasing → 削除` される。`beginRelease` は所有者一致（同一 user）しか見ないので止まらない。結果は「Identity 行はあるが directory に claim が無い」状態で、**別の利用者がその provider account を奪って本人のアカウントにサインインできる**。outbox は at-least-once であり、receipt の TTL は 30 日なので窓も 30 日。

### Decision
解放の前に「その `providerAccountKey` を**今**名乗っている identity が receipt の user に存在しないこと」を確認する。`ctx.identityRepository.listByUserId(receipt.userId)` を同じ UoW で読み、`providerAccountKey(provider, providerAccountId)` が一致する oauth identity があれば解放しない。

receipt に directory 行の `operationId` を凍結して `beginRelease` で照合する案（ポートと適合スイートとアダプターの変更）は採らない。波及が本 Issue の範囲を超え、かつ効果は同じ「奪取の阻止」に留まる。

判定は `{ outcome: "keep"; reason } | { outcome: "release"; userId; normalizedKey }` の直和で返し、解放に必要な値は release 側だけが持つ形にした（呼び出し側で `null` を再検査する余地を消す）。

### Consequences
- 良い点: 「解除は自分の claim にしか触れない」だけでなく「解除は**過去の**自分の claim にしか触れない」が成立し、再連携後の再配送で乗っ取り経路が開かない。
- 良い点: ポート契約・適合スイート・アダプターは無変更。判定はすべて application 層の 1 ファイルに閉じる。
- トレードオフ: 解放のたびに `listByUserId` を 1 回追加で読む。identity は 8 件上限なので実質定数コスト。
- トレードオフ: 「同じ鍵を再連携したあとに旧 removal が再配送される」正常系でも `keep` の warn が出る。理由コード（`providerAccountRelinked`）で異常系と区別できるようにした。

## ADR-105: P-25 の「削除されるもの / されないもの」は宣言された participant の集合に合わせる

### Status
Accepted

### Context
P-25 の説明は「個人のノートと、その元ファイル」「公開ページとすべての共有リンク」を削除されるものとして挙げ、完了画面は「データの削除が完了しました」と断定していた（モック `spec/design/pages/P25-settings-danger.html` の写し）。

本スライスの personal cleanup participant は `storage` / `usage` の 2 つだけで（ADR-002 / ADR-018）、`deleteNotesForOwner` と公開 URL の tombstone 化（TC-identity-092）は別スライス。`completed` に到達しても個人ノートとその公開ページは残る。plan.md 自身が TC-identity-083 の見送り理由に「File / Usage だけの部分確認を『全データを削除』と読み替えない」と書いており、取り消せない操作の説明だけが実態より広い約束をしていた。

### Decision
文言を、`completed` の時点で実際に起きることに合わせる。

- 削除されるもの: プロフィール（表示名・ハンドル・自己紹介・アイコン。`finalizeDeletion` が落とし、`uniquenessRelease` がハンドルと メールの予約を解放する）/ アップロード済みファイル（`deleteFilesByOwner`）/ すべてのログイン方法とセッション（`identityRepository.delete` と auth 残渣掃除）。
- 削除されないもの: 個人のノートとその公開ページ・共有リンク（新設行）/ 既存のワークスペース 2 行。
- 完了文言: 「データの削除が完了しました」→ 実際に消えた 3 種の列挙。

participant を足すスライス（編集・整理 / #9）が、ノートと公開ページの行を左の列へ戻す。

### Consequences
- 良い点: 取り消せない操作の前後で、利用者が読む説明と実際の結果が一致する。ノートが残ることを実行前に知れる。
- 良い点: 差分が 2 つのリテラル配列と 1 文に閉じるので、participant 追加時の戻しが機械的。
- トレードオフ: モック（`spec/design/pages/P25-settings-danger.html`）と文言が一時的にずれる。モックは participant が揃った状態の完成形を描いているので、spec 側は直さない（PAGE-p25 の縮退として引き継ぐ）。
- トレードオフ: 「個人のノートは残る」は本スライス限定の事実で、後続スライスで逆になる。行が移動するだけと分かるよう、左右の列で同じ語（ノート / 公開ページ・共有リンク）を使った。

## ADR-106: barrier を閉じた scope turn の global 引き渡しは、専用の scope task 行で駆動する

### Status
Accepted

### Context
personal cleanup の最後のターンは 1 つのトランザクションで `acknowledgePersonalComponent` → `markCompleted` → 自分の task 行の `complete` を確定させる。その **あと** に、別の平面・別のトランザクションとして `acknowledgePersonalCleanup`（manifest への `personalCleanup` receipt + `redaction` フェーズの継続）が走る。

この 2 つ目のコミットを落とすと、復旧する主体がどこにも残らない。task 行は `complete` で消えており `backoff` は行不在で no-op、cleanup フェーズの継続イベントは決定的 id（`…:cleanup:-`）で outbox に折り畳まれて再配送されず、`terminalPrune` / `globalCleanup` / `finalize` のどれも cleanup へは戻らない。150 件を seed して ack 直前で失敗を注入すると、データは削除済み・barrier は `completed`・manifest に receipt 無しで、削除は恒久的に `running` のままになる（実測）。

「消えた行を `backoffOrSchedule` で復活させる」だけでは復旧しない。復活した行が再投入するのは cleanup ユースケース本体であり、その先頭の `assertOwner` は `status === "running"` の barrier しか通さない。閉じたばかりの barrier に対しては必ず `ConflictError` になり、8 回の再試行のあと `failed` に落ちる毒行になる（実測: `[scope-tasks] task threw` × 8）。イベント駆動のウェーブが復旧できるのは、`dispatchAccountDeletionCleanup` が progress を先に読んでコマンド自体を飛ばすからで、scope task 経路には同じ入口が無い。

### Decision
引き渡しに専用の継続行を与える。runner は barrier を閉じたターンの直後に `identity.personalCleanupHandoverContinued` を scope 平面へ arm し、その上で `acknowledgePersonalCleanup` を呼び、receipt が入って初めてその行を `complete` する。同じ kind のハンドラーが登録されているので、例外でもプロセス断でも次の tick が同じ引き渡しだけを再実行する。`acknowledgeReceipt` は冪等で継続イベントは決定的 id に折り畳まれるため、再実行の副作用は無い。

`backoff` は catch のまま変えない。閉じた cleanup 行を復活させると上記の毒行になるので、「行が無ければ何もしない」がこの経路の正しい既定になる。

### Consequences
- 良い点: 引き渡しが失われても駆動主体が DB 上に残るので、AC-29 の「プロセスを落として再起動しても未完の継続を拾って完走する」が scope task ターンで barrier が閉じる経路でも成立する。
- 良い点: 再駆動されるのが引き渡しだけなので、`assertOwner` にも cleanup ユースケースにも触れずに済む。閉じた barrier を読み直すドライバーを別に建てる必要も無い。
- トレードオフ: barrier を閉じるターンごとに scope 平面のトランザクションが 2 つ増える（arm と complete）。削除 1 件につき 1 回だけなので、往復 1 回ぶんのコストとして許容する。
- 残る穴: barrier を閉じたコミットと arm のあいだでプロセスが落ちると、依然として駆動主体が残らない。塞ぐには `completePersonalCleanupIfDone` と同じ UoW で arm する必要があり、cleanup ユースケース側の変更になるので本ラウンドでは持ち越す（arm が同一 scope への小さな書き込み 1 回なのに対し、塞げた窓は別平面のコミット全体なので、窓は桁で縮んでいる）。
- kind の定数は runner に置いた。この継続を出すのも受けるのも runner だけで、participant 登録簿（`cleanup/participants.ts`）が並べているのは「掃除に参加する component」であってこの引き渡しはその一員ではない。

## ADR-107: P-25 の進捗パネルは「パネルが替わったときだけ」焦点を移す

### Status
Accepted

### Context
P-25 は受理した瞬間にフォームの `<section>` ごと進捗パネルへ差し替わる。差し替え後の `Alert role="status"` と `<p aria-live="polite">` は新規マウントとして現れるため、「受理しました」「サインアウトしました」は読み上げられない — live region は中身が入る前から DOM に在ることが読み上げの条件だからで、`SignInForm` の常設 region と `ResetPasswordPanel` の `Result`（焦点移動）はどちらもこの制約を前提にしている。P-25 はフォームと進捗が排他なので、両者の外側に常設 region を置くと入れ子の live region になり、`Alert` と二重に読み上げられる。

### Decision
`ResetPasswordPanel.Result` と同じ形にする。進捗パネルの外枠 `<section>` に `tabIndex={-1}` と ref を付け、マウント時に `ref.current?.focus()` する。フォーカスリングは `focus-visible:shadow-none` で消す（プログラム由来の焦点であって操作の位置ではない）。

`accepted` と `running` は同じパネルなので、呼び出し側で同じ `key` に畳む。畳んだぶんは作り直されないので、進行中の文言差し替えは常設になった `<p aria-live="polite">` の更新として伝わり、焦点は奪い返されない。`completed` / `settled` は別の `key` になり、そこで初めて焦点が新しいパネルへ移る。

### Consequences
- 良い点: 「受理・サインアウト」「削除しました」「進捗を表示できません」のいずれもマウント時の焦点移動で読み上げられ、最も後戻りできない操作の結末が支援技術に伝わる。焦点喪失（`<body>` 送り）も起きない。
- 良い点: 常設 region を外側に足さないので `Alert` との入れ子が生まれない。
- トレードオフ: 焦点の単位を `key` に持たせたぶん、`phase.kind` と表示パネルの対応が呼び出し側にも現れる。対応表が 1 行で済むうちは、`useEffect` の依存にパネル名を渡す形（実効的に使っていない依存）より意図が読める。

## ADR-108: providerAccount claim は「サインインを通す資格」ではなく、UserId shard の identity 行と対で読む

### Status
Accepted

### Context
`completeOAuthSignIn` の既存リンク経路（`signInLinkedUser`）は directory の `resolve("providerAccount", key)` が返した UserId をそのまま信じ、User 行の status だけを再確認してセッションを発行していた。spec/usecases/identity.md 手順 3 は「providerAccount directory を解決し、返った UserId shard で**既存 Identity と User を確認する**」と定めており、確認の片側が落ちていた。

`removeIdentity` は identity 行を UserId shard で消し、directory の `active` 行は残したまま `identity.identity.removed` の consumer（`identityRemovalRelease`）に解放を委ねる。したがって「解除は成功したのに、その Google アカウントでまだサインインできる」窓が必ず一度は開く。実測でも、Google 登録 → パスワード追加 → OAuth 手段を解除 → イベント未 drain の順で同じ provider account を提示すると、identity が `["password"]` だけになった利用者として**セッションが発行された**。

窓は一時的とは限らない。outbox は失敗回数超過で quarantine され、`identity_removal_receipts` は 30 日で掃除される（ADR-075）。両方が起きると再配送は `noReceipt` → `keep` に倒れ、claim は恒久的に `active` のまま残る。`linkOAuthIdentity` の `existingLinkId` と `identityRemovalRelease`（ADR-104）は同じ不一致をすでに検出しており、読み側だけが確認を落としていた。

### Decision
`signInLinkedUser` に `accountKey` を渡し、**セッションを insert する最終 UoW の中で** `ctx.identityRepository.listByUserId(userId)` を読んで、同じ `providerAccountKey` を名乗る oauth identity が現存することを確認する。無ければセッションを発行しない。UoW の外で読むと「読んだあとに解除が commit される」窓が残るので、status / epoch の再確認と同じトランザクションに置く。

拒否は新コード `ConflictError("PROVIDER_ACCOUNT_RELEASE_PENDING")` とし、`existingLinkId` の同じ不一致にも同じコードを使う。既存の `PROVIDER_ACCOUNT_ALREADY_LINKED` の文言は「別の利用者に紐づいています」で、**自分が今解除したアカウント**について出ると誤誘導になる。文言は「この外部アカウントの解除処理が進行中です。少し待ってからもう一度お試しください」で、再試行が有効な状態であることを伝える。

コードは application 層のリテラルとして持つ。`domain/identity/errorCode.ts` は `BusinessRuleError` の不変条件違反コードの列挙で、これは directory と shard の収束待ちという usecase 側の事情なので、`PROVIDER_ACCOUNT_ALREADY_LINKED` と同じ置き場に揃えた。

claim を無視して email 経路（新規作成 / 既存への自動リンク）へ落とす案は採らない。directory の行は残っているので後続の `reserve` が必ず競合し、しかも利用者には「別の利用者に紐づいています」が出る。解放が進行中であることを名乗って再試行させるほうが、状態と応答が一致する。

### Consequences
- 良い点: 「解除に成功した OAuth 手段では二度とサインインできない」が、解放イベントの到達に依存せず UserId shard の 1 トランザクションだけで成立する。quarantine や receipt TTL 切れで解放が永久に来ない場合でも同じ。
- 良い点: 読み側（サインイン）・書き側（再連携）・解放側（consumer）の 3 経路がすべて「その鍵を名乗る現行 identity が居るか」という同じ述語で判断するようになり、非対称が消える。
- 良い点: 本人が同じ窓で再連携したときの応答が「他人のものだ」から「解除処理が進行中だ」に変わり、実際に有効な行動（待って再試行）を案内できる。
- トレードオフ: 既存リンクのサインインごとに `listByUserId` が 1 回増える。identity は 8 件上限なので実質定数（ADR-104 と同じコスト）。
- トレードオフ: 解放が恒久的に落ちた場合、その provider account は誰も使えないまま残る（サインインも再連携も `RELEASE_PENDING`）。運用で解放を再駆動するまで固まる形を選んだ — 誤って通すより固まるほうが安全側に倒れる。
- spec-sync 候補: `completeOAuthSignIn` / `linkOAuthIdentity` のエラーケース表に `PROVIDER_ACCOUNT_RELEASE_PENDING` が無い。手順 3 の要求そのものは満たしたので、表側の追記を spec-sync に回す。

---

## ADR-109: dev IdP の起動ガードは `NODE_ENV` の allowlist にする（ADR-003 / ADR-073 の追補）

### Status
Accepted

### Context
ADR-003 の規則 1 と ADR-073 は、dev IdP の production 混入を「`NODE_ENV === "production"` かつ `OAUTH_DEV_MODE=true` なら起動失敗」という denylist で守っていた。plan.md「リスクと注意点」はこのガードを唯一の技術的統制として挙げているが、denylist は production 以外のあらゆる値を通す。`pnpm build` の成果物に対する実測で、`NODE_ENV=staging` と `NODE_ENV=`（空文字）はいずれも起動に成功し、`GET /dev/oauth/authorize` が 200（同意画面）を返した。空文字は `listen.node.ts` の `process.env.NODE_ENV ??= "production"` が既定値に戻せない（`??=` は空文字を nullish と見なさない）ため、`NODE_ENV=$UNSET_VAR` を書いたコンテナマニフェストで普通に起こる。dev の同意画面は任意のメールアドレスを `emailVerified: true` のまま通し、認可コードは無署名なので、成立した時点で当該デプロイの全アカウントが乗っ取り可能になる。

### Decision
判定を allowlist に反転する。`OAUTH_DEV_MODE=true` を受理するのは `NODE_ENV === "development"` のときだけとし、未設定・空文字・`test`・`staging` を含む他のすべての値で起動失敗させる（`di/serverNode.ts` の `nodeServerEnvSchema.superRefine` 1 箇所）。

- 「分類できない配備は拒否側に倒す」を規則そのものにする。denylist は「危険な値を数え上げられている」ことを前提にするが、配備側の `NODE_ENV` は我々の管理下にない。
- `development` を立てるのは `vite dev`（= `pnpm dev`）だけなので、開発の唯一の正規経路は通り、`pnpm start` 系は `.env` の内容によらず必ず落ちる。
- `test` は足さない。CI で `readNodeServerEnv` を実 `process.env` から呼ぶ経路が無く（ユニットテストは env を引数で渡す）、足すと守る対象が増えるだけになる。
- ADR-073 の `listen.node.ts` の `NODE_ENV ??= "production"` は変更しない。allowlist では空文字も staging も `development` ではないので、この宣言はガードの前提ではなくなり、production バンドルと実行時 env の一致を保つ役割だけが残る。
- 失敗メッセージには観測した `NODE_ENV` を含める。落ちた側が「どの値で拒否されたか」を見ずに `OAUTH_DEV_MODE` を疑うと、空文字のケースで原因に辿り着けない。

あわせて、AC-6 の「`OAUTH_DEV_MODE` が偽なら 404」のうち**承認コードを実発行する** `submitDevConsentFn` にテストを 1 本足す。起動ガードが塞ぐのは env→フラグの経路だけで、フラグが偽のまま到達した要求はこの server function が塞ぐ。ルート loader の `notFound()` とは別の穴なので、ガードを外すと落ちることまで実測して固定する。

### Consequences
- 良い点: 本番形の起動が `NODE_ENV` の値によらず dev IdP を拒否する。実測で production / staging / 空文字 / 未設定の 4 通りすべてが ZodError で起動失敗し、`OAUTH_DEV_MODE` 無しの本番形は起動して `/dev/oauth/authorize` が 404 を返す。
- 良い点: `.env.example` の「never on a deployed host」という運用約束が、配備者の申告ではなくコードで裏づけられる。
- トレードオフ: `NODE_ENV=production pnpm start` 相当の本番形で dev IdP を検証する経路は `NODE_ENV=development pnpm start` の 1 通りだけになる（ADR-073 の想定どおり）。`NODE_ENV=test` でユニットテスト以外から起動する運用を将来入れる場合は、この allowlist を明示的に広げる判断が要る。

---

## ADR-110: Cookie の `Secure` も `NODE_ENV` の allowlist で判定する（ADR-109 の追補）

### Status
Accepted

### Context
`session.ts` / `oauthStateCookie.ts` の `secure` は `NODE_ENV === "production"` の denylist で、ADR-109 が dev IdP のガードを allowlist へ反転したあとも同じ形で残っていた。「`NODE_ENV=staging` や空文字で本番形を起動すると `Secure` が落ちる」という読みは 5 周にわたり繰り返し指摘されている。

実測すると、その攻撃シナリオは成立しない。Vite は RSC / SSR バンドルでも `process.env.NODE_ENV` をビルド時に畳み込むため、`pnpm build` の成果物（`dist/server/rsc/assets/session-*.js`、`oauthStateCookie-*.js`）には `process.env` の参照が 1 つも残らず、述語は定数に潰れている。`pnpm start` に渡す `NODE_ENV` の値では覆せない。ADR-109 が反転した dev IdP のガードは**実行時に** `process.env` を読む `readNodeServerEnv` の側にあり、こちらとは畳み込みの有無が違う。

### Decision
挙動を変えずに、表記だけを allowlist へ反転する。`isDevelopment()`（`NODE_ENV === "development"`）のときだけ `Secure` を外し、それ以外のすべての値では付ける。

- 免除の理由は「dev の平文 http」であって「production ではない」ではないので、意味と判定の向きを一致させる。分類できない `NODE_ENV` は免除しない側へ倒れる。
- 畳み込みの事実を why コメント 1 行として両ファイルに残す。これが書かれていないことが誤読の原因なので、恒久的に閉じるのはコメントの側。
- `Strict-Transport-Security` は足さない。転送層の方針（プリロード・サブドメイン・max-age）はこのスライスの射程外で、`Secure` が畳み込みで保証されている以上、緩和として要る場面が無い。
- 述語は 2 ファイルに 1 行ずつ重複させたままにする。どちらも server-only の Cookie 運搬モジュールで、属性の並びのすぐ上に判定がある形を崩してまで共有モジュールを 1 本増やす利得が無い。

### Consequences
- 良い点: 「denylist なので配備値で緩む」という読みが、コードの向きとコメントの両方で閉じる。
- 良い点: 実測で `dist/server/rsc/assets/session-*.js` と `oauthStateCookie-*.js` の双方が `isDevelopment = () => false` に畳み込まれ、`secure: !isDevelopment()` は常に真。両ファイルとも `NODE_ENV` の参照は 0 件。
- トレードオフ: `vite dev` 以外で `NODE_ENV=development` を立てても `Secure` は外れない（成果物は畳み込み済み）。dev の平文 http は `pnpm dev` の 1 経路だけという ADR-109 と同じ前提に乗る。

---

## ADR-111: 行内の二段確認は「その行を操作したとき」だけ焦点を移す

### Status
Accepted

### Context
P-22 の「解除」は `confirming` の真偽でボタンごと差し替わるので、押した瞬間に焦点の載っていた `<button>` がアンマウントし、焦点が `document.body` へ落ちる。行内に live region は無いため、確認 UI の出現はキーボード / 支援技術のどちらにも伝わらない。同じ PR の `DeletionProgress`（ADR-107）と `ResetPasswordPanel.Result` は「パネルが替わるときは焦点も移す」を実装しており、最も破壊的なこの経路だけが規律から外れていた。

### Decision
`MethodRow` が確認 UI の出現で「解除する」へ、「やめる」で元の「解除」へ焦点を移す。

移動するのは**その行のボタンを押した結果**のときだけとし、判定はクリックハンドラーが立てる ref のフラグで持つ。`confirming` の変化だけを条件にすると、(a) 初回描画でリスト先頭の「解除」が焦点を奪い、(b) 別の行の確認を開いて閉じた側が、開いた側から焦点を奪い返す。実行（「解除する」）では行が楽観的に消えるので焦点は戻さない — 結果は親の常設 live region が伝える。

`<dialog showModal()>` への作り替えと `spec/design/index.md#3.10`（削除確認＝ダイアログ）の割り当て見直しは行わない。P-22 の行内確認と P-24 の `AddPasswordForm` を両方作り直す規模で、このスライスの射程を超える。焦点の移動だけで「確認が出た / 戻った」は伝わる。

### Consequences
- 良い点: 破壊的操作の二段確認が、キーボードだけで確認 → 実行 / 取り消しまで到達できる。焦点喪失（`<body>` 送り）も起きない。
- 良い点: 判定が「自分の行の操作」に閉じているので、行が増えても焦点の奪い合いが起きない。
- トレードオフ: 焦点移動の意図をフラグ ref で持つぶん、行コンポーネントに 1 つ状態が増える。`confirming` の前回値と比べる形では上記 (a)(b) を分けられないので、意図を明示するほうを採った。
- spec-sync 候補: §3.10 の「ダイアログを使ってよい場面」と実装（削除確認＝行内差し替え、パスワード追加＝ダイアログ）の対応が反転したままなので、割り当ての正本をどちらにするかは spec-sync に回す。

---

## ADR-112: P-25 の ticket 退避は best-effort とし、受理の表示より後ろに置く（ADR-006 / ADR-095 の追補）

### Status
Accepted

### Context
`sessionStorage` はサイトデータを遮断した設定（Cookie とサイトデータのブロック、`dom.storage.enabled=false`、制限付き sandbox）ではアクセス自体が `SecurityError` を投げる。P-25 は受理直後の `setItem` を `try` の内側かつ `setPhase` より前に置いていたため、その環境では**サーバー側で削除が受理されセッションが破棄されたあと**に例外が出て `{ error }` に倒れ、画面は削除フォームのまま「うまく処理できませんでした」を出す。再送しても同じ `requestId` の resume が同じ行で落ちるので、利用者は取り消せない削除が走っていることを一度も知らされない。復元側の `getItem` も無防備で、同じ環境では effect が投げて `/settings/danger` が `ServerErrorState` に倒れ、削除フォームにすら到達できなかった。

ticket の保持がクライアント責務であること自体は ADR-006 の決着済み設計で、変えるのは順序と失敗の扱いだけ。

### Decision
受理の表示（`setPhase({ kind: "accepted", ticket })`）を退避より**先**に出し、`sessionStorage` の読み書き（`persistTicket` / `forgetTicket` / `readStoredTicket`）はすべて `try / catch` で握って握り潰す。保持できなくても受理の事実はこのタブの `phase` で追えるので、退避の失敗を削除の失敗として見せない。

`removeItem` も同じ扱いにする。終端で捨てる経路（`settle`）は `poll` の `catch` の中からも呼ばれるので、ここが投げると catch の中で例外が出て未処理の rejection になる。

### Consequences
- 良い点: 「受理されたのに失敗表示」で詰まる経路が無くなり、`sessionStorage` を持たない環境でも進捗表示と完了表示まで到達できる。
- 良い点: `/settings/danger` が復元経路の例外で `ServerErrorState` に倒れなくなる。
- トレードオフ: 保持に失敗したことは利用者に見えない。リロードすると進捗を追えなくなるが、その時点の案内（サインインし直して確認する）は既存の `settled` 表示が持つ。
- CLAUDE.md の「broad catch は境界だけ」との関係: ここは Web Storage という外部資源との境界で、アダプターが driver の例外を畳むのと同じ位置づけになる。
