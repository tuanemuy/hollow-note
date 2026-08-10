# ADR — Issue #1: [skeleton] アカウント作成から白紙ノート閲覧までを通す

## ADR-001: Unit of Work を最初から二平面（Global + Scope）で導入する

### Status
Proposed

### Context
テンプレートの `UnitOfWorkProvider.run(fn)` は単一 DB・単一 context（todoRepository 固定）。spec（ADR 021 / domains/index.md）は global 平面と scope 平面を分け、scope 側は `ScopeUnitOfWorkProvider.run(scope, fn)` を要求する。選択肢は (a) 単一 UoW のまま skeleton を通し後で分割、(b) 最初から二平面に分割。

### Decision
(b) を採る。`GlobalUnitOfWorkProvider`（Identity 系 context）と `ScopeUnitOfWorkProvider`（Note 系 context、`scope: ScopeKey` 必須）を `application/execution/unitOfWork.ts` に定義し、todo 固定 context は削除する。createBlankNote の「route reserve（global）→ scope commit → activate（global）」サガは二平面が前提であり、(a) だと walking skeleton の意義（以降のスライスが同じ設計に積み上がる）が崩れ、全ユースケースの書き直しが後で発生する。

### Consequences
- 良い点: spec の永続化境界・ネスト禁止規約が最初から型で強制される。#11 の D1/DO アダプターが interface 差し替えだけで載る。
- トレードオフ: in-memory 実装でも平面分離・スコープ分離を模倣する実装コストがかかる。単一プロセスでは分離の恩恵が見えにくいが、契約テストの対象として価値がある。

---

## ADR-002: in-memory 永続化は「テスト fake」ではなく正規アダプター群 `adapters/memory/` として実装する

### Status
Proposed

### Context
`docs/test.md` は「リポジトリ / UoW / Clock の fake を作らない（トランザクションや OCC の in-memory 模倣は integration の代替にならない）」と明記しており、in-memory アダプターの導入はこの方針と衝突する。一方 Issue #1 は in-memory アダプターを明示要求し、#11 で Cloudflare アダプターが後続する。

### Decision
`packages/core/src/adapters/memory/` を他プロバイダーと同格の正規アダプター群として実装する。fake との違いは (1) ポート適合テスト（ADR-003）を D1/DO 実装と同一スイートで通過する義務を負うこと、(2) DI で本番同様に配線され `pnpm dev` の実行基盤になること。`docs/test.md` は「fake 禁止」の趣旨（契約を検証しない場当たりのモック禁止）を保ったまま、「適合テストを通る memory アダプターはバックエンドの一つ」へ改訂する。

### Consequences
- 良い点: usecase テストが Miniflare なしの unit 速度で走る。walking skeleton が外部依存ゼロで動く。
- トレードオフ: D1/DO 固有の挙動（SQL 制約、パラメータ上限、トランザクション分離）は memory では検出できない。これは #11 で同一適合スイート + 実バックエンドが担保する前提であり、memory 通過を本番保証と誤認しない運用が必要。

---

## ADR-003: ポート適合テストは `adapters/conformance/` の共有パラメタライズドスイートとして新設する

### Status
Proposed

### Context
Issue は「ポート適合テスト」を目的に掲げるが、`spec/testcases/ports/` は存在せず、ポート契約は spec/domains/*.md の各ポート節と `spec/inventory/adapter.md` の ADP 行に散在する。既存コードはバックエンドごとに `__tests__` を重複所持しており、共有ハーネスがない。

### Decision
`packages/core/src/adapters/conformance/` に `describeXxxContract(name, makeBackend)` 形式（vitest describe を内包し、バックエンド生成関数を注入）の共有スイートを置く。ケースの根拠は spec/domains のポート契約文（原子性・条件付き更新・サガ・keyset 継続・OCC）とし、各バックエンドの `__tests__` はスイートを import して 1 行で実行する。テストケース仕様の新規ドキュメント（spec/testcases/ports/）は作らない — spec への追記は spec-sync の管轄であり、本 Issue ではコードのスイート自体を契約の実行形とする。

### Consequences
- 良い点: #11 以降のバックエンド追加が「スイート import + セットアップ」だけで検証される。契約の二重記述（spec とテストの乖離）を増やさない。
- トレードオフ: スイートは vitest に結合する。将来テストランナーを変える場合は書き直し。ADP 行との対応は命名規約（describe 名に ADP ID を含める）で追う。

---

## ADR-004: 参照ランタイムを Node + memory に一本化し、libsql / d1 / cloudflare / aws / gcp のアダプターとエントリを削除する

### Status
Proposed（Round 2 レビューで削除の実施タイミングをステップ1 への前倒しに改訂）

### Context
テンプレートは 4 ランタイム × 2 DB アダプターを同梱し、CLAUDE.md は「Pick one and delete the others」と指示する。既存アダプターは todo スキーマと旧 UoW 契約に結合しており、二平面 UoW（ADR-001）と新ドメインに追随させるにはほぼ全面書き直し（実質 Issue #11 の作業）が必要。spec/platform は最終ターゲットを Cloudflare と定めるが、CF アダプターの追加は Issue #11 として切られている。

### Decision
本スライスでは Node ランタイム + `adapters/memory/` のみを残し、`adapters/{libsql,d1,cloudflare,aws,gcp}/`、`di/server{Cloudflare,Aws,Gcp}.ts`、対応する server entry / worker / infra 設定 / integration vitest 設定を削除する。壊れた状態で温存するより、#11 が spec（DO sharding / D1 分割）準拠でゼロから書く方が安い。outbox / relay / worker runner の機構（Node 版）は保持する。

**実施タイミング（Round 2 改訂）**: 削除は最終盤（旧ステップ7）ではなく**ステップ1 に前倒し**する。旧構成では、二平面 UoW への置き換え（ADR-001）が todo 系 usecase・DI 4 ファイル・libsql/d1 UoW・テストヘルパーを壊し、削除まで typecheck / `pnpm dev` / `pnpm build` が数ステップにわたり赤のまま — 「既知断は idempotencyStore→libsql/d1 のみ」という完了条件は達成不可能だった。「壊れた状態の温存より削除が安い」という本 ADR の論理をステップ構成にも適用し、先に削除 + 残す Node ランタイム側（`unitOfWork` / `di/{types,serverNode}` / `eventRelayWorker` / `server.node.ts` / `__root.tsx` / `routes/index.tsx`）の暫定スタブ化、`routeTree.gen.ts` の再生成、npm scripts / 依存の整理（Round 3 で列挙を実ファイルの import 依存と突き合わせて補完）で、ステップ1 完了時点から常に typecheck / build を緑に保つ。

### Consequences
- 良い点: typecheck が常に緑の最小構成。todo 結合の残骸が消え、以降のスライスのビルド・テストが速い。前倒しにより各ステップの検証コマンド（AC-20）が最初から機能し、「赤→緑をまたぐ巨大コミット」を作らない。
- トレードオフ（前倒し分）: ステップ1 直後のアプリは認証もノートもない空シェルで、参照実装（todo）をパターンの手本として随時見ることはできない — 参照は git 履歴経由になる。暫定スタブ（空 context の UoW・最小 DI）はステップ2 / 8 で正規実装に置き換えられる短命な足場。
- トレードオフ: libsql 実装のトランザクション/OCC パターンは参照価値があるが git 履歴頼みになる。#11 で CF 一式（wrangler / vitest-pool-workers 設定含む）を再構築する工数は本判断で消えない（移動するだけ）。

---

## ADR-005: AC-01 の e2e 成立のため、チェックリスト外の `verifyEmail` と最小ノート一覧リードを本スライスに含める

### Status
Proposed

### Context
Issue の UC チェックリストは signUp / signIn / authenticateSession / prune / createBlankNote / getNote のみだが、対象シナリオ AC-01 は「確認メールのリンク → サインイン状態でノート一覧」まで、ED-01/OR-11 は一覧からの遷移を要求する。verifyEmail と一覧リードがないと walking skeleton が繋がらない。選択肢は (a) AC-01 を「確認メール送信画面まで」に切り詰める、(b) verifyEmail + 最小一覧を glue として追加する。

### Decision
(b) を採る。`verifyEmail` は spec/usecases/identity.md の正規仕様どおり実装する（省略形を作らない）。ノート一覧は正規の listNotes/searchNotes（後続スライス）を先取りせず、`NoteRepository.listByOwner` を使う最小の内部リード + 最小 UI に留め、後続スライスで置換される前提を明記する。招待トークン分岐（workspace 依存）は「通常サインアップ扱い」に倒す — spec 上も不正・期限切れ招待はエラーにしない仕様であり、安全に縮退できる。

### Consequences
- 良い点: Issue タイトルどおり end-to-end が成立し、マニュアルテスト（account/editing/organize の対象シナリオ）が実行可能になる。
- トレードオフ: verifyEmail の TC 群は本 Issue のチェックリスト外なので、テストは e2e 成立に必要な主要経路に絞る（全 TC は後続スライス #2 で消化）。一覧の仮設 UI は #8（整理スライス）で作り直しになる。

---

## ADR-006: アダプター実装の見送り基準 —「外部技術結合」は見送り、「永続化ストア契約」は実装する

### Status
Proposed（Round 1 レビューで基準を明文化し、対象に ADP-identity-033/034 を追加）

### Context
チェックリストは HtmlProcessor（ADR 013 の 161 行のサニタイズポリシー）、PdfRenderer、NoteExportComposer、NoteMovePort、SignInOAuthClient の**アダプター実装**行を含むが、本スライスのシナリオ（白紙作成・閲覧）はこれらを一切実行しない。一方、AccountDeletionManifestStore / ScopeCleanupAdmissionStore の削除フロー系メソッドも本スライスのシナリオでは実行されず、対応 TC も 1 行もない — 「シナリオで実行されない」だけを基準にすると、これらの memory 実装（plan.md が工数の主要リスクに挙げる部分）も見送れてしまい、基準の適用が非一貫になる。

### Decision
見送り基準を次のとおり明文化して一貫適用する:

- **見送る**: 実装の本体が永続化契約ではなく**外部技術への結合**（サニタイズ・PDF 描画・エクスポート合成・クロススコープ移動サガ・OAuth プロトコル）であり、かつ本スライスに実行経路も対応 TC もないアダプター行。対象: ADP-note-001..007（HtmlProcessor / PdfRenderer / NoteExportComposer）、ADP-note-050..054（NoteMovePort）、ADP-identity-033/034（SignInOAuthClient — 実装時判断を廃し見送り確定）。
- **実装する**: **永続化ストア系ポート**の memory 実装 + 適合テストは、シナリオで実行されないメソッド（AccountDeletionManifestStore 全 14 メソッド、ScopeCleanupAdmissionStore の削除フロー系）も含めて本スライスで行う。理由: (1) 契約が spec/domains/index.md に閉じた純粋な永続化状態機械で、外部技術依存がなく本スライスで検証可能。(2) Issue の意図は「後続スライスが同じ設計・テスト基盤に積み上がる基盤づくり」であり、適合スイート（ADR-003）+ memory 参照実装が揃って初めて、削除スライスと #11（D1/DO）が同じスイートに載る。工数リスクは plan.md 記載のとおり受容する。

DOM 行（ポートインターフェース定義）は見送り対象を含め完全に実装する。Issue の完了条件が用意している「見送る行はチェックせず理由をコメントに残す」運用に載せる。中途半端なスタブ実装（完了条件が明示的に禁止）は作らない。

### Consequences
- 良い点: 見送り判断が基準として検証可能になり、後続レビューで行単位の恣意性を疑われない。サニタイズポリシー等の実装は対応するテスト（編集・取り込み TC）と同じスライスで書かれる。適合スイートの参照バックエンドが本スライスで完成する。
- トレードオフ: チェックリストの消化率は 100% にならない（設計上意図された見送り）。永続化ストア系の memory 実装（lane / lease / keyset / 状態機械）は本スライスの工数の主要リスクのまま残る。ポート定義が実装なしで先行する行は後続スライスでシグネチャ調整の差分が出る可能性がある。

---

## ADR-007: verify-email はページ描画（GET）とトークン消費（POST）を分離する

### Status
Proposed

### Context
spec/presentation/index.md の CSRF 規律は「状態を変更する GET 経路を作らない」「`FormData` を受ける server function は `Origin` 検証必須」を定める。確認リンクはメールから GET で開かれるため、ルート読み込みでトークン消費 + セッション発行まで行う素朴な実装は「状態を変更する GET」になり規律に抵触する。P-03 の状態定義（処理中 / 成功 / 期限切れ / 使用済み / 無効）も「表示してから処理」の形を示唆している。

### Decision
`/verify-email` の GET はページ描画（「処理中」状態）のみで状態を変更しない。マウント後にクライアントから server function（POST）へ token を送り、そこで verifyEmail（トークン消費 + セッション Cookie 発行）を実行する。結果状態（成功→/notes、期限切れ / 使用済み / 無効）は POST の応答で表示する。あわせて AC-15 に CSRF 規律（JSON POST 原則・FormData なら Origin 検証・状態変更 GET 禁止）を受け入れ基準として明記する。

### Consequences
- 良い点: セッション Cookie 導入と同時に CSRF 規律が最初のスライスから守られ、後続のミューテーション追加が同じ型に載る。単回消費トークンがプリフェッチ・リンクプレビューの GET で誤消費される事故も防げる。
- トレードオフ: verify-email が JS 必須になる（noscript では確認が完了しない）。1 リクエストで済む実装より往復が 1 回増える。
- **→ ADR-038 で改訂**: GET 描画 / POST 消費の分離だけでは「リンクを踏ませるだけでは状態が変わらない」性質が守れない（自動 POST が login CSRF になる）。セッション発行の条件を ADR-038 が追加する。

---

## ADR-008: サインアウトは Cookie 破棄のみの presentation 限定 glue とする

### Status
Proposed

### Context
アカウントメニュー（L-01 最小）にサインアウトを置くが、`signOut`（UC-identity-009: セッショントークンから行を解決して削除）は本スライスのチェックリスト外。セッション行削除まで実装すると UC-identity-009 の部分実装の先取りになり、Issue の完了条件が禁じる「中途半端な実装」と、後続スライスでの「実装済みに見えるが TC 未消化」という状態を生む。

### Decision
サインアウトは presentation 層の glue として **Cookie 破棄（`clearSessionCookie`）のみ**を行い、application 層の usecase は呼ばない。セッション行の削除と UC-identity-009 の TC 消化は後続スライスで正規実装する。

転送形態は **`createServerFn({method:"POST"})` の JSON POST** とし、GET リンクにはしない（Round 2 追記）。Cookie 破棄はサーバー行を変更しないが認証状態を変更する経路であり、GET で実装すると spec/presentation/index.md の「状態を変更する GET 経路を作らない」に抵触する — SameSite=Lax はトップレベル GET に Cookie を添付するため、外部リンクからのログアウト強制（CSRF）が成立してしまう。

### Consequences
- 良い点: UC-identity-009 のスコープが後続スライスに無傷で残り、本スライスの実装∪見送りの線引きが明確に保たれる。
- トレードオフ: サーバー側のセッション行は期限まで残る（prune が回収する）。Cookie を復元すれば再ログイン状態になるが、walking skeleton の脅威モデルでは許容する。

---

## ADR-009: ステップ1 の削除範囲を「参照が Node + memory 構成の外にしか残らないもの全部」へ補完する

### Status
Accepted

### Context
steps.md ステップ1 の削除・スタブ列挙は主要ファイルを挙げるが、実リポジトリには列挙外の参照元が残っていた: `infra/`（aws CDK / cloudflare Pulumi / gcp Terraform、pnpm workspace 登録と biome includes と root scripts が参照）、`.github/workflows/ci.yml`（削除した `test:integration:{cf,node}` / `build:{cf,aws,gcp}` を実行）、`packages/core/package.json` の cf/aws/gcp/libsql/drizzle 系依存（steps は apps/web と root のみ言及）、`application/__tests__/helpers.ts`（「todo 依存」ではなく D1 依存だが、adapters/d1 削除で参照切れ。ステップ7 で memory 版に新設予定）、`apps/web` の `Dockerfile.gcp` / `wrangler*.toml.tpl` / `worker-configuration.d.ts`。残すとステップ1 の完了条件（typecheck / build / lint 緑）が成立しない。

### Decision
ステップ1 の趣旨（「残すと削除直後から参照切れで壊れるものは本ステップで処理」）を適用し、以下を実施した:

- `infra/` を全削除し、`pnpm-workspace.yaml` の infra エントリーと workerd の allowBuilds、`biome.json` の `infra/**` includes、root package.json の infra 委譲 scripts を除去。
- `ci.yml` は integration ジョブを削除（`test` = `test:unit` への縮退に追随。memory 適合テストは unit 側で走る — ADR-002/003）し、build マトリクスを node のみに縮退。
- `packages/core/package.json` からも @aws-sdk / @google-cloud / @libsql / drizzle-orm / google-auth-library / @cloudflare/workers-types を除去（fast-check はステップ3〜4 の property テストで使うため保持）。
- `helpers.ts` は削除（ステップ7 で memory バックエンド版を新設）。`Dockerfile.gcp` / wrangler テンプレート / 生成物も削除。
- 暫定スタブの形: serverNode の request container は「使用時に reject する UnitOfWorkProvider」、worker container は「空の claim を返す OutboxRepository + 常に未処理を返す IdempotencyStore」。runner の relay / prune ループは無害に空回りし、アプリは空シェルとして起動する。
- `vitest.config.integration.node.ts` は steps の指示どおりステップ8 の要否判断まで残置（include の対象は現在空振り）。

### Consequences
- 良い点: ステップ1 完了時点で typecheck / build / lint / unit テストが全て緑。CI も参照切れ script を呼ばない。
- トレードオフ: CF 復帰（#11）時に infra/cloudflare（Pulumi + wrangler レンダリング）と CI マトリクスを git 履歴から再構築する。空シェル期間中は UoW を呼ぶ経路が実行時エラーになる（到達経路は存在しない）。

## ADR-010: NoteRouteStore 系ポートは domain/note/ports ではなく application/ports に置く

### Status
Accepted

### Context
steps.md ステップ4 の対象ファイル列挙は noteRouteStore / noteRouteFanOutReader / shareTokenProtector / noteMovePort を `domain/note/ports/` に含めるが、spec/domains/note.md はこれらを「NoteRouteStore / NoteMovePort（application ports）」と明記し、`ShareTokenProtector` も application port と記述する。実際 `NoteRoute` / `NoteMovePort` は `ScopeKey`（steps.md 設計節で `application/scope.ts` に置くと確定済みのアプリケーション共通型）に型依存するため、domain 配下に置くと domain → application の依存が生じ、CLAUDE.md の内向き依存原則に反する。

### Decision
noteRouteStore / noteRouteFanOutReader / shareTokenProtector / noteMovePort の 4 ファイルは `packages/core/src/application/ports/` に置く。シグネチャは spec/domains/note.md のとおり（DOM-note-051..070 は充足）。その他の Note ポート（repository / query / projection 系）は `ScopeKey` に依存しないため steps どおり `domain/note/ports/` に置く。

### Consequences
- 良い点: 依存方向が保たれ、spec の「application ports」という位置づけとも一致する。
- トレードオフ: steps.md のファイル列挙と物理配置が 4 ファイル分ずれる（本 ADR が根拠）。

## ADR-011: 投影世代・route 版はドメインメソッドの引数として受け取る

### Status
Accepted

### Context
spec/domains/note.md のイベント表は `note.created` payload に `projectionRevision`、`note.moved` payload に `routeVersion` を含めるが、これらの値の採番者はドメインではない（projectionRevision は `NoteProjectionRevisionStore.bump`、routeVersion は `NoteRouteStore`）。一方エンティティの `createBlank` / `createFromUpload` / `moveTo` はイベントドラフトを自身で組み立てるため、値の供給経路が spec のメソッドシグネチャに存在しない。

### Decision
`Note.createBlank` / `createFromUpload` の params に `projectionRevision: number` を、`Note.moveTo` に `routeVersion: number` 引数を追加する。ユースケース（ステップ7 以降）が UoW 内で採番した値を渡す。application 側でドラフトを後から書き換える enrichment 方式は、ドラフト型の不変性と「ドメインがイベントの形の正本」という原則を崩すため採らない。

### Consequences
- 良い点: イベント payload が spec どおりの形で型付けされ、ドメインは純粋関数のまま。
- トレードオフ: spec のメソッド表に無い引数が 2 箇所増える（spec-sync 候補としてメモ）。

## ADR-012: 他ドメイン参照は最小 VO スタブで満たす（Storage / Conversion / Job）

### Status
Accepted

### Context
Note は `StoredFileId`（sourceFileId・purged payload）、`ConversionFailureReason` / `InitialContentState`（NoteFailureReason・createFromUpload）、`JobId`（NoteMovePort.excludingJobId）に型依存するが、Storage / Conversion / Job ドメインは後続スライス。steps.md は Workspace についてのみ「最小 VO を新設」と指示し、他は言及がない。

### Decision
Workspace 最小 VO と同じ扱いで `domain/storage/valueObject.ts`（StoredFileId）、`domain/conversion/valueObject.ts`（ConversionFailureReason / InitialContentState — spec/domains/conversion.md の値列挙どおり）、`domain/job/valueObject.ts`（JobId）を新設する。各ファイルの JSDoc に「本体は後続スライス」と明記。`NoteMoveSnapshot` は spec に具体的なフィールド列挙が無いため、`migrationId` のみを持つ意図的に不透明な型とし、確定は移動スライスに委ねる。

### Consequences
- 良い点: `sourceFileId: string` のような型弱化を避け、依存方向（Note → Storage/Conversion、application → Job）は spec の表どおり。
- トレードオフ: 後続スライスがこれらのファイルを本実装で上書きする際、既存 import はそのまま生きる（互換な拡張のみ許される）。

## ADR-013: ドメインイベントのデコーダーは application 層（ステップ7）に置く

### Status
Accepted

### Context
steps.md ステップ3 の記述は `domain/identity/events.ts` に「+ decoder」と読めるが、デコーダー基盤 `application/events/buildDecoder.ts` は zod と `SystemError`（application/errors）に依存する。domain からこれを import すると依存方向が逆転する。todo 参照実装でもデコーダーは `application/todo/eventDecoders` にあり、steps.md ステップ7 の対象ファイルにも `application/{identity,note}/eventDecoders.ts` が明記されている。

### Decision
ステップ3〜4 の domain `events.ts` はイベント型 + ドラフトファクトリのみとし、デコーダーはステップ7 の `application/{identity,note}/eventDecoders.ts` で実装する。

### Consequences
- 良い点: domain の framework-free / 依存方向が保たれ、todo 参照実装のパターンと一致する。
- トレードオフ: なし（ステップ7 の担当者は eventDecoders 未実装であることを前提に作業する）。

## ADR-014: memory アダプターのトランザクションは「スナップショット差し替え」ではなく undo ログ + AsyncLocalStorage で実装する

### Status
Accepted

### Context
steps.md 設計節は UoW を「スナップショット + 差し替えのトランザクション模倣」と記述する。しかし全テーブルのスナップショット復元は、UoW の外で発行される原子的操作（`NoteRouteStore.reserveCreate`、`LoginAttemptStore.recordFailure`、`OAuthStateStore.take` — いずれも仕様上 UoW に属さない）が open な UoW と交錯した場合、無関係な確定済み書き込みをロールバックで失う。

### Decision
`MemoryBackend` の全テーブルを `MemTable`（mutation 時に undo エントリーを記録する Map ラッパー）とし、トランザクション文脈を `AsyncLocalStorage` で運ぶ。UoW の callback と同じ async 文脈から発行された書き込みだけが undo ログに載り、失敗時は逆順 undo で「その UoW 自身の書き込みだけ」を巻き戻す。別文脈からの書き込み（UoW 外ポート）は直接適用され、並行ロールバックの影響を受けない。`run` のネストは ALS の文脈検査で拒否し（両平面共有）、UoW 同士は promise チェーンの mutex で直列化して single-writer 分離を近似する。EventId は `collectEvents` のバッファー時に採番し、outbox flush は同一トランザクション内（flush 失敗も巻き戻る）、relayTrigger.kick は commit 後のみ。

### Consequences
- 良い点: UoW の原子性と UoW 外ポートの独立性が両立する。ネスト禁止が実行時に強制され、適合テストで検証できる。
- トレードオフ: 行は「必ず新オブジェクトを set する」immutable-row 規約が前提（in-place 変更は undo が効かない）。mutex 直列化のため長時間の UoW は他をブロックする（メモリー実装では許容）。

## ADR-015: `ValidationError` を application/errors に追加する

### Status
Accepted

### Context
`NoteRouteFanOutReader` / `PublicNoteQueryService` の契約 JSDoc は改竄・失効 cursor に `ValidationError("INVALID_PAGINATION")` を要求するが、application 層に ValidationError クラスが存在しなかった（presentation の `InputValidationError` は transport 境界専用）。ステップ7 の `authenticateSession` も `ValidationError("UNAUTHENTICATED")` を要求する。

### Decision
`application/errors.ts` に `ValidationError`（kind: "validation"、任意の `fieldErrors`）を追加する。serialized 形は presentation の `SerializedValidationError` と構造互換で、httpStatus マッピングは既存の "validation" kind に載る。

### Consequences
- 良い点: cursor 契約が実装・検証可能になり、ステップ7 が同じクラスを使える。
- トレードオフ: transport-shape 違反（presentation）と runtime 規則違反（application）が同じ kind を共有する — コードで区別する運用。

## ADR-016: GlobalMaintenanceRunStore の lane は (generation, shardId) 単位で表列を内部順走する

### Status
Accepted

### Context
`advanceOrAck` のシグネチャは (generation, shardId, completed) しか受けず、戻り値の `next` も {generation, shardId}。lane を (generation, shardId, table) の三つ組にすると、同一シャードの複数表 lane を `advanceOrAck` が識別できない。また shard / 表の集合はポート契約に現れないアダプター責務。

### Decision
lane = (generation, shardId) とし、各 lane が kind ごとに設定された表列（`maintenanceTablesByKind`、in-memory 既定: authStatePrune = auth_tokens / sessions / login_attempts / oauth_flow_states）を tableIndex で順走する。`advanceOrAck(completed: true)` は次表へ進む（next = 同一 shard）か、表が尽きれば shard を done にして次の pending shard を原子的に claim して返す。`completed: false` は claim を解放し cursor を保持する（lease 喪失からの keyset 継続）。shard 集合は `MemoryBackendOptions.maintenanceShardIds`（既定 1 shard）で、適合スイートはトポロジーを factory オプションで注入して複数 shard 入力を検証する。

### Consequences
- 良い点: ポートのシグネチャと矛盾なく「lane claim・checkpoint・shard ack + 次 claim の原子性」「active lane ≤ 6」を実装・検証できる。D1 実装も同じトポロジー注入で同スイートに載る。
- トレードオフ: 同一シャード内の表は並列に掃けない（仕様の読みとして許容。1 continuation = 1 シャード 1 表とは整合）。

## ADR-017: ScopeCleanupAdmissionStore / AccountDeletionManifestStore の状態機械の未確定点を次のとおり確定する

### Status
Accepted

### Context
spec/domains/index.md の契約文は状態機械の骨格を定めるが、(1) finalize に必要な receipt の集合、(2) phase と header 状態の対応、(3) markCompleted の前提、(4) membership page の供給元（Workspace ドメインはスライス #3）が明文化されていない。

### Decision
- `ScopeCleanupAdmissionStore.markCompleted` は 8 component（job/note/tag/storage/backup/usage/localProjection/outbox）全 ack を要求し、未達は ConflictError。barrier receipt は completed 後も `pruneCompleted`（retainUntil 経過）まで残り、writes は閉じたまま。
- `AccountDeletionManifestStore` の finalize 必須 receipt は personalAbort を除く 5 種（personalCleanup / authResidue / externalConnections / jobHistory / uniquenessRelease）。`claimPending` は release phase のみ rollingBack を要求し、prepare / cleanup / redaction は built を要求する。`allRequiredAcknowledged` = membership の prepare+cleanup ack ∧ authorRoute の local+public redaction ack ∧ 必須 receipt 集合。`allRollbackReleased` = prepare-dispatched な membership item 全件の release ack（仕様どおり ack ではなく dispatched 基準）。compaction は成功系で allRequiredAcknowledged、rollback 系で allRollbackReleased を前提とする。
- membership edge の供給元は memory backend のプレースホルダー表（slice #3 が正規化）。適合スイートは `ConformanceBackend.seedMembershipEdges`（任意メソッド）で seed できるバックエンドにだけ page 内容ケースを実行する。

### Consequences
- 良い点: 「工数の山」とされた 2 ストアが実行形の契約（適合テスト）として固定され、#11 / 削除スライスが同じ判定に載る。
- トレードオフ: 上記の確定は仕様の解釈であり、削除スライス実装時に usecase 側と齟齬が出れば適合スイート側を正として調整する（spec-sync 候補）。なお `SystemErrorCode` に契約 JSDoc が言う `ExternalServiceError` が存在しないため、ShareTokenProtector の失敗（未知 keyVersion / 破損暗号文）は `DataIntegrityError` に写した（spec-sync 候補としてメモ）。

## ADR-018: NoteProjectionRevisionStore を ScopeUnitOfWorkContext に載せる

### Status
Accepted

### Context
spec/usecases/note.md 共通節は「投影対象状態を変える全 UoW は正データ保存と同じ transaction で `NoteProjectionRevisionStore.bump(noteId)` を行う」と定めるが、steps.md ステップ2 の `ScopeUnitOfWorkContext` は `{noteRepository, noteRevisionRepository, cleanupAdmission, collectEvents}` で bump の経路がない。コンテナ側の scope-bound ポートを UoW コールバック内から呼ぶ方法は memory 実装（ALS がトランザクションを拾う）では動くが、実バックエンドで同一トランザクション性が保証されない。

### Decision
`ScopeUnitOfWorkContext` に `noteProjectionRevisionStore` を追加し、`createBlankNote` は UoW 内で bump → `Note.createBlank(projectionRevision)`（ADR-011）を実行する。steps.md の context 列挙は「後続スライスで追加」と明記しており、その拡張点に載せる。

### Consequences
- 良い点: revision 採番と正データ書き込みの同一トランザクション性が契約（context の形）として強制される。
- トレードオフ: なし（後続の updateBody 等も同じ経路を使う）。

## ADR-019: コンテナは UoW 外ポートを明示し、読み取りは `Pick` で write メソッドを型的に落とす

### Status
Accepted

### Context
steps.md ステップ8 は RequestContainer に「各読み取りポート」を置くとだけ記す。フルのリポジトリを載せると UoW 外での書き込みを型が許してしまい、「リポジトリは UoW 内でのみ触る」原則が JSDoc 頼みになる。一方 spec が UoW 外と定める書き込みポート（IdentityUniqueDirectory の予約サガ、NoteRouteStore の route サガ、LoginAttemptStore の原子カウンター、SessionRepository の期限切れ best-effort delete）はフルシグネチャで必要。

### Decision
RequestContainer に `userReader` / `identityReader` / `sessionReader` / `authTokenReader` / `noteReaderFor(scope)` を `Pick<Repository, 読み取りメソッド>`（sessionReader のみ best-effort `deleteById` を含む）として載せ、UoW 外書き込みが仕様であるポート（identityUniqueDirectory / noteRouteStore / loginAttemptStore）はフルポートで載せる。WorkerContainer には `maintenanceRunStore` / `routingGenerations` / `authStateSweeps`（4表共通の `ExpirySweep` 形）を追加。memory 配線の合成は `application/di/memoryRuntime.ts`（composition root として adapters を import してよい層）に置き、serverNode DI とテストハーネス（`__tests__/helpers.ts`）が同じ配線を共有する。

### Consequences
- 良い点: 「UoW 外の書き込みはこの列挙だけ」という spec の境界が container の型に写り、テストも本番配線そのもので走る。
- トレードオフ: 後続スライスで読み取りメソッドが増えるたび `Pick` の列挙を広げる差分が出る。

## ADR-020: pruneExpiredAuthState の in-process 実行モデル

### Status
Accepted

### Context
CF 実装では cron が continuation task を Queue に発行し lane を非同期に消化するが、本スライスは queue 配線を持たない（runner 配線自体が後続スライス）。また `advanceOrAck` は次 lane の (generation, shardId) しか返さず、別 shard を auto-claim した場合その table/cursor 位置が観測できない。

### Decision
- cron 分岐は claim した lane をその invocation 内で完走する（1 command = 1表 100 件の粒度と checkpoint は維持、invocation 予算 100 commands）。表の失敗は `advanceOrAck(completed: false)` で cursor を保った解放とし、他 lane は進む。invocation 内の全 sweep が失敗した場合のみ `SystemError(DatabaseError)`（spec の「4 つすべての削除が失敗」の invocation 単位の読み）。
- `advanceOrAck` が別 shard を auto-claim した場合は一旦 `completed: false` で解放し `claimLanes` で位置つきに取り直す。同一 shard の次表は kind の表列ヒントで導出する。
- lease owner はプロセス定数 `PRUNE_LEASE_OWNER`（relay worker の workerId と同型）とし、テストが「死んだ invocation の claim」を演出できるよう export する。クラッシュ回復は「次 cron の再 lease + continuation 入力の再送」で成立し、テスト（TC-174）でその形を固定した。

### Consequences
- 良い点: TC-identity-150..178 の全行が queue なしで検証可能。CF スライスは cron 分岐の「完走ループ」を Queue 発行に置き換えるだけで同じ store 契約に載る。
- トレードオフ: cron が同期的に全 lane を掃くため in-process では invocation が長くなり得る（予算 100 commands で抑制）。

## ADR-021: 認証ユースケースの応答形状の確定（decoy userId / fieldErrors / alreadyVerified の sessionToken）

### Status
Accepted

### Context
(1) signUpWithPassword は既存メールでも「応答は未登録のときと同じ」を要求するが、出力 DTO に userId が含まれる。既存 user の id を返すと存在が漏れる。(2) THROTTLED / LOCKED は待機秒数・解除時刻を「添える」必要があるが、`ValidationError` の構造化ペイロードは `fieldErrors` しかない。(3) verifyEmail の出力表は `sessionToken: string` だが、alreadyVerified 経路は「セッションを発行しない」。

### Decision
(1) 既存メール経路は idGenerator で decoy userId を採番して返す。(2) 待機秒数は `fieldErrors.waitSeconds`、解除時刻は `fieldErrors.unlockAt`（ISO 文字列）として載せ、presentation はここから表示を組む。(3) `VerifyEmailView.sessionToken` は `string | null` とし、alreadyVerified で null（spec の出力表は表現不能 — spec-sync 候補としてメモ）。

### Consequences
- 良い点: 応答同一性・エラー詳細の運搬・非発行経路がすべて型で表現される。
- トレードオフ: fieldErrors を「フィールドエラー以外」に使う軽い流用（コード側の規約で運用）。

## ADR-022: createBlank のタイトル由来は entity 内で導出する（空→auto）

### Status
Accepted

### Context
spec/domains/note.md の `createBlank` シグネチャは `title: string` だが、usecases/note.md と TC-note-058 は「省略時は 無題 / 由来 auto、指定時は manual」を要求する。ステップ4 実装は一律 `NoteTitle.manual` で、省略時の origin が manual になっていた。

### Decision
シグネチャは spec どおり `title: string` のまま、`createBlank` 内で trim 後空なら `NoteTitle.auto("")`（=無題/auto）、非空なら `NoteTitle.manual` を導出する。usecase は不正タイトルを route 予約前に検証してからサガに入る（spec の手順順序: title 構築 → reserve）。

### Consequences
- 良い点: TC-note-058/059 が満たされ、後続の変換結果によるタイトル差し替え（auto のみ上書き可）が正しく機能する。
- トレードオフ: なし。

## ADR-023: P-11 の Shadow DOM は宣言的 template + クライアント側 attachShadow 昇格で描画する

### Status
Accepted

### Context
spec は本文の Declarative Shadow DOM 描画を求めるが、本テンプレートの P-11 は per-fragment streaming（RSC Flight payload をクライアントが `use()` で解決）で届く。`<template shadowrootmode>` が shadow root になるのは **HTML パーサーが処理した場合のみ**で、Flight payload から DOM API で構築された template は inert なまま残り、本文が表示されない。

### Decision
`NoteBody`（"use client"）が `<template shadowrootmode="open">` をマークアップとして出しつつ、effect で「shadow root 未生成 + template 残存」を検出したら `attachShadow` + content 移植で昇格させる。HTML パースされた経路（将来の公開ページ SSR）では宣言的にそのまま機能し、Flight 経路では effect が同じ結果に収束する。ホストは `position: relative` を持つ（絶対配置の包含ブロック化は描画側の責務 — spec/presentation/index.md）。styleMode "default" の既定スタイルは shadow 内 `<style>` として注入し、トークンは CSS カスタムプロパティ経由で継承させる。

### Consequences
- 良い点: P-44/P-45（SSR で HTML パースされる公開ページ）と同じマークアップ形が使い回せる。
- トレードオフ: Flight 経路では本文表示に JS が必須（P-11 は認証必須画面のため許容）。React types に `shadowrootmode` が無く、props をキャストで通している。

## ADR-024: セッション Cookie の期限は `Session.ttlMs` から再導出する

### Status
Accepted

### Context
Cookie の寿命は `Session.expiresAt` に一致させる規定（spec/presentation/index.md）だが、`SignInView` / `VerifyEmailView` は `sessionToken` のみで行の `expiresAt` を返さない（spec の出力表どおり）。

### Decision
presentation の `sessionCookieExpiry(now)` が `now + Session.ttlMs`（domain 所有の定数）で期限を再導出して Cookie に付ける。行の作成時刻とのずれはミリ秒オーダーで、常に Cookie 側が先に切れる方向。view への `expiresAt` 追加は spec-sync 候補としてメモ。

### Consequences
- 良い点: domain の TTL 定数が唯一の正のまま、view の形を spec から逸脱させない。
- トレードオフ: TTL がスライディングになった場合はこの導出が成立しなくなる（その時点で view に expiresAt を載せる）。

## ADR-025: kind タグの運搬は class 同一性に依存させない（構造判定 + RSC fragment 内での NOT_FOUND 解決）

### Status
Accepted

### Context
実装時に 2 つの経路で kind タグ付き serialized error が失われた。(1) dev サーバーは ssr / rsc / server-fn split の並行モジュールグラフを持ち、`AppServerError` のクラスが複製されるため、serialization adapter の `instanceof` テストが別グラフ生成のインスタンスに false を返し、組み込み ShallowErrorPlugin（message のみ保持）に落ちて全エラーが `unknown` に縮退した。(2) RSC fragment（NoteDetail）内で throw した `NotFoundError` は Flight のエラーチャネルで素の Error に再構築され、route の errorComponent では kind を判別できない。

### Decision
(1) `appServerErrorAdapter` の `test`・`errorResponseMiddleware`・`extractSerializedError` を `instanceof` から構造判定（`isAppServerErrorShaped`: Error ∧ `serialized` が kind タグ付き構造）へ変更する。CLAUDE.md の「presentation は構造的に serialize する（instanceof 列挙をしない）」の適用範囲を自クラスにも広げた形。
(2) 存在判定（NOT_FOUND）は fragment 自身の描画結果として解決する — `NoteDetail`（RSC）が NotFoundError を catch して P-46 の見つかりません表示を返し、それ以外の失敗のみ throw して route の error boundary（再試行つき汎用表示）へ流す。

### Consequences
- 良い点: kind タグがビルド構成（モジュールグラフの分割数）に依存せず届く。NOT_FOUND 表示がストリーミングでもフルリロードでも同一。
- トレードオフ: `serialized` という形を偶然持つ Error を誤検出しうる（kind の閉集合検査で実質排除）。fragment 内 catch は「エラーは境界で」の原則の限定的な例外（Flight がタグを運べないことが根拠）。

## ADR-026: crypto / Intl 系アダプターは当面 `adapters/memory/` に同居させる

### Status
Proposed

### Context
`passwordHasher` / `secureTokenGenerator` / `shareTokenProtector` / `timeZoneResolver` は memory バックエンドの永続化契約とは無関係な Node crypto / Intl 実装で、CLAUDE.md の「adapters はプロバイダーごとのグループ」の切り方からは `adapters/node/` 等に分かれるのが素直（レビュー W-007）。一方、本スライスのランタイムは Node + memory の一本で、いま移動しても得るものは import パスの整理だけで波及は大きい。

### Decision
移動は行わず `adapters/memory/` 同居のまま維持し、本 ADR を配置根拠の記録とする。CF スライス（Issue #11）でこれらを再利用するタイミングで `adapters/node/`（または `adapters/crypto/`）への分離を再検討する。

### Consequences
- 良い点: 本スライスでの import 波及ゼロ。分離判断を「複数バックエンドが実在する」時点まで遅延できる。
- トレードオフ: `adapters/memory` からの crypto 実装 import は誤解を招きうる（`createNodeSecureTokenGenerator` の命名と本 ADR で緩和）。

## ADR-027: パスワード認証のタイミング防御と scrypt 検証ガード

### Status
Proposed

### Context
(1) トークンハッシュ比較が非定数時間で、spec はタイミングセーフ比較を明記する（W-003）。ただし domain は framework-free で Node crypto に依存できない。(2) 未登録メール・パスワード identity なしの分岐は scrypt verify（数十 ms 級）を実行せず即 false になり、応答時間で登録有無が列挙できる（W-023）。(3) scrypt verify が保存ハッシュ由来のコストパラメータ（N/r/p/salt）を無制限に受け入れ、DB 改竄・移行事故時に 1 レコードで巨大メモリ確保が起きうる（W-024）。

### Decision
- 定数時間比較はドメイン内の純関数として実装する。長さ非依存の全バイト XOR 蓄積で crypto プリミティブを要さず、domain の framework-free を維持する。
- ダミー verify は throttle gate の**後**に配置し、未登録メール経路の所要時間のみを登録済み経路に揃える。LOCKED / THROTTLED 応答は等時化しない — gate 自体がメール登録有無に依存せず発動するため時間差が登録有無を漏らさず、TC-220（throttle 応答の即時性）とも整合する。
- scrypt verify に上限ガードを入れる: `N ≤ 2^17`・`r ≤ 16`・`p ≤ 4`・salt 16 バイト一致。範囲外は false を返す。将来ハッシュコストを引き上げる際はこのガード値を連動更新する。

### Consequences
- 良い点: サインアップ側の応答同一化（decoy userId）と対称なタイミング防御がサインインにも揃う。検証は defense-in-depth として DB 内容を信頼しない。
- トレードオフ: 未登録メール経路にも scrypt 1 回分の CPU コストがかかる。ガード値はコストパラメータ変更時の連動更新ポイントが 1 箇所増える。

## ADR-028: サインアウトはフル遷移で router キャッシュを物理破棄する

### Status
Proposed

### Context
TanStack Router のキャッシュ（staleTime 設定下の loader データ）は SPA 遷移では残存し、サインアウト後に前利用者のデータが表示されうる（B-001）。選択的 invalidate はキャッシュ全域の追跡が必要で漏れやすい。

### Decision
サインアウトは `window.location.assign` によるフル遷移とし、ブラウザレベルでページを破棄して router キャッシュ・メモリ上の状態を物理的に消す。

### Consequences
- 良い点: 前利用者データの残存経路が構造的に消える。invalidate 対象の列挙が不要。
- トレードオフ: サインアウトだけ SPA 遷移でなくなる（認証境界の遷移としては許容）。

## ADR-029: RSC ストリーミングフラグメントは `renderServerFragment` 経由を規約とする

### Status
Proposed

### Context
RSC fragment 内で throw されたエラーは Flight のエラーチャネルを通り、server-fn 境界の redaction（構造的 serialize + 詳細の秘匿）を迂回して生のメッセージがクライアントへ届きうる（W-021）。fragment 生成の呼び出し形が自由なままだと、経路ごとに redaction の有無が変わる。

### Decision
ストリーミングフラグメントの生成は `renderServerFragment` ヘルパー経由を規約とする。ヘルパーが redaction boundary（エラーの構造変換）とサーバーログ敷設を一手に担い、直接 `renderServerComponent` を呼ぶ経路を作らない。

### Consequences
- 良い点: server-fn 境界と同等のエラー秘匿・ログがストリーミング経路にも揃い、新規 fragment が規約に乗るだけで安全側になる。
- トレードオフ: ヘルパー 1 段の間接化。規約は lint で強制されず、レビューで守る。

## ADR-030: THROTTLED / LOCKED 表示は deadline 導出不能時に秒数を発明しない

### Status
Proposed

### Context
THROTTLED / LOCKED の待機情報は `fieldErrors.waitSeconds` / `fieldErrors.unlockAt`（ADR-021）から表示を組むが、payload の欠落・parse 失敗の可能性があり、旧実装の状態モデルはこの場合の表示が未定義だった（W-015）。

### Decision
SignInForm の状態は Phase の直和で表現し、待機表示は受信 payload から導出した deadline のみを正とする。導出・parse に失敗した場合は具体的な秒数・時刻を表示しない縮退（汎用の「時間をおいて再試行」文言）とし、クライアント側で秒数を発明・推定しない。

### Consequences
- 良い点: 不正確なカウントダウン表示（ゼロ到達後も拒否される等）が構造的に起きない。
- トレードオフ: payload 欠落時の案内は具体性を失う（サーバーが正しい payload を返す限り到達しない経路）。

## ADR-031: ConformanceBackend 契約に UoW とリレー起動の観測点を追加する

### Status
Proposed

### Context
UnitOfWork まわりの契約（トランザクション境界・イベント enqueue・リレー起動）が適合スイートの検証対象外で、バックエンド差し替え時に最重要の契約が無検証だった（W-009）。基盤スライスである本 PR で共有スイート化する判断を採った。

### Decision
`ConformanceBackend` の契約を `globalUnitOfWork` / `scopeUnitOfWork` / `relayKickCount` で拡張し、UoW の実行とリレー起動回数を適合スイートから観測可能にする。将来の D1 / DO backend はこの契約を満たすために counting RelayTrigger の配線が必要になる。

### Consequences
- 良い点: バックエンド差し替えの最重要契約（UoW + outbox 起動）が適合スイートで機械検証される。
- トレードオフ: backend 実装の必須提供物が増え、D1/DO 側は観測用配線（counting RelayTrigger）を追加で組む必要がある。

## ADR-032: 「文字数」は UTF-16 コード単位で数え、切り詰めはサロゲートペアを割らない

### Status
Proposed

### Context
spec/domains/note.md は Excerpt を「200 文字」、`NoteHeading.text` を「100 文字以内（超過分は切り捨てる）」と書くが、「文字」の単位を定義していない。実装は `String.prototype.slice`（UTF-16 コード単位）で切っていたため、境界に非 BMP 文字が来ると単独サロゲートで終わる文字列を作れた（R2-DM-W-001）。この値は `NoteProjectionEntry.excerpt` として読み取りモデル・FTS・`highlightedExcerpt` の材料になり、単独サロゲートは正当な UTF-8 に符号化できないため保存・シリアライズ時に破損しうる。修正の選択肢は (a) コードポイント単位へ寄せる、(b) コード単位を維持しつつ境界補正のみ入れる、の 2 つだった。

### Decision
(b) を採る。数え方の正は UTF-16 コード単位のままとし、切り詰め（`Excerpt.fromText` / `NoteHeading.create`）は末尾が high surrogate になった場合に 1 単位戻す補正を入れて、常に妥当な文字列を返す。(a) を採らないのは、`Excerpt.create` の上限検査が `value.length`（コード単位）である以上、切り詰めだけコードポイント単位にすると絵文字主体の抜粋が最大でコード単位 400 に達し、`Excerpt.create` 側で `ContentTooLarge` を投げる新たな欠陥が生まれるため。上限検査ごとコードポイント単位へ寄せる案は、行サイズ保証（ADR-017）の根拠であるバイト長上界の再計算を伴うため本スライスでは採らない。

### Consequences
- 良い点: 値オブジェクトの「常に妥当な値を返す」責務が守られ、切り詰めと上限検査の単位が一致する。バイト長上界の議論に触れない最小の修正で済む。
- トレードオフ: 絵文字主体のテキストでは「200 文字」が見かけ上 100 字程度になる（コード単位という定義に忠実な帰結）。spec に単位の明記がないままなので、単位を「UTF-16 コード単位」と書き足すのは spec-sync 候補。

## ADR-033: サインアップの一意性違反は応答に出さない — 契約はポート、畳み込みはユースケース

### Status
Proposed

### Context
`signUpWithPassword` は既登録メールでも新規メールでも同一応答（通知メール送信 + decoy userId）を返すことを docstring で保証し、AC-15（ユーザー列挙耐性）の根拠になっている。ところが `IdentityUniqueDirectory.resolve` は `reserved` 行を返さない設計のため、直前のサインアップが UoW 失敗で reservation（TTL 10 分）を残した場合や同一メールの並行 2 要求では decoy 経路に入らず、`reserve` の `ConflictError("EMAIL_ALREADY_USED")` がそのまま応答へ透過する（R2-SC-W-204）。一方 `spec/testcases/identity/signUpWithPassword.md` と `spec/inventory/test.md:400` の TC-identity-261 は、まさにこの並行 2 要求で片方が `ConflictError("EMAIL_ALREADY_USED")` になることを期待値として規定しており、docstring の保証・AC-15 と正面から衝突していた。

### Decision
一意性契約とその応答表現を層で分担する。

- `IdentityUniqueDirectory` は従来どおり `reserve` の衝突で `ConflictError("EMAIL_ALREADY_USED")` を投げる。これはポート契約として保持し、適合スイートで検証し続ける（アダプター差し替えの検証対象として必要）。
- `signUpWithPassword` はこれを捕捉し、既登録メール経路と同一の応答（`existingAccountNotice` + decoy userId）へ畳む。列挙耐性はユースケース層の責務とする。

TC-identity-261 の期待値は「並行 2 要求のいずれも同一応答を返し、実ユーザーは 1 件だけ作られる」へ改訂が必要。spec/testcases と spec/inventory の該当行の改訂は spec-sync 対象として記録する。

### Consequences
- 良い点: 「ポートは一意性を強制する」「ユースケースは列挙耐性を守る」という責務が分離され、両方をそれぞれの層のテストで検証できる。競合窓（reservation 残存・並行要求）が応答から消える。
- トレードオフ: spec の TC 行が実装より古い状態が一時的に残る（spec-sync まで）。ユースケースに例外捕捉が 1 箇所増える（「境界でのみ catch」の原則に対しては、応答同一化という明示的な保証を守るための限定的な catch と位置づける）。

## ADR-034: タイミング均等化のダミーハッシュは PasswordHasher 単位に memo し、失敗しても false を返す

### Status
Proposed

### Context
ADR-027 のダミー verify は、未登録メール経路にも scrypt 1 回分の時間を負わせて所要時間を揃える。実装はモジュールレベル変数に `hash()` の promise を memo していたが、これは 2 つの問題を持っていた（R2-UA-W-001 / R2-SC-W-202 / R2-TS-W-006）。(1) memo が `PasswordHasher` インスタンスと無関係なので、テストやマルチテナントで別 hasher を渡しても最初の 1 個のハッシュが使い回される。(2) スロットに入るのが promise なので、`hash()` が一度でも reject（scrypt はメモリ逼迫時に error コールバックを呼ぶ）すると rejected promise が恒久的に居座り、以後は未登録メール・password identity なし・弱パスワードだけが 422 ではなく 500 を返すようになる。ADR-027 で塞いだ「登録済みか否か」がステータスコードで逆に露出し、しかも再起動まで直らない。

### Decision
- ダミーハッシュは `PasswordHasher` インスタンスを鍵にした `WeakMap` で memo する。hasher の寿命に memo が従属し、hasher が捨てられれば memo も回収される。
- `PasswordHasher` は DI でランタイム単位のシングルトンとする。per-request 生成にすると未認証試行のたびに scrypt 導出が走り、均等化のためのコストが DoS 面になる（ADR-026 の crypto アダプター配線と同じ寿命規律）。
- `verifyAgainstDummy` は「失敗しても必ず false を返す」契約とし、`hash` / `verify` の失敗時はキャッシュを空に戻して次回リトライ可能にする。タイミング均等化は best-effort な防御であり、認証判定の結果を変えてよい根拠にはならない。

### Consequences
- 良い点: 均等化の失敗がステータスコードのオラクルに反転しない。プロセス寿命の恒久劣化が構造的に起きない。定常状態では hasher あたり scrypt 導出 1 回だけ。
- トレードオフ: 失敗が続く環境ではダミー verify が毎回リトライして遅くなる（均等化の目的からは許容 — 遅い側に揃う）。ダミーハッシュの生成失敗はメトリクスに出ないため、ログ観測点は別途必要。

## ADR-035: 適合スイートは観測可能な結果だけを契約化する（ADR-003 / ADR-031 の補足）

### Status
Proposed

### Context
ADR-031 で UoW とリレー起動を `ConformanceBackend` の契約に加えた結果、共有スイートに「並行 2 本の `globalUnitOfWork.run` が `first:start, first:end, second:start, second:end` の順に実行される」という厳密な順序 assert が入った（R2-UA-W-002 / R2-TS-W-001）。これは memory アダプターがプロセス内 async mutex で全 UoW を直列化している実装特性であって、`spec/domains/index.md` の UoW 契約は「1 scope object の repository と local outbox だけを公開する」「入れ子にしない」しか要求していない。global 平面の実バックエンドである D1 には対話型トランザクションがなくバッチ flush になるため、コールバックの実行を交錯させても仕様上正しいのにこのケースで落ちる。

### Decision
共有適合スイートが契約化するのは、ポート利用者から観測可能な結果だけに限る。具体的には、両方の commit が確定すること・途中状態が他方から観測されないこと・relay kick が各 1 回であること。実行順序・分離の実現手段（mutex による直列化か、バッチ flush か、楽観制御か）は契約から外し、バックエンド固有のローカルテストへ置く。ADR-003 の「スイート自体を契約の実行形とする」方針は維持したうえで、その粒度をこの ADR で確定する。

### Consequences
- 良い点: Issue #11 の D1 / DO バックエンドが、仕様上正しい実装のまま共有スイートを通せる。「契約」と「実装特性」の境界がスイートの構造として現れる。
- トレードオフ: memory アダプターの直列化保証は共有スイートでは検証されなくなり、ローカルテストが落ちれば失う。新規ケースを共有スイートに足す際は「観測可能な結果か」の判断が毎回必要になる（レビューで守る規律）。

## ADR-036: ポートのバッチ上限超過は `SystemError(DatabaseError)` に統一する

### Status
Proposed

### Context
`resolveMany` 系のバッチ上限超過に対し、`UserBatchReader` は `SystemError(DatabaseError)`、`NoteRouteStore` は `ConflictError("NOTE_ROUTE_BATCH_TOO_LARGE")` を返しており、構造的に同一の違反が 500 系と 409 系に分かれたまま共有スイートで両方とも凍結されていた（R2-TS-W-002）。`NOTE_ROUTE_BATCH_TOO_LARGE` は spec のどこにも存在しない造語コードで、`ConflictError` は presentation で 409 になるため「並行状態の衝突」を意味してしまう。加えて両ポートの `Error contract:` 行のどちらも上限超過に触れておらず、D1 実装者がポート定義だけを読んでこの契約に到達する経路がなかった。

### Decision
バッチ上限超過は `SystemError(DatabaseError)` に統一する。入力上限の超過は並行状態の衝突ではなく呼び出し側のプログラミングエラーであり、利用者への再試行案内も意味を持たないため、`ConflictError`（409 / 並行衝突専用）は不適切。造語コード `NOTE_ROUTE_BATCH_TOO_LARGE` は廃止する。両ポート定義の `Error contract:` 行に上限超過の 1 行を追加し、契約がポート定義だけで読み取れる状態にする。

### Consequences
- 良い点: 同型の違反が同一のエラー種別にマップされ、`ConflictError` の意味（並行衝突）が濁らない。D1 実装者がポート定義から契約に到達できる。
- トレードオフ: 上限超過が 500 系になるため、呼び出し側の実装ミスが監視上「システム障害」として計上される（本来そうあるべき扱いだが、アラート閾値の設計時に留意が必要）。

## ADR-037: サーバー由来の文字列は UI に描画しない — 表示文言は `code` 辞書から引く

### Status
Proposed

### Context
`errorDisplay.renderErrorMessage` の `business` 分岐が `error.message` をそのまま返し、`validation` 分岐が `field: message` を返していたため、`BusinessRuleError(INVALID_EMAIL, "Invalid email address")` や zod の英語文言・内部フィールド名がそのまま画面に出ていた（R2-FE-W-001。SignInForm / SignUpForm / CreateNoteButton / AccountMenu の 4 箇所）。spec/design/index.md §9 は「内部 stack / 原文 message / 内部エラーコードは UI に出さない」、§10 は「文言は日本語の説明文に統一し、文言辞書は 1 箇所」と定めており、実装が spec に違反していた（spec 側は正しい）。

### Decision
表示文言は `presentation/errorDisplay.ts` の辞書で `code` から引き、辞書にない `code` は `kind` の共通文言へ倒す。`SerializedError.message` / `fieldErrors` の値を描画に使う経路は作らない。両者はログ・デバッグのための情報であって表示用ではない、という区別を実装規約として固定する（`fieldErrors` は ADR-021 / ADR-030 のとおり「どのフィールドか」「待機秒数はいくつか」という構造化データの取り出し元としてのみ使い、値そのものを文字列として出さない）。この規約は spec/design §9/§10 の実装側での言い換えであり、spec の改訂は不要。

### Consequences
- 良い点: 英語原文・内部コード・内部フィールド名の画面露出が構造的に消える。新しいエラーコードを増やしても、辞書漏れは「共通文言に倒れる」という安全側の縮退になる。
- トレードオフ: エラーコードを増やすたびに辞書の追記が要る（漏れても壊れないが具体性を失う）。辞書に載らないコードは利用者から見て区別がつかなくなるため、頻出コードの取りこぼしはレビューで拾う必要がある。規約は lint で強制されない。

## ADR-038: verify-email のセッション発行は確認要求元ブラウザーに束縛する

### Status
Proposed（ADR-007 を supersede する — ADR-007 の GET/POST 分離自体は維持し、セッション発行の条件を追加する）

### Context
ADR-007 で `/verify-email` は「GET は描画のみ、マウント後に POST でトークン消費」の形になったが、その POST は利用者の操作を介さずに走り、応答の `Set-Cookie` でセッション Cookie を無条件に上書きしていた（R3-SC-B-301）。攻撃者は自分のメールでサインアップして自分の確認トークン `T` を得たうえで、`https://<app>/verify-email?token=T` を被害者に踏ませるだけでよい。トップレベル遷移なので `SameSite=Lax` は素通りし、POST を発するのは自オリジンのページ自身なので `Origin` 検証も CSRF トークンも原理的に効かない。結果、被害者のブラウザーが**攻撃者のアカウントでサインインした状態**になる。本サービスはノートを書くためのものなので、被害者がそのまま書いた内容は攻撃者のアカウントに保存される — 直接のデータ流出経路である。AC-15 の CSRF 規律は文面（状態変更 GET を作らない）としては満たされているが、規律が守ろうとした性質は成立していない。

### Decision
セッション Cookie の発行を「確認を要求したブラウザー」に束縛する。

1. `signUpWithPassword` の応答で確認待ち Cookie `hollow_pending_verification`（値は `SignUpView.userId`、`HttpOnly` / `SameSite=Lax` / `Path=/`、`Secure` は production のみ、有効期限は確認トークンと同じ 24 時間 = `AuthTokenPurpose.ttlMs("email_verification")`）を焼く。**常に**焼く — 既登録メールの `userId` は decoy なので、条件分岐を入れると Cookie の有無・形そのものが利用者列挙のオラクルになる。
2. `verifyEmailFn` は `view.sessionToken !== null` **かつ** 確認待ち Cookie の値が `view.userId` と一致するときだけセッション Cookie を発行し、そのとき確認待ち Cookie を破棄する。
3. 不一致でも**メール確認自体は成立させる**（トークンは消費し、ユーザーは active になる）。UI は新しい状態 `verifiedSignInRequired`（「メールアドレスを確認しました。サインインしてください」＋ `/signin` 導線）へ倒す。既存の `alreadyVerified`（トークンが使用済み）とは原因が違うので別状態にする。

`SameSite=Lax` は攻撃者が確認待ち Cookie を被害者のブラウザーへ持ち込む経路を塞ぎ、`HttpOnly` はスクリプトからの書き込みを塞ぐ。攻撃者が被害者に踏ませられるのは URL だけで、Cookie は攻撃者自身のブラウザーにしか無い。

### Consequences
- 良い点: 「リンクを踏ませるだけでは被害者の認証状態が変わらない」が成立し、ADR-007 が守ろうとした性質が回復する。ADR-007 の効能（プリフェッチ・リンクプレビューでの誤消費防止、状態変更 GET の不在）はそのまま維持される。セッション上書きが起きないので、サインイン済みの利用者が確認リンクを踏んでもセッションを失わない。
- **縮退（受容）**: PC でサインアップして携帯でメールを開く別端末フローでは自動サインインせず「確認できました → サインインしてください」に倒れる。確認自体は完了しているので利用者はサインインするだけで先へ進める。Cookie を消した / 期限切れの同一ブラウザーでも同じ経路になる。AC-17 の「メール確認リンク → サインイン状態でノート一覧へ着地」は**同一ブラウザー条件つきで充足**という形になる。
- 縮退（受容）その2: Cookie は 1 本なので**最後のサインアップが勝つ**。同一ブラウザーで続けて 2 回サインアップすると（打ち間違いのやり直し、登録済みメールでの再送信を含む — 後者は decoy id で上書きする）、先のサインアップの確認リンクは自動サインインしなくなる。これも「確認済み・サインインが必要」に倒れるだけで、確認そのものは成立する。
- この束縛が効く前提はアプリ全体の CSRF 姿勢と同じ: 攻撃者が被害者のブラウザーに `signUpFn` の POST を発行させられるなら確認待ち Cookie も植えられる。ミューテーションが JSON POST の server function のみ（`FormData` 経路なし）という AC-15 の規律が、そのままこの防御の前提になっている。
- トレードオフ: presentation が「確認待ち」という状態を 1 つ持つ（Cookie 1 本）。usecase 側は無変更で、束縛は transport 境界に閉じている。

## ADR-039: リース失効時の lane 回収を `GlobalMaintenanceRunStore` の契約とする

### Status
Proposed

### Context
ラウンド3の修正で memory 実装に `reclaimLapsedLanes` が入り、`beginOrResumeKind` の resume 分岐と `recoverLease` が、リースが失効しているときだけ `claimed` lane を `pending` へ戻すようになった。`claimLanes` は `pending` lane しか返さないため、停止したオーナー（クラッシュ / invocation timeout）が `claimed` のまま残した lane は誰にも再取得されず、run が永久に完了しない liveness 障害になる。ところが現在この振る舞いを規定しているのは適合スイート（ADP-common-030）だけで、ポート JSDoc は「`recoverLease` lets an owner reclaim a lapsed lease」までしか書いておらず lane の状態遷移に触れていない。Issue #11 の D1 実装者がポート定義だけを読んで実装すると、同じ liveness 障害をそのまま複製し、適合スイートを走らせて初めて気づくことになる（ADR-036 と同じ「契約がポート定義から読み取れない」問題の再発）。

### Decision
リース失効時の lane 回収をポートの契約として JSDoc に明記する。契約の内容は memory 実装と適合スイートに忠実に:

1. 失効したリースを引き取る経路（`recoverLease` と `beginOrResumeKind` の `"resumed"` 分岐）は、その run の `claimed` lane をすべて `pending` へ戻す。
2. 戻す際に lane の table 位置と cursor は保持する。新オーナーは同じ keyset の続きから再開し、重複 run も再スキャンも発生しない。
3. リースが生きている場合は lane に触れない。生きたリースの延長は稼働中オーナーのハートビート（同一オーナーの次の cron 起動を含む）であり、その in-flight lane の claim を奪ってはならない。

### Consequences
- 良い点: 契約の正本がポート定義に戻り、D1 実装者がスイートを実行する前に必要な振る舞いへ到達できる。適合スイートは契約の実行形（ADR-003）という位置づけを保ったまま、唯一の記述場所ではなくなる。
- 良い点: liveness が二段構えになる。`runCron` の `try/finally` による lane 解放は best-effort — プロセスが即死すれば `finally` は走らない — で、その取りこぼしをリース失効時の回収が拾う。どちらか一方だけでは、正常終了時の即時解放（速い）と異常終了時の回収（確実）を両立できない。
- トレードオフ: 「失効時のみ回収」という条件分岐が実装の必須要件になる。無条件に回収すると稼働中オーナーの lane を奪って二重処理を招くため、実装者は lapsed 判定を必ず持つ必要がある。
- トレードオフ: 回収は次の cron / `recoverLease` 呼び出しまで起きないため、異常終了した lane の再開は最悪でリース長（10分）遅れる。lane 単位の遅延であり run 全体の完了は遅れるだけで止まらない。
