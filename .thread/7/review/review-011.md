# PR Review #011 — [editing] ノート本文・メディア・タイトル・ゴミ箱を編集する

**PR:** #66
**Date:** 2026-09-05
**Round:** 11回目（上限は 15 に延長済み）

## Summary

- Blockers: 2
- Warnings: 16
- Verdict: **BLOCKED**

## 担当別ファイル

- backend-note: review-011-backend-note.md（B: 0 / W: 3）
- backend-tag: review-011-backend-tag.md（B: 0 / W: 4）
- frontend: review-011-frontend.md（B: 2 / W: 5）
- general: review-011-general.md（B: 0 / W: 4）

backend-storage はラウンド010 の fix 内訳が 0 のため**休止**。担当範囲（storage / usage / integration）は general が引き継いだ。

## カバレッジ

- 確認申告ゼロのファイル: なし（4 担当で 211 ファイルを網羅）

## 前ラウンドの修正の検証結果

- **`inlineStylesheets` のエスケープ化は穴なし**（backend-note が独立に検証）。RAWTEXT の終了条件・置換の不動点・CSS の `\/` の論証に加え、現ツリーで 30 入力（入れ子 3 重・大小文字・空白 / `/` の綴り・NUL・CSS エスケープ・除去による接合・`</script>`・`<plaintext>`）を実試行して突き破りなし
- **`adrReference.test.ts` の移動後も検出力を保っている**（general が植え込み 3 件で確認。`REPO_ROOT` 4 段は正）
- **台帳の整合**（general が実測）: TC 1,028 種・ADP 191 種すべて実在、重複なし、20 本の表と台帳の行数が全件一致

## 収束の傾向

編集島の Blocker は **3 ラウンド連続**で出ている:

- ラウンド010 の [B-001] [B-002] — どちらもラウンド009 の修正が作った回帰
- ラウンド011 の [B-002] — **ラウンド010 で足した `dirty` の門が作った回帰**（破棄の再試行を `commit(true)` に反転させる）

ラウンド011 の [B-001] は前ラウンド起因ではなく、`WysiwygSurface` の effect deps に元からあった穴を今回のレビューが掘り当てたもの。

## 指摘一覧

### backend-note
- [W-001] spec/usecases/note.md:978 — 前ラウンドの現在形化で「このユースケースが `identity.user.deleted` / `workspace.deleted` を受け取る」「購読者を 8 つ / 4 つ持つ」が現在の主張として残り、概要・`spec/domains/identity.md`・実装と食い違う
- [W-002] domain/note/ports/htmlProcessor.ts:JSDoc — `ContentTooLarge` を `process` だけの拒否と書いているが `editTextNodes` / `inlineStylesheets` / `rewriteReferences` も投げる。3 メソッドとも未テスト
- [W-003] application/note/emptyTrash.ts:isSkippableRefusal — `ConflictError` 全体を「その 1 件がゴミ箱を離れた」として飛ばすため、`WORKSPACE_DELETING` / `ACCOUNT_DELETING` の障壁下で 50 件が黙って飛び「0 件を完全に削除しました」になる

### backend-tag
- [W-001] spec/domains/index.md:298 / spec/database/index.md:39 — `operation_id` 導出規則の例外列挙が表の全行を覆っていない（cursor を鍵に混ぜる scope task はツリーに 0 件）
- [W-002] application/note/deleteNotesForOwner.ts:readOwnerPurgeTurn ほか — 継続 payload の reader 4 本で破損時の方針が 3 通り。`readOwnerPurgeTurn` の黙殺は `note` 成分の取り消せない誤 ack に直結し JSDoc の根拠が逆
- [W-003] spec/database/index.md:21 / adapters/cloudflare/do/repositories/noteRepository.ts:delete — 「削除経路でも scope 鍵を検査する」と規則を広げたが `notes` の `delete` は owner 列を見ないまま DELETE する
- [W-004] spec/usecases/identity.md:801,811 — `personalBarrierPruneContinued` の入力 DTO が `{ scope, asOf }` のままで表・実装と食い違う（既存・差分外）

### frontend
- [B-001] NoteEditor/surfaces.tsx:WysiwygSurface(effect deps) / editor.tsx:loadSurface — 面は `baseline` 文字列が変わったときしか載せ直さないため、正本が同一文字列なら「破棄」「版の復元」「競合の破棄」が面をリセットせず、捨てたはずの内容が次の打鍵で保存される（TC-10 手順 2・3・7 / TC-11 手順 5 が FAIL する経路）
- [B-002] NoteEditor/editor.tsx:retryFailed / discard — **ラウンド010 で足した `dirty` の門が破棄の再試行を `commit(true)` に反転させる**（破棄は `dirty` でしか押せないので必ず保存になる）。`revision` の再試行も一次経路と方針が逆
- [W-001] NoteEditor/editor.tsx:restore — `restoreRevision` 成功後の `reseedFromServer` 失敗が `failed {revision}` になり、再試行が復元をもう一度走らせて版と `Revision` を無駄にする
- [W-002] NoteEditor/editor.tsx:自動保存 effect — ビジュアルモードは打鍵でデバウンスされず、連続入力中は 1.5 秒 + RTT ごとに保存と `Revision` が積まれる
- [W-003] NoteDetail/index.tsx ほか — 島が `noteId` で `key` されておらず、パラメーターだけの遷移で版の門が別ノートの版に対して閉じうる（現状は到達経路なし・#8 で顕在化）
- [W-004] NoteEditor/editor.tsx:commit — ビジュアルモードの全量保存が非表示の `importReferences`（既定 true）を送り、ED-02 のテキスト編集が参照取り込みを起こしうる
- [W-005] presentation/errorDisplay.ts:97 — `[ADR 013](spec/adr/013)` がファイルへ解決しない（`adrReference.test` の正規表現はハイフン付きしか拾わない）

### general
- [W-001] domain/storage/services/uploadValidationPolicy.ts:MEDIA_SVG_MAX_DEPTH ほか — **ラウンド010 の現在形化が偽の主張を作った**。「素の再帰で 1,000 段なら `RangeError`」は実態と違い、`HtmlProcessor` は 256 段で `HTML_PROCESSOR_TOO_COMPLEX` を投げる。TC-storage-266 の 3 本目は `<b>` が breakout 要素のため depth gate に対する検出力ゼロ
- [W-002] application/workers/subscribers.ts:246 — 「同じ型の継続購読者は unordered」が同 JSDoc の「run in registration order」とテストに矛盾。失われているのは完了の保証であって順序ではない
- [W-003] spec/usecases/usage.md:69 — `ensureUploadAllowed` の呼び出し元を `storeUpload` だけと書くが `storeMedia` も呼ぶ
- [W-004] docs/frontend_implementation_example.md:213 — 「`NoteList` / `NoteDetail` render read-only markup」が偽（島が rename / trash / restore を持つ）
