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
| 023 | [Unit of Work を global 平面と scope 平面に分け、境界を型で強制する](./023-two-plane-unit-of-work.md) |
| 024 | [in-memory 永続化を正規のバックエンドとして扱い、トランザクションを undo ログで実装する](./024-in-memory-adapter-as-first-class-backend.md) |
| 025 | [参照ランタイムを Node + in-memory の 1 つに絞る](./025-single-reference-runtime.md) |
| 026 | [ポート契約の正本はポート定義に置き、共有適合スイートで検証する](./026-port-contract-and-conformance.md) |
| 027 | [投影世代と route 版は UoW 内で採番し、ドメインへは引数で渡す](./027-projection-revision-numbering.md) |
| 028 | [認証の応答は登録の有無で差を作らない](./028-account-enumeration-resistance.md) |
| 029 | [メール確認はセッションの発行を確認要求元のブラウザーに束縛する](./029-verification-session-binding.md) |
| 030 | [認証状態を変える経路は POST に限り、サインアウトはフル遷移で行う](./030-auth-state-transition-transport.md) |
| 031 | [RSC ストリーミング境界を越えるエラーは構造で運び、秘匿を 1 か所に集める](./031-error-transport-across-rsc-boundary.md) |
| 032 | [本文の Shadow DOM は宣言的 template とクライアント側の昇格の二段で描画する](./032-shadow-dom-rendering-path.md) |
| 033 | [「文字数」は UTF-16 コード単位で数え、切り詰めはサロゲートペアを割らない](./033-character-count-unit.md) |
| 034 | [OAuth の認可往復は開始したブラウザーに束縛する](./034-oauth-callback-browser-binding.md) |
| 035 | [OAuth コールバックは 1 ルートで受け、分岐は消費した `state` の intent だけで決める](./035-oauth-callback-single-route.md) |
| 036 | [開発用 IdP は代替プロバイダー実装として併設し、選択規則を composition root に閉じる](./036-development-identity-provider.md) |
| 037 | [`NODE_ENV` に依存する安全判定は allowlist で書く](./037-node-env-allowlist.md) |
| 038 | [外部アカウントの claim は、現行の identity 行と対で読む](./038-provider-account-claim-and-identity-row.md) |
| 039 | [削除の参加者と必須受領は、配備の全数宣言から導出する](./039-cleanup-participants-declaration.md) |
| 040 | [継続要求は平面ごとの運搬路で運び、turn が自分のタスク行を決着させる](./040-continuation-transport.md) |
| 041 | [継続イベントの ID は生成元から決定的に導出し、キーはターンごとに変える](./041-deterministic-continuation-event-id.md) |
| 042 | [outbox の保存は id 衝突を「先着行をそのまま残す no-op」として契約する](./042-outbox-save-id-collision.md) |
| 043 | [平面をまたぐ引き渡しは、専用の継続行を駆動主体にする](./043-cross-plane-handover-driver.md) |
| 044 | [業務上のしきい値と保持期限はドメインに置き、ポートは観測値だけを返す](./044-business-thresholds-in-domain.md) |
| 045 | [重複排除は効果の可換性で要否を決め、キーの意味ごとにポートを分ける](./045-idempotency-by-commutativity.md) |
| 046 | [ポート契約と実装が食い違ったら、正本のある側へ倒す](./046-port-contract-divergence.md) |
| 047 | [削除の進捗チケットは presentation が署名し、application は操作 ID と状態だけを返す](./047-deletion-status-ticket.md) |
| 048 | [一意性予約の操作 ID は合成で導出し、ログには出さない](./048-uniqueness-reservation-operation-id.md) |
| 049 | [配信 URL の組み立ては `ObjectStorage` に閉じ、公開配信は用途で絞る](./049-object-storage-public-url.md) |
| 050 | [アップロードの受理は実体から判定し、上限は三段に分ける](./050-upload-acceptance-from-bytes.md) |
| 051 | [自オリジンに限る URL は述語 1 本で判定し、値オブジェクト型で運ぶ](./051-same-origin-url-predicate.md) |
| 052 | [台帳の 1 行はポートメソッドに対応させ、ID は行位置ではなく行の識別子とする](./052-adapter-inventory-granularity.md) |
| 053 | [rollback の完了判定は、ポート述語とユースケースの復帰ゲートに分ける](./053-account-deletion-rollback-completion.md) |
| 054 | [外部アカウントの一意性は、予約ディレクトリだけが担保する](./054-provider-account-uniqueness-owner.md) |
| 055 | [セッションの失効時刻は DTO に載せず、転送境界が寿命から再導出する](./055-session-expiry-derivation.md) |
| 056 | [バックエンド依存の性能上の約束は契約から外し、実行基盤の予算に置く](./056-performance-budget-placement.md) |
| 057 | [手動テストの手順書は scenario の下流成果物として追随させ、追随の要否は表の軸で決める](./057-manual-test-followthrough.md) |
| 058 | [台帳 ID の名乗りをコード側に要求するのは適合ケースだけとする](./058-ledger-id-callout-scope.md) |
| 059 | [台帳の DOM 行と ADP 行の非対称は、主張が本文に由来するときだけそろえる](./059-ledger-row-asymmetry.md) |
| 060 | [恒久 claim の取り壊しは、観測した claim に対する条件付きにする](./060-conditional-unique-claim-teardown.md) |

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
| 023 二平面 Unit of Work | scope shard（021）、DO storage が別 object と D1 を 1 トランザクションに束ねられないこと | 平面をまたぐ操作はサガとし、UoW 外の書き込みはコンテナの型で列挙する |
| 024 in-memory バックエンド | 適合スイート（026）を実バックエンドと同条件で通せること | in-memory は fake ではなくバックエンドの 1 つとして扱う |
| 025 単一参照ランタイム | 最終ターゲットが Cloudflare（021）であり、その実装が独立した作業であること | 参照ランタイムは 1 つに保ち、他は Git 履歴に残す |
| 026 ポート契約と適合スイート | ポートのバックエンドを差し替える前提（024 と Cloudflare 実装） | 契約はポート定義、検証は共有スイート、契約化するのは観測可能な結果だけ |
| 027 投影世代の採番 | 投影購読者が世代で順序の逆転を検出すること、同一トランザクションでの bump 規約 | 採番は UoW 内、イベントの形の正本はドメイン |
| 028 認証の応答同一化 | 一意性の強制がポート契約として残ること（026） | 一意性はポート、列挙耐性はユースケース |
| 029 メール確認の束縛 | 全 server function への同一オリジン検証が実際に強制されていること、`SameSite=Lax` | 認証状態の変更は要求元ブラウザーに束縛する |
| 030 認証状態の遷移経路 | `SameSite=Lax` がトップレベル GET に Cookie を添えること、ルーターの loader キャッシュ | 認証境界の遷移はページごと捨てる |
| 031 RSC 境界のエラー運搬 | ストリーミングのエラーチャネルが `kind` タグを運べないこと、モジュールグラフが分割されうること | 判定は構造、秘匿はフラグメント生成ヘルパー 1 か所 |
| 032 Shadow DOM の描画経路 | `<template shadowrootmode>` が HTML パーサー経由でのみ shadow root になること | 公開ページと認証必須ページで同じマークアップを使う |
| 033 文字数の単位 | 行サイズの予算（017）がバイト長の上界に依存すること | 上限検査と切り詰めの単位を一致させる |
| 034 認可往復のブラウザー束縛 | 開始が自オリジンの POST であること、`SameSite=Lax`、コールバックの単回消費（035）、フロー状態の取り出しが原子的であること、ポート契約と適合スイート（026） | 認可の完了は開始したブラウザーに束縛する。運搬と不在判定は転送境界、照合は消費と同じ原子操作 |
| 035 コールバックの単一ルート | フロー状態の取り出しが原子的な単回消費であること | 分岐根拠はサーバーが決めた intent だけに限る |
| 036 開発用 IdP の併設 | in-memory を正規バックエンドとして扱う立場（024）、有効化の判定（037） | 開発用実装は縮退版ではなく別プロバイダーとして持つ |
| 037 `NODE_ENV` の allowlist | 開発の正規経路が `development` を立てること、畳み込みと実行時読み取りの違い | 分類できない配備は安全側へ倒す |
| 038 claim と identity 行 | 予約ディレクトリと identity 行が別の物理境界にあること、配送が at-least-once | claim は索引であって資格ではない |
| 039 参加者の全数宣言 | 完了条件が「宣言された集合の全 ack」であること | 必須集合は配備の宣言から導出する |
| 040 継続要求の運搬路 | 継続の保存が本処理と同一トランザクション（023）、平面をまたぐ束ねが不可（021） | 運搬路は平面ごと、決着は turn、外枠はランナー |
| 041 継続イベント ID の決定的導出 | 同じ id の再保存が先着行を残す no-op（042）、消費側の冪等性 | キーはターンごとに変わらなければならない |
| 042 outbox の id 衝突契約 | 決定キーがターンごとに変わること（041）、保持期間が再配送窓を上回ること | id は行の同一性であり、衝突は先着優先 |
| 043 平面をまたぐ引き渡し | 2 つの平面のコミットを束ねられないこと（023）、継続 id の畳み込み（041 / 042） | 引き渡しの駆動主体をデータとして残す |
| 044 しきい値の置き場 | 観測・判定・作成を同一トランザクションに置けること | 業務規則はドメイン、ポートは観測だけ |
| 045 重複排除の要否 | 記録が本処理と同一トランザクションで確定すること | 可換な処理は通さない、キーの意味でポートを分ける |
| 046 契約と実装の乖離 | 契約の正本がポート定義、検証が共有スイート（026） | 倒す向きは振る舞いの正本がどこにあるかで決める |
| 047 削除の進捗チケット | 鍵を配備が供給できること、読み取りが 1 件に閉じていること | 署名と transport は presentation、application は状態だけ |
| 048 予約の操作 ID | 種別が区切り文字を含まない列挙であること、所有者一致を別に検査すること | 決定性は合成で得る、鍵の値はログへ出さない |
| 049 公開 URL と用途の絞り込み | 鍵にファイル ID が入り内容が不変であること | URL の形はアダプター、公開は用途で絞る |
| 050 アップロードの受理 | 受理判定の時点で実体を握っていること | 判定材料は実体、上限は転送 / 境界 / ドメインの三段 |
| 051 自オリジンの述語 | 自オリジンの情報を引数で渡せること | 同一オリジンの判定は 1 本、値は VO 型で運ぶ |
| 052 台帳の粒度と ID | 契約の正本がポート定義、検証が共有適合スイート（026） | 1 行 = 1 ポートメソッド、ID は行位置ではなく行の識別子、ケースはケース名の ADP ID で追う |
| 053 rollback の完了判定 | 必須受領が配備の全数宣言から導出されること（039）、倒す向きを正本のある側で決めること（046） | 述語は解放の配り切り、復帰の条件はユースケースが持つ |
| 054 外部アカウント一意性の担保元 | claim が索引であって資格ではないこと（038）、予約の操作 ID が合成で導出されること（048） | 一意性の担保は予約ディレクトリ 1 か所に置く |
| 055 失効時刻の再導出 | 寿命の正典がドメイン定数にあり、発行と同じ turn で Cookie を組み立てられること | 値の正典は 1 つ、DTO で二重に運ばない |
| 056 性能上の約束の置き場 | in-memory を正規バックエンドとして扱うこと（024）、契約の実行形が共有スイート（026） | 契約は観測可能な性質、バックエンド依存の数値は実行基盤の予算 |
| 057 手順書の追随 | 受容した縮退が利用者の操作として現れうること（029） | 追随の要否はカバレッジ 2 表の軸で決める |
| 058 台帳 ID の名乗り | 適合ケースに台帳行を採番しないこと（052）、TC / UC 行がテストケースファイル・ユースケース節と 1 対 1 であること | 名乗りが唯一の追跡手段になる要素だけに名乗りを要求する |
| 059 台帳の非対称の扱い | 台帳が本文からの生成物であること（052）、倒す向きを正本のある側で決めること（046） | 片側にしか無い主張は本文に由来するときだけそろえる |
| 060 恒久 claim の条件付き取り壊し | ディレクトリの書き込みが UoW の外にあること（023）、契約の正本がポート定義で検証が共有スイート（026）、鍵の値をシンクへ出さないこと（048）、claim と identity 行を対で読むこと（038）、配送が at-least-once で複数ワーカーでは判定と解放の窓が広がること | 取り壊しは観測した claim に対する条件付き、条件は不透明値 |
