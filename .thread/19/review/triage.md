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

## Round 2

- 指摘: Blocker 3 / Warning 13（統合2組を経て 14 件）
- 内訳: fix 14 / wont-fix 0 / defer 0
- fix の観点別内訳: Port Contract & Application 3 / Adapter 6 / Runtime Wiring 4 / Spec 4
- Round 1 台帳と Key 完全一致の既出指摘: なし

判定の詳細と実行計画は `triage-plan-002.md`。

### 統合

| 統合後 | 統合元 | 内容 |
| --- | --- | --- |
| 既定リース 5 分 vs age SLO 1 分 | Port W-002 + Spec W-002 | spec の帯の上限を既定値が満たしていない |
| `leaseMs` を非既定値で呼ぶケースが無い | Port W-003 + Adapter W-001 | 引数を捨てるバックエンドが全緑で通る |

### 部分採用（採らない側を明記した3件）

| ID | 採らなかった側 | 理由 |
| --- | --- | --- |
| Runtime W-002 | `PORT` / `HOSTNAME` の読みの是正 | 本 PR が持ち込んでいない既存の非対称でスコープ外 |
| Spec W-003 | `spec/platform:177` / `:184` の統合 | ADR-008 が2つの入口を意図的に揃えた正本側 |
| Port W-002 | 既定リース値の引き下げ | ADR-005 の決着を覆す新事実なし。spec 側の帯の条件付けで解消 |

## Round 3

- 指摘: Blocker 2 / Warning 11（統合1組を経て 12 件）
- 内訳: fix 12 / wont-fix 0 / defer 0
- fix の観点別内訳: Port Contract & Application 4 / Adapter 4 / Runtime Wiring 2 / Spec 2
- 既出台帳と Key 一致の指摘: なし

判定の詳細と実行計画は `triage-plan-003.md`。

### 統合

| 統合後 | 統合元 | 内容 |
| --- | --- | --- |
| `SCOPE_TASK_LEASE_MS` の説明の根拠 | Runtime W-002 + Spec W-003 | 参照ランタイムで起こりえない危険を根拠に据えている |

### 主要な判定

- Port W-002 は**実装のバグではなくコメントの問題**。`claimed.length <= limit` により内側の `break` は到達不能で、no-handler の `continue` は `spec/platform:186` の規定どおり。"processed" → 訪問へ是正し、到達不能な `break` は分岐ごと削除
- Adapter B-001 / B-002 / W-001 は個別ケースの追加ではなく、**遷移表の 5 操作 × from 状態 × 観測属性の全セルを機械的に照合**して空欄を埋める方針に切り替え（Round 2 でも同種の穴を塞いだのに新しい穴が出続けたため）
- 3観点から挙がった「文章の肥大・重複」は、足すのではなく**整理・削除する方向**の独立した計画に束ねた（ポート JSDoc は「表が規範・散文が理由」へ再構成、spec は2正本を分節、docs は参照ランタイムの実態を根拠に）

## Round 4

- 指摘: Blocker 0 / Warning 1
- 内訳: fix 1 / wont-fix 0 / defer 0
- fix の観点別内訳: Adapter 1（Port Contract & Application 0 / Runtime Wiring & Spec 0）
- Verdict: APPROVED（Blocker ゼロ）だが fix 1 件のため Round 5 へ

| Key | ID | 判定 | 理由 |
| --- | --- | --- | --- |
| `conformance/scopeTaskScheduler.ts / schedule が既存 pending 行の dueAt・priority を上書き` | Adapter W-001 | fix | ミューテーションで実証（memory を「pending なら温存」に変えても全緑）。#11 が `ON CONFLICT` に状態条件を付けると半分だけ正しい実装が通る |

Round 3 が弱点として申告した `backoffOrSchedule` × `pending` は、Round 4 の Adapter レビューが許容と判定（既存ケースが状態依存分岐を弾く／`deleteFilesByOwner.test.ts:324` が実行形を持つ／runner が次 tick で自己修復する）。

### 観点の休止

Round 5 は fix ゼロだった **Port Contract & Application** と **Runtime Wiring & Spec 整合性** を休止し、**Adapter 観点のみ**を起動する。
