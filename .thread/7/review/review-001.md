# PR Review #001 — [editing] ノート本文・メディア・タイトル・ゴミ箱を編集する

**PR:** #66
**Date:** 2026-09-01
**Round:** 1回目

## Summary

- Blockers: 8
- Warnings: 30
- Verdict: **BLOCKED**

## 担当別ファイル

- backend-note: review-001-backend-note.md（B: 1 / W: 9）
- backend-storage: review-001-backend-storage.md（B: 3 / W: 6）
- backend-tag: review-001-backend-tag.md（B: 2 / W: 5）
- frontend: review-001-frontend.md（B: 2 / W: 10）

## カバレッジ

- 確認申告ゼロのファイル: なし（`apps/web/app/routeTree.gen.ts` は frontend がスキップ欄で「生成物・新規6ルートの登録のみ確認」と申告しているため確認済みとして扱う）

## 指摘一覧

### backend-note
- [B-001] adapters/html/css.ts:isRemovedDeclaration — CSS コメント・識別子エスケープでサニタイズを迂回できる
- [W-001] application/note/purgeNote.ts:RESUME_CLAIM — forward recovery が契約に無い beginPurge の冪等順序に依存
- [W-002] application/note/emptyTrash.ts:purgeEachNote — 全例外を握り潰し全滅を成功として返す
- [W-003] domain/note/ports/noteRepository.ts:findNextPurgeDeadline — 契約変更が spec に未反映
- [W-004] application/note/purgeExpiredTrash.ts:settle — 入力 DTO の scope と settle 規則が spec に無い
- [W-005] domain/note/ports/htmlProcessor.ts:TextNodeEdit — 経路の不透明対象が契約と実装で食い違う
- [W-006] application/note/emptyTrash.ts:scheduleBulkPurge — 列挙が上限なしの無限ループ形
- [W-007] application/note/*:REVISION_RETENTION — 版の保持数 20 が 4 モジュールに複製
- [W-008] adapters/html/allowList.ts — 「ADR 013 の転記」と宣言しつつ 2 か所で相違
- [W-009] application/note/listTrashedNotes.ts — 実行時 filter と count の不一致余地

### backend-storage
- [B-001] application/storage/storeMedia.ts:273 — 保管した media の配信 URL がどこからも読めず本文の画像・動画が 404
- [B-002] application/storage/storeMedia.ts:sanitizeSvg — SVG の実効上限が 800 KB でポリシー表・spec・画面文言の 20 MB と食い違う
- [B-003] application/storage/collectOrphanMedia.ts:252 — 満杯ページで走査が固定され 101 件目以降の孤児が永久に未回収
- [W-001] application/storage/collectOrphanMedia.ts:armOrphanMediaSweepOnFirstMedia — 移動で流入した scope で掃引が arm されない
- [W-002] application/storage/deleteFilesForNote.ts:63-77 — 参照取り込み記録の回収を欠いたまま task を完了
- [W-003] domain/storage/services/uploadValidationPolicy.ts — エディタが 7 形式をリテラルで二重に持ち共有定数がデッド
- [W-004] domain/storage/services/uploadValidationPolicy.ts:144 — opensAsSvg の BOM 分岐が到達しない
- [W-005] application/usage/ensureUploadAllowed.ts — 自前テストなし
- [W-006] spec/domains/storage.md:273 — ポート表にない listByNote を説明したまま（既存の問題）

### backend-tag
- [B-001] application/tag/deleteAssignmentsForNote.ts:44 — barrier 完了後に note.purged の追随が永久に拒否され取り残される
- [B-002] adapters/cloudflare/do/repositories/tagAssignmentRepository.ts:insert — 主キー衝突を業務一意制約と同じ ConflictError に写し memory と挙動が違う
- [W-001] application/workers/subscribers.ts:dispatchDomainEvent — 先頭購読者の恒久失敗が後続を巻き添えにする
- [W-002] application/di/cloudflareRuntime.ts — scope plane outbox に Cloudflare 側の読み手がいない（既存の問題）
- [W-003] domain/integration/ports/backupRecordRepository.ts — ポート JSDoc と spec の食い違い 3 件
- [W-004] domain/tag/valueObject.ts:TagScope — 未使用の構築子一式とドメイン層テスト 0 本
- [W-005] application/integration/__tests__/deleteBackupRecordsForNote.test.ts:244 — 拒否検証が not.toBeNull() 止まり

### frontend
- [B-001] components/note/NoteEditor/editor.tsx:applyMode — 保存後に本文を引き直さずモード切替で本文が巻き戻り旧本文を書き戻す
- [B-002] components/note/NoteEditor/editor.tsx:MediaButton — 本文へのドロップと代替テキスト入力が未実装
- [W-001] components/note/NoteEditor/editor.tsx:optimisticUploads — useOptimistic と setUploads の二重追加で重複 key
- [W-002] components/note/NoteEditor/editor.tsx:readPreferredMode — 端末保持モードの復元がビジュアル不可判定を迂回
- [W-003] components/note/NoteEditor/editor.tsx:commit — WYSIWYG の全保存が wysiwygConversion になり版の理由が誤表示
- [W-004] components/note/NoteEditor/surfaces.tsx:HtmlSurface — 未サニタイズのプレビューを live DOM へ（自己 XSS）
- [W-005] components/note/schema.ts:applyTextNodeEditsSchema — 転送境界の DoS 上限が実質無効
- [W-006] components/note/NoteEditor/editor.tsx — /notes/new に取り込み先セレクターが無い
- [W-007] components/note/NoteEditor/surfaces.tsx:VisualSurface — TC-15 の案内が無い
- [W-008] components/note/TrashList/board.tsx — 51 件以上の予約に P-15 への導線が無い
- [W-009] components/note/NoteEditor/editor.tsx:downloadBody — タイトルを <title> に未エスケープ
- [W-010] spec/pages/index.md:259 — ED-11 との食い違い（既存の問題）
