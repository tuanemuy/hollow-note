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
