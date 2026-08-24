# レビュー 002 — Domain 観点（Issue #21 / PR #41）

ゼロベースで再レビューした。契約（`IdentityUniqueDirectory` の JSDoc）は内部矛盾なく、`resolveClaim` / CAS / `releasing` の扱い / 射影関係 / トークンの 2 性質はいずれも実装可能で、memory 実装と適合スイートは契約に整合している。`IdentityPolicy.findOAuth` は純粋な集合述語で、I/O・時刻・ID 生成に依存していない。

以下は残る問題。

## Domain

### Blockers

- **[B-001]** 「解放要求が持ち主から鍵を奪えない」不変条件の唯一の砦が `observeActiveUniqueKey` の所有者比較 1 行に移ったのに、それを拘束するテストが 1 本も無い。落とすと**別利用者の恒久 claim を取り壊せる**
  - 場所: `packages/core/src/application/identity/uniqueness.ts:181`（所有者比較）/ `packages/core/src/application/identity/uniqueness.ts:215`（`expectedUserId` の供給元）
  - 理由: 本 PR より前は `identityRemovalRelease` が `beginRelease({ expectedUserId: decision.userId, ... })` と**受領由来の期待値**を渡しており、所有者ガードはポート側（適合スイート `ADP-identity-041` の「別利用者は no-op」が実行形）が持っていた。本 PR 後、`releaseObservedUniqueKey` は `expectedUserId: params.observed.userId` と**観測した行自身の所有者**を渡す。つまりこの経路ではポートの所有者条件は恒真であり、所有者ガードは `observeActiveUniqueKey` の `claim.userId !== params.expectedUserId` だけになった。ところがこの 1 行を削っても**テストは全 green のまま通る**（実際に変異を当てて `pnpm test` 相当を実行して確認: `Test Files 76 passed (76) / Tests 968 passed | 3 skipped (971)`）。
    到達列も普通の at-least-once 再配送で成立する — 配送 1 が A の claim を解放 → 別利用者 B がその外部アカウントを連携（`active` claim + identity 行）→ **同じ removal event が再配送** → 観測が B の claim を返す → 判定は受領の A 側で見るので `release` → `beginRelease`（B の所有者・B のトークン）が**成功**し、続く `release(operationId)` が行を落とす。結果は B の「identity 行はあるのに claim が消えた」状態、すなわち本 Issue が塞ぎに来た状態そのものを別利用者に対して作る。変異版でこの列を書いた探索テストが実際に失敗し（`expected undefined to match object { state: 'active', userId: <stranger> }`）、比較を戻すと通ることを確認した。
    これは ADR-004 / ADR-006 が「JSDoc の文言だけを根拠にすると全 green のまま抜ける」として AC-8（`releaseObservedUniqueKey` の早期 return）に適用し、R1 の triage が `findOAuth` の順序に適用したのと**同じ形の穴**が、同じ関数のもう 1 つの分岐に残っているということ。`uniqueness.ts:230-233` の JSDoc（「A row that is missing or held by someone else observes as `null`, so this can never take a key away from its owner」）と `spec/domains/identity.md:425`（「解放要求が持ち主から鍵を奪うことはない」）は canon としてこの性質を主張しているので、拘束が要る。
  - 提案: `removeIdentity.test.ts` に上の列（解放 → 別利用者が連携 → **同じ event を再配送** → その利用者の claim が `active` のまま残る）をユースケーステストとして足す。既存の `TC-identity-184` に再配送を 1 回足すだけでも変異は落ちる。あわせて（任意）`releaseObservedUniqueKey` が `expectedUserId` を観測値ではなく呼び出し側の期待値から取る形にすれば、ポート側の所有者条件（適合スイートが拘束済み）が二重の砦として生き続ける。台帳 ID を採るかは spec 観点の判断に委ねる。

### Warnings

- **[W-001]** `claimToken` の契約が挙げる実装例（row version / ETag）が、同じ契約の 2 番目の性質を満たさない
  - 場所: `packages/core/src/domain/identity/ports/identityUniqueDirectory.ts:19-21` / 同文の写しが `spec/domains/identity.md:422`
  - 理由: 直前の段落は「同じ `operationId` が同じ鍵を張り直しても前のトークンと一致してはならない。operation ID から導くバックエンドは契約を満たさない」と明言している。ところが続く段落は「A row version, an ETag, or a monotonic counter all qualify」と書く。**行ごとの row version は `release` で行が消えたあとの再 `reserve` で 1 に戻る**し、**内容由来の ETag は（同じ userId / 同じ operationId で張り直せば）同じ値に戻る** — どちらもまさに直前で禁じた失敗形をそのまま踏む。文の意図は「推測困難性は要らない」を例示することだが、読み手には「これらの機構は適合する」と読める。ADR 026 決定 1（JSDoc だけを読んだ実装者が到達する振る舞い＝スイートが通す振る舞い）に反する記述で、2 本目のバックエンド（D1 / DO）の実装者が最初に参照する場所でもある。
  - 提案: 例示を「claim ごとに新しく採番される値（単調カウンタ、書き込みごとの UUID など）。行の内容や `operationId` から導いた値・行の削除で振り出しに戻る版番号は適合しない」に直す。「推測困難性は要求しない」は別文として残す。spec/domains/identity.md の同文も同時に直す。

- **[W-002]** `identityRemovalRelease` の JSDoc が `beginRelease` の契約を旧仕様のまま説明している
  - 場所: `packages/core/src/application/identity/identityRemovalRelease.ts:25-26`
  - 理由: 「`beginRelease` alone only rules out a claim held by *another* user」は本 PR で `beginRelease` を CAS に変えた時点で正確でなくなった（ポート JSDoc は「`active` かつ所有者一致かつトークン一致だけ」と書いている）。しかも B-001 のとおり、この経路の `expectedUserId` は観測値から供給されるので `beginRelease` は所有者すら独立には弾いていない。同じファイルの下段（31-37 行）が新しい契約を正しく説明しているぶん、上下で食い違って読める。ここで本当に言いたいのは「再配送では観測を取り直すのでトークンは一致してしまう。だから同一利用者の張り直しは identity 行の再確認でしか弾けない」という趣旨のはずで、その主張は今も正しい。
  - 提案: 「`beginRelease` は再配送のたびに取り直した観測に対する CAS なので、同じ利用者が同じ鍵を取り直した場合は条件が一致してしまう。だからその列はここ（identity 行の再確認）で弾く」に書き換える。

- **[W-003]** 適合スイートが契約に無い性質（トークンが空文字でない）を要求している
  - 場所: `packages/core/src/adapters/conformance/identityUniqueDirectory.ts:218`
  - 理由: 契約が `claimToken` に要求するのは 2 性質だけで、値域には何も言っていない（「Nothing beyond those two is contracted」）。`not.toBe("")` は、最初の claim に空文字を採番し 2 つ目以降で別の値を返すバックエンド — 2 性質は満たす — を落とす。逆に拘束としての価値はゼロで、「常に同じ値を返す」実装は `ADP-identity-042` の「張り直した claim は別トークン」ケースが既に落とす。ADR 026 の「契約とスイートが一致する」を、今度は逆向き（スイートが契約より強い）に崩している。
  - 提案: この行を落とすか、`claim.claimToken` を後続の `beginRelease` に実際に渡して**成立する**ことを見る形（＝観測値が本当に取り壊しに使えることの拘束）に置き換える。

## カバレッジ

- 確認: `packages/core/src/domain/identity/ports/identityUniqueDirectory.ts`, `packages/core/src/domain/identity/services/identityPolicy.ts`, `packages/core/src/application/identity/uniqueness.ts`, `packages/core/src/application/identity/identityRemovalRelease.ts`, `packages/core/src/application/identity/linkOAuthIdentity.ts`, `packages/core/src/application/identity/completeOAuthSignIn.ts`, `packages/core/src/adapters/memory/repositories/identityUniqueDirectory.ts`, `packages/core/src/adapters/memory/store.ts`, `packages/core/src/adapters/conformance/identityUniqueDirectory.ts`, `packages/core/src/application/identity/__tests__/removeIdentity.test.ts`, `packages/core/src/application/identity/__tests__/linkOAuthIdentity.test.ts`, `packages/core/src/application/identity/__tests__/completeOAuthSignIn.test.ts`, `packages/core/src/application/identity/__tests__/checkHandleAvailability.test.ts`, `spec/domains/identity.md`, `spec/adr/060-conditional-unique-claim-teardown.md`, `spec/adr/038-provider-account-claim-and-identity-row.md`, `spec/adr/054-provider-account-uniqueness-owner.md`, `spec/adr/index.md`, `spec/inventory/domain.md`, `spec/inventory/adapter.md`, `spec/database/index.md`, `spec/usecases/identity.md`
- スキップ: `spec/inventory/test.md` — TC 台帳の行で、ドメイン契約の主張を持たない（test 観点）
- スキップ: `spec/inventory/usecase.md` — UC 台帳の行で、ドメイン契約の主張を持たない（usecase 観点）
- スキップ: `spec/testcases/identity/removeIdentity.md`, `spec/testcases/identity/linkOAuthIdentity.md`, `spec/testcases/identity/completeOAuthSignIn.md` — テストケース表で、契約の正本ではない（test 観点）
- スキップ: `.thread/21/adr.md`, `.thread/21/plan.md`, `.thread/21/steps.md`, `.thread/21/testing.md`, `.thread/21/review/review-001.md`, `.thread/21/review/review-001-adapter.md`, `.thread/21/review/review-001-domain.md`, `.thread/21/review/review-001-spec.md`, `.thread/21/review/review-001-usecase.md`, `.thread/21/review/triage.md` — 計画・レビュー成果物でレビュー対象コードではない（判定基準として参照はした）

## 確認して問題なしと判断した点

- `beginRelease` の CAS 条件（`active` / 所有者 / トークン）と no-op 集合（行なし・`reserved`・`releasing`・別利用者・トークン不一致）が、JSDoc・`spec/domains/identity.md`・memory 実装・適合スイートの 4 か所で一致している。memory の `beginRelease` は `row.state !== "active"` を先頭に置いたので `releasing` の奪取が消え、ADR-007 の決定どおりになっている
- `resolve` が `resolveClaim` の射影であることが、実装（`activeClaim` を共有）と適合ケース（4 状態すべて）の両方で担保されている
- トークンの 2 性質のうち「claim が生きているあいだ不変」は冪等 `activate` を挟むケースが、「張り直しで必ず変わる」は**同じ `operationId` で**張り直す強い形のケースが拘束している。memory は `reserve` の行書き込み時採番なので `DirectoryRow.claimToken` が非 null で済み、「トークンを持たない `active` 行」が型として表現できない（ADR-002 の意図どおり）
- `IdentityPolicy.findOAuth` は `findPassword` と同じ位置・同じ形の純粋述語で、I/O・時刻・ID 生成に依存しない。`ensureAddable` より前に置く順序は、残骸行を 8 件目にした TC-identity-343 / TC-identity-344 が拘束しており、順序を逆にすると両方が `IdentityLimitExceeded` で落ちる（R1 の指摘は解消済み）
- 治癒分岐に到達できるのは「`resolve` が null ＝ 恒久 claim が無い」かつ「`reserve` が通った」ときだけで、`releasing` 行や生きた `reserved` 行は `reserve` が弾く。別利用者が正当に握っている鍵を治癒で奪う経路は無い
- TC-identity-342 は割り込みを判定 UoW の解決直後に置いているので、観測を判定より後に取る実装では新しい claim を観測して CAS が通り、テストが落ちる（順序制約が実行形で拘束されている）
- コード・コメントに弁明や修正経緯の記述は見当たらない
