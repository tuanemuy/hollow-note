# 実装計画 — Issue #3: ワークスペースとメンバーを管理・公開する

**Issue:** #3
**作成日:** 2026-08-29
**規模:** 通常
**実装方針:** steps.md

---

## 目的

ワークスペースの作成・切替、招待、ロール管理、設定、公開、削除までを end-to-end で提供する。あわせて、これまで「workspace 認可が無い」ことを理由に縮退していた他ドメインの実装を本来の契約へ戻す。

## 受け入れ基準

Issue #3 は spec-slice Issue であり、要件は本文の実装チェックリスト（516 行）が正本。ここでは検証の単位だけを示し、行の列挙はしない。

| # | 基準（検証可能な形で） | 由来 | 対応ステップ |
|---|---|---|---|
| AC-1 | 実装チェックリスト全行の実装（Issue #3 本文参照。スタブ・仮実装・部分実装は不可） | Issue 本文「実装チェックリスト」「完了条件」 | 1〜19 |
| AC-2 | WS-01 ワークスペースを作成する が end-to-end で動く | `spec/scenario/workspace.md#WS-01` | 1〜8, 14, 17 |
| AC-3 | WS-02 表示中のワークスペースを切り替える が end-to-end で動く | `spec/scenario/workspace.md#WS-02` | 1〜7, 14, 17 |
| AC-4 | WS-03 メンバーを招待する が end-to-end で動く | `spec/scenario/workspace.md#WS-03` | 1〜6, 9, 15, 17 |
| AC-5 | WS-04 招待を受けて参加する が end-to-end で動く | `spec/scenario/workspace.md#WS-04` | 1〜6, 9, 15, 17 |
| AC-6 | WS-05 メンバーのロールを変更する / 除名する が end-to-end で動く | `spec/scenario/workspace.md#WS-05` | 1〜6, 10, 13, 15, 17 |
| AC-7 | WS-06 ワークスペースを脱退する が end-to-end で動く | `spec/scenario/workspace.md#WS-06` | 1〜6, 10, 13, 15, 17 |
| AC-8 | WS-07 ワークスペースの設定を編集する が end-to-end で動く | `spec/scenario/workspace.md#WS-07` | 1〜8, 14, 17 |
| AC-9 | WS-08 ワークスペースを公開する / 非公開に戻す が end-to-end で動く | `spec/scenario/workspace.md#WS-08` | 1〜8, 14, 17 |
| AC-10 | WS-09 ワークスペースの公開ページを閲覧する が end-to-end で動く | `spec/scenario/workspace.md#WS-09` | 1〜7, 16, 17 |
| AC-11 | DS-02 ワークスペースの公開タイムラインを確認する が end-to-end で動く | `spec/scenario/discovery.md#DS-02` | 1〜7, 14, 16, 17 |
| AC-12 | WS-10 ワークスペースを削除する が end-to-end で動く。**ただしタグの掃除（`TC-workspace-096` / `-097`）とノートの消滅（`TC-workspace-092` / `-094` / `-098`）を除く** — tag ドメインと `workspace.deleted` の購読者が本 Issue のスコープ外のため（後述「決定事項」D-001 / D-003）。メンバーシップ・招待・公開ページの消滅と、削除後の 404 で判定する | `spec/scenario/workspace.md#WS-10` | 1〜6, 11, 13, 14, 17 |
| AC-13 | OR-12 ノートの所属先を移動する が end-to-end で動く。**ただしタグの付け替え（`TC-note-246` / `-247`）を除く** — 同上。所属先の切替・URL の維持・移動先での再認可・ファイルの再配置で判定する | `spec/scenario/organize.md#OR-12` | 1〜6, 12, 16, 18 |
| AC-14 | `getUsageSnapshot` が `workspaceCursor` / `workspaceLimit` を受け、`workspaces` / `nextWorkspaceCursor` を返す（`spec/usecases/usage.md` 手順 2・3 の keyset・並行 RPC・部分失敗時 `unavailable` を含む） | Issue #3 コメント 1 | 13 |
| AC-15 | `recalculateStorageUsage` の `subjectType === "workspace"` が membership を検査する（`storeAvatar` と縮退の向きが一致する） | Issue #3 コメント 2 | 13 |
| AC-16 | 縮退を述べた JSDoc・プレースホルダが残っていない（`recalculateStorageUsage.ts` の JSDoc、`application/note/accessControl.ts` の `placeholderWorkspaceAuthorization`、`storeAvatar.ts` の workspace 一律拒否、`createBlankNote.ts` の workspace 所有一律拒否） | Issue #3 コメント 3 + 現況調査 | 13 |
| AC-17 | `pnpm typecheck && pnpm lint:fix && pnpm format` が通り、`pnpm test` が全 project で緑 | `CLAUDE.md`「Development Commands」/ Issue 本文「検証」 | 19 |

## スコープ

### 含まれないもの

- **tag ドメイン全体**（`DOM-tag-*` / `ADP-tag-*` / `UC-tag-001〜011`）— Issue #8 の持ち分。
- **チェックリストからの見送り行（計 21 行）** — 後述「決定事項」の判断により Issue #8 へ送る。チェックは付けず、理由を Issue #3 にコメントで残す。
  - `UC-tag-012 relocateAssignmentsForNote`
  - `UC-tag-014 deleteTagsForScope`
  - `TC-tag-047〜058`（`deleteTagsForScope` 12 行）
  - `TC-tag-102〜108`（`relocateAssignmentsForNote` 7 行）
- 上記に連動して**判定から外す TC**: `TC-workspace-096` / `-097`（ワークスペース削除時のタグ掃除）、`TC-note-246` / `-247`（移動時のタグ付け替え）。行自体はチェックリストに残るが、tag 側が無いため本 Issue では満たせない。見送りとして同じコメントに記録する。
- ノート編集・検索・一括操作（Issue #7 / #8）、ジョブ管理 UI（#5）、外部連携（#4）、書き出し（#10）。`changeMemberRole` / `removeMember` / `leaveWorkspace` / `deleteWorkspace` が取り消すジョブは、既存の job ドメインの終端 API を呼ぶまでが本 Issue の範囲。
- ワークスペース以外のシナリオ（WS 以外の scenario 節、DS-02 以外の DS 節）。
- 既存コードのスコープ外リファクタリング。縮退実装の解除（AC-14〜16）は Issue コメントで本スライスに割り当てられているため例外。

## リスクと注意点

- **規模**: チェックリスト 516 行（うち 21 行は D-001 で見送り）に対し、workspace 関連の実装は現状ほぼゼロ（現況は steps.md「現況」節）。ポートだけで 72、アダプターメソッドで 60 ある。**PR は 1 本（D-002）**なので差分が大きくなる。コミットを steps.md のステップ境界で切り、各コミット時点で `pnpm typecheck` が通る順序を守ってレビュー可能性を確保する。
- **適合スイートは 2 バックエンドに効く**: `packages/core/src/adapters/conformance/backend.ts` の `ConformanceBackend` は memory（`adapters/memory/__tests__/conformanceBackend.ts`）と cloudflare（`adapters/cloudflare/__tests__/conformanceBackend.ts`）の双方が構築する。workspace ポートを `ConformanceBackend` に足すと Cloudflare 側（D1 スキーマ / DO リポジトリ）にも実装が必要になる。→ adr.md ADR-001。
- **縮退実装の解除が広く波及する**: `application/note/accessControl.ts` の `placeholderWorkspaceAuthorization` は `minimumRoleFor` / `can` / `ensureCan` の全てで throw する。これを実体に差し替えると note / storage / usage の既存テストの前提（`workspaceRole: null` 経路）が動く。既存テストの期待値更新が必要。
- **削除・移動は多段サガ**: `deleteWorkspace`（manifest 構築 → local edge 削除 → global cleanup → 縮約）と `moveNote`（snapshot → stage → route switch → retire）は recovery / 冪等性のテストケースが大量にある（TC-workspace-100〜116、TC-note-254〜269）。outbox の continuation transport（ADR 040 / 041）とスコープタスクの上に載せる必要があり、ワーカー側の実装漏れが最も起きやすい。
- **UoW ネスト禁止**: 招待受諾・メンバー除名・ワークスペース削除はいずれも global 制御面と scope 業務面の両方に触れる。ADR 023 のとおり `run` のネストは禁止で、境界外の書き込みは専用の atomic store ポート（`InvitationRouteStore` / `MembershipDirectoryReservationStore` / `WorkspaceOperationLockStore` / `WorkspaceDeletionManifestStore`）を通す。ポート分割はこの制約から来ているので、実装で束ねてはいけない。
- **フロントの三層**: `CLAUDE.md`「Frontend」のとおり、role 変更・招待取消・メンバー除名は一覧メンバーシップの変更なので item-local な `useOptimistic` では届かない。所有権を親のクライアントアイランドへ寄せる。
- **manual test の stale**: `spec/manual-tests/workspace.md` / `discovery.md` / `organize.md` が未実装前提の記述を含む場合、Phase 4 の動作検証が正しい実装を FAIL 判定する。実装ステップで手順書の齟齬を潰す。

## テスト方針

`docs/test.md` の層と命名に従う。チェックリストの TC 行がテストの正本で、ケース名の先頭に TC ID を置く規約を守る。

- **ドメイン単体**: 値オブジェクトの構築不変条件（slug の予約語・長さ、name の空・81 文字）、`WorkspaceAuthorization` / `MembershipPolicy`（最後の owner の降格・除名の禁止）。
- **ポート適合**: `packages/core/src/adapters/conformance/` に workspace 系スイートを新設し、既存の 2 バックエンドが同一に通ること（ADR 026）。`ADP-workspace-001〜060` はここで拘束する。
- **ユースケース単体・結合**: `TC-workspace-*` 267 件。正常系のほか、並行要求（TC-workspace-011 / 065）、応答喪失後の recovery（TC-workspace-003 / 020 / 054 / 067 / 103 / 115 / 244 / 258）、event の順不同到着（TC-workspace-045 / 235）を明示的に覆う。
- **周辺ドメイン**: `TC-note-238〜269`（moveNote 32 件）、`TC-tag-047〜058` / `TC-tag-102〜108`（19 件）、`TC-storage-134〜141`（8 件）。
- **フロント**: 対象ページの server function 入力検証（`validateInput`）と楽観 UI の巻き戻し。
- **手動**: `spec/manual-tests/workspace.md` / `discovery.md` / `organize.md` の対象シナリオ。

## 決定事項

### [D-001] tag ユースケース 2 件を見送り、Issue #8 へ送る（決定済み）

**背景:** Issue #3 のチェックリストは `UC-tag-014 deleteTagsForScope` と `UC-tag-012 relocateAssignmentsForNote`（＋ `TC-tag-*` 19 行）を含むが、tag ドメイン本体（`DOM-tag-001〜040`）と tag アダプター（`ADP-tag-001〜032`）は Issue #8 の持ち分で、`packages/core/src/domain/tag/` も `packages/core/src/application/tag/` も存在しない。Issue #3 の「依存」欄は #1 のみ。スライス生成が「そのユースケースを最初に必要とするスライス」に UC 行を割り当てた結果、ユースケースだけが依存より前倒しになっていた。

**決定:** 該当 21 行（`UC-tag-012` / `UC-tag-014` / `TC-tag-047〜058` / `TC-tag-102〜108`）を**本 Issue では見送る**。tag ドメインの先取り実装はしない。理由は Issue #3 のコメントとして残し、行は #8 で回収する。

**理由:** tag ドメインの最小部分を本 Issue に引き込むと #8 と実装が重複し、#8 側で作り直しになる。ワークスペース本体の 495 行を先に完結させるほうが、スライスの境界としても実装の見通しとしても素直。

**影響:**

- AC-12 から `TC-workspace-096` / `-097`（削除時のタグ掃除）を、AC-13 から `TC-note-246` / `-247`（移動時のタグ付け替え）を判定対象外にした（基準文に明記済み）。
- `deleteWorkspace` は `workspace.deleted` イベントを**発行するところまで**を本 Issue の責務とし、tag 側の消費は #8 で足す。`moveNote` も同様に、タグ再配置のフェーズを呼び出す口だけを残す。
- Issue #8 は tag 側でこの 21 行を引き取る前提になる。#8 着手時に本 Issue のコメントを参照できるようにしておく。

### [D-002] PR は 1 本にまとめる（決定済み）

**決定:** レイヤーごとに PR を分割せず、1 本の PR で提出する。

**影響:** plan.md「リスクと注意点」冒頭の「単一 PR では収まらない可能性が高く、レイヤー境界で分割する前提で進める」は取り消す。代わりに、レビュー可能性を保つためコミットをレイヤー境界（steps.md のステップ単位）で切り、実装中も `pnpm typecheck` が常に通る順序で進める。

### [D-003] `workspace.deleted` の購読者を見送り、ノートの消滅を AC-12 の判定から外す（決定済み）

**背景:** `deleteWorkspace` は多段サガを完走して `workspace.deleted` を発行するが、このイベントを購読する使い手が 1 つも存在しない。`spec/testcases/workspace/deleteWorkspace.md` は後始末を「`workspace.deleted` の購読ユースケース（`deleteNotesForOwner` / `deleteTagsForScope` / `deleteFilesByOwner` / `deleteQuota`）」に委ねると述べており、そのどれも本スライスには無い。

**決定:** `workspace.deleted` の購読者（`deleteNotesForOwner` 相当とその連鎖）を**本 Issue では見送る**。`TC-workspace-092`（公開ノートの URL が「見つかりません」）/ `-094`（ゴミ箱のノートも削除される）/ `-098`（バックアップ記録の削除）は**判定対象外**とする。実装は 1 行も足さない。

**理由:** 消費者は Issue #8（tag）と Issue #7（ノート編集・ゴミ箱）側の持ち分であり、本スライスの範囲は `workspace.deleted` の**発行まで**である（`.thread/3/steps.md` ステップ 11 が既にそう書いている）。D-001 と同じ境界の引き方で、先取り実装は後発スライスでの作り直しを招く。

**利用者から見た影響:** 今日はゼロ。ワークスペース削除後は membership が消えて認可が閉じるため、残ったノートは公開経路も含めてすべて 404 になる（公開投影へ書く経路自体が Issue #9 で未実装）。残るのは画面から到達できない不可視の残骸 — notes / revisions / 保管ファイル / quota 行である。

**但し書き（後発スライスへの申し送り）:** `workspace.deleted` は**購読者不在のまま ack され、outbox 行は剪定される**。したがって後から `deleteNotesForOwner` を足しても、**本スライス期間中に行われた削除を再駆動することはできない**。retired scope を走査して残骸を回収する**一度きりの掃除**が別途必要になる。この申し送りは `deleteNotesForOwner` を引き取る Issue に明記すること。

**影響:**

- AC-12 の基準文から「ノートの消滅」を外し、`TC-workspace-092` / `-094` / `-098` を判定対象外として明記した。判定はメンバーシップ・招待・公開ページの消滅と削除後の 404 で行う。
- `.thread/3/testing.md` の「本計画で扱わないもの」に同じ行を足し、項目 16 の確認ポイントに「手順 6 の 404 は認可が閉じた結果であって、ノート行が消えた証拠ではない」ことを明記した。
