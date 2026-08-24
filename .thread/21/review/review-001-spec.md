# レビュー R001 — Spec Canon

## Spec Canon

### Blockers

- **[B-001]** ポート契約に足した `claimToken` を、最終基盤の表設計が供給できない（DB 設計が canon から取り残されている）
  - 場所: `spec/database/index.md:47-57`（`### identity_unique_reservations`）
  - 理由: この PR は `IdentityUniqueDirectory` の**契約**に「1 つの claim を同定する不透明値」を足し、`spec/domains/identity.md:422` と ADR 060 が「張り直した claim とは必ず異なる — **同じ operation ID で張り直した場合でも**」を契約文にした。ところが `identity_unique_reservations` の列は `kind` / `normalized_key`（PK） / `user_id` / `operation_id` / `state` / `expires_at` / `updated_at` だけで、この観測値を供給できる列が無い。`operation_id` からの導出は契約が明示的に禁じた形（同じ ID の claim が同じ鍵に 2 回生まれる）、`updated_at` は release → 再 reserve が同一 ms に収まると同値になりうるうえ「claim が生きているあいだ不変」を状態遷移（`activate` の冪等再実行が行を触るか否か）に依存させる。SQLite の `rowid` も PK 指定のこの表では再利用されうるので担保にならない。`spec/database/index.md` は「global D1 と scope DO の配置・表・索引」の正典（`spec/index.md:37`）であり、同じファイルは `identity_removal_receipts` のように identity 側の契約変更に追随してきた実績がある。本 Issue の目的が「複数ワーカー / リモート DB 配備の前に契約を確定させる」ことである以上、契約を満たせない表設計を canon に残すのは、この PR が閉じにいった穴をそのまま次のバックエンドへ引き渡すことになる。
  - 提案: 表に 1 列足す（例: `claim_token` text NOT NULL — 行を新規に書くたびに新しい値を採番する）。あわせて `spec/database/index.md:57` の散文に「取り壊しは `claim_token` 一致を条件とする compare-and-set で、`operation_id` や `updated_at` からの導出は契約を満たさない」を 1 文で書く。契約が「どの書き込みで採番するかは問わない」（ADR 060 決定 3 番目）ままであることは変わらない — canon が要求するのは「D1 でこの契約を満たす表がどれか」が一意に読めることである。

### Warnings

- **[W-001]** ADR 060 の前提から ADR 054 が抜けている
  - 場所: `spec/adr/060-conditional-unique-claim-teardown.md:19`、`spec/adr/index.md:125`
  - 理由: 060 の決定 6 番目（`IdentityPolicy.findOAuth` で 1 利用者内の重複を見る）は、「provider account の一意性の担保は予約ディレクトリ 1 か所」（ADR 054）を前提にして初めて「担保元は動かない」と言える — リポジトリ側に一意検査を足す選択肢を落としたのも 054 が理由である。決定本文には `[ADR 054]` へのリンクがあるのに、`## 前提` と前提依存マップの行はどちらも 023 / 026 / 048 / 038 だけを挙げる。前提依存マップは「その前提が動いたら何を見直すか」を引くための表なので、054 を見直したときに 060 の治癒規則が射程に入らない。逆側（054 の影響）には 060 への言及が入っているぶん、片方向だけの接続になっている。
  - 提案: `## 前提` の末尾に「provider account の一意性の担保が予約ディレクトリ 1 か所にあること（[ADR 054](./054-provider-account-uniqueness-owner.md)）」を足し、`spec/adr/index.md:125` の依存欄にも「一意性の担保元が予約ディレクトリであること（054）」を加える。

- **[W-002]** 「ワーカー経路は自力で収束する」が無条件の主張として canon に入っている
  - 場所: `spec/adr/060-conditional-unique-claim-teardown.md:52`
  - 理由: ADR-007（`.thread/21/adr.md`）は同じ帰結を「**その行が隔離されない限り**自力で収束する（outbox の行は `maxAttempts` 超過で隔離され再配送が止まるので、収束は無条件ではない）」と条件付きで書いているが、canon に落ちた影響欄からこの但し書きが消えている。孤児 `releasing` 行の回収経路がこの PR で「同じ operation の `release` 再実行だけ」に一本化された（同じ行の前半）以上、収束しない列が残ることは 060 が引き受けた帰結そのものである。実際、隔離のほか receipt の 30 日保持が切れた後の再配送は `keep(noReceipt)` に倒れて `release` に到達しないので、`releasing` 行は残る。無条件に読める書き方は、060 が ADR 038 の「解放が恒久的に落ちた場合は固まる — 誤って通すより安全側」より強い保証を主張しているように読める。
  - 提案: 52 行目を「ワーカー経路は event 再配送が同じ operation ID を再導出するので、その行が隔離されず受領が残っているあいだは自力で収束する（隔離・受領の保持期限切れの後は固まる — [ADR 038](./038-provider-account-claim-and-identity-row.md) の範囲）」に直す。

- **[W-003]** 「観測が `null` でも `release(operationId)` は必ず呼ぶ」が、判定が `keep` に倒れた場合を含んで読める
  - 場所: `spec/usecases/identity.md:615`（`removeIdentity` 手順 4）
  - 理由: 実装（`packages/core/src/application/identity/identityRemovalRelease.ts:80-88`）は `keep` の 3 分岐で `release` を呼ばずに return する。呼ぶのは「解放する」と判定したときだけで、この文はその条件を書いていない。手順 4 は同じ段落で `keep` 側の判定条件を明示していない（「正データ削除後にだけ解放する」としか書いていない）ので、canon だけを読んだ実装者は「判定によらず常に `release` を呼ぶ」に到達できてしまう。W-002 の残存列とも読み合わせが必要な箇所である。
  - 提案: 「**解放すると判定したときは**、観測が `null` でも `release(operationId)` を必ず呼ぶ」と主語を補う。

- **[W-004]** 却下理由の変遷そのものが canon に書かれている（現在形で書く方針からの逸脱）
  - 場所: `spec/adr/038-provider-account-claim-and-identity-row.md:36`、`spec/adr/060-conditional-unique-claim-teardown.md:39`、同 `:52`
  - 理由: `spec/index.md:5` は「進捗、レビュー記録、日付つきの改訂履歴、廃止済みの判断は置かず、変更の履歴は Git で管理する」と定めている。038:36 の「なお『効果は変わらない』という当初の理由は古びた」と 060:39 の「ただし当時の却下理由のうち『効果は変わらない』は古びた」は、**既に本文から削除済みの理由**を名指しして「古びた」と述べる、経緯そのものの記述である（現在有効な却下理由は同じ段落の前半に現在形で書かれており、それだけで足りる）。060:52 の「〜だけになった」も、変更前後の対比を含む書き方になっている。有効な却下判断（受領への operation ID 凍結を却下したまま維持する）が 038 と 060 の両方に現在形で残っている点は方針どおりで、そこは問題ない。
  - 提案: 038:36 は「判定と取り壊しのあいだの窓は、受領への凍結ではなく [ADR 060] の条件付き取り壊しが閉じる」の 1 文に縮める。060:39 は「効果の差ではなく、平面の境界と受領の内容が却下の理由である」だけを残す。060:52 は「〜だけである」に直す。

- **[W-005]** ADR 060 が 2 つの決定を抱えているのに、題と索引は片方しか表していない
  - 場所: `spec/adr/060-conditional-unique-claim-teardown.md:1`、`spec/adr/index.md:65`
  - 理由: 060 の決定 6 番目（`findOAuth` による 1 利用者内重複の治癒）は、取り壊しの条件付き化とは別の機構・別の層（ドメインサービスとユースケース）の判断である。`spec/adr/index.md` は「現在有効な非自明な設計判断の索引」なので、題が取り壊しだけを名乗ると、「なぜ `linkOAuthIdentity` が既存行を見つけたら insert を飛ばすのか」を索引から引けない。`spec/domains/identity.md` と `spec/usecases/identity.md` からのリンクがあるぶん到達不能ではないが、索引としては欠けている。
  - 提案: 題を両方を含む形（例:「恒久 claim の取り壊しは観測した claim に対する条件付きにし、失われた claim は再連携で治癒する」）に広げて `spec/adr/index.md:65` の行もそろえるか、治癒を 061 として分ける。

### カバレッジ

- 確認: `spec/adr/060-conditional-unique-claim-teardown.md`, `spec/adr/index.md`, `spec/adr/038-provider-account-claim-and-identity-row.md`, `spec/adr/054-provider-account-uniqueness-owner.md`, `spec/domains/identity.md`, `spec/usecases/identity.md`, `spec/inventory/adapter.md`, `spec/inventory/domain.md`, `spec/inventory/test.md`, `spec/inventory/usecase.md`, `spec/testcases/identity/removeIdentity.md`, `spec/testcases/identity/linkOAuthIdentity.md`, `spec/testcases/identity/completeOAuthSignIn.md`, `packages/core/src/domain/identity/ports/identityUniqueDirectory.ts`, `packages/core/src/domain/identity/services/identityPolicy.ts`, `packages/core/src/application/identity/uniqueness.ts`, `packages/core/src/application/identity/identityRemovalRelease.ts`, `packages/core/src/application/identity/linkOAuthIdentity.ts`, `packages/core/src/application/identity/completeOAuthSignIn.ts`, `packages/core/src/adapters/conformance/identityUniqueDirectory.ts`, `packages/core/src/adapters/memory/repositories/identityUniqueDirectory.ts`, `packages/core/src/adapters/memory/store.ts`, `packages/core/src/application/identity/__tests__/removeIdentity.test.ts`, `packages/core/src/application/identity/__tests__/linkOAuthIdentity.test.ts`, `packages/core/src/application/identity/__tests__/completeOAuthSignIn.test.ts`, `packages/core/src/application/identity/__tests__/checkHandleAvailability.test.ts`
- スキップ: `.thread/21/plan.md`, `.thread/21/adr.md`, `.thread/21/steps.md`, `.thread/21/testing.md` — 計画の成果物であって canon ではない（本レビューでは契約・判断の照合材料としてのみ参照した）

### 照合できた点（指摘なし）

- 新規採番の衝突なし: `ADP-identity-042` / `DOM-identity-066` / `TC-identity-342`〜`345` はいずれも spec 全体で 1 か所のみ。既存最大値（041 / 065 / 341）の直後で、ADR 052 の「各群の末尾に採番する」に従っている。
- 台帳と本文・コードの双方向の対応: 本文に足した契約（`resolveClaim` / `beginRelease` の CAS / `resolve` の射影 / `findOAuth`）はすべて `ADP-identity-042` / `DOM-identity-066` / `ADP-identity-041` / `DOM-identity-062` / `ADP-identity-006` / `DOM-identity-027` / `DOM-identity-019` に対応行があり、逆に台帳にしか無い主張は見つからなかった。DOM 行と ADP 行は同文で、ADR 059 の非対称も生んでいない。
- テストケースの過不足: `spec/testcases/identity/*.md` に足した 4 行が `TC-identity-342`〜`345` と 1 対 1 で、実テスト（`removeIdentity.test.ts` の 2 件、`linkOAuthIdentity.test.ts`、`completeOAuthSignIn.test.ts`）の主張と期待欄が一致する。適合ケースは ADR 052 / 058 のとおり行を作らず、ケース名の先頭に `ADP-identity-041` / `042` を名乗っている。
- ポート JSDoc と `spec/domains/identity.md#ポート` の一致: 不透明性、claim 存続中の不変性、同じ operation ID での張り直しでも異なること、`releasing` の `claimToken` 未規定、決定的 operation ID の要求、`resolve` の射影関係が両側で同文の主張になっており、適合スイートが 4 状態の射影・同一 operation ID での張り直し・古いトークンの no-op・`releasing` の奪取不可を実行形で拘束している。
- `spec/usecases/identity.md` の手順 6 / 8（`completeOAuthSignIn`）と手順 4（`linkOAuthIdentity`）が、`ensureAddable` の**前**に `findOAuth` を引くという load-bearing な順序を含めてコードと一致する。`spec/domains/identity.md` の「唯一の担保」散文と ADR 054 の境界も両側で同じ切り方（全利用者にまたがる一意性 vs 1 利用者の集合内）になっており、矛盾は無い。
- スコープ逸脱なし: spec の変更は identity ドメインと関連 ADR に閉じており、plan.md の「含まれないもの」に挙がった項目（Cloudflare アダプター、OCC リトライ、TTL 見直し、`releasing` への期限、`resolve` の全面置換、3 経路の述語統一）を canon に持ち込んでいない。
