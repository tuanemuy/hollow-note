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
