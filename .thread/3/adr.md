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
