# ADR — Issue #14: spec と実装の乖離を同期する（skeleton スライスで蓄積した分）

## ADR-001: 乖離を倒す向きは項目ごとに `spec/adr/046` を当てて決める

### Status

Proposed

### Context

Issue 本文は「実装が正、spec が追随する」を基本方向として示している。しかし 24 件を実ファイルで検証したところ、少なくとも 1 件（SYNC-24 = L-02 のサインイン済み CTA）は spec が明示要件を持ち、実装がそれを落とした側だった。また SYNC-08（`reconstruct` の交差検査）のように「spec にどちらを書くか」がまだ決まっていないものもある。

一律に「実装を正」とすると、削除された要件がそのまま spec からも消えてしまう。

### Decision

`spec/adr/046-port-contract-divergence.md` の判定規則を項目ごとに当てる。

- **正本が実装 ＋ 適合スイート / 自動テスト側にある**（約束を足すこと自体が新しい設計判断になる、または実装が明示的な契約 JSDoc とテストで固定している）→ spec を追随させる
- **正本が設計側にある**（spec / ADR がその振る舞いを要求しており、実装が単に落とした）→ spec は据え置き、**実装変更として別 Issue へ切り出す**。本 Issue では直さない
- どちらとも決まっていない（SYNC-08）→ 決めること自体が設計判断なので、本 Issue のドキュメント同期には混ぜず別 Issue へ

あわせて ADR-046 の「乖離は見つけたら倒す対象になり、記録して先送りする選択肢を残さない」に従い、progress.md が「後続スライスで確定（記録のみ）」としていた SYNC-13 / 14 / 15 は**本 Issue で決着させる**。Issue #2 で削除フローと OAuth が実装され、適合スイートが解釈を固定したため、先送りの理由が消えている。

### Consequences

- 良い点: 「実装が正」を機械的に適用して要件を静かに失う事故を防げる。倒す向きの根拠が項目ごとに残る
- トレードオフ: 3 件（SYNC-08 / 23 / 24）が本 Issue では未決着のまま残り、フォローアップ Issue の起票が必要になる

---

## ADR-002: 適合ケースに新しい ADP ID を採番せず、契約はポート定義本文に書く

→ `spec/adr/052-adapter-inventory-granularity.md` に昇格

### Status

Proposed

### Context

Issue #1 のラウンド4で追加した適合ケース 8 本が、既存の ADP ID（`ADP-note-015` / `ADP-note-021` / `ADP-note-046,047` / `ADP-common-012,017,019,021`）に相乗りしている。`.thread/1/progress.md:66` は「`spec/inventory/adapter.md` にケース行を追記するか、membership cleanup レーンに新 ADP ID を採番するかは要判断」と保留していた。

調査で分かった制約:

- `spec/inventory/adapter.md` はヘッダーに「生成元: `spec/domains/`」と書いてある**生成物**であり、**1 行 = 1 ポートメソッド**という不変を守っている（ケース単位の行は 1 つも存在しない）
- `spec/testcases/ports/` を新設する案は `spec/adr/026-port-contract-and-conformance.md`（`.thread/1/adr.md` ADR-003 由来）で既に棄却済み。「コードの共有スイート自体を契約の実行形とし、ADP 行との対応は describe 名に ADP ID を含める命名規約で追う」
- 相乗りしているケースのうち `ADP-common-017/019/021` の「membership item は cleanup レーンが走って初めて完全 ack になる」は、3 メソッドのどの 1 行にも収まらない**横断的な振る舞い**

### Decision

新しい ADP ID は採番しない。

1. 契約そのものは**ポート定義の正本**（`spec/domains/note.md` のポート説明段落、`spec/domains/index.md` の `AccountDeletionManifestStore` 節）に書く
2. `spec/inventory/adapter.md` は生成物なので、既存行の「実装されるべき振る舞いの要点」欄を本文に追随させるだけにする（`ADP-note-015` に順序、`ADP-note-046/047` に列挙 state、`ADP-note-021` にエスケープ契約、`ADP-common-012` に replayed begin、`ADP-common-017/019/021` に cleanup レーンの位置づけ）
   - このうち `ADP-note-021` と `ADP-common-012` は**本文修正を伴わない**。`highlightedExcerpt` のエスケープ契約は `spec/domains/note.md` の「`excerpt` と `highlightedExcerpt` の描画契約は正反対である」節に既に詳述されており、replayed begin も現行の「冪等に開始する」で概ね充足している。要点欄の追随だけで決定 1 を満たす
3. ヘッダーの「最終同期」日付を更新する。あわせて**ヘッダーに生成規則を 1 行明文化する**（「1 行 = 1 ポートメソッド。適合スイートのケースは行にせず `describe` 名の命名規約で追う」）。この不変はどの spec ファイルにも書かれておらず、書かなければ次の spec-sync で必ず再燃する

### 検討した代替案

- **`ADP-common-040` を新規採番して membership cleanup レーンの行を足す**: 台帳の「1 行 = 1 ポートメソッド」不変が壊れ、以後「どこまでがメソッドで、どこからがケースか」の判断が毎回必要になる。加えて Issue #2 の spec-sync が `describe` / `describePersonalCleanup` の採番漏れ 2 件を埋める予定なので、番号の取り合いになる
- **ケース単位の行を全 ADP に展開する**: 適合スイート 35 本ぶんを台帳へ二重管理することになり、`spec/adr/026` が「実行形を正とする」と決めた理由と反する

### Consequences

- 良い点: 台帳の生成規則が保たれる。契約が「実装者が読むポート定義」に集まる
- トレードオフ: 適合ケース 1 本ずつを ID で追跡することはできない（describe 名の命名規約で追う既存方針のまま）

---

## ADR-003: `docs/*_implementation_example.md` は現行実装で書き直す（「歴史的な例」と注記して残さない）

### Status

Proposed

### Context

2 ファイルとも Todo ドメイン ＋ Cloudflare/D1 前提のままである。

- backend（457 行 / Todo 言及 5 箇所）: File Layout（L7-64）が `di/serverCloudflare.ts` / `packages/core/src/presentation/` / `adapters/d1/*` を並べ、`## Adapter Layer`（L351-394）は D1 + Drizzle + PendingBatch + `_occ_guard` 前提。いずれも現行に対応物が存在しない
- frontend（880 行 / Todo 言及 67 箇所）: 参照パスは 1 つも実在しない。ただしパターン（loader ＋ `renderServerComponent` ＋ `Suspense` ＋ `Deferred`、`cache(serverData(...))`、server function のインライン宣言、リスト所有権のクライアント島）は**すべて現行と同型**で、対応する実ファイルが存在する

選択肢は「冒頭に『テンプレート由来の歴史的な例』と注記して残す」か「現行実装で書き直す」か。

### Decision

書き直す。

- **backend**: File Layout と `## Adapter Layer` 節を現行構成（`adapters/memory/` `adapters/node/` `adapters/oauth/` `adapters/conformance/`、`apps/web/app/presentation/`、`application/errors.ts`）で再執筆する。UoW 節は二面（`GlobalUnitOfWorkProvider` / `ScopeUnitOfWorkProvider`、ADR-023）へ、`IdempotencyStore` 節はポート＋ memory 実装へ差し替える。domain 層の書き方（brand VO / `create` ファクトリ / `EventDraft` 収集）は現行と同型なので例だけ Note / Identity に置換する
- **frontend**: 構造は保ち、識別子とパスを機械的に差し替える（`renderTodoList` → `renderNoteList`、`routes/todo/index.tsx` → `routes/notes/index.tsx`、`TodoBoard` → `components/settings/IdentityList/board.tsx`、`TodoItem` → `NoteList` の行、`createTodoFn` 等 → 実在の `-action.tsx` / `action.ts`）。あわせて現行にあって未記載の `renderServerFragment`（ADR-031）と `start.ts` の CSRF ミドルウェアに触れる

### 検討した代替案

- **「歴史的な例」と注記して残す**: `CLAUDE.md` の Examples 節が「具体的な実装パターンは `docs/*` を参照」と指しているため、注記付きで残すと**現行の唯一の実装例ガイドが歴史的な例を指す**という矛盾が生まれる。加えて `spec/usecases/usage.md:120` は backend の記述を**規範として引用**しており、規範文書が「歴史」であってはならない
- **2 ファイルを削除して CLAUDE.md に統合**: CLAUDE.md は 103 行の規約文書で、コード片を含む 1,300 行超の例示を吸収できない。参照元 4 か所（README / spec/usecases/usage.md / pagination.ts / CLAUDE.md）が全部宙に浮く

### Consequences

- 良い点: `CLAUDE.md` → `docs/*` → 実コードの参照が全部つながる。`spec/usecases/usage.md:120` の引用が有効なまま残る
- トレードオフ: 本 Issue で最も分量の大きい作業になる（backend の 2 節再執筆 ＋ frontend の 67 箇所置換）。ステップを 2 つに分けて独立にレビュー可能にする

---

## ADR-004: rollback の完了判定は「ポート述語」と「ユースケースの復帰ゲート」に分ける

→ `spec/adr/053-account-deletion-rollback-completion.md` に昇格

### Status

Proposed（計画レビュー R1 で決定を差し替えた。旧決定「`allRollbackReleased` から personal abort ack を外し、spec の 2 か所ともそれに合わせる」は下記のとおり誤り）

### Context

`spec/domains/index.md` の `AccountDeletionManifestStore` 記述は「全prepare/release/cleanup/redaction item ackとpersonal/global receipt集合がfinalize/**rollback**の正本である」と書き、`spec/usecases/identity.md` の rollback 手順は「`allRollbackReleased`が全workspace release ackと**personal abort ack**を確認した後だけUserを`active`へ戻して」と書いている。

実装側の事実は次のとおり。

- `adapters/memory/repositories/accountDeletionManifestStore.ts:121-122` の `allRollbackReleased` は membership item の release ack だけを見て receipt を参照しない。`markRejected`（`:456`）のゲートも同じ述語
- 適合スイート `adapters/conformance/accountDeletionManifestStore.ts:495-506` が「beginRollback → release ack 2 件 → `allRollbackReleased === true`」を期待値として固定している
- **ポート契約 JSDoc（`application/ports/accountDeletionManifestStore.ts:95-98`）は spec と同じ側にいる** — 「the full set of item acks plus the personal/global receipt set is the source of truth for finalize / rollback」。`spec/adr/046` の分類でいえば「JSDoc が実装より強い」ケースであり、ADR-001 の判定表が SYNC-14 に付けた「正本は実装 ＋ 契約 JSDoc ＋ 適合スイート」という前提はこの項目については成立していない
- **rollback 経路そのものは application 層に 1 行も配線されていない** — `beginRollback` / `allRollbackReleased` / `abortPersonalAccountDeletion` を呼ぶ application コードは存在せず、参照はポート定義・memory 実装・適合スイートに閉じている

計画レビュー R1 の指摘（arch:P-001 / arch:P-003）を受けて、旧決定が根拠にしていた `application/cleanup/participants.ts:68` の `Exclude<AccountDeletionReceipt, "personalAbort">` を読み直した。これは `globalCleanupParticipants`（= `allRequiredAcknowledged` が使う **finalize の必須 receipt 集合**）の型注釈であり、「`personalAbort` は finalize の必須集合に入らない」ことしか言っていない。`.thread/2/progress.md` 自身が「`personalAbort` は **rollback 側の receipt** なので必須集合の対象外」と書いており、**rollback と無関係だという根拠にはならない**。

さらに spec 本文は `abortPersonalAccountDeletion` を「`personalAbort` receipt として再送可能にする」と**非同期 ack の語彙**で書いている。旧決定が根拠にした「個人 scope の barrier 解除は同じ turn の中で自 scope に閉じて完了しており、分散配送の待ち対象ではない」は spec からも実装からも読み取れない。

### Decision

**判定を 2 層に分ける。** 「ポート述語の判定対象」と「ユースケースが User を `active` へ戻す条件」は別物であり、片方の話をもう片方に写さない。

1. **ポート述語** `allRollbackReleased` の判定対象は、固定済み membership item の release ack **のみ**。`personalAbort` receipt を含めない。ここは実装 ＋ 適合スイートが正本なので `spec/domains/index.md` を追随させる。非対称の理由（rollback は「prepare を出した先へ解放を配り切ったか」、finalize は「全参加者が終えたか」という別の問い）を 1 文添える。あわせて**同じ側にいた契約 JSDoc も是正する**（ステップ 8-3）— 放置すると Issue #11 の D1 実装者が JSDoc どおり receipt を見る実装を書いて適合スイートで落ち、`spec/adr/026` の決定 1（JSDoc だけを読んで実装したものがスイートを通る）が壊れたままになる
2. **ユースケースの復帰ゲート**は変えない。`spec/usecases/identity.md` の rollback 手順は「`allRollbackReleased` **と** personal barrier の abort ack の両方を確認してから User を `active` へ戻す」と読める形に書き換える。ここは実装が存在しないため spec が正本のまま残る（`spec/adr/046` は「正本が設計側にある場合は契約を必須として書き直す」と定めている）
3. あわせて `spec/domains/index.md` に「membership item の完全 ack は cleanup phase の ack を含む（prepare ack ＋ 宣言 receipt だけでは `allRequiredAcknowledged` にならない）」を書く。適合スイート `:509-570` が固定している横断的な振る舞いで、`spec/inventory/adapter.md` の 3 行のどれにも収まらない（ADR-002 の決定 1 により、契約本文はポート定義の正本側に書く）

### 検討した代替案

- **旧決定（spec 2 か所とも personal abort ack を落とす）**: 述語の話をユースケースの手順にも写すことになり、「User は `active` に戻ったが personal scope の barrier receipt は残っていて自分のノートに書けない」という状態を spec が禁止しなくなる。実装がそのゲートを別の形で持っている確認も取れない（rollback 経路が未配線のため）。**実装のバグ（ゲート漏れ）を spec へ書き写す**危険がある
- **述語 `allRollbackReleased` の側に personal abort ack を足して spec に合わせる**: 適合スイートが固定した期待値を壊す。かつ「配り切ったか」を問う述語に自 scope の記録を混ぜることになり、finalize 側との役割分担が不明瞭になる

### Consequences

- 良い点: 保留していた W-026 が決着する。`personalAbort` の位置づけ（述語の対象ではないが復帰の前提ではある）が spec から読める。契約 JSDoc・spec・適合スイートの三者が同じことを言う状態になる
- トレードオフ: rollback / prepare 経路そのものは application 層に未配線（`workers/subscribers.ts:75-133` は cleanup / redaction / finalize の 3 phase のみ）。spec が先行して確定する形になるため、**workspace スライスが配線する時点で 2 層の分担を再検証する**。この再検証項目はステップ 16 のフォローアップ Issue に 1 行残す（spec 本文には作業メモを置かない — `spec/index.md` の方針）

---

## ADR-005: `PROVIDER_ACCOUNT_ALREADY_LINKED` の担保は `IdentityUniqueDirectory` に置く

→ `spec/adr/054-provider-account-uniqueness-owner.md` に昇格

### Status

Proposed

### Context

`spec/domains/identity.md:379` は `IdentityRepository` のエラーケースに `ConflictError("PROVIDER_ACCOUNT_ALREADY_LINKED")` を挙げ、`:369`（`IdentityUniqueDirectory` を含む群）は挙げていない。実装は逆で、`adapters/memory/repositories/identityRepository.ts` に一意性検査は 1 行も無く、`adapters/memory/repositories/identityUniqueDirectory.ts:9-13,22-28` が唯一の担保である。

`.thread/1/progress.md:72` は「OAuth スライスで repo 層に担保を実装するか、契約を directory 側へ寄せるか」を保留していた。Issue #2 で OAuth（`linkOAuthIdentity` / `completeOAuthSignIn`）が実装されたが、担保は directory のままである。

### Decision

契約を `IdentityUniqueDirectory` 側へ寄せる。`spec/domains/identity.md:379` から当該コードを外し、`:369` 側へ移す。`domain/identity/ports/identityRepository.ts:6-8` の JSDoc も同時に是正する。

`spec/adr/038-provider-account-claim-and-identity-row.md` は「claim は索引であって資格ではない」と定め、読み側で identity 行を同一トランザクションで照合する形を選んでいる。索引の一意性を索引の持ち主（directory）が担保するのは、この決定と自然に整合する。`IdentityRepository` に担保を足すと、同じ不変条件が 2 か所で強制され、`spec/adr/048-uniqueness-reservation-operation-id.md` が定めた予約の操作 ID 体系の外に検査が 1 つ増える。

### Consequences

- 良い点: JSDoc だけを読んだ実装者が到達する振る舞いと、適合スイートが通す振る舞いが一致する（`spec/adr/026` の決定 1）
- トレードオフ: `IdentityRepository` の D1 実装者は「provider account の一意性制約を DB 側に置くかどうか」を自分で判断できなくなる（置いてもよいが、契約としては要求されない）。契約を弱めた側の責務移転として、directory 側の記述に「provider account の一意性はここが唯一の担保」と明記する

---

## ADR-006: 実装変更を伴う 3 件はスコープ外とし、フォローアップ Issue へ切り出す

### Status

Proposed

### Context

24 件のうち 3 件は、spec を直すだけでは閉じない。

- **SYNC-08**（`reconstruct` の visibility × content 交差検査）: 現実装は検査しない。spec に「拒否する」と書くなら実装変更が要る。「再検査しない」と書くこともできるが、それはドメイン不変条件の適用範囲を狭める設計判断
- **SYNC-23**（フォーカスリング）: `--shadow-focus: 0 0 0 2px var(--color-accent)` が accent 塗りのコントロール上で判別できない。最小構成でも実装 CSS 2 ＋ 実装 TS 1 ＋ 設計ドキュメント 2 ＋ モック HTML 43 = 47 ファイル。デザイントークンの再設計（内側リング / オフセット）を伴う
- **SYNC-24**（L-02 のサインイン済み CTA）: `spec/pages/index.md:98,105` が明示要件を持ち、実装が `signedIn` prop ごと落としている。直すには `/terms` `/privacy` にセッション読み取りを足す必要がある

### Decision

3 件とも本 Issue のスコープ外とし、plan.md の「含まれないもの」に理由つきで記載したうえで、フォローアップ Issue を起票する。spec 本文は現状のまま触らない（SYNC-24 の要件行を消さない）。

起票は**新規 Issue 4 本**とする（「既存 Issue のコメントか新規 Issue か」の二択は取らない — どちらでもよい形にすると済んだかを判定できない）。4 本目は SYNC-27（`ExternalServiceError` の全域語彙整合）で、これは実装変更ではなく「未実装ドメインでは写し先の裏づけが取れない」という別の理由でスコープ外にしたもの。4 つの Issue 番号を本 Issue の完了コメントに列挙する（AC-23）。

なお SYNC-24 のうち **P-40（トップ）は本 Issue で閉じる**（SYNC-26 / ADR-009）。この Issue の対象は L-02 の 2 か所と `PublicShell` / `LegalPage` に限る。

判断の根拠は 3 つ。

1. 本 Issue の目的は「spec と実装の乖離を**同期する**」であり、UI の挙動やデザイントークンを変える判断は別の意思決定
2. SYNC-23 はモック 43 本の一括置換を含み、デザインレビュー（`design-flow` / `spec/design/`）の管轄
3. SYNC-08 / SYNC-24 は「spec を直せば閉じる」か「実装を直せば閉じる」かの選択そのものが未決で、決めるにはドメイン設計 / UI 設計のレビューが要る

### 検討した代替案

- **SYNC-08 を「reconstruct は書き込み経路が守った不変条件を再検査しない」と spec に明記して閉じる**: 1 行で閉じるが、`reconstruct` は既に必須列の欠落を拒否している（SYNC-06）ので、「何を再検査し、何をしないか」の線引きを設計判断として下すことになる。本 Issue の他 19 件が「実装済みの契約を書き写す」作業であるのに対し、これだけ性質が違う
- **SYNC-24 の spec 行（`:98` `:105`）を削除して実装に合わせる**: 要件を静かに失う。`/terms` `/privacy` は `PublicShell` を `LegalPage` 経由で使っており、削除理由（「到達しない分岐」）は `/` にしか当てはまらない

### Consequences

- 良い点: 本 Issue が「ドキュメントだけを触る」性質を保ち、レビューとロールバックの単位が明確になる
- トレードオフ: 3 件の乖離が HEAD に残る。`spec/pages/index.md` の L-02 は「spec が要求し実装が満たしていない」状態が続くため、フォローアップ Issue の起票を本 Issue の受け入れ基準に含める

---

## ADR-007: `expiresAt` は View に載せず、`Session.ttlMs` からの再導出を spec に明記する

→ `spec/adr/055-session-expiry-derivation.md` に昇格

### Status

Proposed

### Context

`.thread/1/progress.md:70` は「`SignInView` / `VerifyEmailView` への `expiresAt` 追加検討」を保留していた。調査の結果、**spec も実装も `expiresAt` を持っておらず、乖離は存在しない**。presentation が `apps/web/app/presentation/session.ts:94-101` の `sessionCookieExpiry(now)` で `Session.ttlMs` から再導出しており、その理由は実装コメントにしか残っていない。

### Decision

`expiresAt` は追加しない。判断の根拠を `spec/usecases/identity.md` の該当手順（`signInWithPassword` 手順 8 / `verifyEmail` 手順 7 が既に「有効期間は `Session.ttlMs`」と書いている箇所）に 1 文足して決着させる。

`spec/presentation/index.md` は Cookie の寿命について「`Session.expiresAt` に一致させる」「有効期間そのもの（30 日の絶対期限）は Identity 側の決定であり本文書では決めない」と定めている。値の正典がドメイン（`Session.ttlMs`）にある以上、それを DTO で二重に運ぶと、両者がずれたときにどちらが正かが決められなくなる。

### Consequences

- 良い点: 保留項目が「追加しない」で閉じ、再導出の根拠が spec に残る
- トレードオフ: セッション行の実 `expiresAt` が `now + ttlMs` からずれる実装（サーバー側で丸める等）を将来入れる場合、Cookie 期限が実失効とずれる。ずれを許さないなら View に載せる判断へ戻す必要がある
- 記録先は usecases 側だけでは足りない。`spec/presentation/index.md` の Cookie 属性表が寿命を「`Session.expiresAt` に一致させる」と書いているため、**そちらの理由欄にも再導出の 1 句を足す**（そうしないと「一致させる対象が DTO に無い」という疑問が presentation 側で解けない）

---

## ADR-008: 本 Issue の設計判断のうち長寿命・横断的な 8 件を `spec/adr/` の 6 本へ昇格する

### Status

Proposed

### Context

`.thread/14/adr.md` は Issue 単位の作業ログで、`plan-review/` とともに計画凍結時に消える。一方 `spec/index.md` は「`spec/` は現在有効な要件と設計の正典」、`spec/adr/index.md` は「現在有効な非自明な設計判断の索引」と定義しており、直近コミット `16b51fc`「docs: 設計判断を spec/adr へ昇格しレビュー記録を片付ける」がリポジトリの慣行を示している。

plan.md 自身が「`.thread/1/` は計画凍結時に消える」ことを前提に `apps/web/app/start.ts` の dangling 参照（`AC-15`）を潰しているのに、本 Issue の判断根拠だけを消える作業ログに置いたままにするのは自己矛盾になる。

採番規則も確認した。`spec/adr/` は 3 桁の連番だが、**番号は永久割り当て**である。廃止した 5 件（015 / 016 / 018 / 019 / 020）はコミット `bea92db` で削除され、番号は空いたまま**再利用されていない**（`spec/adr/index.md` の「廃止した判断は残さず、変更履歴は Git で管理する」がこの運用）。したがって空き番号を埋める採番はしない。

### Decision

記録基準（寿命テスト / 波及テスト）を全件に当て、**両方 Yes のものだけを昇格**する。**最終形は判断 8 件 / ファイル 6 本**（052〜057）で、ADR-011 と ADR-016 は独立番号を取らず 052 の本文に統合するため 2 つの数は一致しない（下記 2 つの追補を織り込んだ姿。計画レビュー R3 coverage:S-005 / arch:S-003）。番号は現在の最大採番 051 の次から連番で確保する。

以下は策定当初（統合前）の姿で、記録として残す — 記録基準を 7 件に当て、両方 Yes の 4 件を **052〜055** へ昇格する形だった。

| 作業ログ | 昇格先 | 寿命 | 波及 |
| --- | --- | --- | --- |
| ADR-002（inventory の粒度と ADP ID の不採番） | `052-adapter-inventory-granularity.md` | 次の spec-sync で必ず再燃する | 台帳 5 ファイルの生成規則 |
| ADR-004（rollback の 2 層判定） | `053-account-deletion-rollback-completion.md` | workspace スライスの実装者が再検討する | ポート契約・適合スイート・ユースケース |
| ADR-005（provider account 一意性の担保元） | `054-provider-account-uniqueness-owner.md` | D1 実装者の責務配分を変える | 2 ポートの契約と JSDoc |
| ADR-007（`expiresAt` を View に載せない） | `055-session-expiry-derivation.md` | DTO を足す判断は再燃しやすい | domain 定数・DTO・転送境界 |

**統合作業（2026-08-15）による追補**: Issue #2 由来の台帳を統合した結果、昇格するものが 1 件増えて **5 件（052〜056）**になった。

| 作業ログ | 昇格先 | 寿命 | 波及 |
| --- | --- | --- | --- |
| ADR-014（性能上の約束は契約から外し実行基盤の予算へ） | `056-performance-budget-placement.md` | テストケースを書くたびに再燃する | `spec/testcases/` 全域・`spec/platform/index.md`・D1 実装 |

**計画レビュー R2（arch:S-001）による追補**: **ADR-010** を昇格対象に加え、**6 件（052〜057）**にする。

| 作業ログ | 昇格先 | 寿命 | 波及 |
| --- | --- | --- | --- |
| ADR-010（`spec/manual-tests/` の追随ルールと追随範囲の決め方） | `057-manual-test-followthrough.md` | 次に scenario を触るすべての作業で再燃する | `spec/scenario/` → `spec/manual-tests/` の追随、カバレッジ 2 表の軸 |

指摘のとおり、ADR-010 を作業ログに残す判断は **ADR-002（`spec/inventory/` の追随ルール）を昇格させたことと非対称**だった。ADR-010 の決定は「本 Issue でどの TC を足すか」ではなく「**下流成果物の追随の要否を表の軸で決める**」という規則であり、寿命テストも波及テストも ADR-002 と同型に通る。ADR-010 自身の Consequences が「下流成果物の追随ルール（inventory / manual-tests）が同じ形になる」と書いているのに片方だけ消える媒体へ置くのは、ADR-008 が指摘した自己矛盾そのものである。`spec/manual-tests/` の追随規則はどの spec ファイルにも明文化されていない。

あわせて **ADR-011**（新規ポートメソッドの採番）と **ADR-016**（新設テストケースの TC 採番）は独立した ADR にせず、`052-adapter-inventory-granularity.md` の本文に 1 段落ずつとして書く（どちらも ADR-002 の適用範囲の限定であり、別番号にすると 2〜3 つの ADR を突き合わせないと採番規約が読めなくなる）。**ADR-012 / ADR-013 / ADR-015** は本 Issue 限りのスコープ判断なので昇格しない。

昇格しないもの。

- **ADR-001**（倒す向きを項目ごとに決める）— 規則そのものは `spec/adr/046` が既に定めている。本 Issue の適用記録にすぎない
- **ADR-003**（`docs/*` の書き直し）/ **ADR-006**（スコープ外 3 件の切り出し）/ **ADR-008**（本エントリ）/ **ADR-009** — 本 Issue 限りの進め方・スコープ判断であり、寿命テストを通らない

昇格した ADR は `spec/adr/index.md` の一覧と前提依存マップに載せ、対応する spec 本文からリンクする。**リンク元は 6 本ぶんの全数を数えること**（計画レビュー R3 coverage:S-005 / arch:S-003。この一覧はステップ 20 の実行者が作業チェックリストとして読む場所なので、追補前の 5 ファイルのままだと 056 / 057 のリンクを落とす）。

| ADR | リンク元 | 対応 AC / ステップ |
| --- | --- | --- |
| 052 | `spec/inventory/adapter.md` | AC-29 / ステップ 10 |
| 053 | `spec/domains/index.md` / `spec/usecases/identity.md` | AC-29 / ステップ 3, 4 |
| 054 | `spec/domains/identity.md` | AC-29 / ステップ 2 |
| 055 | `spec/usecases/identity.md` / `spec/presentation/index.md` | AC-29 / ステップ 4, 7 |
| 056 | `spec/usecases/storage.md`（`batchSize` 段落）/ `spec/testcases/storage/deleteFilesByOwner.md` / `spec/platform/index.md`（`### Scope DO`） | AC-61 / ステップ 24-3, 28, 29 |
| 057 | `spec/manual-tests/account.md`（TC-42） | AC-29 / AC-69 / ステップ 18 |

### 検討した代替案

- **`.thread/14/adr.md` に置いたまま実装フェーズの片付けで判断する**: 本 Issue はドキュメントの正確性そのものが成果物なので、判断根拠が消える媒体に残っている状態を成果に含めないほうが一貫する
- **7 件すべて昇格する**: `spec/adr/index.md` は「現在有効な非自明な設計判断の索引」であり、進め方の判断を混ぜると索引の意味が薄まる

### Consequences

- 良い点: 本 Issue の判断が計画凍結後も参照可能になり、次の spec-sync が同じ論点を再審議しなくて済む
- トレードオフ: `spec/adr/` が 6 件増える。並行する Issue #2 由来の統合作業も ADR を昇格しうるため、**ファイル作成の直前に最大採番を再確認する**運用が必要になる（番号は自分で採るしかないため、確認を省くと重複がサイレントに残る）
- **採番の再確認は、番号入りリンクを本文へ書くどのステップよりも前に置く**（計画レビュー R2 arch:P-007）。ステップ 2 / 3 / 4 / 7 / 10 / 18 / 24 / 28 / 29 は `[ADR 053](../adr/053-….md)` の形で具体的な番号を本文に焼き込むので、番号のずれが後から判明しても本文リンクを訂正する指示がどのステップにも無い。実行順の表でフェーズ F（ステップ 20）を A より前に固定し、あわせてステップ 17 に `grep -rn "adr/05[2-7]-" spec/` の参照先実在検査を置く

---

## ADR-009: P-40 の「サインイン済み」状態は本 Issue で閉じ、L-02 は実装 Issue へ切り出す

### Status

Proposed

### Context

`spec/pages/index.md` は「サインイン済みで訪れたときの見え方」を 2 か所で要求している。

- **L-02（公開レイアウト）**: 「サインイン済みで訪れた場合はアプリへ戻る導線を表示」「`**状態**: 通常 / サインイン済み`」
- **P-40（トップ）**: 「`**状態**: 通常 / サインイン済み（アプリへの導線を表示）`」

計画時点では L-02 だけを SYNC-24 として扱い、P-40 は台帳に無かった（計画レビュー R1 の arch:P-009）。実物を確認すると 2 つは性質が違う。

- P-40 は**同じファイルの URL 表**が `| /` | トップ（未サインイン）/ ノート一覧へのリダイレクト（サインイン済み） |` と書いており、状態行と**矛盾している**。実装（`apps/web/app/routes/index.tsx` の `beforeLoad`）はサインイン済みを `/notes` へ redirect し、URL 表と一致する
- L-02 は矛盾していない。`/terms` `/privacy` は `LegalPage` 経由で `PublicShell` を使い、redirect を持たないので分岐は到達する。実装が `signedIn` prop ごと落とした（削除理由「到達しない分岐」は `/` にしか当てはまらない）

### Decision

- **P-40 は本 Issue で閉じる**（SYNC-26）。spec 内部の自己矛盾を、実装と一致する側（URL 表）へそろえる。SYNC-01（scenario 内の自己矛盾）や SYNC-12（DTO 表と手順の矛盾）と同じ類型で、実装変更を伴わない。コストは spec 1 行 ＋ inventory 2 行
- **L-02 は据え置き、実装 Issue へ**（SYNC-24 / ADR-006）。spec が明示要件を持ち実装が落とした側なので、spec 行を消すと要件を静かに失う

### Consequences

- 良い点: 「実装が正」を機械適用して P-40 の矛盾を放置する事故も、L-02 の要件を消す事故も避けられる。ステップ 12 の「L-02 に対応する行は台帳に存在しないから触らない」という整理が、`PAGE-p40-001` / `PAGE-p40-004` は存在するという事実と矛盾しなくなる
- トレードオフ: 同じ「サインイン済み」という語の扱いが画面ごとに分かれる。両者の違い（redirect の有無）を P-40 の状態行に明記して読み手が迷わないようにする

---

## ADR-010: `spec/manual-tests/` は scenario の下流成果物として追随させ、追随の範囲を表の軸で決める

→ `spec/adr/057-manual-test-followthrough.md` に昇格

### Status

Proposed

### Context

ステップ 5 で `spec/scenario/account.md` の AC-02 異常系に 2 行（別ブラウザーでの確認 / 一時障害）を足す。計画時点では「TC-01 / TC-02 は同一ブラウザーでの操作なので現状のまま正しい」とだけ書いていたが、これは**既存手順が矛盾しないこと**の確認であって、**新規行に手順が無いこと**の判断ではなかった（計画レビュー R1 の arch:P-006）。

`spec/manual-tests/account.md` の構造を確認した。末尾の `## カバレッジ` は 2 つの表を持つ。

- `### ユースケースエラーケース対応表` — 軸は **usecase のエラーケース**（`spec/usecases/*.md` のエラーケース表と 1 対 1）。手動で再現できないものは `対象外` と理由を書く既存様式がある
- `### 観点チェックリスト` — 軸は**テスト観点**（入力バリデーション / 境界値 / 認証・権限 / …）

つまり scenario の異常系行と TC は 1 対 1 ではない。

### Decision

`spec/inventory/` と同じく `spec/manual-tests/` も本文（scenario）の下流成果物として追随させる。ただし**追随の要否は表の軸で決める**。

1. **別ブラウザーでの確認**（`verifyEmail` は成功するが、セッションを発行しない経路）→ **TC を 1 本足す**（TC-42、末尾に追加して既存番号を動かさない）。`spec/adr/029` が受容した縮退そのものであり、手作業で再現しやすいのに現状どの TC もカバーしていない。`### 観点チェックリスト` の「操作の中断・逸脱」に登録する
2. **一時障害**（転送・基盤の障害）→ **TC は足さない**。`| getUsageSnapshot | 取得の失敗 | 対象外 | インフラ障害 |` と同じ扱いで、`### ユースケースエラーケース対応表` に `対象外` の行として理由を 1 行残す
3. `### ユースケースエラーケース対応表` に「別ブラウザーでの確認」の行は**足さない**。この表の軸は usecase のエラーケースであり、成功経路は載らない

### Consequences

- 良い点: 「決めないまま進めない」が守られ、次のレビューで同じ論点が再燃しない。下流成果物の追随ルール（inventory / manual-tests）が同じ形になる
- トレードオフ: `spec/manual-tests/account.md` が本 Issue のスコープに入る（計画時点では「改訂しない」としていた）。ただし触るのは TC-42 の追加とカバレッジ表の 2 行に限る

---

## ADR-011: 新規ポートメソッドには inventory の ID を通常どおり採番し、各ドメイン群の末尾に追加する

→ `spec/adr/052-adapter-inventory-granularity.md` の決定 2 として昇格（独立番号は取らない）

### Status

Proposed

### Context

ADR-002 は「新しい ADP ID は採番しない」と決めた。しかし Issue #2 由来の台帳（`research-2.md` の A 群）には**実在する新規ポートメソッドが 7 つ**ある。

- `AuthTokenRepository.findPendingByUserAndPurpose`（SYNC-201）
- `SignInOAuthClient.deriveCodeChallenge`（SYNC-202）
- `ObjectStorage.publicUrl`（SYNC-203)
- `IdentityUniqueDirectory.beginRelease`（SYNC-205）
- `ScopeCleanupAdmissionStore.describePersonalCleanup`（SYNC-206）
- `AccountDeletionManifestStore.describe`（SYNC-208）
- `LocalNoteProjectionWriter.redactAuthor` / `PublicNoteProjectionWriter.redactAuthor`（SYNC-210。2 メソッド）

実物で確認した事実。

- `spec/inventory/{domain,adapter}.md` は**1 行 = 1 ポートメソッド**（`DOM-usage-006` のようにエンティティは 1 行で全振る舞いを畳むが、ポートはメソッドごとに 1 行）。この規約に従えば新規メソッドには行が要る
- ADR-002 の Context が挙げた 3 つの制約は**すべて「1 メソッドに複数の適合ケースが相乗りしている」問題**についてのもので、新規メソッドを扱っていない。加えて ADR-002 の「検討した代替案」自身が「Issue #2 の spec-sync が `describe` / `describePersonalCleanup` の**採番漏れ** 2 件を埋める予定」と書いており、**新規メソッドが採番される前提で書かれている**
- 各群の現在の最大採番: `DOM-common-040` / `DOM-identity-059` / `DOM-note-070` / `DOM-storage-037`、`ADP-common-039` / `ADP-identity-038` / `ADP-note-054` / `ADP-storage-023`、`UC-identity-021`
- 台帳の行はポート定義の出現順に並んでいるが、**ID は行位置ではなく行そのものの識別子**として `spec/` の他ファイル・`.thread/` の計画・レビュー記録から参照されている

### Decision

ADR-002 の適用範囲を「**適合ケース**（本文修正を伴わない、既存メソッドへの主張追加）」に限定し、**新規ポートメソッドには通常どおり ID を採番する**。両者は別の問題であり、矛盾しない。

1. 採番は**各ドメイン群の末尾に追加**する。出現順に挿入して以降を繰り下げない（既存 ID の参照が全部動くため）。並び順と ID 順が一致しなくなるが、台帳の軸は ID であって行位置ではない
2. 新規行は `| ID | 要素 | 定義場所 | 実装されるべき振る舞いの要点 |` の 4 列既存様式で、`要素` は `` `Port.method` `` 形式、`定義場所` は既存行と同じアンカー
3. 本 Issue で採番するのは次の 19 行（`spec/inventory/` の 3 ファイル）
   - `spec/inventory/domain.md`: `DOM-common-041`（`describePersonalCleanup`）/ `DOM-common-042`（`describe`）/ `DOM-identity-060`（`findPendingByUserAndPurpose`）/ `DOM-identity-061`（`deriveCodeChallenge`）/ `DOM-identity-062`（`beginRelease`）/ `DOM-note-071`・`DOM-note-072`（`redactAuthor` × 2）/ `DOM-storage-038`（`publicUrl`）
   - `spec/inventory/adapter.md`: 上記 8 メソッドに対応する `ADP-common-040` / `ADP-common-041` / `ADP-identity-039` / `ADP-identity-040` / `ADP-identity-041` / `ADP-note-055` / `ADP-note-056` / `ADP-storage-024`
   - `spec/inventory/usecase.md`: `UC-identity-022`（`getProfile`）/ `UC-identity-023`（`checkHandleAvailability`）/ `UC-identity-024`（`completeOAuthCallback`）
4. `StorageQuota.replaceTotals`（SYNC-204）と `UploadValidationPolicy.ensureAcceptable`（SYNC-240）は**採番しない**。前者は `DOM-usage-006`（`StorageQuota` エンティティ）、後者は `DOM-storage-012`（ドメインサービス）という**既存の 1 行が全振る舞いを畳んでいる**単位なので、要点欄の追随だけで足りる
5. `spec/adr/052`（ADR-002 の昇格先。ステップ 20）の本文に、この切り分けを 1 段落として書く。書かなければ次の spec-sync が同じ論点を再審議する

### 検討した代替案

- **ポート定義の出現順に挿入して以降を繰り下げる**: 台帳が読みやすくなるが、既存 ID の参照（`spec/` 本文・`.thread/1` `.thread/2` の記録・レビュー指摘）がすべて別の要素を指すようになる。ID の意味が「安定した識別子」から「行番号」に落ちる
- **新規メソッドも採番せず、既存行の要点欄に相乗りさせる**: `describe` を `begin` の行に書く形になり、「1 行 = 1 ポートメソッド」の不変が壊れる。ADR-002 が守ろうとしたものそのものを壊すので本末転倒

### Consequences

- 良い点: ADR-002 の不変（ケース行を作らない）と inventory の生成規則（1 行 = 1 メソッド）が両立する。Issue #11 の D1 実装者が「実装すべきメソッドの全数」を台帳から数えられる
- トレードオフ: 台帳の行順と ID 順が一致しない箇所が生まれる。`spec/adr/052` に「ID は行位置ではない」と明記して補う

---

## ADR-012: SYNC-207 の適合ケース 1 本は本 Issue に含める

### Status

Proposed

### Context

`assertOwner` は `completed` になった barrier も `ConflictError("CLEANUP_OPERATION_MISMATCH")` で弾く（`adapters/memory/repositories/scopeCleanupAdmissionStore.ts:47-57` の `requireOwner` が `row.status !== "running"` を含む）。一方、

- ポート JSDoc（`application/ports/scopeCleanupAdmissionStore.ts:36-38`）は「a different id, a missing receipt, or an uncommitted one is rejected」とだけ書き、**completed に触れていない**
- 適合スイート `ADP-common-008`（`adapters/conformance/scopeCleanupAdmissionStore.ts:68-73`）は「別 ID」「receipt 不在」の 2 ケースだけで completed を固定していない
- 周囲の契約は逆向きに見える（`markCompleted` / `acknowledgePersonalComponent` は完了済みを冪等に受ける — `spec/adr/039`）

つまり **completed を通す実装を書いてもスイートが緑になる**。`spec/adr/026` の決定 1（JSDoc だけを読んで実装したものがスイートを通る）が成立していない。

スイートの実物を読んだ。同ファイルの `ADP-common-009/010` のケースが既に「begin → 全宣言 component ack → `markCompleted`」まで進めており、completed な barrier を作る手順はスイート内に確立している。`ADP-common-008` のケースへ足すのは **`markCompleted` までの 3 行 ＋ `await expectConflict(store.assertOwner("op-1"))` の 1 行**で、既存ヘルパー（`expectConflict` / `DECLARED_COMPONENTS`）だけで書ける。memory アダプターは既にこの振る舞いを持つので**実装変更を誘発しない**（緑のまま）。

### Decision

**本 Issue に含める。** 3 点をセットで直す。

1. `spec/domains/index.md` の `assertOwner` 記述と `:124` の説明段落に「completed した barrier の所有権主張も拒否する（cleanup レーンは完了後に ack を続けられない）」を足す
2. ポート JSDoc の該当文に `completed` を加える（`a different id, a missing receipt, an uncommitted one, or one already completed`）
3. `ADP-common-008` のケースに completed の 1 主張を足す

これでコード差分がステップ 8 の 5 ファイルから **7 ファイル**（＋ポート JSDoc、＋適合スイート）へ増えるので、plan.md のリスク節・テスト方針とステップ 17-3 の確認内容を更新する。

### 検討した代替案

- **spec と JSDoc だけ直してスイートは別 Issue**: 契約の実行形（`spec/adr/026`）が 1 リリース分ずれたまま残る。D1 実装者が JSDoc を読んで completed を弾く実装を書いても、スイートはそれを保証しないので「弾かない実装」も同時に通る。乖離を先送りしない（`spec/adr/046`）に反する
- **実装のほうを緩めて completed を通す**: 正本の向きが逆。完了後の ack を通すと `pruneCompleted` が回収した後の遅延配送が barrier を running に戻しうる（スイートの `ADP-common-009/010` が「late ack must not walk the receipt back to running」を既に固定している）

### Consequences

- 良い点: 契約 3 者（spec / JSDoc / スイート）が同じことを言う状態に戻る
- トレードオフ: 本 Issue が「ドキュメントだけを触る」性質を厳密には満たさなくなる。**テストの追加 1 本に限る**ことを plan.md に明記し、差分検査（ステップ 17-3）で担保する

---

## ADR-013: SYNC-221 は spec の内部矛盾だけを解消し、実装は別 Issue へ送る

### Status

Proposed

### Context

`spec/scenario/account.md:127`（AC-06）は「パスワードを追加する際は、現在のセッションの再認証（Google 再認可）を求める」と要求し、`spec/pages/index.md:441`（P-22 の状態）は「再認証要求」を状態に持ち、`spec/manual-tests/account.md:118` も「Google の再認可が求められる」と書いている。一方 `spec/usecases/identity.md#addPasswordIdentity` の処理フローは `listByUserId` → `PlainPassword.create` + hash → `Identity.createPassword` の 3 手順で、**再認可がどこにも無い**。実装（`application/identity/addPasswordIdentity.ts:37-70`）は usecase 側の spec に従っており、再認可を行わない。

正本は設計側（AC-06）。`spec/adr/046` の「正本が設計側にある場合は逃げ道を削って必須契約として書き直す」に当たる。

### Decision

**spec の内部矛盾の解消だけを本 Issue に含め、実装修正は別 Issue（Phase 5 で起票）へ送る。**

1. `spec/usecases/identity.md#addPasswordIdentity` の処理フローに再認証の手順を書き足し、エラーケース表に再認証未了の行を足す。あわせて実装が正の側である `NotFoundError("USER_NOT_FOUND")` / `ValidationError("ACCOUNT_UNAVAILABLE")` の 2 行も同じ表に足す（SYNC-221 付随）
2. plan.md のスコープ節に「**spec の内部矛盾解消のみ。実装は別 Issue**」と明記する
3. Phase 5 で起票する Issue の骨子を plan.md に 1 行残す

**実装の縮退を spec へ書き写さない**（`spec/adr/046`）。逆に、usecase 側だけを AC-06 と食い違ったまま残すと、次に `addPasswordIdentity` を触る実装者が usecase だけを読んで同じ穴を空ける。

### 検討した代替案

- **usecase の手順も触らず実装 Issue に一任する**: 矛盾が 4 ファイル（scenario / pages / manual-tests / usecases）に残り続け、どれが正かを読み手が決められない
- **本 Issue で実装も直す**: 再認証は OAuth 往復（`startOAuthFlow` の `intent` 追加相当）とセッション再認証状態の保持を要し、`spec/adr/034` / `035` の束縛設計に触れる。ドキュメント同期の Issue が扱う変更量ではない

### Consequences

- 良い点: spec の 4 ファイルが同じことを言う状態になり、実装が「spec に追いついていない」だけの状態として正しく残る
- トレードオフ: HEAD では spec が要求する再認証を実装が満たさない状態が続く。Phase 5 の Issue 番号を本 Issue の完了コメントに残して追跡可能にする

---

## ADR-014: バックエンド依存の性能上の約束は契約から外し、実行基盤の予算文書に置く

→ `spec/adr/056-performance-budget-placement.md` に昇格

### Status

Proposed

### Context

`spec/testcases/storage/deleteFilesByOwner.md:11`（TC-storage-043）は「列挙 1 文 + 多行 DELETE 1 文 + 多行 outbox INSERT 1 文で、件数によらず 3 文」を期待結果に持つ。memory アダプターは OCC トークンを `findById` から得る実装制約（`.thread/2/adr.md` の記録。`spec/adr/` に対応 ADR は無い — `spec/adr/022` は「コマンドパレットの遷移」で、`research-2.md` の引用は誤り）の帰結として 1 件ずつ読むため、この数は満たせない。実テストは「列挙は 1 回だけ / 削除できたファイル 1 件につき `storage.fileDeleted` が 1 件 / どちらも件数に依存しない」に置き換えて緑になっている。

移送先とされた `spec/platform/index.md#クエリ予算` の実物を確認した。

- **`クエリ予算` という見出しは存在しない**。`spec/usecases/storage.md:492` が「正典は [platform/index.md](../platform/index.md) の「クエリ予算」」と書いているが、**このアンカーは既にリンク切れ**である
- 実在するのは `## 実行予算と分割単位` → `### Global D1`（1 invocation あたり D1 query 500 の設計上限）と `### Scope DO`
- `### Scope DO` は「**scope-local SQL に D1 の query count は掛からない**」と明言し、予算を `| 経路 | 1 回の上限 | 根拠 |` の 3 列表で**行数**（owner / workspace cleanup は 100 rows）として持つ。文数の列は無い
- `deleteFilesByOwner` は scope DO 側の経路なので、既存表の行として「3 文」を書くことは書式上できない

### Decision

**「観測可能な性質」と「バックエンド依存の実現手段」を置き場所で分ける。**

1. **契約側**（`spec/testcases/storage/deleteFilesByOwner.md` の TC-storage-043、および `spec/inventory/test.md` の対応行）— 全バックエンド共通の必須契約として、**文の数を書かない**。「列挙は 1 回、`storage.fileDeleted` は削除できたファイル 1 件につき 1 件、いずれも `batchSize` 件数に比例した追加の往復を要求しない」という**観測可能な性質**へ書き換える
2. **予算側**（`spec/platform/index.md` の `### Scope DO`）— 既存の 3 列表には足さず、**表の直後に段落 1 つ**を足す。「scope-local の一括削除は 1 turn の SQL 文数がバッチ件数に比例しない形（SQL バックエンドなら列挙 1 + 多行 DELETE 1 + 多行 outbox INSERT 1 の 3 文）で実装する。1 行ずつ OCC トークンを読むバックエンド（memory）ではこの数に届かないため、これは上限ではなく**実装が満たすべき設計目標**であり、契約は 1. の観測可能な性質のほうに置く」
3. **参照の修復** — `spec/usecases/storage.md#deleteFilesByOwner` の `batchSize` 説明段落から「3 文」の内訳を落とし、リンク切れのアンカーを実在する `### Scope DO` へ直す
4. この規則（性能上の約束はテストケース表に置かない）を `spec/adr/056` として昇格する。テストケースを書くたびに再燃する種類の判断であり、D1 実装（Issue #11）が最初にぶつかる

### 検討した代替案

- **`### Scope DO` の表に「3 文」の行を足す**: 表の軸は「1 回の上限（行数）」で、根拠列も CPU / fan-out 量。文数は軸が違うので、表の意味が二重になる
- **`## クエリ予算` という節を新設する**: `### Global D1` が既にクエリ予算そのものであり、二重正本になる（Issue #16「保守スイープの表順が二重正本になっている」と同型の事故）
- **テストケース表に「3 文（D1 の場合）」と条件付きで残す**: `spec/testcases/` はバックエンド非依存の契約で、条件付きの契約はどのバックエンドが免除されるかを台帳から読めなくする

### Consequences

- 良い点: 契約が全バックエンドで満たせる形になり、性能目標は再検証すべき場所（実行基盤）に残る。リンク切れのアンカーも同時に閉じる
- トレードオフ: D1 実装のスライスが「3 文」を再検証する責務を負う。Phase 5 のフォローアップとして Issue #11 にコメントで引き継ぐ

---

## ADR-015: `DistributedOperationStore` の interface は本 Issue で新設せず、状態語彙の書き分けだけを直す

### Status

Proposed

### Context

`spec/domains/index.md` は `ScopeCleanupAdmissionStore` / `AccountDeletionManifestStore` / `GlobalMaintenanceRunStore` の 3 つを interface として書いているのに、`DistributedOperationStore` だけは `:121` の 1 行の言及しか持たない。実装は 4 つとも `application/ports/` にある。

実物を読んで分かった非対称の内訳。

- `spec/database/index.md:130-148` の `distributed_operations` 表は `attempts` / `next_attempt_at` / `expires_at` の 3 列と「`next_attempt_at` の partial index を recovery Cron が使う」を持つ。実装の `DistributedOperation`（`application/ports/distributedOperationStore.ts:15-25`）はこの 3 列を持たない。これは**設計判断ではなく縮退**（recovery Cron 未実装。SYNC-231 でスコープ外と判定済み）
- 一方 `state` は本当に食い違っている。実装は `"running" | "completed" | "rejected"` の 3 値で、細かい phase は manifest header 側（`spec/database/index.md:154` が `buildingMemberships` / `preparing` / … と定義）が持つ。しかし `spec/usecases/identity.md:663,675` は `distributed_operations` の state として `preparing` / `committing` を使っており、**同じ語が 2 つの表の state として二重に読める**
- `spec/database/index.md` 自身の一意索引は `state NOT IN ('completed','rejected')` で running を表現しており、**3 値の意味論と整合している**

### Decision

**interface は新設しない。** 代わりに、裏づけの取れる 1 点だけを直す。

1. `spec/usecases/identity.md:663` の `state: "preparing"` と `:675` の「operation を `committing` へ進め」を、**`distributed_operations.state` は `running` / `completed` / `rejected` の 3 値であり、`preparing` / `committing` は account deletion manifest header の state である**と読める形へ書き分ける
2. `spec/database/index.md` の `distributed_operations.state` 欄に 3 値の CHECK を書く。**`attempts` / `next_attempt_at` / `expires_at` の 3 列は落とさない**（SYNC-231 のスコープ外判定のまま）
3. `spec/domains/index.md:121` の言及は 1 行のまま残し、interface 化は recovery Cron スライスのフォローアップ Issue（Phase 5）に含める

interface を書くには `attempts` / `next_attempt_at` を読み書きするメソッドの形（`claimDue` か `recordAttempt` か、リースを持つか）を**新たに設計する**ことになる。`spec/adr/046` はこれを「約束を足すこと自体が新しい設計判断になる」ケースとして名指しており、ドキュメント同期で決める範囲を出る。現行実装のとおりに書けば縮退を spec に固定化することになり（`spec/adr/046` が禁じる向き）、実装より広く書けば設計判断になる — どちらの向きも本 Issue では取れない。

### 検討した代替案

- **`spec/database/index.md` の表に合わせた interface を新設する**: 「実装より広い契約」自体は `spec/adr/046` が許す形（「正本が設計側にある場合は必須契約として書き直す」）だが、この場合の正本は**列の存在**であってメソッドの形ではない。メソッドの形は誰も決めていないので、正本の無いものを書くことになる
- **現行実装のとおりに 3 メソッドの interface を書く**: `attempts` / `next_attempt_at` を持たない契約が spec の正典に入り、recovery Cron スライスが「spec が要らないと言っている」と読む余地を作る。縮退の固定化

### 追補（計画レビュー R2 arch:P-008）— `AppliedOperationStore` の扱い

ステップ 26-2 は `spec/database/index.md` の `applied_operations` の説明に「実装では 2 ポートに分かれている（`ScopeCleanupAdmissionStore` / `AppliedOperationStore`）」と書く。実測すると **`AppliedOperationStore` は `spec/` 全域に 0 件**で、`spec/inventory/{domain,adapter}.md` にも行が無い。このまま進めると **DB 設計文書だけが、どこにも定義の無いポート名を参照する**状態になる。

ただし実物を当たると、これは `AppliedOperationStore` 固有の穴ではなく**系統的な穴**だった。実装に存在し `spec/inventory/` に 1 行も無いポートは 5 つある。

| ポート | `spec/` の言及 | inventory 行 | 適合スイートの ADP ID |
| --- | --- | --- | --- |
| `DistributedOperationStore` | `spec/domains/index.md:121` の 1 行のみ | 0 | 無し |
| `AppliedOperationStore` | 0 件 | 0 | 無し |
| `IdentityRemovalReceiptStore` | 0 件 | 0 | 無し |
| `OutboxRepository` | 0 件 | 0 | 無し |
| `ScopeTaskScheduler` | 0 件 | 0 | 無し |

`adapters/conformance/` の他 20 本はすべて `describe` / `it` 名に ADP ID を含む（`spec/adr/026` の命名規約）。ADP ID を持たないのはこの 5 本だけで、inventory 行の欠落と 1 対 1 に対応している。

### 追補の決定

**`AppliedOperationStore` にも interface と inventory 行を新設しない。** 代わりに `spec/domains/index.md` の `ScopeKey と永続化境界` 節の箇条書きに、`DistributedOperationStore` と**同じ粒度の 1 行言及**を足す（名前・置き場所・`ScopeCleanupAdmissionStore` との鍵の違い＝ `spec/adr/045`）。ステップ 26-2 はその言及と同じ名前を使う。

- **`### 新設する横断的ポート` に `IdempotencyStore` と同じ形で interface を書く案は採らない。** 実装 JSDoc が正本なので転記自体は可能だが、inventory 行を採ると `spec/adr/026` の命名規約により適合スイートの `describe` / `it` 名へ ADP ID を付ける差分が要る。本 Issue は AC-63 でコード差分を 9 ファイルに限っており、5 本のうち 1 本だけを直すと**残り 4 本との新しい非対称**を作る（ADR-015 が避けようとしたのと同じ事故）
- **名前を出さずに機能だけ書く案も採らない。** `spec/adr/045`（鍵の意味でポートを分ける）が本 Issue の根拠 ADR なので、分かれている 2 つの名前が読めないと ADR を当てた意味が消える

5 ポートの interface 化・inventory 行の採番・適合スイートへの ADP ID 付与は、Phase 5 の recovery Cron Issue（plan.md の一覧 6.）へまとめて送る。`DistributedOperationStore` が 5 つのうちの 1 つである以上、この Issue が自然な受け皿になる。

### Consequences

- 良い点: 実際に食い違っている state 語彙が閉じ、`preparing` / `committing` がどちらの表の語かが読める。縮退の固定化も、根拠の無い設計も避けられる。DB 文書だけが宙に浮いた名前を指す状態も作らない
- トレードオフ: `spec/domains/index.md` のポートの記述粒度が揃わないまま残る（interface を持たないポートが 1 → 2 に増える）。ADR-011 の Consequences「D1 実装者が実装すべきメソッドの全数を台帳から数えられる」は、この 5 ポートについては本 Issue 完了後も成立しない。Phase 5 の recovery Cron Issue に 5 ポート分をまとめて含めて追跡する

---

## ADR-016: 新設ユースケースにはテストケースファイルを足し、TC ID は群の末尾に採番する

→ `spec/adr/052-adapter-inventory-granularity.md` の決定 3 として昇格（独立番号は取らない）

### Status

Proposed（計画レビュー R2 の arch:P-001 を受けて追加）

### Context

ステップ 4-7 は `spec/usecases/identity.md` に `getProfile` / `checkHandleAvailability` / `completeOAuthCallback` の 3 節を新設し、ステップ 31 は `UC-identity-022`〜`024` を採番する。計画は `spec/testcases/identity/` に触れていなかった。

実物で 2 つのことを確かめた。

**1. 「1 ユースケース = 1 テストケースファイル = 1 UC 行」は全 9 ドメインで厳密に成立している。**

| ドメイン | testcase ファイル | UC 行 |
| --- | --- | --- |
| conversion | 4 | 4 |
| identity | 21 | 21 |
| integration | 15 | 15 |
| job | 12 | 12 |
| note | 36 | 36 |
| storage | 13 | 13 |
| tag | 14 | 14 |
| usage | 7 | 7 |
| workspace | 21 | 21 |

identity は `spec/usecases/identity.md` の h2 が 22 個（`## 共通の約束` を除くと 21）で、testcase ファイル 21・UC 行 21 と一致する。3 節を足して UC 行だけ 24 にすると **identity だけが 24 / 21 / 24** になり、本 Issue が潰そうとしている類型（生成物が本文に追随していない）を自分で作る。

**2. TC ID はテストケースファイル名のアルファベット順に振られている。**

`spec/inventory/test.md` の identity 群の先頭 ID を実測すると `addPasswordIdentity`=001 → `authenticateSession`=008 → `changePassword`=017 → `completeOAuthSignIn`=024 → `deleteAccount`=039 → `getPublicProfile`=112 → … と、ファイル名の辞書順にブロックが並ぶ。`spec/testcases/*/*.md` の表自体には TC ID が 1 つも書かれていないので、**TC ID は inventory の行位置だけで決まる**。

したがって `checkHandleAvailability.md`（`changePassword` と `completeOAuthSignIn` のあいだ）/ `completeOAuthCallback.md`（`completeOAuthSignIn` の前）/ `getProfile.md`（`getPublicProfile` の前）を辞書順に挿入すると、**`TC-identity-024` 以降のほぼ全部（280 行超）が繰り下がる**。これは AC-55 の「既存 ID の指す要素が 1 つも変わっていない」と正面から衝突する。

### Decision

**3 本のテストケースファイルを新設し、TC ID は identity 群の末尾に採番する。**

1. `spec/testcases/identity/{getProfile,checkHandleAvailability,completeOAuthCallback}.md` を既存様式（`| 前提条件 | 操作 | 期待結果 | 実装ステータス |` の 4 列、4 列目は全行空）で作る。内容はステップ 4-7 で書いた各節のエラーケース表と主要な成功経路に 1 対 1 で対応させる（最小で足りる。網羅は実装スライスの仕事）
2. `spec/inventory/test.md` の TC 行は**辞書順の位置ではなく identity 群の末尾**（現在の最大 `TC-identity-304` の次、`TC-identity-305` から）に足す。ADR-011 が DOM / ADP / UC に定めた「群の末尾に足す・ID は行位置ではなく行の識別子」を **TC にもそのまま適用する**
3. この適用を `spec/adr/052-adapter-inventory-granularity.md` の本文に 1 段落として書く（ADR-011 の段落の直後）。書かなければ「TC は行位置で決まるのだから並べ替えるべきだ」と次の spec-sync が判断しうる
4. `spec/testcases/identity/requestPasswordReset.md` に足す境界 2 行（60 秒。coverage:S-001）も同じ規則で末尾に採番する。既存ブロック（`TC-identity-187`〜`193`）の中に挿入しない

### 検討した代替案

- **テストケースファイルを足さず、線引きを ADR に残してフォローアップ Issue へ送る**（レビューの提案 (b)）: 「`spec/testcases/` は振る舞いを持つユースケースだけを対象にする」という線引きは、`getProfile` / `checkHandleAvailability` が read-only であることを根拠にできそうに見える。しかし実物の `listIdentities.md` / `getPublicProfile.md` / `listPublicProfiles.md` はいずれも read-only で、6〜7 行のケースを持つ。線引きが既存と矛盾するので採れない
- **辞書順に挿入して TC ID を振り直す**: 台帳が読みやすくなるが、`spec/` 本文・`.thread/` の計画とレビュー記録から参照されている 280 行超の ID がすべて別の要素を指すようになる。ADR-011 が DOM / ADP で棄却したのと同じ理由

### Consequences

- 良い点: 「1 ユースケース = 1 テストケースファイル = 1 UC 行」の不変が 9 ドメインすべてで保たれる。TC の採番規則が DOM / ADP / UC と 1 つの規則に統一される
- トレードオフ: `spec/inventory/test.md` の identity 群で行順と ID 順が一致しない箇所が生まれる（`TC-identity-305` 以降に集まる**末尾ブロック**。新設 3 ファイルのケース ＋ `requestPasswordReset` の境界 2 行で、実際の行数はステップ 32-1 が書くケース数しだい）。`spec/adr/052` に「ID は行位置ではない」と**決定 4 まで含めて**書いて補う。本 Issue のステップが 1 つ増える（ステップ 32）

---

## ADR-017: `docs/frontend_implementation_example.md` の「実在しない例」は削除ではなく採用状況の明示で扱う

### Status

Proposed（ステップ 15 の実装中に決定）

### Context

ステップ 15 の指示は「構造は保ち、Todo 由来の識別子とパス（67 箇所）を実在するものへ差し替える」である。実際に書き換えると、Todo 由来ではないが**同じく実在しない記述**が 3 種類残ることが分かった。

1. **架空のファイルを実在するかのように名指ししている箇所** — 「Shared server logic (authentication helper)」節の `packages/core/src/lib/server/currentUser.ts` / `getCurrentUser` / `requireCurrentUser`。`packages/core/src/lib/` の実体は `error.ts` 1 本のみで、認証ヘルパーの実物は `apps/web/app/presentation/session.ts`（`requireSession`）と `apps/web/app/presentation/auth.ts`（`sessionUserFn` / `requireAuthenticated`）にある。同節が根拠にしている `import "@tanstack/react-start/server-only";` の必須化もリポジトリ全域で 0 件（実際の隔離手段はハンドラー内の動的 import）
2. **リポジトリに依存関係が無いライブラリを前提にした節** — 「2. Held by TanStack Query」「4. Composite Component」「Client validation with Conform」。`@tanstack/react-query` / `@conform-to/*` / `sonner` はいずれも `apps/web/package.json` に無い
3. **AC-22 の 0 件検査と衝突する文言** — 「`.inputValidator(...)` は旧 API なので使うな」という注意書きそのものが、検査語 `inputValidator` にヒットする（検査は `-i` 付き）

### Decision

種類ごとに扱いを分ける。

1. **架空のファイルは実物へ差し替える**（Todo 由来でなくても直す）。「例示するコードはすべて実在の実装に基づかせる」という本 Issue の目的が、識別子の出自で線を引く理由を持たないため。あわせて `getContainer()` 直呼びの節も実在する 3 箇所（`presentation/serverErrorLog.ts` / `routes/storage.$.tsx` / `routes/__root.tsx`）へ差し替え、隔離手段の記述を `server-only` インポートから動的 import へ直す
2. **未採用のライブラリ節は削除せず、採用状況を各節の先頭に 1 段落で明示する**（「not adopted。`@tanstack/react-query` は依存関係に無い」）。既に「4. Composite Component」が同じ形の `> **Current status**:` を持っており、様式の持ち込みにならない。読者がファイルを探しに行くことは防ぎつつ、`### 1`〜`### 4` の見出し階層と「Selection flow」表の 5 行が壊れない
3. **`.inputValidator` の注意書きは、旧 API 名を書かずに同じ内容を伝える文へ直す**（「`input`-prefixed alias from older releases is deprecated」）。検査語を避けるための言い換えではなく、検査が要求しているのは「実在しない固有名を本文が使わないこと」であり、旧 API 名を引用として残すことはその要求と両立しない

### 検討した代替案

- **未採用の 3 節を削除する**: 本文が 3 割短くなり「Selection flow」表の 5 行のうち 2 行が指し先を失う。ステップ 15 の「構造は保ち」に反し、テンプレートとしての参照価値も落ちる
- **架空の認証ヘルパー節を触らない**（Todo 由来ではないので範囲外と解する）: `CLAUDE.md` → `docs/*` → 実コードの参照をつなぐという ADR-003 の目的が、この節だけ達成されないまま残る

### Consequences

- 良い点: 本文中のリポジトリ内パスがすべて実在する（ステップ 15 完了時に実測 44 パス / 未解決 0。`apps/web/app/components/${domain}/schema.ts` はテンプレート表記で原文どおり）
- トレードオフ: 差し替え範囲がステップ 15 の記載（67 箇所）より広い。ステップ 14（backend）は同型の判断を必要としないので、この決定は frontend 側に閉じる

---

## ADR-018: backend の「ドメインを足すとき」の例示は架空の `Foo` ではなく未実装の設計済みドメイン（Tag）で書く

### Status

Proposed（ステップ 14 の実装中に決定）

### Context

改訂前の `docs/backend_implementation_example.md` は全編を架空の `Foo` / `Bar` で書いており、ステップ 14 はこれを Note / Identity の実物へ差し替える。ところが本文には「新しいドメインを足すときの差分」を示す箇所が 3 つある（`ScopeUnitOfWorkContext` へのスロット追加、`AllDomainEvents` の union 拡張、`defaultEventDecoderRegistry` への登録）。ここだけは**まだ存在しないもの**を書かないと例にならない。

「例示するコードはすべて実在の実装に基づかせる」（ステップ 14 の原則）を字義どおり適用すると、この 3 箇所は書けない。しかし 3 箇所とも、テンプレートとしての本文の中心（ドメインを増やすときに何を触るか）である。

### Decision

**設計済みで未実装のドメイン `Tag` を placeholder に使い、追加行であることを `// ← added` / `// ← extend the union` で明示する。**

- `Tag` は `spec/domains/tag.md` と `spec/domains/index.md` のドメイン一覧に存在し、`spec/testcases/tag/` も 14 本ある。「次に足すドメイン」として実在の設計を指す
- 架空の `Foo` は「どこにも無い名前」なので、読者が grep して 0 件を引く。`Tag` なら spec に到達する
- 追加行に限って使う。既存の実装を説明する箇所（`ScopeUnitOfWorkContext` の現行スロット、現行の `AllDomainEvents` の 4 項）はすべて実物のまま書く

### 検討した代替案

- **架空の `Foo` を残す**: 差分の説明としては読める。しかし本 Issue が潰そうとしている「grep しても実物に当たらない識別子」をドキュメントに残すことになり、改訂の目的と衝突する
- **「ドメインを足すとき」の 3 箇所を削除する**: 実在しない識別子はゼロになるが、`CLAUDE.md` が「具体的な実装パターンは `docs/*` を参照」と指している以上、テンプレートの中心的な手順が抜け落ちる

### Consequences

- 良い点: 本文の識別子はすべて実装か spec のどちらかに到達する。`grep -in "todo" docs/backend_implementation_example.md` は 0 件（AC-21 の検査語も 0 件）
- トレードオフ: Tag ドメインを実装するスライスが `Tag` を別名にした場合、本文の 3 箇所が古くなる。1 語の置換で済む範囲であり、`spec/domains/tag.md` が改名されればどのみち追随が要る

## ADR-019: `PROVIDER_ACCOUNT_RELEASE_PENDING` は「コードによる例外」表ではなく `kind` 既定表の備考に置く

### Context

ステップ 7-6（SYNC-226 の波及）は「エラー → HTTP ステータスの対応表に `ConflictError("PROVIDER_ACCOUNT_RELEASE_PENDING")` を足す。既存の `PROVIDER_ACCOUNT_ALREADY_LINKED` 行と同じステータス（409）に置く」と指示している。しかし**その「既存行」は `spec/presentation/index.md` に存在しない** — 同ファイルで `PROVIDER_ACCOUNT_ALREADY_LINKED` は 1 件もヒットせず、409 は `ConflictError` の `kind` 既定として与えられている。

この文書の「コードによる例外」表は自ら「この例外は上表の 5 行だけとし、増やすときは**クライアントの振る舞いが実際に変わるか**を基準にする」と宣言している。`PROVIDER_ACCOUNT_RELEASE_PENDING` は既定と同じ 409 で、クライアントの振る舞いを変えない。ここへ 6 行目として足すと、表の意味（既定から外れるものだけを列挙する）と直後の宣言文の両方が壊れる。

### Decision

**`kind` による既定の対応表の `ConflictError` 行の備考に、2 つのコードを名指しして「どちらも既定のままで、コードによる例外を持たない」と書く。**「コードによる例外」表には足さない。

### 検討した代替案

- **「コードによる例外」表に 409 の行を 2 つ足す**: 指示の字面には最も近い。しかし「例外は 5 行だけ」「基準はクライアントの振る舞いが変わるか」という同じ節の規律と正面から衝突し、以後この表は「関係するコードの一覧」に意味が変わってしまう
- **表に足さず本文の 1 文だけで触れる**: 表の規律は保てるが、AC-50 の「エラー → ステータス表に `PROVIDER_ACCOUNT_RELEASE_PENDING` が載っている」を満たしたと読みにくい

### Consequences

- 良い点: AC-50 の検査（同ファイルに当該コードが載る）を満たしつつ、「例外表は既定から外れるものだけ」という文書自身の規律を守る。ステップ 4-5 が `spec/usecases/identity.md` のエラー表へ足すコードと、転送境界側の対応（既定の 409）が 1 か所で読める
- トレードオフ: 既定表の備考が 1 行だけ具体的なコード名を持つ形になる。同種の追記が続けば備考が台帳化しうるので、増やすときは「既定から外れないことを明示する必要があるか」を基準にする

---

## ADR-020: `ObjectStorage.put` の「ストリームの要求元」は `storeUpload` だけを名指しする

### Status

Accepted（ステップ 22 の実装時に判明。steps.md 22-1 の記述との差分）

### Context

ステップ 22-1 は、`put` からストリーム受けを落とした引き継ぎ段落で**要求元を 2 つ**名指しするよう指示していた —
`spec/usecases/storage.md#storeUpload` の入力 DTO `body: ReadableStream<Uint8Array>` と、
`spec/usecases/integration.md#requestBackup` 付近の `stream: ReadableStream<Uint8Array>`。

実物を確認すると後者は成立しない。

- `requestBackup`（`spec/usecases/integration.md:245`）の入力 DTO は `userId, sourceScopeType, sourceScopeId, noteIds` だけで、ストリームを受けない
- 台帳が拾った `:332` の `stream: ReadableStream<Uint8Array>` は `fetchBackupForRegeneration` の**出力** DTO であり、その出どころは手順 3 の `CloudDriveClient.download`（`spec/domains/integration.md:305`）= **`ObjectStorage` とは別のポート**である

つまり Drive 側のストリームは `put` の入口を広げる要求元ではなく、`ObjectStorage` の契約とは無関係に成立している。

### Decision

**引き継ぎ段落で名指しするのは `storeUpload`（入力 DTO の `body` と手順 2 の `ensureAcceptable` 呼び出し）だけにする。**
`spec/usecases/integration.md` への言及は書かない。

- 書くと「`ObjectStorage` の契約を広げる要求元」として別ポート（`CloudDriveClient`）の経路を数えることになり、`spec/adr/046` の「責務の移転を残す」という趣旨に対して誤った移転先を書き込む
- `CloudDriveClient.upload` / `download` は現状どおりストリームを扱う。ここは変更しない（`ObjectStorage` の判断は `CloudDriveClient` に及ばない）

### 検討した代替案

- **steps.md どおり 2 経路を書く**: 手順への忠実さは保てるが、`requestBackup` にストリーム入力は無いので、読者が実物を引くと記述に到達しない
- **`fetchBackupForRegeneration` を「読み取り側の要求元」として書き足す**: `get` が `ObjectBody.bytes` を返す形との対比にはなるが、その経路は `ObjectStorage.get` を通らない（Drive から直に返す）ので、やはり無関係な経路を契約の段落に持ち込む

### Consequences

- 良い点: 引き継ぎ段落の名指しがすべて実在の経路に到達する。`put` の入口を広げる判断の要求元が 1 つに絞られ、そのスライス（取り込み = Issue #6）が誰かを取り違えない
- トレードオフ: `spec/usecases/integration.md` の Drive 経路がストリームのままである事実は、どの spec からも「`ObjectStorage` との差」としては説明されない。差ではない（別ポート）ので問題にはならないが、台帳 SYNC-203 の読み手が同じ勘違いを繰り返す余地は残る

---

## ADR-021: 宣言値を落とした理由の記述に識別子 `declaredMimeType` を使わない

### Status

Accepted（ステップ 24-1 / 24-5 の実装時。AC-65(b) の件数一致検査との整合）

### Context

ステップ 24-5 は `startBulkUpload` の `files` 列に添える 1 句を
「`files[]` の `declaredMimeType` / `size` は…ヒントである」という**識別子を含む文面**で例示していた。
一方 AC-65(b) の合否は `grep -c "declaredMimeType" spec/usecases/storage.md` が **1**（残すのは `:22` の `files` 列の型定義だけ）である。

例示どおりに書くと、`startBulkUpload` の 1 句だけで 2 件になり、
`storeUpload` / `storeMedia` / `storeAvatar` に添える「宣言値を落とした理由」の 1 句を加えると 5 件になって検査に落ちる。
実測でも一度 5 件になった。

### Decision

**説明文では識別子ではなく日本語の語（「宣言 MIME」「宣言サイズ」「宣言値」）を使う。**
識別子 `declaredMimeType` が残るのは `files` 列の型定義（`{ fileName: string; declaredMimeType: string; size: number }[]`）だけにする。

- 同ファイルは改訂前から手順 4・5 と出力 DTO の説明段落で「宣言 MIME」という語を使っており、**既存の記述様式に合わせる**選択でもある（steps.md「記述様式の遵守」）
- 検査が数えているのは「宣言値を入力に持つ経路の数」であって「その語に言及した回数」ではない。説明文が識別子を使わなければ、検査の意味と実測が一致する

### Consequences

- 良い点: AC-65(b) が意図どおり「宣言値を受ける入力 DTO は `startBulkUpload` の 1 つだけ」を測る。説明文を足しても検査値が動かない
- トレードオフ: steps.md 24-5 の例示文面と spec の実文面が字面で一致しない。意味は同一で、`grep` で追う側は識別子ではなく「宣言」を引くことになる

---

## ADR-022: 再認証の未了は `ValidationError("REAUTHENTICATION_REQUIRED")` として `addPasswordIdentity` のエラー表に置く

### Status

Accepted（ステップ 4-6 の実装時に決定）

### Context

ステップ 4-6 は `addPasswordIdentity` の処理フローへ再認証（Google 再認可）の手順を足し、エラーケース表に「再認証未了の行」を足すよう指示している。正本は `spec/scenario/account.md:128`（AC-06）/ `spec/pages/index.md` の P-22 の状態「再認証要求」/ `spec/manual-tests/account.md` の TC-07 で、**実装は再認可を行っていない**（adr.md ADR-013 のとおり spec 内部の矛盾解消だけを行い、実装は Phase 5 へ送る）。

そのため、行に書くエラーコードの実装側の正本が存在しない。`spec/` 全域を検索しても再認証を表すコードは 0 件で、既存コードの流用先も無い（`UNAUTHENTICATED` は「セッションが無い」であって「セッションはあるが再認可が要る」ではない）。

### Decision

**`ValidationError("REAUTHENTICATION_REQUIRED")` を新設し、`addPasswordIdentity` の処理フロー手順 1 とエラーケース表に置く。**

- `kind` は `ValidationError`。転送境界の既定ステータス（422）で足り、クライアントの振る舞いが既定から外れる根拠が無い（`spec/presentation/index.md` の「コードによる例外は増やすときにクライアントの振る舞いが実際に変わるかを基準にする」）
- 命名は同ファイルの他のアプリケーション層コード（`USER_REQUIRED` / `ACCOUNT_UNAVAILABLE` / `EMAIL_NOT_VERIFIED`）と同じ UPPER_SNAKE 形にそろえる
- **ドメインのエラーコード（`IdentityErrorCode`）には足さない。** 再認証の要否は認証手段集合の不変条件ではなく、要求の文脈（現在のセッションが最近再認可されたか）に属するため

### 検討した代替案

- **コード名を書かず「再認証を要求する」とだけ書く**: 実装側に正本が無いことに忠実だが、同じ表の他の 5 行がすべてコードを持つので様式が崩れ、実装スライスがコードを自分で決めることになる（本 Issue が潰そうとしている「呼称ずれ」を将来へ先送りする）
- **`UnauthorizedError("UNAUTHENTICATED")` を流用する**: 新設コードが要らない。しかし P-22 は「再認証要求」状態で認可フローへ誘導する画面であり、サインイン画面へ飛ばす `UNAUTHENTICATED` と同じ扱いにすると導線が壊れる

### Consequences

- 良い点: エラー表の様式が保たれ、再認証を実装するスライス（Phase 5）が名前を決め直さずに済む
- トレードオフ: 実装に存在しないコードを spec が持つ状態がしばらく続く。向きとしては「spec が正・実装が未実装」（`spec/adr/046`）で、spec を狭めない方針と一致する

---

## ADR-023: 新設ユースケース 3 節に伴う波及（ユースケース数と継続要求の `cursor`）は同じ Issue 内で追随させる

### Status

Accepted（ステップ 3 / 4 の実装時に判明。steps.md に指示が無い箇所）

### Context

ステップ 4-7（3 節の新設）とステップ 3-8（継続要求 payload への `cursor` 追加）を書いた時点で、**steps.md がどのステップにも割り当てていない 2 つの追随**が必要になった。どちらも放置すると、本 Issue の編集そのものが新しい spec 内部の矛盾を作る。

1. `spec/domains/index.md` の「ユースケースの分布」表 — Identity `21` / 合計 `143`。ステップ 4-7 で 3 節を足すと実物は 24 / 146 になる。この表は steps.md 32 の注意が「9 ドメインすべてで 1 ユースケース = 1 テストケースファイル = 1 UC 行が成立している」と数えている当の数字でもある
2. `spec/usecases/identity.md` の `deleteAccount` 入力 DTO — 継続 3 kind が `{ operationId, phase }` のままで、ステップ 3-8 が同じ継続の payload に `cursor` を足した継続要求表と食い違う。実装 `application/identity/deleteAccount/input.ts:31-38` の JSDoc は「The spec's DTO names only the phase and leaves the position on the manifest header, but then a redelivered turn resumes from wherever the chain has since moved to」と **spec を名指しで否定**している

### Decision

**どちらも本 Issue で追随させる。**

1. 分布表を Identity `24` / 合計 `146` に直す
2. `deleteAccount` の入力 DTO の継続 3 arm に `cursor: string | null` を足す。**`continuationKey` は足さない** — 実装の入力型も持たず、これは outbox 行の同一性を決める転送側の値であって、ユースケースが読む入力ではない

### 検討した代替案

- **どちらも触らずフォローアップへ送る**: 台帳の範囲には忠実。しかし 1. は本 Issue の編集が直接壊す数字で、2. は同じ Issue の中で `spec/domains/index.md` と `spec/usecases/identity.md` が同じ継続を別の payload で書く状態になる。「同じことを同じ語で書く」という本 Issue の成果物の定義と衝突する

### Consequences

- 良い点: 新設 3 節に伴う数字と継続 payload が本文の全参照箇所で一致する
- トレードオフ: ステップ 3 / 4 の差分が steps.md の列挙より広い。範囲は 2 か所に限られ、どちらも本 Issue の編集が作った不整合の是正である

---

## ADR-024: `containerStore.ts` の陳腐化した参照は本 Issue で直し、コード差分を 9 ファイルへ広げる

### Status

Accepted（ステップ 14 の実装時に発見。台帳外の 1 件）

### Context

`packages/core/src/application/di/containerStore.ts` の JSDoc（`:29-33`）とエラーメッセージ（`:44-47`）が、**実在しないファイル `apps/web/app/server.cloudflare.ts`** をランタイムエントリとして名指ししていた。同ファイルは「this reader is shared by both runtimes」とも書いており、参照ランタイムを Node 単一に定めた [ADR 025](../adr/025-single-reference-runtime.md) の後は前提ごと成立しない。

実測では `installContainerStore` の呼び出し元は `apps/web/app/server.node.ts:41` の 1 か所だけで、`apps/web/app/` に `server.cloudflare.ts` は存在しない。

この 1 件はステップ 8 の対象 7 ファイルに含まれておらず、`research.md` / `research-2.md` の台帳（SYNC-01〜27 / SYNC-201〜244）にも無い。台帳は `spec/` と実装の照合から作ったので、**どの spec も言及していないコード内の参照**は原理的に拾えない。

### Decision

**本 Issue のスコープに取り込み、ステップ 8 の 8 件目として直す。AC-63 のコード差分を 8 ファイル → 9 ファイルへ更新する。**

- 直す内容は JSDoc とエラーメッセージの**文言のみ**。投げる条件・型・戻り値は 1 つも変えない。エラーメッセージ文字列を参照するテストは存在しない（`grep -rn "container store was installed" packages/ apps/` は当該ファイルのみ）
- 名指しは実在する唯一のランタイムエントリ `apps/web/app/server.node.ts` にそろえ、「両ランタイムで共有」の 1 句も現状に合わせる

### 検討した代替案

- **台帳外なのでフォローアップ Issue へ送る**（ステップ 16 の起票に足す）: スコープの線引きには忠実。しかし本 Issue の定義は「陳腐化した記述を実装の現状に同期する」であり、`CLAUDE.md` の Reference runtime 節（ステップ 13）と `docs/*_implementation_example.md`（ステップ 14 / 15）から Cloudflare 前提の記述を落とす作業と**同じ乖離の同じ面**である。同じ改訂で片方だけ残すと、`grep -rn "server.cloudflare" packages/ apps/` が本 Issue 完了後もヒットし続ける
- **AC-63 を据え置き「例外 1 件」と注記する**: 件数を動かさずに済むが、AC-63 の検査は `git diff --stat` の実測なので、例外を持たせると機械判定が成立しなくなる

### Consequences

- 良い点: `grep -rniE "server\.(cloudflare|aws|gcp)|serverCloudflare|serverAws|serverGcp|infra/(aws|cloudflare|gcp)" packages/ apps/ --include="*.ts" --include="*.tsx"` が **0 件**になる（本件の 2 行が唯一のヒットだった）。ドキュメント側とコード側で Cloudflare 前提の陳腐化が同時に閉じる
- トレードオフ: 台帳に無い項目を 1 件だけ取り込むので、「台帳 = 本 Issue の全数」という読み方が崩れる。ステップ 8 の台帳 ID 欄に「台帳外 1 件」と明記して補う。同種の発見が続くなら台帳の作り方（spec 起点だけでなくコード起点の探索）を次の spec-sync で見直す

## ADR-025: 手順書に新しく書く「ブラウザ」の表記は `spec/manual-tests/` の既存表記に合わせる

### Status

Accepted（ステップ 17 の最終確認で判定）

### Context

ステップ 18 で追加した TC-42 が「ブラウザー」を 4 か所に持ち込み、`spec/manual-tests/account.md` の中で既存の「ブラウザ」11 か所と混在した。文言の出所は上流の `spec/scenario/account.md`（3 か所すべて「ブラウザー」）と [ADR 029](../adr/029-verification-session-binding.md)（8 か所すべて「ブラウザー」）である。

実測すると `spec/` 全体では両表記が併存している（「ブラウザー」45 / 「ブラウザ」57）。ただし**区画ごとに見ると分かれている** — `spec/manual-tests/` は本 Issue の追加前まで 10 ファイル 29 か所すべてが「ブラウザ」で例外がなく、`spec/adr/` は逆にほぼ「ブラウザー」。`spec/pages/index.md` は 2 / 2 で混在している。

### Decision

**新しく足した 4 か所を「ブラウザ」へ直し、既存行は触らない。** 上流の語をそのまま写すのではなく、**書き込む先の区画の表記に合わせる**。

### 検討した代替案

- **`spec/manual-tests/account.md` を「ブラウザー」へ統一する**（既存 11 行を書き換える）: 直上流の scenario / ADR とはそろうが、`spec/manual-tests/` の他 9 ファイル 18 か所とはずれる。手順書は 1 ファイルを通しで読むものだが、区画としては 10 ファイルが 1 つのテスト手順書群であり、こちらのほうが読者の視野が広い
- **`spec/` 全域の表記統一**: 102 か所に及ぶ純粋な編集作業で、実装との乖離の同期という本 Issue の定義から外れる。やるなら独立した編集パスとして切る

### Consequences

- 良い点: `grep -ro "ブラウザー" spec/manual-tests/` が 0 件に戻り、本 Issue が持ち込んだゆれが閉じる。既存行を 1 行も触らないので差分が増えない
- トレードオフ: `spec/` 全域の併存は残る。区画ごとに表記が分かれている事実は本 ADR に記録するだけで、統一はしない

## ADR-026: 手順を直したら見出しの動詞も追随させる（TC-26）

### Status

Accepted（ステップ 17 の最終確認で判定）

### Context

ステップ 18-4（SYNC-241）で TC-26 の手順を「再設定リンクを**開く**」から「開いて**新しいパスワードを送信する**」へ直した。これは GET で状態を変えない設計（プリフェッチや先読みでトークンを消費しない）を手順書へ反映したものだが、見出し `## TC-26: 期限切れの再設定リンクを開く` だけが「開く」のまま残った。

### Decision

**見出しを `## TC-26: 期限切れの再設定リンクを開いて送信する` へ追随させる。**

見出しの「開く」を残すと、まさに今回訂正した誤解（リンクを開いた時点で拒否が起きる）を見出しが再主張する。手順の訂正と見出しの訂正は同じ 1 つの是正である。

### 検討した代替案

- **見出しも広げて `期限切れ・使用済みの再設定リンクで送信する` にする**: 手順 2 が「使用済み」を扱うので、見出しが手順より狭いのは事実。しかしこの狭さは本 Issue の変更前から存在し、同ファイルの他の見出しも代表ケースを名乗る書き方で揃っている（`## TC-20: 使用済みの確認リンクを開く` など）。本 Issue が持ち込んでいないずれまで直すと、是正の範囲が判定しにくくなる
- **見出しを据え置く**: 見出しは短い札で手順の要約ではない、という読み方も成り立つ。ただし今回ずれているのは粒度ではなく**動詞そのもの**で、訂正した内容と正面から食い違う

### Consequences

- 良い点: `resetPassword | 期限切れ・使用済み | TC-26` のカバレッジ行から辿った読者が、見出しと手順で違う操作を読まされない
- トレードオフ: 見出しが「使用済み」を名乗らない点は残る（本 Issue 以前からの状態）
