# 開発するシステムの初期アイデア

- あらゆるファイルをアップロードすると、HTMLに変換して保存され、簡単にシェアできるサービス
- CloudFlare向けに実装する
- OpenRouter等のLLMプロバイダーとOAuth連携することで、画像や音声からテキストを抽出して構造化することができる
    - バックアップがある場合は再生成可能
- 対応形式
    - HTML: そのまま
    - Markdown: HTMLに機械的に変換
    - Word, Excel, PowerPoint, プレーンテキスト
        - テキストを機械的に抽出
        - 連携していればLLM構造化
    - PDF
        - テキストデータあり
            - テキストを機械的に抽出
            - 連携していればLLMで構造化
        - テキストデータなし
            - 連携していればLLMで内容を解析して構造化
    - 画像
        - 連携していればLLMでテキストを抽出して構造化
    - 音声
        - 連携していれば音声認識でテキストを抽出して構造化
- 一括アップロード対応
- 参照先のファイルが読み込める場合はオブジェクトストレージに保存して参照先を差し替え
- タグ付けに対応
    - 一覧やノート詳細で簡単にタグ付けできる
    - 既存のタグから選択or新規作成してタグ付けに適したUI
- 元のファイルをバックアップ可能
    - Google Drive
- SSOしていたら同プロバイダーのクラウドストレージとシームレスに連携できるように
- まずはGoogle SSO / Drive
- デフォルトのスタイルを当てたいが、装飾されたHTMLには影響しないようにしたい
    - デフォルトはGitHubのMarkdownスタイル
- 公開ステータスを持つ
    - 非公開: デフォルト
    - 限定公開
        - 共有リンクを知っている人だけがアクセス可能
        - パスワード保護が可能
    - 公開
        - 公開個人タイムラインに表示される
        - 公開ワークスペースタイムラインに表示される
        - 公開検索される
        - 検索エンジンにインデックスされる
- ワークスペースを作成したり参加したりできる
- ワークスペースに紐づくノートは非公開または限定公開でもアクセスできる
- ワークスペースは公開可能
    - ワークスペースの公開ページができ、公開ノートのみが表示される
- 自分のタイムラインとワークスペースのタイムラインを簡単に切り替えられる
- エディタで内容を編集可能
    - 種類
        - ビジュアルエディタ
            - WYSIWYGではなく、レンダリングされたHTMLのテキストノードを直接編集できる
        - HTMLエディタ
        - WYSIWYGエディタ
            - HTMLがソースの場合は装飾が消える可能性があることを警告
    - 画像や動画のアップロードが可能
- 新規作成可能
    - WYSIWYGエディタ
- 一覧の表示形式は切り替え可能
    - タイルビュー
    - リストビュー
    - カレンダービュー
- フィルタリング
    - 全文検索
    - タグ
    - 月
- ダウンロード
    - 個別、一括でダウンロード可能
    - 対応形式
        - HTML
        - Markdown
        - PDF

## 確定事項

Phase 0 のヒアリングで確定した方針。

### 認証

- Google SSO とメール + パスワードの両方をサポートする
- 将来的に他の SSO プロバイダー（GitHub, Microsoft 等）を追加できる設計にする
    - 認証手段（Identity）をユーザー（User）から分離し、1 ユーザーに複数の認証手段を紐づけられるようにする
- Google SSO でサインイン済みであれば、追加スコープへの同意のみで Google Drive 連携を有効にできる（増分認可。サインイン時に Drive のスコープは要求しない。詳細は [ADR 001](./adr/001-authentication-strategy.md)）

### LLM 連携

- OpenRouter の OAuth（PKCE）のみをサポートする
- ユーザー自身の OpenRouter アカウントの鍵を取得して利用する（利用料はユーザー負担）
- 自前の API キー入力欄は設けない

### ノートとワークスペースの関係

- ノートの所属先は「個人」または「特定の 1 ワークスペース」のいずれか 1 つ
- 所属先は後から移動できる
- 1 つのノートを複数ワークスペースに同時共有することはしない

### ワークスペースの権限

- owner / editor / viewer の 3 段階
- owner: ワークスペース設定・公開設定・メンバー管理・削除・ノートの全操作
- editor: ノートの作成 / 編集 / 削除 / 公開設定
- viewer: ノートの閲覧とダウンロードのみ

## 前提（設計時の想定）

ヒアリングで明示されなかったが、設計上の前提として置くもの。

### 業務上の前提

実行基盤の選択によらないもの。

- 重い処理（LLM 構造化、バックアップ、一括アップロード、一括ダウンロード）は非同期ジョブとして実行し、進捗を UI に返す
- UI 言語は日本語のみ。i18n は対象外
- 課金・プラン管理は対象外。ただし利用量の上限（ファイルサイズ、月間 LLM 実行回数等）は設ける

### 確定した技術選択

冒頭の「CloudFlare 向けに実装する」を正式な決定として確定した。Workers Paid を前提とし、データ配置は [scope sharded data plane ADR](./adr/021-scope-sharded-data-plane.md) を正典とする。

| 項目 | 製品 |
| --- | --- |
| 実行基盤 | Cloudflare Workers |
| scope 内の業務データ | SQLite-backed Durable Objects（user / workspace ごと） |
| グローバル制御・公開投影 | D1（SQLite） |
| オブジェクトストレージ | R2 |
| ジョブとイベントの配送 | Cloudflare Queues |
| 全文検索 | scope DO の FTS5（private）+ D1 の FTS5（public） |
| 定期実行 | scope DO の Alarms + global plane の Cron Triggers |
| 転送境界の粗いレート制限 | Workers の Rate Limiting binding |

調整状態は、その状態が守る正データと同じ整合性境界に置く。Identity の施錠と OAuth 一時状態は D1、scope event の重複排除・job lease・継続予定は当該 scope DO に置く。粗い転送境界のレート制限だけは Workers の Rate Limiting binding を使う。

**確定したことで何が変わるか**。通常の読み書き・ジョブ・クォータ・private 検索は scope 数に比例して水平分割される。D1 は Identity、グローバル一意性、route、利用者横断の directory、public 検索だけを担う。行サイズ・D1 query・DO request / CPU・Queue / Alarm の壁時計と、そこから導いた設計値は [実行基盤の設計](./platform/index.md) を正典とする。

### Durable Objects はデータシャードとして使い、ジョブ実行は Queues に残す

ジョブの正データと lease は対象の scope DO に置くが、外部 I/O を伴う実行は Queues の consumer が担う。Queues の少なくとも 1 回配送と強制終了は残るため、[ADR 012](./adr/012-job-execution-resilience.md) の lease / attempt / reaper は維持する。

- scope 内では Job / Note / StoredFile metadata / Membership を同じ DO transaction に束ね、強制終端の保証を維持する
- scope をまたぐノート移動と利用者削除は、D1 route / membership directory を切替点にした再開可能な orchestration とする
- scope outbox・lease 回収・継続は各 DO の Alarm、外部 I/O job と global projection は Queues で運ぶ

DO の単一インスタンス性だけを排他錠として使うのではなく、scope の正データ・トランザクション・ローカル予定表を同居させる。Workflows は採らない。batch 親の組み立てリースは Queue consumer の壁時計に合わせて 15 分のままとする。
