# 021. 業務データを scope 単位の Durable Object に分割し、D1 をグローバル制御面と公開投影に限定する

## ステータス

承認済み

## コンテキスト

現行設計は、Identity から Note / Job / Usage、公開全文検索までを 1 つの D1 に置く。単一トランザクションでドメインをまたぐ後始末を束ねられ、全文検索と全体横断の問い合わせも素直に書ける一方、書き込み処理と 10 GB の容量上限を全利用者で共有する。D1 の read replication は読み取りを分散できるが、書き込みは 1 つの primary に集まる。

業務データの大半は `user` または `workspace` の所有 scope を持ち、一覧・タグ・クォータ・ジョブの選択述語も scope で閉じている。ここを水平分割すれば、通常の読み書きと非同期処理を scope 数に比例して拡張できる。一方、Durable Object の SQLite storage はオブジェクトごとに私有され、別オブジェクトを JOIN したり、複数オブジェクトと D1 を 1 トランザクションに束ねたりできない。公開全文検索、グローバルな一意性、個人と workspace 間のノート移動、利用者削除は別の整合性設計を要する。

## 決定

### データ面を scope Durable Object に分割する

`ScopeKey` を次の判別ユニオンとする。

```ts
type ScopeKey =
  | Readonly<{ type: "user"; userId: UserId }>
  | Readonly<{ type: "workspace"; workspaceId: WorkspaceId }>;
```

正規化した `user:{userId}` / `workspace:{workspaceId}` を名前として `ScopeObject` の Durable Object ID を決定的に得る。1 scope は常に 1 つの SQLite-backed Durable Object に対応し、次を同じ SQLite database に置く。

- 共通: Note / NoteRevision、Tag / TagAssignment、StoredFile metadata、reference import record、BackupRecord、Job、Usage、scope 内の読み取りモデル、outbox、processed event、scheduled task
- user scope: 個人所有データ
- workspace scope: Workspace、Membership、Invitation と workspace 所有データ

scope 内のコマンドは `ScopeUnitOfWorkProvider.run(scope, fn)` で同じ Durable Object に送る。コールバックが触れられる repository は渡した `scope` に属するものだけで、別 scope や D1 を入れ子にしない。membership の変更、対象 scope のジョブ終端、`processing` のノートの回復、生成物 metadata の回収は workspace object 内の 1 トランザクションに束ねる。

R2 のオブジェクト本体は従来どおりトランザクション外であり、scope 内の metadata を先に更新して outbox から実体を回収する。

### D1 をグローバル制御面と公開読み取り面に限定する

D1 には次だけを置く。

- Identity: users、identities、sessions、auth tokens、login attempts、external connections、OAuth flow states
- directory / reservation: email・provider identity・handleのkey-sharded reservation、workspace slug reservation、invitation route、userとworkspaceのmembership directory、利用者単位のcross-scope Job slot
- routing: `note_routes` と移動 Saga の状態。Job は scope を含む ID で経路を決めるため route 表を持たない
- global projection: 利用者の workspace 一覧、利用者横断の job history、公開 profile / workspace、公開ノート検索・FTS・サイトマップ
- global outbox / processed events

この D1 は論理的な global plane である。物理分割時もtransaction groupを守り、NoteId hash shardにはroute・note operation・public projectionをco-locateする。job historyはrequestedBy hash、Identity正データはUserId hash、uniqueness reservationはnormalized key hash、workspace directoryはWorkspaceId hashで分ける。公開検索、公開workspace一覧、Note routeのcreatedBy/scope二次キー走査は最大32 shard・同時6接続・全体200件の署名cursorでshard別keysetを持ち、bounded mergeする。Job family削除はscope-local manifestへroot/最大500子のrequestedBy/targetを100件ずつ固定し、manifest参照eventからrequestedBy history shardとtarget hash reverse indexを100件pageで回収する。workspace削除もscope-local manifestへuserId/tokenHashを固定してから正データを消し、global shard scanを避ける。

private なノート一覧・検索・カレンダー・タグ絞り込みは scope object 内の読み取りモデルを使う。D1 の `public_note_search` には `public` かつ `active` の行だけを投影する。global projection は正データではなく、scope event を少なくとも 1 回受けて現在の route と状態を読み直す冪等な購読者である。

### directory の安全側を定める

membership directory は単なる遅延投影ではなく、利用者削除と membership 作成を調停する command-side record とする。

1. membership 作成は D1 で `pending` edge を予約する。同じトランザクションで user が `active` であることを確認する
2. workspace object で membership を作る
3. D1 edge を `active` にする

再試行は同じ operation ID で冪等に行う。`pending` も workspace 数の上限と利用者削除の対象に含める。削除は逆順で、workspace object 内で membership と権限依存ジョブを先に終端し、その確認後に D1 edge を消す。障害で edge だけ残るのは過剰列挙であり、権限を過剰に与える状態ではない。

workspace slug / invitation token はD1のreservation / routeを先に確保し、scope objectの更新後に確定する。email / provider identity / handleもnormalized key shardでreserveし、UserId shard更新後にactivateする。利用者単位で一括エクスポートを1件に制限するJob slotもD1で予約し、scope-local Job commit後にScopedJobIdへ結び付ける。期限切れのreservation / slotはoperation IDと期限を使って回収する。

### 安定した NoteId を D1 route で解決する

`note_routes` は `noteId` ごとに `scope`、単調増加する `routeVersion`、`state`、operation ID を持つ。Note作成時は `reserved` routeを先に確保し、scope-local commit後に `active` にする。通常の取得は `active` routeを、移動中の読み取りは切替前の source を指す `moving` routeを解決してscope objectを呼び、呼び出しには `routeVersion` を添える。完全削除は先に `purging` にして到達を閉じ、local削除とpublic removeのack後に`tombstone`へ進める。`reserved` / `purging` / `tombstone` は外部取得に使わない。scope object は古い route version の mutation を拒否し、呼び出し側は primary route を 1 回だけ引き直す。

個人・workspace 間の `moveNote` は次の再開可能な Saga とする。

1. source object で note を `moving` に凍結し、対象 note を変更する実行中 job を終端して、revision・tag assignment・file metadata・backup record を含む snapshot を作る
2. target object に同じ `migrationId` で snapshot を staged import する。再適用は同じ結果を返す
3. target を `routeVersion + 1` の受け入れ準備済みにする
4. D1 の active route を source から target へ compare-and-swap する。利用者から見える切替点はこの 1 文だけである
5. target を有効化し、source を tombstone にする。どちらも alarm から再開できる

切替前の読み取りは source、切替後は target だけへ向かう。source は凍結後の mutation を受け付けず、target は新しい route version を伴わない要求を受け付けないため、二重更新は起きない。route は完全削除後も tombstone として 30 日保持し、遅延イベントが古い scope の公開投影を復活させるのを防ぐ。

### 利用者削除を orchestration にする

利用者削除は単一 UoW ではなく、D1 と複数 scope object をまたぐ再開可能な operation とする。

1. D1 で user を `deleting` にし、session / auth token を無効化する。同じトランザクションで新しい membership reservation と新しい job request を拒否する
2. membership directory の `pending` / `active` / `removing` edge と personal scope を削除対象として固定する
3. destructive cleanup前に全active workspace objectでmembership deletion lockをprepareし、owner数とMembership versionを同じlocal transactionで検査する。1件でも失敗したら全lockをreleaseしてuserをactiveへ戻す
4. 全prepare ack後だけcommitし、各workspaceでactive jobの終端、Job/BackupRecordの削除、membership削除を行う。離脱時もdirectory edgeはこのresidue cleanupのackまで`removing`で保持する
5. personal scope の active job と所有データを同様に終端・削除する
6. 全 scope の確認を D1 に記録し、未確認 edge が 0 になったら user を `deleted` にして Identity データを回収する

外部 I/O を行う job worker は開始時だけでなく、結果を scope object に確定するときにも Job の lease と終端状態を検査する。削除 command が先に処理されていれば確定は拒否される。生成物の download は毎回 scope object で access principal と membership を確認してから短命 URL を発行するため、directory の掃除が遅れても権限を失った利用者へデータを渡さない。

### Queue と alarm の役割を分ける

Queues は外部 I/O を伴う job の並行実行、global D1 projection、メール、R2 実体削除に使い続ける。job message は `scope` と `jobId` を必ず持つ。Queue は少なくとも 1 回配送なので、Job の lease・attempt・reaper は維持する。

各 scope object は `scheduled_tasks` に outbox relay、lease reaping、継続要求、期限切れ metadata の回収予定を保存し、最も早い時刻に 1 つの alarm を設定する。alarm handler は期限到来分を上限件数だけ処理し、残りがあれば次の alarm を設定する。Queue 送信後・送信済み記録前の停止は重複配送になり、event ID / operation ID で吸収する。

global D1 の outbox は従来どおり relay worker と Queue で配送する。全 scope object を列挙する cron は設けない。

### 上限と予算を保存先ごとに適用する

D1 と SQLite-backed Durable Objects に共通する 1 行 2 MB、1 bound value 2 MB、100 parameters、SQL statement 100 KB の制約は維持する。したがって本文上限と contentless FTS の判断は変えない。

D1 の 1 Worker invocation あたり 1,000 query、設計予算 500 は global plane を触る実行だけに適用する。scope-local operation の分割単位は、DO の CPU、alarm / Queue の壁時計、1 回に生成する event 数、R2 / 外部接続数から決める。既存の 100 件上限は、強制終端・回収・継続の最大作業量として維持するが、根拠を D1 query 数から 1 回の CPU と event fan-out の上限へ変更する。

## 検討した代替案

### 単一 D1 を維持する

global query と transaction は最も単純で、read replication により読み取りも伸ばせる。しかし全 scope の書き込みと 10 GB を 1 database が共有し、Queue の並行度を上げても primary が直列化点として残る。今回の目的である scope 数に比例した書き込み・容量の拡張を満たさない。

### すべてを 1 つの Durable Object に置く

D1 の query budget と network round trip は減るが、単一 object の CPU・request queue・10 GB を全利用者で共有し、read replica も使えない。単一 D1 より水平拡張しにくいため不採用。

### Durable Objects だけに統一する

scope-local data は自然に分割できる。しかし公開全文検索、サイトマップ、email / handle / slug の一意性、membership の利用者横断列挙を実現するには、singleton index object または多数 object への fan-out が必要になる。製品名は 1 つでも論理 store と routing が増え、global query の拡張性も低いため不採用。

### D1 database を scope ごとに作る

データ分割と SQL は得られるが、scope の動的な作成・binding / routing・migration 運用が要る。scope-local command の直列化、alarm、RPC を同じ単位で持てる Durable Object のほうが今回の data plane に適する。global D1 は D1 自身の read replication と運用 API の利点が大きいため残す。

### scope を Note 単位にする

hot workspace 内も分散できるが、タグ、一覧、クォータ、強制終端、bulk operation が多数 object の fan-out になる。現在の主要な不変条件と問い合わせは owner scope で閉じるため、粒度が細かすぎる。

## 影響

- `spec/adr/015-cloudflare-runtime.md` の「D1 を主データベースとし DO を採らない」を supersede する
- `spec/adr/016-projection-single-writer.md` の単一 D1 全投影を前提とする決定を supersede し、scope-local projection と global public projection に分ける
- `spec/adr/018-query-budget.md` の予算適用範囲を global D1 に限定する
- `spec/adr/019-owner-cleanup-continuation.md` の scope-local 継続を Queue から local outbox + alarm に移す
- `spec/adr/020-coordination-state.md` の「すべて D1」を supersede し、調整対象と正データの scope に置く
- ADR 012 の lease / reaper は Queue を残すため維持する。reaper の起動主体だけを global cron から scope alarm に変える
- ADR 017 の本文サイズ予算は DO SQL にも同じ硬い上限があるため維持する
- private search はscopeごとに水平分割される。global planeは50/60/70%の段階的actionを持ち、note transaction groupはNoteId hash、job historyはrequestedBy hash、membershipはUserId hash、uniqueness keyはnormalized value hashへdual-write/backfillして切り替える
- 1つの巨大workspaceは1objectの上限を超えて水平分割できない。この版ではforeground優先、scope Job admission lease同時4、Alarm予算、Retry-Afterとscope容量50/60/70% actionで保護する
