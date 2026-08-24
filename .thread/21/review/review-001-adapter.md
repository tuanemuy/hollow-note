# レビュー 001 — Adapter 観点（PR #41 / Issue #21）

## Adapter

### 判定サマリ

急所（適合スイートが契約を本当に拘束しているか）は、目視ではなく **memory 実装への変異注入**で検証した。契約の各条項を壊す 12 通りの変異を入れて適合スイートを走らせた結果は次のとおり。

| 変異（memory `identityUniqueDirectory.ts`） | 検出 | 落ちたケース |
|---|---|---|
| M1 トークン一致条件を落とす | ✅ | `ADP-identity-041: beginRelease quoting a superseded token …` |
| M2 `state !== "active"` を旧ガード `state === "reserved"` に戻す | ✅ | `ADP-identity-041: a releasing row is not taken over …` |
| M3 `claimToken` を `kind+key+operationId` から導く | ✅ | `ADP-identity-042/041: a re-taken claim carries a different token` |
| M4b 冪等 `activate` が行を書き直してトークンを採番し直す | ✅ | `ADP-identity-042: the token stays the same …` |
| M5 所有者一致条件を落とす | ✅ | `ADP-identity-041: beginRelease by a non-owner …` |
| M7 `resolveClaim` が `releasing` 行にも答える | ✅ | 042 / 042+006 / 041+009 の 3 件 |
| M8 `resolveClaim` が `reserved` 行にも答える | ✅ | 006 / 008 / 042 / 042+006 の 4 件 |
| M9 `resolve` が `resolveClaim` の射影でなくなる | ✅ | `ADP-identity-042/006: resolve is a projection …` |
| M10 全 claim のトークンを空文字にする | ✅ | 042+041 / 041 の 2 件 |
| M11 `reserved` 行をトークン無視で再キー付けする | ✅ | `ADP-identity-041: beginRelease leaves a still-reserved row alone` |
| M6 冪等 `reserve` の再実行がトークンを採番し直す | ❌ | （契約上無害 — `reserved` の間トークンは観測不能なので、`activate` 前の変化は誰にも見えない） |
| M12 行なしの鍵に `releasing` の墓標を書く | ❌ | → W-001 |

指摘の急所として挙げられていた点はすべて満たされている。

- **「張り直した claim のトークンは前と異なる」が同一 `operationId` で書かれているか** — 書かれている（`conformance/identityUniqueDirectory.ts:242-258`、`reserveEmail("op-1")` を 2 回）。M3 が実証するとおり、`claimToken = f(kind, key, operationId)` のバックエンドはこのケースで落ちる。Blocker 条件は成立しない。
- **既存 6 ケースの拘束が薄まっていないか** — 薄まっていない。所有者不一致ケース（`:372-384`）には `await observeClaimToken()` で採った**生きているトークン**が渡されており、M5 が単独で検出される（トークン不一致に化けていない）。`reserved` ケース（`:386-404`）は `"no-such-token"` を渡す形になったが、M11（`reserved` 行をトークン無視で再キー付け）を検出し続けるので、このケースが守るべき退行は依然として捕まる。`releasing` ケース（`:302-320`）はむしろ強化されていて、`beginRelease` 前に採った実トークンを引用しても奪えないことを拘束する（M2 検出）。
- **memory 実装が契約を満たしているか** — 満たしている。`reserve` で採番・非 null（型として必須、`DirectoryRow.claimToken: string`）、`activate` は `state === "active"` を `continue` するのでトークン不変、`release` が行ごと消すので同一 operation の再取得でも新トークン、`resolve` は `activeClaim(...)?.userId ?? null` という文字どおりの射影。
- **`nextClaimToken()` の妥当性** — 妥当。`MemoryBackend` に置いたのは正しい（ファクトリはコンテナごとに呼ばれるので、採番器をファクトリ側に置くと同じテーブルに `claim-1` が 2 つ生まれうる）。`idGenerator` を使わない判断も、決定的 ID 列に依存する既存テストを動かさないためで妥当。カウンタは undo ログに載らないが単調増加なので巻き戻しで再利用は起きない。再起動でカウンタが 0 に戻るが、ADR 025 の通り同時に全データが消えるので衝突しない。
- **ドライバ固有エラーの翻訳** — memory にドライバ層は無く、`ConflictError` の投げ方は変更されていない。CAS 不成立は例外ではなく no-op（ADR 060 の決定どおり）で、再配送が隔離までカウントを進めない。
- **セキュリティ** — `expectedUserId` の一致条件は残っている（M5 検出）ので他利用者の claim には触れない。`claimToken` の流通範囲を grep で確認した結果、`ObservedUniqueClaim`（application 内部）とテストにしか現れず、view・エラー・ログ・受領・イベントのいずれにも出ていない。ADR 048 の運用と整合。
- **コメント** — 追加コメントはすべて WHY（同一 operation ID が load-bearing である理由、`reserved` に観測が存在しない理由、採番器の置き場所の理由）で、修正経緯・弁明の類は無い。

`pnpm` 相当の実行確認: `npx vitest run packages/core/src/adapters packages/core/src/application/identity` → 40 files / 578 passed。

### Blockers

なし

### Warnings

- **[W-001]** 「行なしの鍵への `beginRelease` は no-op」が適合スイートで拘束されていない
  - 場所: `packages/core/src/adapters/conformance/identityUniqueDirectory.ts:406-425`
  - 理由: このケースは `beginRelease` → `release("release-1")` → `reserve` の順で書かれているので、`beginRelease` が**行なしの鍵に `releasing` の墓標を書いてしまう**バックエンドでも、直後の `release` がその墓標を消して素通りする。実際に memory 実装へ「行が無ければ `releasing` 行を新規に書く」変異（M12）を入れてもスイートは全緑だった。ポート JSDoc は「An absent row … は no-op」と書いているのでこれは契約の未拘束条項であり（ADR 026 決定 2 が求める「契約の実行形」から漏れている）、`beginRelease` と `release` のあいだで配送が落ちた場合には**存在しない鍵が恒久的に予約不能になる**という実害の形も持つ（`reserve` は `releasing` 行を奪えない）。同じ穴は `reserved` ケースには無い（M11 が検出される）ので、この 1 ケース固有の弱さ。
  - 提案: `beginRelease` と `release` のあいだに 1 行足して、墓標が書かれていないことを直接観測する。例えば `await beginRelease("release-1", "no-such-token", userId(1), "absent@example.com");` の直後に `expect(await backend.identityUniqueDirectory.resolve("email", "absent@example.com")).toBeNull();` ではなく（墓標は `resolve` に見えない）、**別利用者がその鍵をこの時点で `reserve` できる**ことを主張する形にする（`await reserveEmail("op-1", userId(2), "absent@example.com")` を `release` の前に移す）。これで M12 が検出されるようになる。

- **[W-002]** `claimToken` が素の `string` なので、ポート JSDoc の「無条件の取り壊しを型として表現できない」という主張が型としては成り立っていない
  - 場所: `packages/core/src/domain/identity/ports/identityUniqueDirectory.ts:20-23`, `:100-102`
  - 理由: JSDoc は「`expectedClaimToken` is mandatory so that an unconditional teardown cannot be expressed at all — the caller must have observed the claim through `resolveClaim` first」と書いているが、`string` である以上 `expectedClaimToken: "whatever"` はコンパイルを通る（適合スイート自身が 2 か所でそう書いている）。実行時には no-op に落ちるので安全側ではあるが、CLAUDE.md「不正な状態を実行時チェックの前に型で表現不能にする」と ADR 060 の「必須にするのは、無条件の取り壊しを型として表現できなくするため」が、素の `string` では半分しか達成されていない。`observeActiveUniqueKey` を経ずに `beginRelease` を呼ぶ新しい呼び出し元が入っても型は止めない。
  - 提案: 2 案のいずれか。(a) `ClaimToken` を公称型（brand）にして `resolveClaim` の返り値だけが生成源になるようにする — 適合スイートの偽トークンは 1 箇所のテスト専用コンストラクタで作る。(b) 型を変えないなら、JSDoc の「cannot be expressed at all」を「観測なしに成功させることはできない」に弱める。今の文面は契約書として過剰な約束になっている。

- **[W-003]** 「不透明」が「推測不能」と読まれうるが、契約はそれを要求していない（memory の `claim-N` は列挙可能）
  - 場所: `packages/core/src/adapters/memory/store.ts:470-481`, `packages/core/src/domain/identity/ports/identityUniqueDirectory.ts:17`
  - 理由: memory の採番は `claim-1`, `claim-2`, … でプロセス内単調増加、完全に予測可能。今日は実害が無い（grep で確認したとおり値は application 層の外へ出ない）が、memory は「fake ではなく第一級のバックエンド」であり（ADR 024）他バックエンドが同じスイートで拘束される（ADR 026）以上、ポート JSDoc の "Opaque to callers" だけを読んだ実装者が「秘密値でなければならない」と読む／逆に「秘密値だから漏らしても照合されない」と読むどちらの誤読も起こりうる。行バージョンや ETag をそのまま使う実装が適合かどうかが契約から読み取れない。
  - 提案: `ActiveUniqueClaim` の JSDoc に一文足して、不透明性は**呼び出し側の使い方の制約**であって値の推測困難性は契約に含まれない（＝行バージョン / ETag / 単調カウンタは適合）と明示する。`spec/inventory/adapter.md` の ADP-identity-042 行の「不透明な `claimToken`」も同じ含意で読める文にそろえる。

- **[W-004]** `expect(claim?.claimToken).toEqual(expect.any(String))` は形骸化したアサーション
  - 場所: `packages/core/src/adapters/conformance/identityUniqueDirectory.ts:218`
  - 理由: `ActiveUniqueClaim.claimToken` は型として `string` なので、この主張は型検査が既に保証している内容を実行時に繰り返しているだけで、追加の拘束を持たない（空文字を返すバックエンドも通る）。空文字の実害は別ケース（M10 は 042+041 と 041 で検出される）が拾っているので穴ではないが、ケースの読み手に「トークンの中身も拘束している」と誤読させる。
  - 提案: 落とすか、`expect(claim?.claimToken).not.toBe("")` のように実際に拘束のある主張に置き換える。

### カバレッジ

- 確認: `packages/core/src/adapters/conformance/identityUniqueDirectory.ts`, `packages/core/src/adapters/memory/repositories/identityUniqueDirectory.ts`, `packages/core/src/adapters/memory/store.ts`, `packages/core/src/domain/identity/ports/identityUniqueDirectory.ts`, `packages/core/src/application/identity/uniqueness.ts`, `packages/core/src/application/identity/identityRemovalRelease.ts`, `packages/core/src/application/identity/__tests__/checkHandleAvailability.test.ts`, `spec/inventory/adapter.md`, `spec/inventory/domain.md`, `spec/adr/060-conditional-unique-claim-teardown.md`, `spec/adr/index.md`
- スキップ: `.thread/21/adr.md`, `.thread/21/plan.md`, `.thread/21/steps.md`, `.thread/21/testing.md` — 計画の成果物でレビュー対象コードではない
- スキップ: `packages/core/src/application/identity/completeOAuthSignIn.ts`, `packages/core/src/application/identity/linkOAuthIdentity.ts`, `packages/core/src/domain/identity/services/identityPolicy.ts` — 経路 2 の治癒ロジックで、ポート契約に触れないため usecase / domain 観点
- スキップ: `packages/core/src/application/identity/__tests__/completeOAuthSignIn.test.ts`, `packages/core/src/application/identity/__tests__/linkOAuthIdentity.test.ts`, `packages/core/src/application/identity/__tests__/removeIdentity.test.ts` — ユースケースレベルの注入テストで、ポート適合の拘束ではないため test 観点
- スキップ: `spec/adr/038-provider-account-claim-and-identity-row.md`, `spec/adr/054-provider-account-uniqueness-owner.md`, `spec/domains/identity.md`, `spec/inventory/test.md`, `spec/inventory/usecase.md`, `spec/testcases/identity/completeOAuthSignIn.md`, `spec/testcases/identity/linkOAuthIdentity.md`, `spec/testcases/identity/removeIdentity.md`, `spec/usecases/identity.md` — spec / ADR の整合は spec 観点（ただし ADP 台帳との対応は上で確認済み）
