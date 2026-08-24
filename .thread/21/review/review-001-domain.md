# Domain

## Blockers

なし

契約・実装・テストを一通り追ったが、Issue #21 の 2 経路（判定と `beginRelease` のあいだの TOCTOU / activate 喪失後の identity 行二重生成）はどちらも閉じている。以下は確認した要点。

- `beginRelease` の CAS 条件（`active` かつ所有者一致かつトークン一致）は memory 実装（`packages/core/src/adapters/memory/repositories/identityUniqueDirectory.ts:143-150`）と JSDoc（`packages/core/src/domain/identity/ports/identityUniqueDirectory.ts:88-109`）と `spec/domains/identity.md` の 3 か所で一致している。`releasing` を no-op 側に落とした ADR-007 の判断も 3 か所に揃っている。
- `claimToken` の採番位置を `reserve`（行の生成時）にしたことで `DirectoryRow.claimToken: string` が非 null で済み、「トークンを持たない `active` 行」が型として表現できない。契約が要求する 2 性質（生存中不変 / 張り直しで必ず変化）は memory 実装が構造的に満たす（`release` が行を削除し、次の `reserve` が新規採番の枝を通る）。
- 適合ケース `ADP-identity-042/ADP-identity-041: a re-taken claim carries a different token` は**同じ `operationId`・同じ `userId`・同じ鍵・同じ `userVersion`** で張り直して不一致を要求している。この 1 ケースだけで `claimToken = f(kind, key, userId, operationId, userVersion)` 型の導出はすべて落ちる。レビュー観点の「`operationId` から導けてしまう抜け道」は契約にも実行形にも残っていない。
- `resolve` が `resolveClaim` の射影であることは、4 状態（行なし / `reserved` / `active` / `releasing`）を渡り歩く適合ケースで実行形になっている。散文だけの契約になっていない。
- 順序制約（観測は判定 UoW より**前**）は TC-identity-342 が `globalUnitOfWorkProvider.run` の解決直後に割り込む形で拘束している。観測を判定より後に取る実装では割り込み後の新 claim を観測して CAS が通り、`directoryRow(...)` の `state: "active"` 主張が落ちる。`expect(interfered).toBe(true)` で割り込みの空振りも塞いである。実効的。
- AC-8（孤児 `releasing` 行の回収）は TC-identity-345 が `release` を 1 回だけ落とすラッパーで作った `releasing` 行を再配送で回収させ、さらに別利用者が `reserve` できるところまで見ている。`releaseObservedUniqueKey` に `if (observed === null) return;` を書いた実装は確実に落ちる。
- `IdentityPolicy.findOAuth` は純粋・I/O なし・時刻/ID 生成なしで、`findPassword` と同じ粒度。ドメインに置くのは妥当。ユースケース側に残っていた `existingLinkId` の手書き述語も寄せられている。
- 既存テストの形骸化は見当たらない。`deleteAccount.globalCleanup.test.ts:167` の `beginRelease: () => Promise.reject(...)` は、当該時点で email / handle の claim が `active` なので観測が非 null になり `beginRelease` に到達する。`.rejects.toThrow()` は今も意味を持つ。
- コード・コメントに弁明や修正経緯の記述はない。追加されたコメントはいずれも WHY（採番位置の理由、`release` を常に呼ぶ理由、`findOAuth` を `ensureAddable` より前に置く理由、適合ケースで同一 `operationId` を使う理由）に限られている。
- `pnpm typecheck` / `pnpm test`（968 passed）を実行して通ることを確認した。

## Warnings

- **[W-001]** `claimToken` が素の `string` なので、「観測していないトークンを引用する」不正状態が型として表現できたままになっている
  - 場所: `packages/core/src/domain/identity/ports/identityUniqueDirectory.ts:20-23` / 同 `:110-118`
  - 理由: AC-1 は「無条件の取り壊しを型として表現できなくする」ことを目標に掲げ、`expectedClaimToken` の必須化でそこまでは達成している。しかし残っているのはもう一段の不正状態で、`beginRelease` の入力は `normalizedKey: string` / `expectedClaimToken: string` / `operationId: string` という**同型の string が 3 本並ぶ**形をしている。取り違えても引数の入れ替えでもコンパイルは通り、失敗は例外ではなく**沈黙の no-op**として現れる。plan.md 自身がこの危険を認識していて（`checkHandleAvailability.test.ts` に「ダミー文字列を渡すと `beginRelease` が no-op になり `available: true` の主張が黙って落ちる」と書いている）、適合スイートは実際に `"no-such-token"` というリテラルを 2 か所で渡せている。このリポジトリは `UserId = string & { readonly [userIdBrand]: true }`（`domain/identity/valueObject.ts:27`）という公称型の定石を持っており、不透明な比較専用値はまさにその適用先である。CLAUDE.md の「不正な状態は実行時チェックより先に型で表現できなくする」に照らして、ここだけ素の `string` なのは一貫していない。
  - 提案: `ClaimToken` を公称型にする（アダプターが `ClaimToken.create` で名乗る）。あわせて、application 層に既にある `ObservedUniqueClaim`（`kind` / `normalizedKey` / `userId` / `claimToken` を 1 つの値に束ねたもの）と同じ形をポート側にも上げ、`beginRelease(input: { claim: ActiveUniqueClaim & UniqueKey; operationId: string })` のように**観測値そのものを 1 引数で受ける**と、「観測していない条件で取り壊す」も「引数を取り違える」も型で塞げる。契約の意図（`resolveClaim` を経ずに `beginRelease` に到達できない）が構造で表現できるので、JSDoc の「the caller must have observed the claim through `resolveClaim` first」を散文に頼らずに済む。

- **[W-002]** トークンの一意性が「同じ鍵に対して」しか契約されておらず、鍵をまたいだ衝突を許す契約になっている
  - 場所: `packages/core/src/domain/identity/ports/identityUniqueDirectory.ts:5-23`
  - 理由: `ActiveUniqueClaim` の JSDoc が要求しているのは (1) claim の生存中は不変、(2) **同じ正規化鍵**に後から張られた claim とは不一致、の 2 点だけである。この契約は「行ごとの版番号」を返すバックエンドを許す — D1 の `rowversion` 相当や DO ストレージの版番号を素直に使うと、鍵 A の claim と鍵 B の claim が両方 `"1"` になる。`beginRelease` は `kind` / `normalizedKey` も条件に取るので、正しい呼び出し側なら問題は起きない。ただし「トークンは**その 1 つの claim** を同定する」という JSDoc 冒頭の宣言（`identifies that one claim, not the key`）と、実際に契約が要求している弱い性質のあいだにズレがあり、`beginRelease` が観測時の鍵とは無関係にトークンを受け取れる（W-001 参照）ことと組み合わさると、将来のバックエンド＋将来の呼び出し側で沈黙して CAS が通る余地が残る。本 Issue は「複数ワーカー / リモート DB 配備の前に契約を決め切る」ことを目的に掲げているので、この差は埋めておく価値がある。適合スイートも鍵 1 本（`a@example.com`）しか使っておらず、鍵をまたぐ性質は実行形になっていない。
  - 提案: 契約文を「トークンは観測した `(kind, normalizedKey)` の文脈でのみ意味を持ち、他の鍵の claim のトークンと一致してはならない」のどちらかに倒して明文化する。前者に倒すなら W-001 の「観測値を 1 引数で渡す」形と組み合わせて構造で担保でき、追加の適合ケースは要らない。後者に倒すなら、2 つの鍵に同時に `active` な claim を張ってトークンの不一致を見る適合ケースを 1 本足す。

- **[W-003]** 「取り壊す鍵は event payload、判定は receipt」という新しい依存関係がコード側に記録されていない
  - 場所: `packages/core/src/application/identity/identityRemovalRelease.ts:48-52`（対比: 変更前は `decision.normalizedKey` / `decision.userId`＝receipt 由来だった）
  - 理由: 変更前は解放する鍵と利用者が `receipt.providerAccountKey` / `receipt.userId` から来ていて、判定と解放が同じ正本を見ていた。変更後は観測（＝取り壊す対象の確定）が `event.payload.providerAccountKey` / `event.payload.userId` から来る一方、判定は receipt を正本にしている。両者が一致することは `removeIdentity` が行削除・receipt・event を**同一トランザクションで同じローカル変数から**書いている（`application/identity/removeIdentity.ts:98-109`）ことにのみ依存していて、`identityRemovalRelease` 側からは見えない。adr.md ADR-008 の Consequences 自身が「この前提に依存していることを `identityRemovalRelease` 側のコメントに 1 行残す」と書いているが、その 1 行が入っていない。現行 JSDoc は receipt が橋渡しになることは説明しているものの、**観測が event payload から取られている**ことには触れていないので、将来 receipt と event が別トランザクションに分かれたときに壊れる箇所が読み取れない。
  - 提案: 観測の直上に 1 行、「鍵と利用者は event payload から取る。receipt と同一トランザクション・同一ローカル変数から書かれるので両者は一致する（`removeIdentity`）」の趣旨を残す。

- **[W-004]** `findOAuth` を `ensureAddable` より前に置く順序が load-bearing だと 3 か所の散文に書かれているのに、それを落とすテストがない
  - 場所: `packages/core/src/application/identity/linkOAuthIdentity.ts:148-165`、`packages/core/src/application/identity/completeOAuthSignIn.ts:362-383`、`packages/core/src/domain/identity/services/identityPolicy.ts:67`
  - 理由: plan.md のリスク欄・ADR 060 の決定・`spec/domains/identity.md#ドメインサービス` のいずれもが「順序を逆にすると 8 件を持つ利用者が自分の既存 identity を治癒できなくなる」と明記していて、これは本 Issue が新設した振る舞いの一部である。ところが TC-identity-343 / 344 はどちらも identity 1〜2 件の利用者で走っており、順序を入れ替えて `ensureAddable` を先に呼ぶ実装にしても全 green のまま通る。既存の上限テスト（`linkOAuthIdentity.test.ts` の `toHaveLength(8)` 系）は残骸の治癒を絡めていないので、こちらも落ちない。本 PR は「順序が正しさの本体になる制約は目視レビューに委ねずテストで拘束する」（ADR-006）という方針を経路 1 では貫いているので、同じ基準を経路 2 のこの順序にも当ててよい。
  - 提案: TC-identity-343 の変種を 1 本足す — 8 件の identity を持つ利用者の 1 件を「commit 済み・`activate` 喪失」の残骸にし、TTL 失効後の再連携が `IdentityLimitExceeded` にならず既存行の ID を返すことを見る。`identityPolicy` 側の粒度は変えず、ユースケーステスト 1 本で順序を拘束できる。

## 補足（指摘ではない）

- 初回に `pnpm` 経由でない `npx vitest run` を実行した際、`ADP-identity-042: the token stays the same for as long as the claim lives` が 1 度だけ `expected 'claim-3' to be 'claim-2'` で落ちた。同じコマンドを 21 回（適合スイート単独 12 回、識別子テストとの併走 6 回、`pnpm test` 全体 3 回）繰り返しても再現せず、現行コードでは `activate` がトークンを採番しない（`reserve` だけが `nextClaimToken()` を呼ぶ）ため、観測された値の並びは「`activate` で採番していた版」の挙動と一致する。vite の変換キャッシュが旧版を返した結果と考えるのが自然で、コード側の欠陥とは判断しなかった。念のため記録しておく。

## カバレッジ

- 確認: `packages/core/src/adapters/conformance/identityUniqueDirectory.ts`, `packages/core/src/adapters/memory/repositories/identityUniqueDirectory.ts`, `packages/core/src/adapters/memory/store.ts`, `packages/core/src/application/identity/__tests__/checkHandleAvailability.test.ts`, `packages/core/src/application/identity/__tests__/completeOAuthSignIn.test.ts`, `packages/core/src/application/identity/__tests__/linkOAuthIdentity.test.ts`, `packages/core/src/application/identity/__tests__/removeIdentity.test.ts`, `packages/core/src/application/identity/completeOAuthSignIn.ts`, `packages/core/src/application/identity/identityRemovalRelease.ts`, `packages/core/src/application/identity/linkOAuthIdentity.ts`, `packages/core/src/application/identity/uniqueness.ts`, `packages/core/src/domain/identity/ports/identityUniqueDirectory.ts`, `packages/core/src/domain/identity/services/identityPolicy.ts`, `spec/adr/038-provider-account-claim-and-identity-row.md`, `spec/adr/054-provider-account-uniqueness-owner.md`, `spec/adr/060-conditional-unique-claim-teardown.md`, `spec/adr/index.md`, `spec/domains/identity.md`, `spec/inventory/adapter.md`, `spec/inventory/domain.md`, `spec/inventory/test.md`, `spec/inventory/usecase.md`, `spec/testcases/identity/completeOAuthSignIn.md`, `spec/testcases/identity/linkOAuthIdentity.md`, `spec/testcases/identity/removeIdentity.md`, `spec/usecases/identity.md`
- スキップ: `.thread/21/adr.md` — 計画の成果物であってレビュー対象コードではない（判断の根拠としては通読した）
- スキップ: `.thread/21/plan.md` — 契約として読む側の文書で、レビュー対象コードではない
- スキップ: `.thread/21/steps.md` — 計画の成果物であってレビュー対象コードではない
- スキップ: `.thread/21/testing.md` — 計画の成果物であってレビュー対象コードではない
