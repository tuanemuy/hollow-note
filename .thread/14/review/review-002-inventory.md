### 台帳（inventory）の整合性・ID 採番

#### Blockers

- **[B-001]** 台帳とポート契約の**唯一の追跡手段**として規範化した命名規約が、実物と一致していない（`describe` 名 0 件 / `it` 名 166 件）
  - 場所: `spec/adr/052-adapter-inventory-granularity.md:13,19,23,52` / `spec/inventory/adapter.md:5`
  - 理由: ADR 052 は「適合ケースには ID を採番しない」を決定し、その代償として**対応の追跡を命名規約に委ねている**。その規約を 4 か所で「`describe` 名に ADP ID を含める」と書き（コンテキスト `:13`、前提 `:19`、決定 `:23` の括弧内、影響 `:52`）、同じ文を `spec/inventory/adapter.md:5` のヘッダーにも新設した。しかし実測では `packages/core/src/adapters/conformance/*.ts` の `describe` は**全 34 本のうち ADP ID を含むものが 0 本**で、いずれもポート名（`` `IdentityUniqueDirectory conformance [${backendName}]` `` 形式）を名乗る。ADP ID を名乗るのは **`it` 名 166 本**である。本 PR の U8（M-11）が付け替えたのも 8 本すべて `it` 名で、`describe` 名は 1 文字も触っていない。つまり**この PR が ADR とヘッダーを新設し、同じ PR がその規範に反する形で ID を付けている**。ADR 052 が採番を省いた代償を払う仕組みそのものが記述どおりには機能しないので、新しいバックエンドの実装者が `spec/inventory/adapter.md` の指示どおり `describe` 名で ADP ID を引くとヒット 0 件になる。M-02 が「実装が spec を名指しで否定している状態」を解消の対象としたのと同じ面で、向きが逆の乖離を新設している
  - 提案: ADR 052 の 4 か所と `spec/inventory/adapter.md:5` の「`describe` 名」を「`describe` / `it` 名」（または「適合スイートのテスト名」）へ改める。同文言は `spec/adr/026-port-contract-and-conformance.md` にもあるが、026 は本 PR の対象外なので、Phase 5 の 6.（適合スイート全体への ADP ID 網羅を規約化するか決める項目）へ「026 の `describe` 名の文言も同時に直す」を 1 行足して受け皿にする

#### Warnings

- **[W-001]** 同じポートメソッドの DOM 行と ADP 行が、本 PR で新たに食い違った（M-32 で潰したのと同じクラスの残り 3 組）
  - 場所: `spec/inventory/domain.md:280`（`DOM-note-037`）/ `spec/inventory/adapter.md:206`（`ADP-note-021`）。同型が `DOM-common-013` ↔ `ADP-common-012`、`DOM-storage-034` ↔ `ADP-storage-020`
  - 理由: 3 組とも `origin/main` では DOM 行と ADP 行の要点欄が**一字一句同じ**だったが、本 PR は ADP 側だけを伸ばした。とくに `LocalNoteQueryService.search` は、`ADP-note-021` が新たに得た「`highlightedExcerpt` は投影が持つマークアップをエスケープし…」という主張が `spec/domains/note.md:525-528` の**描画契約**（ドメイン側の正本）に由来しており、アダプター実装の詳細ではない。M-32 が「本文の改訂に ADP 行だけが追随し DOM 行が置き去り」を欠陥として `DOM-common-009/018/020/022` を直した基準をそのまま当てると、この 3 組は同じ理由で残っている。残り 2 組（`begin` の再投入・`deleteMany` の不存在 key 許容）は DOM 行の「冪等に開始する」「冪等に削除する」でおおむね含意されるので、優先度は `DOM-note-037` が高い
  - 提案: `DOM-note-037` に `ADP-note-021` と同じエスケープ契約の 1 句を足す。`DOM-common-013` / `DOM-storage-034` は対の ADP 行と粒度をそろえるか、意図的に ADP 側だけ厚くするなら AC-19b の判断（適合ケース由来の主張はアダプター行だけに載せる）を ADR 052 に 1 文で書き足して、以後この非対称を欠陥と読ませない

- **[W-002]** 台帳の実測が受け入れ基準を追い越したまま、`plan.md` の採番系 AC が更新されていない（AC-63 だけが実測へ改まっている）
  - 場所: `.thread/14/plan.md:111`（AC-55）/ `:125`（AC-64）
  - 理由: AC-55 は「新規 19 行（`DOM-common-041,042` / `DOM-identity-060〜062` / `DOM-note-071,072` / `DOM-storage-038` / 対応する `ADP-*` 8 行 / `UC-identity-022〜024`）」と列挙するが、レビュー R1 の M-07 で `DOM-identity-063`（`AccountDeletionRetryPolicy`）が増えたので実測は **20 行**で、列挙にもこの ID が無い。同じく AC-64 は新規 TC を「新設 3 ファイルの行 ＋ `requestPasswordReset.md` の境界 2 行」と定義するが、実測の新規 TC 行は `TC-identity-305`〜**`329`** で、R1 の M-05 / M-24 / M-26 / M-27 / M-30 が足した 7 行（`323`〜`329`）が基準のどこにも現れない。M-61 は同じ事情で AC-63 のコード差分件数を実測（27 ファイル）へ改める判断を下しており、**台帳側の件数だけが取り残された**。AC-55 の grep 検査（`grep -cE "DOM-common-04[12]|DOM-identity-06[012]|…"` → 8）はパターンが `063` を含まないため合格し続けるので、機械検査ではこのずれを検出できない
  - 提案: AC-55 の「新規 19 行」を 20 行に改め列挙へ `DOM-identity-063` を足す（DOM 9 / ADP 8 / UC 3。`AccountDeletionRetryPolicy` はドメインサービスなので対応する ADP 行が無いことも 1 句添える）。AC-64 の採番範囲を `TC-identity-305`〜`329` の実測へ改め、R1 由来の 7 行の出所（M-05 / M-24 / M-26 / M-27 / M-30）を由来欄に書く。`.thread/14/adr.md` は ADR-031 で `DOM-identity-063` の判断を既に記録しているので、追記は plan 側だけで足りる

- **[W-003]** `UC-identity-024` の要点欄だけが `intent: "integration"` の拒否分岐を落としている
  - 場所: `spec/inventory/usecase.md:36`
  - 理由: 本 PR は M-24 の fix として、`spec/usecases/identity.md` の手順 3 とエラーケース表、`spec/testcases/identity/completeOAuthCallback.md`、`spec/inventory/test.md` の `TC-identity-328` の**4 か所すべて**に「`integration` は本スライスに受け皿が無いため state を無効として扱う」を入れた。ところが同じ PR が新設した `UC-identity-024` の要点欄は「flow state の `intent` だけを根拠に `completeOAuthSignIn` / `linkOAuthIdentity` へ振り分け」「state の不一致・期限切れ・経路の `:provider` 不一致はすべて `OAUTH_STATE_INVALID` に畳む」と書き、**判別共用体の 3 番目の arm と、同じコードへ畳む 4 つ目の条件**に触れていない。台帳だけを読むと `intent` が 2 値に見え、`UC-identity-024` は新設ユースケースなので実装者が最初に当たる行でもある
  - 提案: 要点欄の畳み込み条件の列挙に `intent` が `integration` の場合を 1 語加える（例: 「state の不一致・期限切れ・経路の `:provider` 不一致・受け皿の無い `integration` intent はすべて `OAUTH_STATE_INVALID` に畳む」）

#### 1 回目の修正の検証（triage の Key 単位）

実物と突き合わせた結果、**担当範囲の 10 Key はすべて正しく入っており、退行は 0 件**。

| Key | 検証結果 |
| --- | --- |
| M-07 | `spec/domains/identity.md:344` に既存 3 ドメインサービスと同じ様式（責務 + メソッド表 + 定数表）で定義。`DOM-identity-063` は identity 群の末尾。`retentionWindowMs` 120 日 / `maxTerminalAttempts` 8 / `windowStart` / `ensureRetryable` → `BusinessRuleError(AccountDeletionRetryLimitExceeded)` まで一致し、`spec/database/index.md:154` の 8 件 / 120 日の記述とも整合 |
| M-08 | `UC-storage-002` / `003` / `004` の 3 行すべてに同一文言（宣言 MIME・宣言サイズを入力から落とす）が入り、3 分の 1 だけ追随した状態は解消 |
| M-09 | `DOM-common-021` と `ADP-common-020` が同一文へ改訂され、対の `DOM-common-022` / `ADP-common-021` とも非対称の理由が読める |
| M-10 | `PAGE-p03-003` は `無効` を含み `VerifyEmailPanel` のコメントと整合。`PAGE-p03-004` は「確認済み・サインインが必要 / 使用済み」。`spec/pages/index.md:176` の 7 状態とも一致 |
| M-11 | 8 か所すべてが台帳の行と 1 対 1（下表）。ヘッダー範囲 5 本も追随 |
| M-12 | `deleteFilesByOwner.test.ts:252` から `TC-storage-043:` が外れ、`:358` の `it` が改訂後の行を指す |
| M-21 | 採番規則ヘッダーが `domain` / `adapter` / `usecase` / `test` の 4 ファイルに展開済み（`frontend.md` は新規採番なしで対象外の判断どおり） |
| M-32〜M-37 | 6 件とも反映済み（`DOM-common-009/018/020/022` / `ADP-identity-010` の ADR 054 追随 / `FormData` 条件 4 行の削除 / `PAGE-p47-001` から Cache-Control を外す / `PAGE-p40-004` の要素名改訂と ID 据え置き / `DOM-note-013` の双方向禁止と `reconstruct`） |
| M-15 | `spec/` 全域の相対リンク **918 本を実際に解決**して切れ 0 件（`spec/inventory/test.md` の 6 本 ＋ ADR 056 の 1 本を含む） |
| M-17 | `spec/manual-tests/account.md` の実測 42 / 14 / 24 / 4 と index の集計行・合計 319 / 133 / 161 / 25 が一致（列ごとの縦計も一致） |

M-11 の ADP ID ↔ 台帳行の対応（すべて既存メソッド行と 1 対 1、新規採番なし）:

| 適合スイートの `it` / ヘッダー | 台帳の行 |
| --- | --- |
| `ADP-common-041: describe reports the header…` | `AccountDeletionManifestStore.describe` |
| `ADP-common-040: describePersonalCleanup…` | `ScopeCleanupAdmissionStore.describePersonalCleanup` |
| `ADP-common-008: assertOwner rejects …and a completed barrier` | `ScopeCleanupAdmissionStore.assertOwner`（要点欄の完了済み拒否と一致） |
| `ADP-identity-041` 単記 3 本 / `ADP-identity-041/009` 連記 2 本 | `IdentityUniqueDirectory.beginRelease`（連記の `009` は `release`） |
| `ADP-identity-039: findPendingByUserAndPurpose…` | `AuthTokenRepository.findPendingByUserAndPurpose` |
| `ADP-identity-040: derives a 43-character…` | `SignInOAuthClient.deriveCodeChallenge` |
| `ADP-note-055/056: redactAuthor…both planes` | `Local` / `PublicNoteProjectionWriter.redactAuthor` |
| `ADP-storage-024: builds a stable public URL` | `ObjectStorage.publicUrl` |

適合スイートが名乗る ADP ID は **111 種すべてが台帳に実在**（`comm` で差分 0）。適合ケースに新規 ID を採番した箇所も 0 件。

#### 既存 ID の繰り下げ・付け替えの検査

`origin/main` と `HEAD` の 5 ファイルについて **ID → 要素**の写像を機械比較した（`ID | 要素` の 2 列だけを抽出して diff）。

- **繰り下げ・付け替えは 0 件。** 新規 ID はすべて各群の末尾への追加として現れ、既存 ID の行はどれも同じ要素を指したまま
- 要素名が変わった既存 ID は `PAGE-p40-004`（`アプリへ戻る` → `サインイン済みのリダイレクト（/ → P-10）`）の 1 件だけで、これは M-36 が「要素名を改め ID は据え置く」と決めたとおり
- TC 行の要素名の書き換え 6 件（`TC-identity-001` / `052` / `192` / `193` / `261` / `TC-storage-043`）は、いずれも同じテストケース本文の行を指したままの言い換え。`TC-identity-024` は `completeOAuthSignIn` の 1 件目、`TC-identity-304` は `verifyEmail` の並行消費のままで、AC-64 の据え置き条件を満たす
- 連番の穴・重複を全 ID 群（DOM 10 群 / ADP 10 群 / UC 9 群 / TC 9 群 / PAGE 32 群）で検査 — **gap 0 / duplicate 0**。`TC-identity` は 001〜329 が連番で埋まり、新規 `TC-identity-323`〜`329` は末尾採番になっている
- 「1 ユースケース = 1 テストケースファイル = 1 UC 行」— `spec/testcases/*/*.md` の**全 146 ファイル**について本文の行数と `spec/inventory/test.md` の TC 行数を突き合わせ、**不一致 0 件**。ファイル数と UC 行数も 9 ドメインすべてで一致（identity は 24 / 24 / `spec/domains/identity.md` のユースケース概要も 24、`spec/domains/index.md` の集計表も Identity 24 / 合計 146）
- ヘッダーの「生成元」「最終同期」は 5 ファイルとも `2026-08-16` に更新済み
- `PAGE-p25` の participant 完備の文言は狭められていない（`spec/pages/index.md:490` の機能行に「削除されるもの / されないもの（ワークスペース所有のノートは…作成者は『退会した利用者』と表示される）」が残り、`PAGE-p25-001` も同じ説明を保持）。`AppliedOperationStore` に inventory 行は採番されていない（AC-66 のとおり 0 件）
- 指摘への弁明・修正の経緯の残置は、台帳 5 ファイルと ADR 052〜057 に **0 件**（M-29 の「実際にそれが起きた。」も削除済み）

#### カバレッジ

- 確認: `spec/inventory/domain.md`, `spec/inventory/adapter.md`, `spec/inventory/usecase.md`, `spec/inventory/test.md`, `spec/inventory/frontend.md`, `spec/domains/identity.md`, `spec/domains/index.md`, `spec/domains/note.md`, `spec/domains/storage.md`, `spec/domains/usage.md`, `spec/usecases/identity.md`, `spec/usecases/storage.md`, `spec/usecases/usage.md`, `spec/database/index.md`, `spec/pages/index.md`, `spec/manual-tests/account.md`, `spec/manual-tests/index.md`, `spec/testcases/identity/addPasswordIdentity.md`, `spec/testcases/identity/checkHandleAvailability.md`, `spec/testcases/identity/completeOAuthCallback.md`, `spec/testcases/identity/completeOAuthSignIn.md`, `spec/testcases/identity/deleteAccount.md`, `spec/testcases/identity/getProfile.md`, `spec/testcases/identity/requestPasswordReset.md`, `spec/testcases/identity/signUpWithPassword.md`, `spec/testcases/identity/startOAuthFlow.md`, `spec/testcases/storage/deleteFilesByOwner.md`, `spec/adr/052-adapter-inventory-granularity.md`, `spec/adr/053-account-deletion-rollback-completion.md`, `spec/adr/054-provider-account-uniqueness-owner.md`, `spec/adr/055-session-expiry-derivation.md`, `spec/adr/056-performance-budget-placement.md`, `spec/adr/057-manual-test-followthrough.md`, `spec/adr/index.md`, `packages/core/src/adapters/conformance/accountDeletionManifestStore.ts`, `packages/core/src/adapters/conformance/authTokenRepository.ts`, `packages/core/src/adapters/conformance/identityUniqueDirectory.ts`, `packages/core/src/adapters/conformance/noteProjection.ts`, `packages/core/src/adapters/conformance/objectStorage.ts`, `packages/core/src/adapters/conformance/scopeCleanupAdmissionStore.ts`, `packages/core/src/adapters/conformance/signInOAuthClient.ts`, `packages/core/src/application/storage/__tests__/deleteFilesByOwner.test.ts`, `packages/core/src/domain/identity/errorCode.ts`, `packages/core/src/domain/storage/errorCode.ts`, `.thread/14/plan.md`, `.thread/14/steps.md`, `.thread/14/adr.md`, `.thread/14/review/triage.md`, `CLAUDE.md` — **49 件**
- スキップ: `.thread/14/review/` の残り 7 ファイル（`review-001.md` / `review-001-{docs,domain,general,inventory,presentation,usecase}.md`） — レビュー中間成果物で後続フェーズで削除される
- スキップ: `.thread/14/research.md`, `.thread/14/research-2.md`, `.thread/14/testing.md` — 乖離台帳と検証手順書。ID 採番の正本ではなく、件数・as-of の是正は docs / general 観点の担当
- スキップ: `README.md`, `docs/backend_implementation_example.md`, `docs/frontend_implementation_example.md`, `.dockerignore` — 台帳の生成元でも参照元でもない
- スキップ: `apps/web/.dev.vars.example`, `apps/web/.env.aws.example`, `apps/web/.env.gcp.example` — 削除のみ。ID を持たない
- スキップ: `apps/web/app/start.ts`, `apps/web/app/presentation/session.ts`, `apps/web/app/presentation/oauthStateCookie.ts`, `apps/web/app/components/settings/DeleteAccountPanel/ticketStorage.ts` — ADR 参照コメントの是正で、台帳の ID を名乗らない（presentation 観点）
- スキップ: `packages/core/src/application/di/containerStore.ts`, `packages/core/src/application/identity/{completeOAuthCallback,removeIdentity,uniqueness,view}.ts`, `packages/core/src/application/ports/{accountDeletionManifestStore,scopeCleanupAdmissionStore,shareTokenProtector}.ts`, `packages/core/src/domain/identity/ports/{identityRepository,identityUniqueDirectory}.ts` — JSDoc の是正で ADP / DOM ID を名乗らない（domain / usecase 観点）
- スキップ: `spec/platform/index.md`, `spec/presentation/index.md`, `spec/scenario/account.md` — 台帳行を持たない本文（`spec/inventory/frontend.md` への波及は PAGE 行として確認済み）
- スキップ小計 **34 件**。確認 49 ＋ スキップ 34 = **83 件**
