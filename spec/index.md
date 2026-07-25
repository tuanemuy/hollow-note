# 設計インデックス

あらゆるファイルを HTML に変換して保存・共有するサービスの設計ドキュメント。

## 進捗

| Phase | 内容 | 状態 |
| --- | --- | --- |
| 0 | 準備（idea.md の確認） | 完了 |
| 1 | シナリオ設計 | 完了（78 シナリオ / レビュー 5 巡） |
| 2 | ページ設計 | 完了（レイアウト 2 + 画面 32 + 公開エンドポイント 1 / レビュー 4 巡） |
| 3 | 技術設計（ドメイン / ユースケース / DB / テストケース） | 完了（9 ドメイン / 123 ユースケース / 21 テーブル） |
| 4 | マニュアルテストドキュメント | 完了（10 カテゴリー / 292 テストケース） |

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
- ユースケース: `usecases/{domain}.md`（9 ファイル / 123 ユースケース）
- [DB 設計](./database/index.md)
- テストケース: `testcases/{domain}/{usecase}.md`（123 ファイル）
- レビュー: `domains/review/`（4 巡）、`usecases/review/`（4 巡）、`database/review/`（3 巡）、`review/cross-phase/`（3 巡）

### Phase 4: マニュアルテスト

- [テスト一覧と実行管理表](./manual-tests/index.md)
- カテゴリー別手順書: `manual-tests/{category}.md`（10 ファイル / 292 テストケース）
- レビュー: `manual-tests/review/001.md` 〜 `002.md`

### クロスフェーズ検証

- `review/cross-phase/001.md` 〜 `003.md`

## ADR

- [001. 認証手段をユーザーから分離する](./adr/001-authentication-strategy.md)
- [002. LLM 連携は OpenRouter の OAuth のみをサポートする](./adr/002-llm-provider-integration.md)
- [003. ノートの所属先は個人または 1 ワークスペースのいずれか 1 つとし、移動を許す](./adr/003-note-ownership-model.md)
- [004. ワークスペースのロールは owner / editor / viewer の 3 段階とする](./adr/004-workspace-roles.md)
- [005. 時間のかかる処理はすべて非同期ジョブとして扱う](./adr/005-async-processing.md)
- [006. ノートの正データはサニタイズ済み HTML の 1 つとし、編集モードはその上の見え方とする](./adr/006-html-content-model.md)
- [007. 既定スタイルは装飾を持たない本文にのみ適用し、本文は Shadow DOM で隔離する](./adr/007-default-style-isolation.md)
- [008. ドメインを 9 つに分割し、タグ付けを Tag 側に置く](./adr/008-domain-boundaries.md)
- [009. 一覧・検索・タイムラインは専用の読み取りモデルに投影する](./adr/009-read-models.md)
