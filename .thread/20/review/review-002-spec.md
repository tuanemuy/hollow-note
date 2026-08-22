# レビュー 002 — Spec 観点（Issue #20 / PR #34）

## Spec

### Blockers

- **[B-001]** `progress.md` が「残存課題」として挙げている 1 件は、既に解消されている
  - 場所: `.thread/20/progress.md:3-8`
  - 理由: 「UC-identity-006 / UC-identity-007 / UC-integration-001 / UC-integration-002 の説明文が『OAuth state を単回消費し』等のまま」と書かれているが、`spec/inventory/usecase.md:18-19,38-39` の 4 行はいずれも本 PR で「OAuth state を**束縛が一致したときだけ**単回消費し（不一致・不在では消費しない）」／「束縛が一致したときだけ単回消費する link intent の OAuth state」／「束縛の秘密の digest を 10 分保存して…束縛の秘密（`stateBinding`）を返す」へ書き換え済み。残存課題ファイルが未解決と主張している唯一の spec 課題が、実際には差分に含まれている。理由欄の「steps.md のステップ11 が名指ししたのは UC-identity-005 / UC-identity-024 と新規 UC-identity-025 のみで、実装側が勝手にスコープを広げなかった」という説明も、成果物と食い違う
  - 提案: 項目 1 を削除する（項目 2 だけを残す）。`spec/inventory/usecase.md` の 4 行が更新済みであることを前提に、残る課題が本当に 1 件（配線テストの assertion 方法）だけであることを確認する

### Warnings

- **[W-001]** ADR 034 が自分の決定を自分の「前提」に書いている（前提依存マップにも同じ循環が入った）
  - 場所: `spec/adr/034-oauth-callback-browser-binding.md:17` / `spec/adr/index.md:98`
  - 理由: 前提に足された「束縛の照合が `state` の消費と同一の原子操作であること」は、同じファイルの決定 2「消費は『束縛が一致したときだけ `state` を削除して返す』条件付きの原子操作で行う」そのもの。前提は「この ADR が寄りかかっている、他所で成立している事実」を書く欄で、他の行（029 の `SameSite=Lax`、035 の単回消費、033 の 017 依存）はすべてその形になっている。`spec/adr/index.md:98` に至っては、同じ 1 行の「依存している前提」列と「設計上の境界」列に同じ命題（照合と消費が同一の原子操作）が並んでおり、前提依存マップとしては自己参照になる
  - 提案: 前提には**外側の事実**だけを残す — 「ポートの契約として振る舞いを規定し全バックエンドへ強制できること（[ADR 026](./026-port-contract-and-conformance.md)）」「フロー状態の取り出しが原子的であること」。「照合が消費と同一の原子操作であること」は決定 2 に任せ、前提と `index.md:98` の前提列から落とす

- **[W-002]** D1 実装ノートの `DELETE … RETURNING *` 1 文では、契約の「一致すれば期限切れでも `null` を返す」を満たせない
  - 場所: `spec/database/index.md:608` / `spec/domains/index.md:241` / `packages/core/src/application/ports/oauthStateStore.ts:44-47`
  - 理由: 契約は「削除するのは束縛が一致したときだけ。**一致すれば期限切れでも削除して `null` を返す**」。`DELETE … WHERE state = ? AND state_binding_hash = ? RETURNING *`（`WHERE` に期限を混ぜない）は、期限切れ行を削除して**その行を返す**だけなので、返り値を `null` に落とす期限判定が別途要る。`spec/database/index.md:608` はその 1 文だけを書いて「になる」と言い切り、`spec/domains/index.md:241` は「その 1 文で満たす」と書き、ポート JSDoc は「`DELETE … RETURNING *` **または** read → compare → delete → expiry check」と 2 案を対等に並べている（後者だけが expiry check を明示している）。この記述どおりに D1 アダプターを書くと期限切れの flow がそのまま `completeOAuthCallback` へ渡り、`state` の 10 分期限が実質的に消える。memory 実装（`adapters/memory/repositories/oauthStateStore.ts:41-46`）は削除の**後**に期限判定を置いており、正典の方だけがこの一手を書き落としている
  - 提案: 3 か所とも「`DELETE … WHERE state = ? AND state_binding_hash = ? RETURNING *` で削除し、**返った行の `expires_at` を見て期限切れなら `null` を返す**」と 2 段で書く。適合スイートの `ADP-common-037/038: an expired take with the matching binding returns null and removes the row` が守っている性質そのものなので、正典側の言葉もそれに合わせる

- **[W-003]** 消費系ユースケースの「エラーケース」表が、新しい失敗条件（束縛の不一致）を書いていない — UC 台帳の説明文が生成元より進んでいる
  - 場所: `spec/usecases/identity.md:277`（`completeOAuthSignIn`）/ `spec/usecases/identity.md:322`（`completeOAuthCallback`）/ `spec/usecases/identity.md:350`（`linkOAuthIdentity` は前者を継承）
  - 理由: 処理フローは「束縛が一致したときだけ取り出して削除する。不一致・不在では行を消費しない」に追随したが、エラーケース表の条件は `state` の不一致・期限切れ・`:provider` 不一致のままで、束縛の不一致が現れない。一方 `spec/inventory/usecase.md:36` は UC-identity-024 の説明文に「**束縛の不一致**・期限切れ・経路の `:provider` 不一致・…はすべて `OAUTH_STATE_INVALID` に畳む」と書いており、台帳の主張が生成元の表に無い。束縛の不一致は「同じ `OAUTH_STATE_INVALID` だが行を消費しない」という他と挙動の違う条件で、TC-identity-337 として独立した TC まで起こしている以上、エラーケース表の軸（条件 × 種類）でも独立した行に値する。ADR 057 が「行の同一性は『ユースケース × 条件』で決まる」と定めている以上、ここが抜けると下流（W-004）まで抜ける
  - 提案: `completeOAuthSignIn` / `completeOAuthCallback` のエラーケース表に「束縛（`stateBinding`）の不一致・不在」の行を足す（種類は `ValidationError("OAUTH_STATE_INVALID")`、備考として「行は消費しない」）。既存行は `state` の不一致・期限切れのままにして、条件を混ぜない

- **[W-004]** `spec/manual-tests/` が ADR 057 の追随対象なのに触られていない（plan.md の AC-6 にも入っていない）
  - 場所: `spec/manual-tests/account.md:535`（ユースケースエラーケース対応表）/ `.thread/20/plan.md:23`（AC-6 の列挙）
  - 理由: ADR 057 の決定は「`spec/manual-tests/` は `spec/inventory/` と同じく本文の下流成果物として追随させる」「usecase のエラーケースが増えた → ユースケースエラーケース対応表に行を足す。手作業で再現できないものは `対象外` と理由を 1 行残す」。本 PR は新規ユースケース `abandonOAuthFlow` を足し、その節に「ストアの読み書きの失敗 → `SystemError(DatabaseError)`」というエラーケース表を持たせた（`spec/usecases/identity.md:378-385`）。同表には既に `signUpWithPassword | メール送信の失敗 | 対象外`、`verifyEmail | 一時障害（再試行導線） | 対象外` という先例があり、基盤障害は `対象外` として載せる様式が確立している。にもかかわらず `abandonOAuthFlow` の行が無く、AC-6 の spec 追随リストにも `spec/manual-tests/` が現れない（＝計画の時点で漏れている）。なお TC-40 の手順そのものは利用者から見える振る舞いが変わらないため改訂不要で、TC 件数も動かないので `spec/manual-tests/index.md` の集計表は据え置きでよい
  - 提案: `spec/manual-tests/account.md` の対応表に `abandonOAuthFlow | ストアの読み書きの失敗 | 対象外 | ストアの障害は UI から再現できない。転送境界が best-effort に畳む` を足す。W-003 を直す場合は `completeOAuthSignIn` / `completeOAuthCallback` の「束縛の不一致」行も同じく `対象外`（Cookie の直接改ざんが必要）として足す

- **[W-005]** `startOAuthFlow` の TC が「前提条件 × 操作」で区別できず、台帳に同名の行が 2 本並んだ
  - 場所: `spec/testcases/identity/startOAuthFlow.md:5-6` / `spec/inventory/test.md:405,477`
  - 理由: 追加した行の前提条件（`—`）と操作（``provider: "google"``, ``intent: "signIn"`` で開始する）が 1 行目とまったく同じため、`spec/inventory/test.md` の TC-identity-264 と TC-identity-336 の「テストケース」列がバイト単位で一致している。`spec/testcases/*/*.md` には TC ID が書かれず ID は台帳の行が持つ（`spec/inventory/test.md` 冒頭）という設計なので、表の行から台帳の行へ戻る手掛かりが期待結果しか無くなる。実装側は `it` 名に TC ID を持っているので実害は今のところ無いが（ADR 058 はそれを要求はしていない）、台帳と表の対応付けはこの 2 列に依存している
  - 提案: 新しい行の操作を区別できる書き方にする（例: 「``provider: "google"``, ``intent: "signIn"`` で開始し、保存された行と応答を突き合わせる」）。`spec/inventory/test.md:477` の「テストケース」列も同じ文言へ合わせる

- **[W-006]** `steps.md` が「適合スイートに象限ごとのケースは要らない」と書いたままで、実装（と adr.md の訂正）と食い違う
  - 場所: `.thread/20/steps.md:40`、`.thread/20/steps.md:57,81,82`
  - 理由: 40 行目は「観測差が出ないので適合スイートに象限ごとのケースは要らない」と断言し、ステップ 4（`steps.md` の変更内容）も追加ケースを「束縛が一致しない `take`」1 本しか挙げていない。しかし `adr.md:223`（ADR-009）は「訂正（レビュー 001 B-001 / W-001）: この『観測差が出ない』という前提は誤りだった…適合スイートに期限切れ側の 2 象限を足し、4 象限とケースを 1 対 1 に対応させる」と自ら取り消しており、実装も `ADP-common-037/038` の期限切れ 2 ケースを追加済み。adr.md 側にだけ訂正があり steps.md は旧主張のまま残っているので、2 つの計画ファイルが互いに矛盾している。あわせて `steps.md:40,57,81,82` は列名を `binding_hash` と書いているが、確定した正典（`spec/database/index.md:601`、`spec/domains/index.md:241`）は `state_binding_hash`
  - 提案: `steps.md:40` の最後の一文を落とす（または adr.md ADR-009 と同じ訂正を入れる）、ステップ 4 の追加ケースに期限切れ 2 象限を書き足す、`binding_hash` を `state_binding_hash` に統一する

### 補足（指摘ではない）

改訂後の ADR 034 は、前提の循環（W-001）を除いて通しで整合していることを確認した。決定 3 の「束縛が一致して行を取り出せたときだけ捨てる」は `abandonOAuthFlowFn`（`view.abandoned` のときだけ `clearOAuthStateCookie()`）と一致し、`abandoned` が `take` の非 `null`＝「一致かつ期限内」であることとも矛盾しない。決定 4 と「影響」の「消費済みでも Cookie が残ることがある」は、`completeOAuthCallbackFn` の `serializeError` による `OAUTH_STATE_INVALID` 判定（provider 不一致・`integration` intent では行が消えたまま Cookie を残す）を正しく説明している。検討した代替案の書き換え（`state` の鍵付き MAC / `state = sha256(nonce)` / 消費後照合の限定）も、決定 1・2 と理由段落に対応が取れている。台帳の採番も確認した — TC-identity は 001..340 に欠番も重複も無く、新規 5 件は identity 群の末尾（336..340）、UC-identity は 25 行で `spec/domains/identity.md:598` の列挙 25 件と一致する。

## カバレッジ

- 確認: `spec/adr/034-oauth-callback-browser-binding.md`, `spec/adr/index.md`, `spec/database/index.md`, `spec/domains/index.md`, `spec/domains/identity.md`, `spec/usecases/identity.md`, `spec/usecases/integration.md`, `spec/testcases/identity/abandonOAuthFlow.md`, `spec/testcases/identity/completeOAuthCallback.md`, `spec/testcases/identity/completeOAuthSignIn.md`, `spec/testcases/identity/startOAuthFlow.md`, `spec/inventory/adapter.md`, `spec/inventory/domain.md`, `spec/inventory/test.md`, `spec/inventory/usecase.md`, `.thread/20/plan.md`, `.thread/20/steps.md`, `.thread/20/adr.md`, `.thread/20/progress.md`, `.thread/20/testing.md`, `packages/core/src/application/ports/oauthStateStore.ts`, `packages/core/src/adapters/memory/repositories/oauthStateStore.ts`, `packages/core/src/adapters/conformance/oauthStateStore.ts`, `packages/core/src/application/identity/abandonOAuthFlow.ts`, `packages/core/src/application/identity/startOAuthFlow.ts`, `packages/core/src/application/identity/completeOAuthCallback.ts`, `packages/core/src/application/identity/completeOAuthSignIn.ts`, `packages/core/src/application/identity/linkOAuthIdentity.ts`, `packages/core/src/application/identity/view.ts`, `apps/web/app/presentation/oauthStateCookie.ts`, `apps/web/app/routes/auth/-action.tsx`, `apps/web/app/routes/settings/-action.tsx`, `packages/core/src/application/identity/__tests__/abandonOAuthFlow.test.ts`, `packages/core/src/application/identity/__tests__/startOAuthFlow.test.ts`, `packages/core/src/application/identity/__tests__/completeOAuthCallback.test.ts`, `packages/core/src/application/identity/__tests__/completeOAuthSignIn.test.ts`, `packages/core/src/application/identity/__tests__/linkOAuthIdentity.test.ts`（後半 5 件は TC 行との対応確認のため）
  - 差分外で突き合わせた正典: `spec/manual-tests/account.md`, `spec/adr/057-manual-test-followthrough.md`, `spec/presentation/index.md`, `spec/testcases/identity/linkOAuthIdentity.md`, `spec/inventory/frontend.md`, `spec/platform/index.md`, `spec/pages/index.md`
- スキップ: `.thread/20/review/*`（review-001-*.md / review-001.md / triage.md / triage-keys.md）— レビュー作業の記録そのもの（指示によりカバレッジ対象外。triage-keys.md は既決判定の確認にのみ使用）
- スキップ: `apps/web/app/presentation/oauthStateBinding.ts`（削除）, `apps/web/app/presentation/__tests__/oauthStateBinding.test.ts`（削除）, `apps/web/app/presentation/__tests__/oauthStateBindingWiring.test.ts` — 転送境界の配線テスト・純関数で、`spec/testcases/` にも `spec/inventory/` にも行を持たない層（ADR 034「影響」が回帰検知の場として名指しするだけ）。削除物への参照が spec / コードに残っていないことだけ全文検索で確認した
- スキップ: `packages/core/src/application/identity/__tests__/{authFlowHelpers.ts,addPasswordIdentity.test.ts,pruneExpiredAuthState.test.ts,removeIdentity.test.ts,requestPasswordReset.test.ts,resetPassword.test.ts}` — `take` の署名変更と `stateBindingHash` 必須化への機械的追随のみで、`it` の追加・削除が無く TC 行との対応が変わらない（差分全体で追加された `it` 16 件がいずれもこれらのファイル外であることを確認済み）
