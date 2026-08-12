# レビュー 008 — Test（ゼロベース）

対象: PR #17（`issue/2/account-management-and-auth`、変更 299 ファイル） / 契約: `.thread/2/plan.md`

閾値: 「AC が名指す TC 行の spec 期待結果が実際には検証されていないもの」のみ。適合スイートの網羅性強化・memory で到達不能な分岐・防御的ガードの単独固定・テストコードのスタイルは指摘しない（#11 / #19 送り）。`.thread/2/progress.md` / `.thread/2/adr.md` に記録済みの縮退（`TC-identity-044` / `085` / `090` / `110`、`TC-storage-043` / `047`、`TC-usage-055` / `059`、AC-18 の検証境界（ADR-009）ほか）は決着済みとして再指摘しない。

## Test

### Blockers

- **[B-001]** manifest compaction の継続イベント発行（`page.remaining` 時の `collectEvents`）を固定するテストが 1 つも無い。TC-identity-102 / 103 は次 turn の cursor をテスト側が直接与えて（`compact(h, operationId, "1")` / `String(turn)`）連鎖を回しており、turn 自身が継続を積んだことを観測していない / 場所: `packages/core/src/application/identity/__tests__/deleteAccount.finalize.test.ts:161-184`（TC-102）, `:186-206`（TC-103）、実装は `packages/core/src/application/identity/deleteAccount/compaction.ts:41-52` / 理由: AC-27 が名指す **TC-identity-102** の spec 期待結果（`spec/testcases/identity/deleteAccount.md:68`）は「100 件削除して **`continuation` を保存し**、次 turn の 1 件後だけ header を `completed` にする」。このうち「continuation を保存し」が空振りで、`compaction.ts` の `ctx.collectEvents([...accountDeletionManifestCompact(...)])` を丸ごと削除しても TC-102 / 103 は緑のまま通る（両テストが後続 turn を自前で駆動するため）。実運用では manifest item が 100 件を超えるアカウントの削除が最初の 1 ページで止まり、header が `completed` に到達しない。`identity.accountDeletionManifestCompactContinued` を outbox から読んで表明しているのは同ファイル `:222-230`（非 TC ケース）だけで、そこは **finalize** が積む 1 件（item 1 件 = `remaining: false`）を見ており、compaction turn 自身の再武装は観測範囲外。TC-095 / 096 / 100 / 101 は `pending(h)` で outbox の継続を表明しているので、compaction フェーズだけが抜けている / 提案: TC-102 の 1 turn 目の後に「`identity.accountDeletionManifestCompactContinued` が 1 件積まれ、その payload の cursor が次 turn のもの」を表明し、2 turn 目はその payload をそのまま入力にする（リテラル `"1"` をやめる）。TC-103 のループも同様に、直前 turn が積んだ継続の cursor で次を回す形にすれば「10 turn」と「各 turn が次を積む」が同時に固定できる

### Warnings

- **[W-001]** TC-identity-032（activate 応答喪失からの収束）の表明が、注入した障害の副作用によって恒真になっている / 場所: `packages/core/src/application/identity/__tests__/completeOAuthSignIn.test.ts:310-335`（表明は `:331-334`） / 理由: AC-8 が名指す **TC-identity-032** の spec 期待結果（`spec/testcases/identity/completeOAuthSignIn.md:13`）は「operation payload と正データ version を照合し、email / providerAccount 両方を active へ収束させる」。テストの偽 `activate` は `await real.activate(...)` を**先に**呼んでから throw するため、catch に入った時点で当該行は既に `state: "active"`。`activateUniqueKeys`（`packages/core/src/application/identity/uniqueness.ts:216-235`）の catch を「握り潰すだけ」に書き換えても、`confirm` の判定を逆にして `release` を呼ぶよう書き換えても（memory の `release` は `reserved` / `releasing` 行しか消さない — `packages/core/src/adapters/memory/repositories/identityUniqueDirectory.ts:139-146`）、`["active","active"]` は成立して緑のまま。実際に固定できているのは「応答喪失で sign-in が失敗しない」ことと「再 activate に誤った version を渡さない」ことまでで、spec が言う「照合して収束させる」の判定そのもの（`confirm` が null を返す側 = 書き込みが載っていない側の解放）はどのテストでも観測されていない / 提案: 偽 `activate` を「`real.activate` に委譲せずに throw する（＝行は `reserved` のまま）」形に変えれば、`active` へ至る経路が reconcile 以外に無くなり表明が判別的になる。あわせて `confirm` が null を返すケース（解放側）を 1 本足すと期待結果の両側が閉じる

### カバレッジ

- 確認（77 件）: テスト関連ファイル全量
  - `packages/core/src/adapters/conformance/*`（`accountDeletionManifestStore.ts` / `appliedOperationStore.ts` / `authTokenRepository.ts` / `backend.ts` / `distributedOperationStore.ts` / `identityRemovalReceiptStore.ts` / `identityUniqueDirectory.ts` / `llmUsageRepository.ts` / `noteProjection.ts` / `objectStorage.ts` / `outboxRepository.ts` / `scopeCleanupAdmissionStore.ts` / `scopeTaskScheduler.ts` / `signInOAuthClient.ts` / `storageQuotaRepository.ts` / `storedFileRepository.ts` の 16 件）
  - `packages/core/src/adapters/memory/__tests__/*`, `packages/core/src/adapters/oauth/__tests__/*`
  - `packages/core/src/application/{identity,storage,usage,note,workers,di,execution}/__tests__/*`, `packages/core/src/application/__tests__/helpers.ts`
  - `packages/core/src/domain/{identity,usage,storage}/__tests__/*`
  - `apps/web/app/{presentation,components/auth,worker/node}/__tests__/*`
  - `vitest.config.ts`, `docs/test.md`
- スキップ（222 件）: 上記以外の全ファイル（実装 `.ts` / `.tsx`、ルート・コンポーネント、`.thread/*`、`apps/web/.env.example`、`docs/runtime_node.md` ほか）— 本観点の対象外。ただし (a) 表明の判別性を判断するために必要な実装（`uniqueness.ts` / `compaction.ts` / `deleteFiles.ts` / `authResidueCleanup.ts` / memory の `identityUniqueDirectory` ほか）は都度読み、(b) 共通チェックのため `git diff origin/main...HEAD -- '*.ts' '*.tsx'` の追加行コメント全量を「レビュー経緯・弁明」の観点で走査した（該当なし。`R2` は Cloudflare R2、`fixed` は「対象を確定する」の意で、いずれもレビュー履歴ではない）
- 合計: 77 + 222 = 299

### 機械照合

- Issue #2 本文のチェックリスト 366 行のうち TC 行は 287 行。plan.md「含まれないもの」の TC 見送り 82 行を差し引いた **実装 TC 行は 205 行**。
- 205 行すべてが `it(...)` / `test(...)` のテスト名に TC ID 付きで存在する（describe だけの行・コメントだけの行はゼロ）。**取りこぼし 0**。
- 見送り 82 行のうちテストとして先取りされているものは無い。コード中に現れる唯一の見送り ID は `TC-identity-052` で、`packages/core/src/domain/identity/__tests__/policies.test.ts:233` の「この行は #3」という why-not コメントのみ（テスト名には冠していない）。しきい値 7 / 8 / 9 と 120 日窓のドメイン単体テストは plan.md の縮退（ADR-013）どおり。
- コード中の TC ID のうち残る 96 件は #1 で実装済みの既存行（`TC-identity-008..016` / `150..178` / `213..237` ほか）で、本 Issue のチェックリスト外。
- `pnpm test:unit`: 75 files / 917 passed / 3 skipped で緑。skip 3 件は Google アダプターの `exchangeCode` 契約（`adapters/conformance/signInOAuthClient.ts:55` の `describe.skip` ゲート）で、AC-6 / ADR-064 の宣言どおり。認可要求（`deriveCodeChallenge` / `buildAuthorizationUrl`）は両アダプターで実行される。
- 表明の健全性の横断チェック: `expect(...).rejects` / `.resolves` に await 漏れなし、`adapters/conformance/asserts.ts` の `expectConflict` / `expectNotFound` / `expectValidation` は「reject しなかった」場合に落ちる形。
