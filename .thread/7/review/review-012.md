# PR Review #012 — [editing] ノート本文・メディア・タイトル・ゴミ箱を編集する

**PR:** #66
**Date:** 2026-09-05
**Round:** 12回目（上限 15）

## Summary

- Blockers: 1
- Warnings: 11
- Verdict: **BLOCKED**

## 担当別ファイル

- backend-note: review-012-backend-note.md（B: 0 / W: 3）
- backend-tag: review-012-backend-tag.md（B: 0 / W: 4）
- frontend: review-012-frontend.md（B: 1 / W: 2）
- general: review-012-general.md（B: 0 / W: 2）

backend-storage は休止継続。担当範囲は general が引き継いだ。

## カバレッジ

- 確認申告ゼロのファイル: なし（4 担当で 213 ファイルを網羅）

## 前ラウンドの修正の検証結果（レビュアーの実測）

- **継続要求表の 4 分類は閉じた**（backend-tag が独立に数え直し）。40 行を自分で分類して 14/20/4/2 = 40、**漏れゼロ**。修正側の 13/21 との差は `tag.delete/merge` の置き場だけでどちらでも収まる。実装済み scope task 全 15 kind・`schedule(` 19 箇所の鍵も分類と一致
- **`MEDIA_SVG_MAX_DEPTH` の書き換えは今度は実装と一致**（general が実測）。`<g>`×256 以上で `NOTE_HTML_TOO_COMPLEX`、`RangeError` は出ない。新 fixture は門を外すと `FileTooLarge` に変わって落ちる（**検出力あり**）
- **サニタイズの迂回なし**（backend-note が迂回入力 90 種を実走）
- `notes.delete` の pin 検査は `ensureRowInScope` 経由で `readForUpdate` に掛かり ADP-note-011 で担保

## 収束の傾向

- 指摘総数: ラウンド010 17 件 → 011 18 件 → **012 12 件**
- Blocker: 010 3 件 → 011 2 件 → **012 1 件**
- **編集島の Blocker が「前ラウンドの修正が作った回帰」ではなくなった**（4 ラウンド続いた連鎖が止まった）。今回の [B-001] は `takeSnapshot` が描画時の閉包から値を読む stale closure で、ラウンド011 の構造変更とは独立の穴
- ただし frontend [W-001] は、ラウンド011 で `reload` に集約した 2 経路が「確定値 = サーバー」かの点で違う、という**集約が一部行き過ぎていた**指摘

## 指摘一覧

### backend-note
- [W-001] spec/domains/note.md:741 — 本 PR が足した `HtmlTooComplex`（`NOTE_HTML_TOO_COMPLEX`）が正典の列挙に無く、`spec/usecases/note.md` の 4 か所が存在しないコード名を参照している
- [W-002] domain/note/ports/noteRepository.ts:37-44 — 「`save` で `active→trashed` に反転させた行を同じ UoW の答えに含める」を JSDoc・inventory・database/index.md が契約と宣言しているのに、それを主張するテストがどこにも無い（ADP-note-057 も UC-note-021 も別の形を取り、1 件目で `null` を返す実装でも緑）
- [W-003] spec/inventory/test.md:1081,1748 — 前ラウンドで testcases 側を `OPTIMISTIC_LOCK_FAILURE` に絞ったが、台帳 2 行は旧文言（`ConflictError` 全体）のまま

### backend-tag
- [W-001] spec/domains/index.md:333 / deleteNotesForOwner.ts:readOwnerPurgeTurn — 「fault した行は `dueAt` を保ったまま backoff で残る」は偽。runner は `backoff` に落とし `dueAt` は前へ動き、上限で `failed` に駐車される（`dueAt` を保つのは lease 再 claim だけ）
- [W-002] collectOrphanMedia.ts:readOrphanMediaSweepTurn ほか — 規約「再開位置 fallback は `logger.warn` を 1 行残す」に対し orphan reader は warn 無し、barrier prune の warn はテストが見ていない（検出力ゼロ）
- [W-003] spec/usecases/{tag,storage,integration,note}.md 入力DTO — 継続鍵 `operationId` と `scope`、`stuckPurges?` が DTO に無く表・実装と食い違う（ラウンド011 [W-004] と同型の残り 4 か所）
- [W-004] spec/domains/index.md:323 — 「具体式は database/index.md の `scheduled_tasks` に定める」が、式は `:39` にあり当該節には無い

### frontend
- [B-001] NoteEditor/editor.tsx:takeSnapshot — 描画時の閉包から `title` / `mode` を読むため、(1) ビジュアルの `needsReseed` な往復中に打ったタイトルが門を恒真ですり抜けて載せ直しで消える、(2) `acknowledgeWysiwyg` の未保存枝が effect の依存を動かさず、1.5 秒以内のタイマーが前モードの `commit` を走らせて `<style>` 込みの本文を保存する。共通原因は 1 つ（生きた値の ref を読ませる）
- [W-001] NoteEditor/editor.tsx:restore / reloadFromServer — `reload` に集約した 2 経路は「確定値 = サーバー」かが違う。復元確定後の載せ直し失敗では `confirmed` が復元前のまま `failed {reload}` になり「保存」が押せる（復元を黙って取り消す経路がある）
- [W-002] NoteEditor/editor.tsx:SaveIndicator — `failed` を `retry.kind` によらず「保存に失敗しました」と出し、`spec/pages/index.md:319` の「見出しと案内は落ちた往復ごとに分ける」がバー側で成り立たない

### general
- [W-001] spec/inventory/test.md:1860 — TC-storage-074 だけがテストを持たず、前提の購読者 `applyStorageDelta` 自体が不在。行を埋めるスライスの宣言が無い
- [W-002] spec/usecases/usage.md:69 — `ensureUploadAllowed` の呼び出し元の列挙が同ファイル `:16` と食い違う（ラウンド011 の修正が `startBulkUpload` を落とした）
