# データベース設計

対象は Cloudflare の **global D1** と、user / workspace ごとの **SQLite-backed Durable Object storage** である（[scope sharded data plane ADR](../adr/021-scope-sharded-data-plane.md)）。両者の SQL schema は同じ migration version を共有するが、配置する表は異なる。FTS5 仮想表と関連 raw SQL は Drizzle schema 外の手書き migration で管理する。

D1 / DO の実上限、routing、Queue / Alarm の役割は [platform/index.md](../platform/index.md) を正典とする。本書は論理表・物理配置・索引を定める。

## 共通の規約

- **ID**: すべて `text` の主キー。値は `IdGenerator` が採番する（UUIDv7 想定）
- **時刻**: `integer` に UNIX ミリ秒で格納する（Drizzle の `mode: "timestamp_ms"`）
- **真偽値**: `integer` の 0 / 1
- **列挙**: `text` に `CHECK` 制約を添える。判別ユニオンは判別子の列と、その値のときだけ非 NULL になる列の組で表す
- **楽観ロック**: 集約ルートのテーブルは `version integer NOT NULL DEFAULT 0` を持つ。更新は `WHERE version = :expected` で行い、0 行なら `ConflictError("OPTIMISTIC_LOCK_FAILURE")`
- **外部キー**: 同じ database / domain の親子は原則`ON DELETE CASCADE`。ただし1親に無制限の子を持ち、削除をbounded continuationにするWorkspace→Membership/InvitationとJob parent→childrenは`RESTRICT`で子を先に消す。別 plane / domain の参照には張らない
- **削除**: ノートのゴミ箱以外に論理削除は使わない
- **正規化**: 書き込みモデルは第 3 正規形。非正規化は読み取りモデル（`note_search`）だけに閉じる（[ADR 009](../adr/009-read-models.md)）
- **行サイズ**: 1 行は 2,000,000 バイトを超えられない。可変長列を複数持つ表は、**それらの上限の合計が 2,000,000 バイトを下回ることを設計として示せること**（[ADR 017](../adr/017-content-size-budget.md)）。内訳は [platform/index.md](../platform/index.md) の「行サイズの予算」。大きな値は必ずバインド変数として渡す（SQL 文へ埋め込むと文の長さの上限 100,000 バイトに触れる）
- **バインド変数**: 1 クエリのバインド変数は 100 まで。**ID の並びで引く / 消す / 入れるクエリは `?` を件数ぶん並べない**。JSON 配列を 1 つのバインド変数として渡し、`json_each` で展開する。多行 INSERT も同じ形で 1 文にまとめる
- **原子性**: global D1 の非集約更新は単一 SQL 文、scope 内の複数更新は `transactionSync` で行う。D1 と scope DO、または2つの scope DOを1 transactionに含めない
- **scope 検証**: scope table の `owner_type / owner_id` または `scope_type / scope_id` は object 自身の ScopeKey と一致しなければならない。adapter が復元・保存の両方で検査する

## 物理配置

| plane | テーブル |
| --- | --- |
| global D1: Identity | `users`, `identities`, `identity_removal_receipts`, `sessions`, `auth_tokens`, `login_attempts`, `external_connections`, `oauth_flow_states` |
| global D1: directory / operation | `identity_unique_reservations`, `membership_directory`, `workspace_slug_reservations`, `invitation_routes`, `note_routes`, `distributed_operations`, `account_deletion_manifests`, `global_maintenance_runs`, `job_slots` |
| global D1: projection | `workspace_directory`, `job_history`, `job_history_removal_tombstones`, `job_history_target_routes`, `job_target_tombstones`, `public_note_search`, `public_note_search_tags`, `public_note_search_fts` |
| global D1: infrastructure | `outbox_events`, `processed_events`, `_occ_guard` |
| scope DO: Workspace | `workspaces`, `memberships`, `invitations`, `membership_removal_locks`, `workspace_deletion_manifests`（workspace scope のみ） |
| scope DO: business | `stored_files`, `reference_import_attempts`, `reference_import_summaries`, `notes`, `note_projection_revisions`, `note_revisions`, `tags`, `tag_assignments`, `backup_records`, `jobs`, `storage_quotas`, `llm_usages` |
| scope DO: local projection | `note_search`, `note_search_tags`, `note_search_fts` |
| scope DO: infrastructure | `outbox_events`, `processed_events`, `_occ_guard`, `scheduled_tasks`, `tag_operations`, `tag_operation_locks`, `job_removal_manifests`, `scope_job_admission_leases`, `move_authorization_locks`, `applied_operations` |

`processed_events` の主キーは global / scope とも (`consumer`, `event_id`) とする。`scheduled_tasks` は (`kind`, `operation_id`) を一意にし、`due_at` 索引で次の Alarm を決める。`applied_operations` は note move・membership command・account deletion の operation ID を scope ごとに重複排除する（`AppliedOperationStore.markApplied` の `(operationId, commandKey)`。列は 2 つに分けず 1 つへ畳む — 下記 `applied_operations`）。同じ表が account deletion の barrier receipt も持つが、そちらは `ScopeCleanupAdmissionStore` の担当で、**鍵の意味でポートを分ける**（[ADR 045](../adr/045-idempotency-by-commutativity.md)）。

`scheduled_tasks.operation_id`とpublic projection outbox event IDは必ず生成元の安定IDから決定的に導出し、保存時に乱数を採番しない。1つのoperationがNoteごとのtaskを積む場合は `sha256(producerKind + ":" + producerOperationId + ":" + plane + ":" + noteId + ":" + projectionRevision)` を用いる。tag delete/mergeはtag operation ID、tag renameはevent ID、rebuild/author/workspace fan-outはそれぞれの開始operation/command IDを`producerOperationId`とする。continuationは生成元IDとcursorを材料にする。このためtransactionの応答喪失後に同じpageを再実行しても同じPK/outbox IDへupsertされ、別Noteのtaskを1件へ潰さず、重複taskも増やさない。

global の outbox / processed event は既存 relay / pruner、scope の outbox / processed event / applied operation は local Alarm task が回収する。operation record は参照先の route tombstone より先に消さない。

## Global D1 の制御表

### identity_unique_reservations

email、handle、provider accountのglobal uniquenessとlookupを、normalized value hashで選ぶshard上に保持する。

| カラム | 型 | 制約 |
| --- | --- | --- |
| `kind` | text | PK part, CHECK IN ('email','handle','providerAccount') |
| `normalized_key` | text | PK part |
| `user_id` | text | NOT NULL |
| `operation_id` | text | NOT NULL, UNIQUE |
| `state` | text | NOT NULL, CHECK IN ('reserved','active','releasing') |
| `expires_at` | integer | reserved時NOT NULL |
| `updated_at` | integer | NOT NULL |

同じnormalized valueは必ず同じshardへ到達する。変更はreservationを先に確保し、UserId shardの正データ更新後にactivateする。1つの親operationがemail/providerAccountなど複数rowを予約するときは `` `${parentOperationId}:${kind}:${normalizedKey}` `` をrowごとのsub-operation IDにし、`operation_id UNIQUE`へ抵触させない。`kind`は`:`を含まない閉じた列挙で自由形の鍵が末尾に来るので、合成で決定性と識別性が得られる。不可逆性は要らない（[ADR 048](../adr/048-uniqueness-reservation-operation-id.md)）。結果には生の鍵がそのまま埋まるので、ログや他のsinkへは出さない（出すなら`{ parentOperationId, kind }`）。失敗時は確保済みsub-operationを全release、応答喪失はoperation payloadの全keyと現在のUser/Identity versionを確認してall-activateまたはall-releaseへ再開する。lookupはactive reservationからUserIdを得てUser shardを読む。

### membership_directory

| カラム | 型 | 制約 |
| --- | --- | --- |
| `operation_id` | text | PK |
| `user_id` | text | NOT NULL |
| `workspace_id` | text | NOT NULL |
| `membership_id` | text | NOT NULL |
| `role` | text | NOT NULL |
| `state` | text | NOT NULL, CHECK IN ('pending','activating','active','removing') |
| `deletion_prepare_operation_id` | text | NULL可。pending edgeのaccount deletion lock owner |
| `deletion_prepare_expires_at` | integer | prepare ownerがあるときNOT NULL |
| `reservation_expires_at` | integer | pending/activatingではNOT NULL、active/removingではNULL |
| `created_at` | integer | NOT NULL |
| `updated_at` | integer | NOT NULL |

- UNIQUE (`user_id`, `workspace_id`)。`pending` / `activating` は所有 / 参加workspace数とaccount deletionに、`removing`は後始末完了待ちのaccount deletion / integration cleanup列挙に含める。`reserveAndClaimActivation`はpending INSERT、同じUserId shardのActive User検査、`activating`化を1 transactionで行い、DeletingならINSERTごとrollbackする。account deletionは先行`activating`を最大100件ずつ解決待ちし、0件確認後にpending edgeへdeletion prepare ownerを設定する。owner設定後のactivationは拒否し、rollback releaseはpendingを保ち、commitだけがedgeを取消す
- indexes: (`user_id`, `state`, `created_at` DESC, `workspace_id`) は文脈一覧のkeyset、(`workspace_id`, `state`, `user_id`) は論理単一DB/移行監査用。UserId物理shard後のworkspace削除は後者をscatterせずmanifest route keyを使う
- pending/activating recoveryは`(reservation_expires_at, operation_id) WHERE state IN ('pending','activating')`を最大100件ずつ読む。期限切れactivatingはworkspace scopeのInvitation/Membershipをoperation IDで照合し、local commit済みならactive、未commitならabandonedへ収束させる。account deletionはこのrecoveryを起動し、先行activatingが0件になるまでscanを待つ

### workspace_slug_reservations

email / provider identity / handle は `identity_unique_reservations` を使う。scope-local Workspaceだけが保持するslugはこの表でglobal uniquenessを予約する。invitation tokenは `invitation_routes` 自身の主キーで予約する。

| カラム | 型 | 制約 |
| --- | --- | --- |
| `normalized_slug` | text | PK |
| `workspace_id` | text | NOT NULL |
| `operation_id` | text | NOT NULL |
| `state` | text | NOT NULL, CHECK IN ('reserved','active','releasing') |
| `expires_at` | integer | `state = 'reserved'` のとき NOT NULL |

同じ operation ID または同じworkspaceの現在slugだけが既存reservationを再利用できる。

### note_routes

| カラム | 型 | 制約 |
| --- | --- | --- |
| `note_id` | text | PK |
| `scope_type` | text | NOT NULL |
| `scope_id` | text | NOT NULL |
| `created_by` | text | NOT NULL（Note作成者。move後も不変） |
| `route_version` | integer | NOT NULL, CHECK `route_version >= 0` |
| `state` | text | NOT NULL, CHECK IN ('reserved','active','moving','purging','tombstone') |
| `target_scope_type` | text | `state = 'moving'` のとき NOT NULL |
| `target_scope_id` | text | `state = 'moving'` のとき NOT NULL |
| `operation_id` | text | `state IN ('reserved','moving','purging')` のとき NOT NULL |
| `updated_at` | integer | NOT NULL |
| `reservation_expires_at` | integer | `state = 'reserved'` のとき NOT NULL |
| `tombstone_expires_at` | integer | `state = 'tombstone'` のとき NOT NULL |

create は `reserved` でrouteを確保し、scope-local commit後にoperation ID条件で `active` にする。route switch は `WHERE note_id = ? AND route_version = ? AND scope_type = ? AND scope_id = ?` の compare-and-swap 1文で行う。完全削除は同じ条件で `purging` にして外部到達を閉じ、scope削除とpublic projection removeの完了後に30日保持の`tombstone`へ進める。

indexes: (`created_by`, `state`, `note_id`) はmembership離脱後も残る著者表示refresh、(`scope_type`, `scope_id`, `state`, `note_id`) はworkspace表示refreshに使う。物理shard後は各shardの同索引を`NoteRouteFanOutReader`がscatter-gatherし、最大32 shard・同時6接続・全体200件へmergeする。署名cursorはgenerationと各shardのkeysetを保持し、reshard中は旧新をNoteId/routeVersionで重複排除する。`created_by` はroute予約時に固定し、Note moveでは変えない。

### invitation_routes

招待token hashからworkspace scopeを解決する。Invitationの正データはworkspace DOにあり、この表は入口と失効時刻だけを持つ。

| カラム | 型 | 制約 |
| --- | --- | --- |
| `token_hash` | text | PK |
| `workspace_id` | text | NOT NULL |
| `invitation_id` | text | NOT NULL |
| `operation_id` | text | NOT NULL |
| `state` | text | NOT NULL, CHECK IN ('reserved','active','revoked') |
| `expires_at` | integer | NOT NULL |
| `updated_at` | integer | NOT NULL |

token発行時はglobal reservationを先に作り、scope-local Invitation commit後にactiveにする。preview / acceptはactive routeだけを解決し、期限切れまたはrevokedはnot foundとして扱う。

### distributed_operations

| カラム | 型 | 制約 |
| --- | --- | --- |
| `id` | text | PK |
| `kind` | text | NOT NULL, CHECK IN ('noteMove','notePurge','workspaceDeletion','accountDeletion','membershipChange','nameChange','integrationDisconnect') |
| `partition_key` | text | NOT NULL |
| `request_key` | text | accountDeletionのuserRequestではNOT NULL |
| `state` | text | NOT NULL, CHECK IN ('running','completed','rejected') |
| `payload` | text | NOT NULL（JSON） |
| `attempts` | integer | NOT NULL DEFAULT 0 |
| `next_attempt_at` | integer | NULL 可 |
| `created_at` | integer | NOT NULL |
| `updated_at` | integer | NOT NULL |
| `expires_at` | integer | terminal accountDeletionではNOT NULL、runningはNULL |

`next_attempt_at` の partial index（非 NULL）を recovery Cron が使う。payload は状態機械の入力を固定し、再開時に利用者入力を読み直さない。

accountDeletionは`UNIQUE(partition_key, request_key)`で同じ送信を再生し、`UNIQUE(partition_key) WHERE kind = 'accountDeletion' AND state NOT IN ('completed','rejected')`でrunning operationを1件にする。rejected後は別request keyで新operationを許す。manifestをterminalへ移すtransactionでoperationにも同じ`expires_at = terminal_at + 120日`を設定し、account manifest prunerがheaderとoperationを同じUserId-shard transactionで削除する。completed Userはdeletedなので新operationを許可しない。build / dispatch の進み具合（`preparing` / `committing` など）はこの3値ではなく`account_deletion_manifests.state`が持つ。

物理分割時、noteMove/notePurgeの`partition_key = noteId`で、対応する`note_routes`とpublic projectionと同じnote coordination shardへ置く。workspaceDeletionはworkspaceIdをpartition keyとしてglobal tombstone/ackを持ち、route key正本はworkspace scopeのmanifestに残す。accountDeletion/nameChangeはUserId shard、membershipChangeはそのdirectoryの調停key、integrationDisconnectはUserId shardへ置く。1つのoperationが別shardの正データを直接transaction更新せず、既存のreserve/command/ack Sagaを使う。

### account_deletion_manifests

UserId shardに置く。headerは`operation_id` PK、`user_id`（非UNIQUE）、`request_key`、`state` (`buildingMemberships` / `preparing` / `rollingBack` / `buildingAuthorRoutes` / `committing` / `compacting` / `compactingRejected` / `completed` / `rejected`)、membership edge cursor、author route署名generation cursor、`redaction_version`、`completed_at`、`expires_at`を持つ。`UNIQUE(user_id, request_key)`で同じ要求を再生し、`UNIQUE(user_id) WHERE state NOT IN ('completed','rejected')`でrunning manifestを1件にする。terminal headerを保持中でも別request keyの新manifestを許すが、再要求のしきい値の計数はこの表ではなく`distributed_operations`側で行う。`DistributedOperationStore.countTerminalSince`が保持中のterminal行を数え、しきい値（8件）と窓（120日）の判定はドメインの`AccountDeletionRetryPolicy`が行う。**数えて → 判定して → はじめて作る**（作ってからロールバックしない）（[ADR 044](../adr/044-business-thresholds-in-domain.md)）。itemsは(`operation_id`, `kind`, `target_key`) PKとし、membership itemはworkspaceId・edge state・membershipId・prepare/release command key・dispatchedAt・ack・cleanup ack、authorRoute itemはNoteId・routeVersion・local/public redaction ackを持つ。

membership pageはheaderと同じUserId shardのactive/removing/pending edgeをkeyset最大100件appendし、author pageはroute readerから受けた最大100件を冪等appendする。headerはpersonal cleanup、auth residue、external connection、global Job history、uniqueness releaseのreceiptも持つ。各pageのitems/cursor/次の決定的continuation、各dispatch pageのack/次taskは同じUserId-shard transactionで保存する。operation payloadへitem配列を埋めない。remote送信前に最大100 itemへ決定的command keyと`dispatched_at`を保存する。prepare失敗時は`rollingBack`へ進め、prepare dispatched itemをack有無にかかわらずrelease pendingとして最大100件・6接続waveで配送する。未取得lockへのreleaseはno-op ack、取得済みlockは解除する。release dispatched/ackと次rollback taskを同じtransactionで保存し、personal abort ackを含む全release ack前は縮約しない。全required item ack/receipt後だけUser finalizeを許す。成功時は`compacting`、rollback完了時は`compactingRejected`へ進め、どちらもitemsを100件ずつcompactする。item 0件のtransactionだけがheaderを`completed`または`rejected`へ移し、`expires_at = terminal_at + 120日`を設定する。`(expires_at, operation_id) WHERE state IN ('completed','rejected')` indexから1command最大100件でterminal headerを回収し、running/building/compacting headerは対象外にする。

### global_maintenance_runs

global routing catalog shardに置く。`run_id` PK、`kind` (`authStatePrune` / `jobTombstonePrune` / `accountManifestPrune`)、`as_of`、generation集合、`state` (`running` / `completed`)、`lease_until`、`lease_owner`、generation/shardごとの`unclaimed | active | completed` position、table、keyset cursor、active command key、`completed_at`、`expires_at`を持つ。`UNIQUE(kind) WHERE state = 'running'`でkindごとの実行中runを1つに制限する。run ID候補はhour bucket+kind+generation集合から決定するが、同kindに未完了runがあれば新しいhourの候補を作らず、最古running runの固定`as_of`とpositionを返す。初回/lease recoveryは未claim positionを最大6件claimする。target shardのDELETE成功後、routing catalog shardで次table/cursor/command keyのcheckpointと次Queue outboxを同じtransactionに保存する。両shardを同じtransactionには入れず、応答喪失時は保存済み入力cursorからDELETEを再実行する。DELETEは期限述語/keysetに対して冪等である。shard完了ackと次position claimも同じtransactionで行い、kind全体のactiveは6以下、全position ackでcompletedにしてから次のCronが新runを作れるようにする。completed時に`expires_at = completed_at + 30日`を設定し、`(expires_at, run_id) WHERE state = 'completed'` indexを使って1command最大100件で回収する。running runは`expires_at = NULL`で回収しない。

### job_slots

利用者単位で scope をまたぐ同時実行制約だけを global D1 に置く。Job 本体と進捗は置かない。

| カラム | 型 | 制約 |
| --- | --- | --- |
| `user_id` | text | PK part |
| `kind` | text | PK part, CHECK IN ('bulkExport') |
| `operation_id` | text | NOT NULL, UNIQUE |
| `scoped_job_id` | text | NULL 可, UNIQUE |
| `expires_at` | integer | NOT NULL |
| `updated_at` | integer | NOT NULL |

主キーは (`user_id`, `kind`) とする。予約時は `scoped_job_id = NULL`、scope-local Job の commit 後に operation ID を条件として Job ID を結び付ける。終端 event で削除し、期限切れは recovery Cron が `scoped_job_id` の route と正データを確認してから回収する。

---

## Identity

### users

| カラム | 型 | 制約 |
| --- | --- | --- |
| `id` | text | PK |
| `email` | text | NULL 可（`deleted` では NULL） |
| `status` | text | NOT NULL, CHECK IN ('pending','active','deleting','deleted') |
| `verified_at` | integer | `status = 'active'` のとき NOT NULL |
| `display_name` | text | NULL 可（`deleted` では NULL） |
| `bio` | text | NULL 可, active時 DEFAULT '' |
| `avatar_url` | text | NULL 可 |
| `handle` | text | NULL 可 |
| `auth_epoch` | integer | NOT NULL DEFAULT 0, CHECK `auth_epoch >= 0` |
| `deletion_operation_id` | text | `status = 'deleting'` のとき NOT NULL |
| `deleted_at` | integer | `status = 'deleted'` のとき NOT NULL |
| `version` | integer | NOT NULL DEFAULT 0 |
| `created_at` | integer | NOT NULL |
| `updated_at` | integer | NOT NULL |

- `email` は正規化済み（小文字）の値を格納する
- `handle` も正規化済み（小文字）の値を格納する
- UserId shard内のUser/Identity/Session/AuthToken列は同じtransaction groupの正データであり、global uniqueness/lookupは `identity_unique_reservations` が担う。Session/AuthTokenのwire tokenはUserId locatorで直接このshardへrouteし、token全体のhash一致を検査する

**CHECK**: `pending` のみ `verified_at IS NULL`。`active` / `deleting` は検証済み時刻を保持する。`deleted` は `email` / profile / handle / verifiedAt / deletionOperationId がNULLで `deleted_at` だけを保持する。`deleting` 以降は新しい session・membership reservation・Job request を拒否する。

### identities

| カラム | 型 | 制約 |
| --- | --- | --- |
| `id` | text | PK |
| `user_id` | text | NOT NULL, FK → `users.id` ON DELETE CASCADE |
| `kind` | text | NOT NULL, CHECK IN ('password','oauth') |
| `password_hash` | text | `kind = 'password'` のとき NOT NULL |
| `provider` | text | `kind = 'oauth'` のとき NOT NULL, CHECK IN ('google') |
| `provider_account_id` | text | `kind = 'oauth'` のとき NOT NULL |
| `provider_email` | text | `kind = 'oauth'` のとき NOT NULL |
| `version` | integer | NOT NULL DEFAULT 0 |
| `created_at` | integer | NOT NULL |
| `updated_at` | integer | NOT NULL |

- **インデックス**: `identities_user_idx` (`user_id`)、`identities_user_password_uq` UNIQUE (`user_id`) WHERE `kind = 'password'`（1 利用者 1 件）。provider accountのglobal uniquenessはreservationが担う
- **件数上限**: Password/OAuth合計8件。UserId shardの最終UoWでcurrent件数を検査し、`BEFORE INSERT` triggerも同じ`user_id`が既に8件ならabortする。並行追加も同shard transactionで直列化され、`IdentityLimitExceeded`へ写像する

`identity_removal_receipts`はUserId shardに`identity_id` PK、`user_id`, `operation_id`, `provider_account_key`, `created_at`, `expires_at`を30日保持する。Identity削除とreceipt/outboxを同じtransactionで保存するため、応答喪失後の同一解除は成功を返せ、global consumerは削除済みrowを読まずprovider reservationを解放できる。
- **CHECK**: `kind` に応じた列の NULL / NOT NULL の対応

### sessions

| カラム | 型 | 制約 |
| --- | --- | --- |
| `id` | text | PK |
| `user_id` | text | NOT NULL, FK → `users.id` ON DELETE CASCADE |
| `token_hash` | text | NOT NULL, UNIQUE |
| `auth_epoch` | integer | NOT NULL |
| `created_at` | integer | NOT NULL |
| `expires_at` | integer | NOT NULL |

- 版を持たない。`expires_at` はサインイン時に `Session.ttlMs`（30 日）で確定して更新しない。例外的に`signOutOtherSessions` / `changePassword`が現在の1行の`auth_epoch`だけをUserの新世代へ条件付き更新する
- 認証は`users.auth_epoch = sessions.auth_epoch`を要求する。世代更新1行で大量sessionを即時失効し、物理削除はUserId/期限索引を使って1page最大100件で行う
- **インデックス**: `sessions_user_epoch_idx` (`user_id`, `auth_epoch`, `id`)、`sessions_expires_idx` (`expires_at`, `id`) — 旧世代/期限切れを100件ずつ削除する

### auth_tokens

| カラム | 型 | 制約 |
| --- | --- | --- |
| `id` | text | PK |
| `user_id` | text | NOT NULL, FK → `users.id` ON DELETE CASCADE |
| `purpose` | text | NOT NULL, CHECK IN ('email_verification','password_reset') |
| `token_hash` | text | NOT NULL, UNIQUE |
| `auth_epoch` | integer | NOT NULL |
| `status` | text | NOT NULL, CHECK IN ('pending','consumed') |
| `consumed_at` | integer | `status = 'consumed'` のとき NOT NULL |
| `created_at` | integer | NOT NULL |
| `expires_at` | integer | NOT NULL |

- **インデックス**: `auth_tokens_user_purpose_idx` (`user_id`, `purpose`)、`auth_tokens_user_epoch_idx` (`user_id`, `auth_epoch`, `id`)、`auth_tokens_expires_idx` (`expires_at`, `id`)
- pending tokenは(`user_id`, `purpose`)で部分UNIQUEとし最大1件。消費時はcurrent `users.auth_epoch`との一致も同じUserId shard transactionで検査する。旧世代/期限切れ行は1page最大100件で回収する

### login_attempts

| カラム | 型 | 制約 |
| --- | --- | --- |
| `key` | text | PK（`LoginAttemptKey` が組み立てる `{namespace}:{subject}:{clientKey}`） |
| `failure_count` | integer | NOT NULL DEFAULT 0 |
| `last_failed_at` | integer | NULL 可 |
| `expires_at` | integer | NOT NULL |

- **インデックス**: `login_attempts_expires_idx` (`expires_at`, `key`) — 同一expiryを安定keysetで回収する
- **ロックの状態は列に持たない**。ロックは `failure_count` と `last_failed_at` から `LoginThrottlePolicy.evaluate` が導出する（[domains/identity.md](../domains/identity.md)）。保存しないのは、失敗回数の加算を単一の SQL 文にするためである — 書き込む値が読んだ値に依存していなければ「読んでから書く」形を避けられ、しきい値の規則を SQL に持ち込まずに済む
- 加算は次の 1 文で行う。返る値がそのまま `LoginAttemptStore.recordFailure` の戻り値になる

```sql
INSERT INTO login_attempts (key, failure_count, last_failed_at, expires_at)
VALUES (?1, 1, ?2, ?3)
ON CONFLICT(key) DO UPDATE SET
  failure_count = failure_count + 1,
  last_failed_at = excluded.last_failed_at,
  expires_at     = excluded.expires_at
RETURNING failure_count, last_failed_at;
```
- `key` は用途ごとに名前空間を分けた 2 系統を持つ（[domains/identity.md](../domains/identity.md) の `LoginAttemptKey`）。パスワードサインインは `signIn:{正規化済みメールアドレス}:{clientKey}`（`forSignIn`）、共有リンクのパスワード照合は `share:{共有トークンのハッシュ}:{clientKey}`（`forSharePassword`）。名前空間を先頭に置くのは、別種の照合の失敗が同じ行に集まって互いのロックを誘発するのを防ぐため。共有側の材料が素の共有トークンではなく `TokenHash` なのは、この列に共有の秘密を平文で残さないためである

---

## Workspace

### workspaces

| カラム | 型 | 制約 |
| --- | --- | --- |
| `id` | text | PK |
| `name` | text | NOT NULL |
| `description` | text | NOT NULL DEFAULT '' |
| `avatar_url` | text | NULL 可 |
| `slug` | text | NULL 可 |
| `publication` | text | NOT NULL, CHECK IN ('private','published') |
| `published_at` | integer | `publication = 'published'` のとき NOT NULL |
| `lifecycle` | text | NOT NULL, CHECK IN ('active','deleting') |
| `deletion_operation_id` | text | `lifecycle = 'deleting'` のとき NOT NULL, UNIQUE |
| `version` | integer | NOT NULL DEFAULT 0 |
| `created_at` | integer | NOT NULL |
| `updated_at` | integer | NOT NULL |

- **CHECK**: `publication = 'published'` なら `slug IS NOT NULL AND published_at IS NOT NULL`。`lifecycle = 'active'` なら `deletion_operation_id IS NULL`、`deleting` なら NOT NULL
- slug の global uniqueness と公開列挙は D1 `workspace_slug_reservations` / `workspace_directory` が担う。scope 内では現在値として保持する

### memberships

| カラム | 型 | 制約 |
| --- | --- | --- |
| `id` | text | PK |
| `workspace_id` | text | NOT NULL, FK → `workspaces.id` ON DELETE RESTRICT |
| `user_id` | text | NOT NULL |
| `role` | text | NOT NULL, CHECK IN ('owner','editor','viewer') |
| `version` | integer | NOT NULL DEFAULT 0 |
| `joined_at` | integer | NOT NULL |
| `updated_at` | integer | NOT NULL |

- `user_id` には外部キーを張らない（Identity は別ドメイン。利用者の削除はイベントで後始末する）
- **インデックス**: `memberships_workspace_user_uq` UNIQUE (`workspace_id`, `user_id`)、`memberships_user_idx` (`user_id`)、`memberships_workspace_role_idx` (`workspace_id`, `role`) — owner の員数確認用

### invitations

| カラム | 型 | 制約 |
| --- | --- | --- |
| `id` | text | PK |
| `workspace_id` | text | NOT NULL, FK → `workspaces.id` ON DELETE RESTRICT |
| `email` | text | NOT NULL |
| `role` | text | NOT NULL, CHECK IN ('owner','editor','viewer') |
| `invited_by` | text | NOT NULL |
| `token_hash` | text | NOT NULL |
| `status` | text | NOT NULL, CHECK IN ('pending','accepted','revoked') |
| `accepted_at` | integer | `status = 'accepted'` のとき NOT NULL |
| `accepted_by` | text | `status = 'accepted'` のとき NOT NULL |
| `revoked_at` | integer | `status = 'revoked'` のとき NOT NULL |
| `version` | integer | NOT NULL DEFAULT 0 |
| `created_at` | integer | NOT NULL |
| `expires_at` | integer | NOT NULL |

- **インデックス**: `invitations_pending_uq` UNIQUE (`workspace_id`, `email`) WHERE `status = 'pending'`、`invitations_workspace_created_idx` (`workspace_id`, `created_at` DESC)。token の global uniqueness / route は D1 `invitation_routes` が担う

---

## Storage

### stored_files

| カラム | 型 | 制約 |
| --- | --- | --- |
| `id` | text | PK |
| `owner_type` | text | NOT NULL, CHECK IN ('user','workspace') |
| `owner_id` | text | NOT NULL |
| `uploaded_by` | text | NULL 可 |
| `purpose` | text | NOT NULL, CHECK IN ('source','media','reference','artifact','avatar') |
| `note_id` | text | NULL 可 |
| `note_version` | integer | NULL 可 |
| `object_key` | text | NOT NULL, UNIQUE |
| `file_name` | text | NOT NULL |
| `mime_type` | text | NOT NULL |
| `size` | integer | NOT NULL, CHECK `size >= 0` |
| `checksum_algorithm` | text | NOT NULL, CHECK IN ('sha256') |
| `checksum_value` | text | NOT NULL |
| `retention` | text | NOT NULL, CHECK IN ('persistent','ephemeral') |
| `expires_at` | integer | `retention = 'ephemeral'` のとき NOT NULL |
| `version` | integer | NOT NULL DEFAULT 0 |
| `created_at` | integer | NOT NULL |
| `updated_at` | integer | NOT NULL |

`note_id` / `note_version` は [domains/storage.md](../domains/storage.md) の `FileProvenance` に対応する。`source` / `media` / `reference` はノートに従属するため `note_id` が必須（`note.purged` 後の回収・孤児判定・ノート移動時の付け替えの手がかり）。`artifact` は単一ノート由来の生成物（PDF エクスポート、一括ダウンロードの子）のときだけ `note_id` と生成元の版 `note_version` を持ち、一括ダウンロードの ZIP では両方 NULL。`avatar` はノートに属さない。`uploaded_by` が NULL になるのは匿名の閲覧者による PDF エクスポートの artifact のみ（[ADR 010](../adr/010-anonymous-export-and-ticket.md)）。

- **CHECK**:
  - `purpose IN ('source','media','reference')` なら `note_id IS NOT NULL`
  - `purpose = 'avatar'` なら `note_id IS NULL`
  - `purpose = 'artifact'` なら `note_id` と `note_version` は両方 NULL または両方 NOT NULL
  - `purpose != 'artifact'` なら `note_version IS NULL`
  - `uploaded_by IS NULL` なら `purpose = 'artifact'`
  - `purpose = 'artifact'` なら `retention = 'ephemeral'`
  - `retention = 'ephemeral'` なら `expires_at IS NOT NULL AND expires_at > created_at`
- **インデックス**: `stored_files_owner_idx` (`owner_type`, `owner_id`, `purpose`)、`stored_files_expires_idx` (`expires_at`) WHERE `retention = 'ephemeral'` — 期限切れの回収、`stored_files_purpose_created_idx` (`purpose`, `created_at`) — 孤児メディアの走査、`stored_files_note_idx` (`note_id`) WHERE `note_id IS NOT NULL` — `listByNote`（`note.purged` 後の回収・所有者付け替え）と `findArtifactByNoteAndVersion`（`note_id` + `note_version` + `purpose` + 期限内判定。1 ノートあたりの行数は少ないためインデックスは `note_id` のみで足りる）

`checksum_value` に索引は張らない。チェックサムによる重複保管の回避は行わず（`FileProvenance` が `note_id` を必須で持つため、同一内容でも 1 行を複数ノートで共有できない。[domains/storage.md](../domains/storage.md)）、値から行を引く経路が存在しないため。チェックサムは行を読んだあとの完全性の検証と、外部バックアップの同一判定（`backup_records.checksum_value` との比較）にだけ使う。

### reference_import_attempts

本文中の外部参照を取りにいった結果（[ADR 014](../adr/014-import-result-provenance.md)、[domains/storage.md](../domains/storage.md) の `ReferenceAttempt`）。

| カラム | 型 | 制約 |
| --- | --- | --- |
| `note_id` | text | NOT NULL |
| `url` | text | NOT NULL |
| `kind` | text | NOT NULL, CHECK IN ('resource','stylesheet') |
| `status` | text | NOT NULL, CHECK IN ('imported','inlined','failed','notAttempted') |
| `file_id` | text | `status = 'imported'` のとき NOT NULL |
| `reason` | text | `status IN ('failed','notAttempted')` のとき NOT NULL |
| `attempted_at` | integer | NOT NULL |

- **PK**: (`note_id`, `url`)。`importExternalReferences` は同じ鍵で上書きする（最後の試行結果だけを持つ）
- 版を持たない。集約ではなく、1 行の中で不変条件が閉じているため（[domains/storage.md](../domains/storage.md)）
- **CHECK**:
  - `kind = 'stylesheet'` なら `status != 'imported'`（スタイルシートは保管しない）
  - `kind = 'resource'` なら `status != 'inlined'`
- **インデックス**: PK が `note_id` を先頭に持つため、ノート単位の読み取り（`listAttemptsByNote`）と削除（`deleteByNote`）は追加の索引を要さない
- `note_id` にドメインをまたぐ外部キーは張らない（他のドメイン跨ぎの参照と同じ扱い）。回収は `note.purged` を購読する `deleteFilesForNote` が `deleteByNote` を呼んで行う

行数は 1 ノートあたり `FetchBudget.maxCount`（200）で上界が決まる。**この表は「なぜ」だけを持つ**。「どの参照が未解決か」「どのスタイルシートが埋め込まれ、どれが失われたか」は本文の HTML が語り（`notes.content_html` の `data-*` 痕跡）、読み取り側は本文と突き合わせる。突き合わせの向きが本文からなので、本文に現れなくなった URL の行が残っていても表示に出ない — 古い行を掃除する規則を持たないのはこのためである。

### reference_import_summaries

直近の取り込み 1 回分の要約（`ReferenceImportSummary`）。

| カラム | 型 | 制約 |
| --- | --- | --- |
| `note_id` | text | PK |
| `removed_css` | text | NOT NULL（JSON 配列。`{ property, count }[]`） |
| `completed_at` | integer | NOT NULL |

- `removed_css` は取り込んだ CSS から宣言・規則の単位で落ちたものをプロパティ名ごとに畳んだ値。生の一覧を持たないのは、取り込んだ第三者のスタイルシートによっては宣言が数百件落ちうるためで、畳めば要素数は落とす対象の種類数（現在は 3）で頭打ちになる
- 回収は `reference_import_attempts` と同じく `deleteFilesForNote` が行う

---

## Note

### notes

| カラム | 型 | 制約 |
| --- | --- | --- |
| `id` | text | PK |
| `owner_type` | text | NOT NULL, CHECK IN ('user','workspace') |
| `owner_id` | text | NOT NULL |
| `created_by` | text | NOT NULL |
| `title` | text | NOT NULL |
| `title_origin` | text | NOT NULL, CHECK IN ('auto','manual') |
| `content_status` | text | NOT NULL, CHECK IN ('processing','awaitingIntegration','failed','ready') |
| `content_html` | text | `content_status = 'ready'` のとき NOT NULL |
| `content_text` | text | `content_status = 'ready'` のとき NOT NULL |
| `content_excerpt` | text | `content_status = 'ready'` のとき NOT NULL |
| `content_headings` | text | `content_status = 'ready'` のとき NOT NULL（JSON 配列） |
| `content_failure_reason` | text | `content_status = 'failed'` のとき NOT NULL, CHECK IN（`NoteFailureReason` の 11 値） |
| `visibility` | text | NOT NULL, CHECK IN ('private','unlisted','public') |
| `published_at` | integer | `visibility = 'public'` のとき NOT NULL |
| `share_token_hash` | text | NULL 可 |
| `share_token_ciphertext` | text | `share_token_hash` が NOT NULL のとき NOT NULL |
| `share_token_key_version` | integer | `share_token_hash` が NOT NULL のとき正の整数 |
| `share_password_hash` | text | NULL 可 |
| `share_password_updated_at` | integer | `share_password_hash` と両方 NULL または両方 NOT NULL |
| `share_issued_at` | integer | `share_token_hash` が NOT NULL のとき NOT NULL |
| `style_mode` | text | NOT NULL, CHECK IN ('default','preserve') |
| `source_file_id` | text | NULL 可 |
| `lifecycle` | text | NOT NULL, CHECK IN ('active','trashed') |
| `trashed_at` | integer | `lifecycle = 'trashed'` のとき NOT NULL |
| `purge_after` | integer | `lifecycle = 'trashed'` のとき NOT NULL |
| `version` | integer | NOT NULL DEFAULT 0 |
| `created_at` | integer | NOT NULL |
| `updated_at` | integer | NOT NULL |

共有リンクは休眠状態でも列に残す。`visibility = 'unlisted'` のときだけ「有効なリンク」として扱う。共有トークンは locator に含まれる NoteId で route を解決してから主キーで引くため、hash の検索索引は持たない。hash は入力トークンとの定数時間比較、暗号文は権限を確認した所有者への URL 再表示に使う。

- **CHECK**:
  - `content_status = 'ready'` なら本文 4 列が NOT NULL、そうでなければすべて NULL
  - `content_status = 'failed'` なら `content_failure_reason IS NOT NULL`
  - `content_failure_reason` は `NoteFailureReason` の 11 値（`unsupportedFormat` / `corruptedFile` / `machineExtractionUnavailable` / `providerAuthFailed` / `modelError` / `quotaExceeded` / `timeout` / `sizeExceeded` / `passwordProtected` / `unknown` / `canceled`）に限る。`ConversionFailureReason` から `integrationRequired` を除き、`canceled` を加えた集合である。`integrationRequired` を除くのは「未連携は本文の失敗理由にしない（`awaitingIntegration` が担う）」という型の意図を DB でも弾けるようにするため。`canceled` は強制終端の後始末（[usecases/job.md](../usecases/job.md) の「共通: 強制終端の後始末」）で `processing` のまま残るノートを回復させるときにだけ書かれる値で、変換の実行が返すことはないため `ConversionFailureReason` には含まれない（[domains/note.md](../domains/note.md)）
  - `visibility = 'unlisted'` なら `share_token_hash IS NOT NULL`
  - `share_token_hash` / `share_token_ciphertext` / `share_token_key_version` / `share_issued_at` はすべて NULL またはすべて NOT NULL
  - `share_password_hash` と `share_password_updated_at` は両方 NULL または両方 NOT NULL（ドメインの `password: { hash; updatedAt } | null` に対応。片方だけが埋まった行を作れないようにする）
  - `visibility = 'public'` なら `share_password_hash IS NULL AND published_at IS NOT NULL`
  - `visibility IN ('unlisted','public')` なら `content_status = 'ready'`
  - `lifecycle = 'trashed'` なら `trashed_at IS NOT NULL AND purge_after IS NOT NULL`
- **インデックス**:
  - `notes_owner_lifecycle_updated_idx` (`owner_type`, `owner_id`, `lifecycle`, `updated_at` DESC) — 一覧の既定順
  - `notes_purge_idx` (`purge_after`) WHERE `lifecycle = 'trashed'` — 期限切れゴミ箱の回収

`source_file_id` と、公開ノートの列挙のためのインデックスは持たない。元ファイルからノートを引く経路は `stored_files.note_id`（`listByNote` / `findArtifactByNoteAndVersion`）に一本化されており、`notes.source_file_id` は引かれる側ではなくノートから元ファイルを指す参照としてのみ使う。公開ノートの列挙（横断検索・公開ページ・サイトマップ）はすべて読み取りモデルの責務で、`note_search_public_updated_idx` / `note_search_owner_public_updated_idx` と `listPublicSitemapEntries` が担う。

月・日ごとの集計（アーカイブ）も読み取りモデルの責務であり、`note_search_owner_lifecycle_created_idx` が担う。書き込みモデルには作成日時のインデックスを持たない。

### note_projection_revisions

| カラム | 型 | 制約 |
| --- | --- | --- |
| `note_id` | text | PK, FK → `notes.id` ON DELETE CASCADE |
| `revision` | integer | NOT NULL, CHECK `revision >= 1` |

Note作成時に1で初期化し、Note本体の投影対象列またはTagAssignment集合を変更するlocal transactionで必ず1増やす。public snapshot readerはNote・tag集合・このrevisionを同じread transactionで取得する。

### note_revisions

| カラム | 型 | 制約 |
| --- | --- | --- |
| `id` | text | PK |
| `note_id` | text | NOT NULL, FK → `notes.id` ON DELETE CASCADE |
| `html` | text | NOT NULL |
| `title` | text | NOT NULL |
| `title_origin` | text | NOT NULL, CHECK IN ('auto','manual') |
| `style_mode` | text | NOT NULL, CHECK IN ('default','preserve') |
| `created_by` | text | NOT NULL |
| `created_at` | integer | NOT NULL |
| `reason` | text | NOT NULL, CHECK IN ('manualEdit','regeneration','wysiwygConversion','restore') |

- 不変のため `version` を持たない
- **インデックス**: `note_revisions_note_created_idx` (`note_id`, `created_at` DESC) — 直近 20 件の取得と超過分の削除

---

## Tag

### tags

| カラム | 型 | 制約 |
| --- | --- | --- |
| `id` | text | PK |
| `scope_type` | text | NOT NULL, CHECK IN ('user','workspace') |
| `scope_id` | text | NOT NULL |
| `name` | text | NOT NULL（表示用） |
| `normalized` | text | NOT NULL（同一判定用） |
| `version` | integer | NOT NULL DEFAULT 0 |
| `created_at` | integer | NOT NULL |
| `updated_at` | integer | NOT NULL |

- **インデックス**: `tags_scope_normalized_uq` UNIQUE (`scope_type`, `scope_id`, `normalized`) — スコープ内の列挙は左端 2 列の前方一致で兼ねる

### tag_assignments

| カラム | 型 | 制約 |
| --- | --- | --- |
| `id` | text | PK |
| `tag_id` | text | NOT NULL, FK → `tags.id` ON DELETE CASCADE |
| `note_id` | text | NOT NULL |
| `scope_type` | text | NOT NULL, CHECK IN ('user','workspace') |
| `scope_id` | text | NOT NULL |
| `assigned_by` | text | NOT NULL |
| `assigned_at` | integer | NOT NULL |

- `note_id` には外部キーを張らない（Note は別ドメイン。ノートの完全削除はイベントで後始末する）
- 不変のため `version` を持たない
- **インデックス**: `tag_assignments_tag_note_uq` UNIQUE (`tag_id`, `note_id`)、`tag_assignments_note_idx` (`note_id`)、`tag_assignments_tag_assigned_idx` (`tag_id`, `assigned_at` DESC) — 使用件数の集計と最終使用日時の取得

---

## Integration

### external_connections

global D1 に置く。

| カラム | 型 | 制約 |
| --- | --- | --- |
| `id` | text | PK |
| `user_id` | text | NOT NULL |
| `provider` | text | NOT NULL, CHECK IN ('openrouter','googleDrive') |
| `status` | text | NOT NULL, CHECK IN ('active','expired') |
| `account_label` | text | NULL 可 |
| `access_token_cipher` | text | `status = 'active'` のとき NOT NULL |
| `access_token_key_version` | integer | `status = 'active'` のとき NOT NULL |
| `refresh_token_cipher` | text | NULL 可 |
| `refresh_token_key_version` | integer | `refresh_token_cipher` が NOT NULL のとき NOT NULL |
| `access_token_expires_at` | integer | NULL 可 |
| `expired_at` | integer | `status = 'expired'` のとき NOT NULL |
| `settings` | text | NOT NULL（JSON。`ConnectionSettings` を格納） |
| `last_used_at` | integer | NULL 可 |
| `version` | integer | NOT NULL DEFAULT 0 |
| `created_at` | integer | NOT NULL |
| `updated_at` | integer | NOT NULL |

- **CHECK**: `status = 'expired'` なら資格情報の 4 列がすべて NULL
- `settings` は JSON。`provider` と `settings.provider` の一致はアダプターの復元時に検証する
- **インデックス**: `external_connections_user_provider_uq` UNIQUE (`user_id`, `provider`)

### backup_records

対象 Note と同じ scope DO に置く。`user_id` は接続の所有者であり storage shard を決めない。

| カラム | 型 | 制約 |
| --- | --- | --- |
| `id` | text | PK |
| `user_id` | text | NOT NULL |
| `note_id` | text | NOT NULL |
| `source_file_id` | text | NOT NULL |
| `external_file_id` | text | NOT NULL |
| `web_view_url` | text | NOT NULL |
| `checksum_value` | text | NOT NULL |
| `version` | integer | NOT NULL DEFAULT 0 |
| `backed_up_at` | integer | NOT NULL |
| `updated_at` | integer | NOT NULL |

- **インデックス**: `backup_records_note_file_uq` UNIQUE (`note_id`, `source_file_id`) — `note_id` 単独の検索は左端列の前方一致で兼ねる、`backup_records_user_idx` (`user_id`)

### oauth_flow_states

global D1 に置く。サインイン用と連携用の両方の認可フローが使う短期データ。

| カラム | 型 | 制約 |
| --- | --- | --- |
| `state` | text | PK |
| `provider` | text | NOT NULL |
| `code_verifier` | text | NOT NULL |
| `intent` | text | NOT NULL, CHECK IN ('signIn','linkIdentity','integration') |
| `user_id` | text | NULL 可 |
| `user_auth_epoch` | integer | authenticated intentではNOT NULL、signInではNULL |
| `redirect_to` | text | NULL 可 |
| `state_binding_hash` | text | NOT NULL |
| `created_at` | integer | NOT NULL |
| `expires_at` | integer | NOT NULL |

- **CHECK**: `intent IN ('linkIdentity','integration')` なら `user_id IS NOT NULL AND user_auth_epoch IS NOT NULL`。`signIn`なら両方NULL
- **インデックス**: `oauth_flow_states_expires_idx` (`expires_at`, `state`) — 同一expiryを安定keysetで回収する

`take` は束縛が一致したときだけ削除する条件付きの操作で、`DELETE … WHERE state = ? AND state_binding_hash = ? RETURNING *` で削除し、返った行の `expires_at` を見て期限切れなら `null` を返す。`WHERE` に期限を混ぜないのは、混ぜると束縛が一致した期限切れの行が残ってしまうため。

---

## Job

### jobs

scope DO に置く。`id` は `ScopedJobId` の文字列表現で、復元時に埋め込まれた ScopeKey と object 自身の ScopeKey の一致を検査する。

| カラム | 型 | 制約 |
| --- | --- | --- |
| `id` | text | PK |
| `parent_id` | text | NULL 可, FK → `jobs.id` ON DELETE RESTRICT |
| `kind` | text | NOT NULL, CHECK IN（`JobKind` の 11 値） |
| `payload` | text | NOT NULL（JSON。`JobPayload` を格納） |
| `target_type` | text | NOT NULL, CHECK IN ('note','storedFile','batch') |
| `target_id` | text | `target_type != 'batch'` のとき NOT NULL |
| `requested_by` | text | NULL 可 |
| `scope_type` | text | NOT NULL, CHECK IN ('user','workspace') |
| `scope_id` | text | NOT NULL |
| `status` | text | NOT NULL, CHECK IN ('queued','running','succeeded','failed','canceled') |
| `attempts` | integer | NOT NULL DEFAULT 0, CHECK `attempts >= 0` |
| `removal_operation_id` | text | NULL可。非nullにできるのはfamily removal claim中のroot Jobだけ |
| `progress_completed` | integer | `status = 'running'` のとき NOT NULL |
| `progress_total` | integer | `status = 'running'` のとき NOT NULL |
| `progress_event_completed` | integer | `status = 'running'` のとき NOT NULL |
| `progress_event_at` | integer | `status = 'running'` のとき NOT NULL |
| `lease_expires_at` | integer | `status = 'running'` のとき NOT NULL |
| `started_at` | integer | `status IN ('running','succeeded')` のとき NOT NULL |
| `finished_at` | integer | 終端状態のとき NOT NULL |
| `artifact_file_id` | text | NULL 可 |
| `artifact_expires_at` | integer | `artifact_file_id` が NOT NULL のとき NOT NULL |
| `failure_reason` | text | `status = 'failed'` のとき NOT NULL, CHECK IN（`JobFailureReason` の 14 値） |
| `failure_detail` | text | `status = 'failed'` のとき NOT NULL |
| `notices` | text | `status = 'succeeded'` のとき NOT NULL（JSON 配列。`JobNotice[]` を格納。申し送りがなければ `[]`） |
| `version` | integer | NOT NULL DEFAULT 0 |
| `created_at` | integer | NOT NULL |
| `updated_at` | integer | NOT NULL |

`requested_by` が NULL になるのは匿名の閲覧者による PDF エクスポートのみ（[ADR 010](../adr/010-anonymous-export-and-ticket.md)、[domains/job.md](../domains/job.md) の `JobAttribution`）。`lease_expires_at` は実行中ワーカーの生存を表すリースで、実行開始（`Job.start`）と進捗報告（`Job.reportProgress`）のたびに延長される（[ADR 012](../adr/012-job-execution-resilience.md)）。batch 親の組み立て（`bulkExport` の ZIP 生成）の実行権にも専用の列は持たず、`attempts` と `lease_expires_at` の組で表す — 親の `attempts` は `enqueueBatch` で 0、`reportProgress` では増えないため、`attempts >= 1` かつリース有効なら「組み立て中」と判定できる（`Job.beginAssembly`）。

この列を延ばす主体は状態によって変わる。組み立て中の親（`target_type = 'batch'` かつ `attempts >= 1`）だけは `reportProgress` が期限に触れず、進捗の 2 列だけを書き換える。この状態の `lease_expires_at` を延ばせるのは実行権を持つ組み立てワーカーが呼ぶ `Job.renewAssemblyLease` だけである（[domains/job.md](../domains/job.md) の「組み立て中の親のリース」）。子の終了報告が期限を延ばし続けて死んだ組み立てワーカーの親が永久に `running` に留まるのを防ぐための規則で、組み立て中に落ちた親は必ずリース失効に落ち、`jobs_lease_idx` 経由でリーパーが回収できる。組み立てを始める前の親（`attempts = 0`）は他のジョブと同じく `reportProgress` で延長される。

`scope_type` / `scope_id` は `Job.enqueue` / `Job.enqueueBatch` がどちらも必須引数で受け取る `JobScope`（[domains/job.md](../domains/job.md)）に対応し、両列とも NOT NULL。「親ジョブと子ジョブの `scope` は一致する」「batch 親の `scope` は単一である」という不変条件は、登録ユースケースが受け取るsource ScopeKeyを親子へ同じ値で渡すことで守る。対象IDのrouteが別scopeなら `notFound` として除外される。

- **CHECK**:
  - `target_type = 'batch'` なら `target_id IS NULL`、そうでなければ `target_id IS NOT NULL`
  - `requested_by IS NULL` なら `kind = 'pdfExport' AND parent_id IS NULL`
  - `status = 'succeeded'` 以外なら `artifact_file_id IS NULL`
  - `status = 'succeeded'` 以外なら `notices IS NULL`
  - `status IN ('running','succeeded')` なら `started_at IS NOT NULL`
  - `status IN ('succeeded','failed','canceled')` なら `finished_at IS NOT NULL`
  - `status = 'running'` なら `progress_completed IS NOT NULL AND progress_total IS NOT NULL AND progress_completed <= progress_total`
  - `status = 'running'` なら `progress_event_completed IS NOT NULL AND progress_event_at IS NOT NULL AND progress_event_completed <= progress_completed`
  - `status = 'running'` なら `lease_expires_at IS NOT NULL`
  - `status = 'failed'` なら `failure_reason IS NOT NULL AND failure_detail IS NOT NULL`
  - `removal_operation_id IS NULL OR (parent_id IS NULL AND status IN ('succeeded','failed','canceled'))`。子Jobや非終端rootへfamily removal claimを付けない
  - `failure_reason` は `JobFailureReason` の 14 値に限る。`notes.content_failure_reason` の 11 値から `canceled` を除いた 10 値に `integrationRequired` / `permissionRevoked` / `targetMissing` / `storageError` を加えた集合であり、`ConversionFailureReason` の全 11 値を含む上位集合になる。`canceled` を持たないのは、取り消しを `Job.cancel` が `failure` を持たない `CanceledJob` として表すため `fail` に渡す理由にならないからである（[domains/job.md](../domains/job.md)、[ADR 012](../adr/012-job-execution-resilience.md)）
- **インデックス**:
  - `jobs_requester_parents_created_idx` (`requested_by`, `created_at` DESC) WHERE `requested_by IS NOT NULL AND parent_id IS NULL` — 履歴の一覧の既定（`parentsOnly: true`）
  - `jobs_requester_created_idx` (`requested_by`, `created_at` DESC) WHERE `requested_by IS NOT NULL` — 履歴の一覧で `parentsOnly: false` を選んだとき（匿名ジョブはどちらにも載らない）
  - `jobs_requester_active_idx` (`requested_by`) WHERE `status IN ('queued','running') AND requested_by IS NOT NULL` — scope 内の強制終端（`listActiveByRequester`）
  - `jobs_parent_idx` (`parent_id`) — 子ジョブの列挙と集計
  - `jobs_target_active_idx` (`target_type`, `target_id`) WHERE `status IN ('queued','running')` — 多重実行の抑止
  - `jobs_scope_active_idx` (`scope_type`, `scope_id`) WHERE `status IN ('queued','running')` — ワークスペース削除時の一括キャンセル
  - `jobs_lease_idx` (`lease_expires_at`) WHERE `status = 'running'` — リーパーの `listExpiredRunning`（リース失効した `running` の回収）
  - `jobs_finished_idx` (`finished_at`) WHERE `finished_at IS NOT NULL AND parent_id IS NULL` — 保持期間切れrootの選択（`listRemovableRoots`）
  - `jobs_removal_claim_uq` UNIQUE (`removal_operation_id`) WHERE `removal_operation_id IS NOT NULL` — 1 manifestと1 rootの対応

`jobs_finished_idx` に `parent_id IS NULL` を含めるのは、履歴の削除の起点が**親を持たないジョブ**に限られるためである（[usecases/job.md](../usecases/job.md) の `pruneJobHistory`）。子は `jobs_parent_idx` で最大100件ずつmanifestへ固定し、`parent_id` の外部キーRESTRICT下で子から先に削除する。root選択クエリが `finished_at < cutoff AND parent_id IS NULL` で引く行だけを索引に載せればよく、子の行（一括操作では親の数十〜数百倍になりうる）を索引から外せるぶん小さくなる。

履歴の一覧の索引を 2 本に分けるのも同じ理由による。`listJobs` の `parentsOnly` は既定が `true` で（[usecases/job.md](../usecases/job.md)）、既定のクエリは `requested_by = ? AND parent_id IS NULL ORDER BY created_at DESC` になる。`jobs_requester_parents_created_idx` はこの述語をそのまま部分索引に写したもので、`jobs_finished_idx` と同じく子の行を丸ごと索引から外す。`parentsOnly: false` は `requested_by` だけで絞った 1 本の並びを `created_at` 順に読む必要があり、部分索引では順序を作れないため、全行を載せた `jobs_requester_created_idx` を別に持つ。非既定の絞り込みのためだけに既定のクエリへ子の行を負担させないことを優先した判断で、書き込み側の索引更新は 1 本ぶん増える。

`jobs_requester_active_idx` は scope 内の強制終端だけに使う。同じ利用者が複数 workspace scope で要求した Job をこの索引だけで数えることはできない。`bulkExport` の利用者単位の同時実行制約は global D1 の `job_slots` が担う。

---

## Usage

### storage_quotas

| カラム | 型 | 制約 |
| --- | --- | --- |
| `subject_type` | text | NOT NULL, CHECK IN ('user','workspace') |
| `subject_id` | text | NOT NULL |
| `limit_bytes` | integer | NOT NULL, CHECK `limit_bytes > 0` |
| `consumed_bytes` | integer | NOT NULL DEFAULT 0, CHECK `consumed_bytes >= 0` |
| `note_count` | integer | NOT NULL DEFAULT 0, CHECK `note_count >= 0` |
| `version` | integer | NOT NULL DEFAULT 0 |
| `updated_at` | integer | NOT NULL |

- **主キー**: (`subject_type`, `subject_id`)（主体そのものが識別子）

### llm_usages

| カラム | 型 | 制約 |
| --- | --- | --- |
| `user_id` | text | NOT NULL |
| `period_year` | integer | NOT NULL |
| `period_month` | integer | NOT NULL, CHECK BETWEEN 1 AND 12 |
| `limit_calls` | integer | NOT NULL, CHECK `limit_calls >= 0` |
| `consumed_calls` | integer | NOT NULL DEFAULT 0, CHECK `consumed_calls >= 0` |
| `version` | integer | NOT NULL DEFAULT 0 |
| `updated_at` | integer | NOT NULL |

- **主キー**: (`user_id`, `period_year`, `period_month`) — `user_id` 単独の検索は左端列の前方一致で兼ねる

---

## 読み取りモデル

[ADR 009](../adr/009-read-models.md) に基づく。書き込みモデルからイベント経由で投影される。

### note_search

| カラム | 型 | 制約 |
| --- | --- | --- |
| `note_id` | text | PK |
| `owner_type` | text | NOT NULL |
| `owner_id` | text | NOT NULL |
| `created_by` | text | NOT NULL |
| `title` | text | NOT NULL |
| `text` | text | NOT NULL |
| `excerpt` | text | NOT NULL |
| `tag_names` | text | NOT NULL DEFAULT ''（改行区切りで連結した正規化済みタグ名。キーワード検索の関連度用） |
| `tag_display_names` | text | NOT NULL DEFAULT ''（改行区切りで連結した表示名。一覧の表示用。FTS 対象外） |
| `visibility` | text | NOT NULL |
| `content_status` | text | NOT NULL |
| `style_mode` | text | NOT NULL |
| `has_source_file` | integer | NOT NULL DEFAULT 0 |
| `lifecycle` | text | NOT NULL |
| `author_display_name` | text | NOT NULL |
| `author_handle` | text | NULL 可 |
| `workspace_name` | text | NULL 可 |
| `workspace_slug` | text | NULL 可 |
| `workspace_published` | integer | NOT NULL DEFAULT 0 |
| `projection_revision` | integer | NOT NULL |
| `author_version` | integer | NOT NULL |
| `workspace_version` | integer | NOT NULL DEFAULT 0 |
| `created_at` | integer | NOT NULL |
| `updated_at` | integer | NOT NULL |
| `trashed_at` | integer | NULL 可 |
| `purge_after` | integer | NULL 可 |

- `(projection_revision, author_version, workspace_version)` の世代ベクトルを持つ。local task自体は直列でも、global Identityを読んでからlocal writeする間の更新と競合するため、単一scalarではなく全sourceのversionを比較する。move targetではsourceの投影rowをcopyせず新規rowとして初期化し、workspaceVersionの低下を旧scopeと比較しない
- 通常の rowid 表として作る。`note_search_fts` の行を `note_search.rowid` で対応づけるため、`WITHOUT ROWID` にしてはならない
- **bigram 前処理済みのテキストは列に持たない**。FTS5 は contentless 構成で、前処理済みのテキストは索引の中だけに存在する（[ADR 017](../adr/017-content-size-budget.md)）。索引を書き換えるときの旧値は、生テキスト列に前処理関数を再適用して求める
- `tag_names` は `ProjectedTagName.normalized` を `tag_display_names` と同じく改行（`\n`）で連結する。区切り文字は改行に固定する — この列は FTS の `tag_names_fts` 列に入れる bigram の入力であり、bigram 前処理は CJK run と非 CJK を文字クラスで分けるだけなので、区切りが CJK 文字や英数字だと隣接するタグの末尾と先頭が 1 トークンに融合し、bm25 のタグ名列の関連度が壊れる。改行は前処理の非 CJK 側で空白と同じ区切りとして働き、`TagName` が改行を含まない（[domains/tag.md](../domains/tag.md)）ため融合が起きない
- `tag_display_names` は `NoteSummary.tagNames` / `PublicNoteSummary.tagNames`（表示名。正規化前）を一覧の 1 クエリで返すための列。`ProjectedTagName.name` を改行（`\n`）で連結する。完全snapshot writerが同じ配列から `tag_names` とともに組み立てる
- `author_*` 列は `created_by` の利用者を指す（ワークスペース所有ノートでも作成者を表示する）。`NoteProjectionEntry` の `author` / `workspace` は `upsert` の呼び出し側が投影のたびに解決して渡すため（[domains/note.md](../domains/note.md)）、初回投影（`note.created` / `note.moved`）から必ず値が入り、既定値に頼らない
- **インデックス**:
  - `note_search_owner_lifecycle_updated_idx` (`owner_type`, `owner_id`, `lifecycle`, `updated_at` DESC)
  - `note_search_owner_lifecycle_created_idx` (`owner_type`, `owner_id`, `lifecycle`, `created_at` DESC)
  - `note_search_owner_lifecycle_title_idx` (`owner_type`, `owner_id`, `lifecycle`, `title`)
  - `note_search_created_by_note_idx` (`created_by`, `note_id`) — author refreshを200件ずつキーセット列挙する

公開検索の索引は下記 `public_note_search` にだけ置く。scope-local `note_search` は private / owner-context の一覧・検索・カレンダーを担う。

個人検索（`searchNotes`）の `createdWithin` は事情が異なり、**範囲列と並べ替え列が一致しない**。範囲は `created_at` に対して掛かるが、既定のソートは `updatedDesc`（キーワードがあれば `relevance`）で、並び順は月の絞り込みとは独立に利用者が選ぶ（P-10 の「月絞り込み」と「並び順の変更」は別のコントロール）。1 本の索引で絞り込みと並べ替えの両方を賄うことはできないので、役割を次のように分ける。

- `note_search_owner_lifecycle_created_idx` は**母集合の切り出し**を担う。左端 3 列（`owner_type` / `owner_id` / `lifecycle`）の等価一致に `created_at` の範囲を重ね、選んだ月の行だけを読む。`sort` が `createdDesc` / `createdAsc` のときはこの並びがそのまま答えになり、並べ替えが要らない
- `updatedDesc` / `updatedAsc` / `titleAsc` / `titleDesc` を選んだ場合は、切り出した行を並べ替える（一時 B-tree ソート）。読む行が 1 所有者・1 か月ぶんに限られるため許容できる。月を選んでいない状態（`createdWithin` が `null`）では範囲がないぶん `note_search_owner_lifecycle_updated_idx` / `note_search_owner_lifecycle_title_idx` が並べ替え込みでそのまま効く
- `relevance` は `note_search_fts` の `bm25` 順であり、どの B-tree 索引も並べ替えには使えない。この経路では FTS 側が母集合を作り、`created_at` の範囲と所有者・`lifecycle` は取り出した行に対する絞り込みとして働く

同じ索引は `listMonthsWithNotes` / `countByDay`（OR-02 のカレンダーと OR-05 の月セレクター）も使う。こちらは並べ替えを伴わない集計なので、範囲走査だけで完結する。

`content_status` を含む索引は持たない。この列で絞る唯一の経路は `countByContentStatus(owner, status)` で、呼び出し元は `completeIntegrationOAuth`（[usecases/integration.md](../usecases/integration.md)）の「要 LLM 連携の N 件」の案内 1 か所だけである。所有者プレフィックス（`note_search_owner_lifecycle_updated_idx` の左端 2 列 `owner_type` / `owner_id`。`countByContentStatus` の引数は所有者と本文状態だけで `lifecycle` を取らないため、等価一致で使えるのはここまで）で 1 利用者・1 ワークスペースぶんまで絞れたあとに `content_status` を数え上げる形になり、OAuth の完了時にしか走らない頻度に対して十分に速い。投影表は既に 6 本の索引を持ち、書き込みは 1 ノートの変化ごとに走るため、この頻度の読み取りのために索引を足す取引にはならないと判断した。

`workspace_slug` / `author_handle` を先頭にした公開検索用索引は持たない。表示更新のfan-outは `created_by, note_id` または `owner_type, owner_id, note_id` のキーセット索引から個別再投影taskを作り、行を無制限に一括更新しない。

### note_search_tags

タグの AND 絞り込み用の正規化表。`note_search` と同じくプロジェクションが更新する。

| カラム | 型 | 制約 |
| --- | --- | --- |
| `note_id` | text | NOT NULL |
| `normalized` | text | NOT NULL（正規化済みタグ名） |

- **主キー**: (`normalized`, `note_id`) — タグ名から対象ノートを引く向きに最適化
- **インデックス**: `note_search_tags_note_idx` (`note_id`) — ノート単位のsnapshot入れ替えと削除用
- 版を持たない（投影は現在の状態からの冪等な上書き）
- タグの AND 絞り込みは本表への JOIN（関係除算。または `INTERSECT`）による完全一致で行う。`note_search.tag_names` と FTS の `tag_names_fts` 列はキーワード検索の関連度に寄与させるためのものであり、絞り込みには使わない

#### タグ列の同期契約

タグは `note_search.tag_names`（関連度用）・`note_search_tags`（絞り込み用）・`note_search.tag_display_names`（表示用）の 3 か所と、FTS 索引の `tag_names_fts` 列に投影される。書き手は [domains/note.md](../domains/note.md) の分掌のとおり固定する。

- local / public とも `replaceSnapshotIfNewer` だけが書く。ノート本体とタグ集合を丸ごと入れ替え、3 列と FTS 索引を local は scope DO の `transactionSync()`、public は本体snapshotも含む D1 `batch()` で更新する
- `remove` は `note_search` の行・FTS 索引の行・`note_search_tags` の当該ノートの行をすべて消す

### note_search_fts

bigram 前処理済みのテキストを索引する FTS5 仮想テーブル（[ADR 011](../adr/011-bigram-search.md) / [ADR 017](../adr/017-content-size-budget.md)）。Drizzle スキーマ外の手書き SQL マイグレーションで管理する。

```sql
CREATE VIRTUAL TABLE note_search_fts USING fts5(
  title_fts,
  text_fts,
  tag_names_fts,
  content='',
  tokenize='unicode61'
);
```

- **contentless（`content=''`）である**。前処理済みのテキストはどこにも保存されず、索引の中だけに存在する。`note_search` の行サイズが生テキストの約 3.2 倍に膨らむのを避けるためで、読み返す経路は存在しない（後述「ハイライトと抜粋の生成」のとおり `snippet()` / `highlight()` は使わない）
- `rowid` は `note_search.rowid` を**明示して**挿入する（contentless では自動で対応づかない）
- SQL trigger では同期しない。scope writer は DO transaction、global public writer は D1 batch で本体・tag・FTS を原子的に更新する
- **取り消しに渡す旧値は保存していないので、生テキスト列から前処理関数を再適用して求める**（`note_search.title` / `text` / `tag_names` を読み、後述の bigram 前処理を通す）。前処理は純関数なので、書き込み時に入れた値と必ず一致する
- 著者/workspace変更も個別の完全snapshot置換として処理する。FTS対象値が同一でも、writerは旧FTS行を取り消して同じ値を再挿入し、本体・tag・世代ベクトルとの原子性を優先する
- 関連度順は `bm25` の列重みで求める。重みはタイトル > タグ名 > 本文（例: `bm25(note_search_fts, 5.0, 1.0, 3.0)`。列順は `title_fts`, `text_fts`, `tag_names_fts`。具体値は実装時に調整してよい）
- **前処理関数を変更したら FTS 表を作り直す**。旧い関数で入れた索引行は新しい関数が作る値では取り消せないため、変更は表の再作成と全件の再挿入を伴う

#### bigram 前処理

書き込み側とクエリ側で完全に共有する単一の純関数として実装する（[ADR 011](../adr/011-bigram-search.md) と同内容。本節が実装の正）。次の順に適用する。

1. NFKC 正規化（全角英数・半角カナを解決）
2. 小文字化
3. CJK run 分割（CJK 連続部分と非 CJK 部分に分割）
4. CJK run（2 文字以上）は重なりビグラム化（「東京都」→「東京 京都」）、1 文字 run は unigram、非 CJK は空白区切りでそのまま

CJK 文字クラスの正確な範囲は次のとおり。半角カナ・全角英数は NFKC が先に解決するため含めない。

| 範囲 | 内容 |
| --- | --- |
| U+3040–309F | Hiragana |
| U+30A0–30FF | Katakana（長音 `ー` 含む） |
| U+31F0–31FF | Katakana Phonetic Extensions |
| U+4E00–9FFF | CJK Unified Ideographs |
| U+3400–4DBF | CJK Unified Ideographs Extension A |
| U+F900–FAFF | CJK Compatibility Ideographs |
| U+3005, U+3006 | `々`・`〆`（「佐々木」の分断防止） |

#### クエリ構築

- 検索語に同じ前処理を適用し、run ごとに二重引用符で包んだフレーズにする。内部の `"` は `""` に倍化する（FTS5 演算子の無力化を兼ねる）
- run 間は AND で結ぶ。トークンが 1 つも残らなければキーワードなし扱いとする
- 英数字トークンには前方一致（`word*`）を付与する

#### ハイライトと抜粋の生成

`NoteSummary.highlightedExcerpt` / `PublicNoteSummary.highlightedExcerpt`（[domains/note.md](../domains/note.md)。OR-03 手順 3「一致箇所の抜粋がハイライトつきで表示される」）に FTS5 の `snippet()` / `highlight()` は**使わない**。これらの関数が返すのは索引に入れたテキスト、つまり前処理済みの `title_fts` / `text_fts` であり、「東京 京都 都庁」のようなビグラム列がそのまま出てくるため利用者に見せられない（contentless 構成ではそもそも呼び出せない）。

FTS は「どの行が一致したか」と関連度（`bm25`）だけを担い、「どこが一致したか」はアダプター側が生テキスト列から求める。

- 照合対象は `note_search.excerpt`（生テキスト）。ここに一致がなければ `note_search.text`（生テキスト）から最初の一致位置の前後を切り出して窓を作る
- 照合は前処理の 1〜2 段目だけ（NFKC 正規化 → 小文字化。ビグラム化は行わない）を検索語と対象テキストの双方に適用した文字列同士の部分一致で行う。クエリ側と同じ正規化を通すため、全角英数・半角カナ・大文字小文字のゆれは検索と同じ基準で吸収される
- 検索語が複数の run に分かれる場合（クエリ構築で AND に結ばれる単位）は run ごとに一致を探し、見つかったものをすべて囲む。切り出す窓は最初の一致を基準に取る
- NFKC は文字数を変えうるため、正規化と同時に**正規化後の位置 → 元テキストの位置**の写像を作り、切り出しとハイライトの区間は元テキストの位置で決める。返す文字列は常に元テキストの一部であり、正規化済みテキストを利用者に返してはならない
- キーワード未指定のときは `null`（型のとおり）。一致が 1 つも見つからないとき（境界をまたぐ偽陽性など、後述の「既知の限界」に当たる行）も `null` とし、画面は素の `excerpt` を出す
- `highlightedExcerpt` は型のとおり 1 本の文字列で返す。`excerpt` / `text` は本文から抽出した**平文**なので、まず HTML エスケープしてから一致区間を `<mark>` … `</mark>` で囲む。標識を入れる側がエスケープまで責任を持つことで、表示層はこの値だけを HTML として描ける（素の `excerpt` は平文として扱う）

#### 再構築

- `tag_display_names` のような投影列の追加は、既定値付きで列を足してから `rebuildNoteProjection` の完全snapshot置換で埋める
- **`INSERT INTO note_search_fts(note_search_fts) VALUES('rebuild')` は contentless では使えない**（読み直す content 表がない）。一括再構築は FTS 表を作り直したうえで、`rebuildNoteProjection` が 1 件ずつ積む再投影要求で埋め直す。`INSERT INTO note_search_fts(note_search_fts) VALUES('integrity-check')` は使えるが、検査できるのは索引の内部整合性だけで、`note_search` との一致は検査できない。両者の一致は `rebuildNoteProjection` の孤児掃除が担う

#### 既知の限界

テストケースは「ヒットしてよい」側で書く。

- 句読点・空白のみの境界をまたぐ偽陽性がある（「日本。本語」が「日本語」にヒットする。bm25 で下位に沈む）
- 英単語の中間部分一致は失われる（`flare` で Cloudflare は引けない。前方一致 `cloud*` は可能）
- クエリ内の 1 文字 CJK run は unigram の挙動になる
- ハイライトの一致位置は生テキストへの部分一致で求めるため、FTS のヒットと必ずしも一致しない。境界をまたぐ偽陽性の行や、タイトル・タグ名だけで一致した行では `highlightedExcerpt` が `null` になる（前節「ハイライトと抜粋の生成」）

### Global projection tables

#### workspace_directory

公開 workspace と利用者の workspace 一覧に必要な非正規化 projection。正は workspace scope DO と `membership_directory` にある。

| カラム | 型 | 制約 |
| --- | --- | --- |
| `workspace_id` | text | PK |
| `name` | text | NOT NULL |
| `slug` | text | UNIQUE、NULL 可 |
| `publication` | text | NOT NULL |
| `lifecycle` | text | NOT NULL, CHECK IN ('active','deleting') |
| `deletion_operation_id` | text | `lifecycle = 'deleting'`のときNOT NULL, UNIQUE |
| `avatar_url` | text | NULL 可 |
| `source_version` | integer | NOT NULL |
| `updated_at` | integer | NOT NULL |

`source_version` より古い event は 0 行更新で無視する。削除tombstoneは`lifecycle = deleting`のまま`slug = null`とし、name/avatar等の表示PIIもredactする。directory tombstone確定後に別key shardのslug reservationをreleaseするため、同じslugを新しいWorkspaceが予約できる。

物理配置はWorkspaceId hash shardとする。indexは(`publication`, `lifecycle`, `updated_at` DESC, `workspace_id`)。`resolveMany`/slug route後のlookupはWorkspaceIdで直接routeし、公開一覧は最大32 shard・同時6接続・全体200件の署名cursorでscatter-gatherする。reshard中は旧新をWorkspaceId/sourceVersionで重複排除する。

#### job_history

利用者横断の処理履歴 projection。Job の操作はこの行を正として行わず、`scoped_job_id` から scope object を呼ぶ。

| カラム | 型 | 制約 |
| --- | --- | --- |
| `scoped_job_id` | text | PK |
| `parent_id` | text | NULL 可（family cleanupのbounded選択用） |
| `requested_by` | text | NULL 可 |
| `scope_type` / `scope_id` | text | NOT NULL |
| `kind` / `status` | text | NOT NULL |
| `payload` | text | NOT NULL（JSON） |
| `progress_completed` / `progress_total` | integer | NULL 可 |
| `target_type` / `target_id` | text | `target_id` は batch のみ NULL |
| `target_label` | text | NOT NULL |
| `child_summary` | text | NULL 可（JSON） |
| `failure_reason` | text | NULL 可 |
| `failure_detail` | text | NULL 可 |
| `notices` | text | NOT NULL（JSON） |
| `artifact_file_id` / `artifact_expires_at` | text / integer | NULL 可 |
| `source_version` | integer | NOT NULL |
| `started_at` / `finished_at` | integer | NULL 可 |
| `created_at` / `updated_at` | integer | NOT NULL |

indexes: (`requested_by`, `updated_at` DESC, `scoped_job_id`), (`requested_by`, `parent_id`, `scoped_job_id`), (`status`, `updated_at`), (`target_type`, `target_id`, `updated_at`)。

物理配置はrequestedBy hash shardであり、writerのfind/removeは必ずrequestedBy route keyを取る。通常eventはrequestedByを運び、`job.removed`はscope-local manifestにroot/childごとのrequestedByを固定するため、scope正データ削除後も各履歴shardへ到達できる。移行中はsourceVersion付きdual-write/removeを旧新両generationへ送り、JobIdでread mergeする。

#### job_history_removal_tombstones

requestedBy hash shardの`job_history`と同居し、(`requested_by`, `scoped_job_id`)をPK、`removal_operation_id`, `removed_at`, `expires_at`を持つ。`tombstoneAndRemove`はtombstone INSERTとhistory DELETEを1 transactionで行い、`upsertIfNewer`も同じtransactionで未失効tombstoneを確認する。保持は30日で、global Cronから渡す`job.globalTombstonePruneContinued`が`expires_at, scoped_job_id` keysetを1command最大100件回収する。削除前snapshotを読んだconsumerが競合しても、route側の`routeRemoved`またはこのtombstoneのどちらかで復活を防ぐ。

#### job_history_target_routes

target hash shard上のbounded reverse index。`target_type`, `target_id`, `requested_by`, `scoped_job_id`, `source_version`, `state`, `tombstone_expires_at`を持ち、PKは(`target_type`, `target_id`, `requested_by`, `scoped_job_id`)。batch targetは登録しない。同shardのtarget tombstoneは(`target_type`, `target_id`) PKと`deleted_at`, `expires_at`を持つ。`registerBeforeHistory` / `tombstoneTargetBeforeFanOut` / `tombstoneRoute`をoperation ID付きconditional writeとして実装し、registerはroute tombstoneなら`routeRemoved`を返す。target削除はtombstoneを先に保存し、routeをキーセットで最大100件ずつ読み、requestedBy shardへ最大6並行で更新commandを送る。history upsertはroute登録時にtarget tombstoneを読み、削除済みなら最初からtargetLabelを「削除済み」にする。route tombstoneは30日、target tombstoneはJob保持90日+配送/replay 30日の120日保持し、global Cron由来の`job.globalTombstonePruneContinued`が`expires_at` keysetを1command最大100件回収する。target tombstoneは対応routeと保持窓内Jobが0件の場合だけ消す。reshard中は旧新reverse indexをJobIdで重複排除する。

#### public_note_search / public_note_search_tags / public_note_search_fts

列・FTS 構成・bigram 前処理・同期契約は scope-local の `note_search*` と同じ。ただし `lifecycle = 'active' AND visibility = 'public'` の行だけを持ち、次の列を追加する。

| カラム | 型 | 制約 |
| --- | --- | --- |
| `route_version` | integer | NOT NULL |
| `projection_revision` | integer | NOT NULL |
| `author_version` | integer | NOT NULL |
| `workspace_version` | integer | NOT NULL DEFAULT 0 |

indexes:

- `public_note_search_updated_idx` (`updated_at` DESC, `note_id`)
- `public_note_search_owner_updated_idx` (`owner_type`, `owner_id`, `updated_at` DESC, `note_id`)
- `public_note_search_created_by_note_idx` (`created_by`, `note_id`)
- `public_note_search_owner_note_idx` (`owner_type`, `owner_id`, `note_id`)

projection consumerはcurrent routeを解決し、scopeのatomic snapshotとversion付きIdentity/Workspace current stateを読む。routeが`purging` / `tombstone`なら削除する。本体・tag表・FTSは1つのD1 batchで置換する。比較は階層化し、routeVersionが大きければowner context切替として残り3成分をリセットして受理、同routeVersion内だけ`(projection_revision, author_version, workspace_version)`を成分比較する。大小が混在するsnapshotは書かず、全sourceを読み直して再試行する。

### Scope infrastructure tables

#### scheduled_tasks

| カラム | 型 | 制約 |
| --- | --- | --- |
| `kind` | text | PK part |
| `operation_id` | text | PK part |
| `due_at` | integer | NOT NULL |
| `payload` | text | NOT NULL（JSON） |
| `attempts` | integer | NOT NULL DEFAULT 0 |
| `last_error` | text | NULL 可 |
| `priority` | integer | NOT NULL |
| `status` | text | NOT NULL, CHECK IN ('pending','running','failed') |

priorityは security cleanup / lease reaping = 0、outbox relay = 1、projection = 2、期限回収 = 3 とする。同じpriority内は `due_at`, `kind`, `operation_id` 順。Alarm turnはpriorityごとの最低枠を確保するweighted round-robinで処理し、低priorityの大量taskがsecurity cleanupを飢餓させない。

`workspace.deletionLocalContinued`はworkspace deletion operation IDをpayload/PKへ使い、beginDeletionと同じtransactionで初回を保存する。各manifest/local-delete pageもheader cursor/ackと同じtransactionで同じtaskを次時刻へupsertする。

indexes: Alarm時刻用 (`due_at`, `priority`, `kind`, `operation_id`)、dequeue用 (`priority`, `due_at`, `kind`, `operation_id`)。

#### membership_removal_locks

workspace scopeだけに置くaccount deletion prepareのlocal lock。

| カラム | 型 | 制約 |
| --- | --- | --- |
| `operation_id` | text | PK |
| `user_id` | text | NOT NULL, UNIQUE |
| `membership_id` | text | NOT NULL |
| `expected_membership_version` | integer | NOT NULL |
| `state` | text | NOT NULL, CHECK IN ('prepared','committed') |
| `expires_at` | integer | `prepared`ではNOT NULL、`committed`ではNULL |

prepared lockのTTLは10分で2分ごとにrenewする。期限切れをmembership mutationが勝手に無視せず、global operation recovery commandだけがrenew/releaseする。全scopeで残存5分以上を確認してcommittedへ遷移した後だけdestructive cleanupを始め、committed lockは自動失効しない。

#### workspace_deletion_manifests

workspace scopeだけに置く。headerは`operation_id` PK、`workspace_id` UNIQUE, `state` (`building` / `ready` / `localCleaning` / `globalCleaning` / `compacting` / `completed`), member/invitation cursorとtimestampsを持つ。`beginDeletion`はWorkspaceのlifecycle CASと同じtransactionでheaderを作る。itemsは(`operation_id`, `kind`, `route_key`) PKで、membership itemはuserIdとmembershipId、invitation itemはtokenHashとinvitationIdをpayloadに持ち、`local_deleted_at` / `global_acked_at`を別々に記録する。mutation lock下で各100件ずつ正データから固定し、local itemを100件ずつ削除してからRESTRICT下でWorkspaceを最後に消す。global orchestratorは1page100件・最大6接続でroute key shardへ直接deleteし、ack済みitemを再送してもno-opにする。完了時は`workspace.deletionManifestCompactContinued`がlocal/global双方のack済みitemsを1turn最大100件ずつ回収する。item 0件を確認した最後のtransactionだけがheaderを`completed` tombstoneへ移し、scope routingの保持期間以上残して遅延writeのadmissionを閉じ続ける。数千itemをheader遷移と同じtransactionで一括削除しない。

#### tag_operations / tag_operation_locks

`tag_operations` は `operation_id` PK、`kind` (`delete` / `merge` / `deleteUnused`)、source/target tag ID、`affected_count`、`processed_count`、`state` (`running` / `completed` / `failed` / `aborted`)、`last_error`、timestampsを持つ。`tag_operation_locks` は `tag_id` PK と `operation_id` FKを持ち、deleteは1行、mergeはsource/targetの2行をoperation開始と同じtransactionで確保する。aborted rowは同じabort要求へ冪等に応答するため保持する。

Alarm workerはassignmentまたはunused tagを1 turn最大200件だけ変更する。各pageのassignment変更、Note projection revision bump、local再投影task、public Queue用outbox、processed countを同じtransactionへ入れる。NoteごとのIDは `sha256("tagProjection:" + tagOperationId + ":" + plane + ":" + noteId + ":" + projectionRevision)` を使うため、同一page内の最大200件をplane別に保存しつつ応答喪失で増殖しない。retry上限ではoperation/taskをfailedにしてlockを保持する。同じoperation IDのretryは既存taskをpendingへ戻す。abortは`processed_count = 0`に限り、部分適用済みoperationはretryだけを許す。

#### job_removal_manifests

scope DOに置く。headerは`operation_id` PK、`parent_operation_id` NULL可、`root_job_id` UNIQUE, `requested_by`, `state` (`building` / `ready` / `localDeleted` / `globalCleaning` / `compacting` / `completed`), build cursor, `completed_at`, `expires_at`とtimestampsを持つ。operation IDはscope+root JobIdのhashであり、account deletion IDを複数familyのPKへ再利用しない。itemsは(`operation_id`, `job_id`) PKで`requested_by`, `target_type`, `target_id`, `acked_at`を保持する。root claimの`jobs.removal_operation_id`とheader作成を同一UoWで行い、root/最大500子を100件pageで固定してから、RESTRICT制約下でclaim ownerが子を100件ずつ削除し最後にrootを削除する。global consumerは未ack itemを先頭から最大100件読み、target route tombstone→history tombstone/remove→ackの順に進める。全ack後は`job.removalManifestCompactContinued`がitemsを1turn最大100件ずつ回収し、item 0件のtransactionだけがheaderをcompletedへ移す。headerだけを30日保持し、scope-local prunerが`expires_at, operation_id` keysetを1turn最大100件削除する。personal/workspace scope本体の削除でもglobal ackと30日縮約まではscope infrastructureを保持する。

#### scope_job_admission_leases

| カラム | 型 | 制約 |
| --- | --- | --- |
| `job_id` | text | PK, FK → `jobs.id` ON DELETE CASCADE |
| `lease_expires_at` | integer | NOT NULL |
| `created_at` / `updated_at` | integer | NOT NULL |

current scopeで `lease_expires_at > now` の行が4未満のときだけ、Job startと同じtransactionでinsertする。indexは (`lease_expires_at`, `job_id`)。progress時にJob leaseと同時にrenewし、全terminal transitionでdeleteする。reaperは期限切れを最大100件ずつ削除する。

#### move_authorization_locks

全scopeに置く。workspace targetではMembership version、personal targetではactive User versionを固定する。

| カラム | 型 | 制約 |
| --- | --- | --- |
| `migration_id` | text | PK |
| `actor_user_id` | text | NOT NULL |
| `membership_id` | text | workspace scopeではNOT NULL、user scopeではNULL |
| `expected_auth_version` | integer | NOT NULL（MembershipまたはUser version） |
| `note_id` | text | NOT NULL |
| `state` | text | NOT NULL, CHECK `state = 'staged'` |
| `created_at` | integer | NOT NULL |

target stageと同じtransactionで保存し、対象Membershipの降格・除名・脱退およびworkspace deletionと競合させる。target activateまたはswitch前abortだけが同じmigration IDで行を削除できる。`activated` 状態を残さず、行の存在そのものを未完了moveのlockとする。

#### applied_operations

| カラム | 型 | 制約 |
| --- | --- | --- |
| `operation_id` | text | PK |
| `kind` | text | NOT NULL |
| `result` | text | NOT NULL（同じ command の再試行へ返す JSON。**値を返すコマンドを足すスライスが使う**列） |
| `applied_at` | integer | NOT NULL |
| `expires_at` | integer | NULL可。進行中account deletion barrierはNULL |

この1表は実装では2つのポートに分かれる。barrier receiptを扱う`ScopeCleanupAdmissionStore`（`kind = 'accountDeletionBarrier'`）と、コマンドの重複排除を担う`AppliedOperationStore.markApplied`（`(operationId, commandKey)`）で、**鍵の意味でポートを分ける**（[ADR 045](../adr/045-idempotency-by-commutativity.md)。ポートの位置づけは [domains/index.md](../domains/index.md) の `ScopeKey と永続化境界`）。`markApplied` の 2 部鍵は列を増やさず、`operation_id` 1 列へ決定的に畳む（`sha256(operationId + ":" + commandKey)`）。同じ operation の 2 つ目のコマンドが PK 衝突しないのはこの導出によるもので、列を足さないのは barrier receipt と同居する表だからである。

`kind = 'accountDeletionBarrier'`はpersonal scopeの全通常write admissionを閉じる正本で、`result`に`{ state: running | completed, userId, componentAcks: { …宣言されたcomponentをキーとするマップ… } }`を持つ（キーは配備が宣言したcomponentであって、enum全体の固定列挙ではない）。各componentの最終pageは、残件があれば次task、0件なら自身のackを同じscope-local UoWで保存する。running中は`expires_at IS NULL`でAlarm prunerの対象外とする。prepare rejection時は同じoperation ownerを条件にrowを削除し、解除ack後だけUserをactiveへ戻す。**配備が宣言した全component**（composition rootがparticipant registryから実装へ渡す集合）のackが揃った場合だけcompleted commandを受け、`expires_at = completedAt + 120日`にする。宣言していないcomponentへダミーackを置かない（[ADR 039](../adr/039-cleanup-participants-declaration.md)）。このcommitと同じUoWで`identity.personalBarrierPruneContinued`を期限時刻へ登録する。scope全体のunrelated `scheduled_tasks` / outboxが空かどうかでは代用しない。Alarm prunerは`expires_at <= asOf`を最大100件ずつ消し、100件なら同じ固定`asOf`のtaskを再登録する。barrier作成・component ack・完了・回収・解除と通常writeは同じDOで直列化される。

鍵と秘密はテーブルに置かない。供給元（`AppConfig`）の定義と項目の一覧は [presentation/index.md](../presentation/index.md) を正典とする。

---

## リレーションと plane 境界

```
global D1:
users 1─n identities / sessions / auth_tokens / external_connections
users 1─n membership_directory n─1 workspace_directory
note_routes 1─1 public_note_search

scope DO:
workspaces 1─n memberships / invitations（workspace scope only）
notes 1─n note_revisions
tags 1─n tag_assignments
jobs 1─n jobs（parent / child は同じ scope）
```

ドメインまたは plane をまたぐ参照（外部キーなし）:

```
memberships.user_id        → users.id
notes.owner_id             → users.id または workspaces.id
notes.created_by           → users.id
notes.source_file_id       → stored_files.id
stored_files.owner_id      → users.id または workspaces.id
stored_files.note_id       → notes.id
tag_assignments.note_id    → notes.id
tags.scope_id              → users.id または workspaces.id
external_connections.user_id → users.id
backup_records.note_id     → notes.id
jobs.target_id             → notes.id または stored_files.id
storage_quotas.subject_id  → users.id または workspaces.id
note_search.note_id        → notes.id
note_search_tags.note_id   → notes.id
reference_import_attempts.note_id  → notes.id
reference_import_summaries.note_id → notes.id
```

同じ scope DO にある参照は local outbox + Alarm、global projection は Queue event、別 scope は operation command で後始末する。参照先が消えた行は「対象が存在しない」として扱う。

`notes.created_by`は退会者が作成したworkspace noteに残る。著者更新consumerはpayloadでなくcurrent Identity status/valueを毎回読み、遅延eventでも旧表示を戻さない。
`removing` edge は、その利用者に属する Job 正データ・BackupRecord と security cleanup が workspace scope から消えた ack を受けるまで削除しない。したがって account deletion と integration cleanup の scope 列挙は `pending` / `active` だけでなく `removing` も含める。edge が消えた workspace scope には利用者所有の後始末対象が残らないことを不変条件とする。
