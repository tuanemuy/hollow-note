# PR Review #002 — spec と実装の乖離を同期する（skeleton / アカウント管理スライス分）

**PR:** #22
**Date:** 2026-08-16
**Round:** 2回目

## Summary

- Blockers: 11
- Warnings: 18
- Verdict: **BLOCKED**

## レイヤー別ファイル

- ドメイン・ポート契約: review-002-domain.md（B: 2 / W: 5）
- ユースケース・シナリオ・テストケース: review-002-usecase.md（B: 5 / W: 3）
- 台帳（inventory）の整合性・ID 採番: review-002-inventory.md（B: 1 / W: 3）
- プレゼンテーション・画面・データモデル・プラットフォーム: review-002-presentation.md（B: 2 / W: 2）
- ADR・プロジェクトドキュメント・乖離台帳: review-002-docs.md（B: 1 / W: 5）

## カバレッジ

- 確認申告ゼロのファイル: なし（docs 観点が 75 件を確認、`.thread/14/review/` 8 件は中間成果物としてスキップ）

## R001 の修正の検証

- 正しく入っていた: 56 Key（観点別に domain 6 / usecase 12 / inventory 10 / presentation 9 / docs 19）
- 不完全: 4 件（M-02 の同型残り 4 か所、M-11 の到達性、M-40 の JSDoc 側、M-56 の語の衝突）
- **退行: 1 件**（M-10 の波及で `PAGE-p03-004` が実装より狭くなった）
- 既存 ID の繰り下げ・付け替え: 0 件（`origin/main` と HEAD の ID → 要素写像を機械比較）
- `spec/` 全域の相対リンク 918 本: 切れ 0 件

## 指摘一覧

### Blockers

- [B-001] spec/adr/052 + spec/inventory/adapter.md:5:ADP 追跡規約 — 「`describe` 名で追う」が実態（`it` 名 166 件 / `describe` 0 件）と違い、根拠に挙げた ADR 026 にその規定が無い（**domain / inventory / docs の 3 観点が独立に指摘**）
- [B-001] spec/domains/identity.md:566:InvalidAvatarUrl — union に足したが `AvatarUrl` / `SameOriginPolicy` が spec に無く、唯一の追跡先だったコメントは削除済み（domain）
- [B-001] spec/testcases/identity/{completeOAuthSignIn,linkOAuthIdentity}.md:PROVIDER_ACCOUNT_RELEASE_PENDING — usecase に足したエラーが TC・台帳へ未追随（usecase）
- [B-002] spec/usecases/usage.md:recalculateStorageUsage — 実行者一致検査が入力 DTO の段落だけにあり手順・エラー表・TC・台帳に無い（usecase）
- [B-003] spec/testcases/storage/storeUpload.md:36 — 宣言サイズを落としたのに「宣言と実サイズの食い違い」行が残り成立しえない（usecase）
- [B-004] application/identity/getProfile.ts:11 ほか4か所 — 本 PR が新設した spec 節を実装コメントが「spec には無い」と否定（usecase）
- [B-005] spec/manual-tests/index.md:対応表 — 本 PR が新設した ADR 057 の追随規則を本 PR 自身が破っている（usecase）
- [B-001] apps/web/app/presentation/session.ts:17 — JSDoc の「spec mandates it unconditionally」が M-40 の spec 修正で偽になった（presentation）
- [B-002] spec/presentation/index.md:236 / spec/inventory/frontend.md:121 — `failed` を含む 5 値の表示要求が、新設した 3 値 CHECK と矛盾（presentation）

### Warnings

（各レイヤー別ファイルを参照。domain W-001〜005 / usecase W-001〜003 / inventory W-001〜003 / presentation W-001〜002 / docs W-001〜005）
