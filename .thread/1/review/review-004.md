# PR Review #004 — [skeleton] アカウント作成から白紙ノート閲覧までを通す

**PR:** #12
**Date:** 2026-08-10
**Round:** 4回目

## Summary

- Blockers: 0
- Warnings: 19
- Verdict: **APPROVED**（Blocker ゼロ。完了判定は台帳の fix ゼロ）

## レイヤー別ファイル

- Core（Domain / UseCase / Adapter）: review-004-core.md（B: 0 / W: 11）
- Frontend: review-004-frontend.md（B: 0 / W: 4）
- Test: review-004-test.md（B: 0 / W: 3）
- Security: review-004-security.md（B: 0 / W: 1）

## ラウンド3修正の検証結果

**ラウンド3の Blocker 2件はいずれも解消を確認。退行なし。**

- **R3-SC-B-301（login CSRF）** — Security が攻撃シナリオを実測込みでなぞり「塞がっている」と判定。ADR-038 の5点すべて充足。`Secure` 属性が `NODE_ENV` 未設定の `pnpm start` でも効くことを実ビルド成果物で確認
- **R3-FE-B-001（SSR エラー画面）** — `not-empty:` が tailwindcss 4.3.3 で `:not(:empty)` に展開されること、root の errorComponent と競合しないこと、`<html>` 二重化がないことを確認
- Test がミューテーション検証（修正を戻すと落ちるか）を4件実施し、追加テストが空振りでないことを実証

## 指摘一覧（ラウンド4 新規）

### Core（Domain / UseCase / Adapter）
- [R4-CO-W-001] IdentityUniqueDirectory.activate が expectedUserVersion を未検証（適合スイートが常に 0 を渡すため未検出）
- [R4-CO-W-002] NoteRouteStore.switchMove の応答喪失リトライが migrationId を未照合
- [R4-CO-W-003] Note.reconstruct の ready 分岐だけが必須列の欠落を空文字に潰す（他分岐は throw）
- [R4-CO-W-004] 同一 owner が lease を延長し続けるため ADR-039 の「二段構え」が成立しない
- [R4-CO-W-005] NoteRouteFanOutReader の state フィルタがポート・スイート未規定
- [R4-CO-W-006] NoteRepository.listByOwner が順序未規定のままオフセットページング
- [R4-CO-W-007] AccountDeletionManifestStore の begin 冪等ケースが空振り、membership cleanup レーン未カバー
- [R4-CO-W-008] highlightedExcerpt のエスケープ節が未検証（FTS5 実装が stored XSS のまま通過し得る）
- [R4-CO-W-009] lane commandKey の書式が store と usecase で不一致
- [R4-CO-W-010] markConversionFailed / markAwaitingIntegration が visibility 側の不変条件を守らない
- [R4-CO-W-011] memoryRuntime.ts の mailSender コメントが opt-in 化で陳腐化

### Frontend
- [R4-FE-W-001] THROTTLED の残り秒数が aria-hidden で支援技術に届かず、待機解除の告知もない（R3 修正の過剰補正）
- [R4-FE-W-002] LOCKED（15分）でフォーム全体が disabled になり別メールに切り替えられない。state なので再読み込みで解除され防御にもなっていない
- [R4-FE-W-003] --color-ink-tertiary（3.6:1）を本文・リンクラベルに使用（spec/design §11 が明示禁止）
- [R4-FE-W-004] prefers-reduced-motion の全体規則がない（個別 motion-reduce: 2箇所のみ）

### Test
- [R4-TS-W-001] ADR-038 の照合ロジックに自動テストがゼロ（回帰検出が手動手順のみ）
- [R4-TS-W-002] TC-note-065 が本番から到達しない recoverBlankNoteCreation を検証、配線の見送りが未記録
- [R4-TS-W-003] verifyEmail.test.ts:114 の `void userId;`（死んだ束縛）

### Security
- [R4-SC-W-401] createStart がフレームワーク同梱の CSRF ミドルウェアを外しており、全 server fn が multipart を無条件受理する。ADR-038 の「FormData 経路なし」の前提が事実と異なる
