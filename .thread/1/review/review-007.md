# PR Review #007 — [skeleton] アカウント作成から白紙ノート閲覧までを通す

**PR:** #12
**Date:** 2026-08-10
**Round:** 7回目（最終）

## Summary

- Blockers: 0
- Warnings: 0
- **fix と仕分けた指摘: 0 → レビューループ完了**
- Verdict: **APPROVED**

## レイヤー別ファイル

- 最終確認（Security / Frontend / Core / Test 横断）: review-007-final.md（B: 0 / W: 0 — **問題点ゼロ・出荷可**）

## ラウンド6修正の検証結果

`listen.node.ts` の静的ファイル配信について、**生ソケットでリクエストラインを直接送出**（curl のパス正規化を回避）して 51 パターンを実測:

1. **パストラバーサル** — 全遮断・漏洩ゼロ。エンコード各種（`%2e%2e%2f` / 二重エンコード / overlong UTF-8 / NUL 3種 / `..;/` / バックスラッシュ）、`dist/server` 直指し、`.env`、`package.json`、`/etc/passwd`、`~/.ssh/id_rsa`、兄弟ディレクトリ — すべてアプリ 404 へフォールスルー。応答本文を機密パターンで走査して漏洩ゼロを確認
2. **メソッド制限** — GET/HEAD のみ静的層、POST/PUT/DELETE/OPTIONS はアプリへ落ちる
3. **ヘッダー適用範囲** — アプリ応答の `private, no-store` / CSP / `Referrer-Policy` / `nosniff` は従来どおり。静的は `/assets/*` が immutable、その他 must-revalidate、全静的応答に `nosniff`。認証パスの食われなし（`dist/client` は `assets/` のみで `index.html` すら無い）
4. **フォールスルー** — 未知 URL はアプリ 404、SSR 全ページ健在。7ページが参照する `/assets/*` 全20件が 200（R6 の症状は解消）
5. **MIME** — 未知拡張子は `application/octet-stream` + 無条件 `nosniff` で再解釈経路が塞がれている

## 受け入れ基準

**AC-14〜19 すべて充足。** 本番形（`pnpm build` → `pnpm start`）で実ブラウザーによる e2e（サインアップ → 確認リンク → `/notes` 着地 → 白紙ノート作成 → 詳細閲覧 → サインアウト → ガード付き再サインイン → 復帰）を通過。`Secure` はビルド後バンドルで `isProduction = () => true` に静的解決され本番形では無条件付与、`document.cookie` 空文字で HttpOnly も実効。

## レビューループの総括

| ラウンド | Blocker | Warning | 主な成果 |
| --- | --- | --- | --- |
| 1 | 1 | 28 | router.invalidate 敷設、UoW 契約の適合スイート化 |
| 2 | 0 | 32 | 文言辞書への集約、タイミング均等化、適合スイートの移植性 |
| 3 | 2 | 18 | **login CSRF 対策（ADR-038）**、SSR エラー表示 |
| 4 | 0 | 19 | アダプター実バグ3件、CSRF ミドルウェア登録、契約の明文化 |
| 5 | 0 | 1 | 空振りテストの是正 |
| 6 | 0 | 1 | 本番形の静的アセット配信 |
| 7 | 0 | 0 | — |

- 総指摘: 100件（fix 96 / wont-fix 1 / defer 3）
- 起票した Issue: #13（RPC 3往復）
- テスト: 388件 → **466件**
