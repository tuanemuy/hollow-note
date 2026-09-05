# PR Review #003 — [editing] ノート本文・メディア・タイトル・ゴミ箱を編集する

**PR:** #66
**Date:** 2026-09-01
**Round:** 3回目

## Summary

- Blockers: 4
- Warnings: 29
- Verdict: **BLOCKED**

## 担当別ファイル

- backend-note: review-003-backend-note.md（B: 1 / W: 5）
- backend-storage: review-003-backend-storage.md（B: 0 / W: 7）
- backend-tag: review-003-backend-tag.md（B: 1 / W: 7）
- frontend: review-003-frontend.md（B: 2 / W: 10）

## カバレッジ

- 確認申告ゼロのファイル: なし（`apps/web/app/routeTree.gen.ts` は frontend が生成物として typecheck で担保と申告）

## 指摘一覧

### backend-note
- [B-001] application/note/purgeNote.ts:resumeInternal — 他人の operation が握る purging route を削除済みと畳み、退会が消さずに ack して終端する
- [W-001] spec/testcases/note/ — 本 PR が仕様に足した振る舞いに台帳行が無く NoteIsTrashed はテストも無い
- [W-002] adapters/html/css.ts:pushStatement — process が不動点でなく再処理のたびに本文が伸びる
- [W-003] spec/adr/013:163 — CSP style-src/img-src/font-src が配備ヘッダーに無い（既存の問題）
- [W-004] application/note/applyTextNodeEdits.ts — transaction 内で本文を 2 回フルパースし方針が updateNoteBody と逆
- [W-005] spec/usecases/note.md#purgeExpiredTrash — settle 3 分岐表の 3 行目が実装の入る条件を書いていない

### backend-storage
- [W-001] application/storage/storeMedia.ts:findSvgRoot — trim() 依存で U+FEFF / U+2003 / U+2028 が </svg> の後ろに残る
- [W-002] application/storage/collectOrphanMedia.ts — CPU 上限の根拠が古く、turn 失敗時にカーソルを捨てるので重いページで回収が進まない
- [W-003] apps/web/app/routes/storage.$.tsx:GET — Range 非対応・全量メモリで 200 MB 動画が再生できない
- [W-004] adapters/html/allowList.ts — "xmlns" が到達不能で除去一覧に壊れた属性名が出る
- [W-005] application/storage/storeMedia.ts:resolveEditableNote — ゴミ箱のノートへのアップロードが通り容量だけ消費する
- [W-006] spec/usecases/storage.md#collectOrphanMedia — limit の根拠が古く turn 全体の失敗がエラー表に無い
- [W-007] adapters/cloudflare/do/schema.ts — index が id の tie-break に対応していない（低優先）

### backend-tag
- [B-001] application/cleanup/participants.ts:note — note 障壁の ack 条件が spec と逆で、中断した purge が誰にも再駆動されない
- [W-001] spec/domains/tag.md:209 — 2 つの一意制約をエラー種別で分ける契約が tag 側に正典を持たず相互参照が循環
- [W-002] adapters/conformance/backupRecordRepository.ts — listByNote の昇順を順不同挿入で検証していない
- [W-003] application/di/cloudflareRuntime.ts — 目標プラットフォームに scope outbox の読み手が無く fan-out が走らない
- [W-004] application/tag/__tests__/ — 本ラウンドで足した受理判定 2 節が無検証
- [W-005] application/cleanup/notePurgeFanOut.ts:readNotePurgeTurn — 壊れた payload の宣言が全域でない
- [W-006] application/workers/subscribers.ts — 兄弟隔離の緩和が全 event 型に効くのに根拠が fan-out にしか触れていない
- [W-007] application/cleanup/participants.ts:localProjection — handoff が同語反復に後退

### frontend
- [B-001] components/note/NoteEditor/editor.tsx:commit — ビジュアルで面の外から入った本文が未送信のまま保存済みになり退避の復元が消える
- [B-002] components/note/NoteEditor/editor.tsx:自動保存 — ガードが isSaving しか見ず破棄の往復中に破棄対象が保存される
- [W-001] components/note/NoteEditor/editor.tsx:setStatus — 打鍵 1 つで failed/conflict が消え自動保存が再開する
- [W-002] components/note/NoteEditor/editor.tsx:writeDraft — ビジュアルではローカル退避が編集を含まない
- [W-003] components/note/NoteDetail/ — ゴミ箱のノートが P-11/P-12 で開け「削除済み」に到達しない
- [W-004] components/note/NoteEditor/editor.tsx:reconcile — 自動保存のたびに断片を取り直して捨てている
- [W-005] components/note/NoteDetail/detail.tsx:onTrash — 「元に戻す」の版が追加 GET と +1 推測の 2 通り
- [W-006] components/note/NoteEditor/editor.tsx:commit — タイトルだけの保存で removed が前回の結果を残す
- [W-007] spec/scenario/editing.md:87 — 「今後表示しない」の扱いが canon 内で矛盾したまま
- [W-008] spec/pages/index.md:361 — P-14 が要求する処理履歴への導線が実装に無い
- [W-009] components/note/NoteBody/index.tsx:JSDoc — 脅威モデルの記述が実態と逆
- [W-010] components/note/NoteList/board.tsx:canMove — 「削除」の可否判定が 2 系統
