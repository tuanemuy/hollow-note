# レビュー 001 — ADR・プロジェクトドキュメント観点

**対象:** PR #22（ベース `main`） / 契約 `.thread/14/plan.md`
**観点:** `CLAUDE.md` / `README.md` / `docs/` の事実整合、`spec/adr/052`〜`057` の様式と内容、ADR index の登録、`spec/` 内 ADR リンクの実在、`.thread/14/` 計画ファイル、経緯・弁明の混入

**総評:** `CLAUDE.md` / `README.md` / `docs/*_implementation_example.md` の全面改訂は**実物と突き合わせた限りすべて正確**だった（下記「実地検証の結果」参照）。AC-20 / AC-21 / AC-22 / AC-25 の grep はいずれも 0 件、`AGENTS.md` のシンボリックリンクも健在。ADR 052〜057 も既存様式に沿っており、前提として引く ADR に誤引用はない。一方で **下流成果物への追随が 3 か所落ちている**（うち 1 件は AC-68 が明示的に検査を要求していたリンク切れ）。

---

## Blockers

- **[B-001]** 新設した ADR 056 へのリンクが 1 本リンク切れしている（AC-61 / AC-68 の不成立）
  - 場所: `spec/testcases/storage/deleteFilesByOwner.md:11`
  - 理由: リンクが `[ADR 056](../adr/056-performance-budget-placement.md)` になっている。このファイルは `spec/testcases/storage/` にあるので `../adr/` は `spec/testcases/adr/` を指し、**存在しない**。他の 2 か所（`spec/usecases/storage.md:500` / `spec/platform/index.md:152`）は 1 階層なので `../adr/` で正しく、ここだけ深さが 1 つ違うのを見落としている。
    AC-68 は「`grep -rn "adr/05[2-7]-" spec/` の参照先ファイルがすべて実在する」を受け入れ基準に掲げており、`steps.md` 17-9 と `testing.md` 確認項目 6 の手順 1 が**まさにこれを検出するための検査**として書かれている。その検査が実行されていないか、実行して「ファイル名が 6 ファイルに含まれる」だけを見て**パスの実在まで確かめていない**。AC-61 の「056 が 3 か所からリンクされている」も、1 か所が切れている以上は満たしていない。
  - 提案: `../adr/056-performance-budget-placement.md` → `../../adr/056-performance-budget-placement.md`。あわせて `steps.md` 17-9 / `testing.md` 確認項目 6 の手順を「ファイル名の突き合わせ」ではなく「リンク先パスを実際に解決して存在を確認する」形へ直す（同ディレクトリ配下の既存リンクは `../../` を使っている — 例 `spec/testcases/identity/*.md`）。

- **[B-002]** 新設 3 ユースケースが `spec/domains/identity.md` の「ユースケース（概要）」に追随していない
  - 場所: `spec/domains/identity.md:554`（`## ユースケース（概要）` は `:552`）
  - 理由: 本 PR は AC-44 / AC-64 に従って `spec/usecases/identity.md` に `completeOAuthCallback` / `getProfile` / `checkHandleAvailability` の 3 節を新設し（実測 24 節）、`spec/testcases/identity/*.md` を 24 本に、`spec/inventory/usecase.md` の `UC-identity-*` を 24 行にそろえた。ところが同じ PR で変更している `spec/domains/identity.md:554` のユースケース一覧は **21 個のまま**で、3 つが載っていない。
    他ドメインは一致している（storage 13 = 13、usage 7 = 7、note 36 = 36）ので、**identity だけが 21 vs 24 の内部矛盾**を抱えた状態になる。AC-64 が守ろうとした「1 ユースケース = 1 テストケースファイル = 1 UC 行」の不変に、`spec/domains/` の一覧という 4 つ目の台帳が付いてこない。読み手は `spec/domains/identity.md` を入口にすると新設 3 本の存在に到達できない。
  - 提案: `:554` の列挙に `completeOAuthCallback`（`completeOAuthSignIn` の直後）/ `getProfile` / `checkHandleAvailability`（`updateProfile` の直後）を、`spec/usecases/identity.md` の節順どおりに追加する。

- **[B-003]** `spec/manual-tests/index.md` の集計が TC-42 の追加に追随していない
  - 場所: `spec/manual-tests/index.md:30`（アカウント行）、`:40`（合計行）。原因は `spec/manual-tests/account.md:520` 付近の TC-42 追加（AC-30）
  - 理由: `spec/manual-tests/account.md` は本 PR で TC が **41 → 42**（異常系 23 → 24、正常系 14 / 境界値 4 は据え置き）に増えたが、`spec/manual-tests/index.md` はアカウント行が `41 | 14 | 23 | 4` のまま、合計も `318 | 133 | 160 | 25` のままである（`spec/manual-tests/index.md` は**変更ファイル一覧に入っていない**）。正しくは `42 | 14 | 24 | 4` / 合計 `319 | 133 | 161 | 25`。
    これは本 PR が新設した **ADR 057 が明文化したルールそのものに反する** — 「`spec/manual-tests/` は `spec/inventory/` と同じく本文の下流成果物として追随させる」と決めた PR が、その手順書の**集計台帳**を追随させていない。ADR を書いた直後にその ADR を破っている形なので、規範としての説得力を損なう。なお `spec/manual-tests/account.md` の TC 総数は 41 → 42（`grep -c "^## TC-"` で実測）、種別内訳は正常系 14 / 異常系 23 → 24 / 境界値 4（`**種別**` 行で実測）である。
  - 提案: `spec/manual-tests/index.md:30` を `| アカウント | [account.md](./account.md) | 42 | 14 | 24 | 4 |`、`:40` を `| **合計** | | **319** | **133** | **161** | **25** |` に更新する。あわせて ADR 057 の「決定」に、`manual-tests/index.md` の集計行も追随対象であることを 1 句加えると、次に TC を足す人が同じ穴に落ちない。

---

## Warnings

- **[W-001]** `.thread/14/testing.md` がコード差分を「8 ファイル」と書いており、`plan.md` AC-63 / `steps.md` 17-3 の「9 ファイル」および実際の差分と食い違う
  - 場所: `.thread/14/testing.md:13`（冒頭「コード差分は **8 ファイル**（ポート JSDoc 4・`errorCode.ts` のコメント 2・`start.ts` のコメント 1・適合スイート 1）」）、`:確認項目 2` の期待結果の 8 ファイル列挙
  - 理由: `plan.md` AC-63 と `steps.md` 17-3 はどちらも **9 ファイル**（ステップ 8 の 8 ＋ ステップ 30 の適合スイート 1）と書き、ステップ 8 の内訳に `packages/core/src/application/di/containerStore.ts` を含めている。実際の PR も 9 ファイル（`containerStore.ts` を含む）で、AC-63 は満たされている。ところが `testing.md` は `containerStore.ts` を**列挙から落として 8 と数えている**。
    `testing.md` 確認項目 2 は「差分がちょうど 8 ファイル」「これ以外が出たらスコープ逸脱」と書いてあるので、**手順どおりに検証すると正しい PR が「スコープ逸脱」と判定される**。検証手順書としては誤りである。
  - 提案: `testing.md:13` と確認項目 2 の期待結果に `packages/core/src/application/di/containerStore.ts` を足し、件数を 9 に直す（内訳は「ポート JSDoc 4・`errorCode.ts` のコメント 2・`start.ts` のコメント 1・DI の JSDoc とエラーメッセージ 1・適合スイート 1」）。

- **[W-002]** 「参照ランタイムは 1 つ」と言い切った直後に、他ランタイム用の設定テンプレートがリポジトリに残っている
  - 場所: `apps/web/.dev.vars.example`（Cloudflare）、`apps/web/.env.aws.example`、`apps/web/.env.gcp.example`（いずれも `git ls-files` で追跡済み）、`.dockerignore:11`（`infra/aws/cdk.out`）、`.dockerignore:3`（`**/.wrangler`）
  - 理由: `CLAUDE.md:98` と `README.md:52` は「There is exactly one runtime wiring」「There is **one** runtime wiring」と断言し、`CLAUDE.md:43` は `apps/web/.env.example` を唯一の設定入口として案内する。実際 `apps/web/` を `ls` すると `.dev.vars.example` / `.env.aws.example` / `.env.gcp.example` が並び、`.dockerignore` は削除済みの `infra/aws/` を除外し続けている。**文章は正しいが、リポジトリの現物が文章を裏切っている**状態で、新規参加者は「AWS 用の設定もあるらしい」と読む。
    AC-20 の grep が `CLAUDE.md` / `README.md` / `docs/` の 4 ファイルに検査対象を絞っているため、この乖離は構造的に検出できない。
  - 提案: 3 つの `.env*.example` / `.dev.vars.example` を削除し、`.dockerignore` から `infra/aws/cdk.out` と `**/.wrangler` を落とす（ドキュメント PR の範囲を超えるなら、フォローアップ Issue として起票し、本 Issue の完了コメントに列挙する — スコープ外 7 件と同じ扱い）。

- **[W-003]** 本 PR が触ったファイルに、`spec/index.md` が禁じている「改訂履歴」の文が残っている
  - 場所: `spec/usecases/storage.md:506`（「以前は両者で異なっていた（ファイル側は消し切れなかったときだけの保険、ノート側はバッチごとの常用経路）が、…に揃った」）、`spec/testcases/storage/deleteFilesByOwner.md:12`、`spec/inventory/test.md:1742`（同趣旨の「以前あった『ファイル側は保険、ノート側は常用』という違いは解消している」）
  - 理由: `spec/index.md:5` は「進捗、レビュー記録、日付つきの改訂履歴、廃止済みの判断は置かず、変更の履歴は Git で管理する」と定めており、`CLAUDE.md:16` も同じことを言っている。上記 3 か所は「今こうである」ではなく「前はこうだったが直った」を語っており、規約違反。いずれも本 PR 以前からある文だが、**同じ 3 ファイルを本 PR が編集しており**、うち 2 か所は編集した行の隣接行である。spec の衛生を目的とする Issue で拾わないのは惜しい。
  - 提案: 3 か所とも「継続の形は `deleteNotesForOwner` と同一である（1 バッチ処理して残りがあれば専用の継続要求を 1 件積む）」だけに畳む。

- **[W-004]** `spec/domains/storage.md` の `ObjectStorage` 引き継ぎ段落に、設計ではなく同期作業の判断根拠が混ざっている
  - 場所: `spec/domains/storage.md`（`put` の段落 — 「…**契約を弱めた側として責務の移転をここに残す**。…**未実装なのでユースケース側の記述は狭めない**。**この経路を実装するスライスが、…そこで設計する。**」）
  - 理由: 前半（責務の移転を残す／要求元を名指しする／実装スライスが入口を広げる）は ADR 046 の「影響」が明示的に要求している内容で、spec に残るべき申し送りである。しかし「**未実装なのでユースケース側の記述は狭めない**」は、`spec/adr/046` を今回の同期作業にどう適用したかという**編集判断の説明**であって、設計の記述ではない。読み手（次のバックエンド実装者）に必要なのは「ポートはバイト列だけを受ける」「ストリーム要求元は `storeUpload` に既にある」「広げるのはそのスライスの仕事」の 3 点で、なぜ今回そう書かなかったかは Git 履歴と `.thread/14/` にある。
  - 提案: 当該 1 文を削る。残りの 3 点だけで申し送りとして完結している。

- **[W-005]** ADR 052 が定めた台帳ヘッダーの生成規則が、5 つの inventory のうち 2 つにしか書かれていない
  - 場所: `spec/inventory/adapter.md:5` と `spec/inventory/test.md:5` にはある。`spec/inventory/domain.md` / `spec/inventory/usecase.md` / `spec/inventory/frontend.md` には無い
  - 理由: ADR 052 の決定 2 は「新規ポートメソッドには通常どおり採番する。採番は各群の末尾に足し、出現順に挿入して既存 ID を繰り下げない。…**ID は行位置ではなく行の識別子**である」と、ADP に限らない一般規則として書いている。実際この PR は `spec/inventory/domain.md` に `DOM-*` を 8 行、`spec/inventory/usecase.md` に `UC-identity-022〜024` を 3 行、いずれも**群の末尾**に採番している。したがって domain / usecase の読み手も「行順と ID 順が一致しない」現象に出会うのに、その 2 ファイルにはヘッダーの説明が無く、行位置に意味があると誤読しうる。
    `plan.md` の AC-64 が `test.md` のヘッダーだけを求めたのは「`adapter.md` だけに書く非対称を作らない」（計画レビュー R3 arch:S-001）ためだったが、結果として 2 対 3 の非対称に置き換わっただけになっている。
  - 提案: `spec/inventory/domain.md` と `spec/inventory/usecase.md` のヘッダーにも 1 行加える（`frontend.md` は本 PR で新規採番していないので任意）。

- **[W-006]** `spec/inventory/test.md` に既存のリンク切れが 6 本ある（本 PR で新規に作ったものではない）
  - 場所: `spec/inventory/test.md:690`（`../../usecases/workspace.md`）、`:876`（`../../usecases/job.md`）、`:1520` / `:1635`（`../../domains/note.md`）、`:1819`（`../../adr/014-…`）、`:2194`（`../../adr/004-…`）
  - 理由: このファイルは `spec/inventory/` にあるので `../../` はリポジトリルートを指し、6 本とも解決しない（正しくは `../`）。`origin/main` にも同じ状態で存在するので本 PR の責任ではないが、本 PR は同ファイルを編集しており、B-001 と同型の欠陥である。同じ検査（変更ファイルの相対リンク解決）を 1 回回せば同時に取れる。
  - 提案: 6 本とも `../../` → `../` に直す。あわせて `spec/` 全域の相対リンク解決チェックを一度回す（変更ファイルに限った実行では、これ以外に切れているものは無かった）。

- **[W-007]** `docs/backend_implementation_example.md` の `removeIdentity` 例が、実装の主要な分岐を省略記号なしで別の振る舞いに置き換えている
  - 場所: `docs/backend_implementation_example.md:347`（`if (target === undefined) throw new NotFoundError("IDENTITY_NOT_FOUND", "…");`）
  - 理由: 実装 `packages/core/src/application/identity/removeIdentity.ts` では、`target === undefined` のとき**まず `identityRemovalReceiptStore.findByIdentityId` を引き、自分の receipt があれば「既に削除済み」として正常復帰する**（失われた応答の再送を receipt が答える、というこのユースケースの中心的な設計）。ドキュメントの例はその分岐を落とし、無条件 `throw` に置き換えているが、この行には `/* … */` のような省略マーカーが無く、他の省略箇所（`/* …the rest of the fields… */`）と扱いが違う。冒頭が「Every path and identifier below points at real code」と宣言しているので（フロント側の同趣旨の宣言に相当）、コピーして使うと receipt 経路が失われる。
  - 提案: 当該行を実装どおり 2 分岐にするか、`// 実装では receipt を引いて再送を吸収する（removeIdentity.ts 参照）` の 1 行コメントを添える。

- **[W-008]** `.thread/14/steps.md` / `adr.md` に、解決しない相対リンクが約 50 本ある
  - 場所: `.thread/14/steps.md:100`・`:515`、`.thread/14/adr.md:309`（いずれも `../adr/053-….md` — ファイル名に文字どおりの `…` が入っている）ほか、`../adr/*.md` / `../platform/index.md` 形式のリンク多数
  - 理由: いずれも `spec/` に書き込む本文をそのまま引用した結果で、`.thread/14/` から見ると解決しない。計画ファイルとしては読めるので実害は小さいが、コミットされた成果物である以上、リンクとして機能しないことは把握しておくべき（`plan.md` が「`research.md` / `research-2.md` は成果物である」と明言している以上、`steps.md` / `adr.md` も同格）。
  - 提案: 対応不要と判断してよい。もし直すなら、引用部分をリンクではなくインラインコード（`` `[ADR 053](../adr/053-….md)` ``）にすると引用であることも明示できる。

---

## 実地検証の結果（指摘に至らなかったが確認したこと）

事実照合はすべて実ファイルに当たった。以下はいずれも**正しかった**。

**`CLAUDE.md`**
- `pnpm dev|build|start` が `:node` の別名であること、`typecheck` が `tsgo && pnpm -r typecheck` であること — root `package.json` と一致
- domain の 8 フォルダ（common / conversion / identity / job / note / storage / usage / workspace）、application の 4 ドメイン + `ports/` `execution/` `scope.ts` `workers/` `cleanup/` `events/` `di/` `errors.ts`、adapters の `memory` / `node` / `oauth` / `conformance` — すべて実在（`application/types.ts` だけ列挙から漏れているが、記述の趣旨に影響しない）
- presentation の 5 ファイル（`serverAction.ts` の `loadServerDeps` / `serverData`、`errorResponseMiddleware.ts`、`serverFragment.tsx`、`validator.ts` の `validateInput`、`session.ts`）— 全部 export を確認
- フロントの参照実装 4 つ（`components/settings/ProfileForm/editor.tsx`、`components/settings/IdentityList/board.tsx`、`components/note/CreateNoteButton/`、`routes/notes/index.tsx` + `routes/notes/-action.tsx`）、スケルトン（`components/ui/Skeleton` / `note/NoteListSkeleton` / `settings/IdentityListSkeleton`）、`router.tsx` の `defaultPendingComponent` / `defaultPendingMs` / `defaultPendingMinMs` — 全部実在
- `createBlankNote` が `activateCreate` を 1 回だけ再試行する記述 — 実装と一致
- `config.ts` の内容（siteName / defaultTitle / defaultDescription / themeColor）、`lib/error.ts` の `CodedError` / `SerializedErrorBase` / `FieldErrors` / `SerializableError` — 一致
- Node ランタイムの 5 点（`server.node.ts` の `boot()`、`worker/node/runner.ts`、`scripts/listen.node.ts` が `dist/client` を `@hono/node-server` で serve、`di/memoryRuntime.ts` / `serverNode.ts` / `containerStore.ts`、`vite.config.node.ts`）— 一致
- `AGENTS.md -> CLAUDE.md` のシンボリックリンクは健在（`ls -l` で確認）

**`README.md`**
- `/notes` `/settings/auth` の実在、`flake.nix` / `.envrc` の実在、Quick Start の `cp apps/web/.env.example apps/web/.env`、Development commands の 13 スクリプトが root `package.json` と 1 対 1、「no schema to generate and no migration command」— すべて一致。旧「Database migrations」節は削除されている（AC-25）

**`docs/backend_implementation_example.md`**（AC-21）
- File Layout の全パスを実地確認（`domain/common/*.ts` 5 本、`application/{di,ports,events,execution,cleanup,workers}`、`adapters/{memory,node,oauth,conformance}`、`apps/web/app/presentation/*`）— 存在しないパスは 0
- 識別子: `buildEventDecoder` / `mintEventIdFor` / `pruneOutbox` / `DEFAULT_OUTBOX_RETENTION_MS` / `processOutboxEvents` / `dispatchDomainEvent` / `createInMemoryQueueDispatcher({ handler })` / `createInProcessRelayTrigger` / `createOccRepository` / `optimisticLockFailure` / `duplicateKey` / `deleteExpiredPage` / `MemoryBackend` / `MemoryTransactionController` / `MemTable` / `describeUnitOfWorkContract` / `describeNoteRepositoryContract` / `describeIdentityUniqueDirectoryContract` — 全部 export として実在
- `AllDomainEvents` の実際の union（Identity / IdentityContinuation / Note / Storage）と一致。`TagEvent` は「← extend」と明示された仮例なので問題なし
- `createBlankNote` の抜粋はコメント文言まで実装と一致
- `spec/usecases/usage.md:120` が規範として引用する「必要なユースケースが個別に OCC 再試行を組むことを認める」記述は `:424` に保存されている（plan.md リスク節の要求）
- 削除された節は無く、`### Port Conformance` が増えている

**`docs/frontend_implementation_example.md`**（AC-22）
- `grep -in "todo"` = 0 件
- `renderNoteList` / `renderNoteDetail`（`.validator(validateInput(noteDetailInputSchema))` 付き）、`loadNote` / `loadNotes` / `loadIdentities` / `loadProfile`（すべて `cache(serverData(...))`）、`createBlankNoteFn` / `signUpFn`、`routes/settings/-action.tsx` の `updateProfileFn` / `addPasswordFn` / `removeIdentityFn` / `uploadAvatarFn`、`presentation/pagination.ts` の `paginationSchema` / `paginationSearchSchema`、`errorResponse.ts` の `serializeError` / `redactForClient` / `httpStatusFor` / `AppServerError` / `isAppServerErrorShaped` / `extractSerializedError`、`errorDisplay.ts` の `renderErrorMessage` / `displayError` / `sanitizeRouteError`、`session.ts` / `auth.ts` の各関数、`AVATAR_MAX_BYTES` — すべて実在
- 「コード例外の閉じた一覧: `UNAUTHENTICATED` → 401 / `THROTTLED`・`LOCKED`・`RATE_LIMITED` → 429 / `NOTE_GONE` → 410」は `errorResponse.ts` の `HTTP_STATUS_BY_CODE` と完全一致
- `__root.tsx` の bare import による server function 登録、`storage.$.tsx` / `serverErrorLog.ts` / `__root.tsx` の `getContainer()` 直接呼び出し 3 例 — 実在
- 未採用パターン（TanStack Query / Composite Component / Conform）はすべて `> **Current status**: not adopted` で明示されており、`@tanstack/react-query` / `@conform-to/*` / `sonner` が `apps/web/package.json` に無いことも確認した

**ADR 052〜057**
- 見出し構成（`## ステータス` / `## コンテキスト` / `## 前提` / `## 決定` / `## 検討した代替案`（`###` で代替案ごと） / `## 影響`）が既存 ADR（046 / 051 を基準に照合）と一致。「承認済み」も統一
- 前提として引く ADR の妥当性: 052→026 / 053→039・046（本文 026・052） / 054→038・048（本文 046・026・028） / 055→前提はドメイン定数のみ / 056→024・026 / 057→029。**誤引用は無い**。054 が引く「一意性の強制がポート契約として残ること（ADR 028 の前提）」も index の依存マップと整合
- 内容はいずれも長寿命の設計判断で、作業ログではない。ADR 057 の「実際にそれが起きた。」は ADR 051 の「実際に起きた」と同じ既存様式なので許容範囲
- 採番: 052〜057 が連番、衝突なし。廃止済み 015 / 016 / 018 / 019 / 020 は index にも無く再利用されていない。`ls spec/adr/05[2-7]-*.md` = 6

**`spec/adr/index.md`**
- 「一覧」表と「前提依存マップ」の**両方**に 052〜057 の 6 行が入っている。依存マップの「依存している前提」列も各 ADR の `## 前提` と一致

**受け入れ基準の機械検査（自分で再実行）**
- AC-20 / AC-22 / AC-25 の実在しない固有名 grep → **0 件**
- AC-55: `DOM` 8 / `ADP` 8 / `UC` 3 → 期待どおり
- AC-64: `ls spec/testcases/identity/*.md | wc -l` = 24、`grep -c "^| UC-identity-"` = 24、`TC-identity-305`〜`322` が末尾採番、`TC-identity-024` は `completeOAuthSignIn` のまま
- AC-32 / AC-41: `IdentityErrorCode`（14 コード）/ `StorageErrorCode`（8 コード）が spec の union と**集合として完全一致**
- AC-58: `identity/errorCode.ts` の冒頭コメント全文削除、`storage/errorCode.ts` の 2 行削除、enum 定義行は 1 行も動いていない
- AC-16: `start.ts` の `AC-15` 参照が `spec/presentation/index.md` へ差し替わり、同ファイルの CSRF 規約表から `FormData` 条件が消えている。AC-17 の `Cache-Control: private, no-store` も `:183` にある
- AC-19a / AC-56: inventory 5 ファイルすべての「最終同期」が `2026-08-16`
- AC-59: 追加された主張は `it("ADP-common-008: …")` の中の 1 ブロックのみで、新しい `it` は増えていない
- AC-63: 実際のコード差分は 9 ファイル（`plan.md` と一致。ただし W-001 参照）
- AC-68: `steps.md` の「実行順」表は F0 を A の前に置き、内部順 5 組（`3→4→26` / `29→24` / `27` / `22→24` / `4→32`）を書き、「これ以外」の列挙（1, 2, 5, 6, 7, 23, 25, 28）から内部順を持つステップを除いている。**ただし後半のリンク実在は B-001 で不成立**
- 新設 3 テストケースファイルは既存 4 列様式（前提条件 / 操作 / 期待結果 / 実装ステータス、4 列目は空）に一致。`spec/usecases/identity.md` の新設 3 節も `### 概要` / `### 入力DTO` / `### 出力DTO` / `### 処理フロー` / `### エラーケース` の既存様式（同ファイルの 24 節すべてが同じ構成）に一致

---

## カバレッジ

一覧 52 件と 1 対 1（確認 **37** 件 ＋ スキップ **15** 件 = 52）。

**確認（37）**
- `CLAUDE.md`, `README.md`
- `docs/backend_implementation_example.md`, `docs/frontend_implementation_example.md`
- `apps/web/app/start.ts`
- `packages/core/src/adapters/conformance/scopeCleanupAdmissionStore.ts`, `packages/core/src/application/di/containerStore.ts`
- `packages/core/src/domain/identity/errorCode.ts`, `packages/core/src/domain/storage/errorCode.ts`
- `spec/adr/052-adapter-inventory-granularity.md`, `spec/adr/053-account-deletion-rollback-completion.md`, `spec/adr/054-provider-account-uniqueness-owner.md`, `spec/adr/055-session-expiry-derivation.md`, `spec/adr/056-performance-budget-placement.md`, `spec/adr/057-manual-test-followthrough.md`, `spec/adr/index.md`
- `spec/domains/identity.md`, `spec/domains/index.md`（ADR 053 リンクと `AppliedOperationStore` 言及のみ）, `spec/domains/storage.md`
- `spec/inventory/adapter.md`, `spec/inventory/domain.md`, `spec/inventory/frontend.md`, `spec/inventory/test.md`, `spec/inventory/usecase.md`
- `spec/manual-tests/account.md`
- `spec/platform/index.md`（ADR 056 の移送先段落と `### Scope DO` 見出しのみ）, `spec/presentation/index.md`（ADR 055 リンク・CSRF・Cache-Control のみ）
- `spec/testcases/identity/checkHandleAvailability.md`, `spec/testcases/identity/completeOAuthCallback.md`, `spec/testcases/identity/getProfile.md`, `spec/testcases/storage/deleteFilesByOwner.md`
- `spec/usecases/identity.md`（節構成・ADR リンクのみ）, `spec/usecases/storage.md`（ADR 056 リンクのみ）
- `.thread/14/plan.md`, `.thread/14/steps.md`, `.thread/14/testing.md`, `.thread/14/adr.md`

内訳: `.thread/14/` 4 ＋ ルート 2 ＋ `docs/` 2 ＋ コード 5 ＋ `spec/adr/` 7 ＋ `spec/domains/` 3 ＋ `spec/inventory/` 5 ＋ `spec/manual-tests/` 1 ＋ `spec/platform`・`spec/presentation` 2 ＋ `spec/testcases/` 4 ＋ `spec/usecases/` 2 = **37**

**スキップ（15）**
- `.thread/14/research.md`, `.thread/14/research-2.md` — 乖離台帳そのもの。台帳項目の妥当性はドメイン / ユースケース観点の担当で、ADR・ドキュメント観点からは `plan.md` の受け入れ基準経由で検証済み
- `packages/core/src/application/ports/accountDeletionManifestStore.ts`, `packages/core/src/application/ports/scopeCleanupAdmissionStore.ts`, `packages/core/src/application/ports/shareTokenProtector.ts`, `packages/core/src/domain/identity/ports/identityRepository.ts` — ポート契約 JSDoc の妥当性はアダプター / ドメイン観点の担当（対応する ADR 053 / 054 の記述との整合だけは ADR 側から確認済み）
- `spec/database/index.md` — DB 設計の内容は DB 観点の担当（ADR リンクは無し）
- `spec/domains/note.md`, `spec/domains/usage.md` — ドメイン契約の内容はドメイン観点の担当（052〜057 へのリンクは無し）
- `spec/pages/index.md`, `spec/scenario/account.md` — 画面・シナリオの内容は UI / シナリオ観点の担当（052〜057 へのリンクは無し）
- `spec/testcases/identity/requestPasswordReset.md`, `spec/testcases/identity/signUpWithPassword.md`, `spec/testcases/identity/startOAuthFlow.md` — 既存ファイルへの行追加・文言修正で、テスト観点の担当（採番規則の遵守は `spec/inventory/test.md` 側で確認済み）
- `spec/usecases/usage.md` — ユースケース内容はユースケース観点の担当。ただし `:120` の `docs/backend_implementation_example.md` 規範引用の維持だけは確認済み
