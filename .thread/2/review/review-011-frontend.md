# review-011: Frontend

### Frontend（ブラウザ検証の修正に対する追加レビュー）

#### Blockers

なし

#### Warnings

- **[W-001]** 種まき直しの commit と `router.invalidate()` の commit がずれた場合、ハンドル欄に一瞬「確認中...」が出て `checkHandleAvailability` が 1 往復余計に走りうる / 場所: `apps/web/app/components/settings/ProfileForm/editor.tsx:173-176`（`reseed` の `setHandle`）と `:200-231`（目安の `useEffect`） / 理由: 正規化でハンドルが変わった保存（まさに項目 22 のケース）では `reseed` が `handle` を `test-user` に書き換える。この時点で `profile.handle` はまだ invalidate 前の旧値なので、`candidate !== (profile.handle ?? "")` が成立して `useEffect` が `{ kind: "checking" }` を立て、400ms 以内に invalidate が着地しなければ照会が飛ぶ。同じ窓では `dirty` も一時的に true（ローカルは新値 / prop は旧値）になり、バーが「未保存の変更があります」を一瞬出しうる。実害は表示のちらつきと余分な 1 リクエストのみで、照会結果は `available: holder === userId`（`packages/core/src/application/identity/checkHandleAvailability.ts`）により自分持ちの `available` になるため、「使われています」や候補チップが誤って出ることはない。修正前は同じ経路でローカルが `Test-User` のまま残り、invalidate 後に恒久的に緑の「このハンドルは使用できます」＋「未保存の変更があります」が並んだので、**この差分は厳密に改善側**である。/ 提案: 現状のままで許容してよい。気になるなら `reseed` でハンドルを実際に書き換えたときだけ `setHandleHint({ kind: "idle" })` を併せて置く（`useEffect` の再実行自体は消えないので、効果は「確認中...」の初期表示を出さないことに留まる）。ブロッカーではない。

#### 確認した範囲

- 対象の差分: `git diff --no-renames apps/web/app/components/settings/ProfileForm/editor.tsx`（`ProfileDraft` / `HandleHint.taken` の追加、`reseed`、保存アクションの戻り値受け取り、`hintProblem` / `suggestions` の解決順）。`.thread/2/{adr,progress,testing}.md` と `.thread/2/manual-test/` は記録なので対象外。
- あわせて読んだもの: `CLAUDE.md`（Frontend 節）、`.thread/2/manual-test/results/analysis.md` の項目 21 / 22、`.thread/2/adr.md` の ADR-102 / ADR-117 / ADR-118、`.thread/2/plan.md` の AC-18 / AC-20、`spec/pages/index.md#P-21`、`spec/design/pages/P21-settings-profile.html`、`spec/scenario/account.md` AC-07 の該当箇所、`apps/web/app/components/settings/ProfileForm/index.tsx`、`apps/web/app/routes/settings/-action.tsx`、`packages/core/src/application/identity/{checkHandleAvailability.ts,view.ts}`、`apps/web/app/presentation/errorDisplay.ts`。

##### 項目 22（保存後にサーバー truth で種まき直す）

- 三層の規律は保たれている。読みは server component（`index.tsx`）、編集は `"use client"` 島（`editor.tsx`）、保留・結果は `useActionState` / `useOptimistic` / `useTransition` のまま。層をまたぐ新しい経路は増えていない。
- `reconcile()`（= `router.invalidate()`）は `editor.tsx:192` に残っており、種まき直しは**その前**に走るだけで代替になっていない。ADR-117 が言う「`AccountMenu` など同じ profile を読む他の面は invalidate でしか直らない」も守られている。
- 巻き戻し回避は正しい。`reseed` は 3 欄すべてを `useState` の**関数更新**で書き、`current === submitted.<field>` のときだけサーバー値を採る（`editor.tsx:168-176`）。`submitted` は `FormData` から起こした送信時点の値、`current` は setter が渡す最新値なので、アクションの closure が古い値を掴む余地がない。React 19 の `useActionState` はディスパッチ時点のレンダーの action を使うが、setter は安定・比較は関数更新なので、どのレンダーの `reseed` が走っても結果は同じ。
- `saved` の型は `ProfileView`。`updateProfileFn` は `module.updateProfile(...)` の戻り値をそのまま返し（`routes/settings/-action.tsx`）、`ProfileView` は primitive と `null` だけなので転送越しに型が崩れない。`let saved: ProfileView;` は catch が必ず return するため確定代入も通る（`pnpm typecheck` 通過）。
- `handle` は `saved.handle ?? ""` で空文字に落としており、「空欄にすると公開ハンドルを解除します」の経路（`saved.handle === null`）でも `dirty` が偽に落ちる。
- アバターの 2 経路（`onPickFile` / `onRemoveAvatar`）は `avatarUrl` だけを送るので種まき直しの対象外で正しい。`avatarUrl` は元から `useOptimistic(profile.avatarUrl)` 由来で invalidate に再基底化される。

##### 項目 21（入力中の重複候補）

- 状態のモデル化は要求どおり型で閉じている。`suggestions` を持つのは `taken` バリアントだけで（`editor.tsx:118`）、通信失敗・予約語・不正な文字はすべて `useEffect` の `.catch` から `problem`（`suggestions` フィールドなし）へ入る（`editor.tsx:222-225`）。`problem` に候補を積むコードは、余剰プロパティ検査により**そもそも書けない**。読み出し側も `handleHint.kind === "taken"` のナローイング越しにしか `suggestions` を触っていない（`editor.tsx:296-297`）。
- 候補の解決順は ADR-118 のとおり「保存失敗 → 無ければ目安」。`handleFailure` は ADR-102 の `saveFailure.handle === handle` ガードを通った後の値なので、候補を押して入力が動いた瞬間に保存失敗側は無効化され、目安側にフォールバックする。文言（`handleProblem`）と候補（`suggestions`）が同じ `handleFailure !== null` を先に見るので、両者が別の判断から来てちぐはぐになる形にはなっていない。
- 既存の振る舞いを壊していない。`aria-invalid={handleProblem !== null}` と `inputInvalidClass` は `taken` でも従来どおり立つ（`problem` から `taken` へ分岐名が変わっただけで、`hintProblem` が両方を拾う）。`aria-describedby={handleHintId}` と `aria-live="polite"` の関連付けも変更なし。`available` / `checking` の表示、`isSaving` / `dirty` によるボタン活性、バーの live region も差分に触れられていない。
- 文言の出どころは保たれている。サーバー由来の失敗は `renderErrorMessage` / `displayError`（`presentation/errorDisplay.ts`）経由のまま。目安の `"このハンドルは使われています"` はサーバーのエラーではなくクライアント側の目安表示で、この差分より前から同じ literal（モック `P21-settings-profile.html:273` の `field-error` と同文）。差分は `kind` を付け替えただけで literal を増やしていない。
- モック整合。`P21-settings-profile.html:273-279` は `field-error` の文言と候補チップ 3 つを同一状態として描いており、`suggestionsFor` が 3 件返すので入力中の状態がモックに一致する。

##### スコープ / 衛生

- `PAGE-p21-004`（公開プロフィール preview）は増えていない。`editor.tsx` に対応要素も無効ボタンの placeholder も無く、`index.tsx` の「出さない」宣言も据え置き。モックの「公開ページをプレビュー」ボタン（`P21-settings-profile.html:281-284`）は依然として未実装のまま。
- デザイントークンのハードコードは増えていない。差分に含まれる JSX の変更は分岐の付け替えだけで、`className` 文字列・色・寸法の追加は 1 件も無い。
- 追加されたコメントは 3 つとも WHY（サーバー側正規化という隠れた制約 / 候補を持てる状態の不変条件 / 候補の優先順）で、指摘への弁明・レビューの経緯・修正履歴の記述は含まれていない。`ProfileDraft` は `FormData` からの起こしを 1 か所にまとめる型で、`updateProfile` の入力と `reseed` の比較対象が同じ形であることを型で結んでいる。
- `pnpm typecheck` 通過、`pnpm test:unit` 通過（76 files / 925 passed, 3 skipped）。共有作業ツリーでの変異テストは行っていない（読み取りと上記 2 コマンドのみ。`git status --porcelain` で差分がレビュー開始時と同一であることを確認済み）。
