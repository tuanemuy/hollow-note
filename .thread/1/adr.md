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
