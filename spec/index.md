# 設計インデックス

あらゆるファイルを HTML に変換して保存・共有するサービスの設計ドキュメント。

実行基盤は **Cloudflare Workers + scope Durable Objects + global D1 + R2 + Queues** に確定している（[scope sharded data plane ADR](./adr/021-scope-sharded-data-plane.md)）。基盤の実上限と、データ配置・ルーティング・Queue / Alarm の役割は [実行基盤の設計](./platform/index.md) を正典とする。

## 進捗

| Phase | 内容 | 状態 |
| --- | --- | --- |
| 0 | 準備（idea.md の確認） | 完了 |
| 1 | シナリオ設計 | 完了（79 シナリオ / レビュー 5 巡） |
| 2 | ページ設計 | 完了（画面 32（+ レイアウト 2 / 公開エンドポイント 1）/ レビュー 5 巡） |
| 3 | 技術設計（ドメイン / ユースケース / DB / テストケース） | 完了（9ドメイン / 143ユースケース / global D1・scope DO schemas / テストケース143ファイル） |
| 4 | マニュアルテストドキュメント | 完了（10 カテゴリー / 318 テストケース） |
| 5 | 改訂（2026-07-26 レビューの反映） | 完了（指示 77 件 / 設計判断 4 件 / ADR 3 本追加） |
| 6 | レビューによる改訂（2026-07-30） | 完了（プラットフォーム前提を候補に格下げし、基盤に依存しない指摘 9 件を修正。基盤に依存する指摘 5 件は前提の確定まで保留） |
| 7 | 改訂（2026-07-31。004 の N-01〜N-05） | 完了（新たに判明した課題 5 件 + レビューで見つかった既存の穴 7 件 / ADR 1 本追加） |
| 8 | 改訂（2026-08-02。実行基盤の確定と 004 の H-01〜H-05） | 完了（基盤依存として保留していた 5 件を解決 / ADR 6 本追加 / `platform/` 新設） |
| 9 | 改訂（2026-08-03。005 の反証つきレビュー） | 完了（指摘 11 件を反証にかけ、確定 8 件を修正・3 件を取り下げ / 反証の過程で見つかった 8 件と、下流反映の取りこぼし 12 件も修正 / ユースケース 1 本追加） |
| 10 | 改訂（2026-08-05。scope shard 化） | 完了（業務データを user / workspace DO に分割し、D1 を global control / public projection に限定） |

2026-07-26 に実施した全体レビュー（6 観点・指摘 98 件）と反証検証を受けて、全フェーズの成果物を改訂した。指示台帳・確定した設計判断・影響範囲は [改訂記録](#改訂記録) を参照。上の件数はすべて改訂後の実数。

2026-07-30 のレビュー（Phase 6）では、指摘を「実行基盤の選択に依存しないもの」と「依存するもの」に仕分け、前者のみを修正した。保留した 5 件（H-01〜H-05）は Phase 8 で解決済みである（経緯は [クロスフェーズ検証 004](./review/cross-phase/004.md)）。

2026-07-31 の改訂（Phase 7）では、その改訂作業中に判明した基盤非依存の課題 5 件（N-01〜N-05）を修正した。最大のものは「取り込み結果を利用者に見せる供給元がない」で、情報を**帰属**（誰に見えるか・いつまで残るか）で割って本文・Storage の取得記録・ジョブの申し送りに分ける決定を [ADR 014](./adr/014-import-result-provenance.md) に記録した。あわせて、この検討の過程で見つかった既存の穴 7 件（参照取り込みジョブの重複登録など）も直している。

2026-08-03 の改訂（Phase 9）では、指摘 11 件を**すべて独立に反証にかけた**うえで確定した 8 件を修正し、誤りだった 3 件を取り下げて記録に残した（[クロスフェーズ検証 005](./review/cross-phase/005.md)）。最大のものは「強制終端の継続要求が 9 経路のうち 7 経路の選択述語を再現できず、続きが元より広い集合を終端させる」で、payload を経路タグ付きの判別ユニオンに改め、購読ユースケース `continueForcedTermination` を新設した（Phase 8 が導入した継続は、発行側と購読側の両方が未接続だった）。あわせて「問題なし」と判断していた 4 件も逆向きに反証にかけ、そこから 5 件の課題（`listByTag` の契約・カーソルの正当化・空ページの扱い・ダウンロード URL の正典・再投影のクエリ見積もり）を拾っている。さらに改訂そのものを対象にもう一度掃き直し、下流に反映しきれていなかった 12 件（呼び出し元 7 経路のテストケース行・ADR 019 に残っていた古いカーソルの根拠・件数の食い違いなど）を追補として修正した。

2026-08-02 の改訂（Phase 8）では、当時の単一 D1 前提で H-01〜H-05 を解決した。投影の直列化（[016](./adr/016-projection-single-writer.md)）・行サイズの予算（[017](./adr/017-content-size-budget.md)）・クエリ予算（[018](./adr/018-query-budget.md)）・後始末の継続（[019](./adr/019-owner-cleanup-continuation.md)）・調整状態の置き場（[020](./adr/020-coordination-state.md)）を D1 / Queues / Workers の実上限から決め、Durable Objects / Workflows は採らないとしていた。このうち行サイズと組み立てリースは維持し、DO を採らない決定、投影・予算・後始末・調整状態の配置は Phase 10 の [021](./adr/021-scope-sharded-data-plane.md) が置き換えた。

2026-08-05 の改訂（Phase 10）では、Phase 8 の単一 D1 前提を [scope sharded data plane ADR](./adr/021-scope-sharded-data-plane.md) で置き換えた。通常の業務データと private 検索を user / workspace ごとの DO に置き、D1 は Identity・directory・route・利用者横断投影・public 検索に限定する。scope 内の強制終端はローカルトランザクションを維持し、ノート移動と利用者削除だけを route / directory を切替点とする回復可能な orchestration にした。Queues は外部 I/O job と global projection に残し、scope 内の relay / reaper / continuation は Alarm が起動する。

## 成果物

### 要件

- [初期アイデア](./idea.md)

### Phase 1: シナリオ設計

- [シナリオ一覧](./scenario/index.md)
- [アカウント（AC）](./scenario/account.md)
- [外部連携（IN）](./scenario/integration.md)
- [取り込み（IM）](./scenario/import.md)
- [編集（ED）](./scenario/editing.md)
- [整理（OR）](./scenario/organize.md)
- [共有（SH）](./scenario/sharing.md)
- [ワークスペース（WS）](./scenario/workspace.md)
- [発見（DS）](./scenario/discovery.md)
- [書き出し（EX）](./scenario/export.md)
- [処理（JB）](./scenario/jobs.md)
- レビュー: `scenario/review/001.md` 〜 `005.md`

### Phase 2: ページ設計

- [画面構成](./pages/index.md)
- レビュー: `pages/review/001.md` 〜 `004.md`

### Phase 3: 技術設計

- [ドメイン一覧](./domains/index.md) — Identity / Workspace / Storage / Conversion / Note / Tag / Integration / Job / Usage
- ユースケース: `usecases/{domain}.md`（9ファイル / 143ユースケース）
- [DB 設計](./database/index.md) — global D1 と scope DO の配置・表・索引
- [実行基盤の設計](./platform/index.md) — scope routing / 実上限 / D1 query 予算 / Queue / Alarm / 外部要求の同時接続数
- [転送境界の設計](./presentation/index.md) — 資格情報の運搬 / CSRF 対策 / セキュリティヘッダー / エラーと HTTP ステータスの対応 / レート制限の要件
- テストケース: `testcases/{domain}/{usecase}.md`（143ファイル）
- レビュー: `domains/review/`（4 巡）、`usecases/review/`（4 巡）、`database/review/`（3 巡）、`review/cross-phase/`（5 巡）

### Phase 4: マニュアルテスト

- [テスト一覧と実行管理表](./manual-tests/index.md)
- カテゴリー別手順書: `manual-tests/{category}.md`（10 ファイル / 318 テストケース）
- レビュー: `manual-tests/review/001.md` 〜 `002.md`

### クロスフェーズ検証

- `review/cross-phase/001.md` 〜 `005.md`（`003.md` の定量記述は末尾の訂正追記を参照）
- [クロスフェーズ検証 004](./review/cross-phase/004.md) — 2026-07-30 / 07-31 / 08-02 の 3 回の改訂記録。基盤の確定まで保留していた H-01〜H-05 の解決の経緯を含む
- [クロスフェーズ検証 005](./review/cross-phase/005.md) — 2026-08-03 の改訂記録。指摘を反証にかけた結果（確定 8 / 取り下げ 3）と、**取り下げた 3 件の誤りの内容**を残している

### 改訂記録

2026-07-26 のレビューを受けた改訂（Phase 5）は完了し、作業ファイル（指示台帳・設計判断・影響マップ・レビュー記録）は役目を終えたため削除した。改訂で下した非自明な設計判断は [ADR 010](./adr/010-anonymous-export-and-ticket.md)（匿名エクスポートとチケット）・[ADR 011](./adr/011-bigram-search.md)（bigram 検索）・[ADR 012](./adr/012-job-execution-resilience.md)（ジョブ実行の回復性）に、その他の確定方針は本体各文書に反映済みである。

## ADR

一覧と、**どの ADR がどのプラットフォーム前提に乗っているか**の逆引きは [ADR 一覧と前提依存マップ](./adr/index.md) にある。前提を動かすときはそこから影響範囲を引くこと。

- [001. 認証手段をユーザーから分離する](./adr/001-authentication-strategy.md)
- [002. LLM 連携は OpenRouter の OAuth のみをサポートする](./adr/002-llm-provider-integration.md)
- [003. ノートの所属先は個人または 1 ワークスペースのいずれか 1 つとし、移動を許す](./adr/003-note-ownership-model.md)
- [004. ワークスペースのロールは owner / editor / viewer の 3 段階とする](./adr/004-workspace-roles.md)
- [005. 時間のかかる処理はすべて非同期ジョブとして扱う](./adr/005-async-processing.md)
- [006. ノートの正データはサニタイズ済み HTML の 1 つとし、編集モードはその上の見え方とする](./adr/006-html-content-model.md)
- [007. 既定スタイルは装飾を持たない本文にのみ適用し、本文は Shadow DOM で隔離する](./adr/007-default-style-isolation.md)
- [008. ドメインを 9 つに分割し、タグ付けを Tag 側に置く](./adr/008-domain-boundaries.md)
- [009. 一覧・検索・タイムラインは専用の読み取りモデルに投影する](./adr/009-read-models.md)
- [010. 匿名の PDF エクスポートは要求者なしのジョブとし、結果到達は署名チケットで行う](./adr/010-anonymous-export-and-ticket.md)
- [011. 全文検索は書き込み時前処理による bigram 方式で行う](./adr/011-bigram-search.md)
- [012. ジョブの実行はリースで保護し、batch 親の完了経路を一本化する](./adr/012-job-execution-resilience.md)
- [013. HTML のサニタイズは許可リスト方式で行い、規則の正典を 1 か所に置く](./adr/013-html-sanitization-policy.md)
- [014. 取り込み結果の供給元は帰属で割り、本文・Storage の記録・ジョブの申し送りに分ける](./adr/014-import-result-provenance.md)
- [015. 実行基盤を Cloudflare Workers + D1 + R2 + Queues に確定し、永続実行基盤は採らない](./adr/015-cloudflare-runtime.md)
- [016. 読み取りモデルの投影は同時実行数 1 の専用キューで直列化する](./adr/016-projection-single-writer.md)
- [017. 全文検索インデックスを contentless FTS5 にし、本文の上限を D1 の行サイズから逆算する](./adr/017-content-size-budget.md)
- [018. 1 回の実行あたりの D1 クエリ予算を定め、分割単位をそこから逆算する](./adr/018-query-budget.md)
- [019. 後始末の継続は購読者 1 件の専用イベントで運ぶ](./adr/019-owner-cleanup-continuation.md)
- [020. 調整状態は D1 に置き、原子性を単一 SQL 文で与える](./adr/020-coordination-state.md)
- [021. 業務データを scope 単位の Durable Object に分割し、D1 をグローバル制御面と公開投影に限定する](./adr/021-scope-sharded-data-plane.md)
