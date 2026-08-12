# PARTIAL 4 件の原因分析

対象: ブラウザ検証（確認項目 28 件 + エッジケース 6 件）の結果 PASS 30 / PARTIAL 4。

## 結論の一覧

| 項目 | 分類 | 対応 |
|---|---|---|
| 10 パスワード再設定の使用済み・改竄リンク | テスト手順の問題 | `.thread/2/testing.md` 項目 10 の期待結果を訂正 + spec-sync 候補（`spec/manual-tests/account.md` TC-26） |
| 18 他のすべての端末からサインアウト | テスト手順の問題 | `.thread/2/testing.md` 項目 18 の期待結果を訂正 + spec-sync 候補（`spec/manual-tests/account.md` TC-13） |
| 21 使用中のハンドルの代替候補 | **実装バグ（変更起因・軽微）** | `apps/web/app/components/settings/ProfileForm/editor.tsx` を修正 |
| 22 正規化後に画面が更新されない | **実装バグ（変更起因）** | 同上（同一ファイル。1 つの修正にまとめられる） |

---

## 項目 10: パスワード再設定 — 使用済み・改ざんリンク

- **観測された挙動**: 使用済み / 改竄トークン付きの `/reset-password?token=...` を開くと、有効なリンクと区別の付かない入力フォームが描画される。「この再設定リンクは使えません」は**送信後**に出る。トークンが受理されることは無く、パスワードも変わらない。
- **期待の出どころ**: `.thread/2/testing.md` 項目 10 は「新しいパスワードの入力欄は出ない」と書く。出所は `spec/manual-tests/account.md` TC-26 手順 2「使用済みの再設定リンクを**開く**｜リンクが無効である旨が表示される」。
- **実装の実際**: `apps/web/app/routes/reset-password.tsx` の GET は `validateSearch` で token の形だけを見る（loader もサーバー呼び出しも無い）。`ResetPasswordPanel/index.tsx` は `resetPassword` の失敗を `IDENTITY_TOKEN_EXPIRED` / `AUTH_TOKEN_NOT_FOUND` / `AUTH_TOKEN_ALREADY_CONSUMED` から `tokenInvalid` に収斂させ、無効状態 + 再申請導線を出して URL からも token を落とす。同ファイルの JSDoc が「トークンが死んでいることは実行して初めて分かる（GET は状態を変えない）」と設計意図を明記している。`spec/usecases/identity.md` に**再設定トークンを消費せずに検証する読み取りユースケースは存在しない**。
- **分類**: テスト手順の問題
- **根拠**: AC-11（トークン受理の拒否）と AC-12（トークン無効時は再申請へ）はいずれも成立。`spec/pages/index.md#P-04` の状態一覧は判定の時点を規定せず、`spec/inventory/frontend.md` PAGE-p04-003 は「無効・期限切れ」の表示を**送信アクションの結果**として定義しており実装はこれに一致する。GET 時点の判定は spec に無い読み取りユースケースを要する。
- **対応方針**: 実装の修正は不要。testing.md 項目 10 の期待結果を「**送信すると**無効状態になり、再申請への導線が出る。パスワードは変更されない」に訂正する。`spec/manual-tests/account.md` TC-26 手順 1・2 の文言訂正を spec-sync 候補として記録する。

## 項目 18: 認証手段管理 — 他のすべての端末からサインアウトする

- **観測された挙動**: 「他の端末のサインインを解除しました。この端末はそのまま使えます。」だけが表示され、無効にしたセッションの件数は出ない。他端末の失効と現端末の維持は期待どおり。
- **期待の出どころ**: `.thread/2/testing.md` 項目 18 は「無効にしたセッションが 1 件であることが表示される」と書く。出所は `spec/manual-tests/account.md` TC-13 手順 2。
- **実装の実際**: `packages/core/src/application/identity/signOutOtherSessions.ts` の戻り値は `{ revocationAccepted: true }`。失効は `User.authEpoch` のバンプ + 現セッションの `refreshAuthEpoch` で行い、旧世代行の削除は継続タスクが 100 件ずつ回収する。セッション行を数える読みはどこにも無い。
- **分類**: テスト手順の問題
- **根拠**: 件数を返さないことは `spec/usecases/identity.md#signOutOtherSessions` が出力 DTO と処理フローの両方で明示的に決めた設計で、「応答は削除件数ではなく `revocationAccepted: true` を返す」と原文にある。`spec/inventory/frontend.md` PAGE-p22-006 も「accepted 状態を表示する」で件数の表示要素を持たない。さらに件数表示は AC-16 の「10,000 件でも O(1)」と両立せず、`spec/scenario/account.md` の「サインイン中の端末の一覧は持たない」方針とも矛盾する。物理行の削除は非同期なので、応答時点で「無効にした件数」という値自体が存在しない。
- **対応方針**: 実装の修正は不要。testing.md 項目 18 の期待結果を「解除を受理した旨が表示される（件数は表示しない — 失効は `authEpoch` バンプで件数に依存しないため）」に訂正する。`spec/manual-tests/account.md` TC-13 手順 2 も spec-sync 候補として記録する。

## 項目 21: プロフィール — 使用中のハンドルを設定しようとする

- **観測された挙動**: 入力中に「このハンドルは使われています」は出るが、代替候補（`user-a-1` 等）は出ない。候補は保存を試みてサーバー側で `HANDLE_ALREADY_USED` になった後に初めて表示される。
- **期待の出どころ**: `spec/scenario/account.md` の AC-07 異常系が「公開ハンドルが既に使用されている場合、**入力中に重複を検出して代替候補を提示する**」と明示。`spec/pages/index.md#P-21` の状態一覧に「ハンドル重複（候補提示）」があり、`spec/design/pages/P21-settings-profile.html` は `field-error`「このハンドルは使われています」と候補チップ 3 つを**同一の状態として**描いている。`.thread/2/plan.md` AC-20 も「重複候補提示」を要求。
- **実装の実際**: `editor.tsx` は入力のデバウンス後に `checkHandleAvailability` を呼び、`available === false` なら `{ kind: "problem", message: "このハンドルは使われています" }` を立てるだけで候補を作らない。候補チップの唯一の供給元は**保存失敗**（`SaveError`）で、`saveErrorFor()` が `HANDLE_ALREADY_USED` のときだけ `suggestionsFor(handle)` を積む。`suggestionsFor` はクライアント純粋関数なのでサーバーもユースケースも関与しない。
- **分類**: 実装バグ（変更起因・軽微）
- **根拠**: シナリオ・状態一覧・モック・AC のすべてが入力中の候補提示を要求しており、宣言済みの縮退にも該当しない（`progress.md` に挙がっている `PAGE-p21-001` の欠落要素は「公開ページへのプレビュー導線」のみ）。候補生成はクライアント純粋関数なので、入力中の重複検出時に同じ関数を呼ぶだけで満たせる。
- **対応方針**: `editor.tsx` の 1 ファイルで完結。`HandleHint` の重複バリアントに `suggestions` を持たせ、「使われています」の分岐でのみ `suggestionsFor(candidate)` を積む（通信失敗の分岐では空）。候補チップの供給を「保存失敗の候補 → 無ければヒントの候補」の順で解決する。

## 項目 22: プロフィール — 予約語・不正な文字のハンドル

- **観測された挙動**: `Test-User` を保存すると永続化は `test-user` に正規化されて成功しているのに、保存直後の画面は入力欄が `Test-User` のままで「保存しました」が出ず「未保存の変更があります」バーが残り続ける。**利用者には保存が失敗したように見える。**
- **期待の出どころ**: `.thread/2/testing.md` 項目 22 と `spec/manual-tests/account.md` TC-32 手順 3 が「保存後の表示が `test-user`」を要求。`spec/pages/index.md#P-21` の状態一覧に「保存済み」があり、`spec/inventory/frontend.md` PAGE-p21-002 は「current profile を**更新する**」と定める。`CLAUDE.md` の「すべてのミューテーションは `router.invalidate()` で再基底化する」規律。
- **実装の実際**: `editor.tsx` の `displayName` / `bio` / `handle` は `useState(profile.…)` で**マウント時に 1 度だけ**種を受け、以降 `profile` prop が変わっても同期しない。`dirty` はローカル状態とサーバー truth の差で判定する。保存アクションは `updateProfile(...)` の**戻り値を捨て**、`router.invalidate()` してから `{ kind: "saved" }` を返す。バーの文言は `dirty` が `saved` より優先される。
  連鎖: `Test-User` を送る → サーバーは `test-user` を保存 → invalidate で `profile.handle` が `test-user` に → ローカル `handle` は `Test-User` のまま → `dirty` が true に固定 → 「保存しました」に到達しない。
- **発生条件**: 「サーバー側の正規化で値が変わった」ケース**固有**（`Handle.create` の `toLowerCase()`、`DisplayName.create` の `trim()`）。正規化が値を変えなければ正常に動く（エッジケース 1 では「保存しました」が正常表示された）。
- **分類**: 実装バグ（変更起因）
- **根拠**: `ProfileEditor` は本 PR で追加されたファイルで、この挙動の縮退記録はどこにも無い。結果として P-21 の状態一覧にある「保存済み」に到達できず、PAGE-p21-002 の「current profile を更新する」も満たされない。**4 件中これだけが利用者の誤認を招く**（実測でも `identity.user.handleChanged` が 2 件出ており、利用者が再保存を押したことを示す）。
- **対応方針**: `editor.tsx` の 1 ファイルで完結。保存アクションで `updateProfile` の戻り値（`ProfileView`）を受け取り、成功時にローカル状態をサーバー truth で種まき直す。`router.invalidate()` はそのまま残す（再基底化の規律）。保存中に利用者が同じ欄を打ち替えていた場合の巻き戻しを避けるため、「送信した値と現在のローカル値が一致するときだけ種まき直す」条件を付ける（ADR-102 の「判断の対象になった値と対で保持する」考え方と一貫）。
