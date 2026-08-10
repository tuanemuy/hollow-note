# 025. 参照ランタイムを Node + in-memory の 1 つに絞る

## コンテキスト

出発点のテンプレートは 4 つのランタイム（Node / Cloudflare Workers / AWS Lambda / GCP Cloud Run）と 2 つの DB アダプター、3 種類の infra 定義（CDK / Pulumi / Terraform）、それぞれの CI ジョブを同梱していた。テンプレート自身も「1 つ選んで他は消す」ことを前提にしている。

同梱のアダプターは雛形のドメインと旧来の単一 UoW 契約に結合しており、二平面 UoW（[ADR 023](./023-two-plane-unit-of-work.md)）と本プロダクトのドメインに追随させるにはほぼ全面の書き直しになる。最終的な実行基盤は Cloudflare（[ADR 021](./021-scope-sharded-data-plane.md)）だが、その実装は独立した作業量を持つ。

## 決定

Node ランタイムと `adapters/memory/`（[ADR 024](./024-in-memory-adapter-as-first-class-backend.md)）だけを残し、他のアダプター・DI 配線・server entry・worker・infra 定義・wrangler / Dockerfile テンプレート・それらを呼ぶ CI ジョブと npm scripts と依存を削除する。outbox / relay / worker runner の機構は Node 版として保持する。

削除は「残すと参照切れで壊れるもの」をまとめて落とす形で一度に行い、typecheck / build / lint が常に緑である状態を保つ。壊れた状態で温存するより、Cloudflare 実装が spec（scope Durable Object / D1 の分割）に沿ってゼロから書くほうが安い。

## 検討した代替案

### 4 ランタイムを維持し、新しいドメインと UoW 契約に追随させる

参照実装としての価値は残る。しかし追随作業は実質「Cloudflare 実装を全ランタイム分、前倒しで行う」ことに等しく、しかもそのうち 3 つは実際には運用しない。

### 壊れたまま温存し、あとでまとめて直す

削除の判断を遅らせられるが、その間 typecheck とビルドが赤のままになり、各段階の検証が機能しない。赤から緑をまたぐ巨大な変更が 1 つ残る。

### libsql アダプターだけ残す

トランザクションと楽観ロックの実装パターンは参照価値がある。しかし雛形スキーマとの結合を解く書き直しは必要で、開発サーバーは in-memory で動く。参照は Git 履歴で足りる。

## 影響

- リポジトリは最小構成になり、以降の変更でビルドとテストが速い
- Cloudflare へ戻すとき、infra 定義（Pulumi + wrangler のレンダリング）と CI のマトリクスは Git 履歴から再構築する
- libsql 実装のトランザクション / 楽観ロックのパターンは Git 履歴頼みになる
- Cloudflare 一式（wrangler 設定、Workers 向けテストプールを含む）を組み直す工数はこの判断で消えず、後ろに移動しただけである
