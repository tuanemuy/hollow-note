# ADR 一覧と前提依存マップ

現在有効な非自明な設計判断の索引。廃止した判断は残さず、変更履歴は Git で管理する。

実行基盤は **Cloudflare Workers + scope Durable Objects + global D1 + R2 + Queues** とする。実上限と配置は [platform/index.md](../platform/index.md) を正典とする。

## 一覧

| No. | 決定 |
| --- | --- |
| 001 | [認証手段をユーザーから分離する](./001-authentication-strategy.md) |
| 002 | [LLM 連携は OpenRouter の OAuth のみをサポートする](./002-llm-provider-integration.md) |
| 003 | [ノートの所属先は個人または 1 ワークスペースのいずれか 1 つとし、移動を許す](./003-note-ownership-model.md) |
| 004 | [ワークスペースのロールは owner / editor / viewer の 3 段階とする](./004-workspace-roles.md) |
| 005 | [時間のかかる処理はすべて非同期ジョブとして扱う](./005-async-processing.md) |
| 006 | [ノートの正データはサニタイズ済み HTML の 1 つとし、編集モードはその上の見え方とする](./006-html-content-model.md) |
| 007 | [既定スタイルは装飾を持たない本文にのみ適用し、本文は Shadow DOM で隔離する](./007-default-style-isolation.md) |
| 008 | [ドメインを 9 つに分割し、タグ付けを Tag 側に置く](./008-domain-boundaries.md) |
| 009 | [一覧・検索・タイムラインは専用の読み取りモデルに投影する](./009-read-models.md) |
| 010 | [匿名の PDF エクスポートは要求者なしのジョブとし、結果到達は署名チケットで行う](./010-anonymous-export-and-ticket.md) |
| 011 | [全文検索は書き込み時前処理による bigram 方式で行う](./011-bigram-search.md) |
| 012 | [ジョブの実行はリースで保護し、batch 親の完了経路を一本化する](./012-job-execution-resilience.md) |
| 013 | [HTML のサニタイズは許可リスト方式で行い、規則の正典を 1 か所に置く](./013-html-sanitization-policy.md) |
| 014 | [取り込み結果の供給元は帰属で割り、本文・Storage の記録・ジョブの申し送りに分ける](./014-import-result-provenance.md) |
| 017 | [全文検索インデックスを contentless FTS5 にし、本文サイズに予算を設ける](./017-content-size-budget.md) |
| 021 | [業務データを scope 単位の Durable Object に分割し、D1 をグローバル制御面と公開投影に限定する](./021-scope-sharded-data-plane.md) |
| 022 | [常設サイドバーを持たず、航法をスコープトークンとコマンドパレットに二重化する](./022-command-palette-navigation.md) |

## 前提依存マップ

| ADR | 依存している前提 | 設計上の境界 |
| --- | --- | --- |
| 001 認証手段の分離 | 依存なし | Identity と User を分離する |
| 002 OpenRouter OAuth | 依存なし | LLM 連携を OpenRouter OAuth に閉じる |
| 003 ノートの所属 | scope routing | ノートは常に 1 scope に属し、移動は route を切替点とする |
| 004 ワークスペースのロール | 依存なし | owner / editor / viewer の権限表を正典とする |
| 005 非同期ジョブ | Workers の CPU 上限、Queue consumer の壁時計、Queues の配送特性 | 実行時間を予測できない処理と外部 I/O をジョブにする |
| 006 HTML の本文モデル | 依存なし | サニタイズ済み HTML を正データとする |
| 007 既定スタイルと Shadow DOM | ブラウザの Shadow DOM | 取り込み済み装飾と既定スタイルを隔離する |
| 008 ドメイン境界 | scope 内の Job / Note / StoredFile metadata / Membership が同じ DO storage にあること | scope 内の強制終端を同一 UoW に束ねる |
| 009 読み取りモデル | SQLite FTS5、private は scope-local、public は global D1 | 書き込みモデルから読み取りモデルを分離する |
| 010 匿名エクスポートとチケット | 依存なし | 匿名ジョブを利用者履歴から分離する |
| 011 bigram 検索 | FTS5 に日本語アナライザーを追加できないこと | 書き込み時の bigram 前処理で部分一致を成立させる |
| 012 ジョブ実行の回復性 | Queue consumer の少なくとも 1 回配送、順序保証なし、壁時計 15 分 | lease / attempt / scope Alarm の reaper で回復する |
| 013 サニタイズ方針 | 依存なし | 許可リストを `HtmlSanitizationPolicy` の正典に集約する |
| 014 取り込み結果の供給元 | 依存なし | 情報の帰属に合わせて保存先を分ける |
| 017 本文サイズの予算 | D1 と SQLite-backed DO の 1 行・1 値 2,000,000 バイト上限 | 本文を 800,000 バイトに制限し、FTS5 を contentless にする |
| 021 scope shard | DO storage の object 私有性、D1、Queues、Alarms | scope-local transaction と global projection の境界を定める |
| 022 サイドバーのない航法 | 本文が画面の大部分を占めること、`/jobs` が文脈を持たないこと | 行き先の帰属でスコープトークンとアカウントメニューを割り、パレット単独の入口を禁じる |
