# ADR 一覧と前提依存マップ

設計上の非自明な判断を記録した Architecture Decision Record の索引。あわせて、**どの ADR がどのプラットフォーム前提に乗っているか**を逆引きできる表を置く。

実行基盤は **Cloudflare Workers + scope Durable Objects + global D1 + R2 + Queues** に確定している（[S-001](../../.adr/001-scope-sharded-data-plane.md)）。実上限と配置は [platform/index.md](../platform/index.md) を正典とする。`spec/adr/` の 001〜020 は設計過程の台帳で、Phase 10 以降の永続 ADR はプロジェクトルートの `.adr/` に置く。

## 一覧

| No. | 決定 | ステータス |
| --- | --- | --- |
| 001 | [認証手段をユーザーから分離する](./001-authentication-strategy.md) | 承認済み |
| 002 | [LLM 連携は OpenRouter の OAuth のみをサポートする](./002-llm-provider-integration.md) | 承認済み |
| 003 | [ノートの所属先は個人または 1 ワークスペースのいずれか 1 つとし、移動を許す](./003-note-ownership-model.md) | 承認済み |
| 004 | [ワークスペースのロールは owner / editor / viewer の 3 段階とする](./004-workspace-roles.md) | 承認済み |
| 005 | [時間のかかる処理はすべて非同期ジョブとして扱う](./005-async-processing.md) | 承認済み |
| 006 | [ノートの正データはサニタイズ済み HTML の 1 つとし、編集モードはその上の見え方とする](./006-html-content-model.md) | 承認済み |
| 007 | [既定スタイルは装飾を持たない本文にのみ適用し、本文は Shadow DOM で隔離する](./007-default-style-isolation.md) | 承認済み |
| 008 | [ドメインを 9 つに分割し、タグ付けを Tag 側に置く](./008-domain-boundaries.md) | 承認済み（配置・scope間整合性は S-001 が改訂） |
| 009 | [一覧・検索・タイムラインは専用の読み取りモデルに投影する](./009-read-models.md) | 承認済み |
| 010 | [匿名の PDF エクスポートは要求者なしのジョブとし、結果到達は署名チケットで行う](./010-anonymous-export-and-ticket.md) | 承認済み |
| 011 | [全文検索は書き込み時前処理による bigram 方式で行う](./011-bigram-search.md) | 承認済み（FTS表構成は017、配置はS-001が改訂） |
| 012 | [ジョブの実行はリースで保護し、batch 親の完了経路を一本化する](./012-job-execution-resilience.md) | 承認済み（組み立てリースの期間は [015](./015-cloudflare-runtime.md) が改訂） |
| 013 | [HTML のサニタイズは許可リスト方式で行い、規則の正典を 1 か所に置く](./013-html-sanitization-policy.md) | 承認済み（取得できなかったスタイルシートの扱いは [014](./014-import-result-provenance.md) が改訂） |
| 014 | [取り込み結果の供給元は帰属で割り、本文・Storage の記録・ジョブの申し送りに分ける](./014-import-result-provenance.md) | 承認済み |
| 015 | [実行基盤を Cloudflare Workers + D1 + R2 + Queues に確定し、永続実行基盤は採らない](./015-cloudflare-runtime.md) | superseded by S-001 |
| 016 | [読み取りモデルの投影は同時実行数 1 の専用キューで直列化する](./016-projection-single-writer.md) | superseded by S-001 |
| 017 | [全文検索インデックスを contentless FTS5 にし、本文の上限を D1 の行サイズから逆算する](./017-content-size-budget.md) | 承認済み（配置はS-001が改訂） |
| 018 | [1 回の実行あたりの D1 クエリ予算を定め、分割単位をそこから逆算する](./018-query-budget.md) | superseded by S-001 |
| 019 | [後始末の継続は購読者 1 件の専用イベントで運ぶ](./019-owner-cleanup-continuation.md) | superseded by S-001 |
| 020 | [調整状態は D1 に置き、原子性を単一 SQL 文で与える](./020-coordination-state.md) | superseded by S-001 |
| S-001 | [業務データを scope 単位の Durable Object に分割し、D1 をグローバル制御面と公開投影に限定する](../../.adr/001-scope-sharded-data-plane.md) | 承認済み |

## 前提依存マップ

「依存している前提」は、その ADR の**決定そのもの**が成立するために必要な前提を指す。代替案の不採用理由にだけ前提が使われている場合は、決定は依存しないものとして扱い、その旨を注記する。

前提はすべて確定済みなので、「影響」の欄は**将来この前提を動かすとしたら何が崩れるか**を示す。

| ADR | 依存している前提（確定） | 前提を動かす場合の影響 |
| --- | --- | --- |
| 001 認証手段の分離 | 依存なし | — |
| 002 OpenRouter OAuth | 依存なし | — |
| 003 ノートの所属 | 依存なし | — |
| 004 ワークスペースのロール | 依存なし | — |
| 005 非同期ジョブ | Workers の CPU 5 分 / Queue コンシューマーの壁時計 15 分と、Queues による配送 | 実行時間の制約が桁で緩めば、同期に戻せる処理が出る。境界（実行時間が予測できるか）そのものは動かない |
| 006 HTML の本文モデル | 依存なし | — |
| 007 既定スタイルと Shadow DOM | 依存なし（ブラウザの機能） | — |
| 008 ドメイン境界 | scope 内の Job / Note / StoredFile metadata / Membership が同じ DO storage に載ること | scope 内の強制終端は同一 UoW。scope をまたぐ操作は S-001 の route / directory orchestration に従う |
| 009 読み取りモデル | SQLite FTS5 と、private は scope-local / public は global D1 という配置 | 検索エンジンを替える場合は local/global の投影境界と再構築手順を再設計する |
| 010 匿名エクスポートとチケット | 依存なし（レート制限の手段は 020 が決めた） | — |
| 011 bigram 検索 | **FTS5 にカスタムトークナイザーを積めないこと**（D1 では SQLite の拡張をロードできず、組み込みの `unicode61` / `trigram` の範囲で日本語の部分一致を成立させる必要がある） | 日本語アナライザーを持つ検索エンジンなら 011 は丸ごと不要になる。書き込み時の bigram 前処理も、ハイライト生成の自前実装も要らなくなる |
| 012 ジョブ実行の回復性 | Queue consumer の at-least-once・順序保証なし・壁時計 15 分 | Job は scope DO に移るが実行体は Queue のままなので lease は維持する。reaper は scope Alarm が起動する |
| 013 サニタイズ方針 | 依存なし | — |
| 014 取り込み結果の供給元 | 依存なし | — |
| 015 / 016 / 018 / 019 / 020 | superseded | 現在の前提は S-001 を参照する |
| 017 本文サイズの予算 | D1 と SQLite-backed DO に共通する 1 行 2,000,000 バイトと、FTS5 の contentless 構成 | 行サイズの制約が実質ない保存先なら `NoteHtml` の上限を再検討できる |
| S-001 scope shard | DO storage の object 私有性、D1 read replication、Queues、Alarms | scope の粒度または global plane の製品を替えると route・directory・Saga・projection の境界が動く |

### 注記

- **001** — 代替案「マネージド認証サービスを使う」の不採用理由に「1 つの基盤の上で完結させたい」という前提が使われている。この前提は 015 で確定した決定になったため、代替案は**前提の側から**不採用が確定した。決定（Identity を User から分離する）自体はどの基盤でも成立する
- **009** — 代替案「検索だけを外部の検索サービスに委ねる」も同じ理由で不採用が確定した。009 は決定そのもの（FTS5 を `note_search` に対応づける）が前提に乗っているため、上表では依存ありとした
- **011** — 011 は 009 の下に積まれている。009 が動けば 011 は自動的に再検討の対象になる
- **012** — 015 は 012 の決定を維持したうえで、組み立てリースの期間だけを 60 分から 15 分へ改訂した。期間の表の正典は [usecases/job.md](../usecases/job.md)

## 前提を動かすときの手順

1. この前提依存マップで影響範囲を確認する
2. [platform/index.md](../platform/index.md) の実上限と設計値のうち、動くものを洗い出す
3. 影響のある ADR を改訂するか、破棄して新しい ADR に置き換える
4. 下流（`domains/` → `usecases/` → `database/` → `testcases/`、および `pages/` / `manual-tests/`）へ反映する

**ADR 008 への影響がもっとも広い**。008 はドメインの分割そのものと、ドメインをまたぐ整合性の取り方（何を同一 UoW で束ね、何を結果整合にするか）を定めており、下流のほぼ全文書がここに乗っている。データストアを分割する変更を検討するときは、008 の一貫性の表を先に引き直すこと。

## 決着した技術選択

現在の決定は S-001 により次の形で確定している。

| 項目 | 決定 | 記録 |
| --- | --- | --- |
| 全文検索の置き場 | private は scope DO、public は global D1。どちらも contentless FTS5 | [S-001](../../.adr/001-scope-sharded-data-plane.md) / [017](./017-content-size-budget.md) |
| ジョブ実行基盤 | Job state は scope DO、実行は Queues + lease、回収起動は Alarm | [S-001](../../.adr/001-scope-sharded-data-plane.md) / [012](./012-job-execution-resilience.md) |
| 調整状態の置き場 | 守る正データと同じ plane。Identity は D1、scope coordination は DO | [S-001](../../.adr/001-scope-sharded-data-plane.md) |
