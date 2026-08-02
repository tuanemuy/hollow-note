# データベース設計

対象は Cloudflare D1（SQLite）。保存先は確定している（[ADR 015](../adr/015-cloudflare-runtime.md)）。Drizzle でスキーマを定義し、マイグレーションは `apps/web/` の設定に従う。ただし `note_search_fts`（FTS5 仮想テーブル）と関連する raw SQL は Drizzle スキーマでは表現できないため、Drizzle スキーマ外の手書き SQL マイグレーションで管理する。

D1 の実上限と、そこから逆算した設計値（行サイズ予算・クエリ予算・キュー構成・定期実行）は [platform/index.md](../platform/index.md) を正典とする。本書は表と索引の定義を持ち、上限そのものは持たない。

## 共通の規約

- **ID**: すべて `text` の主キー。値は `IdGenerator` が採番する（UUIDv7 想定）
- **時刻**: `integer` に UNIX ミリ秒で格納する（Drizzle の `mode: "timestamp_ms"`）
- **真偽値**: `integer` の 0 / 1
- **列挙**: `text` に `CHECK` 制約を添える。判別ユニオンは判別子の列と、その値のときだけ非 NULL になる列の組で表す
- **楽観ロック**: 集約ルートのテーブルは `version integer NOT NULL DEFAULT 0` を持つ。更新は `WHERE version = :expected` で行い、0 行なら `ConflictError("OPTIMISTIC_LOCK_FAILURE")`
- **外部キー**: 同じドメイン内の親子には `ON DELETE CASCADE` を張る。ドメインをまたぐ参照には外部キーを張らず、イベント駆動で後始末する（集約の独立性を保つため）
- **削除**: ノートのゴミ箱以外に論理削除は使わない
- **正規化**: 書き込みモデルは第 3 正規形。非正規化は読み取りモデル（`note_search`）だけに閉じる（[ADR 009](../adr/009-read-models.md)）
- **行サイズ**: 1 行は 2,000,000 バイトを超えられない。可変長列を複数持つ表は、**それらの上限の合計が 2,000,000 バイトを下回ることを設計として示せること**（[ADR 017](../adr/017-content-size-budget.md)）。内訳は [platform/index.md](../platform/index.md) の「行サイズの予算」。大きな値は必ずバインド変数として渡す（SQL 文へ埋め込むと文の長さの上限 100,000 バイトに触れる）
- **バインド変数**: 1 クエリのバインド変数は 100 まで。**ID の並びで引く / 消す / 入れるクエリは `?` を件数ぶん並べない**。JSON 配列を 1 つのバインド変数として渡し、`json_each` で展開する。多行 INSERT も同じ形で 1 文にまとめる（[ADR 018](../adr/018-query-budget.md)）
- **原子性**: 集約でない表への「読んでから書く」更新は、**単一の SQL 文**で行う（`ON CONFLICT DO UPDATE … RETURNING` / `DELETE … RETURNING` / `INSERT … ON CONFLICT DO NOTHING`）。対象は `login_attempts` / `oauth_flow_states` / `processed_events`（[ADR 020](../adr/020-coordination-state.md)）

## テーブル一覧

| ドメイン | テーブル |
| --- | --- |
| Identity | `users`, `identities`, `sessions`, `auth_tokens`, `login_attempts` |
| Workspace | `workspaces`, `memberships`, `invitations` |
| Storage | `stored_files`, `reference_import_attempts`, `reference_import_summaries` |
| Note | `notes`, `note_revisions` |
| Tag | `tags`, `tag_assignments` |
| Integration | `external_connections`, `backup_records`, `oauth_flow_states` |
| Job | `jobs` |
| Usage | `storage_quotas`, `llm_usages` |
| 読み取りモデル | `note_search`, `note_search_tags`, `note_search_fts` |
| 基盤（既存） | `outbox_events`, `processed_events`, `_occ_guard` |

基盤の 3 表はテンプレート既存のものをそのまま使う。ただし `processed_events` は主キーを (`consumer`, `event_id`) に変更する（既存スキーマからの変更点）。重複排除の単位はイベントではなくコンシューマー × イベントであり（`IdempotencyStore.markProcessed(consumer, eventId)`。[domains/index.md](../domains/index.md)）、`event_id` 単独の主キーだと `note.purged` や `identity.user.deleted` のように購読者が複数いるイベントで最初の 1 コンシューマーだけが処理し、残りの後始末が丸ごと落ちる。`consumer` は購読ハンドラーを識別する文字列で、`event_id` は `outbox_events.id`。

基盤 3 表の**保持期間と掃除の方針は本設計のスコープ外**とする（意図的な線引き）。ディスパッチ済みの `outbox_events` と `processed_events` の刈り取りは、アウトボックス／リレーの仕組みそのものに属する運用であり、テンプレート側（`CLAUDE.md` のアウトボックス設計と各ランタイムの pruner）が持つ。本設計が定義するのは、業務データの保持期間（ジョブ履歴 90 日・ゴミ箱・生成物の TTL）に限る。

---

## Identity

### users

| カラム | 型 | 制約 |
| --- | --- | --- |
| `id` | text | PK |
| `email` | text | NOT NULL, UNIQUE |
| `status` | text | NOT NULL, CHECK IN ('pending','active') |
| `verified_at` | integer | `status = 'active'` のとき NOT NULL |
| `display_name` | text | NOT NULL |
| `bio` | text | NOT NULL DEFAULT '' |
| `avatar_url` | text | NULL 可 |
| `handle` | text | UNIQUE、NULL 可 |
| `version` | integer | NOT NULL DEFAULT 0 |
| `created_at` | integer | NOT NULL |
| `updated_at` | integer | NOT NULL |

- `email` は正規化済み（小文字）の値を格納する
- `handle` も正規化済み（小文字）の値を格納する
- **インデックス**: `users_handle_idx` (`handle`) — UNIQUE で兼ねる。サイトマップ用の列挙は読み取りモデル（`note_search`）が担うため、`status` を含む複合インデックスは持たない

**CHECK**: `(status = 'pending' AND verified_at IS NULL) OR (status = 'active' AND verified_at IS NOT NULL)`

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

- **インデックス**: `identities_user_idx` (`user_id`)、`identities_provider_account_uq` UNIQUE (`provider`, `provider_account_id`)、`identities_user_password_uq` UNIQUE (`user_id`) WHERE `kind = 'password'`（1 利用者 1 件の制約）
- **CHECK**: `kind` に応じた列の NULL / NOT NULL の対応

### sessions

| カラム | 型 | 制約 |
| --- | --- | --- |
| `id` | text | PK |
| `user_id` | text | NOT NULL, FK → `users.id` ON DELETE CASCADE |
| `token_hash` | text | NOT NULL, UNIQUE |
| `created_at` | integer | NOT NULL |
| `expires_at` | integer | NOT NULL |

- 版を持たない（[domains/identity.md](../domains/identity.md) のとおり）
- **更新されない**。`expires_at` はサインイン時に `Session.ttlMs`（30 日）で確定する絶対期限で、以後書き換わらない。最終使用時刻の列を持たないのは、読む経路（セッション一覧・端末管理）が存在せず、認証要求のたびに書き込むコストだけが残るため（[domains/identity.md](../domains/identity.md) の「有効期間」）
- **インデックス**: `sessions_user_idx` (`user_id`)、`sessions_expires_idx` (`expires_at`) — 期限切れの一括削除用

### auth_tokens

| カラム | 型 | 制約 |
| --- | --- | --- |
| `id` | text | PK |
| `user_id` | text | NOT NULL, FK → `users.id` ON DELETE CASCADE |
| `purpose` | text | NOT NULL, CHECK IN ('email_verification','password_reset') |
| `token_hash` | text | NOT NULL, UNIQUE |
| `status` | text | NOT NULL, CHECK IN ('pending','consumed') |
| `consumed_at` | integer | `status = 'consumed'` のとき NOT NULL |
| `created_at` | integer | NOT NULL |
| `expires_at` | integer | NOT NULL |

- **インデックス**: `auth_tokens_user_purpose_idx` (`user_id`, `purpose`)、`auth_tokens_expires_idx` (`expires_at`)

### login_attempts

| カラム | 型 | 制約 |
| --- | --- | --- |
| `key` | text | PK（`LoginAttemptKey` が組み立てる `{namespace}:{subject}:{clientKey}`） |
| `failure_count` | integer | NOT NULL DEFAULT 0 |
| `last_failed_at` | integer | NULL 可 |
| `expires_at` | integer | NOT NULL |

- **インデックス**: `login_attempts_expires_idx` (`expires_at`)
- **ロックの状態は列に持たない**。ロックは `failure_count` と `last_failed_at` から `LoginThrottlePolicy.evaluate` が導出する（[domains/identity.md](../domains/identity.md)）。保存しないのは、失敗回数の加算を単一の SQL 文にするためである — 書き込む値が読んだ値に依存しなければ「読んでから書く」形を避けられ、しきい値の規則を SQL に持ち込まずに済む（[ADR 020](../adr/020-coordination-state.md)）
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
| `slug` | text | UNIQUE、NULL 可 |
| `publication` | text | NOT NULL, CHECK IN ('private','published') |
| `published_at` | integer | `publication = 'published'` のとき NOT NULL |
| `version` | integer | NOT NULL DEFAULT 0 |
| `created_at` | integer | NOT NULL |
| `updated_at` | integer | NOT NULL |

- **CHECK**: `publication = 'published'` なら `slug IS NOT NULL AND published_at IS NOT NULL`
- **インデックス**: `workspaces_publication_slug_idx` (`publication`, `slug`) — 公開ページの列挙用

### memberships

| カラム | 型 | 制約 |
| --- | --- | --- |
| `id` | text | PK |
| `workspace_id` | text | NOT NULL, FK → `workspaces.id` ON DELETE CASCADE |
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
| `workspace_id` | text | NOT NULL, FK → `workspaces.id` ON DELETE CASCADE |
| `email` | text | NOT NULL |
| `role` | text | NOT NULL, CHECK IN ('owner','editor','viewer') |
| `invited_by` | text | NOT NULL |
| `token_hash` | text | NOT NULL, UNIQUE |
| `status` | text | NOT NULL, CHECK IN ('pending','accepted','revoked') |
| `accepted_at` | integer | `status = 'accepted'` のとき NOT NULL |
| `accepted_by` | text | `status = 'accepted'` のとき NOT NULL |
| `revoked_at` | integer | `status = 'revoked'` のとき NOT NULL |
| `version` | integer | NOT NULL DEFAULT 0 |
| `created_at` | integer | NOT NULL |
| `expires_at` | integer | NOT NULL |

- **インデックス**: `invitations_pending_uq` UNIQUE (`workspace_id`, `email`) WHERE `status = 'pending'`、`invitations_workspace_created_idx` (`workspace_id`, `created_at` DESC) — 一覧と、直近 24 時間の発行数によるレート制限の両方に使う

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
| `share_token_hash` | text | UNIQUE、NULL 可 |
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

共有リンクは休眠状態でも列に残す。`visibility = 'unlisted'` のときだけ「有効なリンク」として扱う。

- **CHECK**:
  - `content_status = 'ready'` なら本文 4 列が NOT NULL、そうでなければすべて NULL
  - `content_status = 'failed'` なら `content_failure_reason IS NOT NULL`
  - `content_failure_reason` は `NoteFailureReason` の 11 値（`unsupportedFormat` / `corruptedFile` / `machineExtractionUnavailable` / `providerAuthFailed` / `modelError` / `quotaExceeded` / `timeout` / `sizeExceeded` / `passwordProtected` / `unknown` / `canceled`）に限る。`ConversionFailureReason` から `integrationRequired` を除き、`canceled` を加えた集合である。`integrationRequired` を除くのは「未連携は本文の失敗理由にしない（`awaitingIntegration` が担う）」という型の意図を DB でも弾けるようにするため。`canceled` は強制終端の後始末（[usecases/job.md](../usecases/job.md) の「共通: 強制終端の後始末」）で `processing` のまま残るノートを回復させるときにだけ書かれる値で、変換の実行が返すことはないため `ConversionFailureReason` には含まれない（[domains/note.md](../domains/note.md)）
  - `visibility = 'unlisted'` なら `share_token_hash IS NOT NULL`
  - `share_password_hash` と `share_password_updated_at` は両方 NULL または両方 NOT NULL（ドメインの `password: { hash; updatedAt } | null` に対応。片方だけが埋まった行を作れないようにする）
  - `visibility = 'public'` なら `share_password_hash IS NULL AND published_at IS NOT NULL`
  - `visibility IN ('unlisted','public')` なら `content_status = 'ready'`
  - `lifecycle = 'trashed'` なら `trashed_at IS NOT NULL AND purge_after IS NOT NULL`
- **インデックス**:
  - `notes_owner_lifecycle_updated_idx` (`owner_type`, `owner_id`, `lifecycle`, `updated_at` DESC) — 一覧の既定順
  - `notes_share_token_idx` (`share_token_hash`) — UNIQUE で兼ねる
  - `notes_purge_idx` (`purge_after`) WHERE `lifecycle = 'trashed'` — 期限切れゴミ箱の回収

`source_file_id` と、公開ノートの列挙のためのインデックスは持たない。元ファイルからノートを引く経路は `stored_files.note_id`（`listByNote` / `findArtifactByNoteAndVersion`）に一本化されており、`notes.source_file_id` は引かれる側ではなくノートから元ファイルを指す参照としてのみ使う。公開ノートの列挙（横断検索・公開ページ・サイトマップ）はすべて読み取りモデルの責務で、`note_search_public_updated_idx` / `note_search_owner_public_updated_idx` と `listPublicSitemapEntries` が担う。

月・日ごとの集計（アーカイブ）も読み取りモデルの責務であり、`note_search_owner_lifecycle_created_idx` が担う。書き込みモデルには作成日時のインデックスを持たない。

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

サインイン用と連携用の両方の認可フローが使う。短期の一時データ。

| カラム | 型 | 制約 |
| --- | --- | --- |
| `state` | text | PK |
| `provider` | text | NOT NULL |
| `code_verifier` | text | NOT NULL |
| `intent` | text | NOT NULL, CHECK IN ('signIn','linkIdentity','integration') |
| `user_id` | text | NULL 可 |
| `redirect_to` | text | NULL 可 |
| `created_at` | integer | NOT NULL |
| `expires_at` | integer | NOT NULL |

- **CHECK**: `intent IN ('linkIdentity','integration')` なら `user_id IS NOT NULL`
- **インデックス**: `oauth_flow_states_expires_idx` (`expires_at`)

---

## Job

### jobs

| カラム | 型 | 制約 |
| --- | --- | --- |
| `id` | text | PK |
| `parent_id` | text | NULL 可, FK → `jobs.id` ON DELETE CASCADE |
| `kind` | text | NOT NULL, CHECK IN（`JobKind` の 11 値） |
| `payload` | text | NOT NULL（JSON。`JobPayload` を格納） |
| `target_type` | text | NOT NULL, CHECK IN ('note','storedFile','batch') |
| `target_id` | text | `target_type != 'batch'` のとき NOT NULL |
| `requested_by` | text | NULL 可 |
| `scope_type` | text | NOT NULL, CHECK IN ('user','workspace') |
| `scope_id` | text | NOT NULL |
| `status` | text | NOT NULL, CHECK IN ('queued','running','succeeded','failed','canceled') |
| `attempts` | integer | NOT NULL DEFAULT 0, CHECK `attempts >= 0` |
| `progress_completed` | integer | `status = 'running'` のとき NOT NULL |
| `progress_total` | integer | `status = 'running'` のとき NOT NULL |
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

`scope_type` / `scope_id` は `Job.enqueue` / `Job.enqueueBatch` がどちらも必須引数で受け取る `JobScope`（[domains/job.md](../domains/job.md)）に対応し、両列とも NOT NULL。ただし「親ジョブと子ジョブの `scope` は一致する」「batch 親の `scope` は単一である」という不変条件（[domains/job.md](../domains/job.md)）は行をまたぐため DB 制約では表現できず、対象を ID の並びで受け取る登録ユースケースの検査（混在なら子を 1 件も作らずに `ValidationError("MIXED_OWNER_SCOPE")`。[usecases/job.md](../usecases/job.md) の「共通: 登録時の scope の決定」）が唯一の防御になる。

- **CHECK**:
  - `target_type = 'batch'` なら `target_id IS NULL`、そうでなければ `target_id IS NOT NULL`
  - `requested_by IS NULL` なら `kind = 'pdfExport' AND parent_id IS NULL`
  - `status = 'succeeded'` 以外なら `artifact_file_id IS NULL`
  - `status = 'succeeded'` 以外なら `notices IS NULL`
  - `status IN ('running','succeeded')` なら `started_at IS NOT NULL`
  - `status IN ('succeeded','failed','canceled')` なら `finished_at IS NOT NULL`
  - `status = 'running'` なら `progress_completed IS NOT NULL AND progress_total IS NOT NULL AND progress_completed <= progress_total`
  - `status = 'running'` なら `lease_expires_at IS NOT NULL`
  - `status = 'failed'` なら `failure_reason IS NOT NULL AND failure_detail IS NOT NULL`
  - `failure_reason` は `JobFailureReason` の 14 値に限る。`notes.content_failure_reason` の 11 値から `canceled` を除いた 10 値に `integrationRequired` / `permissionRevoked` / `targetMissing` / `storageError` を加えた集合であり、`ConversionFailureReason` の全 11 値を含む上位集合になる。`canceled` を持たないのは、取り消しを `Job.cancel` が `failure` を持たない `CanceledJob` として表すため `fail` に渡す理由にならないからである（[domains/job.md](../domains/job.md)、[ADR 012](../adr/012-job-execution-resilience.md)）
- **インデックス**:
  - `jobs_requester_parents_created_idx` (`requested_by`, `created_at` DESC) WHERE `requested_by IS NOT NULL AND parent_id IS NULL` — 履歴の一覧の既定（`parentsOnly: true`）
  - `jobs_requester_created_idx` (`requested_by`, `created_at` DESC) WHERE `requested_by IS NOT NULL` — 履歴の一覧で `parentsOnly: false` を選んだとき（匿名ジョブはどちらにも載らない）
  - `jobs_requester_active_idx` (`requested_by`, `kind`) WHERE `status IN ('queued','running') AND requested_by IS NOT NULL` — 実行中件数（`listActiveByRequester` / `countActiveByKind`）
  - `jobs_parent_idx` (`parent_id`) — 子ジョブの列挙と集計
  - `jobs_target_active_idx` (`target_type`, `target_id`) WHERE `status IN ('queued','running')` — 多重実行の抑止
  - `jobs_scope_active_idx` (`scope_type`, `scope_id`) WHERE `status IN ('queued','running')` — ワークスペース削除時の一括キャンセル
  - `jobs_lease_idx` (`lease_expires_at`) WHERE `status = 'running'` — リーパーの `listExpiredRunning`（リース失効した `running` の回収）
  - `jobs_finished_idx` (`finished_at`) WHERE `finished_at IS NOT NULL AND parent_id IS NULL` — 保持期間切れの削除（`deleteOlderThan`）

`jobs_finished_idx` に `parent_id IS NULL` を含めるのは、履歴の削除の起点が**親を持たないジョブ**に限られるためである（[usecases/job.md](../usecases/job.md) の `pruneJobHistory`）。子は `parent_id` の外部キー CASCADE で親と一緒に消えるので、削除クエリが `finished_at < cutoff AND parent_id IS NULL` で引く行だけを索引に載せればよい。子の行（一括操作では親の数十〜数百倍になりうる）を索引から外せるぶん小さくなる。

履歴の一覧の索引を 2 本に分けるのも同じ理由による。`listJobs` の `parentsOnly` は既定が `true` で（[usecases/job.md](../usecases/job.md)）、既定のクエリは `requested_by = ? AND parent_id IS NULL ORDER BY created_at DESC` になる。`jobs_requester_parents_created_idx` はこの述語をそのまま部分索引に写したもので、`jobs_finished_idx` と同じく子の行を丸ごと索引から外す。`parentsOnly: false` は `requested_by` だけで絞った 1 本の並びを `created_at` 順に読む必要があり、部分索引では順序を作れないため、全行を載せた `jobs_requester_created_idx` を別に持つ。非既定の絞り込みのためだけに既定のクエリへ子の行を負担させないことを優先した判断で、書き込み側の索引更新は 1 本ぶん増える。

`jobs_requester_active_idx` の第 2 列を `status` ではなく `kind` にするのは、述語（`status IN ('queued','running')`）が既に未終端の行だけに限っているためである。`listActiveByRequester` は未終端をすべて返すので `status` で絞る必要がなく、`countActiveByKind(userId, kind)`（`requestBulkExport` の同時実行数。[domains/job.md](../domains/job.md)）だけが第 2 列での絞り込みを要求する。両者とも `requested_by` の左端一致で引け、後者は `kind` まで使い切れる。

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
| `created_at` | integer | NOT NULL |
| `updated_at` | integer | NOT NULL |
| `trashed_at` | integer | NULL 可 |
| `purge_after` | integer | NULL 可 |

- 版を持たない（投影は現在の状態からの冪等な上書き。並行実行がないことは [ADR 016](../adr/016-projection-single-writer.md) が保証する）
- 通常の rowid 表として作る。`note_search_fts` の行を `note_search.rowid` で対応づけるため、`WITHOUT ROWID` にしてはならない
- **bigram 前処理済みのテキストは列に持たない**。FTS5 は contentless 構成で、前処理済みのテキストは索引の中だけに存在する（[ADR 017](../adr/017-content-size-budget.md)）。索引を書き換えるときの旧値は、生テキスト列に前処理関数を再適用して求める
- `tag_names` は `ProjectedTagName.normalized` を `tag_display_names` と同じく改行（`\n`）で連結する。区切り文字は改行に固定する — この列は FTS の `tag_names_fts` 列に入れる bigram の入力であり、bigram 前処理は CJK run と非 CJK を文字クラスで分けるだけなので、区切りが CJK 文字や英数字だと隣接するタグの末尾と先頭が 1 トークンに融合し、bm25 のタグ名列の関連度が壊れる。改行は前処理の非 CJK 側で空白と同じ区切りとして働き、`TagName` が改行を含まない（[domains/tag.md](../domains/tag.md)）ため融合が起きない
- `tag_display_names` は `NoteSummary.tagNames` / `PublicNoteSummary.tagNames`（表示名。正規化前）を一覧の 1 クエリで返すための列。`ProjectedTagName.name` を改行（`\n`）で連結する — `TagName` は改行を含めないため（[domains/tag.md](../domains/tag.md)）分割は一意に戻せる。並び順は `tag_names` と同じ（`updateTags` が同一の配列から両列を組み立てる）。検索の対象ではなく、FTS にも `note_search_tags` にも入れない。絞り込みは正規化名（`note_search_tags.normalized`）だけで行うため、表示ゆれは検索結果に影響しない
- `author_*` 列は `created_by` の利用者を指す（ワークスペース所有ノートでも作成者を表示する）。`NoteProjectionEntry` の `author` / `workspace` は `upsert` の呼び出し側が投影のたびに解決して渡すため（[domains/note.md](../domains/note.md)）、初回投影（`note.created` / `note.moved`）から必ず値が入り、既定値に頼らない
- **インデックス**:
  - `note_search_owner_lifecycle_updated_idx` (`owner_type`, `owner_id`, `lifecycle`, `updated_at` DESC)
  - `note_search_owner_lifecycle_created_idx` (`owner_type`, `owner_id`, `lifecycle`, `created_at` DESC)
  - `note_search_owner_lifecycle_title_idx` (`owner_type`, `owner_id`, `lifecycle`, `title`)
  - `note_search_public_updated_idx` (`updated_at` DESC) WHERE `visibility = 'public' AND lifecycle = 'active'` — 公開ノートの横断検索（DS-05）とサイトマップ。`PublicSearchCriteria.updatedWithin` の期間絞り込みも先頭列の範囲走査で兼ねる
  - `note_search_owner_public_updated_idx` (`owner_type`, `owner_id`, `updated_at` DESC) WHERE `visibility = 'public' AND lifecycle = 'active'` — 公開ページ（P-42 / P-43）の一覧・検索と、サイトマップ用の公開著者の列挙。ハンドル / スラッグを所有者に解決してから `ownerFilter` で絞る現行フロー（[usecases/note.md](../usecases/note.md) の `searchPublicNotes`）と、所有者基準の母集合を `owner_id` 昇順で走査する `listPublicAuthors`（[usecases/identity.md](../usecases/identity.md) の `listPublicProfiles`）の両方が使う。後者は `owner_type = 'user'` に固定した左端一致で `owner_id` ごとの最新 `updated_at` を取るため、この索引の並びのまま追加の索引なしに引ける
  - `note_search_created_by_idx` (`created_by`) — `updateAuthor` の対象行（`created_by` がその利用者であるすべての行）の特定

公開検索の期間絞り込みに専用の索引は要らない。`PublicSearchCriteria` の期間指定は `updatedWithin: DateRange`（`note_search.updated_at` に対する半開区間。[domains/note.md](../domains/note.md)）に固定されており、絞り込む列が公開用 2 索引の並べ替え列と同一であるため、`note_search_public_updated_idx`（横断検索）と `note_search_owner_public_updated_idx`（公開ページ内の検索）のどちらも、既定の `updated_at` 降順の走査をそのまま範囲に切り詰めるだけで済む。

個人検索（`searchNotes`）の `createdWithin` は事情が異なり、**範囲列と並べ替え列が一致しない**。範囲は `created_at` に対して掛かるが、既定のソートは `updatedDesc`（キーワードがあれば `relevance`）で、並び順は月の絞り込みとは独立に利用者が選ぶ（P-10 の「月絞り込み」と「並び順の変更」は別のコントロール）。1 本の索引で絞り込みと並べ替えの両方を賄うことはできないので、役割を次のように分ける。

- `note_search_owner_lifecycle_created_idx` は**母集合の切り出し**を担う。左端 3 列（`owner_type` / `owner_id` / `lifecycle`）の等価一致に `created_at` の範囲を重ね、選んだ月の行だけを読む。`sort` が `createdDesc` / `createdAsc` のときはこの並びがそのまま答えになり、並べ替えが要らない
- `updatedDesc` / `updatedAsc` / `titleAsc` / `titleDesc` を選んだ場合は、切り出した行を並べ替える（一時 B-tree ソート）。読む行が 1 所有者・1 か月ぶんに限られるため許容できる。月を選んでいない状態（`createdWithin` が `null`）では範囲がないぶん `note_search_owner_lifecycle_updated_idx` / `note_search_owner_lifecycle_title_idx` が並べ替え込みでそのまま効く
- `relevance` は `note_search_fts` の `bm25` 順であり、どの B-tree 索引も並べ替えには使えない。この経路では FTS 側が母集合を作り、`created_at` の範囲と所有者・`lifecycle` は取り出した行に対する絞り込みとして働く

同じ索引は `listMonthsWithNotes` / `countByDay`（OR-02 のカレンダーと OR-05 の月セレクター）も使う。こちらは並べ替えを伴わない集計なので、範囲走査だけで完結する。

`content_status` を含む索引は持たない。この列で絞る唯一の経路は `countByContentStatus(owner, status)` で、呼び出し元は `completeIntegrationOAuth`（[usecases/integration.md](../usecases/integration.md)）の「要 LLM 連携の N 件」の案内 1 か所だけである。所有者プレフィックス（`note_search_owner_lifecycle_updated_idx` の左端 2 列 `owner_type` / `owner_id`。`countByContentStatus` の引数は所有者と本文状態だけで `lifecycle` を取らないため、等価一致で使えるのはここまで）で 1 利用者・1 ワークスペースぶんまで絞れたあとに `content_status` を数え上げる形になり、OAuth の完了時にしか走らない頻度に対して十分に速い。投影表は既に 6 本の索引を持ち、書き込みは 1 ノートの変化ごとに走るため、この頻度の読み取りのために索引を足す取引にはならないと判断した。

`workspace_slug` を先頭にした公開用の索引は持たない。ワークスペースの公開ページは `searchPublicNotes` がスラッグを所有者に解決してから `ownerFilter` で引くため、`note_search` 側でスラッグから直接引く経路が存在しない。同じ理由で `author_handle` を先頭にした公開用の索引（`note_search_author_public_idx`）も持たない — 公開プロフィールの母集合が所有者基準に統一され（[usecases/identity.md](../usecases/identity.md) の `listPublicProfiles`）、著者基準の列挙が消えたことで、`author_handle` から直接引く経路がなくなったためである。`author_handle` は公開ノートの著者表示のための列として残り、書き手側（`updateAuthor` / ハンドル変更の投影）は `note_search_created_by_idx` で対象行を引く。

### note_search_tags

タグの AND 絞り込み用の正規化表。`note_search` と同じくプロジェクションが更新する。

| カラム | 型 | 制約 |
| --- | --- | --- |
| `note_id` | text | NOT NULL |
| `normalized` | text | NOT NULL（正規化済みタグ名） |

- **主キー**: (`normalized`, `note_id`) — タグ名から対象ノートを引く向きに最適化
- **インデックス**: `note_search_tags_note_idx` (`note_id`) — ノート単位の入れ替え（`updateTags`）と削除（`remove`）用
- 版を持たない（投影は現在の状態からの冪等な上書き）
- タグの AND 絞り込みは本表への JOIN（関係除算。または `INTERSECT`）による完全一致で行う。`note_search.tag_names` と FTS の `tag_names_fts` 列はキーワード検索の関連度に寄与させるためのものであり、絞り込みには使わない

#### タグ列の同期契約

タグは `note_search.tag_names`（関連度用）・`note_search_tags`（絞り込み用）・`note_search.tag_display_names`（表示用）の 3 か所と、FTS 索引の `tag_names_fts` 列に投影される。書き手は [domains/note.md](../domains/note.md) の分掌のとおり固定する。

- `NoteProjectionWriter.updateTags(noteId, tags: readonly { name; normalized }[])` が唯一の書き手。ノートのタグ集合を丸ごと入れ替え、3 列と FTS 索引を同一バッチ（D1 の `batch()`）で更新する。`tag_names` / `note_search_tags.normalized` には `normalized` を、`tag_display_names` には `name` を使う。連結列（`tag_names` / `tag_display_names`）の区切りはどちらも改行（`\n`）で、同一の並び順で組み立てる。FTS の `tag_names_fts` 列へは `tag_names` に bigram 前処理を適用した値を入れる。`note_search_tags` は当該 `note_id` の行を全削除してから入れ直す
- `upsert` はタグの 3 列に**一切触れない**。`NoteProjectionEntry` にタグのフィールドがないためタグを再構築できず、逆にノート本体の投影でタグが消えることもない。FTS 索引は 3 列を 1 行として持つため取り消し → 再挿入の際に `tag_names_fts` の値が要るが、そこへは `note_search.tag_names`（現在値）から前処理関数で求めた値を入れる。タグを伴う投影の再構築は `upsert` と `updateTags` の 2 呼び出しで行う（[usecases/note.md](../usecases/note.md) の `rebuildNoteProjection`）
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
- SQL トリガーでは同期しない。`NoteProjectionWriter`（アダプター）の各メソッドが `note_search` 本体・`note_search_tags`・FTS の同期まで責任を持ち、D1 の `batch()`（暗黙トランザクション）1 バッチで書く。更新・削除では先に `INSERT INTO note_search_fts(note_search_fts, rowid, title_fts, text_fts, tag_names_fts) VALUES('delete', :rowid, :oldTitleFts, :oldTextFts, :oldTagNamesFts)` で旧行を取り消してから新しい行を入れる
- **取り消しに渡す旧値は保存していないので、生テキスト列から前処理関数を再適用して求める**（`note_search.title` / `text` / `tag_names` を読み、後述の bigram 前処理を通す）。前処理は純関数なので、書き込み時に入れた値と必ず一致する
- `updateAuthor` / `updateWorkspace` は FTS 対象列に触れないため FTS 更新は不要。`upsert` は `title_fts` / `text_fts` を新しい値にし、`tag_names_fts` は `note_search.tag_names`（現在値）から求めた値を入れる（前節「タグ列の同期契約」）
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
- `highlightedExcerpt` は型のとおり 1 本の文字列で返す。`excerpt` / `text` は本文から抽出した**平文**なので、まず HTML エスケープしてから一致区間を `<mark>` … `</mark>` で囲む。標識を入れる側がエスケープまで責任を持つことで、表示層はこの値だけを HTML として描ける（素の `excerpt` は従来どおり平文として扱う）

#### 移行と再構築

- trigram + トリガー同期の旧構成からの移行は、トリガー 3 本の `DROP TRIGGER` → FTS 表の再作成（contentless 構成）→ `rebuildNoteProjection` の順で行う
- `tag_display_names` のような投影列の追加は、既定値付きで列を足してから `rebuildNoteProjection`（`upsert` + `updateTags` の 2 呼び出し）で埋める。`updateTags` が唯一の書き手であるため、`upsert` だけの再投影では埋まらない
- **`INSERT INTO note_search_fts(note_search_fts) VALUES('rebuild')` は contentless では使えない**（読み直す content 表がない）。一括再構築は FTS 表を作り直したうえで、`rebuildNoteProjection` が 1 件ずつ積む再投影要求で埋め直す（[ADR 016](../adr/016-projection-single-writer.md)）。`INSERT INTO note_search_fts(note_search_fts) VALUES('integrity-check')` は使えるが、検査できるのは索引の内部整合性だけで、`note_search` との一致は検査できない。両者の一致は `rebuildNoteProjection` の孤児掃除が担う

#### 既知の限界

テストケースは「ヒットしてよい」側で書く。

- 句読点・空白のみの境界をまたぐ偽陽性がある（「日本。本語」が「日本語」にヒットする。bm25 で下位に沈む）
- 英単語の中間部分一致は失われる（`flare` で Cloudflare は引けない。前方一致 `cloud*` は可能）
- クエリ内の 1 文字 CJK run は unigram の挙動になる
- ハイライトの一致位置は生テキストへの部分一致で求めるため、FTS のヒットと必ずしも一致しない。境界をまたぐ偽陽性の行や、タイトル・タグ名だけで一致した行では `highlightedExcerpt` が `null` になる（前節「ハイライトと抜粋の生成」）

鍵と秘密はテーブルに置かない。供給元（`AppConfig`）の定義と項目の一覧は [presentation/index.md](../presentation/index.md) を正典とする。

---

## リレーションの図

```
users 1─n identities
users 1─n sessions
users 1─n auth_tokens
workspaces 1─n memberships
workspaces 1─n invitations
notes 1─n note_revisions
tags 1─n tag_assignments
jobs 1─n jobs（親子）
```

ドメインをまたぐ参照（外部キーなし）:

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

これらは外部キーを張らず、`identity.user.deleted` / `workspace.deleted` / `note.purged` などのイベントを購読するワーカーが後始末する。参照先が消えている行を読んだ場合は「対象が存在しない」として扱う。例外は `notes.created_by`（および投影先の `note_search.created_by`）で、退会した作成者のワークスペース所有ノートは行ごと残し、作成者を「退会した利用者」と表示する。この表示を書き込むのは `projectNoteChanges` の `identity.user.deleted` 分岐で、`NoteProjectionWriter.updateAuthor(userId, "退会した利用者", null)` が `created_by` の一致する全行の `author_display_name` / `author_handle` を置き換える（行は消さない。個人所有ノートの行は `deleteNotesForOwner` が発行する `note.purged` 経由で消える）。退会後に本文更新・移動で `upsert` が走る場合も、呼び出し側が同じ既定値を解決して渡すため旧表示名は復活しない（[usecases/note.md](../usecases/note.md) の `projectNoteChanges`）。
