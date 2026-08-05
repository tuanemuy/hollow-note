# 020. 調整状態は D1 に置き、原子性を単一 SQL 文で与える

## ステータス

superseded by [001. scope sharded data plane](../../.adr/001-scope-sharded-data-plane.md)

## コンテキスト

[クロスフェーズ検証 004](../review/cross-phase/004.md) の H-05。サインイン（`signInWithPassword`）と共有リンクのパスワード照合（`verifySharePassword`）の施錠は、どちらも `LoginAttemptStore.get` → `LoginThrottlePolicy.recordFailure` → `LoginAttemptStore.put` という**読んでから書く**形で定義されている（[domains/identity.md](../domains/identity.md)）。`login_attempts` は集約ではないため楽観ロックも掛からない。攻撃者が要求を並列化すると、同じ値を読んだ複数の要求が同じ値 + 1 を書き戻すため失敗回数がほとんど増えず、施錠を回避できる。

[ADR 一覧と前提依存マップ](./index.md) はこれを「調整状態の置き場」という未決項目として括っていた。同じ置き場の判断が、OAuth の一時状態（`oauth_flow_states`）とイベントの重複排除（`processed_events`）にも掛かる。3 つに共通するのは**読んでから書く更新の原子性をどう与えるか**である。

## 決定

### 調整状態はすべて D1 に置く

専用の低遅延ストア（Durable Objects / KV）は設けない。3 つとも、**原子性を単一の SQL 文で与える**ことで要件を満たせる。SQLite は 1 文を原子的に実行するため、読み取りと書き込みが 1 文に収まっていればロストアップデートは起きない。

| 調整状態 | 原子的な操作 | 形 |
| --- | --- | --- |
| 認証失敗の回数 | 加算して加算後の値を返す | `INSERT … ON CONFLICT DO UPDATE SET failure_count = failure_count + 1 … RETURNING` |
| OAuth の一時状態 | 取り出しと同時に削除する | `DELETE … WHERE state = ? RETURNING` |
| イベントの重複排除 | 初回だけ記録に成功する | `INSERT … ON CONFLICT DO NOTHING`（影響行数 0 なら処理済み） |

### `LoginAttempt` からロックの状態を落とし、導出に変える

失敗回数の加算を 1 文に収めるには、**書き込む値が読んだ値に依存してはならない**。現行の `LoginAttempt` は `lockedUntil` を持ち、その値は `failureCount` から計算されるため、素朴に書くとしきい値の判定を SQL に持ち込むことになる（ドメインの規則がアダプターへ漏れる）。

そこで**ロックを保存せず導出する**。

- `LoginAttempt` を `{ key; failureCount; lastFailedAt }` に縮める（`lockedUntil` を削除）
- `LoginThrottlePolicy.evaluate(attempt, now)` が、`failureCount` と `lastFailedAt` からロックと待機の両方を導出する。ロックは「`failureCount >= 10` かつ `now < lastFailedAt + 15 分`」
- `LoginThrottlePolicy.recordFailure`（純関数）を廃止し、**加算はポートの操作** `LoginAttemptStore.recordFailure(key, now, ttlMs)` にする。戻り値は**加算後の** `LoginAttempt`
- 呼ぶ側の順序は「`get` → `evaluate` で入場を判定 → 照合 → 失敗なら `recordFailure` → 返ってきた値を `evaluate` して応答を組み立てる」になる

導出に変えても振る舞いは変わらない。ロック中は照合そのものを行わないので `lastFailedAt` は 10 回目で凍り、ロックは 10 回目の失敗から 15 分で解ける（現行と同じ）。解けたあとは `failureCount` が 10 のままなので待機は上限の 60 秒になり、次の失敗で `lastFailedAt` が更新されて再びロックに入る（これも現行と同じ）。

入場の判定に使う `get` は**古い値を読みうる**が、これは害にならない。判定が緩む方向に外れても、その試行の失敗は原子的に数えられるため、施錠は必ず追いつく。

### 転送境界の粗いレート制限は Workers の Rate Limiting binding で行う

`RATE_LIMITED` を返す 4 経路（サインアップ・匿名の PDF 書き出し・公開検索・招待の発行。[presentation/index.md](../presentation/index.md)）は、**D1 では数えない**。Workers の Rate Limiting binding を使う。

分ける理由は、要求される保証が違うからである。`THROTTLED` / `LOCKED` は「10 回で施錠」という正確な計数が要件で、1 回でも取りこぼせば設計が意味を失う。一方 `RATE_LIMITED` は「無認証の経路が乱用されない程度に粗く抑える」もので、presentation 層の文書自身が「`THROTTLED` と同じ保証を持てない」と明記している。Rate Limiting binding は Cloudflare のロケーション単位で数える緩い（permissive・結果整合な）機構であり、まさにこの粗さに対応する。逆に、公開検索のような無認証・高頻度の経路を D1 で数えると、検索 1 回につき書き込みが 1 回増える。

- 窓は 10 秒または 60 秒しか選べない。しきい値は 60 秒窓で表す
- 実効の上限は Cloudflare のロケーション数だけ緩む。粗い上限としてはこれを受け入れる
- しきい値の既定値は [presentation/index.md](../presentation/index.md) に置く

### `clientKey` は `CF-Connecting-IP` から導く

発信元を表す文字列の材料が未定だった（[presentation/index.md](../presentation/index.md)）。**Cloudflare は `CF-Connecting-IP` を自分で設定し、クライアントが送った同名のヘッダーを上書きする**ため、クライアントから詐称できない。`X-Forwarded-For` は詐称できるので使わない。

## 検討した代替案

### Durable Object をキーごとの原子カウンターにする

原子性は完全に得られ、D1 への書き込みも増えない。しかし `LoginAttemptStore` のためだけに 2 つ目のストアを持ち込むことになり、`pruneExpiredAuthState` による期限切れの回収（現在は `login_attempts` の 1 文の DELETE）を DO 側の alarm で作り直すことになる。単一 SQL 文で同じ保証が得られる以上、取引が合わない。不採用。

### `login_attempts` に楽観ロックの列を足す

`version` を足して `WHERE version = ?` で更新し、競合したら読み直して再試行する案。既存の規約（集約ルートは版を持つ）に揃う。しかし施錠の対象はまさに**要求を並列化してくる相手**であり、競合が常態になる経路で再試行ループを回すことになる。原子的な加算なら 1 文で終わる。不採用。

### しきい値の判定を SQL に埋め、`lockedUntil` を保存し続ける

`ON CONFLICT DO UPDATE SET locked_until = CASE WHEN failure_count + 1 >= 10 THEN … END` と書けば、現行のドメインモデルを一切変えずに原子性が得られる。しかし「10 回で 15 分」という規則が `LoginThrottlePolicy` とアダプターの SQL の 2 か所に書かれることになる。`CLAUDE.md` の「値の正典はその値が意味を持つ層に置く」に反し、しきい値を変えるときに 2 か所を直すことになる。導出に変えれば規則は 1 か所に残る。不採用。

### 転送境界のレート制限も D1 で数える

ストアが 1 つに揃い、しきい値の管理も 1 か所になる。しかし公開検索は無認証で誰でも叩ける経路であり、そこに D1 への書き込みを 1 回ずつ足すと、レート制限のためのコストがレート制限で防ぎたい負荷とほぼ同じ形で発生する。粗さで足りる要件に、正確さのコストを払う理由がない。不採用。

### `RATE_LIMITED` も `THROTTLED` と同じ機構で数え、コードを 1 本に統一する

保証が揃うので [presentation/index.md](../presentation/index.md) の「3 コードを 1 本に畳まない理由」も書き直せる。しかし畳まない理由は保証の違いではなく**利用者に示す次の一手の違い**（待機か、パスワード再設定か、単なる抑止か）であり、機構を揃えても消えない。不採用。

## 影響

- `LoginAttempt` から `lockedUntil` が消え、`login_attempts` から `locked_until` 列が消える
- `LoginThrottlePolicy` から `recordFailure` が消え、`evaluate` がロックを導出する。しきい値（10 回 / 15 分 / 24 時間）の正典は引き続きこのドメインサービス
- `LoginAttemptStore` の `put(attempt, ttlMs)` が `recordFailure(key, now, ttlMs): Promise<LoginAttempt>` に変わる。**ポートの契約に「単一の原子的な操作でなければならない（読んでから書く実装を禁ずる）」を明記する**
- `signInWithPassword` / `verifySharePassword` の手順が変わる。応答に載せる待機秒数・解除時刻は加算後の値から導く
- `OAuthStateStore.take` と `IdempotencyStore.markProcessed` の原子性の根拠が「単一 SQL 文」として明文化される。どちらも既に「取得と同時に削除」「既に処理済みなら false」という原子的な契約を持っており、実現手段が決まっただけで契約は変わらない
- [presentation/index.md](../presentation/index.md) の保留 3 件（レート制限の実現手段・`clientKey` の材料・転送境界のしきい値）と `AppConfig` の未定 2 件が解消する
- [ADR 一覧と前提依存マップ](./index.md) の未決項目「調整状態の置き場」が解消する
