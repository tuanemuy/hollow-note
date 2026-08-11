# レビュー: Adapter / Infrastructure（PR #17）

## 前提と読み方

判定基準は `CLAUDE.md` / `spec/adr/021,023,024,025,026` / `spec/database/index.md` /
`docs/runtime_node.md` と `.thread/2/plan.md`（必要な箇所のみ `.thread/2/adr.md`）。
「設計からの逸脱」はこの範囲で判定し、**プロジェクトの意図的な縮退（plan.md の
「含まれないもの」「縮退」節に明記された 89 行 / 各項目）は指摘しない**。

以下は先に確認して**問題なし**と判断した不変条件（指摘の対象外）:

- `ScopeCleanupAdmissionStore` / `AccountDeletionManifestStore` の宣言集合への一般化は
  #1 の保証を緩めていない。適合スイート側が**列挙型の真部分集合**（`storage`/`usage`、
  `personalCleanup`/`authResidue`/`uniquenessRelease`）を渡し、かつ「宣言外の
  component / receipt を ack しても完了しない」を明示的に assert している
  （`scopeCleanupAdmissionStore.ts:100-103`, `accountDeletionManifestStore.ts:205-207`）。
  memory 側の既定値も全列挙（＝最も厳しい読み）なので、宣言を忘れた配備は
  「早く完了する」ではなく「止まる」に倒れる。設計どおり。
- `IdentityUniqueDirectory.beginRelease` の operationId 差し替えと
  `release` の `releasing` 削除拡張は、`updateProfile` が予約 ID
  (`…:handle:{新}`) と解放 ID (`…:release:handle:{旧}`) を構造的に別空間に置いて
  いるため、ロールバックの `release(予約ID)` が旧ハンドルの `releasing` 行を
  巻き込む事故は起きない。
- `compaction.ts:58-66` が `markCompleted`（manifest）と `markState("completed")`
  （control plane）を**同一 UoW** で書くので、`terminalPrune.prunePage` の
  `deleteTerminal` が `DISTRIBUTED_OPERATION_NOT_TERMINAL` で詰まる経路は無い。
  `pruneTerminal` が件数でなく `operationIds` を返す変更（ADR-026）も、
  同一トランザクションで両方を落とすという目的と整合している。
- OAuth の dev / production 分離は composition root（`di/serverNode.ts` の env
  スキーマ superRefine → `OAuthRuntimeConfig` の判別ユニオン → `createSignInOAuthClient`）
  に閉じており、request 経路は `RequestContainer.oauthDevMode` を読むだけで
  `process.env` を直読みしない。ルート loader / server fn の二重ガードもある。
- PKCE S256 は `deriveCodeChallengeS256` の 1 実装を両アダプターが共有し、
  `sha256(ascii(verifier))` の base64url（無パディング 43 文字）で RFC 7636 §4.2 どおり。
- Node runner の scope task tick は `createInProcessRelayTrigger` で直列化され、
  `unref()` 済み、`stop()` で `scopeTaskTrigger.stop()` を await している（重なり・
  停止時ドレインとも設計どおり）。
- Google アダプターのエラー翻訳は 4xx → `ValidationError("OAUTH_CODE_INVALID")`、
  transport/5xx/壊れた応答 → `SystemError(EXTERNAL_API_ERROR)` に閉じており、
  プロバイダー固有エラーはアプリケーション層に漏れない。アプリケーションレベルの
  OCC リトライデコレーターも追加されていない（CLAUDE.md どおり）。

---

## Adapter / Infrastructure

### Blockers

- **[B-001]** ADR-019 の決定的 EventId が、`OutboxRepository.save` の「同一 ID は同一行への upsert」という**契約に書かれていない実装特性**に依存している
  - 場所: `packages/core/src/application/ports/outboxRepository.ts:46-52`（契約）/ `packages/core/src/application/execution/eventId.ts:25-32`（依存側）/ `packages/core/src/adapters/memory/repositories/outboxRepository.ts:27-43`（upsert している唯一の実装）
  - 理由: `mintEventIdFor` は `continuationKey` からイベント ID を導出し、
    「応答喪失後の再実行が同じ outbox 行へ upsert されるので継続チェーンが 2 本に
    ならない」ことを正しさの根拠にしている（`eventId.ts` の JSDoc、AC-29 /
    TC-identity-096/101/105 の前提）。ところが `OutboxRepository.save` の JSDoc は
    「entity 変更と同一トランザクションで走ること」しか定めておらず、**既存 ID を
    再保存したときの振る舞いを一言も規定していない**。適合スイート
    (`adapters/conformance/outboxRepository.ts`) にも重複 ID のケースが 1 件も無い。
    固定しているのは `application/execution/__tests__/eventId.test.ts` の
    `h.backend.outbox` を直接覗くテスト 1 本だけで、これは memory バックエンド
    ローカルの検証であって契約ではない。
    `spec/adr/026` の「契約の正本はポート定義に置く／適合スイートだけが規定している
    振る舞いを残さない」に対して、**ポートにもスイートにも無い**という更に弱い状態。
    結果として #11 の D1 実装（ADR-019 本文が「同じ関数を使う」と名指ししている）が
    `INSERT` で書けば UNIQUE 違反でビジネストランザクションごと巻き戻り、
    `INSERT OR IGNORE` で書けば継続が黙って消えてチェーンが止まる。どちらも
    今あるテストでは一切検出できない。
    さらに memory の `save` は `processedAt` / `attempts` / `claimedAt` も
    リセットする（＝配送済み行の復活）。ADR-019 自身が
    「`「outbox 行の再利用」という挙動を JSDoc に書く必要がある`」と宿題にしていた
    項目が、実装では未着手のまま残っている。
  - 提案: (1) `OutboxRepository.save` の JSDoc に「同一 `id` の再保存は同一行への
    upsert であり、`processedAt` / `attempts` / claim をリセットして再配送可能に
    戻す。これは決定的 ID を持つ継続要求の再実行を 1 行に畳むための契約である」
    と明記する。(2) `describeOutboxRepositoryContract` に
    「同じ id で 2 回 `save` → 行は 1 件」「finalize で processed にした後に
    同じ id を `save` → 再び `claimPending` に現れる」の 2 ケースを足す。
    ADR-019 が backend 横断の不変条件を要求している以上、固定場所は
    memory ローカルテストではなく適合スイートであるべき。

- **[B-002]** scope task の**失敗経路に backoff が無い**ため、恒常的に throw するタスクが 1 秒間隔で無限に再実行される（`SCOPE_TASK_MAX_ATTEMPTS` が働かない）
  - 場所: `packages/core/src/application/workers/scopeTaskRunner.ts:100-115`（`catch` がログのみ）/ `apps/web/app/worker/node/runner.ts:185-187`（1 秒間隔の tick）/ `packages/core/src/application/ports/scopeTaskScheduler.ts:36-49`（契約側の想定）
  - 理由: `ScopeTaskScheduler` の JSDoc は
    「A turn that throws rolls the whole transaction back, **claim included**,
    and the row stays due」「`SCOPE_TASK_MAX_ATTEMPTS` に達したら `failed` に落ちる
    — one permanently failing target must not breed continuations forever」
    と、**claim を伴う駆動**を前提に安全弁を説明している。
    ところが実際の駆動 (`runDueScopeTasks`) は `claimDue` を呼ばず
    `ScopeTaskQueue.listDue` で列挙するだけで、`attempt` を進めるのは
    ユースケースが**明示的に** `backoff` を呼んだときだけ。ハンドラーが throw した
    場合は `catch` でログを出して次のタスクへ進み、行は `pending` / `attempt`
    据え置きのまま残る。次の tick（既定 1 秒）でまた同じ行が列挙され、また throw する。
    `attempt` が永遠に 0 のままなので `failed` にも落ちない。
    到達経路は現実的で、例えば `deleteFilesByOwner` は先頭で
    `ctx.cleanupAdmission.assertOwner()` を呼ぶ（`deleteFilesByOwner.ts:66`）。
    barrier receipt が prune 済み／別 operation に握られている状態でタスク行だけが
    残ると `ConflictError` を投げ続け、Node ランタイムが 1 Hz でエラーログを吐き続ける
    ホットループになる。ADR-005 の「一つの恒久的失敗が継続を無限に増やさない」
    という保証が、**その保証が必要な唯一の失敗モードで無効**という状態。
  - 提案: `runDueScopeTasks` の `catch` で、そのタスクの scope UoW を開いて
    `scopeTaskScheduler.backoff(task.kind, task.operationId, now)` を呼ぶ
    （backoff 自体の失敗はログに留める）。あるいは runner を
    `listDue` → scope UoW 内で `claimDue` → 失敗時 `backoff` の形にして、
    ポート JSDoc が説明している claim→settle モデルと実駆動を一致させる。
    後者なら [W-003] も同時に解消する。

### Warnings

- **[W-001]** `initNodeRuntime` が `??=` で「既に作られていたら黙って何もしない」ため、順序事故が **production への dev IdP 混入**として現れうる
  - 場所: `packages/core/src/application/di/serverNode.ts:193-198`（`initNodeRuntime`）/ `serverNode.ts:150-155`（env なしフォールバック）/ `packages/core/src/application/di/memoryRuntime.ts:119`（`oauth = { mode: "dev" }` が既定値）
  - 理由: `createMemoryRuntime()` の OAuth 既定値が **dev IdP** で、`initNodeRuntime`
    は `slot[RUNTIME_SYMBOL] ??= …` なので、`boot()` より前に何かが
    `memoryRuntime()` を触っていた場合（JSDoc 自身が「unit tests, tooling probes」
    を挙げている）、env は検証されるが**適用されない**。
    `NODE_ENV=production` + Google 資格情報あり の env は
    `readNodeServerEnv` を通ってしまうので、起動時ガードは発火せず、
    プロセスは dev IdP（誰でもサインインできる）で動く。
    plan.md のリスク節が「dev IdP が production に漏れないことは配線規律 +
    起動時ガードで守る」と名指ししている保証が、フェイルセーフでない既定値と
    サイレント no-op の組み合わせで 1 段薄くなっている。
    現状 `createNodeRequestContainer` / `createNodeWorkerContainer` は
    `boot()` の後でしか呼ばれないので実害は出ていないが、それは配置の偶然に依存している。
  - 提案: `initNodeRuntime` を「既にスロットが埋まっていたら throw する」に変える
    （env を反映できないまま起動するのは常にバグ）。あわせて
    `MemoryRuntimeOptions.oauth` の既定値を dev ではなく**明示必須**にし、
    env を持たない `createTestHarness` 側が明示的に `{ mode: "dev" }` を渡す形にすると、
    「安全でない側が既定」が構造的に消える。

- **[W-002]** Google アダプターの適合スイートは、資格情報がある環境でも exchange 系 3 本が**即 return して緑になる**（アサーション 0 本）
  - 場所: `packages/core/src/adapters/conformance/signInOAuthClient.ts:93-160`（`gated` ブロック内の `if (…kind === "live") return;` が 101 / 117 / 148 行）
  - 理由: `enabled: false`（資格情報なし）では `describe.skip` になるので意図どおり。
    問題は資格情報が**ある**場合で、harness の `exchange.kind` は `"live"` 固定
    (`adapters/oauth/__tests__/conformance.test.ts:45`) なので、3 本とも
    先頭の `return` で抜けて「PASS」と表示される。
    「実行されたが何も検証していない緑」はスキップより誤解を招く（skip なら
    レポートで欠落が見える、という本スイート自身の設計意図とも矛盾する）。
    AC-6 が求めているのは「登録行の存在と skip 条件がコードで確認できること」
    なので基準自体は満たしているが、テストとしては形骸化している。
  - 提案: `live` harness では exchange ブロック自体を `describe.skip` に倒す
    （`options.enabled === false || exchange.kind === "live"` を gate 条件にする）。
    そうすれば「Google の exchange は未検証」がレポート上ずっと可視になり、
    後で契約テスト用の fake token endpoint を足すときの受け皿にもなる。

- **[W-003]** `ScopeTaskScheduler.claimDue`（および `ScopeTask.payload` / `attempt`）が production 経路から一度も呼ばれず、適合スイート専用の契約になっている
  - 場所: `packages/core/src/application/ports/scopeTaskScheduler.ts:31-40, 58`（claim→settle を説明する JSDoc）/ `packages/core/src/application/workers/scopeTaskRunner.ts:86-89`（実駆動は `listDue` のみ）
  - 理由: `claimDue` の呼び出しは適合スイートと memory 実装にしか無い
    （`grep claimDue` の結果、production 呼び出し 0）。`DueScopeTask` は
    `{ scope, kind, operationId }` しか運ばず、ハンドラーは全情報を
    `operationId` から再構成するので、`schedule` が保存した `payload` も
    production では書き捨てになっている。
    plan.md AC-31 は「適合テスト専用のポートが本 Issue の対象範囲に残らない」ことを
    基準にしており、ポート単位では満たしているが、**メソッド単位で同じ状態**が残った。
    実害としては (a) 将来のバックエンドが誰も駆動しないメソッドの実装を強要される、
    (b) ポート JSDoc が説明する claim→settle モデルと実際の駆動が食い違い、
    契約の読み手が誤った前提（claim があるから失敗は自動で backoff される）を持つ
    — これが [B-002] の直接の原因になっている。
  - 提案: runner を `claimDue` 経由に寄せる（[B-002] の提案と同一）か、
    `claimDue` と `ScopeTask.payload`/`attempt` をポートから外して
    「列挙は `ScopeTaskQueue`、settle は `complete`/`backoff`/`schedule`」に
    契約を縮める。どちらでもよいが、**どちらか**にしないと契約と実駆動の乖離が固定化する。

- **[W-004]** `ObjectStorage` の checksum 契約が JSDoc と適合スイートで食い違い、`size` の「measured」アサーションが形骸化している
  - 場所: `packages/core/src/application/ports/objectStorage.ts:29-31`（"`put` returns the **measured** size and checksum"）/ `packages/core/src/adapters/conformance/objectStorage.ts:35-46, 63-71`
  - 理由: ポートは「計測した size と checksum を返す」と定めているのに、
    スイートは `ADP-storage-018: keeps a supplied checksum instead of recomputing it`
    で「呼び出し側が宣言した checksum をそのまま返す」ことを**契約として凍結**している。
    実際に checksum を計算するストア（R2 の `md5`/`sha256` ヘッダーを返す実装など）は
    この行で落ちる。しかも本 Issue の唯一の呼び出し元 `storeAvatar` は
    `checksum: null` を渡す（`storeAvatar.ts:94-98`）ので、この分岐は
    **production で一度も通らない未使用挙動**である。
    `spec/adr/026` §3「スイートが契約化するのは観測可能な結果だけ／
    バックエンドを足すたびにスイートを緩める交渉を発生させない」に反する。
    あわせて `ADP-storage-018/019` の「reports the **measured** size」は
    `meta.size === body.byteLength` の状態で `result.size === body.byteLength` を
    見ているだけなので、**宣言値をそのまま返すだけの実装でも通る**。
    「計測している」という契約は実質固定されていない。
  - 提案: (1) checksum の扱いを片方に寄せる。使わない分岐なら
    「keeps a supplied checksum」のケースを削り、ポートの記述も
    「`meta.checksum` は省略可、返す checksum は実装が保証する値」程度に緩める。
    (2) size のケースは `meta.size` に**わざと誤った値**（例: `0`）を入れて
    `result.size === body.byteLength` を assert する形にすると、
    「measured」が本当に固定される。

- **[W-005]** `storeAvatar` が barrier 検査より**先**に `objectStorage.put` するため、トランザクションが失敗すると回収経路の無い孤児オブジェクトが残る
  - 場所: `packages/core/src/application/storage/storeAvatar.ts:94-103`
  - 理由: `put` は UoW の外・`assertWritable()` / `assertActorWritable()` より前に走る。
    barrier 閉鎖後（`ACCOUNT_DELETING`）・actor lock 競合・OCC 失敗のいずれでも、
    バイト列だけが object store に残り `stored_files` 行は作られない。
    plan.md の縮退に記録された孤児（「アップロードしてプロフィールを保存せず離脱」）は
    **メタデータ行があるので** `sumSizeByOwner` に算入され `deleteFilesByOwner` で
    回収されるが、この経路の孤児は行が無いので**どの掃除にも掛からない**。
    アカウント削除後も無限に残る。plan.md がこの差を縮退として記録していないので、
    意図した縮退ではなく見落としと読める。
  - 提案: 最小の対処は「行が作れなかったときに `objectStorage.deleteMany([objectKey])`
    で巻き戻す」（`put` は冪等な上書きなので巻き戻しも冪等）。
    barrier だけ先に確認する軽い読み取りを入れて `put` 前に落とす手もあるが、
    OCC 失敗は残るので巻き戻しの方が確実。少なくとも縮退として記録すべき。

- **[W-006]** `deleteFilesByOwner` の "stalled" 経路は、**初回コマンド**ではタスク行が存在せず `backoff` が no-op になり、再駆動主体が消える
  - 場所: `packages/core/src/application/storage/deleteFilesByOwner.ts:90-101` / `packages/core/src/adapters/memory/repositories/scopeTaskScheduler.ts:78-82`（行が無ければ黙って return）
  - 理由: 初回の cleanup コマンドは `dispatchAccountDeletionCleanup` から
    `commandKey` 付きで直接呼ばれる（`cleanupDispatch.ts:45-52`）ので、
    この時点で `scheduled_tasks` に該当行は無い。
    ここで「対象は残っているが 1 件も消せなかった」に入ると
    `backoff(kind, operationId, now)` は対象行が無いため no-op になり、
    継続タスクも積まれず、`identity.accountDeletionDispatchContinued(cleanup)` は
    既に消費済みなので、**削除が誰にも再駆動されないまま running で止まる**。
    適合／ユースケーステスト側も、TC-storage-041 は検証前に明示的に
    `scopeTaskScheduler.schedule(...)` でタスク行を先に作っている
    (`__tests__/deleteFilesByOwner.test.ts:227-235) ので、この初回ケースは
    テストで守られていない。memory バックエンドでは同一トランザクション内で
    行が消えないため実際には到達しにくいが、`listByOwner` と `findById` が
    別クエリになる実バックエンドでは起こりうる。
  - 提案: "stalled" 経路を「行が無ければ `schedule` で backoff 相当の
    `dueAt` を持つ行を作る、あれば `backoff`」に統一する
    （`ScopeTaskScheduler` に `backoffOrSchedule` を足すか、
    ユースケース側で `schedule({ dueAt: now + base })` にフォールバックする）。
    あわせて「タスク行が無い状態での stalled」をテストに追加する。

- **[W-007]** Google の token endpoint 呼び出しにタイムアウトが無い
  - 場所: `packages/core/src/adapters/oauth/googleSignInOAuthClient.ts:117-125`
  - 理由: `fetch(TOKEN_ENDPOINT, { … })` に `signal` が無いので、
    プロバイダー側がハングするとリクエスト経路（`/auth/callback/$provider` の
    server function）がそのままぶら下がる。アダプターは「transport 失敗 →
    `SystemError(EXTERNAL_API_ERROR)`」に翻訳する設計になっているが、
    タイムアウトが無いとその翻訳に到達しない。外部サービス境界の
    デフォルト防御として欲しい。
  - 提案: `signal: AbortSignal.timeout(OAUTH_TOKEN_TIMEOUT_MS)`（10 秒程度）を足し、
    `AbortError` も既存の `unreachable(...)` に落とす。
    リトライは足さないでよい（認可コードは単回使用なので、
    ドライバーレベル再試行の対象ではない — CLAUDE.md の retry strategy とも整合）。

- **[W-008]** `identity_removal_receipts` の 30 日保持を回収する経路が配線されていない（`deleteExpired` が適合スイート専用）
  - 場所: `packages/core/src/application/ports/identityRemovalReceiptStore.ts:44-49` / `packages/core/src/application/di/types.ts:191-195`（`AuthStateTable`）/ `packages/core/src/application/di/memoryRuntime.ts:268-273`（`authStateSweeps`）
  - 理由: ポートは「30 days after the identity row is gone」の保持と
    `deleteExpired` の keyset sweep を契約に書いているが、
    `AuthStateTable` は `sessions` / `auth_tokens` / `login_attempts` /
    `oauth_flow_states` の 4 つのままで、新設テーブルが `authStateSweeps` に
    載っていない。`deleteExpired` の呼び出しは適合スイートにしか無い。
    `pruneExpiredAuthState` の cron 配線自体は #15 送りで plan.md の
    「含まれないもの」に入っているが、**掃除対象の登録**は本 Issue で
    ポートを新設した側の責務で、これを落とすと #15 が cron を足しても
    このテーブルだけ永久に残る。
  - 提案: `AuthStateTable` に `identity_removal_receipts` を足して
    `authStateSweeps` に `identityRemovalReceiptStore` を登録する
    （型が `Record<AuthStateTable, ExpirySweep>` なので追加漏れは型エラーで止まる）。
    #15 に引き継ぐなら plan.md 相当の記録に 1 行残す。

- **[W-009]** `/storage/$` が purpose を問わず**すべての**オブジェクトを無認証で配信する（`publicUrl` の契約より広い）
  - 場所: `apps/web/app/routes/storage.$.tsx:15-52` / `packages/core/src/application/ports/objectStorage.ts:33-35`
  - 理由: ポートは `publicUrl` について
    「Use it only for objects that really are public — today, avatars」と限定しているが、
    配信ルート側は `ObjectKey` の形式検査だけで `container.objectStorage.get(key)` を
    そのまま返す。`source` / `media` / `reference` / `artifact` も鍵さえ判れば読める。
    R2 配備では public bucket に置いたものだけが公開になるので、
    memory ランタイムの方が**モデルより広い**。
    現状 avatar 以外を置く経路が無いので実害は無く、鍵に UUIDv7 が入るため
    推測も現実的でないが、`storeUpload` / `storeMedia`（#6）が入った瞬間に
    非公開ファイルの無認証配信になる。
  - 提案: ルート側で `purpose` セグメント（`ObjectKey.build` が
    `{owner}/{purpose}/{fileId}` を作る）を見て `avatar` 以外を 404 にする。
    1 行で「公開なのは avatar だけ」という契約がコードで守られる。

- **[W-010]** runner 起動時のドレインがトリガーの直列化を迂回している
  - 場所: `apps/web/app/worker/node/runner.ts:174-178`
  - 理由: `start()` は `track(runScopeTaskTick())` で**直接**1 ラウンドを走らせるが、
    `scopeTaskTrigger` は同じ `runScopeTaskTick` を直列化する役目なので、
    起動直後に UoW commit 由来の `kick()` が来ると 2 ラウンドが並走しうる。
    ターン自体は冪等で、memory の `MemoryTransactionController` が
    トランザクションを直列化するので壊れはしないが、
    「at most one round in flight」という直後のコメント
    (`runner.ts:126-127`) の主張と食い違う。
  - 提案: `track(runScopeTaskTick())` を `scopeTaskTrigger.kick()` に置き換える。
    `stop()` は既に `scopeTaskTrigger.stop()` を await しているので、
    ドレイン漏れにもならず、主張とコードが一致する。

---

## カバレッジ

一覧 226 件 = 確認 95 件 + スキップ 131 件。

### 確認（95）

`apps/web/.env.example`,
`apps/web/app/components/dev/DevConsentForm/index.tsx`,
`apps/web/app/presentation/deletionTicket.ts`,
`apps/web/app/presentation/devOAuth.ts`,
`apps/web/app/routes/dev/-action.tsx`,
`apps/web/app/routes/dev/oauth/authorize.tsx`,
`apps/web/app/routes/storage.$.tsx`,
`apps/web/app/server.node.ts`,
`apps/web/app/worker/node/runner.ts`,
`docs/runtime_node.md`,
`packages/core/src/adapters/conformance/accountDeletionManifestStore.ts`,
`packages/core/src/adapters/conformance/appliedOperationStore.ts`,
`packages/core/src/adapters/conformance/authTokenRepository.ts`,
`packages/core/src/adapters/conformance/backend.ts`,
`packages/core/src/adapters/conformance/distributedOperationStore.ts`,
`packages/core/src/adapters/conformance/identityRemovalReceiptStore.ts`,
`packages/core/src/adapters/conformance/identityUniqueDirectory.ts`,
`packages/core/src/adapters/conformance/llmUsageRepository.ts`,
`packages/core/src/adapters/conformance/noteProjection.ts`,
`packages/core/src/adapters/conformance/objectStorage.ts`,
`packages/core/src/adapters/conformance/scopeCleanupAdmissionStore.ts`,
`packages/core/src/adapters/conformance/scopeTaskScheduler.ts`,
`packages/core/src/adapters/conformance/signInOAuthClient.ts`,
`packages/core/src/adapters/conformance/storageQuotaRepository.ts`,
`packages/core/src/adapters/conformance/storedFileRepository.ts`,
`packages/core/src/adapters/memory/__tests__/conformance.test.ts`,
`packages/core/src/adapters/memory/__tests__/conformanceBackend.ts`,
`packages/core/src/adapters/memory/globalUnitOfWork.ts`,
`packages/core/src/adapters/memory/objectStorage.ts`,
`packages/core/src/adapters/memory/repositories/accountDeletionManifestStore.ts`,
`packages/core/src/adapters/memory/repositories/appliedOperationStore.ts`,
`packages/core/src/adapters/memory/repositories/authTokenRepository.ts`,
`packages/core/src/adapters/memory/repositories/distributedOperationStore.ts`,
`packages/core/src/adapters/memory/repositories/identityRemovalReceiptStore.ts`,
`packages/core/src/adapters/memory/repositories/identityUniqueDirectory.ts`,
`packages/core/src/adapters/memory/repositories/llmUsageRepository.ts`,
`packages/core/src/adapters/memory/repositories/noteProjection.ts`,
`packages/core/src/adapters/memory/repositories/scopeCleanupAdmissionStore.ts`,
`packages/core/src/adapters/memory/repositories/scopeTaskScheduler.ts`,
`packages/core/src/adapters/memory/repositories/storageQuotaRepository.ts`,
`packages/core/src/adapters/memory/repositories/storedFileRepository.ts`,
`packages/core/src/adapters/memory/scopeTaskQueue.ts`,
`packages/core/src/adapters/memory/scopeUnitOfWork.ts`,
`packages/core/src/adapters/memory/store.ts`,
`packages/core/src/adapters/oauth/__tests__/conformance.test.ts`,
`packages/core/src/adapters/oauth/devSignInOAuthClient.ts`,
`packages/core/src/adapters/oauth/googleSignInOAuthClient.ts`,
`packages/core/src/adapters/oauth/pkce.ts`,
`packages/core/src/adapters/oauth/signInOAuthClient.ts`,
`packages/core/src/application/cleanup/participants.ts`,
`packages/core/src/application/cleanup/personalCleanup.ts`,
`packages/core/src/application/di/__tests__/serverNode.test.ts`,
`packages/core/src/application/di/memoryRuntime.ts`,
`packages/core/src/application/di/serverNode.ts`,
`packages/core/src/application/di/types.ts`,
`packages/core/src/application/execution/__tests__/eventId.test.ts`,
`packages/core/src/application/execution/eventId.ts`,
`packages/core/src/application/execution/unitOfWork.ts`,
`packages/core/src/application/identity/authResidueCleanup.ts`,
`packages/core/src/application/identity/continuations.ts`,
`packages/core/src/application/identity/deleteAccount/cleanupDispatch.ts`,
`packages/core/src/application/identity/deleteAccount/compaction.ts`,
`packages/core/src/application/identity/deleteAccount/finalize.ts`,
`packages/core/src/application/identity/deleteAccount/terminalPrune.ts`,
`packages/core/src/application/identity/identityRemovalRelease.ts`,
`packages/core/src/application/identity/uniqueness.ts`,
`packages/core/src/application/identity/updateProfile.ts`,
`packages/core/src/application/ports/accountDeletionManifestStore.ts`,
`packages/core/src/application/ports/appliedOperationStore.ts`,
`packages/core/src/application/ports/distributedOperationStore.ts`,
`packages/core/src/application/ports/identityRemovalReceiptStore.ts`,
`packages/core/src/application/ports/objectStorage.ts`,
`packages/core/src/application/ports/scopeCleanupAdmissionStore.ts`,
`packages/core/src/application/ports/scopeTaskQueue.ts`,
`packages/core/src/application/ports/scopeTaskScheduler.ts`,
`packages/core/src/application/ports/scopeTaskTrigger.ts`,
`packages/core/src/application/storage/__tests__/deleteFilesByOwner.test.ts`,
`packages/core/src/application/storage/deleteFiles.ts`,
`packages/core/src/application/storage/deleteFilesByOwner.ts`,
`packages/core/src/application/storage/deleteStoredObjects.ts`,
`packages/core/src/application/storage/storeAvatar.ts`,
`packages/core/src/application/usage/deleteQuota.ts`,
`packages/core/src/application/workers/eventRelayWorker.ts`,
`packages/core/src/application/workers/scopeTaskRunner.ts`,
`packages/core/src/application/workers/subscribers.ts`,
`packages/core/src/domain/common/event.ts`,
`packages/core/src/domain/identity/ports/authTokenRepository.ts`,
`packages/core/src/domain/identity/ports/identityUniqueDirectory.ts`,
`packages/core/src/domain/identity/ports/signInOAuthClient.ts`,
`packages/core/src/domain/note/ports/localNoteProjectionWriter.ts`,
`packages/core/src/domain/note/ports/publicNoteProjectionWriter.ts`,
`packages/core/src/domain/storage/ports/storedFileRepository.ts`,
`packages/core/src/domain/storage/valueObject.ts`,
`packages/core/src/domain/usage/ports/llmUsageRepository.ts`,
`packages/core/src/domain/usage/ports/storageQuotaRepository.ts`

### スキップ（131）

- `.thread/2/adr.md`, `.thread/2/plan.md`, `.thread/2/progress.md`, `.thread/2/steps.md`, `.thread/2/testing.md`（5）— 判定基準として参照した計画・記録ドキュメントで、成果物レビューの対象ではない
- `apps/web/app/components/auth/**`（10: OAuthButton, OAuthCallbackPanel, ResendVerificationForm×2, ResetPasswordPanel×2, SignInForm, SignUpForm, VerifyEmailPanel, schema.ts）— UI とミューテーション三層の担当で、アダプター／インフラの観点外
- `apps/web/app/components/layout/**`（4: AccountMenu×2, AppShell, SettingsTabs）— 同上
- `apps/web/app/components/settings/**`（15）— 同上
- `apps/web/app/presentation/__tests__/deletionTicket.test.ts`, `apps/web/app/presentation/__tests__/devOAuth.test.ts`（2）— 対応する実装モジュール側で契約を確認済み。テストのスタイル・構造は指摘対象外のため個別には開いていない
- `apps/web/app/presentation/errorDisplay.ts`, `apps/web/app/routeTree.gen.ts`, `apps/web/app/routes/__root.tsx`, `apps/web/app/routes/auth/-action.tsx`, `apps/web/app/routes/auth/callback.$provider.tsx`, `apps/web/app/routes/notes/index.tsx`, `apps/web/app/routes/reset-password.tsx`, `apps/web/app/routes/settings/{-action,auth,danger,profile,route,usage}.tsx`（13）— presentation / ルーティングの担当で、dev IdP・オブジェクト配信以外はアダプター観点外（生成物 `routeTree.gen.ts` を含む）
- `packages/core/src/application/identity/__tests__/**`（27。`authFlowHelpers.ts` / `deletionDriver.ts` / `deletionHarness.ts` を含む）— ユースケース層のテストで、アダプター契約の検証は適合スイート側を確認済み
- `packages/core/src/application/identity/{addPasswordIdentity,changePassword,checkHandleAvailability,completeOAuthCallback,completeOAuthSignIn}.ts`（5）— OAuth / パスワードのユースケース本体で、ポート契約の適合はポート定義側で確認済み
- `packages/core/src/application/identity/deleteAccount/{admission,authorRedaction,globalCleanup,index,input,manifestBuild}.ts`（6）— 削除オーケストレーションのユースケース本体。ポート搭載と継続駆動は `cleanupDispatch` / `compaction` / `finalize` / `terminalPrune` 側で確認済み
- `packages/core/src/application/identity/{eventDecoders,getAccountDeletionStatus,getProfile}.ts`（3）— デコーダー / 読み取りユースケースでアダプター観点外
- `packages/core/src/application/identity/{linkOAuthIdentity,listIdentities,removeIdentity,requestPasswordReset,resendVerificationEmail,resetPassword,signOut,signOutOtherSessions,startOAuthFlow}.ts`（9）— 同上（ユースケース層）
- `packages/core/src/application/identity/view.ts`, `packages/core/src/application/note/__tests__/createBlankNote.test.ts`（2）— DTO 射影 / 既存ユースケーステスト
- `packages/core/src/application/storage/__tests__/{deleteFiles,storeAvatar}.test.ts`（2）— ユースケーステスト
- `packages/core/src/application/storage/{eventDecoders,view}.ts`（2）— デコーダー / DTO
- `packages/core/src/application/usage/__tests__/**`（3）— ユースケーステスト
- `packages/core/src/application/usage/{getUsageSnapshot,recalculateStorageUsage,view}.ts`（3）— ユースケース / DTO
- `packages/core/src/application/workers/__tests__/{outboxPrune,scopeTaskRunner,subscribers}.test.ts`（3）— 対応する実装側で駆動経路を確認済み
- `packages/core/src/domain/identity/{__tests__/policies.test.ts,errorCode.ts}`（2）— ドメイン層
- `packages/core/src/domain/identity/services/accountDeletionRetryPolicy.ts`, `packages/core/src/domain/identity/valueObject.ts`（2）— ドメイン層
- `packages/core/src/domain/storage/{__tests__/storage.test.ts,errorCode.ts,events.ts,services/uploadValidationPolicy.ts,storedFile.ts}`（5）— ドメイン層
- `packages/core/src/domain/usage/{__tests__/quota.test.ts,__tests__/valueObject.test.ts,errorCode.ts,events.ts,llmUsage.ts,services/quotaEnforcement.ts,storageQuota.ts,valueObject.ts}`（8）— ドメイン層
