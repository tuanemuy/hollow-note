# PR Review #001 — spec と実装の乖離を同期する（skeleton / アカウント管理スライス分）

**PR:** #22
**Date:** 2026-08-16
**Round:** 1回目

## Summary

- Blockers: 17
- Warnings: 40
- Verdict: **BLOCKED**

## レイヤー別ファイル

- ドメイン・ポート契約: review-001-domain.md（B: 2 / W: 6）
- ユースケース・シナリオ・テストケース: review-001-usecase.md（B: 5 / W: 9）
- 台帳（inventory）の整合性・ID 採番: review-001-inventory.md（B: 5 / W: 8）
- プレゼンテーション・画面・データモデル・プラットフォーム: review-001-presentation.md（B: 2 / W: 9）
- ADR・プロジェクトドキュメント: review-001-docs.md（B: 3 / W: 8）

## カバレッジ

- 確認申告ゼロのファイル: `.thread/14/research.md` / `.thread/14/research-2.md` → General Review（review-001-general.md）で追跡

## 備考

- ユースケース観点は 1 回目の委譲が API エラーで中断し、同一スコープで再委譲して完了した
- 全観点の共通確認: 「実装の縮退・バグを spec に書き写した箇所」はゼロ（`createDownloadUrl` / `workspaceCursor` / `next_attempt_at` / P-25 機能行はいずれも残存）。コード差分に振る舞い変更なし

## 指摘一覧

### Blockers

- [B-001] spec/usecases/identity.md:277 ほか:ExternalServiceError — ポート契約だけ直し identity 側 3 か所が未追随で spec 内部に矛盾（domain）
- [B-002] identity/uniqueness.ts:63, removeIdentity.ts:21:JSDoc — 「the spec writes sha256(...)」が spec 改訂で事実に反する（domain）
- [B-001] spec/usecases/identity.md:456:requestPasswordReset — 発行間隔判定を UoW の外に書き実装の同居性を落とした（usecase）
- [B-002] spec/manual-tests/account.md:346:TC-26 — 期限切れ/無効の出し分けが実装・AC-05・P-04・AC-54 と食い違う（usecase）
- [B-003] spec/testcases/identity/addPasswordIdentity.md:エラー行 — usecase に足したエラー 3 行がテストケースへ未追随（usecase）
- [B-004] spec/usecases/identity.md:515:REAUTHENTICATION_REQUIRED — 造語のままで根拠のフォローアップ Issue が未起票（usecase）
- [B-005] identity/{removeIdentity,uniqueness,view}.ts:JSDoc — 改訂後の spec を名指しで否定するコメントが 3 か所（usecase / domain B-002 と同根）
- [B-001] spec/database/index.md:154:AccountDeletionRetryPolicy — 定義も inventory 行も無い名前を導入（inventory）
- [B-002] spec/inventory/usecase.md:99,100:UC-storage-002/003 — ADR 050 の DTO 縮小に未追随（inventory）
- [B-003] spec/inventory/{domain,adapter}:allRollbackReleased — ADR 053 の本文改訂に未追随・非対称（inventory）
- [B-004] spec/inventory/frontend.md:19,20:PAGE-p03-003/004 — 改訂後の P-03 状態列挙に未追随・実装とも矛盾（inventory）
- [B-005] conformance/accountDeletionManifestStore.ts:100:ADP-common-012 — 新規採番 ADP-common-041 と ID 衝突（inventory）
- [B-001] spec/presentation/index.md:191:ステータス対応表 — 新設 UnauthorizedError を表が写像できず spec どおりだと 500（presentation）
- [B-002] spec/pages/index.md:492:P-25 状態行 — 実装が到達する障害状態が直和から欠落・P-03 と非対称（presentation）
- [B-001] spec/testcases/storage/deleteFilesByOwner.md:11:ADR リンク — 相対パスが 1 階層足りず解決しない（AC-68 / AC-61 不成立）（docs）
- [B-002] spec/domains/identity.md:554:ユースケース概要 — 新設 3 ユースケースが未反映で 21 のまま（docs）
- [B-003] spec/manual-tests/index.md:30,40:集計台帳 — TC 41→42 の集計が未更新（本 PR の ADR 057 に違反）（docs）

### Warnings

（各レイヤー別ファイルを参照。domain W-001〜006 / usecase W-001〜009 / inventory W-001〜008 / presentation W-001〜009 / docs W-001〜008）
