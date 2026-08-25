# 指摘台帳 — 薄いビュー（次ラウンドのレビュアーへ）

Round 001 で **wont-fix / defer / 要確認** と判定した指摘。同じ内容を再指摘する場合は、判定を覆すべき新事実を添えること。
fix 判定の全件は `triage.md` を参照。

## wont-fix

| Key | 判定 | 理由 | Issue |
|---|---|---|---|
| `do/repositories/{storedFileRepository,noteRepository}.ts:readForUpdate 事前読み` | wont-fix | adr.md ADR-008 / ADR-013 / ADR-025 で決着済み。二段構え（ステージ時の読みで固有符号、guard は同時実行の砦）はこの PR の中核規律で、省くと版の不一致が呼び出し地点ではなく commit で現れる。最適化は ADR-002 が範囲外に置いた別作業 | — |

### wont-fix に準じる副論点

| Key | 扱い | 理由 |
|---|---|---|
| `globalMaintenanceRunStore:PRUNE_WORKER_ID がプロセス定数` | 誤指摘（親の指摘自体は fix） | `PRUNE_LEASE_OWNER = crypto.randomUUID()` は isolate ごとに異なるので「全 Worker が同一 owner を名乗る」は成立しない。`_occ_guard` 欠落の本体だけを直す |
| `routing B-003 の対案 (b)「createWorkerContainer から scopeTaskQueue を外す」` | 採らない | ADR-003 の due index はまさに中央 runner の `listDue` のために新設した表であり、ポート契約が `listDue` の実装を要求している。対案 (a)（空レジストリでは claim しない）側を採る |

## defer

| Key | 判定 | 理由 | Issue |
|---|---|---|---|
| `application/ports:1 operation = 何行かの契約統一` | defer | ポート JSDoc・memory 実装・適合スイートが同時に動く。memory の振る舞い変更は AC-7 に抵触し、本 Issue のスコープ（今日ポートがある 30 スイートの CF 実装）を越える | 未起票 |
| `di/runtime.ts:MemoryRuntime の AppRuntime 適合` | defer | 塞ぐには `memoryRuntime.ts` の型注釈書き換えが要り、Node 参照ランタイムの配線に手を入れる形になる（AC-7 の保守的な線）。次スライスの先頭で片付ける | 未起票 |
| `adapters/memory:暗号 / Intl アダプターの分離` | defer | plan.md「含まれないもの」が明示的にスコープ外と定め、ADR-030 が理由を述べている | 未起票 |
| `DEFAULT_MAINTENANCE_TABLES の単一正本化` | 部分 defer | 本 PR ではテストで一致を固定するに留める。正本統合は別ブランチ `issue/16/sweep-table-order-single-source` の持ち分 | #16 |

## 要確認（メイン判断待ち）

| Key | 判定 | 迷った理由 |
|---|---|---|
| `adapters/conformance/scopeTaskScheduler.ts:並行claimケース` | 要確認 | 契約の穴を塞ぐ本筋だが適合スイート本体の変更にあたる。AC-8 / ADR 046 の手続き（memory も同じケースを通す）が要り、偽クロック下の並行ケースは不安定化リスクもある。CF アダプター側の occGuard 修正＋バックエンド固有テストだけでも Blocker 自体は閉じる |
| `d1/repositories/publicNoteProjection.ts:非public行のD1投影` | 要確認 | spec/database と ADR 021 は「public かつ active の行だけ」と明記しており canon 違反だが、memory も同型。CF 側だけ直す（世代ベクトルの比較可能性をどう保つかが自明でない）か、canon を実装に合わせるかは正本レベルの判断 |
