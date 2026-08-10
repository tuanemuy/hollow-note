# PR Review #005 — [skeleton] アカウント作成から白紙ノート閲覧までを通す

**PR:** #12
**Date:** 2026-08-10
**Round:** 5回目（収束判定ラウンド）

## Summary

- Blockers: 0
- Warnings: 1
- Verdict: **APPROVED**（Blocker ゼロ。完了判定は台帳の fix ゼロ）

## レイヤー別ファイル

- Core（Domain / UseCase / Adapter）: review-005-core.md（B: 0 / W: 0 — **問題点ゼロ**）
- Frontend / Presentation / Security: review-005-web.md（B: 0 / W: 0 — **問題点ゼロ**）
- Test: review-005-test.md（B: 0 / W: 1）

## ラウンド4修正の検証結果

**退行ゼロ。** 3レビュアーが重点対象を個別に検証し、いずれも「退行なし」と判定した。

- **Core** — 重点6点すべて退行なし。`commandKeyOf` は usecase / アダプター / 適合スイートの三者が byte 一致、`reconstruct` の必須列拒否は白紙ノートの実値（`NoteHtml.empty()` 等）を全て追跡して通過を確認、visibility ガードは `content` を非 ready に落とせる経路が当該2メソッドのみであることを確認して不変条件が対称に閉じることを検証
- **Web** — 重点5点すべて退行なし。CSRF 登録内容がフレームワークの `defaultCsrfMiddleware` と完全同一（既定の復元であって独自判断ではない）ことを確認。**実測で ADR-038 の効能を確認**: 同一ブラウザーは `signedIn: true` + セッション発行、別ブラウザーは確認成立するが **Set-Cookie ゼロ**（login CSRF 不成立）。AC-15〜19 をすべて充足、signUp → verify → ノート作成 → 表示を実 HTTP で e2e 通過
- **Test** — **ミューテーション検証13パターン中12が killed**。唯一の生存が下記 W-001

## 指摘一覧（ラウンド5 新規）

- [R5-TS-W-001] pruneExpiredAuthState.ts:252 — ラウンド4で追加した「releaseLane 失敗 → unfinished work」テストが空振り（`workRemains = true` を削除しても全466件が緑）。テストが渡す table 集合だと `nextTable === undefined` 分岐を通り、そこで無条件に `workRemains = true` が立つため catch の代入と無関係に `continued: true` になる。現行の制御フローでは catch 内の代入が返り値に影響する経路が存在しない
