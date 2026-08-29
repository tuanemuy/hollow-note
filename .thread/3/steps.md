# 実装手順 — Issue #3

## 現況

2026-08-29 時点の実装状況。Issue #1（skeleton）と #2（アカウント管理）が merge 済み。workspace は「型の器だけ」が置かれ、本体は本スライスへ先送りされている（コード中のコメントが #3 を名指ししている）。

| レイヤー | 状態 |
| --- | --- |
| `packages/core/src/domain/workspace/` | **部分実装（3 ファイル / 約 100 行）**。`valueObject.ts` に `WorkspaceId` と `WorkspaceRole`（owner > editor > viewer のランク＋`atLeast`）、`errorCode.ts` に `InvalidId` / `InvalidRole` / `InsufficientRole` の 3 コード、`services/workspaceAuthorization.ts` に `WorkspaceAction` union と `WorkspaceAuthorization` interface（実装なし）。 |
| domain 値オブジェクト残 | **未実装** — `MembershipId` / `InvitationId` / `WorkspaceSlug` / `WorkspaceName` / `WorkspaceDescription`。 |
| domain エンティティ | **未実装** — `Workspace` / `Membership` / `Invitation` のファイル自体が無い。 |
| domain ポート | **未実装** — `domain/workspace/ports/` ディレクトリが存在しない。11 ポート・72 メソッドすべて。識別子はリポジトリ全体で `spec/**` と `.thread/**` の Markdown にしか出現しない。 |
| domain サービス | `WorkspaceAuthorization` は interface のみ / `MembershipPolicy` は未実装。 |
| `adapters/memory/repositories/` | **未実装** — 27 ファイル中に workspace / membership / invitation 系は 0 件。 |
| `adapters/conformance/` | **未実装** — 35 ファイル中に workspace 系スイートは 0 件。 |
| `adapters/cloudflare/` | **未実装** — D1 / DO いずれにも workspace 系リポジトリ無し。 |
| `application/workspace/` | **ディレクトリごと未実装** — 20 ユースケースと `view.ts` すべて。 |
| `apps/web/app/routes/` | **未実装** — 全 23 ルートは auth / notes / settings / 静的ページのみ。P-06 / P-30 / P-31 / P-32 / P-33 / P-34 / P-43 はいずれも無い。 |
| テスト | **未実装** — workspace 専用テストは 0 件。周辺に拒否ケースが 1〜2 件あるのみ。 |
| 既存基盤（利用可能） | `application/scope.ts` の `ScopeKey.workspace` / `StorageOwner.workspace` / `NoteOwner.workspace` / `QuotaSubject.fromStorageOwner`、`application/ports/noteMovePort.ts`、`application/ports/noteRouteStore.ts`、`adapters/conformance/backend.ts` の `ConformanceBackend`。 |
| **未実装の主な塊** | (1) domain ポート 72 と memory アダプター 60、(2) 20 ユースケース、(3) 7 ページ、(4) TC 326 件。 |

### 縮退実装（本 Issue で本来の契約へ戻す 5 箇所）

- `packages/core/src/application/note/accessControl.ts` — `placeholderWorkspaceAuthorization` が `minimumRoleFor` / `can` / `ensureCan` の全てで `SystemError(DataIntegrityError, "... is not implemented in this slice")` を throw。`viewerFor()` は常に `workspaceRole: null`。**最大の差し替えポイント**。
- `packages/core/src/application/storage/storeAvatar.ts:70` — `subjectType === "workspace"` を一律 `insufficientRole()` で拒否。
- `packages/core/src/application/usage/recalculateStorageUsage.ts:41` — `subjectType === "user"` のときだけ actor 一致を検査し、`"workspace"` は無検査で素通り（fail-open の認可ホール）。同 `:33` の JSDoc が縮退を述べている。
- `packages/core/src/application/note/createBlankNote.ts:180` — workspace 所有の作成要求を `NotFoundError("WORKSPACE_NOT_FOUND")` で一律拒否。
- `packages/core/src/application/usage/getUsageSnapshot.ts:55` — `workspaces: []`（`readonly never[]`）固定で、`workspaceCursor` / `workspaceLimit` が入力に無い。

## 設計

本 Issue は spec-slice。設計は既にレビュー済みで、**ここでは定義場所を指すだけ**とする。DTO のフィールド・エラー分岐・境界値・処理手順は spec が持つ範囲を実装フェーズがコードを読んで決める。

### ドメインモデルへの影響

- 値オブジェクト: `spec/domains/workspace.md#値オブジェクト`（`WorkspaceId / MembershipId / InvitationId`、`WorkspaceSlug`、`WorkspaceName`、`WorkspaceDescription`、`WorkspaceRole` の各節）
- エンティティ: `spec/domains/workspace.md#エンティティ`（`Workspace`（集約ルート） / `Membership` / `Invitation`）
- ドメインサービス: `spec/domains/workspace.md#ドメインサービス`（`WorkspaceAuthorization` / `MembershipPolicy`）
- ポート: `spec/domains/workspace.md#ポート`（`WorkspaceRepository` / `MembershipRepository` / `InvitationRepository` ほか）。メソッド単位の振る舞いの要点は `spec/inventory/adapter.md`（`ADP-workspace-001〜060`）と `spec/inventory/domain.md`（`DOM-workspace-001〜072`）。
- ドメインイベント / エラーコード: `spec/domains/workspace.md#ドメインイベント` / `#エラーコード`
- スコープ境界と UoW の二面: `spec/domains/index.md#ScopeKey-と永続化境界`、[ADR 021](../../spec/adr/021-scope-sharded-data-plane.md)、[ADR 023](../../spec/adr/023-two-plane-unit-of-work.md)

### ユースケース / アプリケーションロジック

`spec/usecases/workspace.md` の 20 節（`spec/usecases/workspace.md#共通:-scope-storage-と-global-directory` が全体の前提）。周辺 3 件は `spec/usecases/note.md#moveNote`、`spec/usecases/storage.md#relocateFilesForNote`、`spec/usecases/tag.md#relocateAssignmentsForNote` / `#deleteTagsForScope`。イベント配送は `CLAUDE.md`「Outbox / domain events」と [ADR 040](../../spec/adr/040-continuation-transport.md) / [ADR 041](../../spec/adr/041-deterministic-continuation-event-id.md)。

### アダプター / 永続化 / 外部連携

`packages/core/src/adapters/memory/` が参照バックエンド（[ADR 024](../../spec/adr/024-in-memory-adapter-as-first-class-backend.md)）。契約の正本はポート JSDoc、その実行可能形が `packages/core/src/adapters/conformance/`（[ADR 026](../../spec/adr/026-port-contract-and-conformance.md)）。物理スキーマの設計は `spec/database/`・`spec/platform/index.md`。Cloudflare 側の扱いは adr.md ADR-001。

### UI / プレゼンテーション

`spec/pages/index.md` の P-06（201 行〜） / P-30（500 行〜） / P-31（509 行〜） / P-32（518 行〜） / P-33（544 行〜） / P-34（553 行〜） / P-43（593 行〜）、および P-10 / P-11 の該当操作。挙動の分担は `spec/inventory/frontend.md` の `PAGE-p*` 行。実装パターンは `docs/frontend_implementation_example.md`、三層の分担と所有権は `CLAUDE.md`「Frontend」。

### 既存ドキュメントへの影響

- `spec/manual-tests/workspace.md` / `discovery.md` / `organize.md` — 実装後の実際の画面・文言と手順が食い違う箇所を更新する（Phase 4 の動作検証が正しい実装を FAIL 判定しないように）。
- `spec/inventory/*.md` の該当行は本 Issue で新設するものではなく、既存の台帳をそのまま満たす。台帳側の記述が実装と食い違ったら `spec/` を直す（`CLAUDE.md`「Design canon」）。

## 実装ステップ

チェックリスト行をレイヤーの依存順に束ね直したもの。個々の行は Issue #3 本文で引ける。

### 1. workspace 値オブジェクトとエンティティ

- **対象ファイル:** `packages/core/src/domain/workspace/valueObject.ts`（既存を拡張）、`packages/core/src/domain/workspace/workspace.ts`、`membership.ts`、`invitation.ts`、`errorCode.ts`（既存を拡張）、`events.ts`
- **台帳 ID:** `DOM-workspace-001〜010`
- **spec:** `spec/domains/workspace.md#値オブジェクト` / `#エンティティ` / `#ドメインイベント` / `#エラーコード`
- **変更内容:** 既存の `WorkspaceId` / `WorkspaceRole` に `MembershipId` / `InvitationId` / `WorkspaceSlug` / `WorkspaceName` / `WorkspaceDescription` を足し、3 集約ルートを追加する。`errorCode.ts` の 3 コード限定（「full enum lands with the Workspace domain slice (#3)」）を spec の全コードへ広げる。
- **理由:** 以降の全レイヤーがこの語彙に依存する。

### 2. ドメインサービス（WorkspaceAuthorization / MembershipPolicy）

- **対象ファイル:** `packages/core/src/domain/workspace/services/workspaceAuthorization.ts`（interface に実装を追加）、`services/membershipPolicy.ts`
- **台帳 ID:** `DOM-workspace-011〜012`
- **spec:** `spec/domains/workspace.md#ドメインサービス`、[ADR 004](../../spec/adr/004-workspace-roles.md)
- **変更内容:** interface のみの `WorkspaceAuthorization` に実体を与える。`MembershipPolicy` に最後の owner の保護（WS-05 / WS-06 の異常系）を置く。
- **理由:** ステップ 13 の縮退解除がこの実体を待っている。

### 3. リポジトリ系ポート定義

- **対象ファイル:** `packages/core/src/domain/workspace/ports/`（新設）— `workspaceRepository.ts`、`userWorkspaceDirectory.ts`、`workspaceDirectoryBatchReader.ts`、`publicWorkspaceDirectoryReader.ts`、`membershipRepository.ts`、`invitationRepository.ts`
- **台帳 ID:** `DOM-workspace-013〜036`
- **spec:** `spec/domains/workspace.md#ポート`、`spec/inventory/domain.md`
- **変更内容:** ポート interface とライブラリレベル JSDoc（＝契約の正本）を書く。
- **理由:** 契約を先に固めないと適合スイートが書けない。

### 4. サガ / ロック / manifest 系ポート定義

- **対象ファイル:** `packages/core/src/domain/workspace/ports/invitationRouteStore.ts`、`membershipDirectoryReservationStore.ts`、`membershipRemovalPreparationStore.ts`、`workspaceOperationLockStore.ts`、`workspaceDeletionManifestStore.ts`
- **台帳 ID:** `DOM-workspace-037〜072`
- **spec:** `spec/domains/workspace.md#ポート`、[ADR 023](../../spec/adr/023-two-plane-unit-of-work.md)（UoW の外に置く書き込み）
- **変更内容:** reserve / activate / abandon / consume の予約サガ、除名準備ロック、削除 manifest の各契約を JSDoc で明文化する。冪等性・応答喪失時の再実行可能性をここで規定する。
- **理由:** `deleteWorkspace` / `acceptInvitation` / `removeMember` の recovery テスト群（TC-workspace-003 / 019 / 020 / 103 / 115 ほか）はこの契約に直接ぶら下がる。

### 5. memory アダプター — リポジトリ系＋適合スイート

- **対象ファイル:** `packages/core/src/adapters/memory/repositories/`（新規 6 ファイル前後）、`packages/core/src/adapters/memory/store.ts`、`packages/core/src/adapters/conformance/`（新規スイート）、`packages/core/src/adapters/conformance/backend.ts`、各 `__tests__/conformanceBackend.ts`
- **台帳 ID:** `ADP-workspace-001〜024`
- **spec:** `spec/inventory/adapter.md`、[ADR 026](../../spec/adr/026-port-contract-and-conformance.md)
- **変更内容:** ポート実装と、ケース名の先頭に ADP ID を置く適合スイートを対で足す。
- **理由:** 契約の実行可能形。adr.md ADR-001 の判断に従い Cloudflare 側も同時に扱う。

### 6. memory アダプター — サガ / ロック / manifest 系＋適合スイート

- **対象ファイル:** ステップ 5 と同じ場所（新規 5 ファイル前後）
- **台帳 ID:** `ADP-workspace-025〜060`
- **spec:** `spec/inventory/adapter.md`
- **変更内容:** 予約・活性化・放棄・消費の各遷移と、lease 満了後の再取得を実装する。
- **理由:** 同上。

### 7. ユースケース — 読み取り / アクセス解決

- **対象ファイル:** `packages/core/src/application/workspace/`（新設）— `resolveWorkspaceAccess.ts`、`listUserWorkspaces.ts`、`listMembers.ts`、`listPublicWorkspaces.ts`、`getPublicWorkspace.ts`、`view.ts`
- **台帳 ID:** `UC-workspace-001` / `-013` / `-015` / `-019` / `-020`
- **spec:** `spec/usecases/workspace.md` の同名節、`spec/usecases/workspace.md#共通:-scope-storage-と-global-directory`
- **変更内容:** DTO 射影は `view.ts` に置く。directory の keyset ページングと shard 分散・部分失敗（TC-workspace-195〜201 / 176 / 188 / 189）を扱う。
- **理由:** 他のユースケースとフロント全体がここに依存する。

### 8. ユースケース — ワークスペースのライフサイクル（作成・設定・公開）

- **対象ファイル:** `application/workspace/createWorkspace.ts`、`updateWorkspaceProfile.ts`、`changeWorkspaceSlug.ts`、`publishWorkspace.ts`、`unpublishWorkspace.ts`
- **台帳 ID:** `UC-workspace-002〜006`
- **spec:** `spec/usecases/workspace.md#createWorkspace` / `#updateWorkspaceProfile` / `#changeWorkspaceSlug` / `#publishWorkspace` / `#unpublishWorkspace`
- **変更内容:** slug 予約サガ（予約 → local commit → global 切替）と、所有上限 20 件（pending を含む）の判定を実装する。
- **理由:** WS-01 / WS-07 / WS-08。

### 9. ユースケース — 招待

- **対象ファイル:** `application/workspace/inviteMember.ts`、`resendInvitation.ts`、`revokeInvitation.ts`、`getInvitationPreview.ts`、`acceptInvitation.ts`、`listPendingInvitations.ts`
- **台帳 ID:** `UC-workspace-008〜012` / `-014`
- **spec:** `spec/usecases/workspace.md` の同名節
- **変更内容:** token hash による route 解決、14 日の有効期限、24 時間あたり 50 件の発行上限、受諾時の membership edge 予約 → 活性化。
- **理由:** WS-03 / WS-04。

### 10. ユースケース — メンバーシップの変更

- **対象ファイル:** `application/workspace/changeMemberRole.ts`、`removeMember.ts`、`leaveWorkspace.ts`
- **台帳 ID:** `UC-workspace-016〜018`
- **spec:** `spec/usecases/workspace.md#changeMemberRole` / `#removeMember` / `#leaveWorkspace`
- **変更内容:** `MembershipPolicy`（最後の owner の保護）の適用、未終端ジョブの取り消し（100 件単位の継続要求）、directory への role イベント伝播と後着イベントの扱い。
- **理由:** WS-05 / WS-06。

### 11. ユースケース — ワークスペース削除

- **対象ファイル:** `application/workspace/deleteWorkspace.ts`、関連ワーカー（`application/workers/` / `application/cleanup/`）
- **台帳 ID:** `UC-workspace-007`
- **spec:** `spec/usecases/workspace.md#deleteWorkspace`
- **変更内容:** 名前確認 → `beginDeletion` → manifest 構築 → local edge 削除 → global cleanup → ack 縮約 → `markCompleted` の多段サガ。`workspace.deleted` イベントの**発行**まで。
- **見送り:** `UC-tag-014 deleteTagsForScope` と `TC-tag-047〜058` は本 Issue の対象外（plan.md 決定事項 D-001 / adr.md ADR-002）。`TC-workspace-096` / `-097`（タグ掃除）も判定対象から外す。`workspace.deleted` の消費者は Issue #8 で足す。
- **理由:** WS-10。

### 12. ユースケース — ノート移動

- **対象ファイル:** `application/note/moveNote.ts`、`application/storage/relocateFilesForNote.ts`、`application/ports/noteMovePort.ts`（既存）
- **台帳 ID:** `UC-note-013`、`UC-storage-011`
- **spec:** `spec/usecases/note.md#moveNote`、`spec/usecases/storage.md#relocateFilesForNote`
- **変更内容:** `snapshotSource` → `stageTarget` → route switch → `retireSource` の 4 フェーズを migration ID で冪等化する。移動元・移動先の両方で editor 以上を再認可し、確定時点の除名を検出する。タグ再配置は同じ 4 フェーズを呼ぶ口だけを残す。
- **見送り:** `UC-tag-012 relocateAssignmentsForNote` と `TC-tag-102〜108` は本 Issue の対象外（D-001 / ADR-002）。`TC-note-246` / `-247`（タグ付け替え）も判定対象から外す。
- **理由:** OR-12。

### 13. 縮退実装の解除

- **対象ファイル:** `packages/core/src/application/note/accessControl.ts`、`application/storage/storeAvatar.ts`、`application/usage/recalculateStorageUsage.ts`、`application/usage/getUsageSnapshot.ts`、`application/note/createBlankNote.ts`、および影響を受ける既存テスト
- **台帳 ID:** チェックリスト外（Issue #3 コメントの 3 件＋現況調査の 2 件）。`UC-usage-001`・`PAGE-p24-001/002` の再オープンを伴う。
- **spec:** `spec/usecases/usage.md`、`spec/pages/index.md#P-24`、`spec/domains/workspace.md#ドメインサービス`、[ADR 046](../../spec/adr/046-port-contract-divergence.md)
- **変更内容:** `placeholderWorkspaceAuthorization` を実体へ差し替え、`viewerFor()` が実 role を返すようにする。`storeAvatar` の workspace 一律拒否と `createBlankNote` の workspace 所有一律拒否を本来の認可判定へ戻す。`recalculateStorageUsage` の workspace subject に membership 検査を入れ、縮退を述べた JSDoc を落とす。`getUsageSnapshot` に `workspaceCursor` / `workspaceLimit` / `workspaces` / `nextWorkspaceCursor` を戻す。
- **理由:** AC-14〜16。fail-open の認可ホールが 1 件含まれる。

### 14. フロント — ワークスペース設定系ページ（P-30 / P-31 / P-33 / P-34）＋スコープトークン

- **対象ファイル:** `apps/web/app/routes/`（新規）、`apps/web/app/components/workspace/`（新規）、既存のスコープトークン / ナビゲーション
- **台帳 ID:** `PAGE-p30-001〜002`、`PAGE-p31-001〜004`、`PAGE-p33-001〜003`、`PAGE-p34-001〜003`
- **spec:** `spec/pages/index.md#P-30` / `#P-31` / `#P-33` / `#P-34`、`spec/inventory/frontend.md`
- **変更内容:** 作成・一般設定（profile / slug / icon）・公開設定・削除の各ページ。WS-02 の文脈切替（URL 反映・再訪時の引き継ぎ・切替時の絞り込み解除）もここ。
- **理由:** WS-01 / WS-02 / WS-07 / WS-08 / WS-10 / DS-02。

### 15. フロント — メンバー管理（P-32）と招待確認（P-06）

- **対象ファイル:** `apps/web/app/routes/`（新規）、`apps/web/app/components/workspace/`
- **台帳 ID:** `PAGE-p32-001〜008`、`PAGE-p06-001〜005`
- **spec:** `spec/pages/index.md#P-32` / `#P-06`
- **変更内容:** 招待発行・リンクコピー・再送・取消・role 変更・除名・脱退、および招待 preview / 受諾 / 辞退と「認証して招待へ復帰」。
- **注意:** 招待の取消・メンバー除名は**一覧メンバーシップの変更**なので、所有権を親のクライアントアイランドへ寄せる（`CLAUDE.md`「Frontend」）。
- **理由:** WS-03 / WS-04 / WS-05 / WS-06。

### 16. フロント — 公開ページ（P-43）とノート移動の導線（P-10 / P-11）

- **対象ファイル:** `apps/web/app/routes/`（公開ページ）、既存のノート一覧・詳細コンポーネント
- **台帳 ID:** `PAGE-p43-001〜003`、`PAGE-p10-007` / `-015` / `-016`、`PAGE-p11-007` / `-009` / `-014`
- **spec:** `spec/pages/index.md#P-43` / `#P-10` / `#P-11`
- **変更内容:** 未サインインで閲覧できるワークスペース公開ページ（検索・タグ絞込・公開ノートへの遷移、メンバーが開いた場合の外部向け表示バナー）と、ノート詳細の「移動」導線（移動先候補は editor 以上のワークスペースのみ）。
- **理由:** WS-09 / DS-02 / OR-12。

### 17. テスト — workspace

- **対象ファイル:** `packages/core/src/domain/workspace/__tests__/`、`packages/core/src/application/workspace/__tests__/`
- **台帳 ID:** `TC-workspace-001〜274`（267 行）
- **spec:** `spec/testcases/workspace/` の 21 ファイル、`docs/test.md`
- **変更内容:** ユースケース単位でファイルを分け、ケース名の先頭に TC ID を置く。
- **理由:** AC-1 / AC-2〜12。

### 18. テスト — 周辺ドメイン（note / tag / storage）

- **対象ファイル:** `packages/core/src/application/note/__tests__/moveNote.test.ts`、`application/storage/__tests__/relocateFilesForNote.test.ts`
- **台帳 ID:** `TC-note-238〜269`（32。ただし `-246` / `-247` は見送り）、`TC-storage-134〜141`（8）
- **spec:** `spec/testcases/note/moveNote.md`、`spec/testcases/storage/relocateFilesForNote.md`
- **見送り:** `TC-tag-047〜058` / `TC-tag-102〜108`（19）は本 Issue の対象外（D-001 / ADR-002）。
- **理由:** AC-13。

### 19. 仕上げ — 手順書の同期と全体検証

- **対象ファイル:** `spec/manual-tests/workspace.md`、`spec/manual-tests/discovery.md`、`spec/manual-tests/organize.md`、必要なら `spec/inventory/*.md`
- **変更内容:** 実装後の実画面と手順・期待結果の齟齬を潰す。`pnpm typecheck && pnpm lint:fix && pnpm format` を通し、`pnpm test`（`test:node` / `test:workers` の両 project）を緑にする。Issue #3 のチェックリストのうちレビューで確認できた行にチェックを付け、D-001 の見送り 21 行（＋判定対象外の `TC-workspace-096` / `-097` / `TC-note-246` / `-247`）は理由を Issue #3 のコメントに残す。
- **理由:** AC-17 と Issue 本文「完了条件」「検証」。
