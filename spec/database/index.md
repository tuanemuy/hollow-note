# データベース設計

対象は Cloudflare D1（SQLite）。Drizzle でスキーマを定義し、マイグレーションは `apps/web/` の設定に従う。

## 共通の規約

- **ID**: すべて `text` の主キー。値は `IdGenerator` が採番する（UUIDv7 想定）
- **時刻**: `integer` に UNIX ミリ秒で格納する（Drizzle の `mode: "timestamp_ms"`）
- **真偽値**: `integer` の 0 / 1
- **列挙**: `text` に `CHECK` 制約を添える。判別ユニオンは判別子の列と、その値のときだけ非 NULL になる列の組で表す
- **楽観ロック**: 集約ルートのテーブルは `version integer NOT NULL DEFAULT 0` を持つ。更新は `WHERE version = :expected` で行い、0 行なら `ConflictError("OPTIMISTIC_LOCK_FAILURE")`
- **外部キー**: 同じドメイン内の親子には `ON DELETE CASCADE` を張る。ドメインをまたぐ参照には外部キーを張らず、イベント駆動で後始末する（集約の独立性を保つため）
- **削除**: ノートのゴミ箱以外に論理削除は使わない
- **正規化**: 書き込みモデルは第 3 正規形。非正規化は読み取りモデル（`note_search`）だけに閉じる（[ADR 009](../adr/009-read-models.md)）

## テーブル一覧

| ドメイン | テーブル |
| --- | --- |
| Identity | `users`, `identities`, `sessions`, `auth_tokens`, `login_attempts` |
| Workspace | `workspaces`, `memberships`, `invitations` |
| Storage | `stored_files` |
| Note | `notes`, `note_revisions` |
| Tag | `tags`, `tag_assignments` |
| Integration | `external_connections`, `backup_records`, `oauth_flow_states` |
| Job | `jobs` |
| Usage | `storage_quotas`, `llm_usages` |
| 読み取りモデル | `note_search`, `note_search_fts` |
| 基盤（既存） | `outbox_events`, `processed_events`, `_occ_guard` |

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
- **インデックス**: `users_handle_idx` (`handle`) — UNIQUE で兼ねる。`users_status_handle_idx` (`status`, `handle`) — サイトマップ用の列挙

**CHECK**: `(status = 'pending' AND verified_at IS NULL) OR (status = 'active' AND verified_at IS NOT NULL)`

### identities

| カラム | 型 | 制約 |
| --- | --- | --- |
| `id` | text | PK |
| `user_id` | text | NOT NULL, FK → `users.id` ON DELETE CASCADE |
| `kind` | text | NOT NULL, CHECK IN ('password','oauth') |
| `password_hash` | text | `kind = 'password'` のとき NOT NULL |
| `provider` | text | `kind = 'oauth'` のとき NOT NULL |
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
| `last_used_at` | integer | NOT NULL |

- 版を持たない（[domains/identity.md](../domains/identity.md) のとおり）
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
| `key` | text | PK（メールアドレスと発信元の組から導く） |
| `failure_count` | integer | NOT NULL DEFAULT 0 |
| `last_failed_at` | integer | NULL 可 |
| `locked_until` | integer | NULL 可 |
| `expires_at` | integer | NOT NULL |

- **インデックス**: `login_attempts_expires_idx` (`expires_at`)

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
| `uploaded_by` | text | NOT NULL |
| `purpose` | text | NOT NULL, CHECK IN ('source','media','reference','artifact','avatar') |
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

- **CHECK**: `purpose = 'artifact'` なら `retention = 'ephemeral'`。`retention = 'ephemeral'` なら `expires_at IS NOT NULL AND expires_at > created_at`
- **インデックス**: `stored_files_owner_idx` (`owner_type`, `owner_id`, `purpose`)、`stored_files_owner_checksum_idx` (`owner_type`, `owner_id`, `checksum_value`) — 重複保管の回避、`stored_files_expires_idx` (`expires_at`) WHERE `retention = 'ephemeral'` — 期限切れの回収、`stored_files_purpose_created_idx` (`purpose`, `created_at`) — 孤児メディアの走査

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
| `content_failure_reason` | text | `content_status = 'failed'` のとき NOT NULL |
| `visibility` | text | NOT NULL, CHECK IN ('private','unlisted','public') |
| `published_at` | integer | `visibility = 'public'` のとき NOT NULL |
| `share_token_hash` | text | UNIQUE、NULL 可 |
| `share_password_hash` | text | NULL 可 |
| `share_password_updated_at` | integer | `share_password_hash` が NOT NULL のとき NOT NULL |
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
  - `visibility = 'unlisted'` なら `share_token_hash IS NOT NULL`
  - `visibility = 'public'` なら `share_password_hash IS NULL AND published_at IS NOT NULL`
  - `visibility IN ('unlisted','public')` なら `content_status = 'ready'`
  - `lifecycle = 'trashed'` なら `trashed_at IS NOT NULL AND purge_after IS NOT NULL`
- **インデックス**:
  - `notes_owner_lifecycle_updated_idx` (`owner_type`, `owner_id`, `lifecycle`, `updated_at` DESC) — 一覧の既定順
  - `notes_share_token_idx` (`share_token_hash`) — UNIQUE で兼ねる
  - `notes_purge_idx` (`purge_after`) WHERE `lifecycle = 'trashed'` — 期限切れゴミ箱の回収
  - `notes_owner_created_idx` (`owner_type`, `owner_id`, `created_at`) — 月・日ごとの集計
  - `notes_source_file_idx` (`source_file_id`)
  - `notes_public_updated_idx` (`updated_at` DESC) WHERE `visibility = 'public' AND lifecycle = 'active'` — サイトマップ

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

- **インデックス**: `tags_scope_normalized_uq` UNIQUE (`scope_type`, `scope_id`, `normalized`)、`tags_scope_idx` (`scope_type`, `scope_id`)

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

- **インデックス**: `backup_records_note_file_uq` UNIQUE (`note_id`, `source_file_id`)、`backup_records_user_idx` (`user_id`)、`backup_records_note_idx` (`note_id`)

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
| `requested_by` | text | NOT NULL |
| `scope_type` | text | NOT NULL, CHECK IN ('user','workspace') |
| `scope_id` | text | NOT NULL |
| `status` | text | NOT NULL, CHECK IN ('queued','running','succeeded','failed','canceled') |
| `attempts` | integer | NOT NULL DEFAULT 0, CHECK `attempts >= 0` |
| `progress_completed` | integer | `status = 'running'` のとき NOT NULL |
| `progress_total` | integer | `status = 'running'` のとき NOT NULL |
| `started_at` | integer | NULL 可 |
| `finished_at` | integer | 終端状態のとき NOT NULL |
| `artifact_file_id` | text | NULL 可 |
| `artifact_expires_at` | integer | `artifact_file_id` が NOT NULL のとき NOT NULL |
| `failure_reason` | text | `status = 'failed'` のとき NOT NULL |
| `failure_detail` | text | `status = 'failed'` のとき NOT NULL |
| `version` | integer | NOT NULL DEFAULT 0 |
| `created_at` | integer | NOT NULL |
| `updated_at` | integer | NOT NULL |

- **CHECK**:
  - `target_type = 'batch'` なら `target_id IS NULL`、そうでなければ `target_id IS NOT NULL`
  - `status = 'succeeded'` 以外なら `artifact_file_id IS NULL`
  - `status IN ('succeeded','failed','canceled')` なら `finished_at IS NOT NULL`
  - `status = 'running'` なら `progress_completed IS NOT NULL AND progress_total IS NOT NULL AND progress_completed <= progress_total`
  - `status = 'failed'` なら `failure_reason IS NOT NULL AND failure_detail IS NOT NULL`
- **インデックス**:
  - `jobs_requester_created_idx` (`requested_by`, `created_at` DESC) — 履歴の一覧
  - `jobs_requester_active_idx` (`requested_by`, `status`) WHERE `status IN ('queued','running')` — 実行中件数
  - `jobs_parent_idx` (`parent_id`) — 子ジョブの列挙と集計
  - `jobs_target_active_idx` (`target_type`, `target_id`) WHERE `status IN ('queued','running')` — 多重実行の抑止
  - `jobs_scope_active_idx` (`scope_type`, `scope_id`) WHERE `status IN ('queued','running')` — ワークスペース削除時の一括キャンセル
  - `jobs_finished_idx` (`finished_at`) — 保持期間切れの削除

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

- **主キー**: (`user_id`, `period_year`, `period_month`)
- **インデックス**: `llm_usages_user_idx` (`user_id`)

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
| `tag_names` | text | NOT NULL DEFAULT ''（区切り文字で連結した正規化済みタグ名） |
| `visibility` | text | NOT NULL |
| `content_status` | text | NOT NULL |
| `style_mode` | text | NOT NULL |
| `has_source_file` | integer | NOT NULL DEFAULT 0 |
| `lifecycle` | text | NOT NULL |
| `author_display_name` | text | NOT NULL DEFAULT '' |
| `author_handle` | text | NULL 可 |
| `workspace_name` | text | NULL 可 |
| `workspace_slug` | text | NULL 可 |
| `workspace_published` | integer | NOT NULL DEFAULT 0 |
| `created_at` | integer | NOT NULL |
| `updated_at` | integer | NOT NULL |
| `trashed_at` | integer | NULL 可 |
| `purge_after` | integer | NULL 可 |

- 版を持たない（投影は現在の状態からの冪等な上書き）
- 通常の rowid 表として作る。`note_search_fts` が `content_rowid='rowid'` で参照するため、`WITHOUT ROWID` にしてはならない
- **インデックス**:
  - `note_search_owner_lifecycle_updated_idx` (`owner_type`, `owner_id`, `lifecycle`, `updated_at` DESC)
  - `note_search_owner_lifecycle_created_idx` (`owner_type`, `owner_id`, `lifecycle`, `created_at` DESC)
  - `note_search_owner_lifecycle_title_idx` (`owner_type`, `owner_id`, `lifecycle`, `title`)
  - `note_search_public_updated_idx` (`updated_at` DESC) WHERE `visibility = 'public' AND lifecycle = 'active'`
  - `note_search_author_public_idx` (`author_handle`, `updated_at` DESC) WHERE `visibility = 'public' AND lifecycle = 'active'`
  - `note_search_workspace_public_idx` (`workspace_slug`, `updated_at` DESC) WHERE `visibility = 'public' AND lifecycle = 'active'`

### note_search_fts

`note_search` に対応する FTS5 仮想テーブル。

```sql
CREATE VIRTUAL TABLE note_search_fts USING fts5(
  title,
  text,
  tag_names,
  content='note_search',
  content_rowid='rowid',
  tokenize='trigram'
);
```

- 日本語のように単語区切りのない文章でも部分一致できるよう `trigram` を使う
- `note_search` への `INSERT` / `UPDATE` / `DELETE` に対応する 3 つのトリガーで同期する。外部コンテンツ表の作法どおり、`UPDATE` と `DELETE` では先に `INSERT INTO note_search_fts(note_search_fts, rowid, title, text, tag_names) VALUES('delete', old.rowid, old.title, old.text, old.tag_names)` で旧行を取り消してから新しい行を入れる
- 関連度順は `bm25(note_search_fts)` で求める。タイトルの重みを本文より高くする
- タグの AND 絞り込みは `tag_names` に対する複数の `MATCH` 条件で表す

共有パスワードの通過証（`SharePass`）に署名する鍵はテーブルに置かない。`AppConfig` から供給し、署名と検証は presentation 層で行う（[domains/note.md](../domains/note.md) の `SharePass` を参照）。同様に `SecretCipher` の鍵も設定から供給する。

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
tag_assignments.note_id    → notes.id
tags.scope_id              → users.id または workspaces.id
external_connections.user_id → users.id
backup_records.note_id     → notes.id
jobs.target_id             → notes.id または stored_files.id
storage_quotas.subject_id  → users.id または workspaces.id
note_search.note_id        → notes.id
```

これらは外部キーを張らず、`identity.user.deleted` / `workspace.deleted` / `note.purged` などのイベントを購読するワーカーが後始末する。参照先が消えている行を読んだ場合は「対象が存在しない」として扱う。
