# レビュー 002 — Spec Canon

## Spec Canon

### Blockers

なし。

契約の実物（ポート JSDoc / メモリ実装 / 適合スイート / ユースケース / テスト）と spec の記述を突き合わせた範囲では、canon が現在形の真から外れている箇所は見つからなかった。特に次は 1 つずつ確認して一致していた。

- `beginRelease` の CAS 条件（`active` かつ所有者一致かつトークン一致の行だけ。行なし / `reserved` / `releasing` / 別利用者 / トークン不一致は no-op）— `spec/domains/identity.md:428` / DOM-062 / ADP-041 と `adapters/memory/repositories/identityUniqueDirectory.ts:142-150`、適合スイートの 5 分岐
- `resolve` が `resolveClaim` の射影であること — `spec/domains/identity.md:426` / DOM-027 / ADP-006 と memory の `activeClaim()` 経由、適合ケース「resolve is a projection of resolveClaim in every state」（4 状態）
- `claimToken` の契約が 2 性質だけであること（生存中不変 / 張り直しで必ず変わる、**同じ operation ID でも**）— `spec/domains/identity.md:422` とポート JSDoc、適合ケース 2 本
- 観測 → 判定 → 条件付き解放の順序と、観測 `null` でも `release(operationId)` を呼ぶこと — `spec/usecases/identity.md:615` / ADR 060 決定と `application/identity/identityRemovalRelease.ts:51-91`、`uniqueness.ts:204-221`
- `ensureAddable` の**前**に `findOAuth` を引くこと（2 経路）— `spec/domains/identity.md:286` / `spec/usecases/identity.md:271,349` と `linkOAuthIdentity.ts:146-165`、`completeOAuthSignIn.ts:355-380`
- 台帳の採番と 1 対 1 対応 — DOM-066 / ADP-042 / TC-342〜345 に衝突なし、各群の末尾に採番、TC 行と `spec/testcases/identity/*.md` の新規行が 4 対 4 で対応、適合ケースは行にせず `it` 名で ID を名乗る規約（ADR 052 / 058 / 059）に従っている
- ADR 060 の題・ステータス・節構成が既存 ADR（例: 059）と揃い、`spec/adr/index.md` の一覧行（題が H1 と逐語一致）と前提依存マップ行（前提が ADR 本文の「## 前提」と一致）が同期している
- `spec/database/index.md` の `claim_token` 追加は `spec/platform/index.md:34,98`（global D1 の `identity_unique_reservations`）と矛盾しない

### Warnings

- **[W-001]** ADR 060 が GitHub Issue 番号（`#11` / `#19`）を canon に持ち込んでいる
  - 場所: `spec/adr/060-conditional-unique-claim-teardown.md:15`, `spec/adr/060-conditional-unique-claim-teardown.md:55`
  - 理由: `spec/` 全体でトラッカー番号を参照しているのはこの 2 か所だけ（他の ADR は「Workers の CPU 上限」のように条件そのものを書く）。Issue は閉じたり付け替えられたりするので、canon 側の記述が黙って古びる。特に 55 行目の「観測性の課題として複数ワーカー化（#11 / #19）に**持ち越す**」は進捗ログの語り口で、`spec/index.md` が禁じている「進捗を置かない」に触れる
  - 提案: 番号を落として条件で書く（15 行目は「配送が複数ワーカーへ広がると、窓は単一プロセスの実行順という偶然に守られなくなる」、55 行目は「CAS が外れた回数は数えられない。観測性は複数ワーカー配備の際に見直す」）。番号で追いたい情報は `.thread/` 側に置く

- **[W-002]** 4 つの台帳の「最終同期」日付が `2026-08-22` のまま
  - 場所: `spec/inventory/adapter.md:3`, `spec/inventory/domain.md:3`, `spec/inventory/test.md:3`, `spec/inventory/usecase.md:3`
  - 理由: 本 PR は 2026-08-24 に生成元（`spec/domains/` / `spec/usecases/` / `spec/testcases/`）と台帳の両方を変えているので、「最終同期: 2026-08-22」は現在形の真ではない。履歴上、台帳を後日更新した回（`20dcc6c` が 08-09→08-16、`49d8aba` が 08-16→08-22）はいずれもヘッダーを更新しており、据え置いた前例は無い
  - 提案: 4 ファイルとも `2026-08-24` に更新する

- **[W-003]** ADR 038 の却下理由の第 1 句が、ADR 060 で実際に払ったコストと食い違う
  - 場所: `spec/adr/038-provider-account-claim-and-identity-row.md:34`
  - 理由: 「受領に operation ID を凍結する」案の却下理由として「ポート・アダプター・適合スイートの変更に波及し」を今も先頭に挙げているが、ADR 060 はまさにその波及（`resolveClaim` 追加・`expectedClaimToken` 必須化・適合ケース追加）を受け入れた。ADR 060 の代替案節が「却下の理由は効果の差ではなく、**平面の境界と受領の内容**である」と書いているのに、038 側には差別化しない理由が残っているので、2 ADR を並べて読むと却下判断の根拠が定まらない
  - 提案: 038:34 から「ポート・アダプター・適合スイートの変更に波及し」を落とし、平面をまたぐ読みと 30 日保持の受領への永続化だけを理由として残す（060 側の記述と一致する）

- **[W-004]** `deleteAccount` の global cleanup の記述が無条件のままで、ADR 060 が記録した「回収できない `releasing` 行」を反映していない
  - 場所: `spec/usecases/identity.md:824`（対応する canon: `spec/adr/060-conditional-unique-claim-teardown.md:53`）
  - 理由: 824 行は「最大 8 件の Identity に対応する**全** OAuth providerAccount reservation を finalize 時に releasing→release する」と読める。ADR 060 の決定で `releasing` 行は付け替えた operation の `release` だけが落とせるようになり、影響節も「`deleteAccount` の `globalCleanup` もその鍵を回収できず、利用者が退会してもその鍵は parked のまま残る」と明記している。ユースケース本文だけを読むと退会で必ず鍵が空くと読めてしまい、`spec/usecases/` と `spec/adr/` が食い違う
  - 提案: 824 行の末尾に 1 句足す（例: 「他 operation が残した `releasing` 行は落とせないので、その鍵は parked のまま残る（[ADR 060](../adr/060-conditional-unique-claim-teardown.md)）」）

- **[W-005]** ADR 060 のコンテキストが、本 PR で偽になった実装状態を現在形で述べている
  - 場所: `spec/adr/060-conditional-unique-claim-teardown.md:13`
  - 理由: 「この状態で本人が再連携すると、**現行の実装は** 2 件目の identity 行を生やし、1 件目は永久に claim を持てない」— この決定を入れた結果、現行の実装は `findOAuth` で既存行を再利用するので、この文は今の コードについて偽。ADR 038:11 の「実測でも…セッションが発行された」は過去の観測として真のままだが、こちらは現在形で実装状態を主張している
  - 提案: 構造の記述に直す（例: 「治癒の経路が無ければ再連携は 2 件目の identity 行を生やし、1 件目は永久に claim を持てない」）

- **[W-006]** `claim_token` の採番規則が、`activate` の更新書き込みでの再採番まで許す読み方を残す
  - 場所: `spec/database/index.md:53`, `spec/database/index.md:58`
  - 理由: 「行を新規に書くたびに採番」は「行を書くたび」と読めば `reserved`→`active` の更新でも採番することになり、そのとき冪等な `activate` の再実行で値が変われば「claim が生きているあいだ不変」（`spec/domains/identity.md:422`）を破る。memory バックエンドは `reserve` の行作成時にだけ採番して `activate` はスプレッドで持ち回っており、D1 実装にも同じ制約が要る。同じ行に「`operation_id` や `updated_at` からの導出は契約を満たさない」と否定形の注意は書かれているのに、肯定形の規則だけが緩い
  - 提案: 「行を新規に挿入するたび（`reserve` で行を作るたび）に採番し、`activate` / `beginRelease` の更新では引き継ぐ」と書き切る

### カバレッジ

- 確認: `spec/adr/060-conditional-unique-claim-teardown.md`, `spec/adr/038-provider-account-claim-and-identity-row.md`, `spec/adr/054-provider-account-uniqueness-owner.md`, `spec/adr/index.md`, `spec/database/index.md`, `spec/domains/identity.md`, `spec/usecases/identity.md`, `spec/inventory/adapter.md`, `spec/inventory/domain.md`, `spec/inventory/test.md`, `spec/inventory/usecase.md`, `spec/testcases/identity/completeOAuthSignIn.md`, `spec/testcases/identity/linkOAuthIdentity.md`, `spec/testcases/identity/removeIdentity.md`
- 確認（spec との突き合わせ用に実物を読んだコード）: `packages/core/src/domain/identity/ports/identityUniqueDirectory.ts`, `packages/core/src/domain/identity/services/identityPolicy.ts`, `packages/core/src/application/identity/uniqueness.ts`, `packages/core/src/application/identity/identityRemovalRelease.ts`, `packages/core/src/application/identity/linkOAuthIdentity.ts`, `packages/core/src/application/identity/completeOAuthSignIn.ts`, `packages/core/src/adapters/conformance/identityUniqueDirectory.ts`, `packages/core/src/adapters/memory/repositories/identityUniqueDirectory.ts`, `packages/core/src/adapters/memory/store.ts`, `packages/core/src/application/identity/__tests__/checkHandleAvailability.test.ts`, `packages/core/src/application/identity/__tests__/completeOAuthSignIn.test.ts`, `packages/core/src/application/identity/__tests__/linkOAuthIdentity.test.ts`, `packages/core/src/application/identity/__tests__/removeIdentity.test.ts`
- スキップ: `.thread/21/adr.md`, `.thread/21/plan.md`, `.thread/21/steps.md`, `.thread/21/testing.md`, `.thread/21/review/review-001.md`, `.thread/21/review/review-001-adapter.md`, `.thread/21/review/review-001-domain.md`, `.thread/21/review/review-001-spec.md`, `.thread/21/review/review-001-usecase.md`, `.thread/21/review/triage.md` — 計画・レビューの成果物であって canon ではないため（契約と既出判定の参照元としては読んだ）
