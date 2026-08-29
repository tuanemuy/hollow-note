# ADR — Issue #3: ワークスペースとメンバーを管理・公開する

## ADR-001: workspace ポートの適合対象バックエンドを memory と Cloudflare の両方とする

### Context

チェックリストの `ADP-workspace-001〜060` は 1 行 = 1 ポートメソッドで、`spec/inventory/adapter.md` の生成規約どおりプロバイダー名を持たない。一方リポジトリには適合バックエンドが 2 つある。

- `packages/core/src/adapters/memory/__tests__/conformanceBackend.ts`
- `packages/core/src/adapters/cloudflare/__tests__/conformanceBackend.ts`

両者は `packages/core/src/adapters/conformance/backend.ts` の `ConformanceBackend` を構築する。workspace の 11 ポートをこの型へ足すと、Cloudflare 側（D1 の global スキーマ、scope Durable Object のリポジトリ）にも実装義務が生じる。60 メソッド分を Cloudflare にも書くか、参照ランタイム（Node + memory、[ADR 025](../../spec/adr/025-single-reference-runtime.md)）だけに閉じるかは、チェックリストからは決まらない。

選択肢:

1. memory のみ実装し、`ConformanceBackend` の workspace 部分を optional にする
2. memory と Cloudflare の両方に実装する
3. workspace 用に別の適合バックエンド型を切る

### Decision

**2 を採る。**[ADR 026](../../spec/adr/026-port-contract-and-conformance.md) が「every backend imports the same suites and must pass them identically」と定めており、1 は適合スイートの意味（同一契約が全バックエンドで成り立つことの保証）を壊す。3 は台帳が 1 行 = 1 ポートメソッドで割れていない以上、正当化する根拠が spec 側に無い。Issue #11（Cloudflare アダプター）が既に merge 済みで、workspace だけを対象外にすると次スライス以降で穴が拡大する。

### Consequences

- 良い点: 適合スイートが 2 バックエンドで同一に走り続ける。ADR 026 / ADR 025 のどちらにも矛盾しない。
- トレードオフ: 実装量が増える。D1 の global スキーマと DO 側の scope スキーマにマイグレーションを足す必要があり、Issue の規模見積もりが実質 1.5〜2 倍になる。plan.md の「リスク」に規模として記載済み。
- 反証条件: `ConformanceBackend` が実際には各バックエンドで部分構築できる形（メソッド単位の optional / スイートごとの opt-in）になっていた場合、この判断は不要になる。実装フェーズの最初に `backend.ts` と各 `conformanceBackend.ts` を読んで確かめる。

---

## ADR-002: tag ユースケース 2 件（UC-tag-012 / UC-tag-014）を本 Issue では実装せず、Issue #8 へ送る

### Context

Issue #3 のチェックリストは `UC-tag-014 deleteTagsForScope`（`workspace.deleted` の消費）と `UC-tag-012 relocateAssignmentsForNote`（ノート移動時のタグ付け替え）、および `TC-tag-*` 19 行を含む。しかし tag ドメイン本体は Issue #8 の持ち分で（`DOM-tag-001〜040` / `ADP-tag-001〜032` / `UC-tag-001〜011` はすべて #8 の本文にある）、#8 は #7 に依存する。現状 `packages/core/src/domain/tag/` も `packages/core/src/application/tag/` も存在しない。Issue #3 の「依存」欄は #1 のみ。

つまり、スライス生成が「そのユースケースを最初に必要とするスライス」に UC 行を割り当てた結果、tag のユースケースだけが依存より先に来ている。

検討した選択肢:

- (a) tag ドメインの最小部分（`Tag` / `TagAssignment` と `TagRepository` 相当）を本 Issue に引き込み、2 ユースケースを実装する
- (b) 該当 2 行と `TC-tag-*` 19 行を見送り、理由を Issue コメントに残して #8 へ送る

### Decision

**(b) を採る。**該当 21 行（`UC-tag-012` / `UC-tag-014` / `TC-tag-047〜058` / `TC-tag-102〜108`）は本 Issue では実装せず、Issue #8 で回収する。

(a) は tag ドメインの設計（`spec/domains/tag.md` の 40 の DOM 行）を #8 に先んじて 2 ユースケース分だけ切り出すことになり、必要最小限の切り出し方を決めるのは #8 の設計判断そのもの。ここで先に固めると #8 で作り直しになる公算が大きく、スライス境界を壊した分の負債だけが残る。ワークスペース本体（495 行）は tag が無くても完結するので、(b) の損失は限定できる。

`deleteWorkspace` は `workspace.deleted` イベントを**発行するところまで**を本 Issue の責務とし、消費側（tag の掃除）は #8 で足す。`moveNote` も同様に、タグ再配置フェーズを呼ぶ口だけを残して実体は #8 に委ねる。

### Consequences

- 良い点: スライス境界を保てる。#8 の tag 設計が本 Issue の都合で歪まない。ワークスペースの 495 行に集中でき、1 本の PR（plan.md D-002）の差分も抑えられる。
- トレードオフ: 本 Issue のチェックリスト 21 行が未達のまま残る。加えて `TC-workspace-096` / `-097`（削除時のタグ掃除）と `TC-note-246` / `-247`（移動時のタグ付け替え）が判定できず、AC-12 / AC-13 がその分だけ縮む（両 AC の基準文に明記済み）。
- 影響範囲: 見送り行はチェックを付けず、理由を Issue #3 のコメントに残す（Issue 本文「完了条件」の指示どおり）。Issue #8 側はこの 21 行を引き取る前提になるため、着手時に本コメントを参照できるようにする。`workspace.deleted` を発行しても消費者が居ない状態が #8 まで続くが、outbox は at-least-once で消費者不在を許容するため運用上の破綻はない。

## ADR-003: `Workspace.create` に `ownerId` を渡し、`avatarUrl` を `AvatarUrl` 型で運ぶ

### Context

`spec/domains/workspace.md` の 2 箇所が、同じ文書の別の節および既存の canon と食い違っていた。

1. 振る舞い表の `create` は `params: { id, name, description, slug }` だが、ドメインイベント表の `workspace.created` の payload は `{ workspaceId, ownerId }` であり、同表は create がそのイベントを発行すると述べている。与えられた引数だけでは payload を組めない。
2. エンティティ定義の `avatarUrl` は `string | null` だが、[ADR 051](../../spec/adr/051-same-origin-url-predicate.md) は「自オリジンに限る URL は値オブジェクト型で運び、集約のメソッドが生の文字列を受けない形にする」を決めている。`domain/identity/user.ts` の `User.avatarUrl` は `AvatarUrl | null` で、workspace のアイコンも同じ `storeAvatar` 経路を通り公開ページに出る。

### Decision

- `Workspace.create` の params に `ownerId: UserId` を足す。イベント発行元が集約である以上、payload に必要な値は引数で渡す。
- `Workspace.avatarUrl` を `AvatarUrl | null`、`Workspace.updateProfile` の `avatarUrl` を `AvatarUrl | null`（構築済み VO）とする。生値からの構築は `AvatarUrl.create(raw, appUrl)` を呼べるユースケース側に閉じる。再水和は ADR 051 のとおり「書き込み時に検証済み」としてキャストで通す。
- `spec/domains/workspace.md` の該当 2 行を実装に合わせて直し、理由を同節に 1 段落で残す。

### Consequences

- `createWorkspace` ユースケース（ステップ 8）は `Workspace.create` に actor の `UserId` を渡す。所有者は作成時に必ず決まっているので追加の読み取りは要らない。
- `updateWorkspaceProfile` ユースケース（ステップ 8）と `storeAvatar` の縮退解除（ステップ 13）は `AvatarUrl.create` を呼んでから集約へ渡す。`appUrl` は既に DI 済みの app config から取れる。
- workspace ドメインが `domain/identity/valueObject` の `AvatarUrl` に依存する。`UserId` / `Email` / `TokenHash` で既にある依存方向なので新しい辺は増えない。

## ADR-004: workspace ドメインイベントの `aggregateId` を一律 `WorkspaceId` とする

### Context

`domain/common/event.ts` の `DomainEventDraftBase` は `aggregateId: string` を要求する。既存ドメインは集約ルートの ID を入れている（note は `NoteId`、identity は `UserId` / `IdentityId`）。workspace は集約ルートが 3 つあるが、`workspace.membership.added` / `.roleChanged` / `.removed` の payload は spec 上 `{ workspaceId, userId, ... }` で `MembershipId` を含まない。集約ルートの ID を入れる規約をそのまま当てると、payload に無い値を factory 引数として別途受け渡すことになる。

### Decision

workspace ドメインの全イベント（`workspace.*` / `workspace.membership.*` / `workspace.invitation.*`）の `aggregateId` を `WorkspaceId` とする。理由を `domain/workspace/events.ts` の `WorkspaceEvents` に JSDoc で残す。

### Consequences

- 3 集約すべてが同じ workspace scope に属するので、outbox 行を workspace 単位で辿れる。
- membership / invitation 単位で outbox を絞りたくなった場合は payload の `userId` / `invitationId` を見る必要がある。`aggregateId` は診断とグルーピングにしか使われておらず（`application/ports/outboxRepository.ts`）、配送やイベント順序には効かないため実害はない。

## ADR-005: `SLUG_ALREADY_USED` を `WorkspaceRepository` の契約に含めない

### Context

`spec/domains/workspace.md#ポート` の Workspace 群のエラーケースは `ConflictError("SLUG_ALREADY_USED")` を挙げる。一方 slug の一意性は global D1 の `workspace_slug_reservations` が担い（`spec/usecases/workspace.md` の `createWorkspace` 手順 2 / `changeWorkspaceSlug` 手順 2）、`WorkspaceRepository` は current workspace scope に束縛されて自 scope の 1 行しか見えない。台帳 `DOM-workspace-013〜072` に slug reservation のポートは存在せず、このエラーを投げる主体がポートとして定義されていない。

### Decision

`WorkspaceRepository` の error contract は `OPTIMISTIC_LOCK_FAILURE` / `DatabaseError` の 2 つとし、`SLUG_ALREADY_USED` は「scope UoW の外で取る global な slug 予約から返る」と JSDoc に明記して自ポートの契約から外す。適合スイート（ステップ 5）は `WorkspaceRepository` に対してこのエラーを検査しない。

### Consequences

- scope 束縛のリポジトリにサービス全体の一意制約を持たせずに済み、memory / Cloudflare の両アダプターが同じ実装で適合できる。
- slug 予約のポートは spec に未定義のまま残る。ステップ 8（`createWorkspace` / `changeWorkspaceSlug`）で予約サガを書く時点でポートを新設する必要があり、その際は `spec/domains/workspace.md#ポート` と台帳への追記も要る。

## ADR-006: `listByWorkspace` の並び順を JSDoc で固定する

### Context

`MembershipRepository.listByWorkspace` / `InvitationRepository.listByWorkspace` は spec が `Pagination` / `PaginationResult` とだけ定めており、並び順の記述がない。テストケース（`spec/testcases/workspace/listMembers.md` / `listPendingInvitations.md`）にも順序の期待はない。しかし両者は offset ページングであり、削除 manifest がこの列挙を通って対象を固定する（`spec/domains/workspace.md#ポート`）ため、全順序でなければページ間で行が重複・欠落し、membership が消し残る。

### Decision

`MembershipRepository.listByWorkspace` を `joinedAt ASC, id ASC`、`InvitationRepository.listByWorkspace` を `createdAt DESC, id DESC` に固定し、id による tie-break が全順序を作るためであることを JSDoc に書く（`NoteRepository.listByOwner` と同じ書き方）。

### Consequences

- 適合スイートが順序を検査できる。並び順は契約なので、後からアダプター都合で変えられない。
- メンバーは参加順（作成者が先頭）、招待は新しい順という UI 上の既定が決まる。spec 側に順序の記述がないため、ページ設計が別の順序を要求した場合は spec とこの JSDoc の両方を直すことになる。

## ADR-007: lease を持つロックは単調更新・自動失効なしを契約にする

### Context

`MembershipRemovalPreparationStore` と `MembershipDirectoryReservationStore` の prepare 系は lease を持つが、spec は `MembershipRemovalPreparationStore` について「期限を過ぎた prepared lock も自動で無効にせず、安全側に拒否する」「global recovery だけが renew / release する」とだけ書き、`renew` に同じ instant や過去の instant が渡った場合の扱いを定めていない。応答喪失の再送は順序が保証されないため、`expires_at` を無条件に代入する実装では replay が生きている lease を縮めうる。

### Decision

lease を持つ全メソッド（`prepare` / `renew` / `prepareAccountDeletion` / `renewAccountDeletion`）で、保存される期限は既存値と引数の**遅い方**とする（単調更新）。あわせて、期限切れが所有権を移すことは決してなく、他 operation のロックは lapsed でも `ConflictError` とする規則を両ポート共通で JSDoc に書く。

### Consequences

- 適合スイートが「古い instant の renew を replay しても lease が縮まない」を検査できる。
- lease の回収は必ず recovery の `release` を経由するので、クラッシュした orchestrator のロックは自動では消えない。回収経路が動かない限りメンバー変更が拒否され続ける点は、安全側に倒した代償として受け入れる。

## ADR-008: route / edge を閉じる操作は対象行が無くても成功させる

### Context

`InvitationRouteStore.revoke` / `consume` / `abandon`、`MembershipDirectoryReservationStore.abandon` / `commitAccountDeletion` は、いずれも「応答を失ったら同じ operation ID で再試行する」経路にある（`spec/testcases/workspace/acceptInvitation.md` の「consume の応答を失う → 既に revoked なら成功する」）。しかし対象行が既に消えている場合（別経路が先に閉じた、commit が実は成功していた）に `NotFoundError` を返すと、recovery ループが終わらない。

### Decision

閉じる方向の操作は**目的状態に対して冪等**とし、対象行が既に終端状態でも、行そのものが存在しなくても成功とする。競合として拒否するのは「別の対象を指している」場合（`invitationId` 不一致、別 operation が保持中）だけに限る。逆に開く方向（`activate` / `activateReplacement`）は行が無ければ `ConflictError` とし、閉じた route を決して再び active にしない。

### Consequences

- recovery が前進のみで収束し、`revoke` と `consume` は互いの結果を受け入れる（先に閉じた方が勝ち、後から来た方も成功）。
- 存在しない tokenHash への `revoke` が成功として返るため、呼び出し側の取り違えはこのポートでは検出できない。正データ側（workspace scope の Invitation）が唯一の記録である点を JSDoc に明記した。

## ADR-009: `InvitationRouteStore.reserve` の `expiresAt` は招待自身の期限とする

### Context

`invitation_routes` は `expires_at` を 1 列しか持たず（`spec/database/index.md`）、`reserved` 中の予約 TTL と `active` 後の route 有効期限を兼ねる。spec は `reserve(input: { …; expiresAt })` の意味を定義していない。短い予約 TTL を渡すと activate 後に route が即座に解決しなくなり、招待の 14 日を再設定する手段が無い。

### Decision

`reserve` / `reserveReplacement` に渡す `expiresAt` は Invitation の `expiresAt`（発行から 14 日）とし、activate 前は予約の失効、activate 後は route の失効として同じ値が働くと JSDoc に書く。孤児化した `reserved` 行は、同じ operation ID の workspace-local Invitation と突き合わせる期限切れ recovery が回収する。

### Consequences

- `resolveActive` は「`active` かつ未期限切れ」だけを解決すればよく、Invitation 側の期限判定と二重管理にならない。
- 予約が失敗したまま放置された行は最長 14 日残る。tokenHash は毎回新規なので他の発行を妨げず、回収は recovery の走査に委ねる。

## ADR-010: 削除 manifest の cursor は最適化であり、古い cursor からの再走を契約上安全にする

### Context

`WorkspaceDeletionManifestStore` には header を読むメソッドが無い（`AccountDeletionManifestStore.describe` に相当するものが spec に無い）。一方 `spec/usecases/workspace.md` の `deleteWorkspace` 手順 5 は「header state から再開し」と書く。continuation task の payload は operation ID しか運ばないため、cursor を読み戻す手段が契約上存在しない。

### Decision

ポートを増やさず、`appendMembershipPage` / `appendInvitationPage` を **cursor に対して寛容**にする。item は `(operationId, kind, key)` で冪等なので、古い cursor や `null` を渡した再走は新たに何も固定しない。`beginDeletion` 以降 scope は mutation を受け付けないため再走が見つける集合は常に同じであり、cursor は往復を減らすだけの最適化である、と JSDoc に明記する。

### Consequences

- header 読み取りメソッドを spec に追加せずに recovery が閉じる。継続要求が cursor を失っても `null` から再走すればよい。
- 最悪ケースで manifest 構築が O(n) 回の再走になりうるが、各 turn は 100 件で bounded なので turn 長は変わらない。

## ADR-011: global directory の適合スイートは seed / 障害注入フックを `ConformanceBackend` に置く

### Context

`UserWorkspaceDirectory` / `WorkspaceDirectoryBatchReader` / `PublicWorkspaceDirectoryReader` は global の `membership_directory` / `workspace_directory` を読むだけで、書き手はポート集合に無い（`workspace_directory` は `workspace.*` イベントの projection、`membership_directory` の書き手は `MembershipDirectoryReservationStore`＝ステップ 6）。適合スイートは行を用意する手段を持たない。加えて JSDoc は「1 shard が読めないとき batch reader は当該 id だけ `unavailable` に落とし、public 列挙は短いページを返さず失敗する」を契約としているが、memory バックエンドは単一のプロセス内 shard なので障害が自然発生しない。

### Decision

`ConformanceBackend` に必須メンバー 2 つを足す。`seedWorkspaceDirectory(entries)` が projection 行を直接書き、`makeWorkspaceDirectoryUnreadable(ids)` が当該 id の shard を読めない状態にする。既存の `seedMembershipEdges` は `role` / `createdAt` を任意項目として受けるよう広げる（既定値は viewer と現在時刻）。`setMaintenanceTables` と同じ扱い — 契約の分岐に実行可能形を与えるためだけに存在する必須メンバーで、`conformanceCoverage.test.ts` が全ハーネスでの実装を強制する。

### Consequences

- 部分失敗という最も間違えやすい分岐が両バックエンドで検査される。
- memory アダプター側に `MemoryBackend.workspaceDirectoryOutages` という障害注入の口が残る。production の経路からは誰も書かないが、アダプターのコードに存在はする（WHY は同フィールドの JSDoc に記載）。
- `workspace_directory` の書き手ポートが spec に現れた時点で、seed フックは本来の書き込み経路へ置き換えられる。

## ADR-012: workspace リポジトリをステップ 5 では UoW context / DI コンテナへ載せない

### Context

ステップ 5 の作業指示は「`application/di/` に新リポジトリを載せる（必要な範囲で）」を含む。しかし `ScopeUnitOfWorkContext` と `RequestContainer` は memory と Cloudflare の 2 つの合成ルート（`di/memoryRuntime.ts` / `di/cloudflareRuntime.ts`）が共有する型で、フィールドを足すと Cloudflare 側の**本番コード**にも即座に実装義務が生じる。D1 / DO 実装は本ステップの担当外であり、埋めるとすれば throw するスタブになる。

### Decision

ステップ 5 では DI へ載せない。workspace の 6 ポートは適合バックエンド（`ConformanceBackend`）にだけ現れる。`ScopeUnitOfWorkContext` への追加はユースケース（ステップ 7 以降）が最初の消費者になる時点で行う。

### Consequences

- 本番の合成ルートに「呼ぶと落ちる」フィールドが生まれない。`pnpm typecheck` は両ランタイムで通ったまま。
- ステップ 7 の着手時に `ScopeUnitOfWorkContext` への 3 リポジトリ追加と両ランタイムの配線が必要になる。Cloudflare 側の実装が揃っていることがその前提になる。

## ADR-013: `WorkspaceSlugReservationStore` を新設し、旧 slug の解放を `activate(releasing)` に畳む

### Context

ADR-005 で `SLUG_ALREADY_USED` を `WorkspaceRepository` の契約から外した結果、それを投げる主体がポートとして存在しなくなった。`spec/usecases/workspace.md` の `createWorkspace` 手順 2 / 4 と `changeWorkspaceSlug` 手順 2 / 4、`deleteWorkspace` 手順 7、`getPublicWorkspace` 手順 2 が要求するのは、予約・活性化・破棄・解放・解決の 5 操作である。旧 slug の解放を独立メソッドにすると `IdentityUniqueDirectory.beginRelease` と同じ危険が出る — 予約した operation ID は過去のもので再導出できないため条件を `workspaceId` に置くしかなく、A が `S → T → S` と往復した後に最初の変更が replay されると、A が今持っている `S` を落としてしまう。

### Decision

5 メソッド（`resolveActive` / `reserve` / `activate` / `abandon` / `release`）とする。slug 変更の解放は独立メソッドにせず `activate` の `releasing` 引数として新旧を 1 transaction で交換する（`InvitationRouteStore.activateReplacement` と同じ形）。`activate` は**解放より先に**「新 slug 行が自 operation・自 workspace のものか」を検査するので、上記の replay は解放に到達する前に `ConflictError` になる。claim token（[ADR 060](../../spec/adr/060-conditional-unique-claim-teardown.md)）は導入しない。独立した `release` は「代わりを取らずに手放す」ワークスペース削除専用とし、その経路では workspace 自体が消えるので slug を取り戻す主体がいない。

### Consequences

- 予約サガの往復が 1 回減り、「新旧の両方が解決する / どちらも解決しない」窓が型の上で存在しない。
- `reserve` は「同じ workspace が持つ active 行」を新 operation へ re-key して `active` のまま返す（spec の「同じworkspaceの現在slugだけが既存reservationを再利用できる」の実装）。この 1 点だけが `(slug, operationId)` 冪等性の例外になる。
- `spec/domains/workspace.md#ポート` と `spec/inventory/{domain,adapter}.md` に `DOM-workspace-073〜077` / `ADP-workspace-061〜065` を追記した。

## ADR-014: move authorization lock の seed フックを `ConformanceBackend` に置く

### Context

`WorkspaceOperationLockStore.hasActiveMove` / `hasMoveConflict` は `move_authorization_locks` を読むだけで、書き手は `NoteMovePort.stageTarget`（move スライス）であり workspace のポート集合にない。適合スイートは「lock がある」状態を作れず、両メソッドの true 側の分岐に実行可能形が与えられない。

### Decision

ADR-011 と同じ扱いにする。`ConformanceBackend` に必須メンバー `seedMoveAuthorizationLocks(scope, locks)` を足し、seed 行は 2 つのメソッドが判別に使う `migrationId` と `actorUserId` だけを持つ。memory backend には `ScopeStore.moveAuthorizationLocks` 表が残るが、production の経路からは誰も書かない。

### Consequences

- 「他メンバーが staged した move は当該メンバーシップを拘束しない」という一番間違えやすい分岐が両バックエンドで検査される。
- `NoteMovePort` の実装が入った時点で、seed フックは本来の書き込み経路へ置き換えられる。

## ADR-015: `markReady` の「両方の走査が終端に達した」を残存対象の有無で判定する

### Context

`WorkspaceDeletionManifestStore` には header を読むメソッドが無く（ADR-010）、`markReady` の「両方の walk が終端に達したときだけ合法」を判定する材料が呼び出し側から渡ってこない。cursor の到達点をフラグとして header に持たせる案は、ADR-010 が許した「古い cursor からの再走」と組み合わせると、フラグの立て方が walk の呼ばれ方に依存する。

### Decision

`markReady` は「この scope に残る Membership / Invitation のうち item として固定されていないものが 1 件でもあれば `ConflictError`」で判定する。JSDoc が挙げる理由（readied mid-walk では固定し損ねた対象が生き残る）そのものを述語にする。`beginDeletion` 以降 scope は mutation を受け付けないので、この述語は turn をまたいで安定である。

### Consequences

- cursor をどう失っても、再走して全件を固定すれば `markReady` が通る。フラグの整合を別途保つ必要がない。
- 対象が 0 件の scope では walk を 1 度も呼ばずに `markReady` が通る。契約上どちらとも読めるため、適合スイートはこの端を固定していない。

## ADR-016: lease の単調更新は観測不能なので、適合スイートは「失効が所有権を移さない」側だけを固定する

### Context

ADR-007 は lease を持つ 4 メソッドで期限を単調更新にすると決め、「古い instant の renew を replay しても lease が縮まない」を適合スイートで検査できるとした。しかし `MembershipRemovalPreparationStore` は「lease を読む手段を意図的に持たない」と JSDoc が明言し、`MembershipDirectoryReservationStore` の prepare lease も失効が所有権を移さない以上、期限値の違いを外から区別できる操作が 1 つも無い。

### Decision

単調更新は実装（`laterOf`）に残すが、適合スイートでは検査しない。代わりに、同じ規則の観測可能な側 — 期限を過ぎた lock でも `hasConflict` が true を返し続けること、他 operation の `prepare` / `renew` が lapsed でも `ConflictError` になること — をケースにする。変異スポットチェックもこちら側で行った（`hasConflict` を committed 限定にする / lapsed な foreign lock を空きとして扱う、いずれも red）。

### Consequences

- lease を縮める実装のバグは適合スイートでは捕まらない。捕まえるには lease を読むメソッドを契約に足す必要があり、それは「orchestrator は自分が書いた期限を知っている」という設計判断（JSDoc）を覆すことになるので、採らない。
- `MembershipDirectoryReservationStore.commitAccountDeletion` の「edge は在るが lock が無い」場合の扱いは JSDoc に無い。安全側に `ConflictError`（release 後の commit replay が edge を取り消さない）としたが、契約に無い振る舞いなので適合スイートには入れていない。

## ADR-017: `invitations` の `(workspace_id, email) WHERE status = 'pending'` UNIQUE 索引を D1 / DO schema に置かない

### Context

`spec/database/index.md#invitations` は `invitations_pending_uq` UNIQUE (`workspace_id`, `email`) WHERE `status = 'pending'` を索引として定めている。一方 `InvitationRepository` の JSDoc は「この不変条件はストアでは強制しない。だから `insert` に専用の conflict code が無い」と明言し、memory 実装も pre-check を持たない。DDL に索引を置くと、同じ入力に対して memory は成功し Cloudflare は UNIQUE 違反（`SystemError(DatabaseError)`）になる。

### Decision

Cloudflare の scope DO schema には索引を置かない。ポート契約を正本とし、DDL の側を契約に合わせる（[ADR 046](../../spec/adr/046-port-contract-divergence.md)。`0001_global_schema.sql` が FOREIGN KEY を落としたのと同じ理由づけ）。`memberships_workspace_user_uq` は逆で、契約が `MEMBERSHIP_ALREADY_EXISTS` を要求しているので索引を置き、アダプターは overlay を見る pre-check で conflict code を返す。

### Consequences

- 「1 アドレスに pending は 1 件」は `inviteMember` が `findPendingByWorkspaceAndEmail` で解決して resend に畳む経路だけが担保する。DB 側の最後の砦は無い。
- `spec/database/index.md#invitations` と実 schema が 1 索引ぶん食い違う。ADR 046 の許容範囲だが、書き手ポート（`InvitationRouteStore`）が入った時点で再検討の余地がある。

## ADR-018: Cloudflare の directory 障害注入を WorkspaceId 単位の集合で表す

### Context

ADR-011 は `makeWorkspaceDirectoryUnreadable(ids)` を `ConformanceBackend` の必須メンバーにした。Cloudflare 側は `workspace_directory` を D1 1 台に持ち、shard は論理的な概念でしかないので、「当該 id の shard を落とす」を hash shard 単位で実装すると、適合スイートが同一ページで区別する `workspace-1` / `workspace-2` / `workspace-3` が同じ shard に落ちる可能性があり、`resolveMany` の「落ちた shard の id だけ `unavailable`」が検査できない。

### Decision

`WorkspaceDirectoryDeps.unreadableWorkspaceIds: ReadonlySet<string>` を 2 つの reader の依存に置き、WorkspaceId 単位で落とす（memory の `MemoryBackend.workspaceDirectoryOutages` と同じ粒度・同じ観測結果）。`PublicWorkspaceDirectoryReader` は集合が空でなければ列挙全体を失敗させる。production の DI は集合を渡さず、書き込み経路から追加する者もいない。

### Consequences

- 両バックエンドで「1 shard 障害」の観測結果が完全に一致する（batch reader は当該 id だけ `unavailable`、public 列挙は失敗）。
- production コードに障害注入の口が 1 つ残る。WHY は `workspaceDirectorySupport.ts` の JSDoc に置いた。物理 shard が実在するようになった時点で shard 単位へ置き換わる。

## ADR-019: `deleteByIds` の削除件数を事前読みから返す

### Context

`MembershipRepository` / `InvitationRepository` の `deleteByIds` は「実際に消えた行数」を返す契約で、削除は workspace 削除サガの unit of work の中で走る（`WorkspaceDeletionManifestStore.acknowledgeLocal` と同じ UoW）。しかし scope object は storage へ RPC 越しに届くので driver が affected-row count を返さず（`SqlExecutor.applyCounted` が無い）、staged session の `writeCounted` はそもそも「まだ実行していない」として失敗する。

### Decision

`json_each` で対象 id の生存行を先に読み、その件数を返してから bulk `DELETE` を 1 文だけ stage する。bulk delete は行イメージを持てないので `opaque` で stage する（`AccountDeletionManifestStore.compactAcknowledged` と同じ形）。

### Consequences

- 同一 UoW 内で `deleteByIds` の後に `findById` を呼ぶと overlay には削除が反映されず、memory と観測が分かれる。削除サガはこの順序で読まないため適合スイートの範囲外だが、将来 UoW 内で読み戻す呼び出しが増えたら per-id `remove` への切り替えが必要になる。
- 件数は「事前読みの時点で生きていた行数」であり、同一 turn 内の並行削除とはずれ得る。scope object は単一スレッドなので実際には起きない。

## ADR-020: `membership_directory` の settled-state `membership_id` NOT NULL CHECK を落とす

### Context

`0001_global_schema.sql` は `spec/database/index.md#membership_directory` に従って `CHECK (state NOT IN ('active','removing') OR membership_id IS NOT NULL)` を置いていた。しかし `MembershipDirectoryReservationStore.activate` は operation ID しか受け取らず、行が既に持つものをそのまま settle する契約である。適合スイート ADP-workspace-039 は `seedMembershipEdges` で `membershipId: null` の `pending` edge を作り、prepare → release のあと `activate` が成功することを固定している。memory はこれを通し、Cloudflare は CHECK 違反 (`SystemError(DatabaseError)`) になる。

### Decision

`0003_workspace_saga.sql` で `membership_directory` を再構築し、この CHECK だけを落とす（SQLite は制約の in-place drop ができないため table rebuild）。他の 2 本の相関 CHECK と 5 本の索引はそのまま再作成する。ポート契約を正本とし schema を契約へ合わせる（ADR 026 / [ADR 046](../../spec/adr/046-port-contract-divergence.md)。`0001` が FOREIGN KEY を落としたのと、ADR-017 が `invitations_pending_uq` を置かなかったのと同じ理由づけ）。

### Consequences

- production 経路では `reserveAndClaimActivation` が常に `membershipId` を運ぶので、`membership_id IS NULL` な settled edge は実際には生じない。CHECK は seed 由来の人工的な状態にだけ効いていた。
- `spec/database/index.md#membership_directory` の「`active` / `removing` では NOT NULL」は実 schema と 1 本ぶん食い違う。書き手が `reserveAndClaimActivation` だけである限り不変条件自体は保たれる。

## ADR-021: `move_authorization_locks` を Workspace が読む 2 列だけで宣言する

### Context

`spec/database/index.md#move_authorization_locks` は `migration_id` / `actor_user_id` / `membership_id` / `expected_auth_version` / `note_id` / `state` / `created_at` を定める。しかし本 Issue の範囲でこの表を書くのは `ConformanceBackend.seedMoveAuthorizationLocks` だけで、その入力 (`MoveAuthorizationLockSeedInput`) は memory の `MoveAuthorizationLockRow` と同じく `migrationId` と `actorUserId` しか持たない。実際の書き手は move スライスの `NoteMovePort.stageTarget` である。

### Decision

scope DO schema には `migration_id` PK と `actor_user_id` の 2 列だけを置く。読み手（`hasActiveMove` / `hasMoveConflict`）が判別に使うのはこの 2 つだけであり、埋められる書き手のいない列は「誰も信用してよくない NULL」にしかならない。残りの列は move スライスが writer と一緒に追加する。

### Consequences

- memory と Cloudflare で「staged move が 1 件ある」の観測結果が完全に一致する。
- move スライスは schema を足す作業を伴う。`SCOPE_SCHEMA_STATEMENTS` は冪等な `IF NOT EXISTS` の並びなので、列追加は `ALTER TABLE` 文の追記になる。

## ADR-022: 削除 manifest の item 書き込みは `opaque` で stage する

### Context

`WorkspaceDeletionManifestStore` の item ページ（両走査の固定、2 種の ack、compaction）は 1 ページ最大 100 件で、両プレーンとも 1 文あたりの bind 上限が 100 なので `json_each` の複数行 1 文で書く（`spec/database/index.md` の共通の規約）。複数行文は行イメージを持てないので write-set の overlay に載せられない。

### Decision

item 側の書き込みはすべて `opaque` で stage し、item の読み（`listLocalPending` / `listItems` / 件数）は overlay を経由しない `session.query` で行う（`AccountDeletionManifestStore` と同じ形）。header は 1 operation 1 行なので `upsert` で行イメージごと stage し、cursor 前進と state 遷移は同一 UoW 内で読み戻せる。

### Consequences

- 同一 UoW 内で `acknowledgeLocal` の直後に `listLocalPending` を呼ぶと、Cloudflare はまだ ack 前の item を返し memory は返さない。契約が要求するのは「delete と ack が同じ UoW で一緒に着地すること」であり、同一 turn 内での読み戻しではないので適合スイートの範囲外。ADR-019 と同じクラスの差分であり、UoW 内で読み戻す呼び出しが増えたら per-id `upsert` への切り替えが必要になる。
- header は overlay に載るので、`beginDeletion` と同じ UoW 内の `assertWritable` / `assertDeletionOwner` は正しく閉じた scope を観測する。

## ADR-023: workspace 12 ポートの DI 配置を「scope-local は UoW context / global は request container」で割る

### Context

ADR-012 が先送りした配線をステップ 7 で行う。12 ポートは物理プレーンで 2 つに割れる（`adapters/cloudflare/__tests__/ports/workspace.ts` の 3 グループがその区分をすでに持っている）。`ScopeUnitOfWorkContext` に載せるとその面の callback からしか触れなくなり、`RequestContainer` に載せると UoW の外からしか触れない。どちらに置くかは「その書き込みが transaction の中に居るべきか」で決まる。

### Decision

scope DO 側の 6 つ（`WorkspaceRepository` / `MembershipRepository` / `InvitationRepository` / `MembershipRemovalPreparationStore` / `WorkspaceOperationLockStore` / `WorkspaceDeletionManifestStore`）を `ScopeUnitOfWorkContext` に載せる。manifest の page・cursor・継続 task は同一 UoW で着地することが契約であり、`beginDeletion` は scope を閉じる transaction そのものなので、UoW の外に置く選択肢がない。

global D1 側の 6 つ（3 directory と 3 予約ストア）は `RequestContainer` に置く。予約サガは reserve → scope commit → activate と transaction をまたぐ設計であり（ADR-013）、directory は読み取り専用の投影である。あわせて、3 集約の**読み取り専用ビュー** `workspaceReaderFor(scope): WorkspaceReader` を `noteReaderFor` / `usageReaderFor` と同じ形で置き、`Pick` で write メソッドを落として「表示のための読みが書き込み経路にならない」を型で保つ。

`UserBatchReader` も同時に `RequestContainer` へ載せる。`listMembers` は UserId shard 横断で表示名を解決する必要があり、これは workspace scope が到達できない読みで、workspace ポートではないが最初の消費者が本ステップになる。

### Consequences

- `pnpm typecheck` が両合成ルートを同じ形に拘束したまま通る。`AppRuntime` の 4 メソッドは変わらない。
- Cloudflare の適合バックエンド（`__tests__/conformanceBackend.ts`）と `deleteFilesByOwner.test.ts` の `ScopePlaneRepositories` に 6 件の追加が必要になった。前者は既存の `createWorkspaceScopePorts` の結果をそのまま渡すだけで済む。
- `runtimeComposition.test.ts` の `REQUEST_PORTS` に 8 件追加。この一覧は型レベルの網羅検査を伴うので、以降ポートを足すたびに更新が要る（それが狙い）。
- ステップ 8〜12 は新しい配線を足さずに書ける。worker container には何も足していないので、削除サガの worker がステップ 11 で必要とするものはそこで判断する。

## ADR-024: `getPublicWorkspace` は directory の `unavailable` を「判定なし」として scope 読みに委ねる

### Context

`spec/usecases/workspace.md#getPublicWorkspace` の手順 2 は「global D1 のactive slug reservationと `workspace_directory` を引く。not found / 非公開なら `WORKSPACE_NOT_FOUND`」と述べるが、`WorkspaceDirectoryBatchReader` の 3 値のうち `unavailable`（shard 障害・投影未到着）に触れていない。手順 3 は description のために scope object を必ず読むので、この経路では directory は「公開かどうかの門」と「投影 version の基準」にしか使われていない。

### Decision

`deleted` は NotFound、`active` かつ `publication !== "published"` も NotFound、`unavailable` は判定を出さず（`null`）scope 読みの結果を唯一の権威とする。scope の Workspace は publication も lifecycle も持つので、directory が答えられない時に 404 を返す理由がない。version 比較による 1 回だけの再読は、directory が `active` を返した時のみ行う。

### Consequences

- 1 shard の障害が「そのワークスペースは存在しない」という、クローラにキャッシュされうる嘘にならない。
- 逆に、投影が遅れている公開直後のワークスペースは directory が `unavailable` でも scope 読みで公開ページが出る。正データが公開なので、これは仕様の意図（手順 3 の retry も「投影より古い scope 読み」を直す方向）と整合する。

## ADR-025: メンバーシップ変更の「未終端ジョブ取り消し」は継続要求を発行せず不在として記録する

### Context

`changeMemberRole` / `removeMember` / `leaveWorkspace` は spec 上、対象者の未終端 Job を 100 件ずつ終端し、満杯なら同一 UoW で `job.terminationContinued` を積むことになっている。しかし本リポジトリの Job ドメインは `JobId` のみで、`JobRepository` / `Job.cancel` / `continueForcedTermination` のいずれも存在しない（Issue #5 待ち）。さらに `application/workers/subscribers.ts` の `continuationSubscribers` は継続要求型に対して網羅的で、購読者のない継続要求を型に足すとコンパイルエラーになり、仮に発行できても「止まった鎖」になる。

### Decision

継続要求を発行しない。取り消し自体も行わない。代わりに、不在の理由と復帰時の置き場所（各ユースケースの既存 UoW の中）を `application/workspace/membershipMutation.ts` のモジュール JSDoc に明記する。形式は `application/cleanup/participants.ts` が account deletion について同じ欠落を `job: absent("The Job aggregate does not exist", "#5")` と宣言しているのに倣う。

### Consequences

`TC-workspace` の降格・除名・脱退のうちジョブ取り消しに関わる行（100 件継続、`origin` の内容、kind 別の取り消し可否、`markConversionFailed("canceled")`、artifact 回収）は Job スライスまで判定不能。ロール保護・自己変更禁止・除名/脱退の本体は本スライスで満たされる。

## ADR-026: 除名・脱退は directory edge を `removing` にせず、scope-local commit だけで確定させる

### Context

spec/usecases/workspace.md の `removeMember` 手順 5 / `leaveWorkspace` 手順 4 は「global directory edge を `removing` にしてから local UoW を回し、residue cleanup の ack 後に edge を削除する」と定める。しかし `MembershipDirectoryReservationStore`（`spec/domains/workspace.md#ポート` / `DOM-workspace-045〜052`）には join サガと account deletion 用の遷移しかなく、`removing` への遷移も edge 削除も**メソッドが存在しない**。台帳にも該当行がない。

### Decision

本スライスでは scope-local の `Membership` 削除と `workspace.membership.removed` の発行までを行い、directory edge には触れない。ポートを勝手に増やさず、欠落として報告する。

### Consequences

除名・脱退の直後、`listUserWorkspaces` に stale な edge が一時的に残りうる。権限昇格にはならない — 認可はすべて scope の `Membership` を読み直すため、削除済みメンバーはあらゆる操作で拒否される（`UserWorkspaceDirectory` の JSDoc が定める「role は投影であって認可事実ではない」）。ただし `TC-workspace` の「edge は `removing` のまま残る」「residue ack 後に削除される」行は満たせない。ポート追加は `spec/domains/workspace.md#ポート` と適合スイートの同時改訂を要する。

## ADR-027: メンバーシップ変更 3 件の共通ガードを `membershipMutation.ts` に置く

### Context

`requireManageMembers`（非メンバーを `InsufficientRole` に畳む認可）と、対象者の account deletion prepare lock / move lock の検査は 3 ユースケースで同一である。ユースケース間 import（`resolveWorkspaceAccess` の `workspaceNotFound`）も同ディレクトリの `pagination.ts` も既に前例がある。

### Decision

`application/workspace/membershipMutation.ts` を新設し、`requireManageMembers` と `ensureMembershipMutable` を置く。ロック検査は必ず呼び出し側の UoW の中で行うため、`ScopeUnitOfWorkContext` を引数で受け取る関数とし、自分では `run` を開かない（ADR 023 の入れ子禁止）。

### Consequences

ステップ 10 の対象ファイルは 3 件と指示されていたが 4 件になる。ステップ 8 / 9 が別の共通認可ヘルパーを作った場合は後で統合が要る。

## ADR-028: 所有上限の判定に `listActivatingByUser` を足して pending 分を数える

### Context

`spec/usecases/workspace.md#createWorkspace` 手順 1 は「global D1 の active / pending `membership_directory` から `role = owner` の件数を数え」と定め、`spec/testcases/workspace/createWorkspace.md` は「pending workspace を含め所有数 20 件 → quota 回避を防ぐため `WorkspaceQuotaExceeded`」を要求する。しかし所有数を数えるポートが無い。`UserWorkspaceDirectory.listActiveByUser` は契約上 `active` edge だけを返し（pending / removing は意図的に除外）、`MembershipDirectoryReservationStore` に件数を返すメソッドは無い。`spec/domains/workspace.md` の interface 一覧にも所有数を数える口は無く、同 257 行の「利用者の参加 workspace 一覧・所有数は ... query service が担う」という記述だけが宙に浮いている。

### Decision

`listActiveByUser` を keyset で辿って `role === "owner"` を数え、そこへ `MembershipDirectoryReservationStore.listActivatingByUser(userId, 20)` の件数を足す。上限（20）に達した時点で読み止める。`activating` edge は role を持たないので、in-flight な join は一律 owner として数える。

### Consequences

- 良い点: 「commit が着地しなかった create の edge が枠を空ける」経路を塞げる。テストケースの pending 行を満たす。読み取りは上限で打ち切るので、bounded に保てる。
- トレードオフ: `activating` な viewer 参加（招待受諾の途中）を owner として数えるため、19 件所有中の利用者が受諾サガと同時に作成すると一時的に拒否されうる。誤りの向きは常に「拒否側」で、21 件目を通すことはない。edge は予約 TTL 内に収束する。
- 反証条件: `membership_directory` に「role = owner の active + pending 件数」を返すポートメソッドが足されたら、この合成はやめて 1 回の read に置き換える。その際は `spec/domains/workspace.md#ポート` と `spec/inventory/domain.md` にも行を足す。

## ADR-029: `publishWorkspace` の `publicNoteCount` は workspace scope から数える

### Context

spec は `NoteQueryService.searchPublic` で公開ノート件数を数えると定めるが、`PublicNoteQueryService` は `RequestContainer`（`application/di/types.ts`）に載っていない。載っているのは `noteReaderFor(scope)`（`findById` / `listByOwner` / `countByOwner`）だけで、`countByOwner` は可視性で絞れない。加えて `searchPublic` は件数を返さず `hasMore` しか持たないため、正典の経路でもページ反復が要る。

### Decision

`noteReaderFor(ScopeKey.workspace(id)).listByOwner(NoteOwner.workspace(id), "active", …)` を 100 件ずつ辿り、`visibility.status === "public"` を数える。理由と差し替え先を関数の JSDoc に残す。

### Consequences

- 良い点: DI を触らずに `publicNoteCount: 0` / `3` のテストケースを満たせる。scope は自 workspace のノートの可視性の正データなので、数自体は正確。
- トレードオフ: 公開ページが実際に描画する global 投影ではなく scope を読む。ノート数に比例した読み取りになる。
- 反証条件: `PublicNoteQueryService` が request container に載ったら差し替える。`application/note/listNotes.ts` が同じ理由で暫定実装になっているので、そちらと同時に片付けるのが自然。

## ADR-030: `changeWorkspaceSlug` の予約 operation ID を決定的に導出する

### Context

`WorkspaceSlugReservationStore` は `(slug, operationId)` で冪等になっている。応答喪失後の再実行で新しい ID を採番すると、前回の試行が残した自分自身の `reserved` 行に衝突し、TTL が切れるまで `SLUG_ALREADY_USED` を返してしまう。`createWorkspace` は再試行が別の workspace の作成なので採番でよいが、slug 変更は「同じ workspace を同じ slug へ」の再実行になる。

### Decision

`workspace.changeSlug:{workspaceId}:{slug}` を operation ID とする（`identity/updateProfile.ts` の `profileOperationId` と同じ手口）。slug は公開 URL の一部なので、ID に埋め込んでもログ経由の情報漏れにはならない。

### Consequences

- 良い点: 予約・commit・切替のどこで応答を失っても、同じ入力の再実行が同じ行へ収束する。テストケースの「local 更新後に global 切替応答を失う → recovery」がユースケースの再実行だけで成立する。
- トレードオフ: 同じ workspace が同じ slug を短時間に取り直す 2 つの要求は 1 行を共有する。どちらも同じ結果へ収束するので実害はない。

## ADR-031: 期限切れ招待の `expired` / `InvitationExpired` は現契約では到達しないまま実装する

### Context

`spec/testcases/workspace/getInvitationPreview.md` は「期限切れの招待 → `state: "expired"`」を、`acceptInvitation.md` は「期限切れの招待 → `BusinessRuleError(InvitationExpired)`」を期待する。一方 `InvitationRouteStore.resolveActive` の JSDoc と ADR-009 は「`active` かつ未期限切れの行だけを解決し、期限切れは `null`（preview / accept は一様に `INVITATION_NOT_FOUND`）」と定める。route の `expires_at` は招待自身の `expiresAt` と同値なので、両者の境界は完全に一致し、期限切れ招待は token から workspace scope を解決できない。token hash から scope を引く経路は `resolveActive` しかないため、2 つの期待は同時には満たせない。

### Decision

ユースケース側は spec の処理フローどおりに書く — `getInvitationPreview` は `Invitation.isExpired` を含めて `state` を決め、`acceptInvitation` は `Invitation.accept` に期限判定を委ねて `InvitationExpired` を素通しする。アダプターとポート契約には手を触れない（適合スイートの正本であり、本ステップの担当外）。結果として上記 2 分岐は現状到達不能なままとする。

### Consequences

- ユースケースのコードは「期限切れは起きない」を前提にしていないので、`resolveActive` を期限に寛容へ変えるか、期限切れ専用の解決口を足せば、ユースケースを触らずに両テストケースが通る。
- それまでは該当 2 テストケースが `NotFoundError("INVITATION_NOT_FOUND")` を観測して落ちる。ステップ 17 で契約側の是正（`spec/testcases/` か ポート JSDoc のどちらを正とするか）を決める必要がある。

## ADR-032: `inviteMember` の「既にメンバー」判定は identity の email claim を経由する

### Context

`inviteMember` の入力はメールアドレスだが、`MembershipRepository.findByWorkspaceAndUser` は `UserId` を要る。workspace のポート集合には email から member を引く手段が無い。

### Decision

`IdentityUniqueDirectory.resolve("email", email)` で `UserId` を解決し、解決できた場合だけ membership を引く。未登録アドレスはどのワークスペースのメンバーでもありえないので、`null` はそのまま「メンバーでない」とする。

### Consequences

- workspace のユースケースが identity の global directory を 1 本読む。どちらも request container 上の global plane ポートで、UoW を跨がない。
- 恒久 claim（`active`）だけが解決されるので、サインアップ処理中でまだ `reserved` のアドレスは「メンバーでない」と見なされる。そのアドレスはまだメンバーになりようがないため、判定として正しい。

## ADR-033: `resendInvitation` は読み取りと書き込みを 2 つの scope transaction に割る

### Context

`reserveReplacement` は旧 token hash を要るので、招待を読んだ**あと**・local commit の**前**に呼ぶ必要がある（spec 手順 2 → 3 → 4）。しかし `WorkspaceReader.invitation` は `findById` を持たない（OCC トークンを産む読みは UoW の中に閉じ込める設計）ため、招待 ID からの読みは scope UoW を開くしかない。

### Decision

読み取り専用の `run` で招待を引いて `Invitation.resend` を適用し、その結果の `expiresAt` で `reserveReplacement` を張り、2 本目の `run` で `save(expectedVersion)` する。`run` の入れ子は生じない。跨いだ `expectedVersion` は OCC の本来の用途どおりに働かせる。

### Consequences

- 並行する 2 つの再送は 2 本目の `save` で片方が `OPTIMISTIC_LOCK_FAILURE` になり、敗者は自分が予約した replacement を `abandon` する。ポート JSDoc が「敗者が abandon する責任を負う」と書く状況が、`activateReplacement` を待たずに commit 段階で解決する。
- 招待の読みが 2 transaction ぶんになる。scope object 内の往復なので実害は小さい。

## ADR-034: `listPendingInvitations` の `count` は絞り込み後の件数とする

### Context

`InvitationRepository.listByWorkspace` は status を絞らず、`PaginationResult.count` は「ワークスペースの招待総数」である（JSDoc 明記）。一方 `spec/testcases/workspace/listPendingInvitations.md` は「保留中が 0 件 → `count: 0`」「保留中 2 件 → 2 件が返る」を期待し、受諾済み・取り消し済みは一覧に含めない。

### Decision

`count` は射影後の `invitations.length`（＝このページの保留中件数）とする。理由をユースケースの JSDoc に残す。

### Consequences

- 画面が出す件数と一覧の行数が常に一致する。テストケースの 0 件期待も満たす。
- 保留中が 1 ページ（既定 50 件）を超えると `count` が総数ではなくページ内件数になる。発行上限が 24 時間あたり 50 件なので実運用では溢れにくいが、総数が要るなら status 別の count をポートへ足す必要がある。

## ADR-035: `workspace_directory` の書き手を snapshot 1 本 + tombstone の 2 メソッドで置く

### Context

`spec/usecases/workspace.md` の `createWorkspace` 手順 4 / `changeWorkspaceSlug` 手順 4 / `deleteWorkspace` 手順 7 は global の `workspace_directory` 投影を書くことを要求するが、既存 3 ポートはすべて reader で、本番コードから書く経路がなかった（memory では適合テストの seed のみ）。`spec/domains/workspace.md#ドメインイベント` の `workspace.*` は「変化の通知」にとどめる設計で、投影側が Workspace の current snapshot から `name` / `slug` / `published` を解決すると明記されている。

### Decision

`WorkspaceDirectoryProjectionWriter`（DOM-workspace-078 / 079）を新設し、`applySnapshotIfNewer(snapshot)` と `tombstone({ workspaceId, operationId })` の 2 本にする。イベント種別ごとのメソッドは作らない — 5 種の `workspace.*` はどれも「行の表示内容が変わった」であり、部分更新を許すと順序が乱れた 2 イベントが scope に存在しなかった行を作る。順序は `sourceVersion` だけで決め、保存済み以下は 0 行更新で `false`。tombstone は終端で、どの版の snapshot も再開させない。`slug` は書き込み時に他の行から奪う（正典は `workspace_slug_reservations`）。

### Consequences

- 良い点: at-least-once の再送・順序逆転・並行適用が 1 つの比較規則へ畳まれる。UNIQUE 違反で投影が詰まる経路がない。適合スイートは 3 reader を通して観測するので、書けたが読めない実装は落ちる。
- トレードオフ: `updatedAt` は適用時刻なので、サイトマップの並びは event 発行順ではなく投影順になる。
- `deletion_operation_id` を `deleting` 行に必須化するため D1 に `0004_workspace_directory_tombstone.sql` を足した（`0002` のコメントが「writer が来たら入れる」と予告していた制約）。

## ADR-036: 所有数は `UserWorkspaceDirectory.countOwnedByUser` で 1 回の読みにする

### Context

ADR-028 は所有上限の判定を `listActiveByUser` の keyset 走査と `listActivatingByUser` の件数の合成で近似し、「`role = owner` の active + pending 件数を返すポートメソッドが足されたら合成をやめる」を反証条件に挙げていた。

### Decision

`UserWorkspaceDirectory.countOwnedByUser(userId, limit)`（DOM-workspace-080）を足す。`membership_directory` を読む reader は既にこのポートなので、`MembershipDirectoryReservationStore`（予約サガ用）ではなくこちらに置く。数えるのは `role = owner` の `active` / `pending` / `activating`。`removing` は席を明け渡し済みなので数えない。`limit`（1〜100）で打ち切り、戻り値は `min(実数, limit)`。

### Consequences

- ADR-028 の合成は不要になった。`activating` edge を一律 owner として数える近似も消え、role を見て数えるので受諾サガ中の viewer 参加が所有数を押し上げない。
- `limit` の範囲外は `ValidationError("INVALID_PAGINATION")` とし、同じポートの `listActiveByUser` と error contract を揃えた。件数の読みに pagination の code を使うのは名前としては緩いが、ポートの宣言済み契約を増やさない方を採った。

## ADR-037: 除名・脱退の edge 遷移は `(userId, workspaceId)` を鍵にし、目標状態で冪等にする

### Context

ADR-026 は「`MembershipDirectoryReservationStore` に `removing` 遷移も edge 削除も無い」ことを欠落として報告し、除名・脱退後に `listUserWorkspaces` へ stale edge が残る状態を許容していた。既存メソッドはすべて edge の `operation_id`（= join が採番した ID）を鍵にする。

### Decision

`beginRemoval(userId, workspaceId)` / `completeRemoval(userId, workspaceId)`（DOM-workspace-081 / 082）を足す。鍵を `(userId, workspaceId)`（UNIQUE 索引）にするのは、除名側が join の operation ID を導出できないためである。除名用の operation ID は列を増やさず持たせない — 冪等性は目標状態で取る。`removing` への再実行、消えた edge の `completeRemoval`、不在 edge の `beginRemoval` はすべて成功。`pending` / `activating`（未確定の join）への両操作と、`removing` を経ていない `completeRemoval` は `ConflictError`。

### Consequences

- `removing` は `listActiveByUser` から外れるので、宣言した瞬間に一覧から消え、ADR-026 の stale edge が閉じる。account deletion / integration cleanup は `removing` edge から scope を辿れる。
- 並行する 2 つの除名は同じ行へ収束する。`removing` を飛ばした削除を拒むので、後始末の窓が消えることはない。
- 除名の監査は scope-local の `workspace.membership.removed` が持つ。directory 行には除名側の operation ID が残らない。

## ADR-038: 期限切れ invitation route は「読めるが書けない」に倒す

### Context

ADR-031 は、`InvitationRouteStore.resolveActive` が期限切れ行を `null` にする契約のため `getInvitationPreview` の `state: "expired"` と `acceptInvitation` の `BusinessRuleError(InvitationExpired)` が到達不能であることを記録し、契約側の是正を後続へ送っていた。

### Decision

`resolveActive` は `active` な行を期限に関わらず解決する。route は入口にすぎず、期限の判定は workspace scope の Invitation が持つ — route で打ち切ると「期限切れ」と「存在しない」が区別できない。代わりに書き込み側を締め、期限を過ぎた `reserved` 行の `activate` を `ConflictError` にする（recovery は `abandon` する）。`reserved` / `revoked` が `null` になる点は変えない。

### Consequences

- ユースケース 2 本を触らずに `expired` / `InvitationExpired` が到達可能になる（ADR-031 が予告したとおり）。
- 「期限切れは読めるが書けない」が 2 ケースで固定され、変異チェックでも両方向が red になる。
- 期限切れ token を持つ相手は preview で「期限切れ」を見て `resendInvitation` に誘導される。`reserveReplacement` は旧 route の期限を見ないので、期限切れ招待の再送は従来どおり通る。

## ADR-039: 所有上限の判定を `countOwnedByUser` 1 回の読みに置き換える（ADR-028 を解消）

### Context

ADR-028 は所有数を `listActiveByUser` の keyset 走査 ＋ `listActivatingByUser` の件数で近似し、「`role = owner` の active + pending 件数を返すポートメソッドが足されたら合成をやめる」を反証条件に挙げていた。ADR-036 がそのメソッド（`UserWorkspaceDirectory.countOwnedByUser`）を足した。

### Decision

`createWorkspace` 手順 1 を `userWorkspaceDirectory.countOwnedByUser(userId, MembershipPolicy.maxOwnedWorkspaces)` の 1 回の読みにし、`countOwnedWorkspaces` ヘルパーを削除する。ADR-028 は反証条件が満たされたため以後有効ではない。

### Consequences

- 走査が消え、`activating` edge を一律 owner として数える近似も消えた。受諾サガ中の viewer 参加が所有数を押し上げない。
- 上限（20）をそのまま `limit` に渡すので、読みは 20 行で打ち切られたまま。

## ADR-040: `workspace_directory` の投影はユースケース内で local commit 後に同期で書く

### Context

ADR-035 が `WorkspaceDirectoryProjectionWriter` を足したが、誰が呼ぶかは決めていなかった。ポートの JSDoc は「scope-local commit の後、out of band かつ at-least-once」と書くので、outbox 購読者（relay）で書く選択肢もある。しかし `workspace.*` の購読者は現状 1 つも登録されておらず、`getPublicWorkspace` は directory の `publication` で公開ページを閉じるため、投影が書かれないと公開・スラッグ変更・取り下げのテストケースがどれも成立しない。

### Decision

`createWorkspace` / `changeWorkspaceSlug` / `updateWorkspaceProfile` / `publishWorkspace` / `unpublishWorkspace` の 5 本が、自分の local commit 後に `applySnapshotIfNewer` を呼ぶ。共通処理は `application/workspace/directoryProjection.ts` に置き、`retryOnce` で 1 回だけ再試行する。`changeWorkspaceSlug` では reservation の切替が終わったあとに呼ぶ（鍵の正典は予約側で、投影はそれに従う）。

### Consequences

- `sourceVersion` 順序付けがあるので、後から `workspace.*` の購読者を足しても二重適用にならない。同期呼び出しは「最初の適用」にすぎず、購読者が来たら重複しても 0 行更新になる。
- 投影の書き込み失敗はユースケースの失敗として表面化する。local commit は既に着地しているので、呼び出し側の再実行は「同じ版の再投影」で収束する（`createWorkspace` だけは workspace ID が変わるため再実行が別の作成になる — その場合の残骸は他の 2 予約と同じく TTL / recovery の担当）。
- `deleteWorkspace` の `tombstone` は本 ADR の対象外（ステップ 11）。

## ADR-041: 除名・脱退はガードを 2 度走らせ、scope transaction を 2 本に割る

### Context

ADR-037 の `beginRemoval` は local UoW の**前**に呼ぶ（spec `removeMember` 手順 5 / `leaveWorkspace` 手順 4）。しかし `removing` から `active` へ戻す遷移は契約に無く、宣言後にガード（`ensureNotSelfRemoval` / `ensureOwnerRemains` / account deletion・move ロック）が拒否すると、まだメンバーである利用者の workspace が `listActiveByUser` から消えたまま戻らない。一方ガードを宣言前だけに置くと、並行する role 変更が最後の owner を滑り込ませられる。`removeMember` は対象の `UserId` を membershipId からしか引けず、その読みは UoW の中でしかできない（`WorkspaceReader.membership` に `findById` が無い）。

### Decision

読み取り専用の `run` でガードを通し（`removeMember` はここで対象の `UserId` を得る）→ `beginRemoval` → 書き込みの `run` で同じガードを再実行して削除する、の 3 段にする。ガードは `membershipMutation.ensureRemovable` に畳み、2 か所から呼ぶ。`run` の入れ子は生じない（ADR-033 と同じ手口）。

### Consequences

- 「拒否されるのに edge だけ `removing` になる」窓が閉じ、「宣言後に最後の owner になった」も書き込み側のガードが捕まえる。
- 招待の読みと同じく、除名・脱退が scope transaction を 2 本使う。scope object 内の往復なので実害は小さい。
- `completeRemoval` は local commit 直後に呼ぶ。本スライスには residue（Job 正データ・BackupRecord）が存在しないため、spec が待つ ack は既に与えられている。失敗はログに落として握る — メンバーシップは既に消えており呼び出し側に再実行の手立てが無い（再実行は `MEMBERSHIP_NOT_FOUND`）一方、`removing` のまま残った edge は一覧から外れており利用者から見た結果は正しいため。

## ADR-042: `publishWorkspace` の `publicNoteCount` は scope 走査のまま据え置く（ADR-029 は未解消）

### Context

ADR-029 は `PublicNoteQueryService` が `RequestContainer` に無いことを理由に workspace scope の `listByOwner` を辿る暫定を採り、「request container に載ったら差し替える」を反証条件にしていた。載せること自体は memory / D1 の両アダプターが揃っているので可能である。

### Decision

載せない。正典経路 `searchPublic` が読む global public projection（`note_search`）に、ノートの公開を投影する購読者が 1 つも無いためである（`publicNoteProjectionWriter` の呼び出しは `deleteAccount` の著者秘匿だけ）。差し替えると `publicNoteCount` は常に 0 を返し、`spec/testcases/workspace/publishWorkspace.md` の「公開ノートが 3 件 → 3」が落ちる。

### Consequences

- ADR-029 の反証条件を「`PublicNoteQueryService` が request container に載る」から「**ノート公開が public projection に投影される**」へ狭める。ポートを DI に載せるだけでは足りない。
- それまで `publicNoteCount` は scope の可視性を数える。数自体は正確で、ずれるのは「公開ページが実際に描画する投影との一致」だけである。

## ADR-043: 削除サガの継続要求は scope-local `scheduled_tasks` に載せ、global orchestrator も同じ transport で駆動する

### Context

`deleteWorkspace` の手順 3 / 5 / 7 は `workspace.deletionLocalContinued` と `workspace.deletionManifestCompactContinued` を `scheduled_tasks` へ保存すると明記する一方、手順 7 の「global orchestrator」がどの transport で駆動されるかは述べていない。global outbox に載せる選択肢もあるが、`AllDomainEvents` に `WorkspaceEvent` が入っておらず decoder registry も無いため、outbox 経由の継続要求は現状 relay で decode できない。また manifest・admission 状態・削除対象はすべて workspace scope にあり、outbox の consumer から読むにも結局 scope UoW を開くことになる。

### Decision

3 つの kind をすべて `ScopeTaskScheduler` に載せる（`workspace.deletionLocalContinued` / 新設の `workspace.deletionGlobalCleanupContinued` / `workspace.deletionManifestCompactContinued`）。行の鍵は `(kind, operationId)` で `schedule` が upsert するため、これが ADR 041 の「決定的な継続要求 ID」に相当し、応答喪失後の再実行は同じ行を書き直す。各 turn は自分の仕事・cursor・次の行を 1 つの scope transaction で着地させ、`assertDeletionOwner(operationId)` を入口で必ず通す。global cleanup も同じ transport にするのは、durable かつ lease 付きで operation ID を鍵に持つ driver が本ランタイムには他に無いためである。

### Consequences

- workspace event の decoder / subscriber が無くてもサガ全体が閉じる。`workspace.deleted` は outbox へ発行するが、その消費者は Issue #8 が足す。
- `scopeTaskHandlers` に 3 kind が増える。行は turn 自身が `schedule` で再武装するか `complete` で畳むので、runner 側の後始末は不要。
- turn が throw した場合は runner が backoff し、8 回で `failed` に駐車する。可視の停止であり、黙って完了する経路は無い。

## ADR-044: 子行の 0 件確認と Workspace 削除を、削除ページとは別の turn に分ける

### Context

手順 6 は「local pending が 0 件になった最後の UoW でだけ、子行が 0 件であることを確認して Workspace を削除する」と述べる。しかし ADR-019 / ADR-022 のとおり、Cloudflare の `deleteByIds` は bulk DELETE を `opaque` で stage するため、**同一 UoW 内では削除が読み戻せない**。同じ transaction で `deleteByIds` の直後に `listByWorkspace` を呼ぶと、memory は 0 件・Cloudflare は削除前の件数を返し、Workspace 削除が永久に進まない。

### Decision

`localDelete` phase の turn は「`listLocalPending` を 1 回読む → 消す → ack → 自分の行を再武装」だけを行い、読み戻しをしない。0 件を観測した turn（＝前の turn の削除が commit 済みである turn）が、子行 0 件の確認・Workspace 削除・`workspace.deleted` 発行・global cleanup の登録・自行の `complete` を 1 つの UoW で行う。子行が残っていた場合は manifest 走査を cursor `null` から再武装する（append は対象ごとに冪等なので再走は安全＝ADR-010）。

### Consequences

- ADR-019 / ADR-022 が予告した「UoW 内で読み戻す呼び出し」を削除サガは 1 つも持たない。per-id `remove` への切り替えは不要のまま。
- turn が 1 つ増える（最終ページの後に必ず 0 件 turn が回る）。その turn は読み 2 本と削除 1 本で bounded。
- 「Workspace 削除前に停止 → manifest の local ack から再開して 1 回だけ保存する」（TC-workspace）が自然に満たされる。削除と行の `complete` が同一 commit なので再配送も起きない。

## ADR-045: 削除サガの global cleanup 用に worker container へ 4 ポートを載せる

### Context

手順 7 は `workspace_directory` の tombstone、slug reservation の release、`membership_directory` edge の削除、`invitation_routes` の削除を要求する。これらは control plane の書き込みで、ADR-023 は「global の 6 ポートは `RequestContainer`」と決めていた。しかし global cleanup は worker plane の継続 turn であり、`WorkerContainer` にはこの 4 つが載っていなかった（ADR-023 の Consequences が「削除サガの worker が必要とするものはステップ 11 で判断する」と送っていた）。

### Decision

`WorkerContainer` に `workspaceDirectoryProjectionWriter` / `workspaceSlugReservationStore` / `invitationRouteStore` / `membershipDirectoryReservationStore` を足し、memory / Cloudflare 両ランタイムで request 側と同じアダプターを渡す。UoW の外の書き込みなので専用 store ポートを直接叩く形は変わらない。membership edge は `beginRemoval` → `completeRemoval` の 2 段（ADR-037）で消す。`removing` を経ない削除はポートが拒否するためで、両方とも目標状態で冪等なので再送は無害。

### Consequences

- `runtimeComposition.test.ts` の `WORKER_PORTS` に 4 件追加。型レベルの網羅検査があるので漏れはコンパイルエラーになる。
- global の 3 書き込み（tombstone → slug release → item ごとの edge / route 削除）は cursor が `null` の最初の turn でのみ tombstone と slug release を行う。どちらも operation ID / 目標状態で冪等なので、最初の turn の再実行は無害で、後続 turn は飛ばす。
- join saga の `activate` 応答が失われて edge が `activating` のまま残った稀な状態では `beginRemoval` が `ConflictError` になり、その turn が backoff → 駐車する。握り潰して ack すると directory に stale edge が残るので、可視の停止を選んだ。

## ADR-046: 縮退解除の認可はすべて `resolveWorkspaceAccess` を通す

### Context

ステップ 13 で解除する 5 箇所のうち 4 箇所（`accessControl.viewerFor` / `storeAvatar` / `recalculateStorageUsage` / `createBlankNote`）は「実行者の workspace ロールを引く」という同じ前段を必要とする。`MembershipRepository.findByWorkspaceAndUser` を直接叩く経路も書けるが、そうすると「workspace が存在しないときの応答」と「global directory の role を認可に使わない」という 2 つの規則が呼び出し箇所ごとに再実装される。

### Decision

note / storage / usage のどのユースケースからも `application/workspace/resolveWorkspaceAccess` を呼び、その `role`（`null` は非メンバー）に対して `WorkspaceAuthorization.ensureCan` を適用する。非メンバーは `BusinessRuleError(InsufficientRole)`、workspace 不在は `resolveWorkspaceAccess` が投げる `NotFoundError("WORKSPACE_NOT_FOUND")` をそのまま通す（`membershipMutation.requireManageMembers` と同じ向き）。action は spec の割り当てに従う — `createBlankNote` は `createNote`、`storeAvatar` は `manageWorkspace`、`getNote` は `NoteAccessPolicy` が `viewTrash` / `editNote` / `deleteNote` / `changeNoteVisibility` を引く。

`recalculateStorageUsage` だけは action を課さずメンバーシップのみを要求する。ロール表に棚卸しに対応する action がなく、この操作は「メンバーが既に見られる値を実データの合計へ置き換える」だけで新しい情報も能力も生まないため。spec/usecases/usage.md の手順 1 とエラー表をこの判断に合わせて明文化した。

`viewerFor` は `(container, NoteOwner, userId | null)` を取る非同期関数になった。所有者を渡さなければどの workspace のロールを引くべきか決まらず、匿名（`userId === null`）では引く必要すらないため、この 3 引数が最小である。

### Consequences

- `application/note` / `application/storage` / `application/usage` が `application/workspace` に依存する。いずれも同じ application 層で、workspace 側は note / storage / usage を import しないので循環しない。
- workspace 所有ノートの `getNote` は D1 1 点参照 + scope 2 点参照（Note と Workspace/Membership）になる。同一 scope object 内の 2 リクエストであり、`resolveWorkspaceAccess` の JSDoc が言う「認可の正本は scope の Membership」を守るための必要コストとみなす。
- fail-open だった `recalculateStorageUsage` の workspace 主体が閉じた。

## ADR-047: `getUsageSnapshot` のロール絞り込みはページ取得の後段に置く

### Context

spec/usecases/usage.md 手順 2 は「`membership_directory` から `owner` / `editor` の active edge を keyset で最大 `workspaceLimit` 件引く」と書くが、`UserWorkspaceDirectory.listActiveByUser` はロール述語を取らない（ポート契約は「その user の active edge を `created_at DESC, workspace_id` で返す」だけ）。ポートに述語を足すか、ユースケース側で絞るかの選択になる。

### Decision

ポートは触らず、1 ページを引いたあとに `owner` / `editor` だけを残す。`nextWorkspaceCursor` はポートが返した値をそのまま返す。結果として 1 ページの `workspaces` は `workspaceLimit` 件を下回りうるが、カーソルはページ全体の末尾まで進むので、繰り返せば重複も欠落もなく全件を辿れる。

述語をポートへ足さない理由は 2 つ。`listActiveByUser` は workspace switcher（`listUserWorkspaces`）と共有する読みで、そちらは viewer も表示する必要がある。そして述語付きの keyset はシャード側にロール別インデックスを要求するが、`spec/database/index.md` の `membership_directory` はそれを持たない。

### Consequences

- 「viewer だけの workspace が多いユーザー」では 1 ページの表示件数が減る。表示の密度が落ちるだけで、正しさとページングの全体性は保たれる。
- spec/usecases/usage.md 手順 2 に、絞り込みが後段であることと、それが `nextWorkspaceCursor` に与える影響を書き足した。

## ADR-048: scope が答えられない workspace は表示名なしの `unavailable` で返す

### Context

`getUsageSnapshot` の `WorkspaceUsageItem` は spec 上 `unavailable` にも `workspaceName: string` を持つ。これは「表示名は手順 2 の `workspace_directory` で解決済みで、失敗するのは手順 3 の scope RPC だけ」という前提に立っている。しかし `WorkspaceDirectoryBatchReader` の契約は id ごとに `unavailable` を返しうる（1 シャードが読めなくても呼び出し全体は成功する）ので、「edge はあるが表示名がない」状態が実際に起こる。

### Decision

`unavailable` の `workspaceName` を `string | null` にする。null は「directory 側も答えられなかった」を意味し、scope だけが落ちた通常の縮退では名前が入る。`deleted` と判定された workspace は `listUserWorkspaces` と同じく行ごと落とす。spec/usecases/usage.md の DTO をこれに合わせた。

### Consequences

- 画面は `workspaceName === null` のときの表示（ID か既定文言）を決める必要がある。P-24 の実装時に決める。
- 空文字で埋めて型を守る案は採らない。「名前が空の workspace」は存在しない状態であり、型が嘘をつく。

## ADR-049: workspace event の decoder は 12 件を 1 モジュールに置き、網羅は `satisfies` の型フェンスで担保する

### Context

`WorkspaceEvent` が `AllDomainEvents` に入っておらず、`buildDecoder` を使った decoder も無かった。UoW が enqueue した `workspace.*` は outbox には載るが relay が decode できず、`maxAttempts` 超過で quarantine される。既存 3 ドメイン（identity / note / storage）は `application/{domain}/eventDecoders.ts` に decoder を集め、`defaultEventDecoderRegistry` で spread して `satisfies DefaultEventDecoderRegistry` を付けている。

### Decision

`application/workspace/eventDecoders.ts` を同じ流儀で新設し、12 件すべてを登録する。`AllDomainEvents` に `WorkspaceEvent` を足す。網羅は追加の実行時チェックを置かず、既存の `satisfies DefaultEventDecoderRegistry`（mapped type がキーを全要求する）に任せる — 実際、1 件を外すと `eventRelayWorker.ts` が TS2741 で落ちることを確認した。

購読者の有無は decoder の要否と無関係である。`dispatchDomainEvent` は購読者ゼロを warn して ack するが、それは decode に成功した後の話であり、監査用途の 8 件も decoder が要る。

削除サガの 3 継続（`workspace.deletionLocalContinued` ほか）は outbox ではなく scope plane の `scheduled_tasks` に載る（ADR 040）ため、この registry の対象外である。

### Consequences

- 新しい workspace event を足すと、decoder 未登録がコンパイルエラーになる。
- `workspace.membership.*` / `workspace.invitation.*` は購読者ゼロのまま relay を通過し、warn ログだけが出る。

## ADR-050: workspace deletion の write バリアは各 write 入口の UoW 内で呼び、招待サガだけ予約前にも読む

### Context

`WorkspaceOperationLockStore.assertWritable`（`WORKSPACE_DELETING`）をどのユースケースも呼んでいなかった。`ScopeCleanupAdmissionStore.assertWritable` はアカウント削除の receipt しか見ないため代用にならない。spec/usecases/workspace.md は「その他の workspace write は ScopeRouter 入口の共通検査で拒否する」「`inviteMember` / `resendInvitation` / `acceptInvitation` は global reservation の前に呼び、local commit transaction でも再確認する」と定めている。

### Decision

ScopeRouter にミドルウェアを置かず、各 write 入口が自分の UoW callback の先頭で `ctx.workspaceOperationLockStore.assertWritable()` を呼ぶ。判定と、それが許可する write が同じ transaction に入るのはこの位置だけだからである。メンバーシップ 3 件（`changeMemberRole` / `removeMember` / `leaveWorkspace`）は共有ヘルパ `ensureMembershipMutable` に 1 行置いて重複を避ける — `removeMember` / `leaveWorkspace` は事前の read UoW でも同じヘルパを通るので、global edge を `removing` と宣言する前に拒否できる。

予約先行の 2 件（`inviteMember` / `acceptInvitation`）のために `WorkspaceReader` へ `admission: Pick<WorkspaceOperationLockStore, "assertWritable">` を足す。純粋な read なので reader の契約（write メソッドを落とす）を破らず、この事前検査のためだけに transaction を 1 つ増やさずに済む。`resendInvitation` は既に予約前に read UoW を開いているので、その ctx で呼ぶ。

`deleteWorkspace` と `createWorkspace` には置かない。前者は scope を閉じる操作そのもので、冪等性と競合は `beginDeletion` が扱う。後者は新しい scope を作るため、閉じられている状態があり得ない。

### Consequences

- workspace scope に書く入口が増えるたびに 1 行足す必要がある。忘れても型は助けない — テストが唯一の網である（`application/workspace/__tests__/deletionAdmission.test.ts`）。
- user scope の入口も同じ 1 行を持つ（`createBlankNote` / `storeAvatar` / `recalculateStorageUsage` は scope が実行時に決まる）。user scope では header も deleting workspace も無いので素通りする。
- spec の「ScopeRouter 入口の共通検査」という記述と、実装の「各 write 入口」はまだ言い回しが揃っていない。ScopeRouter に共通検査を持たせるかどうかは Cloudflare 実行系の入口設計と一緒に決める。

## ADR-051: ノート移動の 4 フェーズはアプリケーション層のサガとして書き、`NoteMovePort` は据え置く

### Context

`spec/usecases/note.md#moveNote` の 4 フェーズ（`snapshotSource` → `stageTarget` → route switch → `retireSource`）は 2 つの scope をまたぐ。契約としては `application/ports/noteMovePort.ts` が `freezeSource` / `stageTarget` / `activateTarget` / `retireSource` / `abortBeforeSwitch` の 5 メソッドで先に置かれているが、実装は memory / Cloudflare いずれにも無く、`NoteMoveSnapshot` の中身も «opaque» のまま（「the concrete field layout is fixed by the move slice together with its adapter」）。この port を実体化するには両バックエンドのアダプターと適合スイートを同時に足す必要があり、本 Issue のステップ 12 の担当範囲（アプリケーション層 3 ファイル）を大きく超える。

一方、フェーズが必要とする書き込み先はすべて `ScopeUnitOfWorkContext` に既に載っている（`noteRepository` / `noteRevisionRepository` / `storedFileRepository` / `storageQuotaRepository` / `localNoteProjectionWriter` / `noteProjectionRevisionStore` / `appliedOperationStore`）。route の状態機械も `NoteRouteStore.beginMove` / `switchMove` / `abortMove` が両バックエンドで実装済み・適合スイート済み。

### Decision

`moveNote` は各フェーズを「1 scope につき 1 つの UoW」として自分で回す。`NoteMovePort` には手を触れず、未実装のまま残す（将来バックエンド側で 1 トランザクションに畳みたくなったときの契約として有効）。

- 冪等化は `AppliedOperationStore.markApplied({ operationId: migrationId, commandKey })`。commandKey は `note.moveStageTarget` / `note.moveRetireSource` / `note.moveAbortTarget`、ファイル側は `storage.relocateFilesForNote:{phase}` と名前空間を分ける。
- `migrationId` は `DistributedOperationStore.beginOrResume` が返す operation id。同じ requestKey（`noteId:target:expectedVersion`）は同じ operation を replay し、別 requestKey は進行中のものに合流するので、応答喪失後の再要求が同じ commandKey に落ちる。
- operation payload に固定するのは source / target / actor / 両 Membership version / droppedTagNames。`routeVersion` だけは固定しない — route は競合相手が動かす唯一の値で、resume 時に読み直す必要がある。
- UoW のネストは無い。`beginOrResume` / `markState` は global UoW を単独で開き、フェーズの scope UoW とは前後に並ぶだけ。

### Consequences

- 参照実行系（Node + memory）で移動が実際に動く。ステップ 18 のテストはフェイクなしで memory アダプター越しに書ける。
- route switch 後は forward-only。`retireSource` は `assertWritable` も再認可も行わず、`markApplied` だけで守る。switch と retire の間で落ちた場合を拾う recovery cron はこのスライスには無い（`recoverBlankNoteCreation` に cron が無いのと同じ状態）。
- `NoteMovePort` は未使用のまま残る。実体化するときは、この 4 フェーズが port の 5 メソッドへそのまま畳める形になっている。

## ADR-052: move authorization lock は書き手が無いので張らず、pin した Membership version で代替する

### Context

`WorkspaceOperationLockStore` が move について公開しているのは `hasActiveMove` / `hasMoveConflict` の **読みだけ**で、`move_authorization_locks` に行を書く口はどのポートにも無い（適合スイートは `ConformanceBackend.seedMoveAuthorizationLocks` で行を直接仕込んで読みを検証している）。書き手は `NoteMovePort` の JSDoc が担うと述べている側（"target prepare holds the move authorization lock … `activateTarget` / `abortBeforeSwitch` release"）だが、ADR-051 のとおりその port は未実装。`packages/core/src/domain/` はステップ 12 の担当外。

### Decision

lock は張らない。代わりに、事前認可で読んだ **Membership の version を operation payload に pin** し、`snapshotSource` / `stageTarget` の各ローカルトランザクション内で `findByWorkspaceAndUser` を読み直して照合する。

- 行が消えていた → 移動元なら `NotFoundError("NOTE_NOT_FOUND")`、移動先なら `BusinessRuleError(InsufficientRole)`。
- version が動いていた → `ConflictError("STALE_MEMBERSHIP")` で中止し、abort する。

除名は行の消滅、降格は version の増加として現れるので、role を再度引き直す必要はない。

### Consequences

- 「確定時点で除名・降格されていた actor の移動は完了しない」は満たされる（`TC-note-238` 系の 019 / 020 / 021 相当）。
- 満たされないのは lock の**逆向き**の効果 2 つ:
  - stage 済みの move が進行中の workspace 削除を `WORKSPACE_MOVE_IN_PROGRESS` で止められない（`deleteWorkspace` の `hasActiveMove()` が常に false）。
  - stage 済みの move が actor の除名・降格を `ensureMembershipMutable` で止められない（`hasMoveConflict()` が常に false）。降格自体は 1 フェーズ遅れて move 側が検出するので、壊れるのではなく「move が失敗する」方に倒れる。
- 塞ぐには `WorkspaceOperationLockStore` に `stageMove` / `releaseMove` を足す（＋両アダプター＋適合スイート）か、`NoteMovePort` を実体化するかのどちらか。ADR 026 のとおり、どちらもポート JSDoc と適合スイートを対で触る作業になる。

## ADR-053: タグ再配置は `NoteMoveTagRelocation` という 3 メソッドの seam だけ置く

### Context

`UC-tag-012 relocateAssignmentsForNote` は D-001 / ADR-002 で本 Issue の見送り対象。tag ドメイン自体が存在しない（Issue #8）。一方 `moveNote` の出力 DTO は `droppedTagNames` を持ち、spec 手順 3 は「外れるタグ名は operation payload に固定し、再開時に計算し直さない」と定めている。

### Decision

`moveNote.ts` に `NoteMoveTagRelocation` interface（`plan` / `stageTarget` / `retireSource`）と、`[]` と no-op だけを返す `noTagRelocation` を置く。`moveNote` の引数は `ServiceArgs<MoveNoteInput> & { tagRelocation?: NoteMoveTagRelocation }` とし、既定値を `noTagRelocation` にする。

`plan` だけ `RequestContainer` を、残り 2 つは `ScopeUnitOfWorkContext` を受け取る。これは spec の手順配置そのまま — `plan` は operation 作成前（＝どの UoW にも属さない）、他 2 つは自分が属するフェーズのトランザクションを共有する必要がある。

### Consequences

- Issue #8 は interface を実装して `moveNote` に渡すだけで済み、`moveNote` 側の手順は動かない。
- 現状 `droppedTagNames` は常に `[]`。`TC-note-246` / `-247` は判定対象外のまま。

## ADR-054: ワークスペース設定の読み出しは `resolveWorkspaceAccess` + `WorkspaceReader` の合成で作る

### Context

P-31 / P-33 / P-34 は名前・説明・アイコン・スラッグ・公開状態・自分のロールを一度に要る。ところが `application/workspace/` に**ワークスペース自身の設定を読むユースケースが無い**（`spec/usecases/workspace.md` の 20 節にも無い）。`resolveWorkspaceAccess` は `role` / `workspaceName` / `publication` だけ、`WorkspaceProfileView` を返すのは書き込みの `updateWorkspaceProfile` だけで、`listUserWorkspaces` は `description` を持たない。説明欄を空で描くと、保存した瞬間に既存の説明を消す罠になる。

Issue #3 の分担上 `packages/core/` は触れない（並列のサブエージェントが `moveNote` を実装中）。

### Decision

`apps/web/app/components/workspace/settingsRead.ts` に `loadWorkspaceSettings` を 1 つ置き、**認可と存在判定は `resolveWorkspaceAccess`（ユースケース）に任せたまま**、表示に要る射影だけ `container.workspaceReaderFor(scope).workspace.findById` から足す。非メンバー・不在は `null` を返し、断片が「このワークスペースは開けません」を描く（WS-02）。

### Consequences

- 判断（誰が何を見てよいか）はアプリケーション層に残り、presentation が増やしたのは射影だけ。
- `getWorkspaceSettings` 相当の読み取りユースケースが入ったら、この関数はその呼び出し 1 本に縮む。読み出し口が 1 か所なので差し替えは 1 ファイルで済む。
- 同じ理由で P-33 の公開ノート件数は初期表示に出せない（`publishWorkspace` の応答にしか無い）。公開直後だけ「0 件なら空のまま」の注意を出す。

## ADR-055: 表示中のスコープは URL が正本、引き継ぎだけ HttpOnly Cookie に置く

### Context

WS-02 は「選択は URL に反映され、次回の訪問時にも引き継がれる」を要求する。引き継ぎが要るのは入口（`/`）のリダイレクト判定の瞬間で、そこはサーバー側にしかない。

### Decision

文脈の正本は URL（`/workspaces/:workspaceId/...`）。`hollow_scope` Cookie（HttpOnly / Lax / 1 年）は切り替え時と作成時の応答で書き、**`routes/index.tsx` の `beforeLoad` だけが読む**。削除の応答は個人へ戻す。純関数（`presentation/scope.ts`）と Cookie 運搬（`presentation/scopeCookie.ts`）を分け、読めない値はすべて個人へ倒す。

切り替えの遷移は検索パラメータを空にして渡す（WS-02「切り替え時に絞り込み条件は解除する」— タグは文脈ごとに独立しているため）。

### Consequences

- localStorage だと個人の文脈を一度描いてから飛び直すことになるが、その瞬きが無い。
- Cookie は利用者に紐づかないので、別の利用者がサインインしても値が残る。権限判定は遷移先が行い、非メンバーは「このワークスペースは開けません」に落ちるので、漏れるのは workspace ID の存在だけ（自分が選んだものに限る）。
- ワークスペース文脈の入口は今のところ設定画面。`/workspaces/:id/notes` とその読み出し（`listNotes` は個人スコープしか読まない）が後続スライスのため、遷移先は `ScopeToken` と `routes/index.tsx` の 2 か所に閉じてある。

## ADR-056: ワークスペース設定の読み出しは `getWorkspaceSettings` 1 本にし、ADR-054 の暫定を畳む

### Context

ADR-054 は「`getWorkspaceSettings` 相当の読み取りユースケースが入ったら、この関数はその呼び出し 1 本に縮む」を反証条件にして、presentation の `settingsRead.ts` が `resolveWorkspaceAccess` に射影を足す暫定を置いていた。その条件を満たすのが本変更である。P-31 が要る `description` / `avatarUrl` / `slug` はどの既存ユースケースも返さず、`WorkspaceProfileView` を返すのは書き込みの `updateWorkspaceProfile` だけだった。

### Decision

`application/workspace/getWorkspaceSettings.ts`（UC-workspace-022）を置く。identity の `getProfile`（UC-identity-022）と同じ「書き込みを持たない対のユースケース」で、`resolveWorkspaceAccess` で認可し、`WorkspaceReader.workspace.findById` で射影する。可否は `canManage` / `canPublish` / `canDelete` の 3 つに分ける — 3 画面の「読み取り専用」が別の action で決まるためで、最低ロールが今どれも owner であることは権限表の都合にすぎない。

### Consequences

- ADR-054 は解消。`settingsRead.ts` は `getWorkspaceSettings` の呼び出し 1 本に縮み、presentation から `@repo/core/domain/*` の import が 2 つ消える。
- 非メンバーは `BusinessRuleError(InsufficientRole)`。ADR-054 の `null` を返す形とは違うので、フロントは「このワークスペースは開けません」を例外側で描く（不在は `WORKSPACE_NOT_FOUND` のまま）。

## ADR-057: スラッグの空き確認は `resolveActive` だけを読む助言的な読み取りにする

### Context

WS-01 の「スラッグが既に使われている場合、入力中に検出して代替候補を示す」と P-30 の「スラッグ重複の即時検出」に対応する読み取りが無く、フロントは保存が拒否されてから候補を出す形になっていた。

### Decision

`checkWorkspaceSlugAvailability`（UC-workspace-023）を置き、identity の `checkHandleAvailability`（UC-identity-023）に流儀を合わせる。`WorkspaceSlugReservationStore.resolveActive` 1 回だけを読み、`available` / `ownedBySelf` を返す。入力は `slug` と、編集中のワークスペースが既に鍵を持つ場合の `workspaceId` だけ — `userId` は判定に要らないので受け取らない（呼び出し元を認証済みセッションに限るのは転送境界の責務）。

### Consequences

- `reserved` の行は空きと読める。claim ではないので勝者は予約が決め、空きと答えた鍵が `SLUG_ALREADY_USED` で返ることはありうる。ヒントとしては保守的な向きである。
- 形式違反・予約語は `WorkspaceSlug.create` が `BusinessRuleError` にする。フォームは同じ 1 回の問い合わせで「使えない文字」と「重複」の両方を得る。

## ADR-058: P-33 の公開ノート件数も scope 走査で数える（ADR-042 を読み取り側へ広げる）

### Context

ADR-042 は `publishWorkspace` の `publicNoteCount` を scope 走査のまま据え置き、反証条件を「ノート公開が public projection に投影される」に狭めた。現状も購読者は無く（`publicNoteProjectionWriter` の呼び出しは `deleteAccount` の著者秘匿だけ）、`PublicNoteQueryService.searchPublic` は全ワークスペースについて 0 を返す。一方 P-33 は初期表示で件数を要求し、`publishWorkspace` の応答は公開を切り替えた要求にしか届かない。

### Decision

`countPublicNotes` を `publishWorkspace.ts` から `application/workspace/publicNoteCount.ts` へ出し、新設の `getWorkspacePublication`（UC-workspace-024）と共有する。非公開のときも数える — 「公開ページが空になる」という注意が意味を持つのは公開**前**だからである。`publicUrl` は `published` のときだけ非 `null` にする。

### Consequences

- ADR-029 / ADR-042 の反証条件は変わらない。差し替え先が 1 か所から 2 か所になったが、両方とも同じ関数を呼ぶので置き換えは 1 ファイルで済む。
- P-33 の初期表示がワークスペースのノート件数に対して線形になる。件数であってページではないので上限が無く、これが読み取りモデルへ移すべき二つ目の理由になる。

## ADR-059: 削除の進行は Workspace の lifecycle と行の不在で観測し、manifest を読まない

### Context

P-34 の「実行中 / 完了」を追う口が無く、アカウント削除の `getAccountDeletionStatus` に相当するものが workspace に無かった。候補は manifest header と `WorkspaceOperationLockStore` の 2 つだが、前者は scope UoW の中にしか無く、後者の `assertWritable` / `assertDeletionOwner` は例外の有無でしか答えないため、状態の判定に `try / catch` が要る。

### Decision

`getWorkspaceDeletionStatus`（UC-workspace-025）は `WorkspaceReader.workspace.findById` 1 本で答える。`Workspace.lifecycle` は既に `active` / `deleting(operationId)` の判別共用体であり、削除サガは local phase の最後に行そのものを消す。したがって「行が無い = `completed`」「`deleting` = `inProgress`」「`active` = `none`」で 3 状態が揃う。ポートの追加も manifest の読み出しも要らず、例外に頼る分岐も無い。

### Consequences

- global cleanup と manifest の縮約は観測できない。ワークスペースを失った利用者からは区別が付かない段階なので、P-34 が描くものとしてはこれで足りる。
- 行が不在の場合はメンバー判定をしない（その時点で参照できる Membership がどこにも残っていない）。漏れるのは「そのワークスペースがもう無い」ことだけで、`resolveWorkspaceAccess` が `WORKSPACE_NOT_FOUND` で既に全サインイン済み利用者へ答えている範囲を超えない。

## ADR-060: `listNotes` は `searchNotes` と同じ owner 対を受け、workspace 文脈を `viewNote` で認可する

### Context

`listNotes` は個人スコープ固定だったため、WS-02 の遷移先を本来の P-10 にできず、ADR-055 は「ワークスペース文脈の入口は今のところ設定画面」という暫定を置いていた。

### Decision

`listNotes` の入力に `ownerType` / `ownerWorkspaceId` を足す。`searchNotes`（UC-note-006）の入力 DTO と同じ対にしたのは、正典の一覧が入ったとき呼び出し側が書き換え無しで移れるようにするためである。既定は `"user"` なので既存の呼び出しは変わらない。認可は `searchNotes` 手順 1 のとおり `resolveWorkspaceAccess` → `WorkspaceAuthorization.ensureCan(role, "viewNote")` で、`createBlankNote` の owner 解決と同じ形にする。

### Consequences

- ADR-055 の「遷移先は設定画面」が解消し、スコープ切り替えの遷移先を `/workspaces/:id/notes` にできる。
- 非メンバーは `InsufficientRole`、削除済みは `resolveWorkspaceAccess` が投げる `WORKSPACE_NOT_FOUND` になる（WS-02 の「除名された・削除済みのワークスペースを URL で直接開いた」の 2 経路）。
- ユースケース台帳には行を足さない。`listNotes` は `spec/usecases/note.md` に無い walking skeleton の内部リードのままで、正典は `searchNotes` である。

## ADR-061: move authorization lock に `stageMove` / `releaseMove` を足し、ADR-052 の pin 照合は併存させる

### Context

ADR-052 のとおり `WorkspaceOperationLockStore` は `hasActiveMove` / `hasMoveConflict` の読みしか持たず、適合スイートは `ConformanceBackend.seedMoveAuthorizationLocks` で行を直接仕込んでいた。結果として `spec/testcases/note/moveNote.md` の 2 行 —「target stage 後に actor の除名・降格を試みる」「target stage 後に workspace 削除を試みる」— を満たす経路が存在しなかった。ADR-051 の `NoteMovePort` 実体化は据え置きのままなので、書き手は `WorkspaceOperationLockStore` 側に足すしかない。

### Decision

ポートに `stageMove({ migrationId, actorUserId })` / `releaseMove(migrationId)` を足し、memory と Cloudflare DO の両方で実装する。

- 列は `migration_id` / `actor_user_id` の 2 つのまま（ADR-021 を維持）。`membership_id` / `expected_auth_version` / `note_id` を足しても現状は誰も読まないため、読み手が現れたときにポート JSDoc と適合スイートを対で触る（ADR 026）。スキーマ変更・D1 マイグレーションは不要だった。
- `stageMove` は `migrationId` について冪等。同じ actor の再実行は成功し、別の actor を指す再実行は `ConflictError("MOVE_AUTHORIZATION_LOCK_CONFLICT")` にする。actor は operation payload で固定されているので、live lock の指し替えは retry ではなく欠陥である。
- lock どうしは排他しない。lease も expiry も持たず、行の存在そのものが lock である。`stageMove` は deletion admission を見ない — `beginDeletion` が `hasActiveMove` を見ないのと同じ理由で、呼び出し側が同じ transaction で `assertWritable` を呼ぶ。
- `moveNote` は `snapshotSource`（source scope）と `stageTarget`（target scope）のそれぞれの UoW 内で `stageMove` を呼び、route switch 直後の `activateTarget`（target scope）と `retireSource`（source scope）、および abort の両 scope で `releaseMove` を呼ぶ。stage も release も `AppliedOperationStore` のガードより **前** に置く。ガードの後ろに置くと、replay で「再度張った lock を解放しない」経路ができるためである。両方とも冪等なので繰り返しの代償は無い。
- ADR-052 の pin した Membership version の再照合は **残す**。lock は「stage 後に来た除名・降格を拒否する」後ろ向きの防護で、「事前確認と phase の間に既にコミットされていた変更を検出する」前向きの防護は pin 照合にしかできない（`spec/testcases/note/moveNote.md` の「事前確認後・source freeze 前に移動元 Membership version が変わる」）。2 つは別の窓を塞いでいる。
- 適合スイートは `seedMoveAuthorizationLocks` を実メソッド呼び出しへ置き換え、seed ヘルパを `ConformanceBackend` と両ハーネスから削除した。ADR-011 系の「読みの true 側に実行可能形が無い」問題は、書き手ができたことで解消している。

### Consequences

- ADR-052 の「満たされない 2 つ」が閉じた。staged move がある scope では `deleteWorkspace` が `WORKSPACE_MOVE_IN_PROGRESS` を投げ、`ensureMembershipMutable` が同じコードで actor の除名・降格・脱退を拒否する。
- `moveNote` に `activateTarget` という 5 番目のフェーズが増えた（target lock の解放だけを行う target-local UoW）。spec/usecases/note.md 手順 8 前半そのものである。
- move が実行中は source workspace も削除できない。spec/database の「全 scope に置く」と手順 5 の「source move lock を保存して」に従った結果で、意図した挙動である。
- `MOVE_AUTHORIZATION_LOCK_CONFLICT` は `errorDisplay` の文言表に載せていない。`MEMBERSHIP_REMOVAL_LOCK_CONFLICT` と同じく利用者に出る想定が無い内部欠陥コードで、kind 既定の文言に落ちる。

## ADR-062: P-32 の一覧所有権は 2 つの一覧を束ねた 1 つの島に置き、ロール変更と再送だけを葉に残す

### Context

P-32 は 1 画面に「メンバー」と「保留中の招待」の 2 つの一覧を並べ、7 つのミューテーション（招待・コピー・再送・取消・ロール変更・除名・脱退）を持つ。CLAUDE.md「Frontend」は一覧メンバーシップの変更を親の所有としており、そのうち **招待の発行 / 取消 / 除名 / 脱退の 4 つ** が一覧の増減にあたる。2 つの一覧をそれぞれ別の島にすると、招待の受諾がメンバー一覧を増やす関係（招待→メンバーの遷移）を跨いで表現できず、`router.invalidate()` の再取得も 2 系統に割れる。

### Decision

`WorkspaceMembersBoard` 1 つが `useOptimistic({ members, invitations }, applyRoster)` で **両方の一覧を所有する**。`removeMember` / `revokeInvitation` / `addInvitation` の 3 アクションを 1 つの reducer に集約し、除名・取消・脱退・招待発行はすべてこの親が server function を実行する。

- ロール変更（`MemberRow`）と再送（`PendingRow`）は行の中で完結するので、葉が自分の `useOptimistic` と `useTransition` と失敗表示を持つ。再送の楽観値は `expired` フラグで、再送は必ず新しい 14 日の窓を張るため先に落としてよい。
- 最後の owner の保護は **楽観的リストから引き直した** owner 数で閉じる。サーバーの `ownerCount` は変更前の集合に対する判定なので、1 人降格した直後の 1 フレームだけ「まだ降ろせる」と見える（`IdentityBoard` の `canRemove` と同じ理由）。
- 自分の行はロールを `<select>` ではなく静的なテキストで描く。`MembershipPolicy.ensureNotSelfRoleChange` が自分のロール変更を必ず拒否するので、選べない選択肢を出さない（モック P32 は自分の行にも select を置いているが、そちらが契約と食い違っている）。

### Consequences

- 招待リンクのコピー（PAGE-p32-003）は **発行直後と再送直後の応答からしか行えない**。`listPendingInvitations` は意図的にトークンを載せない（ポート JSDoc）ため、再読込するとコピー導線は消える。発行の応答が親に、再送の応答が葉にあるので、コピーボタンも同じ 2 箇所に分かれている。
- 送信中の招待行は番兵 ID（`optimistic-invitation`）で描き、日付の代わりに「送信中...」を出す。有効期限 14 日はドメインの定数なので、フロントで再現しない。

## ADR-063: P-06 の復帰経路はサインインだけが担い、`alreadyMember` はワークスペースへ直接遷移しない

### Context

PAGE-p06-004 は「未 sign-in 時に invitation URL を安全な同一オリジン復帰先として P-01 または P-02 へ遷移する」を求める。しかし `/signup`（P-02）は `redirect` 検索パラメータを持たず、登録の完了はメール確認を挟むため、この往復の中に復帰の起点が残らない。また PAGE-p06-003 の「対象 workspace 文脈へ遷移」は `acceptInvitation` の応答（`workspaceId` を含む）で満たせるが、`getInvitationPreview` の `InvitationPreviewView` は `workspaceId` を持たないため、**受諾せずに** ワークスペースへ送る経路（`alreadyMember`）だけが表現できない。

### Decision

- 未サインインの主導線は `/signin?redirect=/invitations/:token` にする。`safeRedirectPath` が同一オリジンのパスだけを通すので、招待 URL はそのまま復帰先として使える。`/signup` は復帰先を伴わない副導線として並べ、「登録後にこの招待リンクをもう一度開く」ことを本文で明示する。
- `alreadyMember` は「すでに参加しています」＋ノート一覧への導線に畳み、スコープトークンからの切り替えを案内する。`acceptInvitationFn` を「開く」ボタンとして流用しない — 受諾済みの招待に対しては `acceptPending` が `INVITATION_NOT_PENDING` を投げるため、既にリンクを使った本人が再訪した最も普通の経路で失敗する。
- 招待トークンは URL のパスから来る外部入力なので、`renderInvitationPreview` / `acceptInvitationFn` の両方が `invitationTokenSchema`（`min(1).max(512)`、認証系トークンと同じ上限）で転送境界を閉じる。ルートの `head` は canonical に `/invitations` を使い、トークンを書き出さない。

### Consequences

- `InvitationPreviewView` に `workspaceId` が入れば、`alreadyMember` はワークスペース文脈への直接遷移に置き換わる。
- `/signup` に復帰先を通す仕組み（メール確認リンクへ復帰先を載せる、または確認後の初回サインインへ引き継ぐ）が入るまで、招待からの新規登録は 1 手多い。

## ADR-064: `InvitationPreviewView` の `workspaceId` は `alreadyMember` の分岐だけに載せる

### Context

ADR-063 の帰結どおり、`alreadyMember`（受諾済みのリンクを本人が開き直す最も普通の経路）だけがワークスペースへ送れない。`acceptInvitation` は受諾済み招待に `INVITATION_NOT_PENDING` を返すため流用できない。一方 `getInvitationPreview` は未サインインでも読める公開に近い読み取りで、`spec/usecases/workspace.md#getInvitationPreview` の出力 DTO にはワークスペースの識別子が無い。

### Decision

`InvitationPreviewView` に `workspaceId: string | null` を足し、`state === "alreadyMember"` のときだけ非 null にする。他の 5 状態（`acceptable` / `expired` / `revoked` / `accepted` / `workspaceMissing`）では `null` を返す。判定は `previewState` の結果を先に確定させ、その値だけを条件に使う。

- `alreadyMember` の閲覧者は既にそのワークスペースのメンバーであり、自分のワークスペース一覧から同じ ID を得られる。追加の露出にならない唯一の分岐がここだけである。
- 逆に `acceptable` を未サインインで読むのはリンクを持っているだけの相手なので、そこへ ID を渡すと spec が許していない露出になる。
- 型は判別共用体にせず、平坦な nullable に置いた。このファイルの DTO はすべて平坦で、`workspaceId` 以外のフィールドは状態に依存しないため、共用体は narrowing の義務だけを増やす。不変条件は view の JSDoc と回帰テストで固定する。

### Consequences

- P-06 の `alreadyMember` はノート一覧への案内ではなく、対象ワークスペース文脈への直接遷移にできる（ADR-063 の Consequences が解消する）。
- 露出範囲は静的には保証されないので、`invitationResponse.test.ts` が「未サインインの `acceptable` では `null`」「`alreadyMember` では当該 ID」の 2 本で固定する。

## ADR-065: 招待メールの送達可否を `mailSent` として view に載せる

### Context

`sendInvitationMail` は送信の失敗をログに落として握り潰す。招待自体は既に永続化されており、送信の失敗で発行を巻き戻すのは誤りだからである（`spec/usecases/workspace.md#inviteMember` のエラーケース「記録して継続」）。しかしそのため `IssuedInvitationView` / `ResentInvitationView` から送達可否が読めず、`PAGE-p32-002` の「mail warning を表示」を満たせない。

### Decision

`sendInvitationMail` の戻り値を `Promise<boolean>` にし、`IssuedInvitationView` / `ResentInvitationView` に `mailSent: boolean` を足す。`inviteMember` の末尾呼び出し経路は `resendInvitation` の値をそのまま写す。制御フローは変えない — 失敗は今までどおりログに残り、招待もトークン交換も成立する。

- warning が表すのは「招待は成立したがメールは出ていないので、招待者が `invitationUrl` を自分で共有する必要がある」という状態であり、招待の失敗ではない。P-32 の「招待リンクのコピー」導線が代替手段として既にあるので、warning はそこへ誘導する注記になる。
- identity 側（`resendVerificationEmail` / `requestPasswordReset`）は送達可否を返さない。あちらは応答をアカウントの存在オラクルにしない一様応答が契約（ADR 028）で、返してはいけない値だからである。招待は認可済みの招待者に対する応答なので、この非対称は意図的である。

### Consequences

- `MailSender` の契約（送信失敗が呼び出し元を失敗させない）は不変。変わったのは結果の伝え方だけで、ポートには触れていない。
- 「送達失敗でも発行は成立する」は回帰しやすいため、失敗する `MailSender` を注入した `invitationResponse.test.ts` の 3 本で `mailSent: false` と招待行の存在を同時に固定する。

## ADR-066: `moveNote` の `expectedVersion` は転送境界で受け取らず、server function が呼ぶ直前に引く

### Context

`spec/inventory/frontend.md` の PAGE-p11-009 は「target owner と expected version を送信し」と定めるが、`getNote`（UC-note-002）の出力 DTO はノートの版を持たない — `spec/usecases/note.md#getnote` の出力表にも `version` の行が無く、`NoteDetailView` にも無い。版を返すのは書き込み系（`renameNote` / `updateNoteVisibility` / `moveNote` …）だけで、画面が最初に版を得る経路が存在しない。一方 `moveNote` の入力 `expectedVersion` は必須である。

### Decision

`moveNoteFn`（`routes/notes/-action.tsx`）は `expectedVersion` を転送境界で受け取らず、`ScopeRouter.resolveNote` → `noteReaderFor(scope).findById` で**呼ぶ直前に 1 回だけ**引いた版を `moveNote` に渡す。

- 根拠は `spec/usecases/identity.md` の共通規約「対象の版を持たない呼び出し元は、呼ぶ直前に自分で対象を引いてそのときの版を渡す」。`runBulkNoteOperationItem` → `purgeNote` と同じ形である。
- 代償は「画面を開いてから移動するまでの間に入った編集」を弾けないこと。`moveNote` 自身が持つ Membership version の pin 照合・route version・move authorization lock は効いたままなので、失われるのは note 本体の版に対する前向きの防護 1 つに限られる。本スライスに編集経路が無いため、今この窓を通る操作は存在しない。
- `getNote` が版を返すようになったら、断片が見た版をクライアントへ渡して転送境界で受け取る形へ戻す。そのときだけ PAGE-p11-009 の「expected version を送信し」が字義どおり満たされる。

### Consequences

- `presentation` が `ScopeRouter` / `NoteReader` を直に読む箇所が 1 つ増える。`components/workspace/settingsRead.ts` が同じ理由（読み取りユースケースが射影を持たない）で置いている前例に乗る形で、認可の判断は `moveNote` が持ったままである。
- 不在・他人のノート・移動中は `ScopeRouter.resolveNote` が `NOTE_NOT_FOUND` を投げるので、事前読みが増えても応答の集合は `moveNote` 単体と変わらない。

## ADR-067: P-43 の公開ノート一覧は「正本が今返す答え」として 0 件のまま出す

### Context

P-43 は公開ノートの一覧・タグ絞込・ページ内検索を持つ。正本は `PublicNoteQueryService.searchPublic`（グローバル公開投影）だが、(1) ノートの公開状態をその投影へ書く経路がまだ無く、(2) 読み口自体が `RequestContainer` に出ていない（`di/types.ts` にあるのは書き手の `publicNoteProjectionWriter` だけ）。`application/workspace/publicNoteCount.ts` の JSDoc が同じ事実を「`searchPublic` はどの workspace にも 0 を返す」と述べている。

### Decision

一覧セクションは**空状態を描く**。ワークスペース scope を直接走査して `visibility.status === "public"` で絞る近道は取らない。

- 公開可否の述語は匿名閲覧者に対する認可そのものなので、presentation に置くと「未サインインで壊れない」より先に「未サインインに漏れない」を崩す。`countPublicNotes` が application 層にあるのはその境界を守るためで、同じ判断をこちら側へ複製しない。
- 描いている 0 件は嘘ではない。正本が今どの条件に対しても返す答えそのものである。
- 検索語とタグは URL（`validateSearch` の `q` / `tags`）に載せ、ブリッジの `.validator` でも閉じる。読み出しユースケースが入った時点で差し替わるのはこのセクションだけで、条件の受け口は動かない。
- タグ facet（候補の一覧）は出さない。供給する読み出しが無いので、出せるのは URL に既に載っている「適用中のタグ」＝解除の入口だけである。

### Consequences

- PAGE-p43-003（公開ノートを開く）は行が並ばないため到達できない。遷移先の P-44（`/n/:noteId`）も本スライスの対象外で、ルートごと存在しない。
- メンバー閲覧バナーに件数を載せない。件数は `countPublicNotes` が答えられるが、この関数は workspace の全ノートを無制限に走査するため（JSDoc の警告）、匿名で叩ける URL からは呼ばない。

## ADR-068: `alreadyMember` はワークスペースへ直接送り、`/signup` も同一オリジンの復帰先を通す（ADR-063 を更新）

### Context

ADR-063 は当時の 2 つの欠落（`InvitationPreviewView` に `workspaceId` が無い / `/signup` が復帰先を持たない）を前提に、`alreadyMember` をノート一覧＋スコープトークンの案内に畳み、`/signup` を復帰先なしの副導線に置いた。ADR-064 で `workspaceId` が入り、前提の片方が消えた。

### Decision

- `alreadyMember` は `preview.workspaceId` を使ってそのワークスペースの文脈（`/workspaces/:id/settings/general` — ScopeToken の遷移先と同じ）へ直接送る。`workspaceId` が `null` の分岐はノート一覧へ倒す。受諾は出さない（ADR-063 のとおり `acceptPending` が `INVITATION_NOT_PENDING` で落ちる）ので、変わったのは行き先だけである。
- `/signup` に `/signin` と同じ `redirect` 検索パラメータを持たせ、`safeRedirectPath` を通す。外部プロバイダー登録はその場でセッションが立つので `OAuthButton` がそのまま復帰先に使い、メール + パスワード登録は復帰先を `/signin` のリンクへ引き継ぐ（登録の完了がメール確認を挟む以上、その往復の中では復帰できない — ADR-063 の観察は有効なまま）。

### Consequences

- ADR-063 の 2 つの Consequences は解消した。残るのは「確認メールのリンク自体には復帰先が載らない」ことで、メール登録の経路は確認後にもう一度招待リンクを開く 1 手が要る。文言もその形に合わせてある。
- `/signup` は `validateSearch` を持つルートになった。値は `.catch(undefined)` で既定へ倒すので、壊れたクエリで登録画面が開けなくなることはない。

## ADR-069: shard トポロジーを前提にする一覧テストケースは、参照バックエンドで観測できる部分だけをテストにする

### Context

`spec/testcases/workspace/` の一覧系には、最終プラットフォーム（32 shard / 最大 6 接続 / reshard 中の二世代読み）を前提にした行がある。

- `TC-workspace-176` / `-196`: 「UserId / WorkspaceId で grouping し、最大 6 接続の wave で解決する」
- `TC-workspace-188`: 「公開 workspace が 32 shard へ分散する — 同時 6 接続の wave で全体最大 200 件へ merge する」
- `TC-workspace-189` / `-199`: 「reshard 中に旧新へ存在する — WorkspaceId で重複排除し、大きい sourceVersion を採る」

参照ランタイム（Node + memory、[ADR 025](../../spec/adr/025-single-reference-runtime.md)）は単一のプロセス内 shard・単一の routing generation を持つ。接続数の wave も二世代の重複排除も、この backend には表現するものがない。

選択肢:

1. shard 数・接続数を模したフェイクを置いて wave を観測する
2. 観測できる部分だけをテストにし、残りは適合スイート側の責務として記録する
3. 行ごと落とす

### Decision

2 を採る。

- **grouping と有界性**は観測できる。`userBatchReader` / `workspaceDirectoryBatchReader` を「実アダプターへ委譲しつつ呼び出し id 列を記録する薄いラッパー」で包み、1 ページが **1 回**の呼び出しで、**重複のない** id 列で、**上限内**（20 / 100）で解決されることを確かめる（`recordUserBatchReads` / `recordWorkspaceDirectoryReads`）。これは接続数ではなく「join でも全走査でもない」というポートの契約そのもので、実装が n+1 に退行すれば red になる。
- **200 件上限と枯渇シグナル**も観測できる。`TC-workspace-188` は `limit: 201` が `INVALID_PAGINATION` になること、`nextCursor` を `null` まで辿ると全件が欠落・重複なく出ることで押さえる。
- **二世代の重複排除**（`-189` / `-199`）だけは参照バックエンドに執行形がない。テストを書かず、当該テストファイルの冒頭コメントに「単一 generation のため執行形なし、`workers` プロジェクトの directory 適合が担う」と理由を残す。

1 は採らない。shard 数を模したフェイクは memory アダプターの内部を写し取るだけで、`docs/test.md` の fake ポリシー（リポジトリ / ストアのフェイクは置かない、検証は適合スイートが担う）に反する。3 も採らない — 観測できる部分まで捨てることになる。

### Consequences

- 一覧系のチェックリスト行は「参照ランタイムで観測できる範囲で緑」であり、shard トポロジー由来の性質は `pnpm test:workers` 側の適合が担保する。`pnpm test:node` だけの緑を本番の保証と読まないこと（`docs/test.md` の同旨）。
- 部分失敗は逆に memory でも執行形がある。`MemoryBackend.workspaceDirectoryOutages` に WorkspaceId を入れると、batch reader はその行だけ `unavailable` に落ち、公開列挙は全体を失敗させる。`TC-workspace-200` / `-201` と sitemap の「短いページを返さない」性質はこれで押さえた。

## ADR-070: 所有上限テストは workspace を 19〜20 件作らず `membership_directory` の owner edge を直接置く

### Context

`TC-workspace-062` / `-063` / `-068` は「19 件所有で成功」「20 件所有で `WorkspaceQuotaExceeded`」「pending を含めて 20 件でも拒否」を要求する。判定は `UserWorkspaceDirectory.countOwnedByUser` ただ一つを読む — `role === "owner"` かつ edge state が `active` / `pending` / `activating` の行を数える。

選択肢:

1. `seedWorkspace` を 19〜20 回呼んで本物のワークスペースを作る
2. `membershipDirectoryReservationStore` を通じて owner edge だけを 19〜20 本置く
3. `userWorkspaceDirectory` をフェイクに差し替えて数を返させる

### Decision

2 を採る。`reserveAndClaimActivation`（+ `activate`）は本番アダプターそのもので、`activate` を呼ばずに止めれば `activating`（= 作成が飛行中）の edge が得られる。`TC-workspace-068` が要求する「pending を含めて 20 件」は、この「settle させない」という一点だけが本物の差であり、フェイクを置かずに再現できる。

1 は採らない。1 件あたり scope UoW・slug 予約・directory 投影まで走らせるのに、判定が読むのは edge 表だけで、テストが遅くなるだけ意図がぼける。3 は `docs/test.md` の fake ポリシー（リポジトリ / ストアのフェイクは置かない）に反する。

### Consequences

- `createWorkspace.test.ts` のローカルヘルパー `seedOwnerEdges(h, userId, count, settle)` がこの足場。`settle: "inFlight"` が `activating` を残す。
- 「owner 以外の edge は席を占めない」ことも同じ足場で `role: "editor"` の edge を 1 本足して押さえた。境界（`>=` → `>`）の変異で `-063` / `-068` が red になることを確認済み。

## ADR-071: `TC-workspace-271` の「読み取りモデル更新」半分は執行形を持たせず、イベント発行までを執行形にする

### Context

`TC-workspace-271` の期待結果は 2 つある — (a) `workspace.profileUpdated` が発行される、(b) `projectNoteChanges` が読み取りモデルのワークスペース名を更新する。本 Issue の実装では `subscribers.ts` に `workspace.profileUpdated` の購読者が存在せず、(b) を担う `projectNoteChanges` はノート読み取りモデルの後続スライスに属する。

### Decision

(a) だけを執行形にする。`updateWorkspaceProfile.test.ts` は outbox に `workspace.profileUpdated` が 1 件だけ積まれ、payload が新しい名前を運ぶことを確かめる。加えて、本スライスで実際に更新される読み取りモデル（global `workspace_directory`）の `name` / `sourceVersion` が追随することを `TC-workspace-266` / `-270` で押さえる。

(b) の欠落をテストで表明しない — 未実装の購読者を「呼ばれないこと」で固定すると、実装した瞬間に無関係な red を生む。

### Consequences

- チェックリスト上の `TC-workspace-271` は「イベント発行まで緑、読み取りモデル反映は後続スライス」と読むこと。購読者を足すときはこのケースに (b) の表明を追加する。

## ADR-072: 取り消し後にリンクを開いたときの期待値は `INVITATION_NOT_FOUND` とする

### Context

`spec/testcases/workspace/revokeInvitation.md` の `TC-workspace-253` は「取り消し後にその招待リンクを開く → 取り消し済みとして扱われる」とだけ書く。一方 `getInvitationPreview.md` の `TC-workspace-119` は「取り消し済みの招待を引く → `state: "revoked"`」と書く。両方を額面どおりに読むと、取り消し後のリンクは `state: "revoked"` を返すべきに見える。

しかし `InvitationRouteStore` の JSDoc（ポート契約の正典）は、閉じた route は `resolveActive` で `null` になり「一度も開かれなかったトークンと既に使われたトークンを呼び出し側から区別できない」ことを明示し、preview / accept が一様に `INVITATION_NOT_FOUND` を返すのはそのためだと述べている。`revokeInvitation` は local commit → global `revoke` の順に進むので、収束後の route は必ず閉じている。

### Decision

- `TC-workspace-253` は「リンクが開けなくなる」= preview / accept ともに `NotFoundError("INVITATION_NOT_FOUND")` として執行形にする。
- `TC-workspace-119` の `state: "revoked"` は、local revoke は済んだが global route の close がまだ届いていない窓（`seedInvitation({ state: "revoked", route: "active" })`）でだけ観測できる状態として執行形にする。この窓は `TC-workspace-258` が同じ経路で実在することを示している。

実装のバグとしては扱わない。仕様書の文言が曖昧で、ポート契約が曖昧さを解いている側だと判断した。

### Consequences

- `revokeInvitation.md` の `TC-workspace-253` を読み直すときは「取り消し済みとして扱われる」を「そのリンクではもう入れない」と読むこと。UI に「取り消されました」と出したいなら route を閉じない設計が要るが、それは閉じた route と未発行トークンの区別を外部に晒すことになる。

## ADR-073: `acceptInvitation` の recovery / 削除競合ケースは、ユースケース層で表現できる分だけを執行形にする

### Context

`spec/testcases/workspace/acceptInvitation.md` の `TC-workspace-015〜018` は membership edge の saga を、アカウント削除側の進行と絡めて記述する。このうち

- `TC-workspace-017`（activation claim 後に worker が停止し lease が切れる → operation ID で workspace 正データと突き合わせて収束）
- `TC-workspace-018`（削除開始と activation claim が同時 → UserId shard で直列化）

を駆動する主体は `acceptInvitation` ではない。前者は lease 失効後の global recovery、後者はアカウント削除サーガであり、本スライスのアプリケーション層にその入口が存在しない（`application/workers/` には membership edge の recovery worker がない）。

### Decision

- `TC-workspace-015` は「アカウント削除が prepare lock を取った edge があると join が負け、workspace へ local commit しない」というユースケース層で観測できる形に落として執行形にする。`membershipEdges` へ直接 pending + prepare lock の行を書いて再現する（`deleteAccount.manifestBuild.test.ts` と同じ直接シード）。条件付き更新の優先順位そのものは `adapters/conformance/membershipDirectoryReservationStore.ts`（ADP-workspace-036〜040）の担当とする。
- `TC-workspace-016` は「commit 中は `listActivatingByUser` に現れ、収束後は `active` になる」まで、つまり削除側が待つ対象が確かに観測できることまでを執行形にする。
- `TC-workspace-017` / `-018` はユースケーステストを置かない。

### Consequences

- membership edge の recovery worker を足すスライスで `TC-workspace-017` の執行形を追加すること。チェックリスト上はこの 2 行を「conformance と後続スライスで担保」と読む。

## ADR-074: 最後の owner 保護（`TC-workspace-022` / `-211`）は、自己変更・自己除名の禁止が先に効くため並行窓の執行形にする

### Context

`TC-workspace-022`（changeMemberRole）と `TC-workspace-211`（removeMember）は「owner が 1 名で、その owner を対象にする」を前提に `LastOwnerCannotLeave` を要求する。しかし `manageMembers` を持つのは owner だけで、owner が 1 名ならその 1 名が対象＝自分自身になる。`spec/usecases/workspace.md` の手順順序（changeMemberRole 手順 3 の `ensureNotSelfRoleChange`、removeMember 手順 2 の `ensureNotSelfRemoval` が owner 数の判定より前）どおり、実装は先に `CannotChangeOwnRole` / `CannotRemoveSelf` を投げる。行の文言どおりの入力では `LastOwnerCannotLeave` に到達しない。

### Decision

この 2 行は「認可を通った後に owner 数が 1 に落ちる」並行窓として執行形にする。`scopeUnitOfWorkProvider.run` を薄いラッパーで包み、最初の `run` の直前にもう一方の owner を降格させてから本体へ委譲する（`docs/test.md`「Injecting into a concurrency window」）。窓の位置がテストの価値そのものなので、`requireManageMembers` の後・判定 UoW の前であることをテスト名とコメントに書く。`leaveWorkspace` の `TC-workspace-148` は自己判定を持たないため、素直な入力のまま執行形になる。

### Consequences

- 保護そのものは変異チェックで担保される（`MembershipPolicy.ensureOwnerRemains` の `ownerCount <= 1` を `<= 0` にすると `TC-workspace-022` / `-148` / `-149` / `-211` の 4 件が red）。
- 手順順序を入れ替える改訂が入ったら、この 2 行は素直な入力へ書き換えられる。spec 側の 2 行と `MembershipPolicy` の判定順が反証条件。

## ADR-075: `deleteMembershipsForUser`（`TC-workspace-069〜075`）は本デプロイに存在しないため執行形を置かない

### Context

`spec/testcases/workspace/deleteMembershipsForUser.md` は account deletion が列挙した workspace edge ごとに scope command を回す前提だが、本リポジトリにその command は無い。`application/identity/deleteAccount/cleanupDispatch.ts` は「workspace cleanup wave は membership item が固定されて初めて存在する」として dispatch せず、`manifestBuild.ts` も `FIRST_DISPATCH_PHASE = "cleanup"` として prepare 相当を空に倒している。`application/workers/scopeTaskRunner.ts` の `scopeTaskHandlers` にも membership 掃除の kind は無い。

### Decision

7 行すべてについてユースケーステストを置かない。`membership_directory` 側の冪等性・operation ID による削除は適合スイート（`adapters/conformance/membershipDirectoryReservationStore.ts` / `accountDeletionManifestStore.ts`）が担保しており、そこへ重複を足さない。`TC-workspace-168` だけは `leaveWorkspace` 側から「edge が消えれば account deletion の `appendMembershipPage` がこの scope を固定しない」ことを執行形にした。

### Consequences

- account deletion の workspace wave を足すスライスで 7 行の執行形を追加すること。チェックリスト上は「usecase 不在」と読む。
- 唯一 owner の再検査（`TC-workspace-070`）は `MembershipPolicy.ensureOwnerRemains` が正本のままなので、wave が来ても新しい規則は要らない。

## ADR-076: ノート移動の recovery 系 TC は「観測できる半分」だけをテストにし、駆動口の不在は報告に回す

### Context

`spec/testcases/note/moveNote.md` の 4 行（`TC-note-263` / `-265` / `-266` / `-269`）はいずれも「recovery を実行する」「再開する」を操作としている。ところが ADR-051 のとおり本スライスには route switch 後に落ちた移動を拾う入口が無い（`recoverBlankNoteCreation` に相当する関数も cron も無い）。`moveNote` を同じ requestKey で再要求すると、route が既に target を指しているため事前確認が「所有者が同じ」の早期 return に落ち、`activateTarget` / `retireSource` / sourceDebit へは前進しない。

同様に `TC-note-268`（move 前の public projection event が遅延）は `note.moved` の購読者が本スライスに無いため、ユースケース経由では駆動できない。

### Decision

これらの行は「契約として本スライスに存在する側」だけをテストにする。

- `TC-note-263`：switch 後の失敗が **abort しない**こと（route は target のまま、target lock は activate 済み、source 行は retry 待ちで残る）を固定する。「前進する」半分は書かない。
- `TC-note-265`：target credit 済み・source debit 前で止まると source が過大計上のまま残ること、および再要求が二重に credit / debit しないことを固定する。
- `TC-note-266`：switch の応答喪失後に再要求しても `routeVersion` が 2 度上がらないこと（`NoteRouteStore.switchMove` の lost-response 分岐が効くこと）を固定する。
- `TC-note-269`：source cleanup 失敗後も route が target を維持し、再要求が所属を source へ戻さないことを固定する。
- `TC-note-268`：`PublicNoteProjectionWriter.replaceSnapshotIfNewer` を、`note.moved` が実際に載せた `routeVersion` を使って直接呼び、古い generation が `stale` になることを固定する。

満たせない半分は報告に回し、テストとして赤で残さない（赤で残すのは spec と実装が食い違う欠陥だけにする）。

### Consequences

- 移動の recovery 入口（cron / scope alarm）を足すスライスで、この 4 行に「前進する」側の執行形を追加する必要がある。
- `TC-note-268` は購読者が実装された時点でユースケース経由へ書き換えられる。現状の形は writer の契約に依存しているので、`adapters/conformance/` の同種ケースと二重になりうる。

## ADR-077: 移動テストの workspace セットアップは `application/workspace/__tests__/harness.ts` を借りる

### Context

`moveNote` のテストは移動元・移動先の 2 ワークスペースを要り、`removeMember` / `changeMemberRole` / `deleteWorkspace` を「移動中に割り込む操作」として実際に呼ぶ。これらは global の `membership_directory` edge が無いと動かない（`beginRemoval` が edge を要求する）ため、scope へ直に行を書く簡易 seed では足りない。

### Decision

`packages/core/src/application/note/__tests__/moveNote.test.ts` から `../../workspace/__tests__/harness` の `seedWorkspace` / `expectBusinessRule` / `expectConflict` / `expectNotFound` / `outboxRows` を import する。note 側に固有の足場（`markProcessing` / `makeUnlisted` / `seedRevision` / `seedFile` / `seedQuota` / スコープ transaction の前後に割り込む `withScopeRunHooks`）はテストファイル内にローカルで置く。

### Consequences

- `harness.ts` は workspace テスト専用ではなくなった。破壊的に変えるときは note 側も見ること。
- `withScopeRunHooks` は移動の固定した順序（0 `snapshotSource` / 1 `stageTarget` / 2 `activateTarget` / 3 `retireSource`）に index で割り込む。フェーズを増減したらテスト側の index も動く。

## ADR-078: `membership_directory` edge の role は event が運ぶ source version で投影する

### Context

`changeMemberRole` は scope の Membership だけを書き、global の `membership_directory` edge は触らない。`listUserWorkspaces` が返す role はその edge からしか来ないので、降格しても切替 UI は古い role を出し続けていた（`TC-workspace-045` / `TC-workspace-235` が執行形を持てなかった原因でもある）。

投影の入力の取り方は 2 案あった。(a) 購読者が workspace scope の Membership を読み直す（`projectWorkspaceDirectory` が Workspace の current snapshot を使うのと同じ形）。(b) event の payload に値と版を載せる。

(a) は「event は変化の通知にとどめる」という `spec/domains/workspace.md` の言い回しに沿う一方で、後着 event を受けても常に最新を読むため「古い値が巻き戻さない」ことをテストが区別できない（壊れた実装でも緑になる）。加えて worker 側に scope の membership reader が無く、読むためだけに scope UoW を開くことになる。

### Decision

(b) を採る。`workspace.membership.roleChanged` の payload に `sourceVersion`（変更後の Membership 版）を足し、`MembershipDirectoryReservationStore.applyRoleIfNewer(userId, workspaceId, role, sourceVersion)` が保存済み `role_source_version` より**大きい**ときだけ書く。edge が不在なら insert せず `false` を返す。購読者 `application/workspace/membershipRoleProjection.ts` は port を 1 回呼ぶだけで、`IdempotencyStore` は使わない（版比較そのものが冪等性）。

`roleChanged` の payload は既に `previousRole` / `currentRole` という値を運んでおり、通知だけの `workspace.*` event とは元から性格が違う。ここに版を足すのは新しい種類の結合ではない。

### Consequences

- event payload に版が乗るので、`eventDecoders` の strict schema と `Membership.changeRole` のテストが連動して変わる。
- 再入会（除名 → 再 join）で edge が作り直されると `role_source_version` は NULL に戻る。同じ pair の**前の** Membership の古い event が届けば理屈上は当たるが、`membershipId` を payload へ足さない限り区別できず、次の role 変更で必ず上書きされる。現状の配送保持期間では実害が無いとみなし、追わない。
- `removed` event には購読者を置かない。edge の撤去は `removeMember` / `leaveWorkspace` が `beginRemoval` → local commit → `completeRemoval` の 2 相で行っており、購読者が二重に消すと後始末の ack を待つ `removing` edge を落としうる。

## ADR-079: role 投影の順序テストは relay の `drainOutbox({ order })` で行う

### Context

「後着 event が新しい値を巻き戻さない」は port の適合スイート（`ADP-workspace-073`）でも固定できるが、それだけだと購読者が port を正しい引数で呼んでいるかは分からない。

### Decision

`application/workspace/__tests__/harness.ts` の `drainOutbox` が持つ `order` フックで claim 済み batch を逆順にし、`changeMemberRole` を 2 回呼んだ後の最終 role を `listUserWorkspaces` まで通して確認する（`TC-workspace-045`）。再配送は outbox 行を `dispatchDomainEvent` へ直接もう一度渡す（`removeIdentity.test.ts` と同じ形）。

### Consequences

- 配送順の入れ替えはこのフックでしか観測できないので、`drainOutbox` の `order` を消すと順序テストが静かに無力化する。

## ADR-080: 補償トランザクションは `AppliedOperationStore` の記録も消す（`clearApplied` を足す）

### Context

`moveNote` の各フェーズは ADR-051 のとおり `markApplied(migrationId, commandKey)` で冪等化していた。ところが `abortBeforeSwitch` は staged 行・credit・lock を消す一方で `note.moveStageTarget` と `storage.relocateFilesForNote:stageTarget` の記録を残していた。`spec/usecases/note.md#moveNote` は「各応答喪失は同じ migration ID で再試行する」と定めるので、abort 後の再要求は同じ migration ID に落ちる。すると `stageTarget` が丸ごと skip され、空の target へ `switchMove` が route を切り替え、続く `retireSource` が source の Note・Revision・ファイル・使用量を消す。**移動元・移動先とも 0 件**になり `note.moved` だけが出る、fault injection 不要のデータ消失だった（`TC-note-258` の再現テスト）。

`markApplied` は単調で、記録を消す口がどのポートにも無かった。一方 abort 自身は `note.moveAbortTarget` で守られていたため、再 stage 後の 2 度目の abort が un-stage を skip する対称の穴も持っていた。

### Decision

記録の意味を「そのコマンドの効果が**今そこにある**」と定め、効果を打ち消す補償トランザクションは同じ UoW で記録も消す。

- `AppliedOperationStore` に `clearApplied({ operationId, commandKey })` を足す。存在しない記録の消去は no-op。memory と Cloudflare DO の両方で実装し、適合スイート（`adapters/conformance/appliedOperationStore.ts`）に 3 ケースを足して両バックエンドへ同一に課す。鍵は `markApplied` と同じ `sha256(operationId + ":" + commandKey)` の 1 行 DELETE なので、`applied_operations` の 1 列 PK（ADR 045 / spec/database）を崩さない。Cloudflare 側は `kind = 'command'` を条件に加え、同居する barrier receipt へ届かないようにする。
- `abortBeforeSwitch` は target scope でこの migration が書きうる 3 つの記録（`note.moveStageTarget` / `storage.relocateFilesForNote:stageTarget` / `storage.relocateFilesForNote:retireSource`）を transaction 冒頭でまとめて消す。「完全 abort」は target に migration の痕跡を残さないことであり、記録もその痕跡である。
- abort 自身の `note.moveAbortTarget` は**廃止**する。abort の冪等性は staged Note の存在で足りる — Note の insert と credit は同じ transaction、Note の delete と逆仕訳も同じ transaction なので、Note の存在が credit の正確な証人である。記録で守ると再 stage 後の 2 度目の abort が un-stage を skip する。
- `RETIRE_SOURCE_COMMAND` は据え置く。switch 後は forward-only で補償が存在せず、記録を消す相手がいない。

`relocateFilesForNote` の `commandKeyFor` を `relocateFilesCommandKey` として公開した。フェーズを打ち消す呼び出し側が鍵を知る必要があるためで、その義務はポートの JSDoc に書いた。

### Consequences

- 冪等性（同じ migration ID の再開が重複 target Note を作らない）とデータ保全（abort 後の再要求がノートを失わない）が両立する。前者は `TC-note-258`（freeze 直後の失敗）・`TC-note-263` / `-265` で、後者は `TC-note-258`（abort 後の再要求）で固定した。
- 変異スポットチェックで `TARGET_SCOPE_COMMANDS` からファイル側の鍵を落としても既存テストが全部通ってしまったので、`TC-note-258` に「abort 後の再開が Revision・ファイル・credit も張り直す」ケースを 1 本足した。3 つの鍵それぞれに検出力がある。
- 今後 `applied_operations` で守るコマンドを足すときは「補償があるか」を必ず問うこと。あるなら `clearApplied` が対になる。`deleteFilesByOwner` / `deleteQuota` の cleanup コマンドには補償が無いので現状の単調な記録のままでよい。

## ADR-081: ワークスペース文脈のノート一覧は `NoteList` に owner を渡す 1 画面で作る

### Context

`spec/pages/index.md` 39〜40 行は `/workspaces/:workspaceId/...` を「`/notes` 以下と同じ構成」と定め、P-10 を「文脈によらない 1 つの画面」として記述する。実装側は `/notes` だけがあり、`NoteList` が `userId` しか受け取らないため、WS-02 手順 3 の切替先が設定「一般」に倒れていた（AC-3 が本来の形で成立していない）。`listNotes` は既に `ownerType` / `ownerWorkspaceId` を受ける（ADR-060）。

### Decision

`NoteList` に省略可能な `owner`（`personal` | `workspace`）を足し、`/notes` と `/workspaces/:workspaceId/notes` の 2 ルートが同じサーバーコンポーネントを描く。個人側の呼び出しは既定値で無変更。

- 文脈の解決とシェル（スコープトークン）に要る名前・スラッグ・公開状態は `getWorkspaceSettings`（ADR-056）を読む。設定画面のためのユースケースだが、返すのは「そのワークスペース自身の表示に要る一式 + ロールの能力フラグ」で、一覧が要るものはその部分集合である。専用の読みを増やさない。
- 非メンバーは `WORKSPACE_INSUFFICIENT_ROLE`、削除済み・不在は `WORKSPACE_NOT_FOUND` で来る。ルートの `errorComponent` が両者を同じ「このワークスペースは開けません」に畳む（WS-02、設定レイアウトと同じ表示）。
- `canWrite`（editor 以上）を owner に載せ、viewer には「新規作成」と行の操作メニューを出さない。L-01 の「使えない行き先は並べずに消す」に合わせる。
- `createBlankNoteFn` は文脈（`workspaceId`）を転送境界で受けるようにした。認可は `createBlankNote` が対象ワークスペースで `createNote` を判定するので緩まない。

`loadNotes` の引数を `NoteListOwner` ではなく `workspaceId: string | null` にしたのは、`cache()` の同一性が引数の参照で決まるためである。

### Consequences

- ADR-054 / ADR-055 が「後続スライス」として残していたスコープ切替の暫定（`ScopeToken` と `routes/index.tsx` が設定画面へ送る）が解消し、P-40 の「`/` → P-10」も spec どおりになった。
- ノート詳細のワークスペース文脈 URL（`/workspaces/:workspaceId/notes/:noteId`）は依然として無く、行のリンクは `/notes/:noteId` を指す。`getNote` が経路を解決するので閲覧はできる。OR-12 の「移動後に URL が新しい文脈へ正規化される」はこの URL が入るまで満たせない。
- 招待受諾後（`InvitationPreview`）と作成完了後（`CreateWorkspaceForm`）の遷移先は設定「一般」のまま。どちらもそのワークスペースの文脈には入っているので誤りではないが、ノート一覧へ送るほうが WS-01 / WS-04 の読みには近い。

## ADR-082: P-24 のワークスペース別使用量は追加読み込みを所有する島に切り出す

### Context

`getUsageSnapshot` は `workspaceCursor` / `workspaceLimit` を受け `workspaces` / `nextWorkspaceCursor` を返す（AC-14）が、`UsagePanel` はワークスペースの行も「20 件ずつ読み込む導線」も描かず、カーソルも渡していなかった。P-24 の「個人とワークスペースごとの容量・ノート件数」「workspace を 20 件ずつ読み込む導線」が presentation 側で欠けていた。

### Decision

追加読み込みは一覧メンバーシップの変更なので、行ではなく一覧を所有する `"use client"` の島（`UsagePanel/board.tsx`）が server function を持つ。先頭ページはサーバーコンポーネントが `loadUsageSnapshot` で取って島に渡し、以降は `loadMoreWorkspaceUsageFn` が同じユースケースをカーソル付きで呼ぶ。

セクションの描画と数値整形（`UsageSection` / `formatBytes` / `ratioOf`）は `"use client"` を持たない `section.tsx` に置き、サーバー側の個人・LLM とクライアント側のワークスペースが同じものを使う。整形に `Intl` を使わない算術しか含めていないので、サーバーが描いた行とブラウザーが足した行で表記がずれない（`updatedAt` の `Intl` はサーバー側に残す）。

`unavailable` の行は落とさず並べたまま数値だけを落とし、「使用量を取得できませんでした。ほかの表示には影響しません」を出す。ADR-048 が画面に委ねた `workspaceName === null` は「名前を取得できないワークスペース」とし、ID は出さない（閲覧者にとって意味を持たない）。モックにある行ごとの「再試行」は、1 つのワークスペースだけを読み直す入口がユースケースに無いため置かない。

### Consequences

- 追加読み込みは `getUsageSnapshot` を丸ごと呼ぶので個人・LLM の数値も一緒に返るが、島はワークスペースの行だけを使う。「◯◯時点」は先頭ページの `updatedAt` に固定され、ページを繰っても動かない（ユースケースの JSDoc が置いた約束と一致する）。
- ADR-047 のとおりロール絞り込みが後段なので、1 ページ全部が viewer だと行が 0 件のままボタンだけが残る。ボタンの有無は件数ではなくカーソルだけで決める。
- 行ごとの再試行が要るなら、1 ワークスペースだけを読む入口をユースケース側に足す必要がある。

## ADR-083: スラッグの即時検出は共有フックにし、確定した拒否の候補を目安より優先する

### Context

P-30 / P-31 のスラッグ欄は spec/pages が「スラッグ重複の即時検出」を求めるのに、可否を返す読み取りが無い前提で作られていた。`checkWorkspaceSlugAvailability`（UC-workspace-023）が入ったので入力中に照会できるが、判定の出所が 2 つ（入力中の目安と、保存時に返る `SLUG_ALREADY_USED`）になる。

### Decision

`components/workspace/slugAvailability.ts` の `useSlugAvailability` に照会・デバウンス・状態を閉じ、2 画面が同じフックを使う（`slugSuggestions.ts` を 1 か所に置いたのと同じ理由）。表示では**保存が実際に落ちた値の判断を目安より先に採る**。目安は `resolveActive` が settled な予約しか見ない advisory で、予約を取ろうとして負けた側のほうが新しい情報だからである。P-31 は自分の `workspaceId` を添え、いま押さえているスラッグを打ち直しても自分自身との衝突にならないようにする。

`checkWorkspaceSlugAvailabilityFn` は `routes/workspaces/-action.tsx` に 1 本だけ置く。同じユースケースを同じ形で 2 画面が呼ぶだけで、`/workspaces` 配下の入口はここだから。

### Consequences

- 「使用できます」が出ても作成が `SLUG_ALREADY_USED` で落ちうる（並行に取られた場合）。落ちた側でも代替候補が出るので、画面としては閉じている。
- 予約語・字種違反は `WorkspaceSlug.create` が throw するので `problem` として出る。候補は付けない — 打てない一手を勧めないため。

## ADR-084: 招待の受諾には常に確認を挟む（不一致を判定できないため）

### Context

WS-04 は「招待されたメールアドレスと、サインインしているアカウントのメールアドレスが異なる場合、確認したうえで参加させる」と定める。ところが閲覧者自身のメールアドレスを返す読み取りがアプリケーション層に無い（`AuthenticatedUserView` は `userId` / `displayName` / `handle` / `avatarUrl`、`ProfileView` にも email は無い）。presentation からは不一致を判定できない。

### Decision

条件で出し分けず、サインイン済みの受諾に**常に**確認を 1 段挟む。確認は招待先のアドレスと「いまサインインしているアカウントが参加する（招待リンク自体が認可の根拠）」ことを述べる。判定できない以上、見逃す側ではなく常に確認する側へ倒す。

### Consequences

- WS-04 基本フロー 4 の「『参加する』を選ぶとメンバーになる」が 2 クリックになる。`spec/manual-tests/workspace.md` の TC-03 / TC-04 / TC-30 と `.thread/3/testing.md` 項目 6 / 7・エッジケース 4 をこの形に合わせた。
- `AuthenticatedUserView` に email が載れば、確認を不一致時だけに絞れる。載せるかどうかは identity 側の判断（メールアドレスをセッション probe の投影に含める是非）なので、本スライスでは触らず報告に回す。

## ADR-085: 使えない招待は理由ごとに分け、実在しないトークンだけ理由を持たない

### Context

`InvitationPreview` は期限切れ・取り消し済み・使用済み・ワークスペース削除済み・不在トークンを 1 つの「この招待は使えません」に畳んでいた（P06 のモックもそう描いている）。一方 spec/pages P-06 の状態一覧と WS-04 異常系は「その旨を表示し、招待者への連絡を促す」と、状態ごとの表示を求める。

### Decision

`getInvitationPreview` が返す 4 つの状態はそれぞれ固有の見出しと案内にする。**分けてよいのはトークンが実在した場合だけ**で、`invitationNotFound`（届かないトークン）は理由を持たない「この招待は使えません」に据え置く — 状態を答えること自体が、そのトークンが実在するという答えになるため。

### Consequences

- モック `P06-invitation.html` の「状態 4 — 期限切れ / 取り消し済み / 使用済み（同じ表示）」は spec/pages に対して古い。実装は spec/pages に合わせた。
- 再送で失効した旧リンクは「取り消し済み」ではなく不在トークン側に落ちる（トークンが入れ替わるため）。手順書にその旨を書いた。

## ADR-086: 最後の owner の行内保護は到達しないので置かない

### Context

`WorkspaceMembersBoard` は他人の行にも「最後の owner は降格も除名もできません」の行ヒントを描き、セレクターと除名ボタンを無効化していた。だがロール変更・除名を出せるのは `canManage`（= owner）の閲覧者だけで、その閲覧者自身が owner を 1 人数える。他人が唯一の owner という状態は成立せず、`isLastOwner && !isSelf` は管理者には決して真にならない。真になるのは `canManage` が false の閲覧者（editor / viewer）のときだけで、そこでは操作自体が描かれないため、禁止の理由だけが宙に浮いて出ていた。

### Decision

行内の保護（`LAST_OWNER_ROW_HINT_ID` とその `aria-describedby`、`isLastOwner` によるセレクター・除名ボタンの無効化）を落とす。`isLastOwner` は「自分が唯一の owner」だけを意味する props にし、脱退の無効化と説明にのみ使う。サーバーの `MembershipPolicy` は変えないので、想定外の経路で降格が来ても拒否は効く。

### Consequences

- WS-05「最後の owner を降格・除名できない」の画面表現は、自己変更・自己除名の禁止（セレクターを出さない / 除名を出さない）が先に効くことで満たされる。ADR-074 が「並行窓の執行形」で同じ順序を採ったのと一致する。
- 脱退の説明には WS-06 が促すもう一方の代替として、削除タブへのリンクを添えた。

## ADR-087: 作成後はメンバー管理へ、受諾後はノート一覧へ送る

### Context

ADR-081 は「招待受諾後（`InvitationPreview`）と作成完了後（`CreateWorkspaceForm`）の遷移先は設定「一般」のまま」を積み残しとして残していた。ワークスペース文脈のノート一覧が入ったので、行き先を確定できる。

### Decision

2 つの遷移先は**別々の画面**にする。同じ「そのワークスペースの文脈」でも、シナリオが要求しているものが違うためである。

- 作成完了（WS-01 手順 4）→ `/workspaces/:workspaceId/settings/members`（P-32）。手順 4 は「切り替わり、**メンバー招待への導線が表示される**」で、P-30 の終状態も「作成完了（招待への導線）」、PAGE-p30-002 も「新 workspace context と P-32 の invitation 導線を表示する」と書く。招待の入口を持つ画面は P-32 だけなので、ノート一覧へ送ると導線が消える。空の一覧に招待 CTA を足す案は採らない（spec に無い UI を作らないため）。
- 招待受諾（WS-04 手順 4）→ `/workspaces/:workspaceId/notes`（P-10）。手順 4 は「メンバーになり、そのワークスペースの**一覧へ**遷移する」。既参加のリンクを再訪したときの「{名前} を開く」も同じ行き先に揃えた（WS-04 異常系「参加済みである旨を示してワークスペースへ遷移する」）。

### Consequences

- ADR-081 Consequences の 3 点目（遷移先が設定「一般」のまま）は解消した。
- `spec/manual-tests/workspace.md` の TC-01 / TC-03 / TC-04 / TC-31 と `.thread/3/testing.md` の項目 1 / 6・エッジケース 4 を、それぞれの行き先に合わせて直した。

## ADR-088: ノート詳細の URL 正規化はクライアント側で行う

### Context

ADR-081 Consequences の 2 点目のとおり、ノート詳細のワークスペース文脈 URL（`/workspaces/:workspaceId/notes/:noteId`）が無く、OR-12 /  P-11 の「移動後に旧文脈のアプリ内 URL を開いた場合は、新しい所属先の文脈の URL へ正規化（リダイレクト）する」と PAGE-p10-005「current scope 用 P-11 URL へ遷移する」が満たせなかった。

### Decision

一覧（ADR-081）と同じく、2 つのルートが同じ `NoteDetail` を描く。文脈は URL から来て、ノートの所属先と食い違ったときだけ正規な URL へ送り直す。

- 正規化は**サーバーの redirect ではなくクライアントの `router.navigate({ replace: true })`** で行う（`NoteDetail/normalize.tsx`）。断片の中で throw したものは Flight を素の Error として渡り（`InvitationPreview` が終端表示を自前で描いているのと同じ制約）、リダイレクトではなくエラー表示になるためである。ハンドラー側で先に判定する案は、所属先を知るのに `getNote` を待つことになり断片のストリーミングを潰すか、認可前に所属先を解決して**閲覧できないノートの workspaceId を URL に出す**かのどちらかになる。判定を `getNote` の後ろに置けば、その 2 つをどちらも踏まない。
- 移動後の URL も同じ経路に乗せる。`NoteDetailMenu` は `router.invalidate()` までを行い、読み直した `NoteDetail` が新しい所属先を見て URL を動かす（PAGE-p11-009）。正規化の判断を 1 か所に閉じるため。
- ワークスペース版のブリッジは一覧と違って `getWorkspaceSettings` を読まない。この画面が読むのはノート 1 件だけで、その認可は `getNote` が持つ（非メンバーも削除済みも `NOTE_NOT_FOUND` に収斂し、P-11 の「見つかりません」になる）。URL の `workspaceId` は所属先の照合にしか使わない。
- 読むシェル（L-01 の変形）は `components/layout/ReaderShell` に出し、戻り先だけを文脈から受ける。

### Consequences

- 旧 URL を開くと、いったんノートが描かれてから URL が置き換わる。中身は同じなので画面のちらつきは無く、履歴も `replace` で汚れない。
- `/workspaces/:workspaceId/notes.tsx` は `notes/index.tsx` へ移した（`$noteId.tsx` を兄弟に置くため）。`to: "/workspaces/$workspaceId/notes"` の呼び出し側は index ルートに解決されるので変更不要。
- `spec/manual-tests/organize.md` の TC-13 に URL 正規化の手順を足し、`.thread/3/testing.md` 項目 17 が「対象外」としていた「アプリ内 URL が新しい文脈のものに変わること」を判定対象へ戻した。

## ADR-089: セッションの投影に email を載せ、招待の確認は不一致のときだけ出す

### Context

ADR-084 は「閲覧者自身のメールアドレスを返す読み取りがアプリケーション層に無い」ことを理由に、招待の受諾へ**常に**確認を挟んでいた。WS-04 が確認を求めるのは「招待されたメールアドレスと、サインインしているアカウントのメールアドレスが異なる場合」だけなので、一致している人には手順 4 の 1 クリックが 2 クリックになっていた。

### Decision

`AuthenticatedUserView` に `email` を足す（`spec/usecases/identity.md#authenticateSession` の出力 DTO も同時に改訂）。この投影を選んだのは**到達経路が構造的に本人に閉じている**ためで、入力が session token しか無い以上、返るのは常に呼び出し元自身のアドレスになる。`ProfileView` は `userId` を入力に取るので、同じ保証は型の側からは出てこない。

露出は 2 段で絞る。

- 転送境界: `presentation/auth.ts` の `ViewerView` / `toViewerView` が `email` を落とす。シェルへ `user` を渡すブリッジ（`sessionUserFn`、`/notes`、`/workspaces/:id/notes`、`/workspaces/:id/settings/*`、`/workspaces/new`）はこの投影を返すので、アドレスがクライアントのペイロードへ載る画面は 1 つも無い。
- 招待画面: `renderInvitationPreview` はアドレスをサーバーコンポーネントへだけ渡し、`InvitationPreview` が招待先と突き合わせて `mismatched: boolean` だけをクライアントの島へ渡す。どちらも `Email` の正規形なので単純な一致で判定できる。

### Consequences

- ADR-084 を解消した。一致していれば「参加する」の 1 クリックで参加し、不一致のときだけ確認（「招待先とは別のアカウントでサインインしています」）が挟まる。
- `spec/manual-tests/workspace.md` の TC-03 / TC-04 / TC-30 と `.thread/3/testing.md` 項目 6・エッジケース 4 を、確認が条件付きで出る形に直した。
- `TC-identity-008` の投影の期待値に `email` を足した。

## ADR-090: `viewerFor` は workspace 不在を `workspaceRole: null` へ縮退させる

### Context

ADR-046 は「workspace 不在は `resolveWorkspaceAccess` が投げる `WORKSPACE_NOT_FOUND` をそのまま通す」と決めたが、`accessControl.viewerFor` だけはその向きが噛み合っていない。削除サガが Workspace 行を消してからノートを消すまでの窓で、匿名の閲覧者は workspace を一切引かないため公開ノートを読めるのに、サインイン中の閲覧者は `WORKSPACE_NOT_FOUND` で落ちる。同じノートの見え方がサインインの有無で変わり、`spec/usecases/note.md` 共通手順 5（権限が無ければ `NOTE_NOT_FOUND`）とも種別が異なる。

### Decision

`viewerFor` の workspace 経路だけ `NotFoundError("WORKSPACE_NOT_FOUND")` を握って `workspaceRole: null` に縮退させる。それ以外のエラーは再送出する。`viewerFor` は入口検査ではなく**閲覧者コンテキストの構築**であり、「この人が持つ workspace ロールは無い」は不在でも非メンバーでも同じ事実だからである。判定は後段の `NoteAccessPolicy` が一手で行い、public / unlisted は読め、それ以外は `NOTE_NOT_FOUND` に落ちる。

ADR-046 の「不在をそのまま通す」は入口として workspace を要求する経路（`createBlankNote` / `storeAvatar` / `recalculateStorageUsage` / `listNotes`）にはそのまま残す。そこでは workspace そのものが操作対象なので、不在を隠す理由が無い。

### Consequences

- `getNote` は削除中ワークスペースの公開ノートを、サインインの有無に関わらず同じ答えで返す。
- `moveNote` は `canEdit` を要求するので、縮退後は `WORKSPACE_NOT_FOUND` ではなく `NOTE_NOT_FOUND` を返す。移動先の存在確認は `resolveTargetOwner` が別に持つため、TC-note-242（不明な移動先）は変わらない。
- `listNotes` の workspace 認可分岐（ADR-060）に member / 非メンバー / 不在ワークスペースの 3 ケースを足し、認可境界に検出力を入れた。

## ADR-092: 保留中招待の絞り込みを store 側へ移し、ADR-034 を置き換える

### Context

ADR-034 は `listPendingInvitations` の `count` を「射影後の `invitations.length`」と決め、その Consequences に反証条件を明記していた —「保留中が 1 ページ（既定 50 件）を超えると `count` が総数ではなくページ内件数になる。総数が要るなら status 別の count をポートへ足す必要がある」。

実際に踏むのは超過ではなく逆向きの形だった。`InvitationRepository.listByWorkspace` は status を絞らず `createdAt DESC, id DESC` を返すので、直近 50 件が accepted / revoked のワークスペースでは page 1 の全件が終端状態になり、ページング**後**に `Invitation.isPending` で絞る実装は「保留中の招待なし」を表示する。保留中の招待は実在するのに P-32 のメンバー管理画面から消える。`count` がページ内件数であることも、ページャを駆動できない点で同じ穴の裏面である。

### Decision

ADR-034 を置き換える。ポートへ `listPendingByWorkspace(workspaceId, pagination)` を新設し、絞り込みを store 側で行う。`listByWorkspace` は全ステータスのまま残す — 削除 manifest（`workspaceDeletionLocal`）はその列挙を必要とするため。`count` は保留中の総数になり、ユースケースは `page.count` をそのまま返す。

期限切れは status ではないので、`listPendingByWorkspace` は lapsed な `pending` を返し続ける。画面は `expired` フラグ付きで表示し、再送を提供する。

ADR-026 のとおりポート JSDoc と適合スイートを対で触った（ADP-workspace-022b: 終端行がページを空にせず count も縮めないこと / lapsed が残ること）。memory と Cloudflare DO の両バックエンドが同一スイートを通す。

### Consequences

- ADR-034 が守ろうとした「画面の件数と一覧の行数が一致する」は、1 ページに収まる限り同値のまま保たれる。溢れた場合はページャが正しく総数を知る側へ倒れる。
- ADR-034 が予告した「status 別の count をポートへ足す」を、count 単体ではなくページング付きの listing として実現した。総数と行の両方が 1 往復で揃う。
- 既存テストの期待値（ページ内 count）を更新し、検出力として TC-workspace-178b（終端招待 60 件が既定 1 ページを埋めても保留中が見える）と TC-workspace-178c（`count` が総数）を足した。
- `WorkspaceReader` の `invitation` Pick に `listPendingByWorkspace` を追加した（`application/di/types.ts`）。読み取り専用メソッドなので UoW の外で引ける点は `listByWorkspace` と変わらない。

## ADR-091: membership edge の directory 解決は 1 本の共有ヘルパーに閉じる

### Context

`listUserWorkspaces` と `getUsageSnapshot` は、どちらも「membership edge のページ → `WorkspaceDirectoryBatchReader.resolveMany` → `deleted` / `unavailable` / `active` の 3 分岐 → 欠損キーは `unavailable` へ縮退」を行う。両者は独立に書き写されており、`listUserWorkspaces` 側だけが TC-workspace-200 / 201 と「never-projected」ケースで 3 分岐を拘束していた。usage 側の `deleted` / `unavailable` は 1 度も実行されず、`switch` を `active` だけに縮退させても全テストが緑になる状態だった。

### Decision

`application/workspace/directoryResolution.ts` に `resolveWorkspaceEdges` を置き、両ユースケースから呼ぶ。返す `ResolvedWorkspaceEdge` は `active` / `unavailable` の 2 変種だけを持ち、`deleted` は行の不在で表す — 「欠損キーを削除と読んではならない」というポート契約を、呼び出し側が破れない形にする。投影の中身（`UserWorkspaceView` か `WorkspaceUsageView` か）は各ユースケースが決め、ヘルパーは「どの edge が生き残るか」だけを決める。

### Consequences

- 3 分岐の検出力が 1 箇所に集約され、`listUserWorkspaces` のテストが usage 側も守る。変異チェックで、`deleted` を落とさない変異は両ファイルのテストが、`unavailable` を落とす変異は 4 ケースが red になることを確認した。
- usage 側は `targets` / `degraded` / `byId` の再組み立てが不要になり、`mapBounded` を行そのものに掛けて edge 順を保つ形へ縮む。`unavailable` 行は scope RPC を出さないので、同時 scope 読みの上限 6 は変わらない。

## ADR-095: P-43 の `head` 用にワークスペースの名前・説明をブリッジが素の値で返す

### Context

`PAGE-p43-001` は公開ページに metadata を要求するが、`/w/:slug` の `head` はブリッジが返す断片（未解決の promise）の中身に届かないため、すべての公開ワークスペースが同じタイトル・同じ説明で共有カードと検索結果に並んでいた。公開区分の画面なので、ここが区別できないことの影響は他の画面より大きい。

### Decision

`renderPublicWorkspace` が `getPublicWorkspace` を読み、`{ name, description }` だけを断片とは別の素の値として返す（設定レイアウト / ワークスペース版ノート一覧と同じ形）。`head` はこの値からタイトルと `description` を組み、`buildHead` が `og:*` / `twitter:*` まで広げる。

- 見つからないスラッグはブリッジでは `null` に畳み、head を既定へ倒すだけにする。終端表示（非公開・削除済み・不在・不正スラッグを 1 つに畳む）は断片側が描くという ADR-067 の形を動かさない。`notFound` 以外の失敗はそのまま投げ、ルートの `errorComponent` に渡す。
- 結果としてこの画面は `getPublicWorkspace` を 1 リクエストにつき 2 回読む。ブリッジのハンドラーは RSC の render scope の外なので、断片側の `cache()` は共有されない。断片へ view を渡して 1 回にする案は `PublicWorkspacePage` の入力を「解決済みの view」へ変えることになり、この画面の「スラッグから引く」責務が呼び出し側に散る。

### Consequences

- 公開ページのタイトルがワークスペース名になり、説明が空でなければ `description` / `og:description` に載る。空のときは既定の説明のままにする（空文字を書き出すと既定より悪い）。
- 読みが 2 回になる。公開ページは匿名から叩ける URL なので、投影のキャッシュを入れるならこの経路が最初の対象になる。

## ADR-096: 追加読み込みの失敗は一覧を残したまま添え、移動先候補は `nextCursor` が尽きるまで辿れるようにする

### Context

`ScopeToken` は「さらに読み込む」が 1 回失敗しただけで `failed` に差し替わり、表示済みの一覧が消えていた。`NoteMovePicker` は 1 ページ目しか読まず、`listUserWorkspaces` の 1 ページが 20 件である以上 21 件目以降のワークスペースへ移動できない。しかも editor 以上への絞り込みはページを引いた**後**に行うので（`listMoveTargetsFn`）、1 ページ目が全部 viewer なら候補は 0 件と表示されていた。

### Decision

どちらも `loaded` に `pending` / `error` を持たせ、追加読み込みの失敗は一覧に添えるエラー欄にする。ボタンはそのまま再試行の入口として残し、`pending` の間は無効化する（同じカーソルの二度押しで同じページが二重に積まれるため）。

`NoteMovePicker` は `nextCursor` を保持して「さらに読み込む」を出す。「移動できる先がありません」は `nextCursor === null` のときだけ出す — 後段で絞る形である以上、候補 0 件と候補の終わりは別物である。ロール絞り込みをポートの述語へ移す案は採らない（`listActiveByUser` は viewer も要るスコープトークンと共有する読みで、ADR-047 と同じ理由）。

### Consequences

- 一覧が消えないので、`ScopeToken`（「今どこにいるか」の唯一の入口）が一時的な失敗で空にならない。
- 移動先の候補はワークスペース数に比例して手数が増える。追加読み込みを繰り返せば全件に届くので、`PAGE-p11-009` / `PAGE-p10-007` の到達性は満たす。

## ADR-093: 設定 3 画面は読み取りユースケース 3 本を直接呼び、拒否は `kind` で畳む

### Context

ADR-056 / 058 / 059 は `getWorkspaceSettings` / `getWorkspacePublication` / `getWorkspaceDeletionStatus` を置いたが、画面側は ADR-054 の暫定（`components/workspace/settingsRead.ts` が `resolveWorkspaceAccess` に射影と `WorkspaceAuthorization.can` を足す）のままだった。そのため 3 画面の可否がすべて `canManage` に潰れ、P-33 の公開ノート件数は公開**後**にしか出ず、P-34 の「実行中 / 完了」を読む経路が無かった。

### Decision

`settingsRead.ts` を消し、P-31 → `getWorkspaceSettings`、P-33 → `getWorkspacePublication`、P-34 → `getWorkspaceDeletionStatus` → `getWorkspaceSettings` の順に呼ぶ。読み出しは各コンポーネント直下の `action.ts`（`WorkspaceMembersPanel` と同じ置き場）に置き、view は core の型をそのまま使う。

- 可否は画面ごとに違うフラグで閉じる。P-31 は `canManage`、P-33 は `canPublish`、P-34 は `canDelete`。権限表が今どれも owner を要求することは画面の関心ではない。
- 非メンバー（`InsufficientRole`）と削除済み（`WORKSPACE_NOT_FOUND`）は、断片の中で `serializeError(...).kind` を見て終端表示へ畳む。断片の中で `throw` すると Flight が素の Error を運んで `kind` タグが落ちるため（`WorkspaceMembersPanel` と同じ理由）。`instanceof` は使わない。
- 設定レイアウトのシェル（`loadWorkspaceSettingsShell`）も同じ 3 kind を `workspace: null` へ畳む。判定はユースケースが持ったままで、ここでやるのは表示への写像だけ。シェルごと落とすと閲覧者名も失われ、個人の文脈への導線（WS-02）が出せなくなる。
- P-34 は進行を先に読む。削除が終わったワークスペースには行が残らず `getWorkspaceSettings` は `WORKSPACE_NOT_FOUND` を投げるので、2 本を並列にすると「完了」を描けない。
- スラッグ欄の接頭辞に要る配備のオリジンだけは、どの DTO にも無い設定値なので P-31 の読み出しが `config.appUrl` を添えて返す。P-33 の公開 URL は `getWorkspacePublication` の `publicUrl` に寄せ、presentation では組み立てない。

### Consequences

- ADR-054 は撤去。presentation から `@repo/core/domain/*` の import と認可判定が消え、同じ処理が 2 か所にある状態も解消した。
- P-33 は公開前から件数と「0 件なら空のまま」の注意を出せる（ADR-058 の目的）。切り替えの楽観状態は `published` / `publicUrl` / `publicNoteCount` を 1 つの patch reducer に束ね、`publishWorkspace` の応答が持つ確定値を再取得を待たずに書き戻す。
- P-34 の「実行中」は再訪時に `deleting` を読んで描き、受理直後の表示と同じ画面に畳む（違うのは見出しだけ）。受理後は受理を描いたうえで `/notes` へ送り直し、WS-10 手順 4 の「個人の文脈へ遷移する」を満たす。
- 「完了」は行の不在なので、設定レイアウト自身も同時に `workspace: null` に落ちる。断片が単独で完了を描くのは、シェルと断片の読みの間で削除が終わった窓だけである。

## ADR-097: 移動の requestKey は `noteId:target:routeVersion` にし、合流した operation では前進しない

### Context

`beginOrResume` の契約は「同じ requestKey は同じ operation を replay し、**別の requestKey は走行中の operation に合流する**」。`moveNote` は戻り値の requestKey を見ずに合流先の payload を自分の plan として採用していたため、switch 済みの移動が settle されずに `running` で残っている状態で同じノートを別のワークスペースへ移すと、pre-switch abort が「唯一の実体である staged copy」を消してノートと revision を完全に失う（レビュー B-001）。

修正実行計画の方針 1 は requestKey を `noteId:targetScope` に固定するとしていた。しかし memory / D1 いずれの `beginOrResume` も **terminal な同一 requestKey の行をそのまま返す**（`sameRequest` は state を見ない）。`noteId:target` だけを鍵にすると、個人 → WS-A → 個人 → WS-A という往復で 3 回目の移動が 1 回目の **completed な operation を再生**し、target に残った `applied_operations` の記録により手順 6 が丸ごと skip され、空の target へ route が切り替わる。ADR-080 が塞いだのと同種のデータ消失が別の入口から開く。

### Decision

requestKey を `${noteId}:${serialize(target)}:${route.routeVersion}` とし、戻った operation の `requestKey` が自分のものでなければ `ConflictError("NOTE_MOVE_IN_PROGRESS")` を返して前進しない。

- `routeVersion` は「この移動が出発する route の世代」である。失敗した移動は route の世代を進めない（`abortMove` は世代を据え置き、claim に失敗すれば触れてすらいない）ので、**同じ移動の再試行は必ず同じ鍵**に落ちる。世代を進めるのは `switchMove` だけなので、**別の移動は必ず別の鍵**になる。方針 1 の目的（再試行の replay）を満たしつつ、往復による terminal 衝突を型どおりに排除する。
- 合流した operation で前進しないのは、合流先の plan が自分の要求ではないからである。応答を plan から組み直しても、その plan の source は自分が確認した source ではなく、abort は自分が stage していない scope を巻き戻す。合流は control plane の便宜であってサガの再開ではない。
- 併せて `plan.source` / `plan.target` が要求の 2 scope と一致することを検査し、外れていれば `SystemError(DataIntegrityError)` にする。鍵が一致する以上一致しないのは payload の破損であり、競合ではない。

### Consequences

- switch 後に落ちて `running` のまま残った operation があると、そのノートの**以後の移動はすべて** `NOTE_MOVE_IN_PROGRESS` で拒否される。データを失うより止まるほうを選んだ結果で、駆動口（recovery cron / scope alarm）は Issue #28 のまま。`moveNote` の JSDoc に明記した。
- `expectedVersion` は鍵から外れたので、転送境界が版を持つかどうかが operation の同一性を左右しなくなった（レビュー frontend B-002 の 2 点目）。
- 「同じノートの移動が進行中」の spec エラー表に、要求が一致しない場合の 1 行を足した。

## ADR-098: `moveNote` の `expectedVersion` は `number | null` にして、恒真な検査をやめる

### Context

ADR-066 は「`getNote` が版を返さないので、`moveNoteFn` は呼ぶ直前に `ScopeRouter` → `NoteReader` で版を引いて渡す」と決めていた。ところが `moveNote` 自身も同じ行を読んでから `stored.expectedVersion !== input.expectedVersion` を判定するので、**この検査は常に通る**（レビュー frontend B-002 の 1 点目）。楽観ロックがあるように見えて無い状態で、presentation が読み取りポートを直に叩く代償だけが残っていた。

### Decision

入力を `expectedVersion: number | null` にする。`null` は「版を持たない呼び出し元」を表し、そのとき版の検査は**行わない**。`moveNoteFn` は `null` を渡し、`scopeRouter` / `noteReaderFor` の直読みをやめる。

- ADR-066 の判断そのもの（転送境界で版を受け取らない）は維持する。変えたのは「持っていない版を作って渡す」のをやめ、持っていないことを型で表した点だけである。失われる防護は ADR-066 が既に代償として認めた 1 つと同一で、増えていない。
- `getNote` が版を返すようになったら、画面が見た版を転送境界で受け取って `number` を渡す。そのとき初めて PAGE-p11-009 が字義どおり満たされる。

### Consequences

- `spec/usecases/note.md#movenote` の入力 DTO を `expectedVersion: number | null` に改めた。
- 応答の `version` は「要求側の版 + 1」ではなく **target に staged された実体の版**を返すようになった（`stageTarget` が返す）。再開で staging を skip した場合は target の行を読み直す。

## ADR-099: switch 済み operation の再開（fix-plan G1 方針 2）は本ラウンドでは実装しない

### Context

方針 2 は「`NoteRoute` が『switch 済みかつ最後の switch が自分の migrationId』を表現できるようにし、switch 済みなら `claimRoute` と pre-switch 三脚を飛ばして `activateTarget` / `retireSource` だけ回す」。これは `snapshotSource` の `reauthorize: false`（W-010）の実在する呼び出し元にもなる。

再開を検出するには、route が指す先が自分の target であることに加えて **その switch を行った migration の id** が要る。`moveNote` の事前確認は route が既に target を指しているとき「所有者が同じ」の早期 return に落ちるので、走行中 operation の存在に気づく手掛かりが他に無い。id を得る道は 2 つしかない。

1. `NoteRoute` に `lastMigrationId` を出す（`application/ports/noteRouteStore.ts` ＋ memory / D1 の両アダプター ＋ 適合スイート）。行そのものは両アダプターに既にある。
2. 早期 return の枝でも `beginOrResume` を呼ぶ。走行中が無ければ operation を**新規に作ってしまう**ので、無変更の移動が制御行を書き、`TC-note-244`（無変更・無イベント）が崩れる。

1 は本グループの担当ファイル外（並行して別のグループが動いている）、2 は spec の「移動先が同じ → 変更もイベントもなく成功」に反する。

### Decision

方針 2 は実装せず、報告に回す。W-010 はレビューが挙げたもう一方の案（引数を落とす）で閉じ、`snapshotSource` から `reauthorize` を削って「このフェーズに来る leg は必ず switch 前である」を型と JSDoc の両方で言い切る。

### Consequences

- switch 後に落ちた移動を前進させる入口は引き続き無い（ADR-076 の状態のまま）。ADR-097 により、その状態のノートは**以後の移動も拒否される**ようになったので、駆動口（Issue #28）の優先度は上がった。
- 実装するときは `NoteRoute.lastMigrationId` を公開するのが最短で、`DistributedOperationStore.findByOperationId` は既にあるため port の追加は 1 フィールドで足りる。`TC-note-265` / `-266` / `-269` の「再要求は前進しない」半分は、そのとき「前進する」へ書き換わる。

## ADR-100: 除名・脱退の `removing` 宣言に打ち消し遷移を足し、`beginRemoval` は `activating` を吸収する（ADR-045 の「可視の停止」を置き換える）

### Context

ADR-041 は「宣言後に拒否されると edge が `removing` のまま残る」窓を、ガードを 2 度走らせることで閉じたと主張していた。しかし 2 度目の評価は**終端的なビジネス規則で落ちうる**（レビュー B-001）。`MembershipDirectoryReservationStore` には `removing` から戻る遷移が無く、`completeRemoval` は `removing` を消すだけなので、落ちた側の利用者はメンバーのままワークスペースを一覧から永久に失う。再実行しても同じ規則が先に拒否するので API では回復できない。

同じ「戻れない `removing`」の裏返しが ADR-045 の Consequences にある。join の `activate` 応答が失われて `activating` のまま残った edge に削除サガの cleanup が当たると、`beginRemoval` が `ConflictError` を返して turn が backoff → 駐車する。ADR-045 はこれを「握り潰して ack すると stale edge が残るので、可視の停止を選んだ」と決めていた（レビュー W-001）。だが停止した削除は `markCompleted` に到達せず、admission tombstone も立たず、**運用者が動かす手立てが無い**。可視ではあるが復旧不能である。

### Decision

ポートに `abandonRemoval(userId, workspaceId)`（`removing → active`）を足し、`removeMember` / `leaveWorkspace` の書き込み UoW が失敗したときに呼ぶ。他の 2 遷移と同じく目標状態で冪等（`active` / 不在は成功、`pending` / `activating` は `ConflictError`）。

あわせて `beginRemoval` の契約を「`active` に加えて `activating` も吸収する」に緩め、ADR-045 の「可視の停止」を**置き換える**。scope が「メンバーシップは無い / 消す」と答えている以上、edge の未確定な claim を理由に除名や削除を止める理由は無い。負けるのは join の `activate` の側で、その補償 `abandon` は `pending` / `activating` にしか当たらないので除名を巻き戻すことはできない。`pending` は account deletion の prepare lock が持つ状態なので拒否のまま残す。

`WorkspaceOperationLockStore` 側の変更は無く、cleanup turn（`workspaceDeletionGlobal.ts`）のコードも変えていない — 契約が緩んだことで駐車しなくなる。

### Consequences

- 除名・脱退は「宣言 → 拒否 → 宣言を取り消す」の 3 相になり、拒否された側の edge は `active` に戻る。適合スイートに ADP-workspace-074 の 3 ケースを足した。
- `activate` を失った join は、除名・削除に負けたときに `MEMBERSHIP_EDGE_CONFLICT` を受ける。join の再実行は edge が消えた後なら新しい join として成立する。
- ADR-045 の Consequences 第 3 項（駐車を選ぶ）はこの ADR で無効になる。ADR-037 の「`pending` / `activating` への両操作は `ConflictError`」も `beginRemoval` については無効。
- 補償は「対象のメンバーシップが既に消えている」ときだけ打たない（`MEMBERSHIP_NOT_FOUND`）。並行する除名が先に着地した場合で、そこで戻すと除名済みの利用者の一覧にワークスペースが甦る。その edge は勝った側の `completeRemoval` が落とす。
- D1 の `membership_directory` は `(state IN ('pending','activating')) = (reservation_expires_at IS NOT NULL)` を CHECK しているので、`activating → removing` では `reservation_expires_at` を NULL にする。マイグレーションは不要。

## ADR-101: ワークスペース書き込みの actor 認可を書き込み UoW の中でもう一度行う

### Context

`updateWorkspaceProfile` / `changeWorkspaceSlug` / `publishWorkspace` / `unpublishWorkspace` / `deleteWorkspace` / `inviteMember` / `resendInvitation` / `revokeInvitation` / `changeMemberRole` / `removeMember` は、いずれも `resolveWorkspaceAccess` を UoW の**外**で引いて権限を決め、UoW の中では actor の Membership を読み直していなかった（レビュー W-003）。Workspace の OCC は Membership の変化を捕まえないので、降格・除名の直後に着地する in-flight 要求は失われた権限で書き込める。`spec/usecases/workspace.md` 冒頭が投影遅延の安全性の根拠にしている「mutation 直前の local 権限確認」は実装に存在しなかった。

### Decision

`membershipMutation.ts` に `ensureActorCan(ctx, workspaceId, actorUserId, action)` を置き、上記すべての書き込み UoW の中で呼ぶ。UoW 外の `resolveWorkspaceAccess` は早期拒否として残す（global 予約を取る前に落とす価値がある）。`leaveWorkspace` は actor と対象が同一で、`requireRemovableMembership` が UoW 内で本人の Membership を読むため足さない。

呼ぶ**位置**は 2 通りに分かれる。ワークスペース単位の書き込みと招待 3 件は barrier（`assertWritable`）の直後に置く。メンバーシップ変更 2 件（`changeMemberRole` / `removeMember`）は対象側の規則（`ensureNotSelfRoleChange` / `ensureNotSelfRemoval` / `ensureOwnerRemains`）の**後**に置く。どちらでも書き込み前に必ず走るので安全性は同じで、違うのは複数の拒否が同時に成り立つときにどれを報告するかだけである。

### Consequences

- 「最後の owner を残す」は誰が要求しても真なので、対象側の規則を先に答える。逆順にすると `TC-workspace-022` / `TC-workspace-211` が要求する `LastOwnerCannotLeave` は**到達不能**になる — `manageMembers` を持つ actor は同じワークスペースの最後の owner ではありえないので、in-tx の actor 検査が常に先に落ちるからである。ADR-074 が執行形にした並行窓は、この順序でだけ残る。
- 書き込み UoW ごとに Membership の読みが 1 回増える。scope object 内の読みなので往復は増えない。
- 新しい write 入口は `assertWritable` の 1 行に加えてこの 1 行も必要になる。型は助けないので、テストが網である（`removeMember.test.ts` / `updateWorkspaceProfile.test.ts` の降格窓）。

## ADR-102: 決定的 operation ID を共有する slug 予約の補償は「自分の commit が落ちたとき」に限る

### Context

ADR-030 は `changeWorkspaceSlug` の予約 operation ID を `workspace.changeSlug:{workspaceId}:{slug}` と決定的に導出し、「同じ workspace が同じ slug を短時間に取り直す 2 つの要求は 1 行を共有する。どちらも同じ結果へ収束するので実害はない」と結論していた。これは `reserve` と `activate` については正しいが、**`abandon` については誤り**だった（レビュー B-002）。`abandon` は「この operation の `reserved` 行を落とす」だけを条件にしており、どの試行が作った行かを区別できない。OCC で負けた試行の補償が、勝った試行がまだ `activate` していない行を落とす。結果は「scope は新 slug を持つが global に予約が無い」で、同じ slug への再実行は早期 return するため API からは回復できない。

### Decision

補償の直前に workspace を読み直し、`slug` が既に新 slug になっていれば `abandon` を打たない。判定の正本は scope（どの試行の commit が着地したか）で、予約側には答えが無いためこの向きにする。ポート契約（`reserve` の応答に新規作成かどうかを載せる案）は変えない — 変更が 3 バックエンドと適合スイートに波及する一方、得られる情報は scope の読み 1 回で足りるため。

### Consequences

- 補償パスに読みが 1 回増える。失敗パスだけなので通常経路の往復は変わらない。
- 落とせなかった予約行は TTL の回収に委ねる（`compensate` と同じ扱い）。
- ADR-030 の Consequences「実害はない」をこの ADR が限定する: 実害が無いのは `reserve` / `activate` の冪等性についてのみで、補償は試行を区別しなければならない。

## ADR-103: 「まだ動かない」は canon ではなく `.thread/3/testing.md` が持つ

### Context

本スライスの実装中、`spec/manual-tests/` へ「本スライスの対象外（Issue #N 待ち）」の注記が 21 箇所入り、あわせて手順書が UI 文言を約 50 箇所逐語引用する形へ書き換わった（レビュー general B-001 / W-001）。どちらも動機は同じで、Phase 4 の実行者が迷わないようにすることだった。

しかし `spec/` は現在有効な要件と設計の canon であり、進捗ログを持たない。「Issue #9 待ち」は Issue が閉じた瞬間に偽になり、外部の可変な参照にも依存する。逐語引用のほうは `spec/manual-tests/index.md` の記述規約に正面から違反しており、文言を 1 語直しただけで正しい実装が FAIL 判定される形を canon に固定してしまう（文言の正本は `spec/design/` にある）。

### Decision

- 21 箇所の進捗注記を canon から落とし、`.thread/3/testing.md` の「本計画で扱わないもの」表へ集約する。手順書には「こう動くべき」だけを残す。
- 逐語引用を「挙動と伝わるべき情報」へ戻す。今回の書き換えが本当に足したかった価値 — 画面の同定（URL・パス・設定タブ名・スコープトークン）と分岐の明確化（一致 / 不一致で確認が入るか、コピー操作が発行直後だけに出るか） — は保つ。URL・パス・ロール名・ワークスペース名は規約が逐語を許すのでそのまま残す。
- 恒久的にスライスへ依存しない情報は canon に残す（参照ランタイムでは招待リンクを `mail.sent` ログの `actionUrl` から読む、など）。

### Consequences

- Phase 4 の実行性は落ちない。具体は `.thread/3/testing.md` が既に持っており、`.thread/` は canon ではないので逐語で書いてよい。
- 手順書と実装のあいだに「未実装だから FAIL する手順」が残るが、それは失敗として記録しないことが `.thread/3/testing.md` の表で宣言される。手順書の側にその表への注記は書かない（書けば同じ問題が戻る）。
- 「対象外」を canon に書いてよいのは `spec/manual-tests/account.md` のカバレッジ表がやっているような**恒久的な理由**（UI から再現できない・手動では時間がかかる）に限る。

## ADR-104: 招待経由サインアップのメール確認の省略は本スライスで実装しない

### Context

`spec/scenario/workspace.md#WS-04` は「招待されたメールアドレスのままサインアップした場合は、招待メールの受信をもって到達性が確認できているため、メール確認を省いてそのままサインインさせる」と定めている。`signUpWithPassword` は `invitationToken` を受けるが本スライスまで無視のままで、`/signup` はそもそも token を運んでいない（レビュー frontend B-003）。

### Decision

実装しない。`/signup` の `validateSearch` へ token を足し、`signUpFn` を通して core 側でトークン照合と確認省略を実装する変更は、Identity 側の確認フロー（確認済みフラグの立て方と、招待 token とアドレスの照合の位置）に踏み込む。本 Issue の受け入れ基準はワークスペース側にあり、この一手は独立した縦スライスとして扱うほうが安い。

canon（`spec/scenario/` と `spec/manual-tests/workspace.md` TC-03 手順 6）は WS-04 の要求のまま**変えない** — 要求が撤回されたわけではないためである。未実装であることは `.thread/3/testing.md` の「本計画で扱わないもの」表が持つ（ADR-103）。

### Consequences

- Phase 4 では TC-03 手順 6 を失敗として記録しない。dev IdP で作るアカウントは確認の往復が無いため、招待リンクへの復帰そのものは手順 5 → 7 で確認できる。
- ADR-068 が決めた「メール + パスワード登録は復帰先を `/signin` のリンクへ引き継ぐ」は、この一手が入るまでの形として有効なままである。

## ADR-105: ADR-101 の in-tx actor 再確認を workspace scope への cross-domain な書き込みへ広げる

### Context

ADR-101 は `application/workspace/` の 10 個の mutation に `ensureActorCan` を置き、`spec/usecases/workspace.md` 冒頭に「ワークスペースへの書き込みはすべて、書き込む transaction の中で actor の Membership を読み直す」という規則を書いた。しかし本 PR が縮退を解いた `storage/storeAvatar`（workspace 主体）と `usage/recalculateStorageUsage`（workspace 主体）は、ドメインとしては storage / usage でありながら書き込む先は workspace scope で、`resolveWorkspaceAccess` を UoW の外で 1 回引くだけだった（レビュー backend-usage W-002）。UoW 内にあった 3 つの assert は「アカウント削除中か」「workspace 削除受理済みか」しか見ないので、降格・除名は素通しする。規則を書いた PR 自身がその反例を持っていた。

### Decision

規則の適用範囲は「workspace ドメインの mutation」ではなく「**workspace scope への書き込み全部**」とし、両ユースケースの UoW 内でも actor を読み直す。呼ぶ位置は ADR-101 のワークスペース単位の書き込みと同じく barrier（`workspaceOperationLockStore.assertWritable`）の直後。

- `storeAvatar` は `membershipMutation.ensureActorCan(ctx, workspaceId, userId, "manageWorkspace")` をそのまま使う。認可を書き写さないため、既存ヘルパーの import に留める（ADR-046 の「認可経路は 1 本」の延長）。
- `recalculateStorageUsage` は ADR-046 のとおり action を課さない契約なので `ensureActorCan` は使えない。`ctx.membershipRepository.findByWorkspaceAndUser` が `null` のとき `InsufficientRole` を投げる薄いガードにする。ここで適当な action（`viewNote` 等）を借りると、ロール表の行と棚卸しの条件が結び付いていないのに結び付いて見える。

`user` 主体の側には足さない。主体と actor が同一であることは UoW 外の等値比較で決まり、Membership のような別 aggregate の版に依存しないため、in-flight で覆る余地が無い。

### Consequences

- workspace 主体の書き込み 2 本に scope 内の読みが 1 回増える。scope object 内なので往復は増えない。
- 型は助けないので網はテストである。両ファイルに「解決と書き込みの間で降格／除名が着地する」ケースを 1 件ずつ足した（`scopeUnitOfWorkProvider.run` を包んで窓を決定的に作る）。`storeAvatar` 側は object bytes が 0 に巻き戻ることまで固定するので、認可が UoW に入る前に落ちていた場合との差も見える。
- 残る同型は `application/note/accessControl.ts` 経由の note 系（G1 / note 担当の持ち分）。規則の文言を `spec/usecases/workspace.md` 側で「workspace scope への書き込み全部」へ広げるかは G7 の判断に送る。

## ADR-106: 本 PR が新たに到達可能にした失敗は、spec 表より先にテストで固定する

### Context

本 PR は `getUsageSnapshot` に `workspaceCursor` / `workspaceLimit` を足し（`UserWorkspaceDirectory` の `ValidationError("INVALID_PAGINATION")` が初めてこのユースケースから出るようになった）、`recalculateStorageUsage` / `storeAvatar` に `workspaceOperationLockStore.assertWritable` を足した（`ConflictError("WORKSPACE_DELETING")` が初めて出るようになった）。どちらもガードを削除しても全テストが緑のまま通る状態だった（レビュー backend-usage W-001）。

### Decision

3 つの失敗をユースケースのテストで固定する。`workspaceLimit` は `listUserWorkspaces` の `TC-workspace-195` と同じ形（21 / 0 / 壊れた cursor の 3 点で、クランプではなく拒否）に揃える。エラー表への追記は `spec/usecases/usage.md` / `spec/usecases/storage.md` に属するので G7 へ送り、実装側では TC 番号を付けない記述的な名前にする — 番号を先に振ると canon が採らなかったときに宙に浮く。

### Consequences

- 変異スポットチェックで確認した: limit をクランプへ変えると 1 件、`assertWritable` を落とすと 2 件（usage / storage 各 1）が red になる。
- `spec/usecases/usage.md#getusagesnapshot` / `#recalculatestorageusage` / `spec/usecases/storage.md#storeavatar` のエラーケース表は未追随のまま。G7 の担当。

## ADR-107: 追加読み込みの畳み込みは島から出した純関数モジュールに置き、初回失敗も再試行できる状態にする

### Context

ADR-096 が入れた「失敗しても表示済みの一覧を捨てない」畳み込みは、`ScopeToken` と `NoteMovePicker` の `"use client"` コンポーネントの内側にあり、テストが 1 本も無かった（レビュー frontend W-004）。このリポジトリには jsdom も testing-library も無いので、コンポーネントごと描いて拘束する道は取れない。

同じ `ScopeToken` には初回取得の失敗から抜ける経路が無かった（W-001）。`onToggle` が `listing.kind === "idle"` でしか読みに行かず、`failed` から `idle` へ戻る遷移が存在しないため、1 回の通信断で WS-02 の唯一の入口がそのページから消えていた。

### Decision

畳み込みを `ScopeToken/listing.ts` と `NoteMovePicker/listing.ts` へ出す。`presentation/scope.ts` と同じ分け方で、DOM もサーバー関数のランタイムも無しに遷移を単体テストできる形にする。島に残すのは `useState` と server function の呼び出しだけで、状態の形（`idle` / `loading` / `loaded` / `failed`）と遷移はモジュール側が持つ。

再試行の可否は `shouldLoadOnOpen(listing)` が答える述語にし、`idle` と `failed` の両方を真にする。あわせて `failed` の描画に再試行ボタンを出す — 閉じて開き直す操作を利用者が思いつく必要が無いようにするため。`NoteMovePicker` に同じ穴が無いのは、こちらが開閉のたびにアンマウントされて `useEffect` が再び走るからで、非対称の理由は `shouldLoadOnOpen` の JSDoc に書いた。

### Consequences

- `appendPage` / `beginLoad` / `failLoad` / `shouldLoadOnOpen` が 13 ケースで拘束される。変異スポットチェックで確認した: 既存 targets を捨てる・`continue` を落とす・`cursor !== null` を反転する・`failed` を述語から外す・`failLoad` を常に終端へ倒す、のいずれも red になる。
- `MoveTarget` は `listing.ts` が持ち、`NoteMovePicker/index.tsx` が再 export する。既存の import 元（`NoteList/board.tsx` / `NoteDetail/menu.tsx`）は動かさない。
- `UsagePanel/board.tsx` の追加読み込みは `useState` の単純な連結で分岐が無いため切り出さない。同ファイルの JSDoc が根拠に挙げていた CLAUDE.md の「一覧メンバーシップの変更」は誤引用（ページ送りはミューテーションではない）なので、「一覧の継ぎ足しを所有するのが一覧だから」へ直した。

## ADR-108: ワークスペース ID の転送上限の正本は `presentation/scope.ts` に置く

### Context

`WORKSPACE_ID_MAX_LENGTH = 128` が `presentation/scope.ts` と `components/workspace/schema.ts` に別々に定義され、Cookie 経路（`parseScope`）と本文経路（各 server function のスキーマ）が別の正本を引いていた。片方だけ動かすと受け付ける長さが割れ、両者のテストは割れたまま緑になる（レビュー frontend W-003）。

### Decision

`presentation/scope.ts` を正本にし、`components/workspace/schema.ts` は再 export する。`fix-plan-002.md` は逆向き（スキーマ側を正本）を推していたが、このアプリの依存は components → presentation の一方向で（`displayError` / `validateInput` など）、逆に引くと循環しうる。`scope.ts` は依存を 1 つも持たない葉であり、`parseScope` 自体が Cookie という転送境界なので、上限の意味もこの層で保てる。

### Consequences

- 既存の import 元（`ScopeToken/action.ts` は schema 経由、`CreateNoteButton/action.ts` と `routes/workspaces/$workspaceId/-action.tsx` は scope 経由）はどちらも書き換え不要のまま 1 つの値を指す。
- 2 つの値が割れる状態が型で消えるので、この一本化に対する回帰テストは置かない。

## ADR-109: P-32 の件数と最後の owner 判定はサーバーの総数に楽観差分を足し引きして求める

### Context

ADR-062 は「最後の owner の保護は**楽観的リストから引き直した** owner 数で閉じる」と決めていた。しかし `listMembers` / `listPendingInvitations` はどちらも 1 ページ 50 件のオフセット送りで、画面は先頭ページしか受け取っていない。`listMembers` の JSDoc が「`ownerCount` はページからではなく厳密に数える。最後の owner 規則はワークスペース全体に対して判定するから」と書いているのに、島はその `ownerCount` も `count` も受け取っていなかった。

結果、owner が 3 人いても先頭 50 件に他の owner が載らなければ「自分が唯一の owner」に見え、**正当な owner の脱退（WS-06 / AC-7）が閉じる**。見出しの人数・招待件数もページ内件数になり、51 件目以降はロール変更・除名・再送 / 取り消し（WS-05 / AC-6）に到達できず、閲覧者自身が先頭 50 件に入らなければ脱退ボタンごと存在しなかった。

ADR-062 が再計算の根拠に挙げた「1 人降格した直後」も成立していない。ロール変更は `MemberRow` の item-local な `useOptimistic` なので、降格は親の一覧に届かず、再計算しても owner 数は変わらない。

### Decision

サーバーが返す `count` / `ownerCount` を**総数の正本**にし、島はそこへ楽観的な差分だけを足し引きする。ADR-062 の「楽観的リストから引き直す」を撤回する（ADR-086 の「行内の保護は置かない・`isLastOwner` は自分の脱退だけを意味する」は変えない）。

- 純関数と型を `WorkspaceMembersPanel/roster.ts` へ出す。`Roster` は読み込み済みのページに加えて `memberDelta` / `ownerDelta` / `invitationDelta` を持ち、`applyRoster` の 3 アクションがそれを動かす。除名・脱退は対象のロールを action に載せるので、owner の増減がページの中身に依存しない。
- `selfIsLastOwner(roster, viewerUserId, serverOwnerCount)` は `serverOwnerCount + roster.ownerDelta <= 1` で判定する。見出しの人数・招待件数も同じ形（`count + delta`）で出す。
- ロールの楽観状態は葉に置いたまま（ADR-062 の所有権を維持）。したがって降格を先取りした owner 数は親に届かず、降格直後の 1 往復だけサーバーの数が残る。判定の正本は `MembershipPolicy` にあり、`router.invalidate()` で揃うので、この窓は表示の先取りが 1 手遅れるだけになる。ADR-062 の「降格直後を捕まえる」という主張は JSDoc から落とした。
- 両方の一覧に「さらに読み込む」を足す。先頭ページはサーバーコンポーネントが渡し、以降の継ぎ足しは島の `useLoadedPages` が持つ。終端は `読み込み済み件数 < count + delta` で判定できるので、カーソルは要らない。追加読み込みはミューテーションではないので楽観的更新を持たず、`useTransition` の pending がボタン上で三層目を担う。
- 継ぎ足しは**サーバーが先頭ページを配り直したら捨てる**。各ミューテーションの `router.invalidate()` が新しい先頭ページを送るので、古い 2 ページ目以降を残すと重複と幽霊行が出る。捨てる判定は先頭ページの参照が変わったこと（描画中の `useState` 更新パターン）で行う。

### Consequences

- 51 件以上のワークスペースでも、脱退・ロール変更・除名・招待の再送 / 取り消しがすべて到達できる。閲覧者自身が先頭 50 件に入らない場合は 1 回以上「さらに読み込む」を押す必要がある（先頭ページに自分を必ず載せる並び順は `listByWorkspace` の契約に無いので、画面側では作らない）。
- ミューテーションのたびに継ぎ足しが 1 ページ目へ戻る。除名した直後に 3 ページ目を見ていた閲覧者は読み直しになるが、重複行を出さないことを優先した。
- `roster.ts` が島から出た純関数なので、`applyRoster` の差分と最後の owner 判定を DOM 無しで拘束できる（`__tests__/roster.test.ts`）。
- 追加読み込みの転送境界は `page` にも天井（1..1000）を置く。オフセット送りは `(page - 1) × limit` 行を読み飛ばすので、ページ番号そのものが DoS の入口になる。

## ADR-110: 複数行文にも「触れた行の同一性」を持たせ、削除サガの状態ガードを UoW 内で正しく読ませる

### Context

Cloudflare の `WorkspaceDeletionManifestStore` は、item ページを `json_each` の複数行文 1 本で書き（ADR-022）、その書き込みを overlay に載せられないため item の読みをすべて `session.query`（ストレージ直読み）で行っていた。結果として **削除サガが Cloudflare で終端しない**（review-002-backend-workspace B-001）:

- `appendInvitationPage → markReady` が同一 UoW で走ると、`markReady` の「未固定の対象が残っていないか」がストレージだけを見るため、同じ turn で固定した invitation を未固定と判定して `ConflictError` → turn ごとロールバック。招待が 1 件でもある workspace は invitations フェーズから出られない。
- `compactAcknowledged → markCompleted` が同一 UoW で走ると、`markCompleted` の `COUNT(*)` がステージ済みの DELETE を見ないため「まだ item が残る」と判定して `ConflictError`。membership item は必ず 1 件以上あるので**すべての workspace 削除で発火する**。

適合スイートがこれを取り逃がしていたのは、manifest のケースがすべて `forScope`（autocommit セッション）で走り、`backend.scopeUnitOfWork.run` を 1 度も通っていなかったため（ADR 026 違反）。

`fix-plan-002.md` G2 は (1) `markReady` を header の両カーソルから導く (2) `markCompleted` を次 turn へ送る、を挙げていた。しかし (1) はカーソルの `null` が「未着手」と「走査完了」を区別できず、区別するには header に列を足して `markReady` の述語を ADR-015 から差し替えることになる（`spec/database` とも乖離する）。(2) はアプリ側に「compaction と完了を同じ UoW に置くな」という規約を増やすだけで、ポート契約は「自分の書き込みを読めない」ままになる。

### Decision

**原因を読み側ではなく書き側に置く。** 複数行文でも触れた行の鍵は書き手が知っているので、`RowMutation` に `upsertMany` / `removeMany` を足す — 1 文のまま、per-row と同じ overlay エントリを寄与する。`spec/database/index.md` の「ID の並びは `json_each` で 1 文」も `MAX_STATEMENTS_PER_COMMIT` も崩さず、read-your-writes だけが戻る。

- `workspaceDeletionManifestStore`（DO）: item の insert / ack / compaction をすべて `upsertMany` / `removeMany` で stage し、item の読みを `readRows` に寄せた。`markReady` の判定は ADR-015 のまま（残存対象の有無）で、ストレージの `NOT EXISTS` を「候補リスト」として扱い overlay と突き合わせる。`markCompleted` の残件判定は overlay を通した集合の要素数にした。`appendPage` は `ON CONFLICT DO NOTHING` に合わせ、実際に作る鍵にだけ image を stage する。
- `deleteAggregatesByIds`（membership / invitation の `deleteByIds`）を `removeMany` にした。ADR-019 が「同一 UoW で `deleteByIds` の後に読むと memory と分かれる」と書いていた差分がこれで消える。
- `membershipRepository.countByRole` を `readRows` へ寄せた。最後の owner 不変条件は「変更を守る transaction と同じ transaction で読む」ことをポート JSDoc が要求しており、集約関数ではそれが満たせない。`listByWorkspace` は offset ページなので overlay と合成できず、**契約側に**「この 1 本だけは自分の transaction を観測しない」と明記した（削除サガはこの読みを、自分では消さない turn で行う）。
- 適合スイートに `backend.scopeUnitOfWork.run` を通す 3 ケースを足した（manifest 2 件 + `countByRole` 1 件）。`forScope` は autocommit のままでよい — UoW 外で呼ばれるポートを表す正しい形であり、欠けていたのは「UoW を通るケース」の方だった。

### Consequences

- ADR-022 の「item の読みは overlay を経由しない」は本 store については解消。残るのは **ページ読み**（`listLocalPending` / `listItems` / compaction のページ）で、`LIMIT` と自 UoW の書き込みは合成できないためセッションが拒否する。ポート JSDoc に「ページは turn の先頭で読み、書き込みは最後」と契約として書いた（サガは元からこの順序）。
- 変異スポットチェック: (a) `appendPage` の image を空に → 新ケースが `targets are not fixed yet` で red、(b) `compactAcknowledged` の `removeMany` の鍵を空に → `manifest still holds items` で red、(c) `countByRole` を `COUNT(*)` に戻す / `deleteByIds` の鍵を空に → それぞれ red。memory 側も `compactAcknowledged` を no-op 化 / `deleteByIds` を非破壊化して red を確認した。B-001 の 2 つの症状がそのままテストの失敗メッセージとして出る。
- `accountDeletionManifestStore`（D1）は同じ形の唯一の生存経路（`compactItems → markCompleted` が同一 global UoW）だが、compaction の対象が定義上すべて ack 済みで open-item 述語のどれにも数えられないため観測は一致する。DELETE を `removeMany` に変え、依存している不変条件をコメントで明示した。述語を足すときは overlay 対応の読みへ移すこと。
- D1 の directory reader 2 本は保存済みの値をブランドキャストで返すようにした（`Workspace.reconstruct` の `avatarUrl` と同じ扱い）。`RESERVED_SLUGS` を 1 語増やすだけで既存行の sitemap ページ / 20 件バッチが D1 でだけ落ちる、という契約外の `BusinessRuleError` を閉じる。

## ADR-111: 移動 abort の可否は route の CAS が決める（ADR-099 の「switch 済みは停止」を保ったまま消失を塞ぐ）

### Context

`abortBeforeSwitch` は target の解体 → source の lock 解放 → `noteRouteStore.abortMove` の順で走っていた。route に触れるのは最後なので、`switchMove` が **commit した後に応答だけを失う**と（`NoteRouteStore.switchMove` の lost-response 分岐が実在を前提にしている状態）、abort が「唯一の実体になった staged copy」を消してから route の巻き戻しにだけ失敗する。route は target を指し、target は空、source の行は誰も到達できない — `getNote` も再要求も `NOTE_NOT_FOUND` になり復旧経路が無い（レビュー B-001）。`TC-note-266` は switch 直後にプロセスを殺す形だったので、この経路は未検証だった。

ADR-099 は「switch 済み operation の再開は実装しない」と決めている。B-001 はその判断が生む穴ではなく、**判断が守ろうとした状態（停止）に到達する前にデータを消す**穴である。

### Decision

補償の可否を「route がまだ source を指しているか」に一本化し、その判定を `abortMove` の CAS（`state === "moving" && migrationId === plan.migrationId`）そのものに委ねる。

- `abortBeforeSwitch` は `thawRoute` を**先頭**で呼び、成功したときだけ target / source の補償へ進む。拒否されたら `"switched"` を返し、**何も消さずに** `stuck after the route switch` を記録して抜ける（前進側へ倒すのは ADR-099 の見送り範囲のまま）。
- `abortMove` の失敗は「拒否」と「応答喪失」を区別できないので、route を 1 回読み直して答えさせる（`routeVersion` が同じ・scope が `plan.source` なら補償してよい）。`TC-note-261`（abort 応答喪失）はこれで補償を完走するようになり、ログ表明を「rollback failed が出ない」に反転させた。
- 順序を入れ替えても新しい競合窓は開かない。abort の間、その operation は `running` のままで、`beginOrResume` は別要求を合流させ `moveNote` が `NOTE_MOVE_IN_PROGRESS` で止める（ADR-097）。route が `active` に戻っても、それを掴みに来る別の移動は存在しない。

### Consequences

- switch 済みで応答を失った移動は「target に全部あり、source に取り残しがあり、両 lock が残る」状態で止まる。ADR-076 / ADR-099 が受け入れた停止と同じ形で、消失ではない。再要求は「所有者が同じ」の早期 return に落ちて成功応答になる。
- `rollBack` は `"switched"` でも operation を `rejected` に落とす。route も note も target で整合しているので、以後の別の移動を止める理由が無い（`running` のまま残すと ADR-097 によりそのノートの移動が恒久的に閉じる）。
- 駆動口（Issue #28）が入ったら、この `"switched"` 分岐が前進側の再開へ書き換わる。

## ADR-112: 移動の requestKey に actor を入れ、operation を「誰の認可か」で分ける

### Context

`requestKey = noteId:target:routeVersion`（ADR-097）は actor を含まない。同じワークスペースの editor A が失敗させた移動（abort 成功・operation `rejected`・routeVersion 不変）を editor B が要求すると、`beginOrResume` は A の operation をそのまま replay する。`plan.actorUserId = A` である一方、pin した Membership 版は attempt 単位で **B について読んだ値**に差し替わるため、`ensurePinnedMembership` は A の行を B の版と突き合わせる（レビュー B-002）。

- 認可の穴: A と B の版が一致すると（同時に参加した直後は双方 0）検査は通り、`stageMove` も `assertActorWritable` も A を名指しするので、**実際の要求者 B が移動中に降格・除名されても確定時点で検出されない**。
- 恒久停止: 版が食い違えば毎回 `STALE_MEMBERSHIP`、A が除名済みなら毎回 `NOTE_NOT_FOUND`。routeVersion は成功しない限り動かないので鍵も変わらず、B はその移動を二度と行えない。

### Decision

`requestKey` を `${noteId}:${actorUserId}:${serializeScope(target)}:${route.routeVersion}` にする。operation の payload は認可（pin した Membership 版・lock の actor・確定時の再検査）そのものなので、**別の主体の要求は別の operation でなければならない**。

- 走行中なら別 actor の要求は合流 → `NOTE_MOVE_IN_PROGRESS`、終端済みなら新しい operation という既存の分岐に正しく落ちる。ADR-097 が `routeVersion` を鍵に入れた理由（再試行の replay / 往復による terminal 衝突の排除）はそのまま保たれる。
- `ensurePlanMatchesRequest` に `plan.actorUserId === actorUserId` を足す。鍵が一致する以上、食い違いは競合ではなく payload の破損なので `SystemError(DataIntegrityError)`。

### Consequences

- 同じノート・同じ移動先を 2 人が順に試すと operation が 2 行になる。`partitionKey` は noteId のままなので、走行中の排他は変わらない。
- `spec/usecases/note.md:546` の requestKey の記述（「ノート・移動先・出発点の routeVersion」）に actor を足す必要がある → G7 へ申し送り。

## ADR-113: claim は「route がまだ plan の source を指しているか」を掴む前に確かめる

### Context

`ensurePlanMatchesRequest` の source / target 比較は新規作成経路で恒真で、検出力が無かった（レビュー W-001）。実際に危ないのは事前確認の `resolve` と `claimRoute` 内の再 `resolve` の間に route が動く場合で、payload には**古い source** が焼き付いたまま `beginMove` が新しい routeVersion で成功し、以降 `snapshotSource` が空の旧 scope を見て `NOTE_NOT_FOUND` を返す。

### Decision

`claimRoute` が `resolve` した route を `beginMove` に渡す**前**に `ScopeKey.equals(route.scope, plan.source)` を確かめ、外れていれば `ConflictError("STALE_SCOPE_ROUTE")` にする。戻り値も `NoteRoute` にして、掴んだ行そのものを呼び出し側へ返す。

レビューの案（`beginMove` の**戻り値**を検査する）ではなく掴む前に置いたのは、掴んだ後に拒否すると route が `moving` のまま誰にも駆動されずに残り、そのノートの以後の移動が `NOTE_ROUTE_STATE_VIOLATION` で恒久的に閉じるからである。`beginMove` の CAS は直前に検査した行の `routeVersion` を対象にするので、検査と claim の間に route が動けば CAS 側が `STALE_SCOPE_ROUTE` で落ち、1 回の引き直しで同じ検査に戻る（spec 手順 4 の「route を1回引き直す」の形は保つ）。

### Consequences

- 「移動中に別の移動が確定した」は `NOTE_NOT_FOUND` ではなく `STALE_SCOPE_ROUTE` で返る。spec のエラー表に反映が要る → G7 へ申し送り。

## ADR-114: retire するのは「実際に target へ渡った集合」で、attempt の snapshot ではない

### Context

abort 自体が失敗して receipt が残った状態から再開すると、`stageTarget` は `markApplied` が `false` で丸ごと skip される一方、`retireSource` は**今回の snapshot 全件**を source から消していた。attempt の間に source へファイルが 1 件増えると、その metadata は staged されないまま削除され、R2 オブジェクトだけが孤児として残る（レビュー W-002）。source の move lock は membership 変更と削除しか止めないので、この間のアップロードは実際に通る。

### Decision

`stageTarget` の戻り値を「版」から `StagedTarget`（`version` + `files` + `bytes`）へ広げ、receipt で skip した場合は **target を列挙して**実際に staged 済みの集合を返す。`retireSource` はその集合だけを retire し、source の debit も同じ集合から計算する。

「消さないこと」を優先し、差分を `corrupt(...)` で止める案は採らない。渡らなかった行が source に残るのは観測可能な不整合だが、metadata ごと消えて R2 に到達不能なバイトが残るより回復しやすい。

### Consequences

- 型で対にした `MovedContents`（files と bytes）が credit / debit の非対称を防ぐ。ある phase が触れた集合とその重さは、以後つねに同じ値から導かれる。
- skip 経路は target の列挙を 1 回増やす。`abortBeforeSwitch` が既に同じ形（snapshot ではなく target の列挙）を採っているので、非対称は無い。

## ADR-115: 移動先の作成権は `resolveTargetOwner` が唯一の判定点で、ドメインポリシーは受け取らない

### Context

`NoteOwnershipPolicy.ensureMovable` の `to.canCreate` には呼び出し側が常にリテラル `true` を渡しており、ポリシー側の `!to.canCreate` 分岐は到達不能だった（レビュー W-005）。移動先の権限は `resolveTargetOwner` が `WorkspaceAuthorization.ensureCan(role, "createNote")` で既に決めている。

### Decision

`TargetOwnerAccess` を廃止し、`ensureMovable(note, from)` の 2 引数にする。移動先の可否は `resolveTargetOwner` の 1 箇所だけで決まり、ポリシーは移動元の編集権と `processing` ロックだけを判定する。

レビューのもう一方の案（判定を `ensureMovable` へ移す）は採らない。移動先の拒否は `spec/usecases/note.md:565` が `BusinessRuleError(InsufficientRole)` と定めた**ワークスペースの**判定であり、`NoteErrorCode.AccessDenied` へ変わると転送境界の写像と `TC-note-240` が崩れる。ドメイン note 側から `WorkspaceErrorCode` を投げるのはドメイン間の逆流になる。

引数だけ残して中身を空にする形は採れない（`noUnusedParameters` で落ちるうえ、意味の無い引数は W-005 と同じ「見かけだけのガード」になる）。

### Consequences

- `spec/domains/note.md:287` / `:290` の `ensureMovable` シグネチャと `TargetOwnerAccess`、`spec/inventory/domain.md` の DOM-note-016 の説明に反映が要る → G7 へ申し送り。
- ドメインサービスは「移動元と note 自身」だけを見るようになり、workspace の役割表を知らない状態が型で保たれる。

## ADR-116: 移動サガの回帰は「相境界 × 後続要求」の総当たりフォールト注入で拘束する

### Context

ラウンド 1 で `moveNote` のデータ消失を直したのに、ラウンド 2 で再び 2 件の Blocker が同じサガから出た。個別に塞ぐ判断（fix-plan G1）を採る以上、「なぜもう同じ種類の穴が出ないと言えるか」を実行形で示す必要がある。既存のテストは失敗点を 1 つずつ手で選んでおり、選ばれなかった相境界が空白として残っていた（B-001 の switch 応答喪失がまさにそれで、`TC-note-266` はプロセス死を前提にしていたため abort が走らなかった）。

### Decision

`withLostResponseAt(h, seam)` を置く。指定した seam を**本物に実行させてから 1 度だけ throw する**（プロセスは生きているので、サガが決めた補償はすべて実際に走る）。seam は移動が外へ出す全コミット点 — `beginOperation` / `claimRoute` / `snapshotSource` / `stageTarget` / `switchMove` / `activateTarget` / `retireSource` / `settle` の 8 つ。後続要求は「何もしない」「同じ actor が再送」「別の editor が同じ移動を要求」の 3 つ。8 × 3 = 24 経路を総当たりで回す。

各経路の表明は 1 つに畳む: **route が指す scope がノート・revision・ファイルを揃って持ち、`getNote` がそこへ到達する**。post-switch で source に取り残しが出るのは設計どおり（ADR-076）なので「1 scope にしか存在しない」ではなく「到達可能な実体はちょうど 1 つで、欠けが無い」を不変条件にした。

### Consequences

- 相を増減したら seam の列挙と `SCOPE_PHASE_OF` / `GLOBAL_PHASE_OF` の index が動く。`withScopeRunHooks` と同じ弱点で、そこは移動の相構造が固定であることに寄りかかっている。
- 変異スポットチェック: B-001 のガード削除で 4 本（switch 経路 3 + 直接の回帰 1）、`thawRoute` の再読み条件を `route !== null` へ弱めても同じ 4 本、B-002 の actor 鍵削除で 2 本、W-001 の scope 検査削除で 1 本、W-002 の staged 集合を snapshot に戻して 1 本が赤になる。
- 24 経路が緑になる根拠は「移動が外へ出すコミット点はこの 8 つで尽きており、応答喪失はそのどれかの直後にしか起きない」こと。新しい外部書き込みを足すなら seam を 1 つ足すのが規約になる。

## ADR-117: slug 予約の補償は行を保持している試行だけが打てる（ADR-102 を置き換える）

### Context

ADR-102 は、決定的 operation ID を共有する 2 つの試行の補償を「補償の直前に scope を読み直し、slug が既に新 slug なら `abandon` を打たない」で塞ぎ、「得られる情報は scope の読み 1 回で足りる」と結論していた。これはラウンド 2 のレビュー W-002 で反証された。scope が新 slug を持つのは**勝者がコミットした後**だけなので、コミット前に別の理由で落ちた試行 — actor が降格した、`cleanupAdmission.assertActorWritable` が拒否した、`workspaceOperationLockStore.assertWritable` が拒否した — はこのガードを素通りして、勝者が activate する予定の `reserved` 行を落とす。既存の `TC-workspace-053` は OCC 敗者（＝勝者コミット後に解放される経路）しか踏んでいなかった。

### Decision

`WorkspaceSlugReservationStore` の契約を変える。`reserve` / `abandon` が `attemptId` を受け取り、行は**最後に予約した試行**のものになる。`abandon` は `(slug, operationId, attemptId, state = 'reserved')` が全て一致するときだけ行を落とす。ADR-102 の scope 読みは削除する。

- ポート JSDoc（インターフェース冒頭・`reserve`・`abandon`）と適合スイート（ADP-workspace-064 に 2 ケース追加）を対で動かす（ADR 026）。
- memory は行に `attemptId` を持つ。D1 は `0006_slug_reservation_attempt.sql` で `attempt_id text` を足す（nullable — 一致しない `attempt_id` は落とさない側に倒れるので、旧行は TTL 回収に委ねられる）。G2 が触っている `0003_workspace_saga.sql` は変更しない。
- `createWorkspace` は operation ID を要求ごとに採番しているので、それがそのまま試行 ID になる（`attemptId: operationId`）。

### Consequences

- 非 OCC の敗者が勝者の行を落とす経路が閉じる。`TC-workspace-053`「an attempt refused for a reason of its own leaves the winner's reservation alone」が降格窓で固定する。
- 残る窓は 1 つ: **行を保持している試行（＝最後に予約した側）が、まだコミットしていない別の試行を残したまま落ちる**場合。これは refcount なしには閉じられない（「新規作成だったかを返す」案も鏡像の窓を持つ）。ただし ADR-118 の再入で復旧できる状態になったので、レビューが問題にした「復旧不能」ではなくなった。
- `attempt_id` は `abandon` のためだけに存在する。`activate` は勝者がどの試行かに依らず打てなければならないので、条件に入れない。

## ADR-118: local commit 後の global ステップは、同じ要求をもう一度出すことで前進させる

### Context

レビュー W-001 は、ローカルコミットの**後**に走る global ステップ（slug の `activate` と directory 投影、join の edge `activate`、除名の `completeRemoval`）が 2 回失敗したときに、誰も収束させられないことを 3 箇所で指摘した。いずれも要求パスの再入が早期 return か終端判定で塞がれている。継続（`scheduled_tasks`）に載せる案もあるが、3 箇所とも「同じ要求をもう一度出す」が自然な操作として既に存在し、そこを開ければ足りる。

### Decision

要求パスを復旧の駆動口にする。

1. `changeWorkspaceSlug`: `nextSlug === previousSlug` の早期 return を `repairSettledSlug` に置き換える。予約が既にこのワークスペースを指していれば何も書かない（無変更の再送は今までどおり no-op）。指していなければ barrier（`reader.admission.assertWritable`）を確認してから `reserve` → `activate` を打ち直し、最後に投影を打ち直す。`activate` の `releasing` は directory 行が広告している slug（＝交換が完了していなければ旧 slug）を使う。行の解放は「そのワークスペースが今も `active` で持っている」ときだけなので、これは助言的なヒントとして安全。
2. `acceptInvitation`: 「既にメンバー」の分岐を `isPending` 判定より**前**に置き、その分岐で招待の settle を冪等化（`acceptIfPending`）し、`listActivatingByUser` で自分の `activating` edge を見つけて `activate` を打ち直す。`listActivatingByUser` にプロダクションの呼び出し元ができる。
3. `leaveWorkspace`: 1 本目の UoW が `MEMBERSHIP_NOT_FOUND` で落ちたときに `completeRemoval` を打ち直してから拒否を再送出する（`settleStrandedRemovalEdge`）。`removeMember` は対象を membershipId で引くので、行が消えた後は userId を復元できず、この駆動口を持てない。

### Consequences

- 3 つとも応答は変わらない。1 と 2 は成功、3 は `MEMBERSHIP_NOT_FOUND` のまま。変わるのは、要求が返る前に global 側が前進していること。
- 3 の効果は「除名された利用者を再招待できる」こと。`removing` のまま残った edge が `(userId, workspaceId)` を占有し続ける状態を、脱退の再実行が落とす。`leaveWorkspace.test.ts` がポートを直接叩いて後始末していた箇所は production 経路の呼び出しに置き換わった。
- 1 の repair は scope に何も書かないので、UoW 内の actor 再確認（ADR-101）は通らない。要求は `resolveWorkspaceAccess` + `ensureCan(manageWorkspace)` を既に通っており、書くのは scope が既に決めた事実の global 側だけなので、削除 barrier の確認で足りるとした。
- 変異スポットチェック: 早期 return に戻すと `TC-workspace-054`（re-sending the slug repairs…）、`isPending` を前に戻すと `TC-workspace-020`（opening the link again settles…）、`settleStrandedRemovalEdge` を外すと `TC-workspace-166` / `-168` が赤になる。

## ADR-119: UoW 内の権限再確認は「ワークスペース自体と管理面を変える書き込み」に課す

### Context

ADR-101 が「ワークスペースへの書き込みはすべて、書き込む transaction の中で actor の Membership を読み直す」を決め、workspace ドメインの mutation に `ensureActorCan` を置いた。ラウンド 2 の backend-usage W-001 / W-002 は、本 PR が縮退を解いた cross-domain な書き込み（`storeAvatar` の workspace アイコン、`recalculateStorageUsage` の workspace 主体）が外側の判定だけで UoW に入ることを指摘し、規則の適用範囲を「workspace scope への書き込み全部」へ広げるか、cross-domain を対象外と明記するかを求めた。

実装の実態は 3 通りに分かれる。workspace ドメインの mutation と上記 2 件は in-tx で読み直す。`moveNote` は各 phase の transaction で Membership の**版**を検査する。ノート本文の作成・更新（`createBlankNote` ほか）は外側の `viewerFor` / `resolveWorkspaceAccess` だけで書く。「scope への書き込み全部」と書くと 3 番目が即座に反例になる。

### Decision

線は**ユースケースが属するドメインではなく、書き込みが何を動かすか**で引く。

- 対象: ワークスペースそのもの（プロフィール・公開設定・存在）とメンバー構成を変える書き込み。ドメインを問わないので、ワークスペースを主体として同じロール表で許される `storeAvatar`（`manageWorkspace`）と `recalculateStorageUsage`（メンバーシップ）も含む。
- 対象外: ワークスペース scope に**中身**を作る・書き換える書き込み。降格・除名の直後に 1 件通ったノートの書き込みは、残ったメンバーが編集も削除もできる普通のコンテンツにとどまる。対して管理面の書き込みは「誰が何をできるか」や公開の可否を動かし、権限を失った当人には取り消せない。
- 例外: `moveNote` は中身の書き込みだが、確定が別 scope への引き渡しなので各 phase で版を検査する（ADR-097 / 098 の既決）。

### Consequences

- `spec/usecases/workspace.md` 冒頭の規則にこの範囲を明記した。`storage.md#storeavatar` / `usage.md#recalculatestorageusage` はその参照として in-tx 再確認を手順に持つ。
- ノート系の cross-domain 書き込みは規則違反ではなく**対象外**として canon に載る。将来これを覆すなら、覆す理由（管理面と同じ取り消し不能性が中身側にも現れる場面）を新しい判断として書くことになる。
- 変異スポットチェック: `storeAvatar` の `ensureActorCan` を外すと `TC-storage-249`、`recalculateStorageUsage` の in-tx membership を外すと `TC-usage-077` が赤になる。

## ADR-120: `applyStorageDelta` から move 分岐を落とし、退いたテストケース ID は再利用しない

### Context

backend-usage W-004 は、`spec/usecases/usage.md#applystoragedelta` が入力 DTO に `{ type: "noteMove"; migrationId; phase }` を持つ一方、実装は移動サガの phase transaction の中で `StorageQuota` を直接加減算していることを指摘した。実害は無いが、usage スライスが `applyStorageDelta` を実装するとき、誰も呼ばない分岐を作るか購読者を足して二重計上するかのどちらかになる。ADR-046 に従い実装を正本とする。

DTO から `noteMove` を落とすと、`spec/testcases/usage/applyStorageDelta.md` の move 前提のケース 7 件が偽になる。台帳の TC ID は行位置ではなく行の識別子である（spec/adr/052）。

### Decision

- `applyStorageDelta` は local event の購読者に閉じる。移動の増減は「サガの phase transaction が直接適用し、重複排除は `AppliedOperationStore`（`migrationId` + command key）が担う」と `usage.md` / `note.md` の双方に同じ文言で書く。
- 偽になったケースのうち、`moveNote` のテストケースが既に押さえている観測（TC-usage-006 / 009 / 010）と、実装がそもそも取らない挙動（TC-usage-012 の「減算で行を復活させない」は移動経路には当てはまらない）は**退ける**。TC-usage-005 は「このユースケースには届かない」というケースへ、TC-usage-007 は local event の再配送へ振り直す。移動先に quota 行が無い場合（旧 TC-usage-011）は `moveNote` 側へ `TC-note-764` として置く。
- 退いた ID（TC-usage-006 / 008 / 009 / 010 / 011 / 012）は欠番のまま残し、**別の内容に再利用しない**。ID は識別子なので、再利用すると過去の参照が別のケースを指す。

### Consequences

- 台帳に欠番が生まれるが、これは spec/adr/052 が明示した「ID は行位置ではない」の帰結であって不整合ではない。
- 移動の quota 挙動を拘束するのは `spec/testcases/note/moveNote.md` に一本化される。

## ADR-121: 除名・脱退の edge 削除に scope task の駆動口を足す（ADR-118 の「`removeMember` は駆動口を持てない」を訂正する）

### Context

ADR-118 は local commit 後の global ステップを「同じ要求をもう一度出す」で前進させると決め、`leaveWorkspace` には `settleStrandedRemovalEdge` を置いた一方、`removeMember` については「対象を membershipId で引くので、行が消えた後は userId を復元できず、この駆動口を持てない」として何も置かなかった。

ラウンド 3 の backend-workspace B-001 はこの前提が成立していないことを指摘した。`removeMember` は 1 本目の UoW で対象の `UserId` を既に握っており（`removeMember.ts:74-83`）、削除の transaction はそれを持ったまま走る。前提が偽である以上、結論も残せない。実害は復旧不能状態である: `completeRemoval` の一過性失敗で残った `removing` edge は誰も落とせず（再除名は `MEMBERSHIP_NOT_FOUND` で try/catch の外、再招待は `MEMBERSHIP_ALREADY_EXISTS`）、除名されたメンバーはそのワークスペースへ二度と参加できない。

### Decision

要求パスの再入だけに頼るのをやめ、**義務そのものを永続化する**。除名・脱退が Membership を削除する transaction の中で、scope task `workspace.membershipRemovalEdgeContinued` を同じ commit に積む（`armRemovalEdgeSettlement`）。ハンドラ `continueRemovalEdgeSettlement` は `completeRemoval` を打ち、成功しても `ConflictError` でも行を `complete` する。`settleRemovalEdge` は速い経路として残り、edge が実際に消えたときだけ行を畳む。

- transport は削除サガと同じ scope-local `scheduled_tasks`（ADR-043 / ADR-040）。行の鍵 `(kind, operationId)` の `operationId` は `${workspaceId}:${userId}` — edge 自身が `(userId, workspaceId)` を鍵に持ち removal 側の operation ID を持たない（ADR-037）ので、その対がそのまま決定的な継続要求 ID になる（ADR-041）。並行する 2 つの除名は同じ行へ収束する。
- payload は `memberUserId` だけを運び、workspaceId は claim した scope から導く。
- `leaveWorkspace` にも同じ武装を入れる。ADR-118 の `settleStrandedRemovalEdge` は撤去せず、耐久的な駆動口の前段の速い経路として残す。

### Consequences

- ADR-118 の Decision 第 3 項の但し書き（「`removeMember` は駆動口を持てない」）は本 ADR で無効。ADR-041 の Consequences 第 3 項「失敗はログに落として握る — 呼び出し側に再実行の手立てが無い」も、義務に持ち主ができたので「握るのは応答だけ」に狭まる。
- ハンドラは冪等でなければならない（at-least-once・順序保証なし）。edge が既に無い再配送は成功、**再入会が同じ対を取り直したあとの再配送は `ConflictError`** になり、これは障害ではなく「この除名の義務は既に果たされている」の意味なので握って行を畳む。新しいメンバーの edge には触れない。この安全性はポート契約（`completeRemoval` は `removing` 以外を拒む）が担保しており、ハンドラ側で状態を読み分けてはいない。
- 通常経路では速い経路が同一要求内で行を畳むので、`scheduled_tasks` に残骸は残らない。
- 変異スポットチェック: `armRemovalEdgeSettlement` の呼びを外す / runner の kind 登録を外す / ハンドラの `ConflictError` 握りを再送出に変える、のいずれでも `removeMember.test.ts` の TC-workspace-218 系 2 本が赤になる。

## ADR-122: loader の失効は保存の結末ではなく「確定した書き込みがあったか」で決める

### Context

P-31 の保存バーは 1 つの操作で 2 つのユースケース（`updateWorkspaceProfile` → `changeWorkspaceSlug`）を順に呼ぶ。実装は成功の末尾でだけ `router.invalidate()` していたため、プロフィールが確定したあとスラッグ交換が落ちる部分成功で loader が古いまま残り、シェルのラベルと `<h1>` が旧名を出し続け、`dirty`（`name !== workspace.name` = 古い loader 値）が保存済みの名前に「未保存の変更があります」を出し続けた（レビュー frontend W-001）。CLAUDE.md「Frontend」の "Every mutation reconciles with `router.invalidate()`" からの逸脱でもある。

### Decision

失効の要否を結末（saved / error）から切り離し、**サーバー側で確定した段が 1 つでもあるか**だけで決める。判定は島から出した `WorkspaceGeneralForm/save.ts:saveOutcome(committed, failure)` が持ち、島は `settle` でそれを実行するだけにする。失敗の表示（スラッグ欄のエラーと候補）はそのまま返るので、部分成功では「名前は保存され、スラッグだけ直す」状態が画面に出る。

段の順序と「プロフィールが落ちたらスラッグ交換へ進まない」判断は動かさない（公開 URL だけが変わる状態を作らないため）。

### Consequences

- 何も書けずに落ちた保存は `router.invalidate()` を呼ばない。無駄な往復が減るだけで、表示は変わらない。
- `saveErrorFor` も同じモジュールへ移り、DOM もサーバー関数のランタイムも無しに単体テストできるようになった（ADR-107 と同じ分け方）。変異スポットチェックで確認: `reconcile` を `failure === null` に倒すと部分成功のケースが red になる。

## ADR-123: スコープトークンの一覧は「正本の鍵」が変わった時点で捨てる

### Context

ドロップダウンの一覧は開いた時点で初めて取りに行き、以降 `loaded` のまま島の `useState` に残る。ワークスペース設定の 4 タブは同一レイアウトの子なので、一般設定で名前を保存してもトークンは再マウントされない。結果、ラベル（loaderData 由来の正本）だけが新名になり、ドロップダウンは旧名を並べたまま `aria-current` までその旧名の行に付く — 同じ画面に新旧 2 つの名前が同居する（レビュー frontend W-002）。

### Decision

一覧が「どの正本の下で取られたか」を `listing.ts:scopeIdentity(scope)`（`kind` + `workspaceId` + `name`）で表し、島はレンダー中に前回の鍵と比べて、変わっていれば `IDLE_LISTING` へ戻す。取り直しは既存の `shouldLoadOnOpen` が担うので、開き直した一枚目から新名が並ぶ。

代案の「開くたびに再取得（`loaded` を保ったまま `pending`）」は採らない。取得が終わるまで旧名が見え続け、W-002 が問題にした新旧の同居がその窓のあいだ残る。鍵に `slug` / `publication` を入れないのは、それらを読む導線（公開ページを開く）が一覧ではなく props を直接見ているため。

### Consequences

- スコープを切り替えた直後もトークンを開くと取り直しになる。一覧はどのみち `aria-current` の位置が変わるので、余分な取得は 1 回だけ増える。
- `ShellScope` は `listing.ts` が持ち、`index.tsx` が型を再 export する（`PERSONAL_SHELL_SCOPE` の定義位置は動かさない）。ADR-107 の `MoveTarget` と同じ置き方。

## ADR-124: 脱退はメンバー一覧の外に置き、可否の判定材料をサーバーの応答から取る

### Context

脱退（PAGE-p32-008 / WS-06 / AC-7）の導線はメンバー行の中にしか無く、`selfOf`（読み込み済みページから閲覧者自身の行を引く）が `null` を返すと存在しなかった。`MembershipRepository.listByWorkspace` は `joinedAt` 昇順・1 ページ 50 件なので、**51 人目以降に参加した利用者は自分の行を「さらに読み込む」で手繰るまで脱退できない**（レビュー frontend W-003）。ADR-109 は総数の正本をサーバーへ移したが、閲覧者自身のロールだけはページの中から取ったままだった。

WS-06 手順 1 の canon は「ワークスペース設定の**下部**から『脱退する』を選ぶ」で、行の中に置くこと自体が canon から外れていた。

### Decision

- `listMembers` の応答に `viewerRole` を足す。`resolveWorkspaceAccess` が既に解決している値なので追加の読みは無く、非メンバーはそもそも一覧を得られないので非 null で持てる。`ownerCount` と同じく「ページの外から答える値」であり、`WorkspaceMemberListView` の JSDoc にその理由を書く。
- 脱退はメンバー一覧から出し、パネル下部の独立した節（`LeaveSection`）に置く。行側からは脱退の確認・禁止表示・最後の owner ヒントを落とす。所有権は親の島のまま（ADR-062）で、脱退は依然として一覧メンバーシップの変更なので `useOptimistic` も親が持つ。
- `selfIsLastOwner(roster, viewerRole, serverOwnerCount)` に署名を変え、判定材料を 2 つともページの外から取る。到達性そのものは `canLeave` を別に切り出して純関数側で拘束する（`__tests__/roster.test.ts`）。
- 楽観適用に `leave` アクションを足す。`membershipId` は `string | null` — 自分の行がページに無くても総数の差分は動かす必要があるため。適用後は `left` が立ち、`selfIsLastOwner` / `canLeave` を閉じる。これが無いと、脱退の往復のあいだだけ `ownerDelta` が自分を引いた数で「最後の owner は脱退できません」を出す。

### Consequences

- 何人のワークスペースでも、閲覧者は 1 ページも繰らずに脱退へ到達できる。ADR-109 が「先頭ページに自分を必ず載せる並び順は作らない」と決めたことは動かさない — 並び順ではなく導線の位置で解いた。
- `MemberRow` から脱退が消え、行内の破壊的操作は除名だけになった。自分の行は「あなた」バッジと現在のロールだけを描く。
- `viewerRole` は `canManage` と重複しない。`canManage` は権限表の答え（他人を管理できるか）、`viewerRole` は自分の身分で、閉じる対象が違う（`WorkspaceSettingsView` が 3 つの capability flag を分けているのと同じ理由）。

## ADR-125: P-24 の削除導線はワークスペース行の注記に置き、ロールで出し分けない

### Context

`spec/inventory/frontend.md` の PAGE-p24-003 は「personal は P-25、workspace は P-34 へ current context 付きで遷移する」を求めるが、実装は個人側（`/settings/danger`）だけで、ワークスペース行には何も無かった（レビュー frontend W-004）。`/workspaces/:workspaceId/settings/danger` が生えたのは本スライスなので、この PR で初めて実装可能になった。

### Decision

`state === "available"` の行の注記列（`UsageSection.notes`）の末尾に `Link to="/workspaces/$workspaceId/settings/danger"` を足す。`workspaceId` は行そのものが持っているので、「current context 付き」は行が名指ししているワークスペースをそのまま渡すことで満たす。`unavailable` の行には出さない — 名前すら出せない行に破壊的操作の入口を置いても、閲覧者はどのワークスペースなのか判断できない。

ロールでの出し分けはしない。`WorkspaceUsageView` はロールを持たず（`getUsageSnapshot` は owner / editor の行を返す）、可否の正本は P-34 側の `canDelete` にある。導線は遷移であって破壊的操作そのものではないので、行き先で閉じるほうが判定の重複を作らない。

### Consequences

- editor の閲覧者にも導線が出て、P-34 では削除の実行だけが閉じる（ADR-093 の「可否は画面ごとのフラグで閉じる」と同じ形）。
- ロールで出し分けたくなったら `getUsageSnapshot` の DTO にロールを足す必要がある。今は行の意味（自分が使っている容量）にロールが要らないので足さない。

## ADR-126: 移動の認可はロールと Membership 版を同じ読みから取る

### Context

`moveNote` の事前確認は、ロールを `viewerFor` / `resolveWorkspaceAccess` で読み、ピン留めする版を `membershipVersionOf` の**別の往復**で読んでいた（レビュー backend-note W-001）。この隙間に**降格**が commit すると、ピンは降格後の版になる。`ensurePinnedMembership` は版しか比べないので、各 phase の再検査は「誰も検査していないロール」を追認する。除名は行が消えて `onMissing` に落ちるので塞がっていたが、降格は移動元・移動先の両方で素通りしていた。`spec/usecases/note.md#movenote` 手順 1・2 は「同じ読みからロールと Membership version を得る」と書いており、実装だけがずれていた。

### Decision

`MembershipPin`（`role` + `version`）を導入し、scope ごとに `pinActorMembership` の**1 回の読み**からロールと版を同時に取る。

- 移動元: `viewerFor` を呼ばず、pin したロールで `NoteViewer` を組んで `noteAccessPolicy.evaluate` に渡す。`viewerFor` の workspace 不在の縮退（`WORKSPACE_NOT_FOUND` → ロール `null`）と結果は同じで、往復が 1 つ減る。
- 移動先: `resolveWorkspaceAccess` は**実在の検査**（`WORKSPACE_NOT_FOUND`。UC-workspace-001 が workspace 配下の入口である規約は動かさない）として残し、`createNote` の可否は pin したロールで判定する。`access.role` は前の往復の答えなので使わない。membership の読みが 1 回増えるが、認可の判定と再検査の版が同じ行の同じ読みに載ることを優先した。

### Consequences

- `membershipVersionOf` は削除。plan にピンする版は `sourcePin.version` / `targetPin.version` で、attempt ごとにピンする ADR-112 の性質は変わらない。
- 移動先の降格が事前確認の最中に着地すると `InsufficientRole`、事前確認の後なら各 phase の `STALE_MEMBERSHIP` になる。どちらも spec のエラー表にある答えで、新しい種類は増えない。
- テストは `withMembershipReadHook`（UoW の外の membership 読みの直後に commit を差し込む）で移動元・移動先の両方向を拘束した。2 度読みに戻すとどちらも赤になる。

## ADR-127: 移動 abort が消す target の receipt は、seam が自分で申告する

### Context

`abortBeforeSwitch` が消す target scope の applied-operation key は `TARGET_SCOPE_COMMANDS` のハードコード配列だった。`NoteMoveTagRelocation.stageTarget` は target の `ScopeUnitOfWorkContext` をそのまま受け取るので、Issue #8 が `ctx.appliedOperationStore.markApplied` を自分の commandKey で書くのは自然な形である。そのとき abort は staged 行だけ消して tag の receipt を残し、同じ migration ID の再開が tag の staging を「適用済み」として飛ばす — ADR-080 / B-001 と同型のデータ消失が tag の分だけ再発する（レビュー backend-note W-002）。

### Decision

`NoteMoveTagRelocation` に `readonly targetScopeCommandKeys: readonly string[]` を足し、`abortBeforeSwitch` が note 自身の 3 鍵と合わせて消す。`TARGET_SCOPE_COMMANDS` は note の鍵だけに縮める。

- **型で申告を強制する**のが目的なので任意プロパティにはしない。`noTagRelocation` も空配列を明示的に書く。#8 は seam を実装する時点で必ずこの行に触る。
- `abortBeforeSwitch` / `rollBack` は `tagRelocation` を引数で受け取る（`stageTarget` / `retireSource` と同じ経路）。

### Consequences

- 「target に receipt を書く相 = その鍵を申告する」が seam の契約になった。`relocateFilesForNote` の 2 鍵は note 側が知っているので配列に残す。
- テストは、自分の commandKey で `markApplied` する seam を渡して「abort 後の再開が tag の staging をもう一度走らせる」を拘束した（`TC-note-258`）。申告を落とすと赤になる。

## ADR-128: claim の応答喪失は operation の確定と同時に route も返す

### Context

`beginMove` が commit して応答だけ失われると、route は `moving`（migrationId = M）で残り、`moveNote` は operation を `rejected` にして終える。ここから復帰できるのは同じ `requestKey`（同じ actor・同じ移動先・同じ routeVersion）の再送だけで、別の actor や別の移動先は `beginMove` が `ConflictError("NOTE_ROUTE_STATE_VIOLATION")` を返して恒久的に拒否される（レビュー backend-note W-004）。**何も staged していない**のに route を掴んだまま離さない状態で、ADR-097 が受け入れた「switch 後の停止」とは別の窓である。

### Decision

claim 経路の catch で、operation を `rejected` にする前に `releaseUnusedClaim` を打つ。route を 1 回読み、`moving` かつ migrationId が自分のものであるときだけ `abortMove` する。

- 掴んでいなければ何もしない（読みで判定するので、CAS の空振りをログに出さない）。`abortMove` 自体が落ちたら 1 行記録して原因の例外は差し替えない — 補償の失敗が診断を置き換えないという既存の方針（`settleQuietly` / `rollBack`）と同じ。
- あわせて `claimRoute` の直前に `ScopeKey.equals(plan.source, plan.target)` の防御を置いた（W-005）。route の scope ≡ note.owner という不変条件は assert されていないので、破れたときに `stageTarget` が `snapshotSource` の読んだ行へ insert し、abort が唯一の実体を消す。到達経路は現状無いが被害が全損なので 1 行で止める。

### Consequences

- claim の応答を失った移動のあと、別のメンバーが別の移動先へ移せる（`TC-note-261` に追加）。この 1 行を落とすと赤になる。
- `source === target` の防御は到達不能な状態に対するもので、テストは無い（公開 API からは「移動先が同じ」の早期 return に落ちる）。

## ADR-129: offset ページの「自 UoW を観測しない」を契約として両バックエンドに課す（ADR-110 の宣言を実装へ降ろす）

### Context

ADR-110 は `MembershipRepository.listByWorkspace` について「この 1 本だけは自分の transaction を観測しない」を**契約側に明記**したが、実装を揃えず適合ケースも置かなかった。実際には memory は書き込みを即時適用するので自 UoW の insert / delete を観測し、Cloudflare は `session.query` で保存済みだけを見る。`InvitationRepository.listByWorkspace` / `listPendingByWorkspace` に至っては契約が沈黙しており（review-003-backend-workspace W-001）、**どちらの挙動が正なのかが決まっていない**。今の呼び出し元は削除サガの probe だけで実害は無いが、サガに 1 行でも書き込みを前倒しすれば memory は終端し Cloudflare は周回する（またはその逆）という、緑のまま壊れる形になる。

`countPendingIssuedSince` も同型で、memory は観測し Cloudflare は `COUNT(*)`（保存済み）だった。

### Decision

**分割線をポート契約に書き、両バックエンドを同じ答えに揃える。**

- offset ページ（`MembershipRepository.listByWorkspace` / `InvitationRepository.listByWorkspace` / `listPendingByWorkspace`）は**最後にコミットされた状態**を返す。自 UoW の insert も `deleteByIds` も見えない。ADR-110 の言い分（offset は overlay と合成できない）をそのまま契約にし、「buffer するバックエンドは」という条件節を外して無条件にした。
- それ以外の読み（`findById` 系・`countByRole`・`countPendingIssuedSince`）は自 UoW を観測する。`countPendingIssuedSince` は発行 quota を「発行する transaction の中で」決めるので、`countByRole` と同じく `readRows` へ寄せた（ADR-110 が `countByRole` に与えたのと同じ理由）。
- memory 側は `MemTable.committedValues()` を新設して契約に合わせた。transaction が最初に触れた鍵の行イメージを WeakMap に控え、現在の行集合へ巻き戻して「transaction 開始時点の状態」を作る。undo ログはそのまま（ロールバックの意味論は変えない）。
- 適合スイートに `scopeUnitOfWork.run` を通す 2 ケース（invitation / membership）を足し、「listing は自分の insert / delete を見ない」「count は見る」を 1 つの turn で同時に拘束した。

### Consequences

- memory は「書いたのに読み返せない」読みを 3 本持つことになるが、それは reference backend が**最も弱い契約を強制する**ということであり、memory で書いたコードが Cloudflare で壊れる経路を 1 つ閉じる（ADR 024 / 026）。
- `MemTable.committedValues()` は全テーブルで使える。将来 offset ページを足す memory リポジトリはこれを使うこと。`values()` のままだと契約から静かに外れる。
- 変異スポットチェック: memory の 2 リポジトリで `committedValues()` → `values()`、Cloudflare で `countPendingIssuedSince` を `COUNT(*)` へ / `listWhere` の items を overlay 対応の `readRows` へ、の 4 点でそれぞれ新ケースが red。
- `spec/domains/workspace.md` の該当段落は両ポートに掛かる書き方へ直す必要がある（G7）。

## ADR-130: `workspace_directory` の slug 剥がしは apply と同じ述語を持つ

### Context

Cloudflare の `applySnapshotIfNewer` は、`read` で分岐を決めたあと write-set に「他行から slug を剥がす」`UPDATE`（`opaque`）と guard 付き upsert を積む。upsert は `lifecycle = 'active' AND source_version < excluded.source_version` で守られているが、剥がし側は**無条件**だった。read と write のあいだに同じワークスペースのより新しい snapshot（または tombstone）が着地すると、upsert は 0 行・剥がしは 1 行という半端な適用になり、**第三者のワークスペースの slug が誰にも取られないまま NULL に落ちる**。剥がれた行は `publication='published' AND slug IS NOT NULL` を要求するサイトマップ列挙から黙って消え、その行自身の次の `workspace.*` イベントまで戻らない（review-003-backend-workspace W-002）。memory は read と write が不可分なのでこの窓が無く、片方のバックエンドだけが持つ挙動になっていた。

### Decision

剥がしの `UPDATE` に upsert と同じ述語を相関 `NOT EXISTS` で持たせ、「upsert が 0 行なら剥がしも 0 行」を SQL の述語一致で成立させる。`occGuard` で write-set ごと落とす形は採らない — ポートは「誰が書いたか」を答えない契約（ADR-035）であり、投影が `ConflictError` で詰まる経路を作らないことが `applySnapshotIfNewer` の設計そのものだから。ポート JSDoc に「何も書かない snapshot は何も奪わない」を契約として足した。

### Consequences

- レース自体は適合スイートでは作れない（memory は原子的）。**直列で届く半分**（stale な snapshot / tombstone 済みの行が slug を奪わない）を共有ケースとして適合スイートに置き、**インターリーブ**は `cloudflare/__tests__/projectionConcurrency.test.ts` の `interposeOnce` で 2 ケース置いた。層の分け方は public note projection の並行ケースと同じ。
- 変異スポットチェック: Cloudflare の `NOT EXISTS` を落とすと race 2 ケースが red、memory の `takeSlug` を版ガードの前へ動かすと共有ケースが red。

## ADR-131: pending 招待の一意性を store に強制しない理由は「バックエンド間で結果が分かれる」ことである

### Context

`InvitationRepository` の JSDoc は「(workspaceId, email) の pending 招待が最大 1 件」を store で強制しない理由を「UNIQUE にすると resend として成功させたい要求を弾くから」と書いていた。しかし resend は同一行の `UPDATE` なので部分 UNIQUE には触れず、この論拠は成立していない（review-003-backend-workspace W-003）。ADR-017 が索引を置かないと決めた実際の理由は別で、「置くと同じ入力に対し memory は成功し Cloudflare は `SystemError(DatabaseError)` になる」である。

### Decision

実装は変えない（ADR-017 は既決）。ポート JSDoc の論拠を ADR-017 の実際の理由へ書き換え、代償（同時 invite で pending が 2 件になり得る／余った token route が期限まで quota 枠を食う／2 度目の受諾は既存 membership に落ち着く）を明記した。`do/schema.ts` のコメントも spec の記述に依存しない形（制約そのものを述べる形）へ縮めた。

### Consequences

- canon 側（`spec/database/index.md` の `invitations_pending_uq` 行、`spec/domains/workspace.md` の不変条件、`invitations_workspace_created_idx` の tiebreak）は実装に追随させる必要がある（G7）。
- 逆に不変条件を守り切る道を選ぶなら、`insert` に conflict code を足して両バックエンドと適合スイートに入れることになる。その判断は本 ADR ではなく ADR-017 の再検討になる。

## ADR-132: 鍵の申告は「読み側も overlay を通す」までを 1 組にする（D1 の account deletion manifest）

### Context

`accountDeletionManifestStore`（D1）の多行 1 文 4 箇所（membership / author route の page append、`claimPending`、`acknowledge`）が `opaque` のままで、`spec/database/index.md:19` の「その 1 文は触れた行の鍵（と行の像）も宣言する」と正面から矛盾していた（review-003 general W-001）。鍵は `jsonList` / `jsonRows` に列挙済みで、`upsertMany` / `removeMany` も ADR-110 で存在するので、能力の不足ではない。

ただし書き側だけを `upsertMany` に替えても、item の読みが `session.query`（ストレージ直読み）と `COUNT(*)` のままでは **像は誰にも観測されない** — 規約を満たした形にはなるが、read-your-writes は戻らず、像を空にする変異もテストで検出できない。

### Decision

**書き側の申告と読み側の overlay 経由を 1 組で入れる。** `workspaceDeletionManifestStore`（DO、ADR-110）の流儀に合わせた。

- item の読みは `readItems` 1 本に集約し、`session.readRows` を通す。述語は `ItemFilter`（SQL と、同じ判定を staged image に対して行う `matches`）として持ち、SQL と JS の 2 表現が必ず並ぶ形にした。
- `COUNT(*)` の 2 箇所（`allRollbackReleased` / `allRequiredAcknowledged` の open item）は overlay と合成できないので、merge 済み集合の要素数に置き換えた。`compactItems` の `remaining` も「今消した鍵を除いた残り」の存在確認にした。
- `ORDER BY key` + `compare` は **page だけの opt-in** にした。セッションは「LIMIT が埋まった順序付きの読み」に自 UoW の書き込みが混ざると拒否するので、存在確認まで ordered にすると `acknowledge → allRequiredAcknowledged` を同一 UoW で行っただけで `DatabaseError` になる。
- `pruneTerminal` の header 側 DELETE（`operation_id IN (…)`。`operation_id` は header の主キー）も `removeMany` にした。指摘の 4 箇所には挙がっていないが、鍵が列挙できている以上これも規約の対象で、同じファイルに反例を残す理由がない。item 側は「manifest ごと消す」文で item の鍵を列挙していないため `opaque` のまま — 免除条項に当たる唯一の箇所であることをコメントに書いた。
- 適合スイートに 3 ケース追加（`globalUnitOfWork.run` を通す）。ポート JSDoc は触っていない: 「同一 UoW で自分の書き込みを読める」は ADR-110 と `spec/database/index.md:19` が既に全ポートに課している一般契約で、新しい契約の追加ではなく既存契約の執行形の追加にあたる。

### Consequences

- アカウント削除の振る舞いは変えていない。SQL 文の本体・述語・返り値はすべて据え置きで、変わったのは (1) 文が write-set に申告する鍵と像、(2) 同じ UoW 内の読みがそれを観測すること、の 2 点だけ。`pnpm test:node` / `pnpm test:workers` は既存ケースを 1 件も書き換えずに緑。
- `allRequiredAcknowledged` は `COUNT(*)` から「開いている item を全部読む」に変わった。ADR-110 が `countByRole` で払ったのと同じ代償で、集約関数では自 transaction の書き込みを数えられないため避けられない。実際の呼び出し点（finalize / compaction の前）では開いている item は 0 件なので、返る行数は通常 0。
- 変異スポットチェック 5 件（4 箇所 + prune header）はすべて red を確認して戻した: append 2 箇所は「同一 UoW で page を claim し直すと 0 件」、`claimPending` は「同一 UoW の rollback が release 不要と判定する」、`acknowledge` は「2 つ目の ack が 1 つ目を上書きして finalize が立たない」、prune header は「消した manifest を同一 UoW の `describe` が返す」として出る。

## ADR-133: `releaseUnusedClaim` は判定の読みごと補償として扱う（ADR-128 の窓を閉じる）

### Context

ADR-128 が claim 経路の catch に足した `releaseUnusedClaim` は、`abortMove` だけを try/catch で包み、その可否を決める先頭の `noteRouteStore.resolve` を無防備に残していた。この catch に入るのは `claimRoute`（= 同じ `noteRouteStore` の `resolve` / `beginMove`）が落ちたときなので、route store の不調という相関した障害では判定の読みも一緒に落ちる。そのとき例外は `moveNote` の catch を貫通し、(a) 呼び出し元が受け取る診断が claim の失敗から route の読みの失敗へ差し替わり、(b) 直後の `settleQuietly(rejected)` が実行されない（レビュー ラウンド 4 backend-note B-001）。

(b) の方が重い。`spec/usecases/note.md#movenote` 手順 4 は claim に失敗した operation を**その場で `rejected` へ落とす**ことを要求しており、`running` のまま残ると `beginOrResume` が `partitionKey`（= noteId）で以後の要求を合流させ、ADR-097 の判定によりそのノートの移動が誰に対しても `NOTE_MOVE_IN_PROGRESS` で恒久的に閉じる（本スライスに recovery 駆動口は無い＝#28）。ADR-128 が塞いだ「掴んだ route を離さない」窓より広い窓を、その修正自身が開けていた。

### Decision

`releaseUnusedClaim` の**本体全体**（判定の `resolve` を含む）を 1 つの try で包み、失敗は既存の `logger.error("[moveNote] the claimed route was left moving")` に落として `void` を返す。

- 「補償の失敗は診断を置き換えない」（`settleQuietly` / `rollBack` の JSDoc）に、**補償の可否を決める読み**も含める。判定の読みは補償の一部であって、呼び出し元の観測点ではない。
- catch 節の順序を `settleQuietly` → `releaseUnusedClaim` に入れ替えるだけでも settle への到達性は満たせるが、診断の差し替えが残るので採らない。
- 広い `try / catch` を避ける規約（CLAUDE.md）の例外にあたる。理由は非自明なので、関数の JSDoc に「読みも補償の一部」「settle を妨げてはならない」を 1 段落として残した。

### Consequences

- route store が完全に落ちている間の claim 失敗は、claim の例外そのものを呼び出し元へ返し、operation は `rejected` で終端する。route は `moving` のまま残りうるが、それは ADR-128 以前と同じ状態で、operation の `running` 残留より狭い（当人の同一 `requestKey` の再送か #28 で回復する）。
- 検出力: `TC-note-261` に `beginMove` 失敗と `resolve` 失敗を同時に注入するケースを 1 本足した。変異 2 件を red で確認して戻した — (1) `resolve` を try の外へ戻すと診断が `route read failed` に差し替わって red、(2) claim 経路の `settleQuietly` を落とすと operation が `running` のまま残って red。

## ADR-134: `NoteMoveTagRelocation.plan` の契約は「attempt ごとに呼ぶ純粋な読み」とする

### Context

seam の JSDoc は `plan` について「dropped names は operation payload に固定されるので resume では計算し直さない」と書いていたが、実装は `beginOrResume` の**前**で無条件に呼び、resume ではその結果を捨てている（返すのは payload 由来の `plan.droppedTagNames`）。唯一の実装 `noTagRelocation` が no-op なので実害は無いが、Issue #8 の実装者は「1 operation につき 1 度しか呼ばれない」と読める（レビュー ラウンド 4 backend-note W-002）。

### Decision

**JSDoc 側を実装に合わせる。** 「`plan` は attempt ごとに呼ばれ、payload に焼かれるのは最初の 1 回だけで、返す名前は常に payload 由来」と書き、あわせて実装は純粋な読みでなければならない（resume が結果を捨てるため）ことを契約にする。

実装側（resume を判定して `plan` を飛ばす）に寄せなかったのは、`beginOrResume` の前後を組み替えると B-001 で触った claim 失敗の catch 経路が動くためで、seam の呼び出し回数のために停止の窓に近い箇所を触る利得が無い。`spec/usecases/note.md:557`「外れるタグ名は手順3で固定した operation payload から返し、再開時に計算し直さない」は**返り値についての規定**で、実装はこれを満たしているので canon の改訂は要らない。

### Consequences

- #8 は `plan` を副作用のある処理に使えない。書き込みを伴う準備が要るなら `stageTarget` 側（相の UoW を受け取る）に置くことになる。

## ADR-135: workspace に参加中のアカウント削除は受理の時点で拒否する（wave が来るまでの fail closed）

### Context

本 PR が `membership_directory` に実 edge を作ったことで、`deleteAccount` の manifest 構築（`appendMembershipPage`）が初めて membership item を固定するようになった。ところが `allRequiredAcknowledged` は全 item の `prepareAckedAt` / `cleanupAckedAt` を要求し、その ack を上げる主体（workspace の prepare / cleanup wave、`UC-workspace-021 deleteMembershipsForUser`、`scopeTaskHandlers` の対応する kind）は本デプロイに 1 つも無い。結果として `finalizeAccountDeletion` は永久に待ち続け、User は `deleting` のまま identity も PII も残り、再駆動しても回復しない（レビュー general B-001）。editor / viewer として 1 件参加しているだけの利用者でも到達する。

wave 本体は Issue #3 のスコープ外である。`UC-workspace-021` / `TC-workspace-069〜075` は Issue #3 のチェックリストに 1 行も無く（ADR-075）、`TC-workspace-071` は job ドメイン（#5）の終端 API に依存し、前進で解くには prepare 相の dispatch・scope task の新 kind・rollback の駆動口（現在アプリケーション層に存在しない）まで要る。

### Decision

**受理の時点で閉じる。** `admitAccountDeletion` が settled な membership edge を数え、1 件でもあれば `ConflictError("WORKSPACE_MEMBERSHIPS_REMAIN")` を投げる。`spec/pages/index.md#P-25` が既に canon として持つ「実行不可」状態を、唯一 owner だけでなく参加中のワークスペースがある場合へ広げる。

- 読みは `UserWorkspaceDirectory.countSettledByUser(userId, limit)`（DOM-workspace-089 / ADP-workspace-078）。数える集合は manifest が固定するのと**同一の述語** — `active` / `pending` / `removing`（= `edgeState !== "activating"`）。`listActiveByUser` は `active` しか返さないので代用にならず、それで代用すると `pending` / `removing` を残したまま同じ停止に落ちる。
- 判定するのは `user.status === "active"` の枝だけ。**resume（`deleting`）は判定しない** — 受理済みの削除を後から拒否すると `deleting` のまま進めも戻せもしなくなる。
- 位置は `AccountDeletionRetryPolicy.ensureRetryable` の直後、`beginOrResume` の**前**。operation を作る前に投げるので terminal 行が 1 件も残らず、リトライ窓を消費しない。`ensureRetryable` を先に置いたのは、両方成り立つときに Issue #2 の既存の報告（リトライ窓の枯渇）を変えないため。
- 件数の読み自体は UoW の**外**（トランザクションが開く前）で引く。ディレクトリは設計上どの UoW にも属さない global 面のポートで、`createWorkspace` の所有上限もこの形を採る。判断だけをトランザクションの中で下す。

### Consequences

- **fail closed。** 曖昧・未対応の側では削除を通さないので、停止した `deleting` は新たに 1 件も生まれない。wave が到来したら `admission.ts` の `settledMemberships > 0` の 3 行（と `workspaceMembershipsRemain`）を落とすだけで前進へ切り替わる。この解除条件は `admitAccountDeletion` の JSDoc に規定として書いた。
- 偽になっていた 2 つの JSDoc を実態へ直した。`manifestBuild.ts` の `FIRST_DISPATCH_PHASE`（「membership item は存在しない」）と `cleanupDispatch.ts` の `dispatchAccountDeletionCleanup`（「workspace スライスが固定して初めて存在する」）は、いずれも「edge は存在しうるが受理が退けるので item は固定されない」へ書き換えてある。
- canon の改訂（`spec/usecases/identity.md#deleteaccount` のエラー表、`spec/pages/index.md#P-25` の「実行不可」の一般化、`spec/domains/workspace.md` のポート追加、台帳の採番）は本グループの担当外として G6 が持つ。
- 変異スポットチェック: ガードを外すと `TC-identity-350` が赤、条件を反転すると `TC-identity-350` / `TC-identity-351` を含む 7 本が赤、適合スイートの述語を `active` だけに狭めると memory / cloudflare 双方の `ADP-workspace-078` が赤。

## ADR-136: `QuotaEnforcement.describe` をオーバーロードし、表示値の導出点を 1 つに戻す

### Context

`getUsageSnapshot` は `describe({ storage, llm })` を呼びながら `described.storage` しか使わず、LLM 行は `toLlmUsageView(llm)` が `LlmUsage.warningLevel` / `usage.quota.limit` から同じ 4 フィールドを再導出していた。`describe` の `llm` が `LlmUsage | null` を受けて `null` を返しうるためで、不在は呼び出し前に `LlmUsage.initialize` で解消済みなのに、その事実が型に出ていないことが複製の理由になっていた。`spec/usecases/usage.md` 手順 5 は「`describe` で表示用の値を組み立てる」と書いており、実装はその半分しか従っていない。ドメイン側の表示規則が変わっても LLM 行は追随せず、`toLlmUsageView` の呼び出し元は 1 箇所しか無いので drift を落とすテストも無かった。

### Decision

`describe` をオーバーロードし、非 null の `LlmUsage` を渡した呼び出しには非 null の LLM 半分を返す（`UsageSnapshot<DescribedLlmUsage>`）。`toLlmUsageView` は entity ではなく **`describe` が導出済みの半分**を受け取り、`period` を primitive に落とすだけにする。導出規則はドメインサービスの 1 箇所に戻り、ユースケースは射影しかしない。

- 実行時の分岐や `as` は入れない。「不在は既に解消済み」を型の側で表現するのが目的なので、`described.llm ?? …` のフォールバックを置くと複製が戻る。
- `UsageSnapshot` は LLM 半分を型引数に取る形（既定は従来どおり `DescribedLlmUsage | null`）にしたので、`llm: null` を渡す既存の呼び出しと domain テストは変わらない。
- `packages/core/src/domain/usage/services/quotaEnforcement.ts` は fix-plan G4 のファイル一覧に無いが、G4 の方針が明示する「`describe` に非 null の `llm` を渡した戻り値を受ける」形はこの 1 ファイル無しには作れない。他のグループの担当範囲とは重ならない。

### Consequences

- ドメイン側の LLM 表示規則を変えると `getUsageSnapshot` が自動的に追随する。変異スポットチェック: `describe` の `level` を `"none"` に固定すると `getUsageSnapshot.test.ts` の「the LLM row reports the figures and level the quota service derives」が赤（従来の実装ではこの変異は誰も落とさなかった）。
- 検出力のために 80% 境界（240/300 → `warning`）の 1 本を足した。既存の `TC-usage-057` は `level: "none"` しか見ておらず、レベル導出の変異を落とせない。この 1 本には TC 番号が無いので、採番するなら G6 の持ち分になる。
- `spec/usecases/usage.md` 手順 5 の記述に実装が寄る向きなので、spec の改訂は不要。

## ADR-137: セッションのシェル投影は `email?: never` で狭さを型に落とす

### Context

ADR-089 が `AuthenticatedUserView` に `email` を載せたことで、`requireSession` / `sessionUserOrNull` / `requireSessionOrRedirect` の戻り値が既定で PII 込みの広い型になった。露出を止めているのは転送境界の `toViewerView` だが、`ViewerView = Omit<AuthenticatedUserView, "email">` は**構造的に広い側を受け入れる**ので、`toViewerView` を掛け忘れてもコンパイルは通る。実測: `sessionUserFn` の本体を `return user;` に変えても、`Omit` のままでは `tsgo` が沈黙する。CLAUDE.md「Make illegal states unrepresentable at the type level」に照らして、規約が唯一の防壁になっていた。

### Decision

`ViewerView` を `Omit<AuthenticatedUserView, "email"> & Readonly<{ email?: never }>` にする。`email` を「存在しない」と宣言することで広い型が代入不能になり、`toViewerView` がこの形を作る唯一の経路になる。`AuthenticatedUserView` 自体（ADR-089 の決定）は動かさない。

### Consequences

- 変異スポットチェック: `sessionUserFn` を `return user;` に変えると `apps/web` の typecheck が TS2322（`Type 'string' is not assignable to type 'never'`）で落ちる。同じ変異は変更前には通っていた。
- 強制が効くのは **`ViewerView` を戻り値として宣言している境界**に限る。`sessionUserFn` は宣言しているが、`/notes`・`/workspaces/new`・`/workspaces/:id`・`/workspaces/:id/settings` の 4 つのブリッジはハンドラーの戻り値型を推論に任せており、そこでは今も規約が防壁である（現状 4 つとも `toViewerView` を掛けているので実害は無い）。閉じ切るには (a) 4 つのハンドラーに `Promise<{ user: ViewerView; … }>` を書くか、(b) `presentation/{session,sessionGuard}.ts` の戻り値を `ViewerView` へ狭めて `email` が要る招待経路だけ別の入口にするか、いずれかが要る。どちらも本グループの担当外のファイルなので入れていない。

## ADR-138: role 投影は `membershipId` で世代を照合してから版を比べる（ADR-078 の「追わない」を撤回する）

### Context

ADR-078 は `applyRoleIfNewer` の順序規則を「保存済み `role_source_version` より大きいときだけ書く／未投影の edge はどの版よりも古い」と決め、Consequences で「再入会で edge が作り直されると前の Membership の後着イベントが当たるが、`membershipId` を足さない限り区別できず、次のロール変更で必ず上書きされる。実害が無いとみなし、追わない」と書いた。

この「次のロール変更で上書きされる」が誤りだった（review-004-backend-workspace W-001）。後着が通ると edge は `role_source_version = 1` になり、**新しい Membership の最初のロール変更も版 1**（`Version.next(0)`）なので `1 >= 1` で拒否される。したがって収束するのは 2 回目のロール変更であり、その間ずっと `listUserWorkspaces` は誤ったロールを出す。1 回分のロール変更が黙って落ちること自体が、順序規則が防ぐと宣言している「巻き戻さない」と食い違う。

版は 1 つの Membership の中でしか順序を持たない。除名 → 再入会は版を 0 から数え直すので、**版だけで世代をまたいだ比較はできない**というのが構造的な理由である。

### Decision

`workspace.membership.roleChanged` の payload に `membershipId` を足し、`applyRoleIfNewer` の入力にも足して、**版比較の前に世代を照合する**。edge が名指す `membershipId` と一致しないとき（`pending` 予約が持つ `null` を含む）は no-op。edge は `reserveAndClaimActivation` の時点から `membershipId` を運んでいるので、新しい状態は 1 つも増えない。

- 一致は「等値」で採り、「edge が名指していない（`null`）」は不一致に倒す（fail closed）。`membership_id` が `null` なのは `pending` 予約だけで、production の経路では `reserveAndClaimActivation` が必ず値を入れる。
- Cloudflare 側は JS のガードと `UPDATE ... AND membership_id = ?` の両方を持つ。read と write のあいだに edge が作り直される窓は SQL の述語でしか閉じられない（ADR-130 と同じ形）。
- `eventDecoders` の strict schema にも `membershipId` を足す。既存の outbox 行は payload に鍵が無いので decode に失敗するが、参照ランタイムは再起動で全消えするため移行の問題にならない。

### Consequences

- ADR-078 の Consequences 2 番目（「実害が無いとみなし、追わない」）は本 ADR が置き換える。順序規則が兼ねるのは**同一世代の中の**再配送・後着・同時適用の 3 つで、世代をまたぐ 4 つ目は `membershipId` の照合が持つ。
- ポート契約が変わるので JSDoc・memory・Cloudflare・適合スイートを対で触った（ADR 026）。適合ケースは `ADP-workspace-079` を 1 本追加。
- 変異スポットチェック: memory の `membershipId` ガードを外すと `ADP-workspace-079`（memory）と `TC-workspace-312` が red。Cloudflare は JS ガードだけを外しても SQL の述語が拾って green のままで、**両方**外すと `ADP-workspace-079`（cloudflare）が red。SQL 述語単独の検出力は適合スイートでは作れない（read と write のインターリーブが要る）ので、ADR-130 と同じく述語一致で担保する。
- canon への申し送り: `spec/domains/workspace.md` の `roleChanged` の payload と `applyRoleIfNewer` の記述、`spec/inventory/{domain,adapter}.md` の採番（G6）。

## ADR-139: 招待クォータは発行する transaction の中で判定する

### Context

`InvitationRepository.countPendingIssuedSince` の JSDoc は、この読みだけを 2 本の listing と分けて「自 UoW の書き込みを観測する」側に置き、その根拠を「発行する transaction の中で枠を決めるので、同じ unit が既に書いた招待を数え落とすと次の発行が上限を越える」と述べている（ADR-129 が契約として確定させた）。ところが唯一の呼び出し元 `inviteMember` はこの読みを `scopeUnitOfWorkProvider.run` の**外**で行っており、根拠が実装に対して偽だった（review-004-backend-workspace W-002）。並行する 2 要求がどちらも 49 を読めば両方が insert して未処理 51 件になる。同じ規則を持つ `countByRole` は `changeMemberRole` / `ensureRemovable` が transaction の中で読んでおり、非対称は意図に見えない。

### Decision

`countPendingIssuedSince` と 50 件の判定を `run` のブロック内（`ensureActorCan` の直後、`insert` の前）へ移す。窓の起点 `now - 24h` は transaction の外で採った `clock.now()` から作り、`Invitation.issue` が使う `now` と同一に保つ。

判定が resend への畳み込み（spec 手順 5）より**後ろ**へ動くのは意図した副作用として受け入れる。再送は同じ行の `UPDATE` で在庫を増やさないので、在庫のクォータで止める理由が無い（`spec/usecases/workspace.md` は直接呼びの `resendInvitation` について既に「在庫の上限では止まらない」と書いている）。

### Consequences

- クォータで拒まれた要求は token route を `reserve` してから落ちるが、既存の `compensate` 経路が `abandon` するので行は残らない（`TC-workspace-313` が拘束）。
- 変異スポットチェック: 判定を `run` の外（`reader.invitation` 経由）へ戻すと `TC-workspace-313` が red。既存の `TC-workspace-139` / `140` / `141` は前後どちらでも green なので、検出力はこの 1 本が持つ。
- canon への申し送り: `spec/usecases/workspace.md#invitemember` の手順 4 を手順 7 の transaction の中へ移し、手順 5 との前後関係を書き換える必要がある（G6）。ポート JSDoc は書き換え不要 — 述べていたことが実装で成立するようになった。

## ADR-140: 台帳の採番は連番へ揃え、ADP は「ポートのメソッド 1 本 = 1 ID」で畳む

### Context

ラウンド 4 の並列修正で 2 つの暫定採番が出た。G1 が `countSettledByUser` の適合ケースへ `ADP-workspace-078` と `DOM-workspace-089`、G3 が再入会後の `roleChanged` のケースへ `ADP-workspace-079` を付けている。実測では `spec/inventory/adapter.md` の最大は `ADP-workspace-075`、`spec/inventory/domain.md` の最大は `DOM-workspace-087` で、どちらも間の番号は未使用だった。さらに `spec/inventory/adapter.md` の workspace 行はポートのメソッド集合と 1:1 で、同じメソッドに複数の適合ケースがある場合は既存の ID を共有している（`ADP-workspace-073` が 4 本、`074` が 3 本）。

### Decision

- `UserWorkspaceDirectory.countSettledByUser` は新しいポートのメソッドなので新規行を起こし、`DOM-workspace-088` / `ADP-workspace-076` を採る。適合スイートのケース名を `078` → `076` に直した。
- 再入会後の後着は既存メソッド `applyRoleIfNewer` の振る舞いなので新規行を起こさず、`ADP-workspace-073` / `DOM-workspace-085` の「内容」を改訂して畳む。ケース名も `079` → `073` に直した。
- 欠番は作らない。残る欠番は `TC-usage-006 / 008〜012` だけで、これは退いた ID をそのまま残すという既存の決定に従う。

台帳の ID は行位置ではないので、`spec/testcases/` 側の行は意味の近い場所へ差し込み、`spec/inventory/test.md` では ID 順に並べる。

### Consequences

- 機械照合の結果: `TC` / `DOM` / `ADP` / `UC` / `PAGE` のいずれも重複 0。欠番は上記の退役 ID のみ。`spec/inventory/test.md` の TC 行数は全 `spec/testcases/*/*.md` のデータ行数と全ファイルで一致する。
- 実装コードで触ったのはケース名の ID 文字列と、`membershipDirectoryReservationStore.ts` の suite 見出しが列挙する ID だけである。

## ADR-141: LLM 側の 80 % 境界にも TC を採番する

### Context

ADR-136 で LLM 行の表示値と level が `QuotaEnforcement.describe` 由来になり、その執行形として「the LLM row reports the figures and level the quota service derives」（240/300 → `warning`）が入った。`spec/testcases/usage/getUsageSnapshot.md` は storage 側の 80 % 境界（`TC-usage-045`）しか持っておらず、LLM 側の境界に行が無い。

### Decision

`TC-usage-080` として採番し、testcases 表と台帳へ 1 行足す。導出の場が 1 つに畳まれた以上、「LLM 側も 80 % で `warning` になる」は実装の詳細ではなく画面が示す性質であり、`docs/test.md` の checklist に載るべき行である。同じ判断で、cursor がページ全体の末尾まで進む性質は 3 テストを 1 行（`TC-usage-079`）に集約した — 同種の欠陥を落とす 3 つの角度であって、別々の性質ではない。

### Consequences

- `getUsageSnapshot` の testcases 表は 19 行、対応する台帳行も 19 行になる。

## ADR-142: P-25 の「実行不可」は拒否の応答から立て、片づける先はその場で 1 ページだけ引く

### Context

`spec/pages/index.md#P-25` の状態直和に「実行不可（参加中のワークスペースが 1 件でもある。脱退・譲渡・削除への導線）」が入り、`PAGE-p25-004` が「拒否のあと、該当 workspace の P-32 または P-34 へ誘導する」を要求した。判定の権威は `admitAccountDeletion`（`WORKSPACE_MEMBERSHIPS_REMAIN`）にあるが、導線を描くには workspaceId が要る。P-25 は**セッション無しでも開ける唯一の画面**なので loader を持たず、参加中のワークスペースを先読みする場所が無い。

### Decision

- 実行不可は**拒否されて初めて立つ状態**として扱う。先回りの照会も、無効化した削除ボタンも置かない。拒否は Cookie を破棄しないのでセッションは生きており、片づける先はその場（`useActionState` の catch の中）で引ける。
- 片づける先は P-25 専用の server function（`components/settings/DeleteAccountPanel/action.ts` の `listRemainingWorkspacesFn`）が **1 ページ（20 件）だけ**返す。追加読込は持たない — 削除を通すには全部を片づける必要があり、片づけるたびに削除をやり直すとその時点の残りが引き直されるので、ページを繰る導線は残りを見せる役に立たない。続きの有無だけ `hasMore` で伝える。
- 一覧の取得が落ちても実行不可の表示は出す。導線が消えるだけで、拒否を「一時的な障害」に見せ替えない。
- フォームは実行不可の下に残す。TC-39 手順 3 の再実行が、状態を捨てる導線を新設せずに成立する（確認不一致と同じく、状態直和の 1 項が画面全体の差し替えを意味するとは限らない）。
- 行ごとの導線は owner だけ 2 本（P-32 の譲渡・脱退と P-34 の削除）、owner 以外は脱退のみ。L-01 の「使えない行き先は並べずに消す」に揃える。

### Consequences

- 提出の失敗の割り当ては `DeleteAccountPanel/submit.ts` に切り出して単体テストを持つ（`__tests__/submit.test.ts`、3 本）。変異スポットチェック: `WORKSPACE_MEMBERSHIPS_REMAIN` を `panel` へ落とすと red、`errorDisplay.ts` の辞書エントリを外すと red。
- `spec/adr/` 側の canon 化は不要。ここでの判断はすべて既存の canon（P-25 の状態直和と PAGE-p25-004、ADR 047）の実装形に留まる。
- wave を足すスライスが `WORKSPACE_MEMBERSHIPS_REMAIN` を外すとき、辞書の 1 行と `submit.ts` の 1 分岐、`action.ts` ごと落とせばこの状態は消える。

## ADR-143: slug を手放す経路も「同じ要求の再入」で回収する（ADR-118 を `null` 側へ広げる）

### Context

ADR-118 は「local commit 後の global ステップは、同じ要求をもう一度出すことで前進させる」を決め、`changeWorkspaceSlug` では `repairSettledSlug` としてそれを実装した。ただし修復は `slug !== null` のときだけ走る。slug を `null` にする経路は commit 後に `release` を素の 1 回呼び出しで打っており、応答を失うと scope は `slug = null`、global には旧 slug の `active` 行が残る。`active` 行は期限を持たない（`ports/workspaceSlugReservationStore.ts` の「Ownership never transfers on expiry alone」）ので、その slug は**他のどのワークスペースからも二度と取得できない**。ADR-030 が導出 operation ID で塞いだ「再送が自分の予約行と衝突する」窓の、鏡像にあたる穴である。

### Decision

`null` 側を、非 `null` 側とまったく同じ形にする。

1. `release` を `retryOnce` で包む（`activate` と directory 投影は既に持っている）。呼び出しを `releaseSlug` に切り出し、要求パスと修復パスで同じものを使う。
2. `repairSettledSlug` に `slug === null` の枝を足す。手掛かりは `advertisedSlug` — directory 行が広告している slug は「scope が最後に手放した鍵」であり、投影も `release` と同じ窓で失われるので、失敗していれば旧 slug がそこに残っている。`release` はもともと `workspaceId` 条件つきなので、行を後継者から奪うことはない。
3. **鍵の解放は投影より先**に置く。投影が先に走ると directory 行の slug が `null` に落ち、次の要求から手掛かりが消えて回収経路が永久に閉じる。
4. **`null` 枝では削除 barrier を確認しない。** 非 `null` 枝の `assertWritable` は「削除を受理した scope に global の鍵を**取り戻させない**」ためのもの（ADR-118）で、鍵を**手放す**のは削除自身が進む向きと同じである。

### Consequences

- 応答喪失 2 回（＝ `retryOnce` も落ちる）でも、利用者が同じ操作をもう一度出せば鍵が戻る。ADR-117 が「復旧不能ではなくなった」と述べた性質が、`null` 側にも揃った。
- 健全なワークスペースへの `changeWorkspaceSlug(null)` の再送は、directory 行が既に `null` なので `resolveMany` 1 回ぶんの読みだけで no-op のまま。
- 変異スポットチェック: (a) `null` 枝の `release` を落とすと「a release lost for good is reclaimed by re-sending the cleared slug」と「a repair that fails again keeps the trail to the stranded key」が red、(b) 投影を解放より前へ動かすと同 2 本＋ `TC-workspace-307` が red、(c) `releaseSlug` の `retryOnce` を外すと「a lost release response is retried once」が red。
- ポート契約は変えていない（`release` の冪等性と `workspaceId` 条件は既存の JSDoc のまま）。適合スイートに追加すべき節も無い。

## ADR-144: storage 半分の表示値導出も `describe` へ寄せ、workspace 行に非 `none` の水準を 1 本置く

### Context

ADR-136 は LLM 半分の導出を `QuotaEnforcement.describe` へ戻したが、`readWorkspaceUsage` は `consumedBytes` / `limitBytes` / `noteCount` / `level` を今も usecase 内で組み立てていた。`DescribedStorageUsage` はこの 4 つそのものなので、導出の第 2 の住処が storage 側に残っていたことになる。`spec/domains/usage.md` が本ラウンドで足した「表示する数値と警告レベルを導出する場所はこのサービスだけである」と `view.ts` の JSDoc（「a second home to drift from」）が、実装について偽だった。

検出力の側も同じ形で欠けていた。workspace 行のテストは 6 本すべて `level: "none"` しか見ておらず、`level` の導出を壊しても personal 行の TC-usage-045 / 047 しか落ちない。「1 箇所に戻した」が観測できるのは、workspace 行が非 `none` の水準を要求したときだけである。

### Decision

`readWorkspaceUsage` の 4 フィールドを `QuotaEnforcement.describe({ storage: quota, llm: null }).storage` の展開に置き換える。`AvailableWorkspaceUsageView` は `DescribedStorageUsage` に `state` / `workspaceId` / `workspaceName` を足した形なので、スプレッドがそのまま載る。

あわせて **TC-usage-081**（workspace 行が 80 % 境界で `warning`、上限超過で `exceeded` を報告する）を採る。番号は本グループで確保し、台帳への登録は G9 の持ち分。

`AvailableWorkspaceUsageView` を `DescribedStorageUsage` との交差型に組み替える案は採らない。`PersonalUsageView` を含む view の型はどれも primitive だけで独立に書かれており（`view.ts` 冒頭の規約）、1 件だけドメイン型へ結ぶと射影層の一貫性が崩れる。

### Consequences

- ドメイン側の storage 表示規則を変えると personal 行・workspace 行の両方が自動的に追随する。変異スポットチェック: `describe` の storage `level` を `"none"` に固定すると TC-usage-045 / 047 に加えて **TC-usage-081 も red**。同じ変異を入れたまま `readWorkspaceUsage` を旧形（usecase 内導出）へ戻すと TC-usage-081 は **green に戻る** — 落としたのがまさにこの第 2 の住処であることを実測で確認した。
- `spec/domains/usage.md` の断言は実装が canon へ寄る向きなので、spec の改訂は不要（G9 は TC-usage-081 の台帳登録だけを持つ）。

## ADR-145: `WorkspaceDirectoryProjectionWriter` は要求パスに `applySnapshotIfNewer` だけを渡す

### Context

`RequestContainer` は `WorkspaceDirectoryProjectionWriter` をポートごと露出していた。同ファイルは「`Pick`s deliberately drop every OCC write method, so a usecase that wants to mutate is forced through `globalUnitOfWorkProvider.run`」という規律を明文で持ち、`UserReader` / `SessionReader` / `WorkspaceReader` などをすべて `Pick` で絞っている。要求パスがこのポートに対して呼ぶのは `applySnapshotIfNewer` だけ（ADR-040 の 5 本、いずれも `application/workspace/directoryProjection.ts` 経由）で、`tombstone` の呼び出しは `application/workspace/workspaceDeletionGlobal.ts` のワーカー面 1 箇所のみである。`tombstone` は終端操作で、別 operation の tombstone は `ConflictError`、以後どの版の snapshot も行を再開させない。

### Decision

`WorkspaceDirectoryProjector = Pick<WorkspaceDirectoryProjectionWriter, "applySnapshotIfNewer">` を置き、`RequestContainer` のフィールドの型だけをこれに差し替える。`WorkerContainer` はポート全体のまま（ワーカー面が両方を使う）。フィールド名は据え置く — 合成ルートは全体を渡し続けられるので、両ランタイムの配線は 1 行も変わらない。

`ADR-137` の `email?: never` に相当する「広い型を代入不能にする」細工は**採らない**。同ファイルの他の `Pick` はどれも合成ルートからリポジトリ全体を受けており、1 件だけ合成ルートに明示的な絞り込みを強いると規律の形が割れる。

テストハーネスの `tombstoneDirectory` は `h.container` ではなく `h.workerContainer` を通す。「終端操作はワーカー面から来る」という決定を、テストの側も同じ面から踏むようにする。

### Consequences

- 変異スポットチェック: `directoryProjection.ts` に `tombstone` の呼び出しを足すと `TS2339: Property 'tombstone' does not exist on type 'WorkspaceDirectoryProjector'` で落ちる。要求パスから終端操作へ届く経路は型で閉じた。
- 逆向き（別名を再びポート全体へ広げる）はコンパイルエラーにならない — 構造的部分型なので、絞りを外した瞬間に元へ戻る。締めているのは呼び出し側であって定義側ではない、という点は同ファイルの他の `Pick` と同じ性質である。
- ポート契約・アダプター・適合スイートは変えていない。spec 側の改訂も不要（`WorkspaceDirectoryProjectionWriter` の契約そのものは動いていない）。

## ADR-146: 契約が「拒否する」と書いた分岐は `occGuard` まで持たせ、guard 敗北はそのポートのコードへ写す

### Context

Cloudflare の条件付き書き込みのうち 2 本だけが `occGuard` を持たず、JS の先読みと SQL 述語の 2 段だけで分岐を決めていた（review-005-backend-workspace W-003）。

- `workspaceDirectoryProjectionWriter.tombstone`: 「別 operation の tombstone は `ConflictError`」をポート JSDoc が名指しで要求しているのに、SQL 側は `ON CONFLICT … WHERE deletion_operation_id IS NULL OR = excluded` で黙って 0 行にしていた。read と commit のあいだに別 operation の tombstone が着地すると、契約が要求する例外が**成功へ化ける**。
- `workspaceOperationLockStore.stageMove`: `ON CONFLICT (migration_id) DO NOTHING` に guard が無いまま `upsert` の行イメージを overlay へ積むので、別 actor の行が先に着地しても呼び出し側は**自分の actor が pin された**と読み、同じ UoW の後続読みも自分の actor を返す。move authorization lock の目的（actor の Membership 版を pin する）が取り違えられる。

同ファイル群の他の条件付き書き込み（`beginDeletion`、`invitationRouteStore` の交換、`workspaceSlugReservationStore` の `activate` / `reserve`）はすべて `occGuard` を張っており、この 2 か所だけが非対称だった。

### Decision

**`ADR-130` の分割線をもう一段はっきりさせる。** ADR-130 は `applySnapshotIfNewer` について「投影が `ConflictError` で詰まる経路を作らない」ことを理由に `occGuard` を採らず、述語一致で `0 行なら 0 行` を成立させた。裏返すと、**ポートが名指しで例外を要求している分岐は逆で、`occGuard` で write-set ごと落とすのが正しい形になる**。`tombstone` も `stageMove` もそちら側なので、guard を先頭に積む。

- guard 敗北は `classifySqlError` で拾い、`throwTranslated` の既定（`OPTIMISTIC_LOCK_FAILURE`）ではなく**ポート契約が宣言しているコード**へ写す（`WORKSPACE_DIRECTORY_CONFLICT` / `MOVE_AUTHORIZATION_LOCK_CONFLICT`）。先読みで投げる分岐と guard 敗北で投げる分岐が同じ 1 つの契約なので、呼び出し側から 2 つに見えてはならない。`tombstone` は例外の構築を `tombstonedByAnother` へ括り出して 2 経路で共有した。
- `stageMove` の guard 述語は `migration_id = ? AND actor_user_id <> ?` の `NOT EXISTS`。`migration_id` の存在そのものではない — 応答喪失の再送（同じ actor の再実行）は成功しなければならず（ADR-061）、`NOT EXISTS (migration_id = ?)` まで締めるとその冪等性を壊す。
- ポート JSDoc は触っていない。どちらも既存の契約文（「別 operation の tombstone は `ConflictError`」「別 actor を指す再実行は `MOVE_AUTHORIZATION_LOCK_CONFLICT`」）を実装が満たしていなかっただけで、新しい契約の追加ではない。

### Consequences

- レース自体は適合スイートでは作れない（memory は read と write が不可分）。ADR-130 と同じ層分けで、インターリーブは Cloudflare 側に置いた: `tombstone` は既存の `cloudflare/__tests__/projectionConcurrency.test.ts` の workspace directory ブロックへ 1 ケース、`stageMove` は scope 面の並行観測がまだ無かったので `cloudflare/__tests__/scopeConcurrency.test.ts` を新設して 2 ケース（敗北時の `MOVE_AUTHORIZATION_LOCK_CONFLICT` と、同じ actor の交差再送が成功すること）。後者は `globalConcurrency.test.ts` の scope 面版という位置づけ。
- どのケースも `createAutocommitSession` で組む。staged session では `write` が buffer するだけなので、guard 敗北はリポジトリまで届かず commit 時に既定の翻訳へ落ちる（`globalConcurrency.test.ts` が既に述べている性質）。本番の `stageMove` は UoW 内なので、実際に利用者へ届くのは `OPTIMISTIC_LOCK_FAILURE` 側になる — ここで固定したのは「黙って成功しない」ことであり、コードの写しは autocommit 経路の契約である。
- 変異スポットチェック: `tombstone` の `occGuard` を外すと `refuses a tombstone whose row a rival deletion claimed after it was read` が red、`stageMove` の `occGuard` を外すと `refuses a staging whose migration a rival actor locked after it was read` が red。どちらも「`ConflictError` が来ない」として出る。
- spec 側の改訂は不要。ポート契約は動いておらず、変わったのは Cloudflare アダプターがその契約を守るようになったことだけ。

## ADR-147: claim を返すときは、前の attempt が staged した分もまとめて畳む

### Context

`releaseUnusedClaim`（ADR-128 / ADR-133）は「まだ何も staged されていない」を前提に `noteRouteStore.abortMove` だけを打っていた。この前提が成り立つのは**初回 attempt だけ**である。

resume された attempt は前の attempt の staged target（Note・Revision・ファイル metadata・credit・receipt）と**両 scope の move lock**を引き継いだまま走る。その attempt の `claimRoute` が一過性の store 障害で落ちると、catch は route だけを active source へ戻し、operation を `rejected` で終端する。`WorkspaceOperationLockStore` の lock には lease も expiry も無く、`releaseMove(M)` を打つ主体は M を駆動するサガだけなので、残った lock を外せるのは「同じ `requestKey` の再送」しかない。ところが route が active に戻っているため、利用者が**別の移動先**を選んだ瞬間に `routeVersion` が進み、`requestKey`（`noteId:actor:target:routeVersion`）が二度と導出できなくなる。以後、両 workspace の削除（`hasActiveMove`）と actor の membership 変更・除名・脱退（`hasMoveConflict`）が**永久に拒否される**（レビュー ラウンド 5 backend-note W-001）。

`rollBack` の target UoW が落ちた場合にも同型の残骸は残るが、そちらは route が `moving` のまま残る（＝同じ `requestKey` が導出でき続ける）ので恒久停止にはならない。claim 経路だけが「route を返す」と「lock を残す」を同時にやってしまう。

### Decision

`releaseUnusedClaim` が「route はこの migration の下で `moving`」と判定した時点で、裸の `abortMove` ではなく `abortBeforeSwitch(container, plan, route.routeVersion, tagRelocation)` を通す。

- `abortBeforeSwitch` は先頭で `thawRoute`（route の CAS）を打ってから target を解体し、最後に source の lock を外す（ADR-111）。消すのは「attempt の snapshot ではなく target を列挙した結果」なので（ADR-114）、**手順 5 に到達しなかった attempt が前の attempt の staging を戻す**のは既にこの関数の契約そのものである。差分は `tagRelocation` を引数へ足すことと、呼び出しを 1 行差し替えることだけ。
- 初回 attempt では target に何も無いので、`findById` が `null` を返して即 return し、lock の解放は no-op になる。挙動は ADR-128 以前と同じで、増えるのは scope transaction 2 本だけ。
- 補償の失敗の扱いは ADR-133 のまま。本体全体が 1 つの try に包まれ、失敗は `[moveNote] the claimed route was left moving` に落ちて `void` を返す。`settleQuietly` への到達性は変わらない。

### Consequences

- claim の応答喪失は「route も staged も両 lock も戻る」に揃った。`rollBack` 経路との非対称（前者は route だけ返していた）が消えた。
- 検出力: `TC-note-765` を 1 本足した。attempt 1 が stage 後に route store ごと落ちて route を `moving` のまま残し、resume が claim の応答を失う経路で、両 scope の lock が 0 件・target が空・`deleteWorkspace(TARGET_WS)` が `accepted` になることを固定する。変異（`abortBeforeSwitch` を裸の `abortMove` に戻す）で red を確認して戻した。

## ADR-148: receipt で staging を飛ばす attempt は、staged 複製を「今回 freeze した版」へ引き上げる

### Context

`retireSource` は source の Note 行と Revision を**全件無条件**に削除する一方、`stageTarget` は前の attempt の receipt（`markApplied` が `false`）で丸ごと飛ばされうる。route が `moving` のあいだ source は書き込み可能である（move lock が止めるのは membership 変更と scope 削除だけで、`assertWritable` は書き込みを通す）ため、attempt 1 の staging と再送のあいだに入った source への編集は、target へ渡らないまま `retireSource` に消される（レビュー ラウンド 5 backend-note W-002）。

ファイル側は同じ窓を意図的に塞いでいる — 「retire するのは実際に target へ渡った集合」（ADR-114）なので、渡らなかった行は metadata ごと source に残る。しかし **Note 本体だけはその規則を適用できない**: route が名指す scope は 1 つで、「渡らなかったぶんを source に残す」という選択肢が無い。

本デプロイでは `updateNoteBody` / `applyTextNodeEdits` / アップロードのユースケースが無いため到達不能だが、#6 / #7 が入った瞬間にデータ消失として生きる。

### Decision

fix-plan の**第一候補**を採る。`stageTarget` の receipt-stands 分岐を `adoptStagedCopy` に切り出し、staged 複製が古ければ**今回 freeze した snapshot で置き換える**。

- 判定は **target scope をまたぐ読みを必要としない**。staged 複製は `Note.withOwner(frozen)` なので、その版は freeze した版のちょうど 1 つ先である。したがって `staged.version === Version.next(snapshot.note.version)` が「あれから source に何も書かれていない」と同値になり、突き合わせは `stageTarget` が既に持っている 2 つの値だけで閉じる（source を読み直さない）。
- 食い違ったら `noteRepository.save(refreshed, staged.expectedVersion)`、`noteRevisionRepository.deleteByNote` → snapshot の Revision を再 insert、`noteProjectionRevisionStore.bump` を同じ target transaction で打つ。receipt を clear して再 stage する形は採らない — staged 行が既に在るので `insert` が重複キーで落ち、credit の打ち直しまで巻き込む。**置き換えのほうが変更点が少なく、credit（bytes）は動かないので触らずに済む。**
- ファイル metadata は**引き上げない**。ADR-114 の「渡らなかった行は source に残り、retire もされない」がそのまま成立するので、規則を二重化しない。

### Consequences

- `retireSource` の無条件削除が安全である理由が「`adoptStagedCopy` が staged 複製を今回の版へ引き上げているから」になった。両方の JSDoc にその依存を書いた。
- 編集が無い再送では版が一致するので追加の書き込みはゼロ。`TC-note-763`（ファイルだけが増えた再送）は Note の版が動かないため影響を受けない。
- 検出力: `TC-note-766` を 1 本足した。attempt 1 の staging が残った状態で source を rename し Revision を 1 件足してから再送すると、target が編集後のタイトルと 2 件の Revision を持ち、source が空になることを固定する。変異（版の比較を反転して引き上げを常に飛ばす）で red を確認して戻した。

## ADR-149: `"use client"` からしか呼べないサーバー関数の登録は、一覧ではなく import グラフから導く

### Context

`"use client"` の島からしか到達しないサーバー関数は、クライアントビルド前に凍結される RSC マニフェストに載らないので、`routes/__root.tsx` から素の `import "…/action";` で引き込む規律がある（`docs/frontend_implementation_example.md`）。本 PR はこの規律を理解して 5 行を足したが、`DeleteAccountPanel/action`・`WorkspaceMembersPanel/action`・`routes/notes/-action` の 3 モジュールを落としていた（レビュー 005 frontend B-001）。落ちても型は通り、島は import でき、失敗するのは実行時だけで、呼び出し側の `catch`（P-25 は `.catch(() => null)`）がそれを握り潰す。

実測（`pnpm build:node` の出力 `dist/server/rsc/index.js` に載るサーバー関数マニフェストを、3 行の有無で差分を取った）では、**実際に落ちていたのは `WorkspaceMembersPanel/action` の 2 本だけ**だった（`loadMoreMembersFn` / `loadMorePendingInvitationsFn`）。残る 2 モジュールは、島を描く route ファイルからの静的 import 経由でマニフェストに載っていた。ただしそれは今の import グラフの副産物であって規律の成立ではない — 島を別の route に付け替えた瞬間に、同じように黙って落ちる。

### Decision

- 3 行とも足す。マニフェストに載るかどうかを import グラフの偶然に委ねない（`routes/settings/-action` が route から静的 import されているのに登録行を持つのと同じ理由）。
- 登録漏れを**列挙ではなく導出**で拘束する。`app/__tests__/serverFunctionRegistration.test.ts` が `apps/web/app` を走査し、`createServerFn(` を宣言するモジュールのうち **`"use client"` のファイルが値として import しているもの**を求め、それが `__root.tsx` の bare import に含まれることを要求する。型注釈だけの import（`import type`）は消えるので数えない。
- 逆向き（`__root.tsx` の登録行がサーバー関数を宣言しないモジュールを指していないこと）も同じテストで見る。登録一覧が陳腐化して意味を失う側も塞ぐ。

### Consequences

- 新しい島が新しい `action.ts` を持った時点で、登録を忘れるとテストが red になる。手動テストの Phase 4 に頼らずに済む（レビューが「単体テストでは拘束できない」と書いた穴）。
- ホワイトリストを持たないので、「例外として登録しない」を書く場所も無い。登録が不要なモジュール（route からしか呼ばれない `routes/w/-action` など）はそもそも要求集合に入らない。
- 変異スポットチェック: `import "@/routes/notes/-action";` を落とすと red。戻して緑。

## ADR-150: P-25 の「片づける先」は、拒否の根拠と一覧の出所が別集合であることを表示で認める

### Context

受理を拒む `admitAccountDeletion` は settled な edge（`active` / `pending` / `removing`）を数え、実行不可が並べる一覧は `listUserWorkspaces` → `listActiveByUser` の `active` だけを返す。`domain/workspace/ports/userWorkspaceDirectory.ts` が「`listActiveByUser` は代用にならない」と名指しで警告しているとおりで、最後のワークスペースを脱退した直後（`removing`）・招待の受諾が未確定（`pending`）の利用者は、**拒否されながら 1 件も並ばない**。しかも `hasMore` も偽になるので続きの示唆も出ない。一覧の取得が落ちた場合も同じ「空」に潰れていた（レビュー 005 frontend W-001）。

settled な edge を列挙するポートを足すのは Issue #3 のスコープ外（ADR-135 / ADR-142 が置いた「拒否の権威は受理側」の形を越える）。

### Decision

- 画面が持つのは 3 状態の直和にする（`DeleteAccountPanel/remaining.ts`）。`listed`（1 件以上と `hasMore`）/ `settling`（拒否されたのに 0 件）/ `unavailable`（一覧を引けなかった）。`listed` の `workspaces` を非空タプル型にしてあるので、「並べる行があるのに反映待ちと言う」表示は型の上で作れない。
- `settling` は「反映待ちのワークスペースがあります。少し待ってからもう一度お試しください。」、`unavailable` は「一覧を取得できませんでした」を出す。拒否の事実と理由（`errorDisplay` の専用文言）はどちらでも残り、消えるのは導線だけ（ADR-142 の「拒否を一時的な障害に見せ替えない」を保つ）。
- 畳み込みは島から出した純関数に置き、`__tests__/remaining.test.ts` が 3 分岐を固定する（`submit.ts` と同じ理由・同じ置き場）。
- `action.ts` の JSDoc に、この一覧が `active` 限定であることと拒否の根拠との差を書く。

### Consequences

- 前進側（settled edge の列挙ポート、あるいは受理側が拒否の応答に対象を載せる）は別スライスの持ち分として残る。今回の変更はその窓を**隠さない**ようにしただけである。
- 検出力: `remaining.test.ts` を 3 本。変異スポットチェックとして `settling` を `unavailable` に潰すと red、戻して緑。

## ADR-151: P-25 の owner 導線は投影値のままにし、遅れても片づけ手段が消えないことを根拠として書く

### Context

実行不可の行ごとの導線は `UserWorkspaceEdge.role === "owner"` で 2 本 / 1 本に切り替わる。この `role` はポートが「レンダリングしてよいが認可の事実ではない」と定める射影で、昇格・降格から 1 往復ぶん遅れうる。レビュー 005 frontend W-002 は「昇格直後の owner に P-34 が出ない＝唯一の片づけ手段が消える」として、`isOwner` を落として全行に両方出す案を挙げた。

### Decision

実装は変えない（ADR-142 の「行ごとの導線は owner だけ 2 本」＝ L-01 の「使えない行き先は並べずに消す」を維持）。**遅れても片づけ手段は消えない**ためである — どちらの行も P-32 へは行けて、`WorkspaceSettingsTabs` は 4 タブすべてを無条件に並べるので、そこから P-34 へ到達できる。可否は行き先の画面が workspace scope の `Membership` を読み直して判定する。断定していた JSDoc に、射影であること・遅れうること・行き先が再判定することを書き足す。

### Consequences

- タブ列がロールで出し分けを始めたら、この根拠は崩れる。そのときは `isOwner` を落として両方出す側へ倒す（判断の前提はここに書いてある）。

## ADR-152: アカウント削除の受理は「遷移してから判定する」を同一 global transaction で行う（ADR-135 を置き換える）

### Context

ADR-135 は `admitAccountDeletion` に受理ガードを置いたが、2 点で fail closed になっていなかった（レビュー `backend-usage B-001`）。

1. 数える集合が settled（`active` / `pending` / `removing`）だけで、`activating` が抜けていた。`activating` は `reserveAndClaimActivation` が edge を作った瞬間から `activate` が返るまで、参加サガの**全区間**で置かれる状態である。
2. 読みがトランザクションの**外**にあり、しかも判定が `beginOrResume` より前だった。ADR-135 は「ディレクトリはどの UoW にも属さない global 面のポートなので、判断だけをトランザクションの中で下す」としてこれを意図した形と書いていた。

どちらの窓も結末は同じである。受理してしまうと参加側は止まらず（`activate` を拒むのは prepare lock 付きの `pending` edge だけで、本デプロイは prepare wave を持たない）、edge は `active` へ settle し、`appendMembershipPage` が membership item を固定して `prepareAckedAt` が永久に埋まらない。**User は `deleting` のまま復旧不能** — ADR-135 のガードが防ぐために存在していた退行そのものである。

fix-plan-005 の G1 は既定として「1. だけを入れ、残る窓を JSDoc に規定として書き残す」を提案していたが、**復旧不能状態に至る窓を JSDoc に書いて残すのはこのガードを置いた意味を消す**ため、メインの判断で「隙間ごと閉じる」に差し替えた。

### Decision

**`GlobalUnitOfWorkContext` に読み専用の 2 本を露出し、判定を transaction の最後に置く。**

- `settledMembershipReader: Pick<UserWorkspaceDirectory, "countSettledByUser">` と `activatingMembershipReader: Pick<MembershipDirectoryReservationStore, "listActivatingByUser">` を `application/execution/unitOfWork.ts` に足す。`Pick` は `application/di/types.ts` の reader ビューと同じ規律で、**書き込み遷移（とりわけ `commitAccountDeletion` のような終端操作）を 1 本も渡さない**。別名を `di/types.ts` ではなく `execution/unitOfWork.ts` に置いたのは、`di/types.ts` が `execution/unitOfWork` を import する側で、逆向きの import が循環になるためである。
- 判定は `activating` も含める（`settled > 0 || activating.length > 0`）。
- **判定の位置を `User.beginDeletion` の save の直後**、つまり transaction の最後に移す。参加サガ側の関門は `reserveAndClaimActivation` の中の Active-User チェックなので、`deleting` への遷移を**先に publish してから**ディレクトリを読むと、並行する join は「読みより前に edge を書いた（＝判定が見る）」か「あとで書く（＝自分のチェックが落ちる）」のどちらかにしかならない。判定を先に置くと — transaction の中に入れても — その隙間がそのまま残る。
- 受理を拒む場合は transaction ごと rollback するので、operation 行も `deleting` も残らない。ADR-135 の「operation を作る前に投げるので terminal 行が残らない」は、rollback が同じ結果を与えるので満たされ続ける。

### Consequences

- **ADR-135 を置き換える。** ADR-135 の Decision のうち「数える集合は manifest と同一の述語」「読みは UoW の外」「位置は `beginOrResume` の前」の 3 点は無効。残る 2 点（`resume` は判定しない／`ensureRetryable` を先に置く）はそのまま生きている。解除条件（wave を足すスライスがこのガードごと落とす）も変わらない。
- 振る舞いの差は 1 点だけ増えた。**すでに終端した operation の replay**（`operation.state !== "running"`）は、判定より前に返るようになったので拒否されなくなる。これは `admitAccountDeletion` の JSDoc が元から掲げていた「新しい operation を作りうる要求だけを判定する」に沿う向きで、membership item を 1 件も増やさないので fail closed を崩さない。
- リファレンスランタイム（Node + memory）では窓が閉じる。memory backend は transaction を直列化し、書き込みは undo log 付きで即時可視なので、上の 2 分岐がそのまま成り立つ。
- **D1 バックエンドには残差がある。** D1 の write-set は commit まで不可視なので、「join の batch が deletion の読みの後・apply の前に着地する」順序だけは、この並べ替えでは落とせない。閉じるには deletion 側の batch に `occGuard`（`NOT EXISTS (… membership_directory WHERE user_id = ? AND state IN (…))`）を積む必要があり、それは `d1/repositories/userWorkspaceDirectory.ts` に commit 時ガードを足す変更＝本ラウンドで別グループが持つアダプター層に入る。**次の口として名指しする**（本デプロイの唯一のランタイムは memory であり、D1 のこの経路は今日は動かない）。
- 変異スポットチェック（3 点、いずれも一時的に入れて戻した）:
  - `activating` の枝を無効化 → `TC-identity-352` と `TC-identity-353`（afterOperation）が赤。
  - 判定を save の**前**へ移す → `TC-identity-353`（afterAdmissionRead）が赤（受理されたのに edge が残る）。
  - 判定を `beginOrResume` の**前**（ADR-135 の位置）へ移す → `TC-identity-353` の 2 本が赤。
- `domain/workspace/ports/userWorkspaceDirectory.ts` の `countSettledByUser` JSDoc に「この述語は受理条件の全体ではない」を書き足した。数える集合そのものは変えていないので、適合スイートは無改訂。

## ADR-153: 適合ハーネスの任意メンバーを廃し、`ctx.skip()` を契約から締め出す

### Context

`ConformanceBackend.seedMembershipEdges?` は optional のまま残り、JSDoc は理由を「Workspace ドメインができるまで」と述べていた（review-005-backend-workspace W-005）。本 PR で Workspace ドメインは存在し、memory / cloudflare の両ハーネスは既に実装済みなので、5 スイート 16 か所の `ctx.skip()` 分岐は**今日 1 件も発火しない**。にもかかわらず optional のままだと、将来のバックエンドが実装を省いた瞬間に `beginRemoval(pending)`・prepare / commit / release lock の全節・`countOwnedByUser` / `countSettledByUser` の述語が**失敗ではなく skip として静かに外れる**。ADR-026 の「両バックエンドが同一に通す」が破れていることが緑のまま隠れる。

### Decision

`seedMembershipEdges` を必須メンバーへ昇格し、16 か所の `ctx.skip()` 分岐を落とした。JSDoc の理由も「消えた前提」から「**このポートのどのメソッドも作らない状態**（`pending` edge と membership を名指さない edge）を書けるのはハーネスだけだから」へ書き換えた。

執行は `adapters/__tests__/conformanceCoverage.test.ts` の 2 本で行う。

- 「`ConformanceBackend` は任意メンバーを 1 つも宣言しない」— 従来の「両ハーネスが任意メンバーを実装している」を置き換える。必須メンバーは型が強制するので、optional の再導入だけがこの穴を開け直せる。
- 「`conformance/` のどのケースも自分を skip しない」— `.skip(` の textual 検査。任意メンバー経由でなくても、実行時に契約節を落とす形は同じ害を持つ。

### Consequences

- `seedPendingEdge` / `seedEdges` / `seedOwnerEdges` は `boolean` を返すヘルパーから素の `Promise<void>` になった。呼び出し側の `if (!(await …)) { ctx.skip(); return; }` が消えたぶん、ケース本体が契約そのものだけを述べる形になる。
- `cloudflare/__tests__/harness.test.ts` の「任意 seed を提供している」ケースは、**seed が実ストレージに届く**ことをポート越しに読み返して確かめる形へ差し替えた（`toBeDefined()` はスタブでも通る）。
- 環境で落ちる skip（`adapters/oauth/` の資格情報未設定）は `conformance/` の外なので対象外。1 実行あたりの skip はこの 3 件だけになった。

## ADR-154: 予約は全状態で membership を名指す（`pending` は「まだ名指さない」ではない）

### Context

`applyRoleIfNewer` の JSDoc は `:236-238` で「Every state takes the write — `pending` / `activating` の edge も予約のロールを運ぶ」と述べた 7 行あとで、「another membership を名指す edge — **または `pending` 予約が持つ「まだ無い」** — は同じ no-op」と述べていた。同じメソッドの JSDoc に `pending` について正反対の 2 文が並んでいる（review-005-backend-workspace W-002）。`spec/database/index.md` と D1 の `0001_global_schema.sql:156` も NULL 許容の理由を「`pending` edge は Membership の存在に先立つ予約だから」と説明していた。

実装は逆で、`reserveAndClaimActivation` は `membershipId` を**必須引数**として受け（呼び出し側は予約より前に ID を採番している）、両アダプターとも常に値を書く。`membership_id IS NULL` の行は適合スイートのシードでしか作れない。

放置すると、第 3 のバックエンドが素直に `membership_id` を NULL で予約し、その edge にはロール投影が**恒久的に届かない**（ADR-138 が `null` を fail closed に倒したため）形が canon 公認になる。

### Decision

**記述を実装へ寄せる。** ポート JSDoc から「or none yet, which is what a `pending` reservation carries」を落とし、`reserveAndClaimActivation` の側に「`membershipId` は edge がどの状態に落ち着くかに関わらず書かれる」を明記した。`applyRoleIfNewer` 側は「名指さない edge も no-op」を**理由ごと**書き直した — 一致しないからではなく、**どの世代の行かを識別できないから** fail closed に倒す。

D1 の CHECK（`state NOT IN ('active','removing') OR membership_id IS NOT NULL`）と NULL 許容はそのまま残す。列を `NOT NULL` にすると「membership を名指さない edge」が D1 で表現不能になり、その fail closed 規則を**適合スイートが両バックエンドで固定できなくなる**（＝ ADR-026 が要求する「同一に通す」から 1 節が落ちる）。マイグレーションのコメントは、NULL 許容の理由を「書き手は常に値を入れる／要求は CHECK が持つ」へ直した。

### Consequences

- 適合ケースを 1 本追加（ADP-workspace-073「an edge that names no membership takes no projection」）。membership を名指さない `pending` edge にロール変更を当てても書かれず、`activate` 後も予約のロールが残ることを固定する。
- 変異スポットチェック: memory は世代ガードを `!== null &&` 付きへ緩めると red。Cloudflare は JS ガードと `AND membership_id = ?` の**両方**を緩めないと red にならない（ADR-138 と同じ理由：SQL 述語単独の検出力は read/write のインターリーブを要する）。
- canon への申し送りは G9: `spec/domains/workspace.md:340` と `spec/database/index.md:69,79` の同文。

## ADR-155: 除去状態機械の未検証セルと「除去する唯一の遷移」を適合スイートで締める

### Context

ADR-026 は「ポート契約の正本は JSDoc、適合スイートはその実行可能形」であり、締めていない節はバックエンド間で割れても緑のまま通る。ラウンド 5 のレビュー W-004 は 4 つの節が未検証であることを挙げた。いずれも本ラウンドが触った 2 領域（除去状態機械・世代照合）そのものである。

- 除去 3 遷移 × 5 状態のうち 3 セル: `abandonRemoval(pending)` / `completeRemoval(activating)` / `completeRemoval(pending)` → Conflict。
- `commitAccountDeletion` の「edge を**除去する**唯一の遷移」。既存ケースは後続で `activate` の Conflict しか見ておらず、**行を残して印を付けるだけの実装が通る**（残すと `(userId, workspaceId)` が恒久占有され、除名済み利用者が再参加できない）。
- global 側 `acknowledge` の「初回タイムスタンプ勝ち・未知キー無視」。`acknowledgeLocal` 側だけがあった。
- `applyRoleIfNewer` × membership を名指さない edge → no-op（ADR-154）。

### Decision

4 節を適合ケース 4 本で締める（ADR-154 のぶんを含めて計 4 本 + W-006 由来 2 本 = 6 本）。ADP の採番は ADR-140 の「ポートのメソッド 1 本 = 1 ID」に従い**既存 ID を共有**する（新規メソッドが無いので新しい ADP 行は起こさない）。

- ADP-workspace-070/074: `activating` / `pending` の 4 セルを 1 ケースにまとめ、末尾で「どちらの edge も無傷で、それぞれの saga が自分のものを settle できる」まで見る。
- ADP-workspace-038: commit のあと `(userId, workspaceId)` へ**新しい join が通る**ことを見る。行を残す実装はここで落ちる。
- ADP-workspace-058: 初回の `globalAckedAt` が 2 度目の ack で動かないこと、未知キーが item を増やさないこと。
- ADP-workspace-073: ADR-154 のケース。

### Consequences

- 変異スポットチェックは 4 節 × 2 バックエンドの 8 点すべてで red を確認して戻した。`completeRemoval` は「`active` だけを拒む」へ緩める、`abandonRemoval` は `pending` を通す、`commitAccountDeletion` は削除を `state='removing'` の印付けに替える、`acknowledge` は `global_acked_at` 側だけ「初回勝ち」を外す、という 1 点変異で、いずれも該当ケースだけ（Cloudflare の commit 変異のみ近傍 3 ケースも巻き込む）が落ちる。
- canon への申し送りは G9: `spec/inventory/adapter.md` の ADP-workspace-029 / 035 / 038 / 058 / 070 / 073 / 074 の「内容」欄。**新しい ADP 行は起こさない。**

## ADR-156: `abandon` は prepare 済み edge に触れない／`activateReplacement` は閉じた replacement でも旧 route を閉じる

### Context

ポート JSDoc が述べる契約と実装がずれている箇所が 3 件あった（review-005-backend-workspace W-006）。いずれも両バックエンドで同じ挙動なので退行ではなく、契約側の未整理である。

- (a) `MembershipDirectoryReservationStore` の JSDoc は「prepare lock 済み edge は `commitAccountDeletion` だけが取り消す」と書くが、`abandon` は `deletion_prepare_operation_id` を見ずに `pending` / `activating` を消す。
- (b) `WorkspaceSlugReservationStore.reserve` の JSDoc は「どの枝を通っても行は `attemptId` に握られて返る」と書くが、既に `active` な**同一 operation** の行には `attempt_id` を書かずに return する。
- (c) `InvitationRouteStore.activateReplacement` は replacement 行が既に `revoked` だと**旧行を一切見ずに成功を返す**。resend の local commit 後・交換前に `revokeInvitation` が新トークンを閉じた場合がこれで、旧 route が `active` のまま恒久的に残る（`active` 行には期限も回収経路も無い）。

### Decision

**害の向きで寄せ先を決める。**

- (a) **実装を契約へ寄せる。** 両アダプターの `abandon` に「prepare 済みは触らない」を足した（D1 は JS ガードと `AND deletion_prepare_operation_id IS NULL` の両方）。JSDoc 側にも理由を書いた: 落とすと削除の対象が足元から消え、後続の join が manifest cursor の裏で pair を取り直せる。
- (b) **JSDoc を実装へ寄せる。** 結果状態が同じで、`abandon` が `active` 行に触れない以上、`active` 行に握り替える試行が存在しない。「`reserved` 行だけが `attemptId` に握られる／`active` はそのまま」と書き直した。
- (c) **契約が黙認する形にしない。** replacement が閉じていても `oldTokenHash` が `active`（かつ同一 invitation）なら閉じる形にし、JSDoc にその分岐を書いた。実害は小さい（scope の Invitation が権威なので preview は `revoked`、accept は `INVITATION_NOT_PENDING`）が、**状態としては修復不能**であり、live route が残ることそのものを契約が許してはならない。別 invitation に紐づく旧 route は触らない。

### Consequences

- (a) と (c) は挙動が変わるので、ADR-026 に従い JSDoc・両アダプター・適合スイートを対で動かした。適合ケースを 2 本追加（ADP-workspace-035/036「a join's compensation cannot cancel an edge a deletion has prepared」、ADP-workspace-029「an exchange whose replacement was revoked still closes the old route」）。
- 変異スポットチェック: 4 点（両バックエンド × 2 件）すべてで該当ケースが red。特に (c) は追加した close 分岐を落とすと `resolveActive(旧トークン)` が非 null になり、**live route が残ること**が直接赤で出る。
- (b) は契約側だけの改訂なので適合スイート無改訂。
- canon への申し送りは G9: `spec/domains/workspace.md` の `abandon` と `activateReplacement` の記述。

## ADR-157: `workspace_directory` の投影は「要求パスの同期 best-effort」と canon に書く（配送保証を名乗らない）

### Context

`spec/domains/workspace.md` は `workspace_directory` の snapshot 投影を「out-of-band かつ at-least-once」と述べていた（review-005-general B-002）。実装は逆で、`applySnapshotIfNewer` の呼び出し元は `application/workspace/directoryProjection.ts` だけであり、`createWorkspace` / `updateWorkspaceProfile` / `changeWorkspaceSlug`（2 箇所）/ `publishWorkspace` / `unpublishWorkspace` がいずれも**要求パスから同期的に**呼ぶ。`workers/subscribers.ts` に登録された workspace の購読者は `workspace.membership.roleChanged` の 1 件だけで、この 5 つのイベントの購読者は存在しない。実体は `retryOnce` の 1 回再試行で終わる best-effort である。

### Decision

**canon を実装へ寄せる。購読者を新設して本当に out-of-band にする案は採らない。**

1. 5 イベントの購読者を置いて要求パスの同期呼び出しを外す変更は、ADR-051 / 076 が「本スライスに recovery / 再駆動の口を作らない」と決めた範囲そのものに入る。
2. 実装（`retryOnce` 付き同期 best-effort）は誤りではない。失った snapshot は利用者の次の保存で打ち直せる**復旧可能**な窓である。
3. canon は実装について真でなければならない（`CLAUDE.md`「Design canon」）。偽の配送保証を残すほうが、窓を隠すぶん害が大きい。

`spec/domains/workspace.md` の当該段落を「呼び出し口は 2 つ（要求パスの `applySnapshotIfNewer` とワーカー面の `tombstone`）／修復する購読者は今日いない／順序は `sourceVersion` だけ／同じ snapshot の再送は無害」に書き換え、**投影をイベント名で語る書き方をやめた**。

### Consequences

- 「修復口が無い」という事実が canon に現れる。前進側（修復購読者の新設）は新規 Issue へ defer 済み（`triage-keys.md`）。次ラウンドで再指摘しない。
- ドメインイベント表と 256 行の食い違いが解消する。表は `workspace.created` を「投影は購読しない」、残り 4 件を `projectNoteChanges` の購読としか書いておらず、そちらが実装どおりだった。
- 実装は 1 行も変えていない。

## ADR-158: 退役した TC ID は欠番のまま残し、再利用しない（規約を台帳の冒頭に置く）

### Context

`spec/inventory/test.md` の TC-usage 群は 001〜080 のうち 006 / 008〜012 が欠番で、これは `moveNote` のサガ化に伴って退役させた ID を再利用しないための意図的な措置である。しかし台帳冒頭の採番規約は「新規は各群の末尾に採番する」としか述べておらず、退役 ID を残す規則が無かった（review-005-general W-003）。理由は `.thread/3/adr.md` にしかなく、`CLAUDE.md` はそこを canon から引くことを禁じている。他の 8 群はすべて連番なので、読み手はこの 6 件が意図か採番ミスかを判別できない。

### Decision

台帳冒頭の採番規約に**理由そのもの**を 1 文足す: 「退役した ID は欠番のまま残し、別の内容に再利用しない — ID は識別子であり、再利用すると過去の参照（レビュー・コミット・コード中の `it` 名）が別のケースを指すことになる。群の中に飛びがあっても採番ミスではなく、次に採番する者はその番号を埋めずに末尾へ足す」。`.thread/` は引かない。

### Consequences

- ADR-140（「台帳の採番は連番へ揃える」）と併せて、「連番へ揃える」が**退役分の穴埋めを含まない**ことが明示される。
- 次ラウンド以降の機械的検証は、TC-usage の 6 件の飛びを欠陥として数えない。
- 他の 4 台帳（domain / adapter / usecase / frontend）は今日 1 件も退役 ID を持たないので、規約は test 台帳にだけ置く。
