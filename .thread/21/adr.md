# ADR — Issue #21: identityRemovalRelease の TOCTOU とポート契約の拡張

## ADR-001: 恒久 claim の取り壊しを「観測した claim に対する条件付き」にする

### Context

`identityRemovalRelease` は Global UoW の中で解放の可否を判定し、UoW の外で `beginRelease` → `release` を走らせる。`beginRelease` の条件は「所有者が一致する `active` 行」だけなので、判定と実行のあいだに同じ利用者が張り直した claim も取り壊してしまう。

到達順序を詰めると、claim が `active` のあいだは再連携が `reserve` まで到達できない（`resolve` が持ち主を返し、`existingLinkId` / `signInLinkedUser` が identity 行の不在を見て `PROVIDER_ACCOUNT_RELEASE_PENDING` を投げる）。したがって現実の織り込みは「配送 A が解放を完了 → 本人が再連携 → 判定を先に済ませていた配送 B が `beginRelease` に到達」で、再配送ガード（identity 行の再確認）も `expectedUserId` も効かない。

選択肢:

1. `releaseActiveUniqueKey` の直前で `listByUserId` を読み直す — 窓を縮めるだけで閉じない（Issue 本文が明示）。
2. `beginRelease` を条件付きにし、呼び出し側が**判定より前に観測した** claim と一致するときだけ取り壊す。
3. 取り壊しを先に始める（`beginRelease` → 判定 → `abortRelease` で戻す）。`releasing` は `reserve` を弾くので判定中に再連携が割り込めない。
4. 受領（`identity_removal_receipt`）に予約行の operation ID を凍結し、解放時に照合する（ADR 038 の却下案）。
5. 2 と同じ条件付き取り壊しにしたうえで、観測を判定 UoW の**中**（`ctx.identityUniqueDirectory.resolveClaim`）で取る。`GlobalUnitOfWorkContext` は既に `identityUniqueDirectory` を公開しているので型としてそのまま書ける。

### Decision

2 を採る。`resolveClaim` で claim を観測し、`beginRelease` に `expectedClaimToken` を**必須で**渡す。無条件の取り壊しを型として表現できないようにし、呼び出し側が観測を省略できない形にする。

観測は解放判定 UoW の**前**に取る。`beginRelease` の直前で読むと、判定後に割り込んだ再連携の claim を観測してしまい CAS が素通りするため、この順序が正しさの本体になる。

- 3 を採らない: 新しい状態遷移（`releasing` → `active`）と新メソッドが要る。判定中にワーカーが落ちると `releasing` のまま固まり、`releasing` 行には TTL が無いので鍵が誰にも使えなくなる（再配送で回復はするが、回復経路が 1 本増える）。判定中の再連携は `PROVIDER_ACCOUNT_ALREADY_LINKED`（自分の鍵なのに）になり、既存の `PROVIDER_ACCOUNT_RELEASE_PENDING` の使い分けも崩れる。
- 4 を採らない: `removeIdentity` の UserId shard トランザクションから鍵 shard のディレクトリを読むことになり（shard をまたぐ読みを 1 トランザクションに持ち込む）、バックエンド固有の不透明値を 30 日保持の受領に永続化することになる。観測を 1 ワーカーターンの中に閉じ込める方が影響が小さい。この却下は本 ADR でも維持され、ADR 038 側の却下も生き続ける（本 ADR が更新するのは 038 の却下**理由**の側であって、却下判断そのものではない）。
- 5 を採らない（この案は実際に評価した）。まず正しさの比較: 観測を判定 UoW の前に取っても、観測が判定より**古い**方向にしかずれないので CAS は保守側（＝解放しない）に外れるだけで、誤って現行 claim を壊すことはない。逆に観測が判定より**後**だと割り込み後の claim を観測して CAS が素通りする。したがって「判定より前に取る」は安全な位置の集合であり、UoW 内観測はその中の 1 点にすぎず、正しさの強さは同じである。次に構造の比較: UoW 内観測は「順序を間違えようがない」という利点を持つが、`spec/usecases/identity.md#identity-uniqueness-の物理shard境界` が「User row と uniqueness shard を同一 transaction にしない」を設計の前提そのものとして置いており（`spec/platform/index.md` でもディレクトリは normalized key hash shard、User / Identity は UserId shard）、判定 UoW は receipt と identity 行を読む UserId shard 側のトランザクションである。そこに鍵 shard の読みを入れると、この Issue が前提に置く配備（#11 / #19）と最終基盤（D1 / DO）でそのまま成立しない設計になる。さらに D1 には対話型トランザクションが無いため、UoW 内に置いても真の直列化は得られず、構造的保証という利点自体が実基盤では消える。よって採らない。順序制約は AC-4 の注入テスト（判定 UoW のコミット直後に割り込む）で機械的に拘束し、目視レビューには委ねない。なお `GlobalUnitOfWorkContext.identityUniqueDirectory` は現在どのユースケースからも使われていない面であり、この shard 境界がその理由になっている（面そのものの整理は本 Issue のスコープ外）。

ADR 038 は「ポート契約の拡張は、ポート・アダプター・適合スイートに波及し、効果は変わらない」として当時これを見送っていた。前提が変わったのが今回の分岐点である — 単一プロセスでは判定コミットと `beginRelease` の窓がサブミリ秒なので application 側の判定 1 か所で足りたが、複数ワーカー / リモート DB 配備（#11 / #19）では窓が広がり、application 側の判定だけでは同じ効果が得られない。

ここで置き換わるのは **ADR 038 の却下理由のうち、「ポート・アダプター・適合スイートに波及する」というコストと「効果は変わらない」という判断**である。060 はまさにその波及（`resolveClaim` の追加・`expectedClaimToken` の必須化・適合ケースの追加）を引き受けたので、038 側の却下理由からはその 2 つを落とし、平面をまたぐ読みと 30 日保持の受領への永続化だけを残す（steps.md ステップ 12）。ADR 038 の却下案そのもの（受領に予約行の operation ID を凍結し、解放時に照合する ＝ 上の選択肢 4）は **060 でも却下のまま維持する** — 060 が採るのは「解放側が観測した不透明トークンで CAS する」という別の機構であり、凍結案を却下する理由（shard をまたぐ読みを 1 トランザクションに持ち込む / バックエンド固有の不透明値を 30 日保持の受領に永続化する）は今も有効だからである。`spec/adr/index.md` は廃止した判断を残さない方針なので、この有効な却下判断が canon から消えないよう、060 の「検討した代替案」にも同じ却下を書く（steps.md ステップ 12）。

### Consequences

- 良い点: 「identity 行はあるのに claim だけ消えた」状態への経路 1 が、配送の順序やワーカー数に依存せず閉じる。
- 良い点: 契約が「所有者の一致」から「claim の同一性」に上がるので、将来のバックエンド（D1 / DO）は etag / rowversion に自然に対応づけられる。
- トレードオフ: 解放判定のたびに directory の読みが 1 回増える（`keep` に倒れる再配送でも発生する）。単一行読みなので許容する。
- トレードオフ: 「観測を判定より前に取る」順序が正しさの条件として残る。コードコメントと本 ADR に加えて、**AC-4 の注入テストがこの順序を落とす形で拘束する**（割り込みを判定 UoW のコミット直後に置くので、誤順序の実装は割り込み後の新 claim を観測して CAS が一致し、claim を壊して落ちる）。
- `updateProfile`（旧 handle）と `deleteAccount/globalCleanup`（全鍵）は同じヘルパーを通るので契約変更には追随するが、観測と `beginRelease` が連続するため**窓は縮むだけで閉じない**（Issue 本文が退けた「読み直しは窓を縮めるだけ」と同じ形）。同一利用者の並行 `updateProfile` が同じ旧 handle を二重に解放しにくる列は守られない。「CAS の保護を受ける」とは言えないので、そう書かない。残存窓は plan.md のスコープ「含まれないもの」に記録する。
- CAS が外れたときは no-op（解放しない）で収束させ、エラーにしない。エラーにすると再配送が止まらず隔離までカウントが進む。

---

## ADR-002: 条件は `operationId` / `userVersion` ではなく不透明な `claimToken` にする

### Context

Issue 本文は「対象行の `operationId` / `userVersion` が読んだときと同じであること」を条件に、と書いている。素直に読めば `beginRelease` に `expectedOperationId` と `expectedUserVersion` を渡す形になる。

しかし予約の operation ID は `親操作ID:種別:正規化鍵` の合成で、**生の鍵（メールアドレス・handle・provider account ID）を含む**。ADR 048 はこれを「ディレクトリの外のシンクへ出さない」と決めている。またこの 2 列は memory アダプターの行の形そのもので、ADR 026 が契約から外している「機構」に踏み込む。

さらに `operationId` は必ずしも claim ごとに異なるとは限らない。`updateProfile` の親 operation ID は `profileOperationId(userId)` で決定的なので、同じ利用者が handle X を付け → 外し → 付け直すと同じ operation ID の claim が 2 回生まれる。`operationId` だけを条件にすると、まさに塞ぎたい「別の claim なのに一致してしまう」状況が残る。

### Decision

`ActiveUniqueClaim = { userId, claimToken }` を返す `resolveClaim` を足し、`claimToken` を**不透明な値**として契約する。契約が要求するのは 2 つの観測可能な性質だけ:

- 1 つの claim が生きているあいだ不変（冪等な `activate` の再実行を含む）
- 同じ鍵に**後から**張られた claim のトークンは、前の claim のトークンと一致しない。**同じ `operationId` が張り直した場合でも一致しない**

2 番目の性質にこの但し書きが要るのは、上の Context がまさに `operationId` を条件から外した理由だからである。決定的な予約 operation ID（`profileOperationId(userId):handle:X`）では同じ ID の claim が同じ鍵に 2 回生まれうるので、「別 operation なら別トークン」だけを契約すると `claimToken = f(kind, key, operationId)` のような導出が契約を満たしてしまい、この ADR が排除したはずの穴が機構の側から戻ってくる。契約の実行形（ADR 026 決定 2）が判断を担保できなければ、複数ワーカー配備の前に契約を確定させるという本 Issue の目的が果たせない。したがって**適合ケースも同じ `operationId` で張り直す強い形**で書く（steps.md ステップ 4）。「取り壊して別の operation が張り直す」弱い形のケースだけを置いてはいけない。

memory アダプターは `MemoryBackend` 寿命の単調増加カウンタで採番する。`idGenerator` は使わない（テストの決定的 ID 列がずれる）。ディレクトリのファクトリは 1 backend につき複数回呼ばれるので、採番はファクトリのクロージャではなく backend に置く。

採番の位置は **`activate` ではなく `reserve`**（行を書く時点）にする。`activate` で付けると `DirectoryRow.claimToken` が `string | null` になり、「`active` の行は必ずトークンを持つ」が実行時の不変条件になって `resolveClaim` に到達不能な分岐（null ならプログラミングエラー）が残る。`reserve` で採番すれば行は生成時から必ずトークンを持ち、判別可能ユニオン化（＝スプレッド更新の全面書き換え）をせずに `claimToken: string` のまま不変条件が構造的になる（CLAUDE.md「不正な状態を型で表現できなくする」）。観測可能な振る舞いは変わらない — `resolveClaim` は `active` の行しか返さないので `reserved` 行のトークンは外から見えず、契約が要求する 2 性質も保たれる（同一 operation の冪等 `reserve` は既存行を早期 return するのでトークンが動かず、失効した `reserved` 行の奪取と `release` 後の再予約はどちらも新しい行を書くので新しいトークンになる）。`activate` はトークンに関する分岐を持たなくなり、既存の「`active` は素通り」がそのまま残る。

### Consequences

- 良い点: 鍵の値がディレクトリの外へ出ない（ADR 048 と整合）。バックエンドは etag / rowversion / 採番のどれを使ってもよい。
- 良い点: 決定的な operation ID を使う経路（`updateProfile`）でも claim の同一性が保てる。適合スイートが「同じ `operationId` での張り直しでもトークンが変わる」を拘束するので、この性質はバックエンドを越えて担保される。memory は `release` が行を削除し次の `reserve` が新規採番の枝を通るため、実装側の追加コストなしに強い形を満たす。
- トレードオフ: 呼び出し側は不透明値を短時間だけ持ち回る。ログ・イベント・永続化に出さない規律が要る（契約 JSDoc に明記し、`identityRemovalRelease` のログは従来どおり `operationId` と理由だけを出す）。
- 良い点: `DirectoryRow.claimToken` が非 null で済み、「トークンを持たない `active` 行」という状態を型として表現できなくできる。判別可能ユニオン化（`{...row, state: ...}` 形のスプレッド更新の全面書き換え）をしなくても不変条件が構造的に取れる。
- トレードオフ: `reserved` / `releasing` の行もトークンを持つが、`resolveClaim` から観測できないので契約上は未規定（ADR-007）。バックエンドは採番位置を自由に選べる — 契約が要求するのは「`active` 行のトークンは非 null」だけ。

---

## ADR-003: `resolve` は残し、`resolveClaim` を足す

### Context

`resolve` の返り値を `ActiveUniqueClaim | null` に変えれば読みのメソッドは 1 本で済むが、呼び出し元は 9 か所（`signInWithPassword` / `signUpWithPassword` / `requestPasswordReset` / `resendVerificationEmail` / `checkHandleAvailability` / `linkOAuthIdentity` / `completeOAuthSignIn` ×2 / `holdsActiveUniqueKey`）あり、どれも claim の同一性には関心が無い。

### Decision

`resolve` を残し、`resolveClaim` を足す。memory 実装では `resolve` を `resolveClaim` の射影として書き、2 つの読みが食い違わないようにする。

### Consequences

- 良い点: 本 Issue の振る舞いに関与しない 9 か所を触らない。差分がレビューできる大きさに収まる。
- トレードオフ: ポートの読みが 2 本になり、片方がもう片方の射影という軽い冗長さが残る。契約 JSDoc に射影関係を明記し、**適合スイートでも拘束する**（4 状態すべてで `resolve(k,n)` と `resolveClaim(k,n)?.userId ?? null` が一致する）。散文だけでは 2 本目のバックエンドが両者を独立に実装して食い違わせられ、契約を確定させるという本 Issue の目的を果たさない。経路 1 の当事者どうしで読みが分かれる（`linkOAuthIdentity` の早期判定は `resolve`、`identityRemovalRelease` の観測は `resolveClaim`）ので、実運用でも効く。台帳は 1 行増える（`ADP-identity-042` / `DOM-identity-066`）うえ、射影関係は `resolve` 側の本文に足す新しい契約文なので既存の `ADP-identity-006` / `DOM-identity-027` にも 1 句が要る（steps.md ステップ 11）。

---

## ADR-004: 観測と解放を 2 段に分け、既存の 2 呼び出し元は合成関数のままにする

### Context

`releaseActiveUniqueKey` の呼び出し元は 3 つある。`identityRemovalRelease` だけが「観測 → 判定 → 解放」で、`updateProfile`（旧 handle）と `deleteAccount/globalCleanup`（削除アカウントの全鍵）は観測と解放が連続してよい。全呼び出し元にトークンを引数で要求すると、後者 2 つが観測のためだけに書き換わる。

### Decision

`observeActiveUniqueKey` / `releaseObservedUniqueKey` の 2 段を足し、`releaseActiveUniqueKey` をその合成として残す。既存 2 呼び出し元は無改修で CAS の保護を受ける。

`releaseObservedUniqueKey` は観測が null（claim が既に無い / 別利用者 / 中断した解放の `releasing` 行）でも `release(operationId)` は必ず呼ぶ。`beginRelease` の直後に落ちた先行配送が残す `releasing` 行を、再配送が掃除できなくなるため。ADR-007 でこれが孤児 `releasing` 行の**唯一の**回収経路になったので、規約ではなく**テストで拘束する** — `if (observed === null) return;` と書いた実装が落ちるケース（AC-8 / TC-identity-345）を置く。JSDoc の文言だけを根拠にすると、早期 return 実装が全 green のまま通り、その鍵が恒久的に使用不能になる。

### Consequences

- 良い点: 「観測をいつ取るか」を選ぶ必要があるのは、選ぶ理由がある呼び出し元だけになる。
- トレードオフ: 似た名前の関数が 3 つ並ぶ。JSDoc で「順序が問題になるなら 2 段、そうでなければ合成」を書き分ける。
- トレードオフ: 観測が null のとき `beginRelease` を呼ばないので、**別 operation が残した `releasing` 行を拾う経路が消える**。現行実装ではその行を後続の別 operation の `beginRelease` が再キー付けして落とせていた。この帰結は ADR-007 で契約として引き受ける。

---

## ADR-005: 経路 2 は「利用者内の重複」をドメイン規則で塞ぎ、再連携を治癒に倒す

### Context

Issue コメントが示す 2 本目の経路は、予約サガが「commit 済み・`activate` 失敗」で終わって `reserved` 行が残り、TTL 10 分後の再連携で `reserve` が通り、最終 UoW が同一 `(provider, providerAccountId)` を見ないまま insert して identity 行が二重に生えるというもの。ポート契約の CAS では閉じない（claim ではなく identity 行の側の問題）。

選択肢:

1. 最終 UoW で重複を見つけたら `ConflictError` で弾く。
2. 最終 UoW で重複を見つけたら insert を飛ばし、今回の予約をそのまま `activate` して claim を復旧させる（治癒）。
3. `IdentityRepository.insert` に一意検査を足す。

### Decision

2 を採り、判定は `IdentityPolicy.findOAuth`（`findPassword` と同じ位置のドメイン述語）で行う。判定は `ensureAddable`（上限 8 件）より**前**に置く — 逆にすると 8 件持つ利用者が自分の残骸を治癒できない。

- 1 を採らない: 弾くと、`activate` 喪失で生まれた identity 行が永久に claim を持てないまま残る。利用者から見ると「連携済みなのにサインインできない」状態が固定する。
- 3 を採らない: ADR 054 が「provider account の一意性の担保は予約ディレクトリ 1 か所」と決めている。

ADR 054 との境界はこう引く — ディレクトリが担保するのは**全利用者にまたがる**一意性、`IdentityPolicy.findOAuth` が見るのは**1 利用者の identity 集合の中**の重複であり、後者は最終 UoW が既に読んでいる集合に対する集約不変条件。リポジトリに検査を足すわけではないので担保元は動かない。

この境界は adr.md の中だけに置かず、spec 側にも書く。`spec/domains/identity.md` は 2 か所で「provider account の一意性は `IdentityUniqueDirectory` が唯一の担保」「`(provider, providerAccountId)` の一意性はここでは検査しない」と述べており、境界を足さないと `findOAuth` がその主張と衝突して読める。あわせて `#ドメインサービス` のメソッド表に `findOAuth` の行を足し、同節末尾の散文（「最終 UoW 内で current 集合を読み直して `ensureAddable` してから insert する」）を「OAuth の 2 経路は `ensureAddable` の**前**に `findOAuth` を引く」と整合させる — この順序は load-bearing なので spec 側にも残す必要がある（steps.md ステップ 11）。`spec/usecases/identity.md` 側も同様で、`completeOAuthSignIn` は手順 8（既存 User 分岐の共通処理）だけでなく**手順 6（`linkToExisting`）**にも届かせる — 手順 6 は「予約を確保し、`Identity.createOAuth` を保存後に activate する」と無条件の保存として書かれており、治癒が入ると単独で読んだときに偽になるため。

### Consequences

- 良い点: 「commit 済み・activate 失敗」の残骸を、次の再連携が自然に回収する（P-22 の重複表示と 8 件枠の消費が起きない）。
- 良い点: 述語がドメインに 1 本置かれ、`linkOAuthIdentity` / `completeOAuthSignIn` / `existingLinkId` が同じものを使う。
- トレードオフ: 利用者をまたぐ残骸（A の activate 喪失後に B が同じ外部アカウントを取り直し、A の identity 行だけが後ろ盾を失う）は閉じない。`listByUserId` では観測できず、閉じるには別 shard の読みが要る。ADR 038 の「解放が落ちたら固まる — 誤って通すより安全側」の範囲として本 Issue では扱わない（plan.md のスコープ外に記載）。

---

## ADR-006: 注入テストは実アダプターを包むラッパーで作り、fake を足さない

### Context

受け入れ基準は「判定のコミット後・`beginRelease` の前に再連携を差し込む」注入テストを要求する。`docs/test.md` の fake ポリシーはリポジトリ / UoW の模造を禁じており、許されている fake は `FakeIdGenerator` / `FakeLogger` だけ。

### Decision

`createTestHarness` が返すコンテナをスプレッドし、ポート 1 本だけを「実アダプター / 実プロバイダーに委譲しつつ 1 度だけ割り込む / 必ず失敗する」薄いオブジェクトに差し替える。ハーネス自体は変更しない（`workerOverrides` はハーネス生成時にしか渡せず、実インスタンスが必要なため、生成後のコンテナをスプレッドする方が素直）。

**どの面に割り込むかは経路ごとに違う。**

- 経路 1（AC-4）は **`globalUnitOfWorkProvider`** に差す。`identityUniqueDirectory.beginRelease` を包む形だと割り込みは観測より必ず後に発火するので、「判定 → 観測 → CAS」という誤った順序の実装でも旧トークンを観測して no-op になり、テストが通ってしまう（＝ CAS 機構の存在しか証明せず、本 Issue の成果物である順序制約を拘束しない）。`run` が解決した直後に割り込めば、誤順序の実装は割り込み後の新しい claim を観測してトークンが一致し、claim を壊して落ちる。Issue の受け入れ基準の文言（「判定のコミット後・`beginRelease` の前に差し込む」）にも一致する。割り込みは `run` の解決**後**に走るので UoW のネストにはならない（ADR 023 の禁止に触れない）。`identity.identity.removed` の subscriber は `identityRemovalRelease` 1 本だけなので、one-shot ガードで狙った UoW を確実に捕まえられる。
- 経路 2（AC-5）は従来どおり **`identityUniqueDirectory.activate`** を必ず失敗させるラッパーで、サガを commit 後に停止させる。

経路 1 の窓は「先行配送の解放 + 本人の再連携」を割り込みの中で実行して作る。claim が `active` のあいだは再連携が到達できないので、これが現実に到達しうる唯一の織り込みである（研究メモ参照）。

### Consequences

- 良い点: 実アダプター / 実プロバイダーが実際の状態遷移を行うので、テストが証明するのは本物の振る舞い。fake は増えない。
- 良い点: 順序制約が目視レビューではなくテストで守られる（誤順序の実装が落ちる）。
- トレードオフ: 割り込みの中でユースケースを呼ぶため、テストの読み取りに順序の理解が要る。テスト名と 1 行コメントで「どの窓を作っているか」を明示する。

---

## ADR-007: `beginRelease` の no-op に `releasing` を明示し、孤児 `releasing` 行の回収を同一 operation の `release` に一本化する

### Context

現行 memory 実装の `beginRelease` の no-op 条件は「行なし / 別利用者 / `reserved`」の 3 つで、**`releasing` 行は別 operation が再キー付けして奪える**。これはポート JSDoc にも spec の散文にも書かれていない、実装だけが持つ振る舞いである。

ここに ADR-001 の CAS を素直に足すと、契約は「`state='active'` だけを取り壊す実装」と「`state IN ('active','releasing')` を許す実装」の両方を満たしてしまう。両者は観測可能な結果が異なる（孤児 `releasing` 行を別 operation が回収できるか）ので、ADR 026 決定 1（JSDoc だけを読んで到達でき、スイートだけが規定している振る舞いを残さない）に反する。加えて ADR-004 の `releaseObservedUniqueKey` は観測が null のとき `beginRelease` を呼ばないため、この回収経路は application 側からも消える。

`releasing` 行には期限が無く、`reserve` も奪えない。回収されなければその鍵は使用不能のまま残る。

### Decision

契約側で 1 つに決める。**取り壊せるのは「`active` かつ所有者が `expectedUserId` かつトークンが `expectedClaimToken` と一致する行」だけ**とし、行なし / `reserved` / **`releasing`** / 別利用者 / トークン不一致をすべて no-op として JSDoc・spec 散文・適合スイートの 3 か所に書く。

`releasing` 行を落とせるのは、その行を再キー付けした operation の `release(operationId)` だけとする。したがって解放の呼び出し元は、応答喪失後に同じ ID を再導出できる**決定的な operation ID** を使わなければならない — これも契約文にする。現行の 3 経路はいずれも満たしている（`identityRemovalRelease` は `removeIdentity` の受領・イベントに固定された `operationId`、`updateProfile` は `${profileOperationId(userId)}:release:handle:${handle}`、`globalCleanup` は `reservationOperationId(operationId, key)`）。

`releasing` 行の `claimToken` は**未規定**とする。`resolveClaim` から観測できないので、スプレッド更新で保存する memory 実装と、行を書いた時点で etag が変わる将来のバックエンドのどちらも契約を満たす。`releasing` が no-op 側に入ったことで、同じ operation の `beginRelease` 再実行はトークンの保存有無に関わらず no-op になり、冪等性がトークンの振る舞いに依存しなくなる。

`releasing` 行への期限の導入は本 Issue では行わない（振る舞いの追加であり、Issue の 2 経路を閉じるのに必須ではない）。

### Consequences

- 良い点: 契約が実装の分岐を許さなくなり、2 本目のバックエンドが同じ回収可能性で拘束される。適合スイートに「`releasing` 行は別 operation の `beginRelease` に奪われない」を 1 ケース足して実行形にする。
- 良い点: 冪等性の根拠が「`releasing` は no-op」に一本化され、`claimToken` の保存有無から切り離される。
- トレードオフ: `beginRelease` と `release` のあいだで落ちた解放が残す `releasing` 行は、同じ operation の再実行だけが回収できる。ワーカー経路（`identityRemovalRelease` / `globalCleanup`）は event / 継続の再配送が同じ ID を再導出するので、**その行が隔離されない限り**自力で収束する（outbox の行は `maxAttempts` 超過で隔離され再配送が止まるので、収束は無条件ではない — この限界は ADR 038 の「解放が恒久的に落ちた場合は固まる。誤って通すより安全側」の範囲そのままで、060 が 038 より強い保証を主張しているわけではない）。回収経路がテストで拘束されることは ADR-004 を参照。**再実行の主体が居ない同期経路の `updateProfile` は旧 handle が固まりうる** — 現行実装が持っていた「別 operation が拾う」経路が無くなるため。ただし現行の到達性も低い（その鍵を拾える別 operation は、同じ利用者が同じ鍵を再び手放すか退会するかの列に限られ、手放すには先にその鍵を取り直せなければならないが `releasing` 行が `reserve` を弾く）。plan.md のスコープ「含まれないもの」に記録し、回収手段（`releasing` への期限）は別途扱う。
- トレードオフ: `reserved` と行なしの no-op は、観測が取れない以上トークン条件に吸収されて独立には識別できなくなる。所有者不一致だけは観測から正しいトークンを組めるので独立に拘束する（ADR-008 ではなく適合スイートの書き方の問題として steps.md ステップ 4 に明記）。

---

## ADR-008: 解放する鍵は観測が固定し、受領は判定の材料にとどめる

### Context

ADR-001 の順序（観測 → 判定 → 条件付き解放）では、観測は event payload の `providerAccountKey` / `userId` で取り、判定は受領（`identity_removal_receipt`）を正本にする。両者が食い違いうるなら、判定に「受領と event payload の一致確認」を足して新しい keep 理由（`receiptMismatch`）を導入する必要がある。

### Decision

導入しない。受領と `identity.removed` イベントは `removeIdentity` の**同一トランザクション**で書かれ、`providerAccountKey` / `userId` / `operationId` は同じローカル変数から入る。両者が食い違う分岐は到達不能であり、到達不能な分岐に keep 理由を足すと契約にもテストにも根拠を持たせられない。

代わりに「**解放する鍵は観測したもの**」を 1 文で確定させる。観測は event payload の鍵と利用者で取り、`releaseObservedUniqueKey` はその観測だけを取り壊す。受領は判定の材料（removal が起きた証拠と identity 行の同定）にとどめ、`ReleaseDecision` の release 分岐は鍵 / 利用者を運ばない。keep 理由は現行の 3 つ（`noReceipt` / `identityStillPresent` / `providerAccountRelinked`）のまま。

### Consequences

- 良い点: 「解放する鍵は受領のものか観測のものか」が型の上で一意になる（release 分岐が鍵を持たない）。
- 良い点: 受け入れ基準に載らない分岐が増えない。
- トレードオフ: 受領と event が将来別トランザクションに分かれたら、この前提は崩れる。`removeIdentity` の JSDoc が既に「行の削除・受領・イベントを 1 トランザクションで書く」を根拠として持っているので、そこに依存していることを `identityRemovalRelease` 側のコメントに 1 行残す。

---

## ADR-009: `completeOAuthSignIn` の `createNew` 分岐（同一メールの利用者重複）は本 Issue で閉じない

### Context

Round 2 のレビューで、この分岐をスコープ外に置いた**前提が誤っていた**ことが分かったので、訂正したうえでスコープ判断を取り直す。

誤っていた前提: 「provider の email が既存利用者の account email と一致**しなければ** `createNew` に落ちる。一致する列は本 Issue の治癒が対象にする」。

正しい事実: 新規サインアップの `createUser` は email と providerAccount の 2 鍵を同じ親 operation で予約する。`activateUniqueKeys` は予約を順に activate し、1 本目（email）で `activate` が失敗して `confirm` 後の再試行も失敗するとそこで throw して 2 本目に到達しない。つまり activate 喪失の最頻形は**両鍵とも `reserved` のまま残る**形である。TTL 失効後に同じ利用者が再サインインすると `identityUniqueDirectory.resolve("email", email)` も null を返すので `existingUser` が引けず、`AccountLinkingPolicy.decide(null, true)` は `linkToExisting` ではなく `createNew` を返す。`reserve` は失効した `reserved` 行を奪えるので新規予約も通り、結果は**同じメールアドレスを持つ利用者が 2 人**になる。`spec/domains/identity.md` の「`email` はサービス全体で一意」を破る状態であり、Issue 本文が挙げる「メールが違えば、別アカウントが新規に作られる」（前提として email が違う）とは別物で、経路 2 が生む残骸の中で最も重い。

逆に「email だけ activate 成功・providerAccount 鍵が失効」という部分失敗は `resolve("email")` が引けるので `linkToExisting` → `attachToExistingUser` → `findOAuth` の順で本計画の治癒が効く。

### Decision

訂正後もスコープ判断は変えず、**本 Issue では閉じない**。ただし plan.md のスコープ記述を上の事実に直し、残存結果が「同一メールの利用者重複」であることを明記したうえで、リスク欄に別 Issue 候補として記録する。

判断を変えない理由:

- 閉じるには `resolve("email")` が null のときに **provider account 鍵から利用者を逆引き**する経路が要る。これは鍵 shard の別レコードを読み、その結果で `AccountLinkingPolicy` の入力を作る変更で、`spec/usecases/identity.md#identity-uniqueness-の物理shard境界` と `AccountLinkingPolicy` の決定表の両方に手が入る。
- 本 Issue の受け入れ基準は Issue 本文（経路 1 の TOCTOU）と Issue コメント（経路 2 ＝ **1 利用者の identity 行が 1 件**）で閉じており、利用者そのものの重複はその外側にある。ADR-005 が既にスコープ外に置いた「利用者をまたぐ残骸」と同じ層の問題である。
- 治癒の入口を増やすと `completeOAuthSignIn` の分岐（`refuse` / `linkToExisting` / `createNew`）の意味が変わり、AC-5 の注入テストとは別の受け入れ基準が要る。本 Issue の差分がレビューできる大きさを越える。

### Consequences

- トレードオフ: `email` の一意性不変条件を破りうる列が残る。plan.md のスコープとリスクの両方に明示し、別 Issue として起票する。
- 良い点: 治癒できる集合（email だけ activate 済みの部分失敗）と残る集合（両鍵失効）の切れ目が、AC-5 の射程として一意に読めるようになる。前の記述はこの切れ目が実際とずれていた。
