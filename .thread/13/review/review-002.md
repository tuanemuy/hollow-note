# PR Review #002 — perf(web): ナビゲーションごとの RPC 3往復を削減する

**PR:** #36
**Date:** 2026-08-23
**Round:** 2回目

## Summary

- Blockers: 1
- Warnings: 15
- Verdict: **BLOCKED**

## レイヤー別ファイル

- 認証・セッション: review-002-auth.md（B: 0 / W: 4）
- ルーティング基盤・設定の受け渡し: review-002-routing.md（B: 1 / W: 5）
- ノート閲覧のフロントエンド体験・ドキュメント整合: review-002-note-docs.md（B: 0 / W: 6）

## カバレッジ

- 確認申告ゼロのファイル: なし（3体とも全17ファイルを確認申告）

## 指摘一覧

### 認証・セッション

- [W-001] settings/route.tsx:48-51 — `/settings` のガードだけ `signInRedirectOptions` を通らない
- [W-002] signin.tsx:11 — `REDIRECT_MAX_LENGTH` の定数化から漏れた即値 `2048`
- [W-003] settings/route.tsx:30-31 — `shouldReload` コメント「実質いつも真」が外部からの preload に当てはまらない
- [W-004] spec/adr/030:33 — 同一タブでの利用者切り替えで上部バーに前の利用者が出る経路が未記載

### ルーティング基盤・設定の受け渡し

- [B-001] notes/{index,$noteId}.tsx:19 — 背景再取得が断片 promise ごと差し替わり、本番でもスケルトンへ巻き戻る（AC-8 後半が不成立）
- [W-001] docs:342 — 「`/storage/$` は要求スコープを持たない」が逆。`handleRedirectResponse` 経由の `getRouter()` が未記載
- [W-002] appConfig.ts:32-39 — `undefined` 返しに痕跡が無く、配線ミス時にメタタグが黙って消える
- [W-003] signin.tsx:11 — `REDIRECT_MAX_LENGTH` と生リテラル `2048` の二重管理
- [W-004] settings/route.tsx:32-53 — 失効後のホバーで子断片の 401 が飛び cached match が `status:'error'` で残る
- [W-005] settings/route.tsx:30-31 — コメント精度（auth W-003 と同じ）

### ノート閲覧のフロントエンド体験・ドキュメント整合

- [W-001] docs:86-88,426-428 — `boundedRedirectSource` を「clamp」と説明しているが実際は `/notes` への全面差し替え
- [W-002] settings/route.tsx:48-51 — `signInRedirectOptions` 非経由（auth W-001 と同じ）
- [W-003] signin.tsx:11 — 即値 `2048`（auth W-002 / routing W-003 と同じ）
- [W-004] docs:415-430,547 — `REDIRECT_MAX_LENGTH` の出所が import ブロックにもモジュール表にも無い
- [W-005] spec/adr/030:33 — 「失効後は前の `loaderData` が出る」が既訪 match 限定であることが未記載
- [W-006] docs:945 — 「Every head must return {}」が `__root.tsx:41`（`links: baseLinks`）と不一致
