# レビュー 002 — General

## General

### Blockers

なし

### Warnings

- **[W-001]** AC-8 の担保元テストが、実際に固定している性質より強いことを名前とコメントで宣言している（「偽の安心」）
  - 場所: `packages/core/src/application/identity/__tests__/startOAuthFlow.test.ts:48`（表題）、`:58-66`（3 本のアサーション）
  - 理由: 表題は "the binding secret is stored as its digest and **cannot be derived from the state**"、コメントは「`state` を見た者が束縛を再現できない」と書いているが、実際に固定しているのは「束縛が `state` そのものではない」「保存 digest が `hashOf(state)` ではない」という**2 つの特定値の否定**だけ。`state` から導出する実装でも、1 段余分に噛ませれば 3 本とも通る — 例: `binding.token = hashOf(state.token)` / `stateBindingHash = hashOf(binding.token)` とすると、(1) `saved.stateBindingHash === hashOf(view.stateBinding)` は成立、(2) `view.stateBinding !== state` も成立（`sha256` hex なので）、(3) `saved.stateBindingHash (= sha256(sha256(state))) !== hashOf(state)` も成立し、**「`state` から導出された束縛」がこのテストを緑のまま通過する**。加えて表題前半の「digest として保存される」も自己参照的で、実装が使うのと同じ `secureTokenGenerator.hashOf` で期待値を作っているため、`hashOf` が退化した場合（平文がそのまま保存される場合）を独立には捕まえない（`TokenHash.create` は非空検査のみ、`cryptoAdapters.test.ts` の `[A-Za-z0-9_-]{43,}` は 64 桁 hex にもマッチするので、そちらにも受け皿がない）。実害という意味では、1 段派生（Cookie 値が `sha256(state)`）という現実的な退行は配線テストの `not.toContain(sha256(STATE))` が捕まえるので致命ではない。ただし plan.md が AC-8 の担保元と名指ししているのはこの単体テストであり、名前が約束する範囲と検証範囲の差はここで閉じておきたい。なお spec 側（`spec/testcases/identity/startOAuthFlow.md` / `spec/inventory/test.md` の TC-identity-336）の文言もテストと一致しているので、テストの追随そのものは正しい。
  - 提案: 次のいずれか（(c) は単独でも 1 行で入る）。
    (a) 表題を実際に固定した性質へ寄せる（例: "the binding secret is stored as its digest and is neither the state nor its digest"）。spec 行の表現は現状の 2 本の不等式を書き下しているので、そちらは変えずに済む。
    (b) 「導けない」を本当に固定するなら、`createTestHarness({ requestOverrides: { secureTokenGenerator: recording } })` で `issue()` の払い出しを記録するラッパーを差し、`view.stateBinding` が `state` とは**別の独立な引き**であること（払い出し 3 回・すべて相異・`stateBinding` がそのうちの 1 本）を固定する。これが黒箱で書ける唯一の「独立性」の形。
    (c) 表題前半に対しては `expect(saved?.stateBindingHash).not.toBe(view.stateBinding)`（平文を保存していない）を 1 行足す。

### カバレッジ

- 確認: `packages/core/src/application/identity/__tests__/removeIdentity.test.ts`, `packages/core/src/application/identity/__tests__/requestPasswordReset.test.ts`, `packages/core/src/application/identity/__tests__/resetPassword.test.ts`, `packages/core/src/application/identity/__tests__/startOAuthFlow.test.ts`
- スキップ: なし

補足（指摘ではない、確認事項の記録）:

- `removeIdentity.test.ts` の 6 箇所、`requestPasswordReset.test.ts` / `resetPassword.test.ts` の各 1 箇所は、`beginOAuthFlow` / `startOAuthFlow` が返した**自分のフローの**束縛を渡す機械的追随で、各テストの主題（`PROVIDER_ACCOUNT_RELEASE_PENDING` / `PROVIDER_ACCOUNT_ALREADY_LINKED` / 解放後の再サインイン / Google 単独アカウント）は変わっておらず、アサーションの弱化も無い。`steal.stateBinding` を渡す箇所も、他人のフローを盗む筋ではなく「別利用者が正規に開始したフロー」なので正しい。
- `TC-identity-264` から落ちた `expect(view.state).toBe(state)` は、`StartOAuthFlowView` から `state` が消えた（`application/identity/view.ts:56-66`）ことで型が保証するため、検証の喪失ではない。付随して落ちたコメントも旧実装の説明なので残す理由がない。
- 追加された唯一のコメント（`startOAuthFlow.test.ts:61-62`）は否定アサーションが存在する理由（WHY）を書いており、修正の経緯や弁明は含まれていない。ADR 番号の引用も無い。
- 新テストのアサーションは空振りしない（行が無ければ `saved?.stateBindingHash` が `undefined` となり最初の等値アサーションで落ちる）。
