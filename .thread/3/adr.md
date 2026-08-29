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
