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
- `spec/testcases/ports/` を新設する案は `spec/adr/026-port-contract-and-conformance.md`（`.thread/1/adr.md` ADR-003 由来）で既に棄却済み。「コードの共有スイート自体を契約の実行形とする」。ADP 行と適合ケースの対応をどう追うかは 026 が決めておらず、命名規約は `spec/adr/052` 自身の決定として立てる（ADR-034）
- 相乗りしているケースのうち `ADP-common-017/019/021` の「membership item は cleanup レーンが走って初めて完全 ack になる」は、3 メソッドのどの 1 行にも収まらない**横断的な振る舞い**

### Decision

新しい ADP ID は採番しない。

1. 契約そのものは**ポート定義の正本**（`spec/domains/note.md` のポート説明段落、`spec/domains/index.md` の `AccountDeletionManifestStore` 節）に書く
2. `spec/inventory/adapter.md` は生成物なので、既存行の「実装されるべき振る舞いの要点」欄を本文に追随させるだけにする（`ADP-note-015` に順序、`ADP-note-046/047` に列挙 state、`ADP-note-021` にエスケープ契約、`ADP-common-012` に replayed begin、`ADP-common-017/019/021` に cleanup レーンの位置づけ）
   - このうち `ADP-note-021` と `ADP-common-012` は**本文修正を伴わない**。`highlightedExcerpt` のエスケープ契約は `spec/domains/note.md` の「`excerpt` と `highlightedExcerpt` の描画契約は正反対である」節に既に詳述されており、replayed begin も現行の「冪等に開始する」で概ね充足している。要点欄の追随だけで決定 1 を満たす
3. ヘッダーの「最終同期」日付を更新する。あわせて**ヘッダーに生成規則を 1 行明文化する**（「1 行 = 1 ポートメソッド。適合スイートのケースは行にせず、ケース名（`it` の第 1 引数）の先頭に ADP ID を置く命名規約で追う」）。この不変はどの spec ファイルにも書かれておらず、書かなければ次の spec-sync で必ず再燃する

### 検討した代替案

- **`ADP-common-040` を新規採番して membership cleanup レーンの行を足す**: 台帳の「1 行 = 1 ポートメソッド」不変が壊れ、以後「どこまでがメソッドで、どこからがケースか」の判断が毎回必要になる。加えて Issue #2 の spec-sync が `describe` / `describePersonalCleanup` の採番漏れ 2 件を埋める予定なので、番号の取り合いになる
- **ケース単位の行を全 ADP に展開する**: 適合スイート 35 本ぶんを台帳へ二重管理することになり、`spec/adr/026` が「実行形を正とする」と決めた理由と反する

### Consequences

- 良い点: 台帳の生成規則が保たれる。契約が「実装者が読むポート定義」に集まる
- トレードオフ: 適合ケース 1 本ずつを ID で追跡することはできない（ケース名の命名規約で追う既存方針のまま）

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

`adapters/conformance/` の 31 スイートのうち残り 26 本はすべて `it` 名に ADP ID を含む（命名規約は `spec/adr/052` — ADR-034）。ADP ID を持たないのはこの 5 本だけで、inventory 行の欠落と 1 対 1 に対応している。

### 追補の決定

**`AppliedOperationStore` にも interface と inventory 行を新設しない。** 代わりに `spec/domains/index.md` の `ScopeKey と永続化境界` 節の箇条書きに、`DistributedOperationStore` と**同じ粒度の 1 行言及**を足す（名前・置き場所・`ScopeCleanupAdmissionStore` との鍵の違い＝ `spec/adr/045`）。ステップ 26-2 はその言及と同じ名前を使う。

- **`### 新設する横断的ポート` に `IdempotencyStore` と同じ形で interface を書く案は採らない。** 実装 JSDoc が正本なので転記自体は可能だが、inventory 行を採ると `spec/adr/052` の命名規約により適合スイートの `it` 名へ ADP ID を付ける差分が要る。本 Issue は AC-63 でコード差分を 9 ファイルに限っており、5 本のうち 1 本だけを直すと**残り 4 本との新しい非対称**を作る（ADR-015 が避けようとしたのと同じ事故）
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

## ADR-027: `UnauthorizedError` と `ValidationError("UNAUTHENTICATED")` の使い分けを presentation で立法しない

### Status

Proposed（レビュー R1 の M-13 / U5 で判断）

### Context

レビュー R1（`presentation:B-001`）は、`spec/presentation/index.md` の `kind` 既定表に `unauthorized` の行が無く、本 PR が `spec/usecases/identity.md` に足した `UnauthorizedError("UNAUTHENTICATED")` が表の定める既定（「該当しない値は `unknown` として 500」）に落ちることを指摘した。行を足すこと自体は自明である。

自明でないのはその先で、**同じコード `UNAUTHENTICATED` が 2 つのエラー型から投げられる**という事実をどう扱うかだった。`ValidationError("UNAUTHENTICATED")` は「コードによる例外」表に既にあり 401 へ写る。`UnauthorizedError("UNAUTHENTICATED")` は `startOAuthFlow.ts:68` / `linkOAuthIdentity.ts:140` から実際に到達し、`kind` 既定として 401 へ写る。行を足すと、転送境界の正典の中に **401 へ着く 2 系統**が並ぶ。レビューは「どちらを使うかを 1 行で決めておくと次のスライスで割れない」と提案した。

### Decision

**`unauthorized | 401` の行と `forbidden | 403` の行を足すところまでを presentation の仕事とし、「どちらの型を投げるか」の規則は presentation に書かない。** 表には「転送境界は 2 系統を区別せず同じ 401 に着く / どちらを投げるかは各ユースケース文書が決める」と、**分担そのもの**を書く。

`forbidden` は現状どの経路も投げないが、直列化形と写像は実在する。「本設計では権限不足を `NotFoundError` へ畳むため使わない」を添えて、行だけを置く。

### 検討した代替案

- **presentation で「未認証は `UnauthorizedError` に寄せる」と規範を立てる**: 一見きれいだが、`spec/presentation/index.md:189` は自ら「対応表はここが唯一の正典であり、**ユースケース文書はステータスを書かない**」と宣言している。これは「転送の写像は presentation が独占する」という分担であって、「どの型を投げるかまで presentation が決める」ではない。どの型が適切かは主体の状態がどう壊れているか（資格情報が無い / 主体が `active` でない）というユースケース側の知識に依存し、presentation はその知識を持たない。規範を立てると、次に `UnauthorizedError` が要る経路が現れるたびに presentation を改訂する依存が生まれる
- **`ValidationError("UNAUTHENTICATED")` の例外行を削って 1 系統へ寄せる**: 実装が 2 系統を持っている以上、これは spec を実装より狭める向きで [ADR 046](../adr/046-port-contract-divergence.md) に反する。しかも既存経路の型変更＝振る舞いの変更で、本 PR のスコープ外
- **行を足さずスコープ外とする**: 表が自分で「唯一の正典」と閉じているので、欠けたままだと spec を正典に転送境界を書き直した実装が 500 を返す。認証系のステータスなので放置の害が大きい

### Consequences

- 良い点: 転送境界の正典は「`kind` → ステータス」の写像だけを持ち、型の選択という**内側の判断**を吸い込まない。ユースケース文書はこれまでどおりステータスを書かず、型だけを書く。両者の責務が交差しない
- 良い点: 401 が 2 系統ある事実が読者に明示されるので、「片方は誤りではないか」という疑問がレビューのたびに再燃しない
- トレードオフ: 「どちらを投げるか」の判断は各ユースケース文書に分散したままで、横断的な一貫性は保証されない。実際 `startOAuthFlow` は `UnauthorizedError`、`addPasswordIdentity` は `ValidationError` を使っており、選択理由は各節を読まないと分からない。統一が要ると判断されたときは、**identity ドメインの語彙**として `spec/domains/identity.md` 側に置くのが筋（presentation ではない）

## ADR-028: サービス全体の既定は `spec/inventory/frontend.md` の個別 PAGE 行に写さず本文へ委ねる

### Status

Proposed（レビュー R1 の M-34 / M-35、U3 / U5 で判断）

### Context

レビュー R1 は `spec/inventory/frontend.md` の 2 つの不整合を挙げた。

- **CSRF**（`inventory:W-004`）: 本 PR は `spec/presentation/index.md` の CSRF 規約から「`FormData` を受ける場合は」という条件を外し、**すべての server function 呼び出し**に同一オリジン検証が掛かる規律へ改めた（AC-16）。ところが `PAGE-p12-006` / `PAGE-p13-004` / `PAGE-p21-003` / `PAGE-p31-004` の 4 行が「Origin 検証済み FormData で送る」という条件付きの書き方を保存し続けていた
- **`Cache-Control`**（`inventory:W-005` / `presentation:W-007`）: 本 PR は `PAGE-p47-001` の要点にだけ `Cache-Control: private, no-store` を足した。しかし同じヘッダーは全応答の既定で、P-41〜P-45 も同じヘッダー集合を扱う面である

どちらも「1 行だけに書くと、その画面固有の要件だと読める」という同型の問題で、選択肢は (a) 該当する全 PAGE 行へ横展開する、(b) PAGE 行から落として本文（`spec/presentation/index.md`）だけに置く、の 2 つだった。

### Decision

**(b) を採る。サービス全体に一様に掛かる既定は `spec/presentation/index.md` にだけ書き、`spec/inventory/frontend.md` の PAGE 行からは落とす。**

- CSRF: 4 行から「Origin 検証済み」を外す。`FormData` を使うこと自体は各画面の実装事実なので残す
- `Cache-Control`: `PAGE-p47-001` から外す

判定の基準は **その記述が画面ごとに違いうるか**。違いうるなら PAGE 行の要点（例: `/storage/*` の `immutable` は配信口固有なので presentation 本文の例外句に書く）、一様なら本文だけ。

### 検討した代替案

- **(a) 該当する全 PAGE 行へ横展開する**: 台帳の 1 行だけを読んだ実装者にも規約が届く、という利点は本物である。しかし `spec/inventory/frontend.md` は 162 行あり、CSRF は「server function を呼ぶすべての行」、`Cache-Control` は「認証応答を返すすべての行」に掛かる。ほぼ全行に同じ文を複製することになり、次に規約が変わったときの追随箇所が 1 か所から 100 行超へ増える。`spec/inventory/*.md` は本文からの**生成物**（plan.md リスク節）であり、生成物側に既定を複製するのは生成規則を壊す向き
- **PAGE 行に「本文の既定に従う」と 1 句だけ書く**: 情報量が 0 に近いわりに全行を触ることになり、(a) の保守コストだけが残る

### Consequences

- 良い点: 規約の正典が 1 か所（`spec/presentation/index.md`）に閉じ、改訂の追随先が増えない。本 PR が CSRF 規約を無条件化したときに 4 行が取り残された事故が、構造的に起きなくなる
- 良い点: PAGE 行の要点欄が「この画面に固有のこと」だけを語るようになり、行の粒度がそろう
- トレードオフ: `spec/inventory/frontend.md` の 1 行だけを読んで実装する読者には CSRF / `Cache-Control` が見えない。台帳は本文への入口（各行が `spec/pages/index.md#P-xx` へリンクする）であって本文の代替ではない、という前提に依存する。この前提が崩れるなら、直すべきは台帳の書き方ではなく台帳から本文への到達性

## ADR-029: 適合スイートのケース名には複数の ADP ID を連記してよい

### Status

Proposed（レビュー R1 の M-11 / U8 で判断）

### Context

[ADR 052](../adr/052-adapter-inventory-granularity.md) は `spec/inventory/adapter.md` を「**1 行 = 1 ポートメソッド**」の生成物と定め、適合ケースには行を採番せず、**ケースと ID の対応はケース名（`it` の第 1 引数）で追う**と決めた。本 PR はその規約を立てた当の PR でありながら、新しく採番した ADP ID 8 本のどれも `it` 名に反映しておらず、さらに既存の `it` が別メソッドの ID を名乗る衝突（`ADP-common-012` / `ADP-common-009` / `ADP-identity-009` / `ADP-note-028`）を作っていた（M-11）。

`it` 名を付け替える段になって問題が出た。**1 ケースが 2 つのポートメソッドを同時に拘束している**ものがある。

- `identityUniqueDirectory.ts` の「`beginRelease` then `release` frees an activated claim」— 新設した `beginRelease`（`ADP-identity-041`）と既存の `release`（`ADP-identity-009`）の**協調**が主張の中身で、片方だけを名乗ると主張の半分が台帳から見えなくなる
- `noteProjection.ts` の `redactAuthor` — `LocalNoteProjectionWriter` / `PublicNoteProjectionWriter` の 2 つの writer（`ADP-note-055` / `056`）に**両面で同じ置換が起きること**が主張である。2 ケースに割ると「両面で」という主張自体が消える

### Decision

**1 ケースが複数のポートメソッドを拘束するときは、`it` 名に ADP ID を連記してよい**（`ADP-identity-041/009` / `ADP-note-055/056`）。ADR 052 の「1 行 = 1 メソッド」は **`spec/inventory/adapter.md` 側の不変**であって、スイート側のケース粒度への制約ではない。

連記の順は**そのケースが第一に拘束するメソッド**を先に置く。上の例では `beginRelease` の契約が主題なので `041/009`。

### 検討した代替案

- **1 ケース = 1 ADP ID を守り、ケースを分割する**: 台帳との対応は機械的になるが、上の 2 例では**主張そのものが壊れる**。協調と両面性は 1 つのシナリオでしか観測できず、分割すると「`beginRelease` は何かをした」「`release` は何かをした」という個別事実だけが残り、`reserve` が再び通るようになるという肝心の帰結が誰の担保でもなくなる
- **代表 1 本だけを名乗る（現状維持）**: これが M-11 の指摘した状態で、`ADP-identity-041` を採番したのにスイートのどこからも名乗られない行が生まれる。ADR 052 が「ケース名が唯一の追跡手段」と決めた以上、名乗られない ID は追跡不能な ID である
- ~~**ADR 052 の本文を改訂して連記を明文化する**: 本 PR のスコープ（`spec/` と実装の同期）に対して、直近に新設した ADR の再改訂を重ねることになる。連記は ADR 052 の不変（台帳側の 1 行 1 メソッド）を一切侵していないので、`spec/adr/` を触らずに済ませられる。連記が他スライスでも常態化するなら、そのとき 052 に 1 段落足す~~ → **この代替案は採用された。** レビュー R2 の M-62（V1）が ADR 052 の命名規約そのものを改訂する必要を生み、その改訂と同じ段落に連記の規則を置くのが自然になったため、052 の決定節に「1 ケースが複数のポートメソッドを拘束するときは ID を並べる」と「後続の ID を短縮しない」が入っている。「`spec/adr/` を触らずに済ませられる」という上の判断は、052 を触る用が別に立った時点で成立しなくなった

### Consequences

- 良い点: **本 PR が採番した 8 ADP ID**（`ADP-common-040,041` / `ADP-identity-039〜041` / `ADP-note-055,056` / `ADP-storage-024`）と、本 PR が契約を足した `ADP-identity-007` について、`grep -rn "<ID>" packages/core/src/adapters/conformance/` が単体でヒットする（実測で 9 本すべて確認）。台帳 → スイートの到達性は**この範囲では**回復した
- **ただし「採番済み ID を全数拾えるようになる」は成立しない。** 短縮した連記（`ADP-note-055/056` のように後続を数字だけにする形）が既存スイートに残っており、実測で **`it` 名の短縮連記が 31 ケース**、そのうち**単体 grep で到達できない ID が 20 本**ある（`ADP-common-005,010,018,020,021,023,024` / `ADP-identity-011,013,016,022` / `ADP-note-009,011,018,039,044,045` / `ADP-storage-002` / `ADP-usage-002,007`）。連記を全形で書く規則は **ADR-035**（本ファイル）が決め、既存分は「そのケースに触れた回で全形化する」として `spec/adr/052` の影響節に記録した。**本 ADR が主張できるのは本 PR の採番分の到達性までである**
- 良い点: 主張の単位（1 つの観測可能なシナリオ）を歪めずに ID を付けられる
- トレードオフ: 「ADP ID → ケース」が 1 対 1 でなくなるので、ID から機械的にケース数を数えることはできない。数えたいのは台帳側の**メソッド数**であって、そちらの 1 対 1 は保たれている
- トレードオフ: 連記の順（第一に拘束するメソッドを先に）はスイートを書く人の判断で、機械検査できない
- トレードオフ: 短縮連記を許した書き方が到達性を壊すことは、連記を決めた時点では見えていなかった。**ID の到達性は「素朴な `grep` で当たる」ことが値打ち**であり、検査側を精巧にして救う向きは採らない（ADR-035）

## ADR-030: 実装 JSDoc は spec を名指しで否定しない — 否定が要るなら spec を直す

### Status

Proposed（レビュー R1 の M-02 / M-31 / M-23、U7 で判断）

### Context

本 PR は `spec/usecases/identity.md` / `spec/database/index.md` の予約 operation ID を `sha256(...)` から合成式へ改訂し（AC-46 / AC-67）、`verifyEmail` の出力 DTO の `sessionToken` を `string | null` へ改訂した（AC-10）。ところが実装側の JSDoc は「**the spec writes `sha256(...)`**」「**the spec's output table types it as non-null, which cannot represent that path**」と、改訂前の spec を名指しで否定したまま残っていた（M-02）。

同じ PR は `domain/identity/errorCode.ts` の同種のコメント（「spec の記載漏れとして扱った」）を AC-58 で**全文削除**しており、扱いが割れていた。加えて `completeOAuthCallback.ts` の `provider` を「display / logging only」と書いた JSDoc（M-31）と、`identityUniqueDirectory.ts` の `reserve` のエラー契約（M-23）は、spec ではなく**実装自身**と食い違っていた。

### Decision

**実装 JSDoc に「spec はこう書いているが実装はこうする」という形の記述を残さない。** 乖離を見つけたら向きを [ADR 046](../adr/046-port-contract-divergence.md) で判定し、

- **実装が正** → spec を直したうえで、JSDoc は**判断の理由**だけを述べ、根拠として `spec/adr/` を指す（`sha256` の 2 か所は「Composed rather than hashed（`spec/adr/048`）、理由は…」へ）
- **spec が正** → 実装を直す（本 PR のスコープ外なら Phase 5 へ送り、JSDoc には何も書かない）

`errorCode.ts` の全文削除と同じ扱いを、`uniqueness.ts` / `removeIdentity.ts` / `view.ts` にも当てる。**否定の向きを逆転させただけ**（「spec が間違っている」→「spec が正しくなった」）では AC-67 の目的（実装が spec を名指しで否定している状態の解消）は達成されない。

### 検討した代替案

- **「spec と一致している」旨を JSDoc に書いて残す**: 一致は既定であって書く価値が無く、次に spec が動いたときに再び偽になる。JSDoc が spec の**写し**になると二重管理が始まる（`CLAUDE.md`「Default to no comments」の趣旨）
- **JSDoc を触らず spec 側にだけ注記する**: `spec/index.md` は正典から進捗・改訂履歴を排しており、「実装のコメントがこう書いている」は正典に置く種類の情報ではない
- **理由の記述ごと削る**: `sha256` を採らなかった理由（構成要素が曖昧でないのでハッシュ無しで決定性が出る / application 層にハッシュ実装を持ち込まない）は非自明な判断で、[ADR 048](../adr/048-uniqueness-reservation-operation-id.md) に昇格済みでもある。**根拠へのリンクとして残す**のが正しく、消すのは行き過ぎ

### Consequences

- 良い点: **spec を否定する言い回しが 0 件になり**、コードを読む人が「どちらが正か」を判断する必要がなくなる。検査は `grep -rn "the spec writes\|the spec's output table\|has no usecase in the spec\|no spec TC\|the spec mandates it unconditionally\|spec の記載漏れ" packages/ apps/` → **0 件**（実測で確認）
  - **検査語は否定形に絞ってある。** 当初の `"the spec writes\|the spec's"` は所有格 `the spec's` が広すぎて、spec を否定していない 2 件（`identity/uniqueness.ts` の "per the spec's convergence"、`identity/updateProfile.ts` の "the spec's spelling of"）を拾い、実測で 0 件にならなかった（M-84）。同じ理由で `"the spec mandates"` も単体では使わない — `domain/note/services/noteAccessPolicy.ts` の "the spec mandates constant time" は**実装が spec に従っている**旨の記述で、否定ではない。**否定しているかどうかが検査の軸**なので、語は `the spec mandates it unconditionally`（従っていないと続く形）まで含めて指定する
  - 検査対象に `apps/web/dist/` が入るが、これは gitignore 済みのビルド成果物で、`pnpm build` を回せばソースと同期する。追跡ファイルだけを見るなら `git grep -n "…" -- packages apps` でも同じ結果になる
- 良い点: 根拠が `spec/adr/` への参照になるので、判断の背景が正典側にあり、実装が動いても参照は生き続ける
- トレードオフ: JSDoc から spec 本文の引用が消えるので、実装だけを読んでいる人は差分の履歴を辿れない。これは意図した分業（変更の履歴は Git、判断の理由は `spec/adr/`）
- 副産物: 同じ観点で presentation の 4 か所に `.thread/2/adr.md` にしか存在しない ADR 番号（`ADR-006` / `095` / `099` / `110` / `112`）への dangling 参照が見つかった（M-42）。`start.ts` の `AC-15`（AC-16 / SYNC-10）と同型で、**作業ブランチのローカル ID をコードに残さない**という同じ規律に属する

## ADR-031: `AccountDeletionRetryPolicy` が数えるのは terminal 行であり、spec 全体の語彙をそこへそろえる

### Status

Proposed（レビュー R1 の M-07、U1 / U2 / U4 で判断）

### Context

レビュー R1（`inventory:B-001`）は、本 PR が `spec/database/index.md:154` に `AccountDeletionRetryPolicy` という名前を導入しながら、定義も inventory 行も持たせていないことを指摘した（AC-66 が `AppliedOperationStore` について禁じた「名前だけが宙に浮く」状態そのもの）。

定義を書く段で、`55a5bb9` 時点の spec が **`rejected attempt`（120 日保持中の rejected な試行）** を数えると書いていることが実装と食い違うと分かった。実装 `domain/identity/services/accountDeletionRetryPolicy.ts` と `DistributedOperationStore.countTerminalSince` が数えるのは **terminal 行 = `completed` と `rejected` の両方**である。つまり「削除に成功した過去の試行」も上限 8 件の枠を消費する。これは偶然ではなく、しきい値の目的が「1 人の利用者が制御プレーンに残せる保持中の行数を抑える」ことだからで、成否は関係しない。

古い語彙は 4 か所にあった（`spec/usecases/identity.md` の手順とエラー表、`spec/testcases/identity/deleteAccount.md`、`spec/inventory/test.md` の TC 行）。

### Decision

**`AccountDeletionRetryPolicy` の定義を `spec/domains/identity.md` の `### ドメインサービス` に既存 3 サービスと同じ様式で置き（`spec/inventory/domain.md` に `DOM-identity-063` を採番）、あわせて `rejected attempt` の語彙を「保持中の terminal 行（`completed` / `rejected`）」へ spec 全体でそろえる。**

語彙の置換は本 PR がその名前を導入した箇所（`spec/database/index.md`）に閉じず、**同じ数え方を語る 4 か所すべて**へ及ぼす。

### 検討した代替案

- **定義だけ書き、古い語彙は SYNC-27 と同じく「全域語彙の整合」としてスコープ外へ送る**: 本 PR は `ExternalServiceError` について実際にそうしている（`PasswordHasher` / `SecureTokenGenerator` の 2 件を Phase 5 へ）ので、一貫性の観点では検討に値した。**採らない理由は、2 つが同型でないこと。** `ExternalServiceError` の残置は**未実装ドメイン**（conversion / integration / storage / job）に散っており、「どちらのコードへ写すか」の判定にそのドメインのアダプター実装という**まだ存在しない裏づけ**が要る。`rejected attempt` の 4 か所は**実装済みの 1 つの振る舞い**を指しており、裏づけは `accountDeletionRetryPolicy.ts` の 1 ファイルで完結する。判定に必要な情報が全部あるものを「全域語彙」の名目で先送りすると、次の読者が同じ調査をやり直す
- **`rejected attempt` を残し、それが両 state を含む旨を注記する**: 語が事実に反したまま脚注で打ち消す形になり、読者は必ず本文を先に読む。しかも `spec/testcases/` の期待結果欄は 1 文なので脚注を置く場所が無い
- **上限の意味を「拒否された試行の再試行制限」と読み替えて実装を変える**: spec を実装に合わせるのではなく実装を変える向きで、本 PR のスコープ外。かつ制御プレーンの行数を抑えるという設計目的（[ADR 044](../adr/044-business-thresholds-in-domain.md) がドメインへ置いたしきい値）から見て、成功した削除を枠外にする合理性が無い

### Consequences

- 良い点: `grep -rn "rejected attempt" spec/` が 0 件になり、「8 件の上限が何を数えるか」を spec のどこから読んでも同じ答えになる
- 良い点: しきい値と窓の正典がドメインサービス 1 か所に集まり、`DistributedOperationStore` 側は「件数の観測だけをする」という ADR 044 の分担が台帳（`DOM-identity-063`）からも読める
- トレードオフ: 利用者から見ると「削除を 8 回**成功**させたら 9 回目が 120 日間できない」という直感に反する挙動が spec に明記されることになる。挙動自体は既存で、本 ADR はそれを可読にしただけだが、UX 上の是非は別途問われうる（現状 P-25 にこの上限の説明は無い）
- トレードオフ: `ExternalServiceError` は先送りしたまま `rejected attempt` は今直す、という非対称が残る。上の理由（裏づけが揃っているか）で線を引いた旨をここに記録して補う

## ADR-032: 乖離台帳の行番号は振り直さず、冒頭で as-of commit を宣言する

### Status

Proposed（レビュー R1 の M-19 / M-56 / M-60、U10 で判断）

### Context

`.thread/14/research.md` / `research-2.md` は本 Issue では調査の足場ではなく**成果物**である（plan.md「前提: 乖離項目の台帳」）。70 件の乖離台帳そのもので、AC-1〜69 の由来欄とステップの「台帳 ID」欄が SYNC ID で恒久参照している。

レビュー R1（`general:B-002`）は、両ファイルが「現在の spec / 現在の実装は…」という**現在形**で書かれ、`file:line` アンカーを **254 本**持つのに、それがどの commit 基準なのか宣言していないことを指摘した。要修正 59 件は既に反映済みなので、現在形の記述はほぼ全件 `HEAD` では偽であり、行番号もドリフト済みである（実測で確認）。

### Decision

**両ファイルの冒頭に as-of `55a5bb9` の宣言を 1 段落置き、本文の現在形も 254 本の行番号も一切振り直さない。** 読み方（`git show 55a5bb9:<path>` で当たること）と、振り直さない理由（基準 commit を固定するほうが以降の変更に対して安定する）を宣言に含める。

あわせて U10 では**台帳の再調査をしない**。修正は引用ミス（M-18 / M-58）・件数（M-51 / M-52 / M-53 / M-54）・作業経緯の残置（M-55 / M-56 / M-57 / M-60）に限る。

### 検討した代替案

- **行番号を `HEAD` に合わせて振り直す**: 254 本の書き換えで、しかも**本 PR がマージされた時点で再び古くなる**。台帳が参照するのは「乖離があった状態」であり、それを直した後の行番号を指しても意味を成さない。引用文（改訂前の spec の文言）と行番号の対応も壊れる
- **現在形を過去形へ書き換える**: 「〜だった」に直せば as-of 宣言なしで整合するが、本文全域の文体変更になり、しかも `spec/index.md` が正典から排している「以前は〜だった」の語り口（M-47 で spec 側から 3 か所削ったもの）を作業成果物側に増やすことになる。台帳の役割は「この時点でこうだった」を記録することなので、**基準時刻を 1 か所で宣言して現在形を保つ**ほうが素直
- **台帳を `HEAD` 基準で再調査する**: 台帳の全数が本 Issue で閉じた後に「乖離が無い」ことを確認し直す作業で、AC の由来欄が指す SYNC ID の意味（何を直したのか）が消える

### Consequences

- 良い点: 台帳が「`55a5bb9` の状態のスナップショット」として自己完結し、`HEAD` が動いても記述の真偽が変わらない。SYNC ID からの恒久参照が壊れない
- 良い点: 引用文・行番号・判定理由の三者が同じ commit で一貫するので、後から判断を再検討する人が根拠へ確実に辿り着ける
- トレードオフ: 台帳を読むには `git show 55a5bb9:<path>` という一手間が要る。`55a5bb9` は `origin/main`（PR #17 マージ後）なので消えることはないが、squash merge 等で参照が失われた場合に備え、宣言では commit hash とその意味（PR #17 / Issue #2 マージ済み）を併記している
- トレードオフ: `.thread/14/` から `spec/` への相対リンク約 50 本は解決しないままである（M-50 は wont-fix）。これも「引用をそのまま残す」という同じ方針の帰結で、機械的に直すと引用と本文の一致が崩れる

## ADR-033: 生成経路を持たない表示語彙 `failed` は落とさず広げず、帰属を明記して決定を Phase 5 へ送る

### Status

Proposed（レビュー R2 の M-70、V5 / V9 で判断）

### Context

`spec/presentation/index.md` は 202 operation 系列（`deleteAccount` / `disconnectIntegration`）の状態を `accepted` / `running` / `completed` / `rejected` / `failed` の 5 値として P-25 の表示要求に挙げていた。ところが実測すると、この 5 値は**単一の語彙ではなかった**。

- `running` / `completed` / `rejected` — `application/ports/distributedOperationStore.ts` の `DistributedOperationState`、`spec/database/index.md` の `distributed_operations.state` の CHECK、`spec/domains/index.md` に一貫する 3 値。`getAccountDeletionStatus.ts` は `operation.state` をそのまま返す
- `accepted` — 202 応答が名乗る転送境界の status。operation record には現れない
- `failed` — **どちらの語彙にも属さない**。manifest header の state 集合にも無く、`deleteAccount` の手順にこの状態へ移す遷移が無い

同型の欠落が `spec/inventory/frontend.md` の `PAGE-p23-003`（`disconnectIntegration` の poll）にもある（`retrying` はどの語彙にも無く、`accepted` が欠けている）。

### Decision

**`failed` を状態直和から落とさず、`distributed_operations.state` の CHECK も 4 値へ広げない。本 PR がやるのは語彙の帰属の明記までで、生成経路の決定は Phase 5 の起票（スコープ節 16.）へ送る。**

`spec/presentation/index.md` の該当段落と `PAGE-p25-003` / `PAGE-p25-004` に、(a) `running` / `completed` / `rejected` は `distributed_operations.state` の 3 値そのもの、(b) `accepted` は 202 応答の転送 status、(c) `rejected` が P-25 の状態直和の「実行不可」に着くこと、(d) `failed` は表示語彙であって**そこへ移す遷移を定めた箇所が本設計に無い**こと、を書く。

### 検討した代替案

- **`failed` を落として 4 値にする**: 表示要求が実装と CHECK に一致し、機械検査が通るようになる。しかし [ADR 046](../adr/046-port-contract-divergence.md) が禁じる「実装の縮退を写して spec を狭める」向きそのものである。`failed` は「再試行不能と確定した」という**意味のある区別**を要求しており、それを消すのは表示の要件を落とす設計変更で、ドキュメント同期の作業ではない
- **CHECK を 4 値へ広げ、`deleteAccount` の手順に遷移を書く**: spec の内部整合は取れる。しかし遷移の設計（どの失敗を再試行不能と確定させるか、recovery Cron との関係）が本設計に存在しないので、**実装にも spec にも無い遷移を spec が新設する**ことになる。これは AC-63（振る舞いを変えない最小の同期）の趣旨から外れ、しかも `distributed_operations` の recovery（Phase 5 の 6.）と同じ判断面にある
- **どちらかに倒すことを本 PR で決める**: 判断材料（recovery Cron の設計、`disconnectIntegration` 側の `retrying`）が本 Issue のスコープ外に散っており、`deleteAccount` だけを見て決めると 202 operation 系列の 2 つ目で覆る。`spec/presentation/index.md` が両者を同じ系列として並記している以上、**まとめて決める**のが安い

### Consequences

- 良い点: 「どちらが正か」の判断を読者に押し付けず、**帰属が不明な語彙が 1 つある**という事実そのものが正典に書かれる。次に読む人が同じ調査をやり直さない
- 良い点: spec を狭めも広げもしないので、Phase 5 の決定がどちらへ倒れても本 PR の記述は前提として生き残る
- トレードオフ: `spec/presentation/index.md` に「本設計に無い」と書かれた語彙が残る。正典に不完全性を明記する形なので、Phase 5 の起票（スコープ節 16.）が落ちると宙に浮く。起票が唯一の受け皿である点は M-28 / M-70 と同じ扱い
- トレードオフ: `PAGE-p23-003`（`retrying`）は本 PR では触っていない。同型なので同じ Issue で扱う旨を起票骨子に含めた

## ADR-034: ADP ID と適合ケースの対応を追う命名規約は、ADR 026 から引かず ADR 052 自身の決定として立てる

### Status

Proposed（レビュー R2 の M-62、V1 で判断）

### Context

[ADR 052](../adr/052-adapter-inventory-granularity.md) は「適合ケースには行を採番せず、ケースと ADP ID の対応は命名規約で追う」と決めた。その規約を本 PR は 2 点で誤って書いていた。

1. **追跡手段を `describe` 名と書いた。** 実測は逆で、`describe` は全 34 本が `` `Xxx conformance [${backendName}]` `` 形式（ADP ID を含むものは **0 本**）、ADP ID を名乗るのは `it` 名で **166 本**。同じ誤りが `spec/inventory/adapter.md` のヘッダーと `spec/adr/index.md` の索引にも波及していた
2. **その規約を [ADR 026](../adr/026-port-contract-and-conformance.md) の決定として引用した。** 026 の決定 2 が定めるのは `describeXxxContract(name, makeBackend)` という**スイート関数名**の形だけで、ID 命名規約も ADP ID も出てこない

誤帰属の発生源は 1 点目と同じ語である。`describeXxxContract` という関数名の `describe` を「`describe` ブロック名の規約」と読み違え、その規約の出典として 026 を引いた。

### Decision

- **文言を「ケース名（`it` の第 1 引数）の先頭に ADP ID を置く」へ改める。** `describe` はスイート名（ポート群と backend 名）だけを名乗り、ポート群の範囲はファイル冒頭 JSDoc が示す
- **ID 命名規約は ADR 052 自身の決定として立てる。** 052 の前提節から 026 に引けるのは「契約の正本がポート定義にあり、検証が共有適合スイートであること」までで、**ADP 行と適合ケースの対応をどう追うかは 026 が決めていない**旨を前提節に明記する

`describe` 名へコードを付け替える向きは採らない。

### 検討した代替案

- **コードを規約に合わせる（`describe` 名へ ADP ID を移す）**: 文書を触らずに済む。しかし 34 本の `describe` と 166 本の `it` を書き換えることになり、コード差分が桁違いに膨らんで AC-63（振る舞いを変えない最小の同期）の趣旨から外れる。しかも `describe` は 1 ポート群に 1 本なので、1 ケース = 1 メソッドの対応を `describe` では表せない — 規約として成立しない
- **ADR 026 に ID 命名規約を追記する**: 出典の辻褄は合う。しかし 026 は本 PR の対象外の既存 ADR で、その決定節を後から広げると前提依存マップ全体の再確認が要る（Phase 5 の 12. で ADR 048 について同じ判断をした）。新しい決定は新しい ADR が持つのが素直
- **「`describe` / `it` 名」と両論併記のまま残す**: `.thread/14/plan.md:215` が実際にこの形で、事実として偽ではない。しかし読み手は「どちらに書けばよいか」を規約から決められない。規約は 1 つの形を指す

### Consequences

- 良い点: 規約が実体と一致し、`grep -o "ADP-[a-z]*-[0-9]*"` による台帳 → スイートの到達性検査が意味を持つ
- 良い点: 052 の前提が「026 から引ける範囲」に閉じるので、026 を読み直しても矛盾が出ない
- トレードオフ: 052 が持つ決定が 1 つ増える。ADR 1 本あたりの決定数は増やさないほうがよいが、命名規約は「適合ケースに行を採番しない」の**代償として要る**追跡手段なので、同じ ADR に置くほうが読める
- 副産物: 「本 PR が新設した規約を本 PR 自身が守っていない」という形の欠陥が、R1 の M-11 / M-17、R2 の M-62 / M-68 と 4 回続いた。新しい規約を立てる作業には**その規約による自己検査**を同じ単位に入れる、という運用上の教訓が残る

## ADR-035: 適合ケース名の ADP ID 連記は後続を短縮せず全形で書く

### Status

Proposed（レビュー R2 の M-71 / M-72、V7 / V1 で判断）

### Context

**ADR-029**（本ファイル）は 1 ケースが複数のポートメソッドを拘束するときの ID 連記を認めた。その表記を `ADP-note-055/056` のように**後続を数字だけへ短縮する**形で書いたところ、`ADP-note-056` が `grep -rn "ADP-note-056" packages/` で **0 件**になった。本 PR が新規採番した行なので、「採番したのにスイートのどこからも名乗られない ID」— M-11 が問題にした状態そのもの — が 1 本残っていた（M-71）。

同じ問題の裏返しが `ADP-identity-007` にもあった。本 PR が `spec/inventory/adapter.md` の `reserve` 行へ足した契約（`releasing` の鍵は奪えない）を拘束する唯一のケースが `ADP-identity-041` だけを名乗り、`007` を名乗る 4 本はいずれも `releasing` を扱わない（M-72）。

### Decision

**連記は ID を省略せず全形で書く**（`ADP-note-055/ADP-note-056`、`ADP-identity-041/ADP-identity-007`）。ヘッダーコメントの範囲表記も同じ（`ADP-note-028..034, ADP-note-055, ADP-note-056`）。

`ADP-identity-041/ADP-identity-007` の連記は ADR-029 が `041/009` を認めたのと同じ根拠 — 主張の中身が `beginRelease`（041）と `reserve`（007）の**協調**であり、片方だけを名乗ると主張の半分が台帳から見えなくなる。

### 検討した代替案

- **短縮を許し、検査側を「連記を分解する」正規表現へ直す**: コードを触らずに済む。しかし到達性の担保が**検査コマンドの精巧さ**に移り、`grep` を素朴に打った人には見えないままになる。ID は「素朴に grep して当たる」ことが値打ちで、そこを条件付きにすると識別子としての性質が落ちる
- **連記をやめて代表 1 本にし、残りは台帳側の要点欄で読ませる**: 表記が単純になる。しかし ADR-029 が退けた「名乗られない ID」がそのまま戻る
- **既存の短縮連記も本 PR で全形化する**: 実測で `it` 名の短縮連記は **31 ケース**あり、そのうち**単体 grep で到達不能な ID は 20 本**。全形化は文字列の置換だけなので危険は無いが、本 PR が触っていない 15 ファイルへコード差分が広がる。**「そのケースに触れた回で全形化する」規則として [ADR 052](../adr/052-adapter-inventory-granularity.md) の影響節に記録**し、本 PR では V7 が触る 2 ケースと、本 PR がこの回で書き換えたヘッダーコメント 5 行（`authTokenRepository` / `accountDeletionManifestStore` / `objectStorage` / `scopeCleanupAdmissionStore` / `signInOAuthClient`）だけを全形にした。ヘッダーの全形化で `ADP-identity-034` が単体 grep に当たるようになり、到達不能 ID は `it` 名由来の 20 本だけになる

### Consequences

- 良い点: **本 PR が採番した 8 ADP ID**（`ADP-common-040,041` / `ADP-identity-039〜041` / `ADP-note-055,056` / `ADP-storage-024`）と `ADP-identity-007` が、いずれも単体の `grep` で適合スイートから到達できる（実測で確認）
- トレードオフ: `it` 名が長くなる。1 ケースあたり 12 文字前後で、ケース名の可読性より ID の到達性を採った
- トレードオフ: 既存の短縮連記 31 ケース / 到達不能 20 ID はそのまま残る。ADR 052 の影響節に規則として書いたので、次に触る回で解消していく漸進的な返済になる

## ADR-036: ADR 057 の追随の軸を「ユースケースの失敗経路」へ広げ、行の同一性を「ユースケース × 条件」で定める

### Status

Proposed（レビュー R2 の M-68、V6 で判断）

### Context

本 PR が新設した [ADR 057](../adr/057-manual-test-followthrough.md) は、`spec/manual-tests/` の `### ユースケースエラーケース対応表` の軸を「**`spec/usecases/*.md` のエラーケース表の行と 1 対 1**」と書いていた。その軸で読むと、同じ表に既に載っている 2 行（`verifyEmail` の一時障害、`getUsageSnapshot` の取得の失敗）が説明できない。どちらも `spec/scenario/` が異常系として書いた失敗だが、usecase のエラーケース表には現れないからである。

さらに本 PR は usecase のエラーケースを 10 行以上増やしながら、対応表には 1 行しか足していなかった（M-68）。増やした側の一部（`recalculateStorageUsage` の `InsufficientRole`、`addPasswordIdentity` の 3 行）は**新しい条件**だが、一部（散文から表への組み替え、エラー型の改名）は**同じ失敗の書き直し**であり、機械的に「増えた行数だけ足す」と表が水増しされる。

### Decision

- **追随の軸を「usecase のエラーケース表と 1 対 1」から「ユースケースの失敗経路」へ広げる。** 本文（`spec/scenario/`）が異常系として書き usecase のエラーケース表に現れない失敗も、同じ表に載せる。手作業で再現できないものは既存様式どおり `対象外` ＋ 理由 1 行で残し、TC は足さない
- **行の同一性は「ユースケース × 条件」で定める。** 言い換え・エラー型の改名・散文から表への組み替えは条件を変えないので「増えた」に当たらず、行を足さない

### 検討した代替案

- **既存の 2 行（`verifyEmail` の一時障害 / `getUsageSnapshot` の取得の失敗）を削って軸を守る**: ADR 057 の記述をそのままにできる。しかし [ADR 046](../adr/046-port-contract-divergence.md) の「実装が未実装の側で spec を狭めない」と同じ向きで、**手順書のカバレッジを落とす**。しかも一時障害の行は同じ PR が AC-30 の判断として明示的に足したもので、自分で足した行を軸に合わないから消すのは順序が逆
- **軸は変えず、載らない失敗は `### 観点チェックリスト` 側で拾う**: 表の役割分担は保たれる。しかし観点チェックリストの軸は**テスト観点**（入力バリデーション / 境界値 / 認証・権限 / 操作の中断・逸脱）であって、そこに「一時障害」を置く観点が無い。無理に置くと今度は観点表の軸が壊れる
- **行の同一性を「エラーコード」で定める**: 機械的に数えられる。しかしエラー型の改名（`ExternalServiceError` → `ExternalApiError`）で行が増えたことになり、同じ失敗が 2 行並ぶ。手順書の読者が判定するのは条件であってコード名ではない

### Consequences

- 良い点: 表に載っている全行が同じ軸で説明でき、「なぜこの行があるのか」を読者が判定できる
- 良い点: 追随の要否が「条件が増えたか」の 1 問に落ちるので、レビューでの判定が安定する。R1 の M-17 → R2 の M-68 と 2 ラウンド続いた「ADR 057 を新設した PR が ADR 057 を破る」形の再発を、判定基準の側から塞ぐ
- トレードオフ: `対象外` の行が増える。手作業で再現できない失敗が表に並ぶことになるが、**理由が 1 行あるので「未着手」と読まれない**。TC 数は増えないので `spec/manual-tests/index.md` の集計は動かない
- トレードオフ: 「条件が同じか」の判定に人の読みが要る。エラーコードで数えるより曖昧だが、表の目的（手で確かめる手順の網羅）に対しては条件のほうが正しい単位

## ADR-037: 台帳 ID を名乗るのは適合ケースだけで、TC ID とユースケース実装の UC ID は名乗りを規約にしない

### Status

Proposed（レビュー R3 の usecase:W-001 / W-002、M-94 で判断）

### Context

本 PR は `spec/inventory/test.md` に TC 行を 32 行、`spec/inventory/usecase.md` に UC 行を 3 行採番した。そのうちコードから ID で辿れるのは TC が 4 行（`TC-identity-332`〜`335`。R2 の M-87 が `it` 名に名乗らせた）、UC が 1 本（`UC-identity-022`。R2 の M-67 が JSDoc に足した）だけである。残りは `it` 名にも JSDoc にも ID が無い。

一方 ADP ID は事情が違う。[ADR 052](../adr/052-adapter-inventory-granularity.md) は `spec/inventory/adapter.md` を「1 行 = 1 ポートメソッド」の生成物と定め、適合ケースには行を採番しないと決めた。**行を持たないケースと行を持つメソッドを結ぶ手段が `it` 名しか無い**ので、そこでは名乗りが唯一の追跡手段になる。

TC と UC にはその事情が無い。TC 行は `spec/testcases/{domain}/{usecase}.md` の 1 行と 1 対 1 で、定義場所欄がファイルを名指しする。UC 行は「1 ユースケース = 1 テストケースファイル = 1 UC 行」の不変（AC-64）で `spec/usecases/{domain}.md` の節と 1 対 1 に結ばれ、実装ファイル名がユースケース名そのものである。どちらも ID を名乗らせなくても台帳から辿れる。

### Decision

- **ID の名乗りを規約とするのは適合ケース（`it` 名の ADP ID）だけ**とする。TC ID を `it` 名に、UC ID をユースケース実装の JSDoc に書くことは**推奨するが要求しない**
- 既に名乗っているもの（`TC-identity-332`〜`335`、`UC-identity-001` ほか identity の application 19 ファイル、`UC-identity-022`）は**外さない**。名乗り自体は害が無く、外すと台帳からの到達性が減る
- したがって「同じ台帳の中で名乗る行と名乗らない行が混在する」状態は**規約どおりであって欠陥ではない**。この段落が、混在の理由を求める次の読み手に対する答えになる

### 検討した代替案

- **全 TC / 全 UC に名乗らせる**: 到達性が最大になる。しかし本 PR の残り 28 TC ＋ 2 UC のために `it` 名と JSDoc を書き換える差分が増え、しかも既存 2400 行超の TC には掛からないので、**新しい非対称（本 PR の採番分だけが名乗る）を別の場所に作り直す**ことになる。全数に掛けるなら 2440 行分の作業で、ドキュメント同期の PR の仕事ではない
- **名乗りを一律に禁じ、`TC-identity-332`〜`335` と `UC-identity-022` から ID を外す**: 混在が消える。しかし `AvatarUrl` の契約を拘束するテストが台帳から辿れなくなり、R2 の M-87 が閉じた欠落が戻る。**規約を揃えるために到達性を捨てる向きは採らない**
- **ADR 052 の TC の節に「TC ID は `it` 名で追わない」と書く**: 規約としては一番はっきりする。しかし 052 は `spec/adr/` に昇格済みで、その決定は「採番の位置」と「ADP ID の名乗り」に閉じている。名乗らせ**ない**ことを正典に書くと、後のスライスが `it` 名に ID を足す判断を規約違反と読む。**推奨はするが要求しない**という強さは正典より本ファイル側に置くのが正しい

### Consequences

- 良い点: 「なぜ 32 行のうち 4 行だけが名乗るのか」に答えが付き、次の実装者がどちらに倣うかで迷わない
- 良い点: ADP ID の名乗りが「唯一の追跡手段だから要求される」という**理由つきの規約**として残り、TC / UC へ機械的に横展開されない
- トレードオフ: TC / UC の台帳 → コードの到達性は `grep` 一発では得られず、テストケースファイル名・ユースケース名を経由する 2 段になる。台帳の定義場所欄がその経路を持っているので断絶はしない
- トレードオフ: 名乗る / 名乗らないがファイルごとに分かれるので、`grep -c "TC-"` のような一括計数はコード側では意味を持たない。計数の正典は台帳側だけになる

## ADR-038: 台帳の DOM 行 ↔ ADP 行の非対称は、片側の主張が本文に由来するときだけそろえる

### Status

Proposed（レビュー R3 の domain:W-001 / inventory:W-001、M-92 / M-98 / M-99 で判断）

### Context

R2 の ADR（M-79 のトリアージ）は「同じポートメソッドを指す DOM 行と ADP 行が食い違うなら薄い側へ 1 句足す」という向きで 3 組を直した。R3 の実測では、`origin/main` で要点欄が一字一句同じで HEAD では食い違う組が **11 組**あり、直した 3 組を除く 8 組が同じ形で残っている。加えて本 PR が**同時に新設した** `DOM-note-071/072` ↔ `ADP-note-055/056` の 2 組も 1 句ずれていた。

「薄い側へ足す」を機械的に当てると、**本文に書かれていない主張を台帳へ書き足す**ことになる組がある。`ObjectStorage.put` の「既存 key は上書きする」がそれで、`spec/domains/storage.md` の `ObjectStorage` 節にその記述は無い。これは `PAGE-p21-001/002` で起きたのと同じ「台帳が本文を追い越す」形（R3 の inventory:W-004）で、向きが逆の同じ欠陥である。

### Decision

**片側にしかない主張について、その主張が本文（`spec/domains/` の interface・説明段落）に由来するかで決める。**

- **由来する**なら薄い側へ 1 句足す。本 PR では `ObjectStorage.get` の「未知の key では null を返す」（interface が `Promise<ObjectBody | null>` と型で書いている）、`NoteRouteFanOutReader.listByCreatedBy` / `listByScope` の「`tombstone` は unspecified」（`spec/domains/note.md` の説明段落が**アダプター向けに**書いている）、`redactAuthor` の「行が変わったかを返す」（interface の戻り値。DOM 2 行）の計 5 行
- **由来しない**なら足さず、そのまま残す。書き足せば台帳が本文を追い越し、落とせば spec を狭める。**どちらの向きも採らず、本文を直すかどうかの判断を持つスライスへ渡す**
- 言い換えの差（`上限超過は` / `501 件目からは`）と、アダプター実装者だけに向いた注記（`IdentityRepository.insert` の「DB 側に一意制約を置くのは自由だが契約としては要求しない」）は**非対称ではない**。前者は同じ主張、後者は `adapter.md` にあることが正しい

### 検討した代替案

- **11 組すべてを機械的にそろえる**: 一貫して見える。しかし `ObjectStorage.put` の上書き契約のように本文に無い主張を DOM 行へ運ぶことになり、`spec/inventory/` のヘッダーが宣言する「本文からの生成物」という性質が崩れる。R3 が inventory:W-004 として指摘した欠陥を、別の 1 行で作り直す
- **ADR 052 に「DOM 行と ADP 行は同文であること」を不変として書き足す**: 検査が機械化できる。しかし `IdentityRepository.insert` のようにアダプター側だけが持つべき注記が書けなくなり、`adapter.md` の情報量が落ちる。M-79 のトリアージが「052 に例外規定を足す案は採らない」と決めたのと同じ理由で、直近に新設した ADR の再改訂も重ねない
- **本文（`spec/domains/storage.md`）に `put` の上書き契約を書き足す**: 台帳の非対称も同時に消える。しかし本 PR は**ドキュメント同期であって契約の拡張ではない**。上書き契約は実装の振る舞いから読めるが、それを設計として約束するかは `ObjectStorage` の責務の決定であり、[ADR 046](../adr/046-port-contract-divergence.md) が求める「正本のある側へ倒す」の正本がどちらにあるか自体が定まっていない

### Consequences

- 良い点: 台帳の対称化に上限が付き、「本文に無い主張を台帳に書く」向きへ滑らない
- 良い点: 残す非対称に理由が付くので、次のレビューが同じ 11 組を数え直しても判定が同じになる
- トレードオフ: 「本文に由来するか」の判定に本文の読みが要り、機械検査にはできない
- トレードオフ: `ObjectStorage.put` の上書き契約は台帳の ADP 行にだけある状態が残る。適合スイートがその主張を拘束しているので実害は小さいが、`spec/domains/storage.md` を読んだだけの実装者には見えない
