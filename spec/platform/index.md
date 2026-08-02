# 実行基盤の設計

実行基盤は **Cloudflare Workers + D1 + R2 + Queues** に確定している（[ADR 015](../adr/015-cloudflare-runtime.md)）。本書は、その基盤が課す**実上限**と、そこから逆算した**設計値**の正典である。

## この文書の役割

`CLAUDE.md` のヘキサゴナルアーキテクチャにより、アダプター層の差し替えそのものは安い。しかし分割単位・上限値・キューの構成は、基盤の実上限から逆算しないと決められない。それらを各ユースケース文書に散らすと、上限が動いたときに追える範囲が分からなくなる。

| 決めること | 正典 |
| --- | --- |
| 基盤の実上限 | 本文書 |
| 行サイズの予算と、可変長列の上限 | 本文書（値そのものは各ドメイン文書、根拠は本文書） |
| 1 回の実行あたりのクエリ予算と、各経路の分割単位 | 本文書 |
| キューの構成（本数・バッチサイズ・同時実行数・DLQ） | 本文書 |
| 定期実行の割り当てと間隔 | 本文書 |
| 外部への要求の同時実行数 | 本文書 |
| HTTP 境界の決定（Cookie・CSRF・CSP・ステータス） | [presentation/index.md](../presentation/index.md) |
| テーブルと索引の定義 | [database/index.md](../database/index.md) |

## 実上限

設計の根拠として引く値。Workers Paid を前提とする。

### D1

| 項目 | 値 |
| --- | --- |
| 文字列 / BLOB / 1 行のサイズ | **2,000,000 バイト** |
| 1 回の Worker 実行あたりのクエリ数 | **1,000**（Free: 50） |
| SQL 文の長さ | 100,000 バイト |
| 1 クエリのバインド変数 | **100** |
| 1 クエリの実行時間 | 30 秒 |
| 1 表のカラム数 | 100 |
| データベースサイズ | 10 GB |

### Workers

| 項目 | 値 |
| --- | --- |
| CPU 時間 | 既定 30 秒 / 最大 5 分 |
| 壁時計（HTTP） | クライアントが接続している間は無制限 |
| 壁時計（Cron Trigger） | 15 分 |
| 壁時計（Queue コンシューマー） | **15 分** |
| サブリクエスト | 10,000 / 実行 |
| **同時に応答待ちにできる外部接続** | **6** |
| メモリ | 128 MB |
| Cron Trigger の数 | 250 / アカウント |

### Queues

| 項目 | 値 |
| --- | --- |
| メッセージサイズ | 128 KB |
| 1 バッチの最大メッセージ数 | 100 |
| `sendBatch` の上限 | 100 件 または 256 KB |
| 同時コンシューマー実行数 | 250（`max_concurrency` で 1 まで絞れる） |
| 再試行回数 | 100 |
| 保持期間 | 最大 14 日 |
| 遅延配送 | 最大 24 時間 |
| キューあたりのスループット | 5,000 メッセージ / 秒 |

### R2

| 項目 | 値 |
| --- | --- |
| オブジェクトサイズ | 単一 PUT 5 GiB / マルチパート 4.995 TiB |
| カスタムメタデータ | 8,192 バイト |
| 同一キーへの並行書き込み | 1 秒あたり 1 回（超過は 429） |

利用者が上げられるファイルの上限（画像 20 MB / 動画 200 MB / 文書 50 MB / 一括合計 500 MB）はいずれも R2 の上限を大きく下回るため、R2 側の制約は設計値に影響しない。

## 行サイズの予算

**D1 の 1 行は 2,000,000 バイトを超えてはならない。** 可変長の列を複数持つ表は、それらの上限の合計が 2,000,000 バイトを下回ることを設計として示せること（[ADR 017](../adr/017-content-size-budget.md)）。

| 表 | 可変長列の内訳 | 合計 | 上限比 |
| --- | --- | --- | --- |
| `notes` | `content_html` 800,000 + `content_text` 800,000 + `content_headings` 96,000 + `content_excerpt` 800 + `title` 800 + その他 < 2,000 | < 1,700,000 | 85% |
| `note_search` | `text` 800,000 + `tag_names` 10,100 + `tag_display_names` 10,100 + `excerpt` 800 + `title` 800 + その他 < 2,000 | < 824,000 | 42% |
| `note_revisions` | `html` 800,000 + `title` 800 + その他 < 1,000 | < 802,000 | 41% |
| `jobs` | `payload` JSON（一括操作は対象 500 件 = 約 20,000）+ `notices` JSON + `failure_detail` | < 64,000 | 4% |
| `reference_import_summaries` | `removed_css` JSON（プロパティ名ごとに畳むため要素数は種類数で頭打ち） | < 4,000 | 1% |

上限を持つ値の定義そのものは各ドメイン文書に置く（`NoteHtml` / `PlainTextContent` / `NoteHeading` は [domains/note.md](../domains/note.md)、`TagName` は [domains/tag.md](../domains/tag.md)）。本表はそれらを足し合わせて上限を下回ることを示すためのものである。

**大きな値は必ずバインド変数として渡す**。SQL 文に埋め込むと文の長さの上限（100,000 バイト）に触れる。

## クエリ予算

**1 回の Worker 実行が発行してよい D1 クエリ数の設計上限は 500 とする**（実上限 1,000 の 50%。[ADR 018](../adr/018-query-budget.md)）。残りは同じ実行の中で走る認証・権限判定・ページングと、実装時の差分のための余裕である。

予算は**実行単位**で与えられる。Queue のコンシューマーは 1 回の実行で複数のメッセージを受け取るため、`max_batch_size × 1 メッセージあたりのクエリ数 ≤ 500` を満たすようにバッチサイズを決める。

### 1 件あたりの見積もり

| 処理 | 1 件あたり | 内訳 |
| --- | --- | --- |
| `purgeNote` の呼び出し | 5 | 閲覧者コンテキストの解決 2 + 削除 1 + outbox 1 + 余裕 1 |
| ノートの削除（ユースケース内で直接行う場合） | 3 | 削除 1 + outbox 1 + 余裕 1 |
| 1 ノートの再投影 | 12 | ノート 1 + 著者 1 + ワークスペース 1 + `upsert` の 3 文 + タグ読み取り 1 + `updateTags` の 5 文 |
| ジョブ 1 件の強制終端と後始末 | 4 | 終端 1 + outbox 1 + 本文の回復 2 |
| ファイル 1 バッチの削除 | 3（件数によらず） | 列挙 1 + 多行 DELETE 1 + 多行 outbox INSERT 1 |

### 分割単位

| 経路 | 分割単位 | 見積もり |
| --- | --- | --- |
| `emptyTrash` の同期削除のしきい値 | **50 件** | 1 + 1 + 5 × 50 = 252 |
| `deleteNotesForOwner` の `batchSize` | **100** | 1 + 3 × 100 = 301 |
| `purgeExpiredTrash` の `limit` | **100** | 1 + 3 × 100 = 301 |
| `deleteFilesByOwner` の `batchSize` | **100** | 3（発行するイベント数を抑えるための上限） |
| `rebuildNoteProjection` の `batchSize` | **100** | 列挙 1 + 多行 outbox INSERT 1 |
| `collectExpiredArtifacts` / `collectOrphanMedia` の `limit` | **100** | 3 |
| 強制終端が同一 UoW で終端させるジョブ数 | **100** | 1 + 4 × 100 = 401 |
| タグのファンアウトの 1 ページ | **200 件** | 列挙 1 + 多行 outbox INSERT 1 |
| `reapExpiredJobs` の `limit` | **100** | 1 + 4 × 100 = 401 |

`requestBulkNoteOperation` / `requestBulkExport` / `requestBackup` の対象上限（500 件）と一括アップロードの件数上限（100 件）は変えない。**子ジョブはそれぞれ別の実行で処理される**ため 1 実行あたりの予算に掛からず、登録そのものは親 1 行 + 子の多行 INSERT + outbox の多行 INSERT で数クエリに収まる。

### バインド変数

1 クエリのバインド変数は 100 までである。**ID の並びで引く / 消すクエリは `?` を件数ぶん並べない。** JSON 配列を 1 つのバインド変数として渡し、`json_each` で展開する。多行 INSERT も同じ形で 1 文にまとめる。これにより件数によらずクエリ数は 1、バインド変数は 1 になる。

## キュー構成

役割ごとに 3 本 + それぞれの DLQ を持つ（[ADR 016](../adr/016-projection-single-writer.md)）。アウトボックスのリレーは、1 つの outbox 行を**その種別に購読者を持つすべてのキュー**へ送る。

| キュー | 運ぶもの | `max_batch_size` | `max_concurrency` | 1 メッセージの予算 |
| --- | --- | --- | --- | --- |
| `jobs` | `job.enqueued` / `job.readyToAssemble` によるジョブ実行 | **1** | 既定（〜250） | 500 |
| `events` | 投影以外のイベント購読と、その継続要求 | **1** | 既定（〜250） | 500 |
| `events-projection` | `projectNoteChanges` のみ | **20** | **1** | 25 |
| `*-dlq` | 再試行を使い切ったメッセージ | 10 | 既定 | — |

- **`events-projection` の `max_concurrency: 1` は配備の都合ではなく設計上の要件である**。投影の正しさがこれに乗っている（[ADR 016](../adr/016-projection-single-writer.md)）
- `jobs` / `events` の `max_batch_size` を 1 にするのは、1 メッセージあたりの処理量が経路によって大きく違い、バッチにするともっとも重いメッセージに合わせてバッチサイズを決めることになるためである。同時実行数は既定のままなのでスループットは落ちない
- 遅延配送（`delaySeconds`）は使わない。継続は outbox に積む（[ADR 019](../adr/019-owner-cleanup-continuation.md)）
- DLQ に落ちたメッセージの扱いは運用手順であり、本設計は「落ちる形になっていること」だけを定める

## 定期実行

Cron Triggers で起動する。**1 つの cron 実行では 1 つの役割だけを走らせる** — クエリ予算は実行単位で与えられるため、複数の役割を同居させると予算が足し算になる。すべて同じ Worker スクリプトに載せ、`event.cron` で役割を切り替える。

| 役割 | ユースケース | cron | 1 回の上限 |
| --- | --- | --- | --- |
| リーパー | `reapExpiredJobs` | `*/5 * * * *` | 100 件 |
| ゴミ箱の回収 | `purgeExpiredTrash` | `*/10 * * * *` | 100 件 |
| 生成物の回収 | `collectExpiredArtifacts` | `0 * * * *` | 100 件 |
| 認証一時状態の掃除 | `pruneExpiredAuthState` | `15 * * * *` | 集合削除（件数によらず 3 文） |
| 孤児メディアの回収 | `collectOrphanMedia` | `30 3 * * *` | 100 件 |
| ジョブ履歴の削除 | `pruneJobHistory` | `0 4 * * *` | 集合削除（件数によらず 1 文 + CASCADE） |

リーパーの起動間隔（5 分）と、ジョブの実行体のリース期間（15 分）の大小関係は [ADR 012](../adr/012-job-execution-resilience.md) が定めたとおり保つ。正典は [usecases/job.md](../usecases/job.md) の「共通: リース期間と回収の間隔」。

## 外部への要求

| 制約 | 値 | 影響する経路 |
| --- | --- | --- |
| 同時に応答待ちにできる外部接続 | **6** | `importExternalReferences`（最大 200 件の参照取得）、`runBackup`（Google Drive）、LLM の呼び出し |
| サブリクエスト | 10,000 / 実行 | 上記すべて。200 件でも余裕がある |
| メモリ | 128 MB | `runBulkExport` の ZIP 組み立て |

- **外部への `fetch` は同時 6 本を超えて並行させない。** 200 件の参照を取りにいく場合も、6 本ずつの並行で進める
- **`runBulkExport` は生成物をメモリに全部載せない。** R2 から順に読みながら ZIP を書き出し、R2 へ書き戻す。500 件分の生成物は 128 MB に収まらない
- 組み立ては Queue コンシューマーで走るため**壁時計 15 分で必ず終わる**。この事実がリースの期間を決めている（[ADR 015](../adr/015-cloudflare-runtime.md)）

## 転送境界

| 決めること | 値 | 根拠 |
| --- | --- | --- |
| `clientKey` の材料 | `CF-Connecting-IP` | Cloudflare が設定・上書きするため詐称できない（[ADR 020](../adr/020-coordination-state.md)） |
| 粗いレート制限の実現手段 | Workers の Rate Limiting binding | 同上。窓は 60 秒 |
| 正確な計数を要する施錠 | D1 の単一 SQL 文による原子的な加算 | 同上 |

しきい値そのものは [presentation/index.md](../presentation/index.md) を正典とする。

## 関連文書

- [ADR 015. 実行基盤の確定と永続実行基盤の不採用](../adr/015-cloudflare-runtime.md)
- [ADR 016. 投影の単一ライター](../adr/016-projection-single-writer.md)
- [ADR 017. 本文サイズの予算](../adr/017-content-size-budget.md)
- [ADR 018. クエリ予算](../adr/018-query-budget.md)
- [ADR 019. 後始末の継続](../adr/019-owner-cleanup-continuation.md)
- [ADR 020. 調整状態の置き場](../adr/020-coordination-state.md)
