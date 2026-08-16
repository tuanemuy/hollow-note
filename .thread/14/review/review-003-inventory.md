### 台帳（inventory）の整合性・ID 採番

第 3 ラウンド（収束確認）。`triage.md` の R1（M-01〜M-61）/ R2（M-62〜M-87）と実物を突き合わせ、機械検査を実行した。

#### Blockers

なし。

**最優先の検査（既存 ID の指す要素が変わっていないか）は完全に通った。** `origin/main`（merge-base `55a5bb9`）と HEAD の 5 台帳から `ID → 要素` の写像を機械抽出して比較した結果は次のとおり。

| 台帳 | base 行数 | head 行数 | 消えた ID | 別要素へ付け替わった ID | HEAD の重複 ID |
| --- | --- | --- | --- | --- | --- |
| `domain.md` | 453 | 464 | 0 | 0 | 0 |
| `adapter.md` | 341 | 349 | 0 | 0 | 0 |
| `usecase.md` | 143 | 146 | 0 | 0 | 0 |
| `test.md` | 2408 | 2440 | 0 | 0 | 0 |
| `frontend.md` | 162 | 162 | 0 | 0 | 0 |

要素欄が変わった 8 行（`TC-identity-001` / `052` / `192` / `193` / `261` / `TC-storage-043` / `221` / `PAGE-p40-004`）はいずれも **同じ要素の言い換え**（M-05 / M-12 / M-26 / M-36 / M-66 / M-77 の fix）で、指す先の付け替えではない。

**新規採番はすべて群の末尾**（繰り下げ 0 件）:

| 群 | base 最大 | head 最大 | 追加 |
| --- | --- | --- | --- |
| `DOM-common` | 040 | 042 | 041, 042 |
| `DOM-identity` | 059 | 065 | 060〜065 |
| `DOM-note` | 070 | 072 | 071, 072 |
| `DOM-storage` | 037 | 038 | 038 |
| `ADP-common` | 039 | 041 | 040, 041 |
| `ADP-identity` | 038 | 041 | 039〜041 |
| `ADP-note` | 054 | 056 | 055, 056 |
| `ADP-storage` | 023 | 024 | 024 |
| `UC-identity` | 021 | 024 | 022〜024 |
| `TC-identity` | 304 | 335 | 305〜335 |
| `TC-usage` | 072 | 073 | 073 |

各群とも base は 001〜最大値が連番で埋まっており、末尾採番は穴を空けていない。

#### Warnings

- **[W-001]** M-79（DOM 行 ↔ ADP 行の非対称）と**同クラスが 8 組残っている**。
  - 場所: `spec/inventory/domain.md` / `spec/inventory/adapter.md`
  - 実測: 同じポートメソッドを指す DOM 行と ADP 行のうち、**`origin/main` では要点欄が一字一句同じで、HEAD では食い違う組は 11 組**ある。M-79 が挙げた 3 組（`DOM-note-037`↔`ADP-note-021` / `DOM-common-013`↔`ADP-common-012` / `DOM-storage-034`↔`ADP-storage-020`）は解消済み（一字一句一致を確認）。残る 8 組は未処理:

    | 要素 | DOM | ADP | 片側にしか無い主張 |
    | --- | --- | --- | --- |
    | `ObjectStorage.get` | `DOM-storage-033` | `ADP-storage-019` | ADP のみ「未知の key では null を返す」 |
    | `ObjectStorage.put` | `DOM-storage-032` | `ADP-storage-018` | ADP のみ「既存 key は上書きする」 |
    | `NoteRouteFanOutReader.listByCreatedBy` | `DOM-note-062` | `ADP-note-046` | DOM のみ「`tombstone` は unspecified」 |
    | `NoteRouteFanOutReader.listByScope` | `DOM-note-063` | `ADP-note-047` | DOM のみ「`tombstone` は unspecified」 |
    | `NoteRepository.listByOwner` | `DOM-note-031` | `ADP-note-015` | ADP のみ「ページ境界で重複・欠落を出さない」 |
    | `NoteRouteStore.resolveMany` | `DOM-note-052` | `ADP-note-036` | 「上限超過は」/「501 件目からは」（言い換え） |
    | `IdentityUniqueDirectory.reserve` | `DOM-identity-028` | `ADP-identity-007` | 双方が別の 1 句を持つ（言い換え） |
    | `IdentityRepository.insert` | `DOM-identity-031` | `ADP-identity-010` | ADP のみ「DB 側の一意制約は自由だが契約としては要求しない」＋ ADR 054 参照 |

  - 理由: M-79 のトリアージが立てた基準（M-32 由来 — 「ドメイン契約の保証はアダプター実装の詳細ではないので DOM 行にも書く」）を当てると、上 4 組は実質的な取りこぼしである。とくに `ObjectStorage.get` の `null` 返しは `spec/domains/storage.md` の interface が `Promise<ObjectBody | null>` と型で書いている契約そのもので、DOM 行だけがそれを落としている。`tombstone` unspecified はアダプター実装者に最も届く必要のある側（`adapter.md`）に無い。下 4 組は言い換えの差なので実害は小さい。
  - 提案: 上 4 組について、M-79 と同じ向き（薄い側へ 1 句足す）でそろえる。R2 の指摘が「実測で 3 組」と書いたのは**過少計数**で、判定基準そのものは正しかった。ADR 052 に例外規定を足す案は M-79 のトリアージが既に棄却しているのでそのまま採らない。

- **[W-002]** ADR 052 / `spec/inventory/adapter.md:5` が規範化した「連記は ID を短縮せず並べる」が、**本 PR が編集した `signInOAuthClient.ts` のヘッダーに適用されていない**。
  - 場所: `packages/core/src/adapters/conformance/signInOAuthClient.ts:41`（`* (ADP-identity-033/034, 040).`）
  - 実測: `grep -rn "ADP-identity-034" packages/` = **0 件**。ADR 052 の影響節は「全形への書き換えは**そのケースに触れた回で行う**」と定めており、本 PR はこの行を `(ADP-identity-033/034)` → `(ADP-identity-033/034, 040)` へ**実際に書き換えている**。M-71 が `ADP-note-055/056` → `ADP-note-055/ADP-note-056` を直したのと同じ 1 行の作業。
  - あわせて同ファイルの 4 ケースが ID を名乗らない（`:91` = `ADP-identity-033` `buildAuthorizationUrl`、`:116` / `:128` / `:155` = `ADP-identity-034` `exchangeCode`）。R1 の M-11 は同ファイルの `:80`（現 `:81`）1 本だけを対象にしたため、`ADP-identity-034` は台帳からスイートへ到達できないまま残った。
  - 理由: `.thread/14/adr.md` ADR-035 が到達不能 21 本の既知リストに `ADP-identity-034` を含めて明示的に繰り延べているので**規約と記録は矛盾していない**。ただし「触れた回で全形化する」という自ら定めた運用と、この回に触れた行の実態が合っていない。
  - 提案: `signInOAuthClient.ts:41` を `(ADP-identity-033, ADP-identity-034, ADP-identity-040)` へ。文字列のみの変更で振る舞いに影響しない。ケース名への ID 付与まで広げるかは任意（広げるなら ADR-035 の到達不能リストから 034 を落とす）。

- **[W-003]** M-80 と同クラスの AC 列挙の取りこぼしが `AC-56` に 1 件残っている。
  - 場所: `.thread/14/plan.md:112`（AC-56）
  - 実測: 本 PR が要点欄を書き換えた UC 行は **11 行**（`git diff` 実測）で、AC-56 の列挙は 9 行。差は **`UC-storage-002` / `UC-storage-003`**（R1 の M-08 由来の ADR 050 DTO 縮小追随）で、`grep -n "UC-storage-002" .thread/14/plan.md` は **0 件** — plan のどの AC もこの 2 行を指していない。
  - 理由: M-80 が AC-55 / AC-63 / AC-64 に対して「列挙に無い行が出たらスコープ逸脱、ではなく実測と列挙が一致するかで見る」という但し書きを入れた一方、同じ採番・台帳系の AC-56 だけがその処理を受けていない。
  - 提案: AC-56 の列挙に `UC-storage-002` / `UC-storage-003` を足す（1 語×2）。AC-55 / AC-64 と同じ但し書きを添えてもよい。

- **[W-004]** `PAGE-p21-001` / `PAGE-p21-002` の要点欄が、定義場所として指す本文に無い主張を持つ。
  - 場所: `spec/inventory/frontend.md:101,102` ↔ `spec/pages/index.md#P-21: プロフィール設定`
  - 実測: 台帳は「初期表示を `getProfile` から供給し」「入力中の重複候補は `checkHandleAvailability` から供給する」と書くが、`spec/pages/index.md` の P-21 節（機能 / 状態）に `getProfile` も `checkHandleAvailability` も現れない。他の PAGE 行はいずれも本文の機能・状態の言い換えに留まっている。
  - 理由: 「台帳は本文の生成物」（ADR 052 のコンテキスト、各台帳ヘッダーの生成元宣言）に対する逸脱で、R1 / R2 で最も多かった「片側だけ直して対になる側が置き去り」の向きが逆になった形（台帳が本文を追い越した）。AC-57 は `PAGE-p21-001,002` を更新対象に挙げているが、対になる本文の更新は求めていない。
  - 提案: P-21 の機能欄に供給元の 1 句を足すか、台帳側からユースケース名を落とす。害は小さいので判断はどちらでもよい。

#### 実行した検査（AC）

| AC | 検査 | 結果 |
| --- | --- | --- |
| AC-19a | 5 台帳の「最終同期」が更新されているか | **PASS**。5 ファイルとも `2026-08-09` → `2026-08-16`（`domain` / `adapter` / `usecase` / `test` / `frontend`） |
| AC-19b | ラウンド 4 の適合ケース 8 本の ADP 行が改訂されたか | **PASS**。`ADP-note-015` / `021` / `046` / `047` / `ADP-common-012` / `017` / `019` / `021` の 8 行すべてが `git diff` に現れる |
| AC-55 | 新規 22 行が各群末尾に追加され、既存 ID の指す要素が変わっていないか（ID 集合の差分で検査） | **PASS**。実測 22 行 = DOM 11（`common-041,042` / `identity-060〜065` / `note-071,072` / `storage-038`）＋ ADP 8（`common-040,041` / `identity-039〜041` / `note-055,056` / `storage-024`）＋ UC 3（`identity-022〜024`）。**消えた ID 0 件・付け替え 0 件**で列挙と完全一致 |
| AC-56 | 列挙した UC 行の要点欄が改訂されたか | **PASS（ただし W-003）**。列挙 9 行すべて改訂済み。実測は 11 行 |
| AC-57 | 列挙した既存行が本文改訂に追随しているか | **PASS**。`DOM-storage-032〜035` / `DOM-storage-006` / `DOM-usage-006` / `DOM-storage-012` / `ADP-common-008` / `ADP-common-025` / `ADP-storage-018〜020` / `TC-identity-268` / `TC-storage-043` / `PAGE-p21-001,002` / `PAGE-p25-001,003` が差分に存在。`ADP-storage-021`（`createDownloadUrl`）だけは無変更だが、本文（`spec/domains/storage.md` の interface）と既に一致しているので追随漏れではない |
| AC-64 | 3 ファイル存在 / `ls` = 24 / `UC-identity-` = 24 / TC 32 行の内訳 / 採番起点 | **PASS**。`ls spec/testcases/identity/*.md \| wc -l` = **24**、`grep -c "^\| UC-identity-"` = **24**。TC は `TC-identity-305`〜`335`（31）＋ `TC-usage-073`（1）＝ **32 行**で、内訳も plan の列挙と 1 件も違わない — `getProfile` 6（305〜309, 329）/ `checkHandleAvailability` 8（310〜315, 326, 327）/ `completeOAuthCallback` 6（316〜320, 328）/ `requestPasswordReset` 2（321, 322）/ `addPasswordIdentity` 3（323〜325）/ `completeOAuthSignIn` 1（330）/ `linkOAuthIdentity` 1（331）/ `updateProfile` 4（332〜335）/ `recalculateStorageUsage` 1（`TC-usage-073`）。`TC-identity-024` / `304` の指す要素も不変 |

#### 実行した検査（台帳の不変）

| 検査 | 結果 |
| --- | --- |
| 「1 ユースケース = 1 テストケースファイル = 1 UC 行」が全 9 ドメインで成立するか | **PASS**。conversion 4 / identity 24 / integration 15 / job 12 / note 36 / storage 13 / tag 14 / usage 7 / workspace 21 — ファイル数・`UC-{domain}-` 行数・`spec/usecases/{domain}.md` の `## ` 見出し数（「共通」節を除く）が全ドメインで一致 |
| TC ファイルの行数と `spec/inventory/test.md` の TC 行数が全ドメインで一致するか | **PASS**。conversion 133 / identity 335 / integration 193 / job 283 / note 759 / storage 246 / tag 144 / usage 73 / workspace 274 = **2440**、台帳の `TC-` 行も **2440**。**ファイル単位でも 146 ファイルすべて一致**（台帳の定義場所欄・要素欄の接頭辞の両方で照合） |
| TC 行の期待結果欄が対応する `spec/testcases/**` の期待結果と一致するか | **PASS**。2440 行を機械比較し、差は 10 件だけで**すべて相対リンクの深さの違い**（`spec/testcases/{domain}/x.md` の `../../adr/` ↔ `spec/inventory/test.md` の `../adr/`）。どちらも正しい深さで、内容の食い違いは 0 |
| 台帳の定義場所・`spec/` 内の相対リンクが実際に解決するか | **PASS**。`spec/**/*.md` の相対リンク全数と、5 台帳の定義場所ファイル全数が解決（M-15 / AC-68 / AC-61 の再発なし） |
| UC 行の要素が定義場所ファイルの `## ` 見出しとして実在するか | **PASS**。146 行すべて一致 |
| 台帳に無い ADP ID がスイートに出ていないか | **PASS**。conformance の ADP ID 集合 ⊆ `adapter.md` の ID 集合（余剰 0） |

#### 第 2 ラウンド（M-62〜M-87）の反映確認

台帳・ID 採番の観点に掛かる 14 件を実物で確認した。

| Key | 結果 | 根拠 |
| --- | --- | --- |
| M-62 | **反映済み** | `spec/adr/052` は決定 2 を「ケース名（`it` の第 1 引数）の先頭に ADP ID を置く。`describe` はスイート名だけを名乗り ID を持たない」へ改め、前提節を ADR 026 から引ける範囲（契約の正本 / 共有適合スイート）に留めて ID 命名規約を 052 自身の決定として立てている。`spec/inventory/adapter.md:5` と `spec/adr/index.md:114` も同文言。実態と照合: `describe` で ADP ID を含むもの **0 / 34**、ADP ID を名乗る `it` **166 本**、**ADP ID が `it` 文字列の先頭でないケースは 0 本**。ID を名乗らない 43 ケースのうち 38 は `AppliedOperationStore` / `DistributedOperationStore` / `IdentityRemovalReceiptStore` / `OutboxRepository` / `ScopeTaskScheduler`（台帳に ADP 行を持たないポート）と横断的主張なので規約に反しない。残り 4 本は W-002 |
| M-63 | **反映済み** | `spec/domains/identity.md:46` に `AvatarUrl`（既存 VO 節と同じ**フィールド**/**バリデーション**様式）、`:374` に `SameOriginPolicy`（2 用途を名指し、ADR 051 リンク）。`:102` は `avatarUrl: AvatarUrl \| null`、`:142` の `updateProfile` 引数は `avatarUrl?: AvatarUrl \| null` で `:150` に「`appUrl` を要するのでユースケース側で構築」の 1 句。台帳 `DOM-identity-064` / `065` も同粒度 |
| M-64 | **反映済み** | `TC-identity-330`（`completeOAuthSignIn`）/ `331`（`linkOAuthIdentity`）が末尾採番され、テストケースファイル側と期待結果が一致 |
| M-65 | **反映済み** | `spec/usecases/usage.md` の処理フロー手順 1 に検査、エラーケース表が 2 行、`spec/testcases/usage/recalculateStorageUsage.md:13` と `TC-usage-073`、`UC-usage-005` の要点欄すべてが `BusinessRuleError(InsufficientRole)` で同文 |
| M-66 | **反映済み** | `TC-storage-221` は削除ではなく書き換え（連番に穴なし）。台帳行とテストケース行が同文 |
| M-70 | **反映済み** | `spec/presentation/index.md:236` が 2 つの名前空間の帰属を明記し、`PAGE-p25-003` / `PAGE-p25-004` が同じ粒度。`failed` は削っておらず CHECK も広げていない。`.thread/14/plan.md:189`（Phase 5 の 16.）に生成経路の決定が追跡項目として起票骨子入り |
| M-71 | **反映済み** | `noteProjection.ts:87` = `it("ADP-note-055/ADP-note-056: …")`、`:13` ヘッダー = `ADP-note-028..034, ADP-note-055, ADP-note-056`。`grep -rn "ADP-note-056" packages/` が 2 件ヒット。`.thread/14/adr.md:1063` は「全数拾える」の主張を撤回し、短縮連記 **31 ケース / 到達不能 21 本**の実測を記録（**当方の再実測とも一致** — `it` 行の短縮連記は 31、到達不能 21 本の ID 列も完全一致） |
| M-72 | **反映済み** | `identityUniqueDirectory.ts:196` = `it("ADP-identity-041/ADP-identity-007: …")` |
| M-77 | **反映済み** | `requestPasswordReset.md:10` から全称否定の括弧が消え、`TC-identity-192` も同文 |
| M-78 | **反映済み** | `startOAuthFlow.md:5` と `TC-identity-264` の両方に `state` の 1 句（ADR 034 参照つき）。新規採番なし |
| M-79 | **部分反映** | 挙げられた 3 組は解消（一字一句一致）。同クラスが 8 組残る → **W-001** |
| M-80 | **反映済み** | AC-55 = 22 行 / AC-64 = 32 行 / AC-63 = 35 ファイルへ実測更新。**独立に実測して 3 つとも一致**（`git diff --name-status $(git merge-base origin/main HEAD) -- packages/ apps/` = 35 = 変更 32 / 削除 3 / 追加 0）。ただし同クラスが AC-56 に 1 件 → **W-003** |
| M-81 | **反映済み** | `UC-identity-024` の要点欄に「本スライスに受け皿の無い `integration` intent はすべて `OAUTH_STATE_INVALID` に畳む」 |
| M-82 | **反映済み** | **両方直っている**。`spec/inventory/frontend.md:20`（`PAGE-p03-004`）＝「確認済み・サインインが必要 / 使用済み / 期限切れ / 無効の 4 状態」＋主従の説明、`spec/pages/index.md:176`（P-03 状態行）＝「期限切れ（再送。サインインへの導線を再送フォームに従属させて添える）/ 無効（同上）」。隣接する `PAGE-p03-003` の 2 状態とも粒度が揃った |
| M-87 | **反映済み** | `updateProfile.md` に 4 行、`TC-identity-332`〜`335` が末尾採番、`updateProfile.test.ts` の `it` 名 3 本が ID を名乗る（`TC-identity-333 / TC-identity-334` は全形連記） |

参考（観点外だが同時に確認したもの）: M-83（`spec/database/index.md:1037` に `sha256(operationId + ":" + commandKey)` の畳み込み式）、M-84（否定形に絞った検査語が HEAD で 0 件）、M-85（`.dockerignore` から `!.env.*.example` が消え、`.env.*.example` の追跡ファイルも 0 件）、M-86（`計画レビュー R1` へ明示化）、M-17 / M-68（`spec/manual-tests/index.md` = `42 \| 14 \| 24 \| 4`、合計 `319 \| 133 \| 161 \| 25` が実測と一致）— いずれも反映済み。

**反映漏れ 0 / 反映ミス 0 / 新たな矛盾 0**（M-79 は部分反映で、残りは元の指摘が過少計数だったもの）。

#### カバレッジ

- 確認: `.dockerignore`, `.thread/14/adr.md`, `.thread/14/plan.md`, `CLAUDE.md`, `apps/web/app/components/settings/ProfileForm/action.ts`, `apps/web/app/presentation/session.ts`, `packages/core/src/adapters/conformance/accountDeletionManifestStore.ts`, `packages/core/src/adapters/conformance/authTokenRepository.ts`, `packages/core/src/adapters/conformance/identityUniqueDirectory.ts`, `packages/core/src/adapters/conformance/noteProjection.ts`, `packages/core/src/adapters/conformance/objectStorage.ts`, `packages/core/src/adapters/conformance/scopeCleanupAdmissionStore.ts`, `packages/core/src/adapters/conformance/signInOAuthClient.ts`, `packages/core/src/application/identity/__tests__/checkHandleAvailability.test.ts`, `packages/core/src/application/identity/__tests__/getProfile.test.ts`, `packages/core/src/application/identity/__tests__/updateProfile.test.ts`, `packages/core/src/application/identity/addPasswordIdentity.ts`, `packages/core/src/application/identity/changePassword.ts`, `packages/core/src/application/identity/getProfile.ts`, `packages/core/src/application/storage/__tests__/deleteFilesByOwner.test.ts`, `packages/core/src/domain/identity/errorCode.ts`, `packages/core/src/domain/identity/ports/authTokenRepository.ts`, `packages/core/src/domain/identity/ports/identityRepository.ts`, `packages/core/src/domain/identity/ports/identityUniqueDirectory.ts`, `spec/adr/052-adapter-inventory-granularity.md`, `spec/adr/index.md`, `spec/database/index.md`, `spec/domains/identity.md`, `spec/domains/index.md`, `spec/domains/note.md`, `spec/domains/storage.md`, `spec/domains/usage.md`, `spec/inventory/adapter.md`, `spec/inventory/domain.md`, `spec/inventory/frontend.md`, `spec/inventory/test.md`, `spec/inventory/usecase.md`, `spec/manual-tests/account.md`, `spec/manual-tests/index.md`, `spec/pages/index.md`, `spec/presentation/index.md`, `spec/testcases/identity/addPasswordIdentity.md`, `spec/testcases/identity/checkHandleAvailability.md`, `spec/testcases/identity/completeOAuthCallback.md`, `spec/testcases/identity/completeOAuthSignIn.md`, `spec/testcases/identity/deleteAccount.md`, `spec/testcases/identity/getProfile.md`, `spec/testcases/identity/linkOAuthIdentity.md`, `spec/testcases/identity/requestPasswordReset.md`, `spec/testcases/identity/signUpWithPassword.md`, `spec/testcases/identity/startOAuthFlow.md`, `spec/testcases/identity/updateProfile.md`, `spec/testcases/storage/deleteFilesByOwner.md`, `spec/testcases/storage/storeUpload.md`, `spec/testcases/usage/recalculateStorageUsage.md`, `spec/usecases/identity.md`, `spec/usecases/storage.md`, `spec/usecases/usage.md`（58 件）
- スキップ: `.thread/14/review/review-001-docs.md`, `.thread/14/review/review-001-domain.md`, `.thread/14/review/review-001-general.md`, `.thread/14/review/review-001-inventory.md`, `.thread/14/review/review-001-presentation.md`, `.thread/14/review/review-001-usecase.md`, `.thread/14/review/review-001.md`, `.thread/14/review/review-002-docs.md`, `.thread/14/review/review-002-domain.md`, `.thread/14/review/review-002-inventory.md`, `.thread/14/review/review-002-presentation.md`, `.thread/14/review/review-002-usecase.md`, `.thread/14/review/review-002.md`, `.thread/14/review/triage.md` — レビュー中間成果物（後続フェーズで削除。`triage.md` は既出判定として**読んだ**が、レビュー対象としては採点しない）
- スキップ: `.thread/14/research.md`, `.thread/14/research-2.md`, `.thread/14/steps.md`, `.thread/14/testing.md` — 乖離台帳・手順書。ID 採番の正典ではなく、M-19 の as-of 宣言で HEAD 追随の対象外と決着済み（general / docs 観点の担当）
- スキップ: `README.md`, `docs/backend_implementation_example.md`, `docs/frontend_implementation_example.md`, `spec/platform/index.md`, `spec/scenario/account.md` — 台帳の生成元でも参照先でもない（docs / general 観点の担当）
- スキップ: `apps/web/.dev.vars.example`, `apps/web/.env.aws.example`, `apps/web/.env.gcp.example` — 削除ファイル。ID を持たない（M-46 / M-85 の帰結は `.dockerignore` 側で確認済み）
- スキップ: `apps/web/app/components/settings/DeleteAccountPanel/ticketStorage.ts`, `apps/web/app/presentation/oauthStateCookie.ts`, `apps/web/app/start.ts` — ADR 番号の dangling 参照修正のみで台帳 ID を名乗らない（presentation 観点の担当）
- スキップ: `packages/core/src/application/di/containerStore.ts`, `packages/core/src/application/identity/completeOAuthCallback.ts`, `packages/core/src/application/identity/removeIdentity.ts`, `packages/core/src/application/identity/uniqueness.ts`, `packages/core/src/application/identity/view.ts`, `packages/core/src/application/ports/accountDeletionManifestStore.ts`, `packages/core/src/application/ports/scopeCleanupAdmissionStore.ts`, `packages/core/src/application/ports/shareTokenProtector.ts`, `packages/core/src/domain/storage/errorCode.ts` — JSDoc / コメント文言の修正で ID 採番に触れない（domain / usecase 観点の担当）
- スキップ: `spec/adr/053-account-deletion-rollback-completion.md`, `spec/adr/054-provider-account-uniqueness-owner.md`, `spec/adr/055-session-expiry-derivation.md`, `spec/adr/056-performance-budget-placement.md`, `spec/adr/057-manual-test-followthrough.md` — 台帳の粒度・ID 規約を定めるのは 052 のみ。他 5 本の内容は domain / presentation / docs 観点の担当（052 との整合と `spec/adr/index.md` の行は確認済み）

確認 58 ＋ スキップ 43 = **101 件**。

#### 収束判定

- 実装レビューを終えてよいか: **はい**。Blocker は 0 で、最優先の「既存 ID の指す要素が変わっていないか」は 5 台帳 3663 行を機械比較して**消えた ID 0 / 付け替え 0 / 重複 0**。第 2 ラウンドの 14 件は反映漏れ・反映ミス・新たな矛盾ともに 0 件で、M-79 のみ元の指摘が過少計数だったぶん 8 組が残る（W-001）。W-001〜W-004 はいずれも台帳・plan・コメント文字列に閉じ、振る舞いにも ID の一意性にも影響しないため、本 PR のマージを止める理由にはならない。
