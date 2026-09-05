# PR Review #013 — [editing] ノート本文・メディア・タイトル・ゴミ箱を編集する

**PR:** #66
**Date:** 2026-09-05
**Round:** 13回目（上限 15）

## Summary

- Blockers: 1
- Warnings: 11
- Verdict: **BLOCKED**

## 担当別ファイル

- backend-note: review-013-backend-note.md（B: 0 / W: 3）
- backend-tag: review-013-backend-tag.md（B: 0 / W: 2）
- frontend: review-013-frontend.md（B: 1 / W: 4）
- general: review-013-general.md（B: 0 / W: 2）

backend-storage は休止継続。担当範囲は general が引き継いだ。general はラウンド012 の fix が 0 だったが、
休止すると storage / usage / integration が丸ごと無レビューになりカバレッジ規則で結局レビュアーを足すことになるため継続した。

## カバレッジ

- 確認申告ゼロのファイル: なし（4 担当で 214 ファイルを網羅）

## 前ラウンドの修正の検証結果（レビュアーの独立検証）

- **継続まわりは全項目が一致**（backend-tag）— 訂正した JSDoc / canon は `scopeTaskRunner` の backoff 経路と `scopeTaskScheduler` の契約表に一致。reader 4 本は「再開位置のみ → fallback + warn」「仕事を名指す → fault」で揃い `{}` の扱いも正しい。warn テストは消すと落ちる。継続要求表・usecases DTO・実装は 3 者一致
- **conformance の新ケースは検出力あり**（backend-note）— cloudflare の `findNextPurgeDeadline` を storage-only に変異させると新ケース含む 2 本が赤、`armRetentionSweep` の 2 通りの変異で TC-note-793 の 2 本とも赤
- **台帳の整合**（general）— TC 1,030 / ADP 203 すべて台帳に行あり、ADR 参照は全件実在、`.thread/` 引用ゼロ

## 収束の傾向

- 指摘総数: 010 17 → 011 18 → 012 12 → **013 12**
- Blocker: 010 3 → 011 2 → 012 1 → **013 1**
- **編集島の Blocker は「前ラウンドの修正が作った回帰」ではない状態が 2 ラウンド続いている**

ただし今回の [B-001] / [W-001] は、**ADR-136 で消したはずの stale closure と同じクラス**である。
`liveRef` に寄せたのが `title` / `mode` / `body` / `baseline` の 4 つだけで、
`importReferences`（B-001）と `pendingMode`（W-001）が漏れていた。
**完了条件を「4 識別子を grep」に絞ったことがクラスを消しきれなかった原因。**

## 指摘一覧

### backend-note
- [W-001] spec/inventory/test.md:2614 — TC-note-819 行に「従来は 26 秒焼いてから `RangeError`」の経緯が残る（写し元の testcases は現在形）
- [W-002] spec/testcases/note/{trashNote,restoreNoteRevision}.md — テストが主張している契約に testcases の行が無い 2 件（TC-note-793 / TC-note-470 は既存 TC への相乗りで `spec/testcases/` から辿れない）
- [W-003] spec/domains/note.md:439 — ポート節の `findNextPurgeDeadline` に「同一 UoW で反転させた行を答えに含める」節が無い（port JSDoc・ADP-note-057・database/index.md・usecases の 4 か所は持つ）

### backend-tag
- [W-001] application/cleanup/notePurgeFanOut.ts:readNotePurgeTurn — `deletionOperationId: ""` を黙って `null` に読み替え、admission を飛ばし再 arm の priority を格下げする。canon の「仕事を名指す欄が読めなければ fault」の網から外れている
- [W-002] 記述の衛生（集約 3 件） — `spec/usecases/tag.md:370`「従来どおり」、`subscribers.test.ts:561`「stopped depending」、`spec/inventory/adapter.md` ADP-tag-019 が限定子を落として memory に対し偽

### frontend
- [B-001] NoteEditor/editor.tsx:commit(importing) — 自動保存タイマーの `commit` が `importReferences` を effect 登録時の閉包から読み、1.5 秒のデバウンス中に切り替えた「取り込まない」が無視される（`liveRef` にも effect の依存にも無い）
- [W-001] NoteEditor/editor.tsx:保存して切り替える — `await` の後に state の `pendingMode` を直読みし、往復中の「取りやめ」が無視されて切り替えが起きる
- [W-002] routes/notes/-action.tsx:258 / editor.tsx:1462 — 権限喪失を `blocked` に落とす位置が `seedLatest` へ移ったのに `reseedFromServer` を指す記述が 2 か所残る
- [W-003] spec/manual-tests/editing.md:89 — TC-04 手順 5 の括弧書きの理由が、その手順では走らない載せ直しの門を挙げている（既存の記述・期待結果自体は PASS）
- [W-004] editor.tsx:commit catch / preferences.ts:write — `writeDraft` の成否を見ずに `stashed: true` を立て、`localStorage` が投げる端末で「退避した」と偽る

### general
- [W-001] spec/inventory/test.md × spec/testcases/*（12 ファイル） — 台帳が「testcases から生成」と自称しながら 37 行が食い違う（うち 17 行は本 PR が書いた行）。TC-note-077 は台帳側が偽、TC-note-817 は逆に testcases 側が古い、TC-note-113 はラウンド012 の取り残し
- [W-002] spec/testcases/storage/collectOrphanMedia.md:23 ほか — ラウンド012 で加えた warn の規則をテストは主張しているが TC 行が書いていない
