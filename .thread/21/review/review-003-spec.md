# レビュー 003 — Spec Canon

## Spec Canon

### Blockers

なし。

ADR 038 / 054 / 060 の三者、`spec/adr/index.md` の一覧と前提依存マップ、`spec/inventory/*.md` の 4 台帳、`spec/domains/identity.md` / `spec/usecases/identity.md` / `spec/testcases/identity/*.md` / `spec/database/index.md` の記述をコードの実物と突き合わせた範囲で、canon が実装について偽になっている箇所・台帳と本文が食い違う箇所は見つからなかった。

主な突合結果（いずれも一致）:

- `beginRelease` の CAS 条件（`active` かつ所有者一致かつトークン一致だけが遷移、他はすべて no-op）は `packages/core/src/adapters/memory/repositories/identityUniqueDirectory.ts:140-160` の実物と一致。本文（`spec/domains/identity.md:426`）・DOM-identity-062・ADP-identity-041 の 3 か所が同じ列挙を書いている
- 「`resolve` は `resolveClaim` の射影」は memory の `activeClaim` 経由の実装（同ファイル 42-65）と一致し、本文・DOM-identity-027・ADP-identity-006 が同文で対応。ADR 059 の非対称ルールに沿って両台帳がそろっている
- `claimToken` の 2 性質（claim 生存中は不変 / 張り直しで必ず変化、**同じ operation ID でも**）は適合スイート `identityUniqueDirectory.ts:273` / `283` が実行形として拘束し、memory は `backend.nextClaimToken()`（`store.ts:479`、行挿入時のみ採番）で満たす。`spec/database/index.md:53,58` の `claim_token` 列と「`activate` / `beginRelease` の UPDATE では引き継ぐ」は同じ性質の D1 側の具体化で、`spec/platform/index.md:98,133`（reserve → activate/release、D1 query 予算）と矛盾しない
- 観測順序（観測 → 判定 → 条件付き解放）は `identityRemovalRelease.ts:53-97` の実物どおりで、`spec/usecases/identity.md:615` と ADR 060 決定 4 が同じことを書いている。`keep` 分岐が `release` を呼ばないことも ADR 060 影響 2 の「隔離されず受領が保持期限内にあるあいだは収束する」と整合
- `findOAuth` を `ensureAddable` の**前**に引く順序は `linkOAuthIdentity.ts:148-165` / `completeOAuthSignIn.ts:362-384` の実物どおりで、`spec/domains/identity.md:283`（ドメインサービス節）・`spec/usecases/identity.md:271,349`・UC-identity-006/007・DOM-identity-019 が一致
- ADR 038 の代替案「受領に operation ID を凍結」は**却下のまま**残り、却下理由が「効果が変わらない / 波及が大きい」から「平面の境界と受領の内容」へ書き換わっている。本 PR がポート・アダプター・適合スイートを実際に変えた以上、旧理由は偽になっていたので、有効な却下判断を保ったまま現在形へ直せている。ADR 060 の同名節も「却下のままとする」と明記していて二重管理になっていない
- ADR 054 は担保元（全利用者にまたがる一意性 = ディレクトリ）を動かさず、1 利用者集合内の重複だけを `IdentityPolicy.findOAuth` へ振る追記で、ADR 060 決定 7 と同じ切り分け
- `spec/adr/index.md` は一覧行と前提依存マップ行の両方に 060 を追加済みで、マップの前提列が ADR 060 本文の「前提」節（023 / 026 / 048 / 038 / 054 / at-least-once）と過不足なく一致
- 採番: TC-identity-342〜346・ADP-identity-042・DOM-identity-066 はいずれも各群の末尾で、台帳内に重複なし（ADR 052）。テストケース表の行数と TC 行数は removeIdentity 11=11 / linkOAuthIdentity 11=11 / completeOAuthSignIn 18=18 で一致。TC-identity-342〜346 の期待結果は `removeIdentity.test.ts:357,394,447` / `linkOAuthIdentity.test.ts:282` / `completeOAuthSignIn.test.ts:348` の主張と一致し、実行して通ることも確認した（対象 48 件 + 適合スイート 239 件がパス）
- 進捗ログ・日付つき改訂履歴・トラッカー番号・「変更した」といった記述の混入はなし（`最終同期` 日付の更新は台帳の既存規約）
- plan.md の「含まれないもの」を越える変更なし。変更ファイルは identity 一式に閉じており、`updateProfile` / `deleteAccount` は契約変更への追随（`releaseActiveUniqueKey` の内部が観測付きになるだけ）に留まっている。閉じないと決めた窓は ADR 060 影響の最終 2 行と `spec/usecases/identity.md:824` に現在形の性質として記録されている

### Warnings

- **[W-001]** `claimToken` の適合機構の例示に「書き込みごとの UUID」が入っていて、直前に書いた「claim が生きているあいだ不変」と字義どおりには両立しない
  - 場所: `spec/domains/identity.md:422`（同文が `packages/core/src/domain/identity/ports/identityUniqueDirectory.ts:21-24` の JSDoc にもある）
  - 理由: 「単調カウンタや**書き込みごとの** UUID は適合し」を字義どおり読むと、`activate` の `UPDATE` でも新しい UUID を採番する実装が適合することになる。それは同じ段落の第 1 性質（冪等な `activate` の再実行でも変わらない）を破り、適合スイートの `ADP-identity-042: the token stays the same for as long as the claim lives` が落とす。文脈上は「claim を作る書き込みごと」の意図と読めるし、`spec/database/index.md:58` は D1 について「`activate` / `beginRelease` の UPDATE では既存の値を引き継ぐ」と明示しているので現行 2 バックエンドは守られるが、canon 単独で読む次のバックエンド実装者（#11 の D1 / DO）に対しては、契約が禁じる機構を許可として提示している
  - 提案: 「行を作る書き込みごとの UUID」「claim ごとに採番される UUID」のように、採番の単位が claim であることを例示側にも書く。ポート JSDoc の `a per-write UUID` も同様に `a UUID minted when the claim's row is written` 等へそろえる

### カバレッジ

- 確認: `spec/adr/038-provider-account-claim-and-identity-row.md`, `spec/adr/054-provider-account-uniqueness-owner.md`, `spec/adr/060-conditional-unique-claim-teardown.md`, `spec/adr/index.md`, `spec/database/index.md`, `spec/domains/identity.md`, `spec/inventory/adapter.md`, `spec/inventory/domain.md`, `spec/inventory/test.md`, `spec/inventory/usecase.md`, `spec/testcases/identity/completeOAuthSignIn.md`, `spec/testcases/identity/linkOAuthIdentity.md`, `spec/testcases/identity/removeIdentity.md`, `spec/usecases/identity.md`
- 確認（canon の真偽を突き合わせる相手として全文読了）: `packages/core/src/domain/identity/ports/identityUniqueDirectory.ts`, `packages/core/src/domain/identity/services/identityPolicy.ts`, `packages/core/src/adapters/conformance/identityUniqueDirectory.ts`, `packages/core/src/adapters/memory/repositories/identityUniqueDirectory.ts`, `packages/core/src/adapters/memory/store.ts`, `packages/core/src/application/identity/uniqueness.ts`, `packages/core/src/application/identity/identityRemovalRelease.ts`, `packages/core/src/application/identity/linkOAuthIdentity.ts`, `packages/core/src/application/identity/completeOAuthSignIn.ts`, `packages/core/src/application/identity/__tests__/removeIdentity.test.ts`, `packages/core/src/application/identity/__tests__/linkOAuthIdentity.test.ts`, `packages/core/src/application/identity/__tests__/completeOAuthSignIn.test.ts`, `packages/core/src/application/identity/__tests__/checkHandleAvailability.test.ts`
- スキップ: なし
