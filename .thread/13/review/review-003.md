# PR Review #003 — perf(web): ナビゲーションごとの RPC 3往復を削減する

**PR:** #36
**Date:** 2026-08-23
**Round:** 3回目

## Summary

- Blockers: 0
- Warnings: 8
- Verdict: **APPROVED**（Blocker ゼロ。完了判定は台帳の fix ゼロ）

## レイヤー別ファイル

- 認証・セッション: review-003-auth.md（B: 0 / W: 2）
- ルーティング基盤・設定の受け渡し: review-003-routing.md（B: 0 / W: 3）
- ノート閲覧のフロントエンド体験・ドキュメント整合: review-003-note-docs.md（B: 0 / W: 3）

## カバレッジ

- 確認申告ゼロのファイル: なし（3体とも全18ファイルを確認申告）

## 指摘一覧

### 認証・セッション

- [W-001] Deferred/index.tsx + spec/adr/030 — deferred lane 化で「前の利用者のノート一覧が新しい表示名の下に出る」混在窓。ADR の追記が同時切り替えのように読める
- [W-002] routes/auth/-action.tsx:11 — `REDIRECT_MAX_LENGTH` の統一が OAuth 開始の即値 `2048` に届いていない

### ルーティング基盤・設定の受け渡し

- [W-001] Deferred/index.tsx + notes/$noteId.tsx — `useDeferredValue` の前提（同一 URL の再取得）が JSDoc から読み取れない。note→note の導線が生まれた瞬間に別ノートの内容が残る
- [W-002] docs:135 — 「neither settles its loader without that round trip」が既訪 match で偽（note-docs W-003 と同じ）
- [W-003] spec/adr/030 + notes/index.tsx — 表示名・アバターまで残るようになった点の変更前との差が未記載（auth W-001 と同じ）

### ノート閲覧のフロントエンド体験・ドキュメント整合

- [W-001] CreateNoteButton/index.tsx:39-40 — `staleTime: Infinity` を前提にした `invalidate` 理由コメントが陳腐化
- [W-002] notes/{index,$noteId}.tsx:20 — 無印の `ADR-005` が canon の `spec/adr/005-async-processing.md` と番号衝突
- [W-003] docs:135 — 断定の誤り（routing W-002 と同じ）
