# PR Review #006 — [editing] ノート本文・メディア・タイトル・ゴミ箱を編集する

**PR:** #66
**Date:** 2026-09-01
**Round:** 6回目

## Summary

- Blockers: 5
- Warnings: 16
- Verdict: **BLOCKED**

## 担当別ファイル

- backend-note: review-006-backend-note.md（B: 2 / W: 3）
- backend-storage: review-006-backend-storage.md（B: 1 / W: 3）
- backend-tag: review-006-backend-tag.md（B: 0 / W: 3）
- frontend: review-006-frontend.md（B: 2 / W: 7）

## カバレッジ

- 確認申告ゼロのファイル: なし

## 指摘一覧

### backend-note
- [B-001] adapters/html/css.ts:skipString — CSS 文字列が改行で終わらず position:fixed が素通りする
- [B-002] adapters/html/{htmlProcessor.ts:sanitizeNodes,css.ts:filterCss} — 入れ子の深さに無制限再帰。22 KB で RangeError、40–120 KB で数秒〜18 秒 CPU
- [W-001] adapters/html/css.ts:readUrlToken — 過剰マッチで同じ規則の残りの装飾を巻き添えにする
- [W-002] application/note/editing.ts — scopeOfNoteOwner の集約が半端（別名と逆写像が未集約）
- [W-003] application/note/__tests__/ — 「書かれなかったこと」を not.toBe / toBeDefined 単独で確認している

### backend-storage
- [B-001] domain/storage/services/uploadValidationPolicy.ts:HTML_BREAKOUT_ELEMENTS — template が table 開始タグ無しで table 系挿入モードへ入り、breakout 拒否を迂回して 180 倍膨張
- [W-001] spec/inventory/test.md — TC-storage-269/270/271 が存在しない行を由来として指している
- [W-002] application/storage/collectOrphanMedia.ts — 判定した snapshot を削除 transaction が検証し直さない
- [W-003] spec/usecases/storage.md — 入力 DTO が「先頭バイトの署名」のままで判定実体と食い違う

### backend-tag
- [W-001] spec/platform/index.md — global 予算の見積もりが 500 query 上限と矛盾したまま JSDoc にも複写された
- [W-002] spec/domains/index.md ほか — 「1 つの決定を複数箇所に書く」型の更新が 3 件とも 1 箇所ずつ届いていない
- [W-003] adapters/cloudflare/do/repositories/tagAssignmentRepository.ts — scope 鍵の検査が cloudflare 側は無検証

### frontend
- [B-001] NoteEditor/editor.tsx:reseedIfUnchanged — 載せ直しの門が本文しか見ておらず往復中に打ったタイトルが捨てられる
- [B-002] NoteEditor/editor.tsx:needsWysiwygWarning — mayLoseDecoration が面の載せる本文を見ておらず ED-04 の門を素通りする
- [W-001] NoteEditor/surfaces.tsx:UNSAFE_PREVIEW_ELEMENTS — form だけ「保存で落ちるものの部分集合」が破れる
- [W-002] NoteEditor/surfaces.tsx — scrub 済みの木を直列化して再パースする経路が 2 本（mXSS の窓）
- [W-003] NoteEditor/surfaces.tsx / NoteBody — :host の !important は shadow root で閉じない
- [W-004] NoteEditor/preferences.ts:sweepExpiredDrafts — 掃除が保存のたびに走り全退避を JSON.parse する
- [W-005] NoteEditor/editor.tsx — 載せ直しに入らない枝で dirty が永久に下りない状態を作れる
- [W-006] NoteEditor/editor.tsx:classify — 決定的な業務拒否まで「退避して再試行」に畳む
- [W-007] spec/pages/index.md — P-12 の取り込み先セレクターが実装と食い違ったまま
