# PR Review #010 — [editing] ノート本文・メディア・タイトル・ゴミ箱を編集する

**PR:** #66
**Date:** 2026-09-05
**Round:** 10回目（**レビューループの上限**）

## Summary

- Blockers: 3
- Warnings: 14
- Verdict: **BLOCKED**（ラウンド上限に到達し、fix ゼロのラウンドを観測できなかった）

## 担当別ファイル

- backend-note: review-010-backend-note.md（B: 1 / W: 2）
- backend-storage: review-010-backend-storage.md（B: 0 / W: 1）
- backend-tag: review-010-backend-tag.md（B: 0 / W: 4）
- frontend: review-010-frontend.md（B: 2 / W: 3）
- general: review-010-general.md（B: 0 / W: 4）

backend-tag はラウンド009 の fix 内訳が 0 で規則上は休止対象だったが、単位 C が ADR-128 の適用で
`spec/domains/index.md` と usecases 6 ファイル（4 ラウンド連続で指摘が出ていた箇所）を書き換えたため継続した。
実際に新規の指摘 [W-001] が出たので、この判断は妥当だった。

## カバレッジ

- 確認申告ゼロのファイル: なし（5 担当で 209 ファイルを網羅）

## 収束しなかった事実

**3 つの Blocker のうち 2 つは、ラウンド009 の修正そのものが作った。**

- frontend [B-001] は、ラウンド009 [W-001]「失敗時に版を引き直す」の修正として入れた props 同期 effect が生んだ巻き戻しの窓
- frontend [B-002] は、ラウンド009 [W-004]「載せ直しの失敗を `mode` に分類する」の修正が、再試行の宛先を `applyMode` に向けたことで生んだデータ損失

残る backend-note [B-001] は `inlineStylesheets` の別機構（ラウンド008 [W-001] と同 Key・別の穴）で、
`</style` の無害化が 1 パス置換のため入れ子で突き破れる。

これは編集島（`editor.tsx` / `detail.tsx`）で 8 ラウンド繰り返してきたパターンと同じで、
Issue #68 に切り出した「`commit` が保存の全関心を抱えている」構造がまだ効いている。

## 指摘一覧

### backend-note
- [B-001] adapters/html/htmlProcessor.ts:inlineStylesheets — `</style` の無害化が 1 パス置換で、入れ子（`</st</styleyle>`）が `<style>` を突き破る。現ツリーで再現済みの保存型 XSS（#6 の呼び出し元が着地した時点で第三者 CSS から発火）
- [W-001] spec/testcases/note/{deleteNotesForOwner,purgeExpiredTrash}.md — 「1 件も削除できなかった → 失敗として返る（DLQ）」が usecase 手順 5・実装（`backoffOrSchedule` して `stalled`）・本 PR が足した行と矛盾
- [W-002] spec/usecases/note.md:978, 1115 — 「以前は…していたが」の経緯語り 2 か所（既存の問題）

### backend-storage
- [W-001] storeMedia.ts / uploadValidationPolicy.ts / collectOrphanMedia.ts / spec 3 か所 / subscribers.ts — 「Every earlier version」「Four attempts … refuted」等の修正の経緯がコメント・spec に残る（記述の衛生）

### backend-tag
- [W-001] spec/database/index.md:39 / spec/domains/index.md — `operation_id` の「cursor を材料に導出」規則が、本 PR が新設した固定 id の周期行（`storage.orphanMediaContinued` / `note.trashExpiryContinued`）と食い違う
- [W-002] spec/domains/index.md — `workspace.membershipRemovalEdgeContinued` の行が無い（既存）
- [W-003] application/workers/scopeTaskRunner.ts — 表を `{ deletionOperationId, asOf }` に直したが handler は payload の `asOf` を読まず `clock.now()` を使う（既存）
- [W-004] spec/usecases/note.md — deleteNotesForOwner 節の経緯語り（既存）

### frontend
- [B-001] components/note/NoteDetail/detail.tsx:props 同期 effect — `reconcile()` が断片より先に返る窓で版・保存済みタイトル・表示スタイルが古い props へ巻き戻る。低速回線ではタイトル変更が競合 → 巻き戻し → 旧タイトルの再保存で取り消される（**ラウンド009 [W-001] の修正が作った**）
- [B-002] components/note/NoteEditor/editor.tsx:commit の載せ直し catch — 載せ直しの失敗を `mode` に分類した結果、「再試行」が `applyMode` 経由で失敗後の打鍵を確認なしに捨てる。`failed` の文言も通った保存を失敗と告げる（**ラウンド009 [W-004] の修正が作った**）
- [W-001] components/note/NoteEditor/surfaces.tsx:scrubForSurface — SVG の `animate` / `set` を素通しするため `<animate attributeName=href values=javascript:…>` が live DOM に載る（URL 判定そのものの迂回は塞げていることを確認済み）
- [W-002] routes/notes/-action.tsx:moveNoteFn ほか — 「`getNote` の DTO が版を持たない」が `NoteDetailView.version` 導入で偽
- [W-003] components/note/__tests__/schema.test.ts — 経緯語り（記述の衛生）

### general
- [W-001] spec/inventory/test.md — `collectOrphanMedia` の新規行に台帳の TC 行が無い
- [W-002] apps/web/app/presentation/__tests__/adrReference.test.ts — 「ここだけが横断規則を持つ」という JSDoc の根拠が偽
- [W-003] docs/test.md — route ハンドラー実行テストと規約走査テストの 2 種類を分類できない
- [W-004] packages/core/src/application/storage/__tests__/storeMedia.test.ts — `it` 名とコメントが退役した導出の経緯を語る
