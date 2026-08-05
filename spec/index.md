# 設計インデックス

あらゆるファイルを HTML に変換して保存・共有するサービスの設計ドキュメント。

`spec/` は現在有効な要件と設計の正典である。進捗、レビュー記録、日付つきの改訂履歴、廃止済みの判断は置かず、変更の履歴は Git で管理する。

実行基盤は **Cloudflare Workers + scope Durable Objects + global D1 + R2 + Queues** とする。基盤の実上限と、データ配置・ルーティング・Queue / Alarm の役割は [実行基盤の設計](./platform/index.md) を正典とする。

## シナリオ

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

## 画面

- [画面構成](./pages/index.md)

## 技術設計

- [ドメイン一覧](./domains/index.md) — Identity / Workspace / Storage / Conversion / Note / Tag / Integration / Job / Usage
- ユースケース: `usecases/{domain}.md`
- [DB 設計](./database/index.md) — global D1 と scope DO の配置・表・索引
- [実行基盤の設計](./platform/index.md) — scope routing / 実上限 / D1 query 予算 / Queue / Alarm / 外部要求の同時接続数
- [転送境界の設計](./presentation/index.md) — 資格情報の運搬 / CSRF 対策 / セキュリティヘッダー / エラーと HTTP ステータスの対応 / レート制限の要件
- テストケース: `testcases/{domain}/{usecase}.md`

## マニュアルテスト

- [マニュアルテスト一覧](./manual-tests/index.md)
- カテゴリー別手順書: `manual-tests/{category}.md`

## ADR

現在有効な設計判断とプラットフォーム前提は [ADR 一覧と前提依存マップ](./adr/index.md) を参照する。
