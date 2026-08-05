# 実行基盤の設計

実行基盤は **Cloudflare Workers + scope Durable Objects + global D1 + R2 + Queues** に確定している（[scope sharded data plane ADR](../adr/021-scope-sharded-data-plane.md)）。本書は、データ配置・ルーティング・実上限と、そこから逆算した設計値の正典である。

## この文書の役割

| 決めること | 正典 |
| --- | --- |
| global / scope のデータ配置と routing | 本文書 |
| 基盤の実上限 | 本文書 |
| 行サイズの予算 | 本文書（値の定義は各 domain） |
| D1 query 予算と scope operation の分割単位 | 本文書 |
| Queue / Alarm / Cron の役割 | 本文書 |
| 外部要求の同時実行数 | 本文書 |
| HTTP 境界 | [presentation/index.md](../presentation/index.md) |
| 表と索引 | [database/index.md](../database/index.md) |

## データ配置

### ScopeKey と Durable Object

```ts
type ScopeKey =
  | Readonly<{ type: "user"; userId: UserId }>
  | Readonly<{ type: "workspace"; workspaceId: WorkspaceId }>;
```

`user:{userId}` / `workspace:{workspaceId}` を正規名として `ScopeObject` の ID を決定する。同じ scope はどの Worker / Queue consumer / Alarm から呼んでも同じ object へ到達する。

| plane | 正データ / 投影 |
| --- | --- |
| user scope DO | 個人 Note / Revision / Tag / StoredFile metadata / BackupRecord / Job / Usage / private search / outbox / scheduled task |
| workspace scope DO | Workspace / Membership / Invitation と、その scope の Note / Revision / Tag / StoredFile metadata / BackupRecord / Job / Usage / private search / outbox / scheduled task |
| global D1 | Identity / Session / auth state / external connection / uniqueness reservation / membership directory / note route / cross-scope operation / job slot / global job history projection / public profile・workspace・note projection / public FTS / global outbox |
| R2 | ファイルと生成物のバイト列 |

scope repository は必ず `ScopeKey` を受ける。`ScopeUnitOfWorkProvider.run(scope, fn)` の中から別 scope または D1 の repository を呼んではならない。global D1 の transaction から scope object を呼ぶことも禁止する。複数 plane の operation は operation ID を持つ状態機械で再開する。

workspace scopeのwrite commandはScopeRouter入口で`WorkspaceOperationLockStore.assertWritable`を必ず通る。workspaceが`deleting(operationId)`なら、同じoperation IDを持つ削除continuation/security cleanup以外のNote/Tag/Storage/Job/Usage/Membership/Invitation writeを`WORKSPACE_DELETING`で拒否する。削除後に保持するJob/outbox/tombstoneの縮約だけは`jobRetention` / `outboxRelay` / `tombstonePrune`のsystem maintenance allowlistで通し、新規Jobやretryは通さない。global reservationを先に要する招待系も予約前とlocal commit時の2回検査し、競合時はreservationをabandonする。

### routing

- Note は D1 の `note_routes` で `NoteId → ScopeKey + routeVersion` を解決する。mutation は routeVersion を scope object に渡し、古ければ route を 1 回だけ引き直す
- route / reservation / operation lock はD1 primaryまたは同じsessionのbookmarkで読む。public searchなどのprojectionはreplicaを許す。通常readでもscope側がrouteVersion不一致または対象不在を返した場合はprimaryでrouteを1回だけ再解決し、移動直後のstale replicaを偽のnot foundにしない。共有・purgeは安全側に倒し、`purging` / `tombstone`をcacheしない
- Job は `ScopedJobId` に ScopeKey を含める。Job は移動しないため route 表を持たない
- Workspace は `WorkspaceId` から workspace scope を決定できる。slug と invitation token は D1 directory で WorkspaceId に解決する
- user の workspace 一覧は D1 membership directory / projection から読む。権限の正は workspace object の Membership であり、mutation の直前に scope object で確認する

## 実上限

Workers Paid を前提とする。Cloudflare の値が変わった場合は、本表を先に更新してから下流の設計値を引き直す。

### SQLite-backed Durable Objects

| 項目 | 値 |
| --- | --- |
| object 数 | 制限なし |
| 1 object の storage | **10 GB** |
| 1 object の request rate | **1,000 req/s soft limit**（storage write を伴う処理はこれより低い） |
| 文字列 / BLOB / 1 行 | **2,000,000 バイト** |
| SQL 文 | 100,000 バイト |
| bound parameters | **100** |
| CPU | 既定 30 秒 / 最大 5 分 |
| Alarm 壁時計 | **15 分** |
| 1 object の Alarm | **同時に 1 つ** |

1 scopeが10GBまたは継続的なoverloadに近づいた場合はtenant内shardingが必要になる。foregroundを優先し、外部I/O Jobはscope-local admission leaseで同時4、Alarmは100行またはCPU 2秒までとする。待ち行列100件、foreground p95 500msを5分、またはSQL p95 100msを超えたら、priority 0 security/leaseとpriority 1 outboxは継続し、priority 2/3、新規bulk、外部I/O Job受付だけを抑制する。HTTPは503 + `Retry-After`、Queueは再試行、Alarmはbackoff再予定とする。閾値が7日中3日発生したscopeはtenant内sharding ADRを開始する。

scope SQLite容量は `notes本文 / revisions / search+FTS / Job・metadata / indexes` の内訳と30日成長率を日次記録する。50%または90日以内に70%予測でtenant内sharding実装を開始し、60%で新規revision保持数とbulk uploadを抑制、70%で新規upload/Note作成を容量エラーで拒否する。削除・export・security cleanupは継続し、R2容量をSQLite空きとして数えない。

### D1

| 項目 | 値 |
| --- | --- |
| database size | **10 GB** |
| Worker invocation あたりの query | **1,000** |
| 文字列 / BLOB / 1 行 | **2,000,000 バイト** |
| SQL 文 | 100,000 バイト |
| bound parameters | **100** |
| 1 query | 30 秒 |

D1 read replication は global read の latency / throughput を分散するが、write は primary に集まる。global D1は「全データ」ではなくcontrol / public subsetだけだが、route readとpublic writeのcritical pathには残る。障害時はprivate noteのID直アクセスを安易に別scopeへfallbackせず一時エラーにし、権限や削除状態を推測しない。

global容量は表群ごとに週次予測する。publicは `公開Note件数 × p95投影行サイズ × FTS/索引実測係数`、job historyは `90日内のrequested Job数 × (p95履歴行+target reverse route+index係数)`、controlはroute / membership / operation/cleanup manifest ackの平均行サイズと増加率で見積もる。write QPSにはJobのenqueue/start/progress/terminal/removeとreverse route更新をすべて含める。使用率50%、D1 write p95 200ms超、またはoverloaded率1%を5分継続した時点でshard-aware readerを検証する。60%または90日以内に70%到達予測でdual-write/backfillを開始し、70%で新規公開など非critical writeを流量制御する。

物理shardはtransaction groupを分断しない。NoteId hashの同じ `note coordination shard` に `note_routes`、noteMove/notePurge operation、当該Noteのpublic search/tag/FTS行をco-locateする。purgeのpublic delete+ack、moveのroute+operationはこのshard内transactionで保つ。public検索は最大32 shardを同時6接続のwaveで読み、署名opaque cursorがshard generation・各shardのkeyset位置・絶対rankを持つ。各shardから1page最大limit件だけ読み、keywordなしは `(updated_at DESC, note_id)`、keywordありはshard内FTS順位のReciprocal Rank Fusionと`updated_at, note_id` tie-breakでmergeする。単一DB時のglobal bm25同値は保証せず、shard数に依らず再現可能な順位を契約とする。dual-readはNoteIdで重複排除する。

NoteId shard上の二次キー走査は共通shard readerだけが行う。`created_by` / `scope` route fan-out、sitemap、public authorは最大32 shard・全体limit 200（sitemapは呼出しlimit）・同時6接続のwaveとし、署名cursorにgenerationと各shard位置を持つ。`resolveMany`は最大500 NoteIdをshard別batchへgroupingする。reshard中はいずれも旧新を読み、NoteId/UserIdとversionで重複排除する。

`workspace_directory`はWorkspaceId hashで分ける。利用者のworkspace pageはUserId shardから得た最大20 IDだけを最大6接続で直接解決する。公開workspace/sitemap一覧は最大32 shard・同時6接続・全体200件を`(updatedAt DESC, workspaceId)`でmergeし、署名cursorにgenerationと各shard位置を持つ。総件数を求める全shard countは提供しない。

`job_history`はrequestedBy hashで分ける。親子は同じrequestedBy不変条件により同じshardへ入り、`listJobs`は1 shardで閉じる。通常Job eventはrequestedBy route keyを運び、削除時はscope-local removal manifestへroot/最大500子のrequestedBy/targetを100件ずつ固定する。rootはmanifestと同じUoWでclaimしてretry/worker resultを閉じる。local Jobは子から100件ずつ消し、manifest参照型`job.removed`を起点にtarget route→requestedBy shardのhistory tombstone/removeの順で最大6接続のwaveにより回収する。route/history tombstoneとcompleted manifestは30日、target tombstoneは120日保持し、各prunerを100件/turnに制限する。target削除もtarget hash reverse indexを100件pageで読むため、history全shardをscanしない。移行中はsourceVersion条件付きdual-write、新→旧read merge、manifest itemに基づく旧新両generation removeで90日保持を維持する。匿名Jobはhistoryへ保存しない。

UserId hashの `user coordination shard` にはUser/Identity/Session/AuthToken/ExternalConnection正データ、membership directoryの当該user edge、accountDeletion/nameChange/integrationDisconnect operationをco-locateする。Session/AuthTokenのwire tokenは`base64url(UserId).256bit-secret`とし、locatorで1 shardへ到達してからtoken全体のhashを照合する。locatorを認証には使わない。これによりUserの`authEpoch`更新、資格/連携の発行、account deletion barrierを同じtransaction groupで直列化し、最終化のedge+PII transactionも維持する。容量都合でjob historyを別database familyへ分けても、このtransaction groupは分断しない。

workspace削除はscope DOでmutationをlockし、MembershipのuserId/IDとInvitationのtokenHash/IDを各100件ずつlocal manifestへ固定する。local edgeもmanifestから100件ずつ削除し、RESTRICT下でWorkspaceを最後に消す。global cleanupはmanifest route keyから各UserId/key shardへ最大6接続で直接到達し、全ackまでmanifestを保持する。すべてのlocal cleanup command/taskは削除operation IDを保持し、manifestのowner一致時だけ通常write admissionを通過する。正データ削除後のshard横断scanには依存しない。

Identity/email/handle/provider identityのequality uniquenessはnormalized key hash shardの `identity_unique_reservations` で reserve → UserId shard更新 → activate/releaseする。User rowとuniqueness shardを同一transactionにしない。応答喪失はoperation IDで再開し、active reservationからUserId shardへ解決する。slug/tokenも同じreservation原則を使う。移行中は旧新両reservation成功後だけUser更新し、backfill・重複監査後にroute generationをCASする。

### Workers / Queues / R2

| 基盤 | 項目 | 値 |
| --- | --- | --- |
| Workers | Queue consumer / Cron の壁時計 | **15 分** |
| Workers | 同時に応答待ちにできる外部接続 | **6** |
| Workers | subrequest | 10,000 / invocation |
| Workers | memory | 128 MB |
| Queues | message | 128 KB |
| Queues | batch | 100 messages |
| Queues | concurrent consumers | 250 |
| Queues | retention | 最大 14 日 |
| R2 | object | 単一 PUT 5 GiB / multipart 4.995 TiB |
| R2 | 同一 key の並行 write | 1 秒あたり 1 回 |

## 行サイズの予算

D1 と scope DO のどちらも **1 行 2,000,000 バイト**である。[ADR 017](../adr/017-content-size-budget.md) の contentless FTS と本文上限を維持する。

| 表 | plane | 可変長列の内訳 | 合計 |
| --- | --- | --- | --- |
| `notes` | scope | `content_html` 800,000 + `content_text` 800,000 + `content_headings` 96,000 + その他 | < 1,700,000 |
| `note_search` | scope | `text` 800,000 + tags 20,200 + excerpt / title + その他 | < 824,000 |
| `public_note_search` | global | `text` 800,000 + tags 20,200 + excerpt / title + その他 | < 824,000 |
| `note_revisions` | scope | `html` 800,000 + title + その他 | < 802,000 |
| `jobs` | scope | payload / notices / failure detail | < 64,000 |

大きな値は SQL へ埋め込まず bound value として渡す。ID 配列は JSON 1 value + `json_each` で展開し、100 parameters を超えない。

## 実行予算と分割単位

### Global D1

1 Worker invocation が発行してよい D1 query は **500** を設計上限とする。実上限 1,000 の半分を、session / route 解決、ページング、実装差分の余裕として残す。この予算が掛かるのは Identity、directory / route operation、global projection / rebuild だけである。

public projection の 1 note 再投影は最大10 query（route 1 + note / author / workspace / tagの解決4 + `replaceSnapshotIfNewer` のatomic batch最大5）を上限見積もりとする。`events-public-projection` は `max_batch_size: 20` とし、20 × 10 = 200 に抑える。

1 batchが異なるscopeを含む場合もRPCは同時6本までとする。public D1書き込みはroute・Note/tag・author・workspaceの世代ベクトル条件付きbatchにまとめる。

### Scope DO

scope-local SQL に D1 の query count は掛からない。ただし CPU、Alarm / Queue の15分、1回に生成する event 数、障害時の再試行量を制限するため、次を維持する。

| 経路 | 1 回の上限 | 根拠 |
| --- | --- | --- |
| `emptyTrash` の同期削除 | **50 notes** | HTTP mutation の CPU と response latency |
| owner / workspace cleanup | **100 rows** | 1 Alarm turn の CPU と outbox fan-out |
| 強制終端 / `reapExpiredJobs` | **100 jobs** | transition + recovery + event の fan-out |
| tag rename/delete/merge fan-out、unused delete | **200 assignments/tags** | revision bump・再投影task・監査payloadの上限 |
| expired artifact / orphan media | **100 files** | R2 delete event の生成量 |
| local projection rebuild | **100 notes** | 1 scheduled task の CPU と再開粒度 |

上限に達したら同じ scope の `scheduled_tasks` に continuation を保存し、Alarm を再設定する。対象が残っているのに進捗 0 なら continuation を増やさず、その task を failed にして運用イベントを global queue へ送る。対象 0 は正常終了である。

bulk operation の対象上限（500 notes）と bulk upload（100 files）は変えない。子 Job は個別 Queue message で実行する。

## Queue 構成

| Queue | 運ぶもの | max batch | concurrency |
| --- | --- | --- | --- |
| `jobs` | 外部 I/O を伴う scoped Job | **1** | 既定（〜250） |
| `global-events` | Identity / directory event、mail、R2 実体削除 | **1** | 既定 |
| `events-public-projection` | D1 public / global projection | **20** | **4**（D1 write latencyで調整） |
| `*-dlq` | retry exhausted | 10 | 既定 |

全 message は event / operation ID を持つ。Job message は `scope` と `jobId` を必ず持つ。scope object の outbox relay は送信成功後に row を完了するため、送信後・完了前の停止は重複になる。consumer は冪等に処理する。

private projection と scope cleanup continuation は Queue へ出さず、scope object の local task と Alarm で直列に処理する。public projection はroute・Note/tag・author・workspaceの世代ベクトル条件付き書き込みで競合を吸収するため、サービス全体の単一consumerにはしない。初期並行度4とし、D1 write latency / overloaded errorを見て下げるか、物理shardへ移す。

全scope通常writeは共通admissionを通る。workspace scopeはWorkspace deletion state、personal scopeは`accountDeletionBarrier`を同じDOで検査する。personal barrier commandのcommit後はcleanup owner token以外を`ACCOUNT_DELETING`で拒否し、進行中receiptはpruneしない。全local cleanup ack後にcompletedへ縮約して120日保持する。

## Alarm と Cron

### Scope Alarm

各 scope object は `scheduled_tasks(due_at, priority, kind, payload, attempts)` を持つ。outbox relay、job lease reaping、private projection、cleanup continuation、expired metadata collection の最小 `due_at` を `setAlarm()` する。

Alarm handler は次を守る。

1. priority 0（membership/account security cleanup・lease reaping）、1（outbox）、2（projection）、3（期限回収）の順を基本に、1 turnで各priorityへ最低1枠を確保するweighted round-robinで処理する。同priorityはdueAt順とする
2. 同じ operation ID の再実行を安全にする
3. 失敗 task は backoff して再予定し、上限超過を `global-events` へ通知する
4. 最後に次の最小 `due_at` を Alarm へ設定する。task がなければ Alarm を消す

1 turnは合計100行またはCPU 2秒でyieldする。priority 0の最古task ageは1分、outboxは5分、projectionは15分をSLOとし、超過はglobal運用eventへ送る。低priority taskが継続的に補充されてもsecurity cleanupとlease reapingを飢餓させない。

### Global Cron

| 役割 | cron | 対象 |
| --- | --- | --- |
| auth state cleanup | `15 * * * *` | D1 sessions / auth tokens / login attempts / OAuth states |
| Job tombstone cleanup | `45 * * * *` | D1 job history removal tombstone（30日）/ target route tombstone（120日） |
| reservation / operation recovery | `*/5 * * * *` | Identity uniqueness・pending membership・slug・invitation・Note create/move/purge・Job slot・account deletion・integration disconnect |
| public projection reconciliation | `30 3 * * *` | `purging` / tombstone route とD1 orphan rows（bounded keyset） |

Cron は scope object を全列挙しない。scope-local cleanup は必ず Alarm で起動する。

global recoveryはshard/operation kindごとに `next_attempt_at, id` のキーセットでclaimし、1 invocation最大100 operationsまたは400 queriesでyieldする。claim leaseは10分、同じoperation IDの重複Cronはlease中no-op、残件はQueue continuationへ渡す。kindごとに最低10件枠を確保し、特定kindの滞留で他を飢餓させない。account deletionの`rollingBack`はrelease未ack itemを100件page・最大6接続で再配送し、terminal manifestは120日後に`(expiresAt, operationId)` keysetで100件ずつ回収する。personal barrierのterminal receiptはglobal scanせず、完了時に登録したscope Alarm taskが期限後100件ずつ回収する。

auth state / Job tombstone / account terminal manifest cleanupはglobal maintenance run storeにhour bucket+kind+generation集合由来の決定的run ID候補、10分lease、generation/shardごとのclaim/ackを保存する。kindごとのrunning runは1つだけで、前hourのrunが未完了なら次hourのCronもその最古runを固定`asOf`のまま再開し、完了後だけ新runを作る。初回Cron/lease recoveryは未claim shardから最大6 commandを起動し、各laneは1 shard・1 tableのkeysetを最大100行だけ進める。target shardのDELETEとrouting catalogの進捗更新はtransactionを共有しない。DELETE成功後にcatalog上のtable/cursor/command keyと次Queue outboxだけを原子的にcheckpointし、応答喪失時は同じ入力cursorから冪等にDELETEを再実行する。table/shard完了時にackと次の未claim shard取得を原子的に行い、kind全体のactive laneを6以下に保つ。reshard中は旧新generationを別positionで処理し、全position ackでcompleted、同じkindのCron再入はlease中no-opにする。completed runはcommand replay/監査用に30日保持する。3種のCronはいずれも共通prunerの初回taskを発行し、`pruneExpiredAuthState`の`global.maintenanceRunPruneContinued`分岐だけが`(expiresAt, runId)` keysetで100件ずつ回収する。running runは対象外である。削除済みworkspaceのscope-local manifest/header回収はここへ混ぜず、保持中scope objectのAlarmとmaintenance allowlistで進める。

## 外部要求

- external `fetch` は同時 **6** connections を超えない
- `runBulkExport` は R2 から読みながら ZIP を R2 へ stream し、128 MB memory に全件を載せない
- Queue consumer の wall time 15 分が job lease の最短期間を決める
- DO transaction / `blockConcurrencyWhile` の中で external I/O を待たない。外部処理は Queue worker、確定だけを scope RPC で行う

## 転送境界

| 決めること | 値 |
| --- | --- |
| client key | `CF-Connecting-IP` |
| 粗い rate limit | Workers Rate Limiting binding / 60秒窓 |
| 正確な Identity lock | global D1 の原子的な SQL |
| scope coordination | scope DO transaction |
| signed download URL | **5 分** |

download URL は発行前に scope object で Job / StoredFile の access principal と現在の membership を確認する。既存 artifact の再利用下限 `expiresAt >= now + 35分` は ExportTicket 30分 + URL 5分から導く。

## 関連文書

- [Scope sharded data plane ADR](../adr/021-scope-sharded-data-plane.md)
- [ADR 012. Job execution resilience](../adr/012-job-execution-resilience.md)
- [ADR 017. Content size budget](../adr/017-content-size-budget.md)
- [Database design](../database/index.md)
