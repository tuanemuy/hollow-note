# 指摘台帳 — Issue #19 / PR #40

判定の詳細な理由と実行計画は各ラウンドの `triage-plan.md` を参照。

## Round 1

- 指摘: Blocker 3 / Warning 20（統合3組を経て 20 件）
- 内訳: fix 18 / wont-fix 2 / defer 0
- fix の観点別内訳: Port Contract & Application 3 / Adapter 5 / Runtime Wiring 2 / Spec 8

### 統合

| 統合後 | 統合元 | 内容 |
| --- | --- | --- |
| リース失効境界の JSDoc | Port W-001 + Adapter W-002 | `leaseExpiresAt <= now` の包含性が契約に無い |
| `spec/platform:177` の行タプル | Port W-003 + Spec W-002 | 列挙に `status` / `lease_expires_at` が無い |
| `SCOPE_TASK_LEASE_MS` の env 表 | Runtime W-001 + Spec W-006 | `docs/runtime_node.md` に未記載 |

### wont-fix

| Key | ID | 判定 | 理由 |
| --- | --- | --- | --- |
| `conformance/scopeTaskScheduler.ts:326 / port-conformance` | Port B-001 | wont-fix | 事実誤認。conformance `:400-426` 後半が `running` 行への `backoffOrSchedule` → リース解放 → `attempt: 2` での再 claim を既に拘束している |
| `memory/repositories/scopeTaskScheduler.ts:79-93 / 防御コピー` | Adapter W-008 | wont-fix | `dueAt` / `leaseExpiresAt` を読む本番経路が無く、memory アダプター全体が「payload は clone / Date は素通し」で一貫。理論上の懸念にとどまる |

### fix（18件）

`triage-plan.md` の実行計画 A〜D に束ねて修正:

- 計画A: ポート JSDoc の契約を閉じる（3件 / 2ファイル）
- 計画B: 適合スイート・UoW テストを契約の実行形にする（5件 / 2ファイル）
- 計画C: env 配線の入力境界を揃える（2件 / 2ファイル）
- 計画D: spec / 運用ドキュメントを揃える（8件 / 3ファイル）
