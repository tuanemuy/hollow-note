# レビュー 002 — Adapter

## Adapter

### Blockers

なし

### Warnings

- **[W-001]** `conformance/identityUniqueDirectory.ts:kind` — 適合スイートが `kind` を 1 ケースも区別していない
  - 場所: `packages/core/src/adapters/conformance/identityUniqueDirectory.ts:196-330`（ADP-identity-041 / 042 の全ケース）
  - 理由: ポートは `(kind, normalizedKey)` の 2 つ組で行を引く契約で、`spec/database/index.md` の PK も `(kind, normalized_key)` の複合。ところが memory 実装の `rowKey` から `kind` を落として `normalizedKey` だけを鍵にする変異を入れても、`IdentityUniqueDirectory` の 21 ケースが**全部通る**（確認済み）。つまり「`kind` が違えば別の行」という契約は適合スイートに実行形を持っていない。既存の `resolve` / `reserve` から持ち越された穴だが、本 PR は `kind` を取る新メソッド `resolveClaim` と、`kind` を条件に含む CAS `beginRelease` を足しているので、`claimToken` を「観測した `(kind, normalizedKey)` の文脈で 1 つの claim を同定する値」と定義した以上（ポート JSDoc / `spec/inventory/adapter.md:91`）、`kind` の分離こそ ADP-identity-042 が拘束すべき前提になっている。今の状態では、`kind` を無視する D1 スキーマ（`normalized_key` 単独 PK）が適合ランを緑にしたまま `handle` と `email` の claim を取り違えうる。
  - 提案: 1 ケースで足りる。同じ `normalizedKey`（例 `"a@example.com"`）を `email` と `handle` の両方で `reserve` → `activate` し、(a) `resolve` / `resolveClaim` がそれぞれ別の所有者・別のトークンを返すこと、(b) 片方の観測値で `beginRelease` + `release` してももう片方の claim が生き残ること、を拘束する。既存ケースの書き換えは不要。

- **[W-002]** `conformance/identityUniqueDirectory.ts:218` — 契約にない「トークン非空」をスイートが要求している
  - 場所: `packages/core/src/adapters/conformance/identityUniqueDirectory.ts:218`（`expect(claim?.claimToken).not.toBe("")`）
  - 理由: ポート JSDoc が `claimToken` に課す性質は明示的に 2 つだけ（claim が生きているあいだ不変 / 張り直した claim とは必ず異なる）で、`spec/domains/identity.md` も「この 2 つ以外は契約に含まない」と書いている。空文字を最初の claim のトークンに使うバックエンドはこの 2 性質を満たすのにこのアサーションだけで落ちる。ADR 026 の「ポート定義が正典、スイートはその実行形」に対して、スイート側が正典より一段強い。しかも実効性はほぼゼロで、定数トークンや導出トークンを落としているのは隣の「a re-taken claim carries a different token」（変異注入で確認済み）である。
  - 提案: どちらかに寄せる。(a) ポート JSDoc と `spec/domains/identity.md#ポート` に「非空」を第 3 の性質として足す、または (b) このアサーションを削り、`claim` が非 null であることの確認（すぐ下の `if (claim === null) throw`）だけに任せる。実効性から見て (b) が素直。

- **[W-003]** `spec/database/index.md:53,58` — `claim_token` の記述が「状態遷移では引き継ぐ」を明示していない
  - 場所: `spec/database/index.md:53`（列定義）/ `:58`（本文）
  - 理由: 契約で最も落としやすいのは「冪等な `activate` の再実行でトークンが変わらない」ことで、実際 memory 実装で `activate` の書き戻しに再採番を混ぜる変異は適合ケース「the token stays the same for as long as the claim lives」で落ちる。ところが D1 側の記述は「行を新規に書くたびに採番する — `operation_id` や `updated_at` からの導出は契約を満たさない」だけで、`activate` / `beginRelease` が同じ行への `UPDATE` である（＝そこでは採番しない）ことは読み手の推測に委ねられている。D1 の `activate` は `UPDATE ... SET state='active', user_version=? WHERE operation_id=?` と書くのが自然で、そこに `claim_token=?` を並べる書き方は十分ありうる誤り。列定義側が `NOT NULL` 固定（`expires_at` が「reserved時NOT NULL」と条件付きなのと対照的）なのも、採番点が `reserve` に固定されている前提を示しているだけで、`UPDATE` 側の禁止は書かれていない。
  - 提案: 本文の該当文に半文足す。「採番は行を新規に書くときだけで、`activate` / `beginRelease` の状態遷移では既存の `claim_token` をそのまま引き継ぐ」。列定義側は現状のままでよい。

- **[W-004]** `memory/store.ts:470-476` — `nextClaimToken` の JSDoc がディレクトリ生成の頻度を実際より弱く書いている
  - 場所: `packages/core/src/adapters/memory/store.ts:470-476`
  - 理由: 「that factory is called once per container (global UoW / request / worker)」とあるが、`adapters/memory/globalUnitOfWork.ts:62` は `createMemoryIdentityUniqueDirectory(backend)` を `run()` の**呼び出しごと**に作る。カウンターをファクトリ内に置けなかった理由（別インスタンス間で `claim-1` が衝突し、「張り直した claim は必ず別トークン」が壊れる）は結論としては正しく、実際にはコメントが言うより強い制約なので、記述だけが実態より緩い。ここはトークンの一意性が backend スコープに依存することを説明する唯一の場所なので、正確であってほしい。
  - 提案: 「called once per container」を「作られるのはコンテナごと（request / worker）と global UoW の `run` ごと」に直す。実装変更は不要。

### 検証したこと（変異注入）

memory 実装に変異を入れて `packages/core/src/adapters/memory/__tests__/conformance.test.ts` の `IdentityUniqueDirectory` 21 ケースを走らせ、契約の各条項が実効的に拘束されているかを確かめた（変異はすべて `git checkout` で戻し、作業ツリーは元の状態）。

| 変異 | 結果 |
|---|---|
| `beginRelease` からトークン一致条件を落とす | 落ちる（`beginRelease quoting a superseded token ...`） |
| `beginRelease` から `state !== "active"` を落とす | 落ちる（`a releasing row is not taken over ...`） |
| `beginRelease` から所有者一致条件を落とす | 落ちる（`beginRelease by a non-owner ...`） |
| `nextClaimToken` を定数化 | 落ちる（2 ケース） |
| `claimToken` を `operationId` から導出 | 落ちる（`a re-taken claim carries a different token`）— AC-3(b) の強い形が効いている |
| 冪等 `activate` の再実行でトークンを再採番 | 落ちる（`the token stays the same for as long as the claim lives`） |
| `resolveClaim` が `releasing` にも答える | 落ちる（3 ケース） |
| `resolveClaim` が `reserved` にも答える | 落ちる（4 ケース） |
| `resolve` を `resolveClaim` の射影でなくする | 落ちる（4 ケース） |
| `beginRelease` が `operationId` を付け替えない | 落ちる（6 ケース） |
| `release` が `active` 行も落とす | 落ちる |
| **`rowKey` から `kind` を落とす** | **通ってしまう（W-001）** |
| `beginRelease` が `reserved` 行も受け付ける | 通ってしまう（ADR 060 が「観測が取れない以上トークン条件に吸収される」と明示的に受容済み。到達経路が無いことも確認したので指摘にはしない） |
| `reserve` の冪等再実行でトークンを再採番 | 通ってしまう（`reserved` 行のトークンは観測不能なので契約上も差が無い。指摘にはしない） |
| `activate` の初回昇格でトークンを再採番 | 通ってしまう（「どの書き込みで採番するかは契約が問わない」の通りで正しい） |

### そのほか確認して問題なしと判断したもの

- **`beginRelease` の CAS 条件がポート JSDoc と 1 対 1**。「`active` かつ `expectedUserId` かつ `expectedClaimToken` 一致だけが対象、行なし / `reserved` / `releasing` / 別利用者 / トークン不一致はすべて no-op」が実装（`repositories/identityUniqueDirectory.ts:140-160`）と一致し、`spec/domains/identity.md#ポート` / `spec/inventory/adapter.md:90` の記述とも揃っている。旧実装の `row.state === "reserved"` から `row.state !== "active"` への変更で `releasing` 行の横取りが塞がった点も、新ケースが実行形として拘束している。
- **`releasing` 行の回収経路**。`beginRelease` が行を解放側 operation へ付け替えるので `release(operationId)` が拾える、という契約が「beginRelease then release frees an activated claim」「a releasing key stays blocked ... until release」「beginRelease on an unknown key is a no-op（`release` 前に鍵を取り直す形）」の 3 ケースで塞がっている。孤児 `releasing` 行の唯一の回収経路（AC-8）がアダプター側から見て成立している。
- **`resolve` が `resolveClaim` の射影であること**が 4 状態すべてで拘束されている（`resolve is a projection of resolveClaim in every state`）。memory 側も両者が同じ `activeClaim` ヘルパーを通るので構造的に射影。
- **`claimToken` の値が鍵に由来しない**（`claim-${seq}`）。ADR 048 の「鍵の値をディレクトリの外へ出さない」と整合。`ObservedUniqueClaim` は `identityRemovalRelease` / `releaseActiveUniqueKey` のローカルに閉じており、受領・イベント・ビュー・ログのいずれにも載らないことを grep で確認した。トークンの推測容易性は契約が明示的に不問としており、値がトランスポート境界を越えないので実害もない。
- **`claimTokenSeq` が backend インスタンス上にあること**。ディレクトリのファクトリは request / worker コンテナと global UoW の `run` ごとに呼ばれるので、カウンターがファクトリローカルだと別インスタンス間で `claim-1` が衝突し「張り直した claim は必ず別トークン」が壊れる。backend 側に置いた判断は正しい。ロールバック時に採番が巻き戻らない点は単調性を保つ方向なので問題なし（`MemTable` の undo は行スナップショットを戻すのでトークンも整合する）。
- **ドライバ固有エラーの翻訳**。memory バックエンドはドライバを持たず、`reserve` の競合は既存どおり `ConflictError(CONFLICT_CODES[kind])` に写しており、新設の `resolveClaim` / 変更後の `beginRelease` はどちらも投げない契約（no-op で収束）と一致している。
- **`operation_id UNIQUE` と `beginRelease` の付け替えの両立**。解放側 operation ID は `reservationOperationId(parent, key)` および `${profileOperationId(userId)}:release:handle:${handle}` のいずれも鍵ごとに一意なので、CAS の `UPDATE ... SET operation_id=?` が D1 の UNIQUE 制約に触れる列は無い。
- **`checkHandleAvailability.test.ts` の直接呼び出し**が `resolveClaim` で正しい観測値を取ってから渡す形になっており、ダミー文字列で `beginRelease` が黙って no-op になる（＝主張が抜け落ちる）形を避けている。`observed === null` を throw で潰している点も含めて妥当。
- **コード・コメントに指摘対応の経緯や弁明は残っていない**。`store.ts` の `claimToken` / `nextClaimToken`、`repositories/identityUniqueDirectory.ts` の `// A fresh row, so a fresh claim token ...` はいずれも非自明な WHY で、CLAUDE.md のコメント方針に沿う。
- スコープ逸脱なし。アダプター層の変更は memory の 3 ファイルと適合スイートに限られ、新バックエンドの追加も application レベルの OCC リトライも入っていない。
- 回帰: `packages/core/src/adapters`（281 passed / 3 skipped）と `packages/core/src/application/identity`（298 passed）が緑、`pnpm -F @repo/core typecheck` も緑。

### カバレッジ

- 確認: `packages/core/src/adapters/conformance/identityUniqueDirectory.ts`, `packages/core/src/adapters/memory/repositories/identityUniqueDirectory.ts`, `packages/core/src/adapters/memory/store.ts`, `packages/core/src/domain/identity/ports/identityUniqueDirectory.ts`, `packages/core/src/application/identity/uniqueness.ts`, `packages/core/src/application/identity/identityRemovalRelease.ts`, `packages/core/src/application/identity/__tests__/checkHandleAvailability.test.ts`, `spec/database/index.md`, `spec/domains/identity.md`, `spec/inventory/adapter.md`, `spec/adr/060-conditional-unique-claim-teardown.md`
- スキップ: `.thread/21/adr.md` — 計画成果物でレビュー対象コードではない
- スキップ: `.thread/21/plan.md` — 契約として参照したが成果物自体はレビュー対象外
- スキップ: `.thread/21/review/review-001-adapter.md` — 前ラウンドのレビュー記録
- スキップ: `.thread/21/review/review-001-domain.md` — 前ラウンドのレビュー記録
- スキップ: `.thread/21/review/review-001-spec.md` — 前ラウンドのレビュー記録
- スキップ: `.thread/21/review/review-001-usecase.md` — 前ラウンドのレビュー記録
- スキップ: `.thread/21/review/review-001.md` — 前ラウンドのレビュー記録
- スキップ: `.thread/21/review/triage.md` — 前ラウンドのトリアージ記録
- スキップ: `.thread/21/steps.md` — 計画成果物
- スキップ: `.thread/21/testing.md` — 計画成果物
- スキップ: `packages/core/src/application/identity/__tests__/completeOAuthSignIn.test.ts` — ユースケース／テスト観点の担当
- スキップ: `packages/core/src/application/identity/__tests__/linkOAuthIdentity.test.ts` — ユースケース／テスト観点の担当
- スキップ: `packages/core/src/application/identity/__tests__/removeIdentity.test.ts` — ユースケース／テスト観点の担当
- スキップ: `packages/core/src/application/identity/completeOAuthSignIn.ts` — ユースケース観点の担当
- スキップ: `packages/core/src/application/identity/linkOAuthIdentity.ts` — ユースケース観点の担当
- スキップ: `packages/core/src/domain/identity/services/identityPolicy.ts` — ドメイン観点の担当
- スキップ: `spec/adr/038-provider-account-claim-and-identity-row.md` — ADR 整合は spec 観点の担当
- スキップ: `spec/adr/054-provider-account-uniqueness-owner.md` — ADR 整合は spec 観点の担当
- スキップ: `spec/adr/index.md` — ADR 一覧・前提依存マップは spec 観点の担当
- スキップ: `spec/inventory/domain.md` — ドメイン台帳
- スキップ: `spec/inventory/test.md` — テスト台帳（ADP 系の記載は `inventory/adapter.md` 側で確認済み）
- スキップ: `spec/inventory/usecase.md` — ユースケース台帳
- スキップ: `spec/testcases/identity/completeOAuthSignIn.md` — ユースケーステストケース定義
- スキップ: `spec/testcases/identity/linkOAuthIdentity.md` — ユースケーステストケース定義
- スキップ: `spec/testcases/identity/removeIdentity.md` — ユースケーステストケース定義
- スキップ: `spec/usecases/identity.md` — ユースケース観点の担当
