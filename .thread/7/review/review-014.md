# PR Review #014 — [editing] ノート本文・メディア・タイトル・ゴミ箱を編集する

**PR:** #66
**Date:** 2026-09-05
**Round:** 14回目（上限 15）

## Summary

- Blockers: **0**（初めて）
- Warnings: 6
- Verdict: **BLOCKED**（fix 系が残るため。Blocker はゼロ）

## 担当別ファイル

- frontend: review-014-frontend.md（B: 0 / W: 2）
- backend-tag: review-014-backend-tag.md（B: 0 / W: 1）
- general: review-014-general.md（B: 0 / W: 3）

backend-storage と backend-note は休止（ともに前ラウンドの fix がゼロ）。担当範囲は general が引き継いだ。

## カバレッジ

- 確認申告ゼロのファイル: なし（3 担当で 216 ファイルを網羅）

## 前ラウンドの修正の検証結果（レビュアーの独立検証）

- **台帳の写し直しは閉じた**（general が手順どおりのスクリプトで再照合）— 本 PR の testcases 20 ファイルは**食い違い 0**。残る食い違いは Issue #69 の範囲のみ。TC-note-831 / 832 は testcases・台帳・`it` 名の 3 者で一致
- **`findNextPurgeDeadline` の契約**は spec / port JSDoc / `session.readRows` / conformance（両バックエンド green）の 4 者で一致
- **継続まわりは全項目通過**（backend-tag）— `""` の fault 化で正当な経路は壊れておらず、ADP-tag-019 の限定子も両実装と一致

## 収束の傾向

- Blocker: 010 3 → 011 2 → 012 1 → 013 1 → **014 0**
- 指摘総数: 010 17 → 011 18 → 012 12 → 013 12 → **014 6**

## 指摘一覧

### frontend
- [W-001] NoteEditor/__tests__/liveReads.test.ts:F/G の計算 — **検査を独立 runner で再現して実測した結果**、参照渡しで後から走る局所関数（`setTimeout(later)` / `.then(later)` / `requestAnimationFrame` 経由）・`useMemo` / `useTransition` の描画値・props・局所関数経由の派生値の 4 形が**違反 0 で素通り**する。逆に G 関数自身の仮引数が F 名と衝突すると偽陽性。現在のツリーに実例は無いが、ADR-137 / `docs/test.md` の「計算だから足しても漏れない」は定義域の外で成り立たない
- [W-002] NoteEditor/editor.tsx:「保存して切り替える」 — 保存後に `enterMode(next)` を直接呼び、ラジオが持つ未保存の門を通らない。保存の往復中に打った文字を `applyMode` → `loadSurface` が確認なしに正本で上書きする

### backend-tag
- [W-001] adapters/conformance/{tagAssignmentRepository,backupRecordRepository}.ts — ポート JSDoc / ADP-tag-010 / ADP-integration-008 が `SystemError(DatabaseError)` を名指すのに、スイートは `isSystemError` しか pin していない（両バックエンドは正しい値を返しており検出力だけの問題）

### general
- [W-001] docs/test.md:Convention scans — `adrReference.test.ts` の ADR 番号解決は `apps/web/app` / `packages/core/src` にしか掛からない（`spec/` / `docs/` は work-log 引用検査のみ）のに 4 ルートすべてで解決すると書いている。また「Two of them run today」は同ファイルの Frontend 節が `serverFunctionRegistration` を規約走査と呼ぶので 3 本
- [W-002] spec/usecases/note.md:888 ほか（TC-note-779） — 「従来どおり」という経緯記述が canon に残っている
- [W-003] spec/inventory/{adapter,usecase}.md:3 — 本 PR で行を足し・書き換えたのに「最終同期: 2026-08-30」のまま（`test.md` だけ 09-05 に更新済み）
