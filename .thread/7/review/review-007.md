# PR Review #007 — [editing] ノート本文・メディア・タイトル・ゴミ箱を編集する

**PR:** #66
**Date:** 2026-09-02
**Round:** 7回目

## Summary

- Blockers: 4
- Warnings: 14
- Verdict: **BLOCKED**

## 担当別ファイル

- backend-note: review-007-backend-note.md（B: 1 / W: 4）
- backend-storage: review-007-backend-storage.md（B: 1 / W: 4）
- backend-tag: review-007-backend-tag.md（B: 1 / W: 2）
- frontend: review-007-frontend.md（B: 1 / W: 4）

## カバレッジ

- 確認申告ゼロのファイル: なし

## 前ラウンドの方針転換の検証結果（レビュアーの実測）

- サニタイザーの 4 資源上限は実測で有効。`RangeError` に落ちる経路は消滅。300〜780 KB の正当な CSS は入出力が 1 バイトも変わらない（backend-note）
- 資源メーターが 11〜16 ms で断つため、SVG 経路の残存指摘は DoS ではなく記述の矛盾（backend-storage）
- `OWNER_PURGE_BATCH_SIZE = 40` の根拠は D1 実装と両側一致（backend-note / backend-tag）
- 編集島の確定値集約は成立。残る穴は門の条件（`next !== mode`）という別筋（frontend）

## 指摘一覧

### backend-note
- [B-001] adapters/html/css.ts:skipString/pushStatement — bad-string の書き戻しが終端を落とし 1 つの壊れた宣言が style の残り全体を飲む
- [W-001] domain/note/ports/htmlProcessor.ts — NOTE_HTML_TOO_COMPLEX が NoteErrorCode・エラー表・表示辞書のどこにも無い
- [W-002] spec/inventory/test.md — 新規テスト 2 行が未採番、内容の違う TC を借用している
- [W-003] adapters/html/css.ts:spend — 計量の根拠記述が実装より強い
- [W-004] adapters/html/htmlProcessor.ts:process — 平坦な 1.95 MB が出力上限で拒まれるまで秒オーダーの CPU を焼く

### backend-storage
- [B-001] domain/storage/services/uploadValidationPolicy.ts — breakout 拒否がコメント / 処理命令の読み飛ばしで迂回でき、storeMedia が Note の語彙を漏らす
- [W-001] domain/storage/ports/storedFileRepository.ts — listDeletableByNote の id 昇順が spec / 台帳に無い
- [W-002] application/storage/storeMedia.ts — put と commit の間の中断で行を持たないオブジェクトが残る窓が spec に無い
- [W-003] domain/storage/services/uploadValidationPolicy.ts:identifySvg — purpose を知らずに形の検査を打ち切る
- [W-004] domain/storage/services/uploadValidationPolicy.ts — 「フォームに上限を配る」約束が media だけ守られていない

### backend-tag
- [B-001] spec/platform/index.md / application/note/{purgeExpiredTrash,emptyTrash}.ts — global statement の勘定が deleteNotesForOwner にしか適用されておらず、同じサガを回す他 2 系が上限を超える
- [W-001] spec/usecases/storage.md — storage だけ決着が complete を名指しせず「100 件」の主語も未記載
- [W-002] adapters/cloudflare/do/repositories/tagAssignmentRepository.ts — scope 鍵 guard が deleteByNote に無い

### frontend
- [B-001] NoteEditor/editor.tsx:needsWysiwygWarning — 門が next !== mode を条件に持ち、モードを変えない 4 経路が素通りする
- [W-001] NoteEditor/editor.tsx:classify — 保存以外の 3 経路が既存ノートで「ノートがまだ作られていない」と告げる
- [W-002] NoteEditor/editor.tsx:settlePlaceholder — String.replace の置換値でファイル名の $' / $& が本文を注入する
- [W-003] NoteEditor/editor.tsx:commit(new) — 初回保存後の URL 置き換えが往復中の打鍵を捨て、自分の遷移で離脱確認を出す
- [W-004] NoteEditor/editor.tsx:EditorSnapshot — 「部分確定は型で書けない」の主張と実装が不一致（3 つ目の書き手が残る）
