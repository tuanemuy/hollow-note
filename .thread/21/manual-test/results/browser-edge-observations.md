# browser エッジケースの観測 — Issue #21

**実行日:** 2026-08-25
**URL:** http://localhost:3100

## 前提確認

ウィンドウ1で `/settings/auth` を開いたところ、既に利用者A（`relink-a@example.com`）でサインイン済みで、一覧は「メールアドレスとパスワード（有効・追加 2026年8月24日）」「Google（有効・oauth-a@example.com で連携済み）」の2行だった。サインインし直しは不要だった。

## エッジ 1: 解除した直後に同じ Google アカウントを再連携する

| # | 操作 | 期待結果 | 実際に観測した内容 |
|---|------|---------|------------------|
| 1 | ウィンドウ1で `/settings/auth` を開き、Google の行の「解除」→「解除する」を押す | — | 一覧が「メールアドレスとパスワード」の1行のみになり、「解除」ボタンが `disabled` に変化。「Google を追加」ボタンが表示された（「ログイン方法を解除しました」等のトースト文言は本ステップの直後スナップショットには出ていない） |
| 2 | サーバーログを待たずに即座に「Google を追加」を押し、同意画面で `oauth-a@example.com` / `email_verified` ON で「許可する」を押す | 「この外部アカウントの解除処理が進行中です。少し待ってからもう一度お試しください。」が出るか、そのまま連携が成功する（どちらでもよい） | 開発用IDプロバイダーの同意画面（`メールアドレス` を `oauth-a@example.com` に書き換え）で「許可する」をクリックした後、`/settings/auth` に戻り一覧は「メールアドレスとパスワード（有効）」「Google（有効・oauth-a@example.com で連携済み）」の2行。エラーメッセージは観測されなかった（＝この時点で再連携が成功していた） |
| 3 | 表示を確認する | — | 上記の通り、2行表示（パスワード + Google）。エラー文言なし |
| 4 | （手順2で既に連携が成功したため、注記に従い再度の解除→再試行は行わず、そのまま手順5へ進んだ） | 手順4は必ず成功する | 実施せず（手順2で既に成功していたため注記通りスキップ） |
| 5 | `/settings/auth` の一覧を確認する | 一覧に Google が 1 行だけ現れる | `read` の出力: 「メールアドレスとパスワード有効追加 2026年8月24日解除」「Google有効oauth-a@example.com で連携済み解除」の2行。Google は1行のみ |

**サーバーログの観測:**
```
[queue] received identity.identity.removed 01a03477-b5c8-70ea-ab83-31a19c9f2984 { eventId: '01a03477-b5c8-70ea-ab83-31a19c9f2984', eventType: 'identity.identity.removed', aggregateId: '01a03472-bed8-725a-8b17-8a69b03602d9' }
[queue] received identity.identity.added 01a03477-d444-750c-9c13-79715aae0b58 { eventId: '01a03477-d444-750c-9c13-79715aae0b58', eventType: 'identity.identity.added', aggregateId: '01a03477-d444-750c-9c13-7500f2c465b4' }
```

## エッジ 2: 解除した Google アカウントを別の利用者が取得できる

| # | 操作 | 期待結果 | 実際に観測した内容 |
|---|------|---------|------------------|
| 1 | ウィンドウ1（利用者A）で Google（`oauth-a@example.com`）の「解除」→「解除する」を押す | — | `read` 出力に「ログイン方法を解除しました。」のトースト文言が現れた。一覧は「メールアドレスとパスワード」1行 + 「Google を追加」ボタン + 「最後のログイン方法は解除できません。別の方法を追加してから解除してください。」（残り1件用の注記） |
| 2 | サーバーログに `identity.identity.removed` が出るのを待つ | — | `[queue] received identity.identity.removed 01a03478-5d39-749f-92a2-12192d204743 { eventId: '01a03478-5d39-749f-92a2-12192d204743', eventType: 'identity.identity.removed', aggregateId: '01a03477-d444-750c-9c13-7500f2c465b4' }` を確認（数秒以内に出現） |
| 3 | ウィンドウ2でサインアウトしてから `/signup` で利用者C（`taker-c@example.com` / `Passw0rd123` / 表示名 `横取太郎`）を登録し、メール確認してサインインする | — | サインアウト後トップページ（サインイン/はじめるリンク）に戻った。`/signup` フォームに入力し送信すると「確認メールを送信しました」画面に遷移。サーバーログの `mail.sent`（`to: 'taker-c@example.com', template: 'emailVerification'`）の `actionUrl`（`http://localhost:3100/verify-email?token=...`）を開くと、個人ダッシュボード（「個人」「最初のノートを作る」）に自動遷移し、サインイン済み状態になった |
| 4 | ウィンドウ2の `/settings/auth` で「Google を追加」を押し、同意画面で `oauth-a@example.com` / `email_verified` ON で「許可する」を押す | 手順4が成功する | `/settings/auth` を開くと一覧は「メールアドレスとパスワード」1行のみ + 「Google を追加」。同意画面でメールを `oauth-a@example.com` に書き換え「許可する」をクリック後、`/settings/auth` の `read` 出力は「メールアドレスとパスワード有効追加 2026年8月24日解除」「Google有効oauth-a@example.com で連携済み解除」の2行。エラーなし |
| 5 | ウィンドウ2の一覧と、ウィンドウ1の `/settings/auth` を確認する | ウィンドウ2の一覧に Google が1行現れる。ウィンドウ1の一覧はパスワードの1件だけ | ウィンドウ2: 上記の通り Google 1行が現れた（`oauth-a@example.com で連携済み`）。ウィンドウ1で `/settings/auth` を再読み込みした `read` 出力: 「メールアドレスとパスワード有効追加 2026年8月24日解除」「最後のログイン方法は解除できません。別の方法を追加してから解除してください。」「Google を追加」— Google行は無く、パスワードの1件のみ |

## エッジ 3: 連携と解除を3往復しても鍵が固まらない

| # | 操作 | 期待結果 | 実際に観測した内容 |
|---|------|---------|------------------|
| Round1 連携 | 「Google を追加」→ `oauth-loop@example.com` / `email_verified` ON →「許可する」 | 連携が成功する | `read` 出力: 「メールアドレスとパスワード有効追加 2026年8月24日解除」「Google有効oauth-loop@example.com で連携済み解除」。成功、エラーなし |
| Round1 解除 | 「解除」→「解除する」 | 解除できる | `read` 出力に「ログイン方法を解除しました。」。一覧は「メールアドレスとパスワード」1行 + 「Google を追加」。サーバーログ `[queue] received identity.identity.removed 01a03479-8886-71fd-9fdb-1f804f33bc2d { ..., aggregateId: '01a03479-668b-771f-8179-8206aac4da6a' }` を確認 |
| Round2 連携 | 同上 | 連携が成功する | 「Google有効oauth-loop@example.com で連携済み解除」を含む2行表示。成功、エラーなし |
| Round2 解除 | 同上 | 解除できる | 「ログイン方法を解除しました。」を確認。一覧はパスワードの1行 + 「Google を追加」 |
| Round3 連携 | 同上 | 連携が成功する | 「Google有効oauth-loop@example.com で連携済み解除」を含む2行表示。成功、エラーなし |
| Round3 解除 | 同上 | 解除できる | 「ログイン方法を解除しました。」を確認。一覧はパスワードの1行 + 「Google を追加」 |
| 最終連携（手順5） | 「Google を追加」で `oauth-loop@example.com` を連携し、一覧を確認する | 3往復すべてで連携・解除ができ、最終連携も成功して一覧がパスワード+Googleの2件になる | `read` 出力: 「メールアドレスとパスワード有効追加 2026年8月24日解除」「Google有効oauth-loop@example.com で連携済み解除」の2行。最終連携も成功 |

**あわせて観測したこと:**
- 3往復・最終連携の全ステップを通じて「この外部アカウントの解除処理が進行中です」という文言は一度も画面に現れなかった。連携・解除はすべて即座に成功した。
- サーバーログを `identityRemovalRelease` で検索したところ、`[identityRemovalRelease] keeping the claim` を含むログ行は **0件**（該当行なし）だった。
- サーバーログの `identity.identity.removed` / `identity.identity.added` イベントは、エッジ3の一連の操作に対応する形で交互に出現した（例: `01a03479-8886-...`（removed）→`01a03479-beb5-...`（added）→`01a03479-e0c4-...`（removed）→`01a0347a-03b9-...`（added）→`01a0347a-26ed-...`（removed）→`01a0347a-4a35-...`（added、最終連携分））。

## 手順どおりに進められなかったステップ

なし。全ての手順を記載どおりに実行できた。
