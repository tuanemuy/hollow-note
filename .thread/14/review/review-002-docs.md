# レビュー R2 — ADR・プロジェクトドキュメント・乖離台帳

**対象:** PR #22（`origin/main...HEAD`、83 ファイル）
**観点:** ADR / `CLAUDE.md` / `README.md` / `docs/` / 乖離台帳（`research.md` / `research-2.md`）/ `plan.md` の受け入れ基準
**既出判定:** `.thread/14/review/triage.md` を読み、`wont-fix`（M-50）/ `defer`（M-06）および fix 済み Key は再指摘していない

## ADR・プロジェクトドキュメント・乖離台帳

### Blockers

- **[B-001]** ADP ID と適合ケースの対応を追う手段を `describe` 名と規定しているが、`describe` 名に ADP ID を持つケースは **0 件**（実体は `it` 名 166 件）。しかも ADR 052 はこの命名規約を **ADR 026 の決定として引用している**が、ADR 026 にその規定は無い
  - 場所: `spec/adr/052-adapter-inventory-granularity.md:13`（コンテキスト）/ `:19`（**前提**）/ `:23`（決定）/ `:52`（影響）、`spec/inventory/adapter.md:5`（台帳ヘッダーの生成規則）、`spec/adr/index.md:114`（前提依存マップの前提欄）
  - 理由: 実測。`grep -rn 'describe(' packages/core/src/adapters/conformance/*.ts | grep -c "ADP-"` = **0**。ADP ID を名乗るのは `it` 名で **166 件**（無印は 42 件）。`describe` の第 1 引数は `` `UserRepository conformance [${backendName}]` `` 形式のスイート名だけで、ADP ID を入れる場所ではない。R1 の M-11 / U8 が付け替えたのも `it` 名である（`accountDeletionManifestStore.ts:100` / `identityUniqueDirectory.ts` 5 本 / `noteProjection.ts:87` / …）。つまり **本 PR は、自分が新設した規約が名指しする追跡手段を、自分の修正で別の場所に実装した**。ADR 052 はこの命名規約を「適合ケースには ID を採番しない」判断の唯一の代替追跡手段として置いているので、名前が違えば追跡手段そのものが `spec/` から辿れない
  - さらに `:19` の**前提節**は「ADP 行との対応を `describe` 名の命名規約で追うこと（[ADR 026](./026-port-contract-and-conformance.md)）」と書くが、`spec/adr/026-port-contract-and-conformance.md` の決定 2 は「`describeXxxContract(name, makeBackend)` 形式のスイートを置き」「ケースの根拠は spec のポート契約文とし」までで、**ID を名乗る命名規約はどこにも無い**。前提節は ADR が依存する既存決定を正確に引くための節で、そこに存在しない決定を引くと、056 / 052 に掛かる ADR を辿る読者が根拠に到達できない（M-18 で台帳側から潰したのと同型の「実在する番号に着地するが中身が違う」誤引用）
  - 提案: 4 か所すべてを実装に合わせて `it` 名（連記を許す旨は `.thread/14/adr.md` ADR-029 の決定）へ直す。`spec/adr/052:19` の前提は ADR 026 から引ける範囲（「契約の正本がポート定義にあり、検証が共有適合スイートであること」）に留め、**ID 命名規約は 052 自身の決定として立てる**（026 には無いのだから 052 が新設したことになる）。あわせて `spec/inventory/adapter.md:5` と `spec/adr/index.md:114` の文言を同じ語にそろえる。1 語ずつの差し替えで振る舞いには影響しない

### Warnings

- **[W-001]** `.thread/14/adr.md` ADR-030 の影響節が挙げる検証コマンドが、HEAD で 0 件にならない
  - 場所: `.thread/14/adr.md:1096`
  - 理由: 「`grep -rn "the spec writes\|the spec's" packages/ apps/` が 0 件になり」と書くが、実測は **2 件**（`packages/core/src/application/identity/uniqueness.ts:193` / `application/identity/updateProfile.ts:36`）。どちらも spec を**否定**しておらず（"per the spec's convergence" / "the spec's spelling of"）ADR-030 の決定そのものは達成されているが、影響節が読者に渡した機械検査は落ちる。ADR-024 / ADR-031 が同じ様式で書いた grep（`rejected attempt` = 0 件）は実際に 0 件で通るので、ここだけ検査として成立しない
  - 提案: 検査語を否定形に絞る（例: `"the spec writes"` / `"which cannot represent"` / `"spec の記載漏れ"`）か、影響節から grep を落として決定文だけを残す

- **[W-002]** `.thread/14/adr.md` ADR-029 が挙げる到達性の検査を、ADR-029 自身が決めた連記形式が破っている
  - 場所: `.thread/14/adr.md:1062`
  - 理由: 「`grep -o "ADP-[a-z]*-[0-9]*" packages/core/src/adapters/conformance/` が採番済み ID を全数拾えるようになり、台帳 → スイートの到達性が回復する」と書くが、`it("ADP-note-055/056: …")` から `-o` が取れるのは `ADP-note-055` だけで、**`ADP-note-056` はスイート内の他のどこにも単独で現れない**（実測: `grep -rn ADP-note-056 packages/` = 0 件）。`ADP-identity-041/009` の `009` は別ケースが単独で名乗っているので拾えるが、`ADP-note-056` は拾えない。加えてコマンドにディレクトリを渡していて `-r` が無いのでそのままでは動かない
  - 提案: 影響節の検査を連記に対応した形（`grep -rhoE "ADP-[a-z]+-[0-9]+(/[0-9]+)*"` を分解する、あるいは台帳の ID 集合とスイート出現集合の差分を取る）に直すか、「連記した ID は `-o` の素朴な抽出では拾えない」をトレードオフ側に明記する。ADR-029 のトレードオフ節は「1 対 1 でなくなる」までしか言っておらず、到達性が一部落ちることに触れていない

- **[W-003]** `plan.md` AC-64 の「採番対象」の列挙が、R1 修正後の実測に追随していない
  - 場所: `.thread/14/plan.md:125`（AC-64）
  - 理由: AC-64 は採番対象を「新設 3 ファイルの行だけでなく、ステップ 32-2 が `requestPasswordReset.md` に足す発行間隔の境界 2 行も含む」と閉じた列挙で書いている。実測は `TC-identity-305`〜`329` の **25 行**で、内訳は `getProfile` 6 / `checkHandleAvailability` 8 / `completeOAuthCallback` 6 / `requestPasswordReset` 2 / **`addPasswordIdentity` 3**。最後の 3 行は R1 の M-05（U2）が足した分で、AC-64 の列挙に入っていない。U11 は AC-63 を実測 27 ファイルへ改めたのに、同じ理由で動いた AC-64 は改めていない。AC-63 と同じく「列挙に無い行が出たらスコープ逸脱」と読む検証者が、正しい PR を逸脱と判定しうる
  - 提案: AC-64 の列挙に `addPasswordIdentity` の 3 行（M-05 由来）を足し、必要なら合計 25 行と `TC-identity-329` を実測値として書く。AC-63 が持つ「実測へ改めた」注記と同じ形で足りる

- **[W-004]** `.dockerignore` に、U9 の削除で対象を失った否定パターンが残っている
  - 場所: `.dockerignore:11`（`!.env.*.example`）
  - 理由: U9（M-46）は同ファイルから `**/.wrangler` / `infra/aws/cdk.out` の 2 行を落としたが、その直後の `!.env.*.example` は削除した 3 本（`.dev.vars.example` は別形、`.env.aws.example` / `.env.gcp.example`）を再包含するための行だった。実測すると `.env.*.example` に一致する追跡ファイルは **0 件**（残るのは `apps/web/.env.example` = 直前の `!.env.example` が拾う、と `.envrc.example` = そもそも `.env.` で始まらない）。M-46 が指摘した「現物が文章を裏切っている」のと同じ面で、片側だけ直して対になる行が残った形
  - 提案: `!.env.*.example` を落とす。Phase 5 の 13.（`.dockerignore` をファイルごと消すか）はこの行に触れていないので、骨子に 1 語足すか本 PR で落とすかのどちらかにする

- **[W-005]** 乖離台帳の見出しが「レビュー R1」を、本 PR のレビュー R1 とは別の意味で使っている
  - 場所: `.thread/14/research-2.md:448`（`### F. レビュー R1 で増えた差（1 件）`）/ `:531`（分類別内訳の同名行）
  - 理由: 台帳は冒頭で as-of `55a5bb9` を宣言しており（M-19 で入った）、本 PR のレビュー R1 より前の状態を記録する成果物である。したがってここの「レビュー R1」は**計画レビュー R1** を指すはずだが、同じ `.thread/14/` の `plan.md` / `adr.md` / `review/triage.md` は「レビュー R1」を**PR レビュー R1**の意味で一貫して使っている（`adr.md:972`「Proposed（レビュー R1 の M-13 / U5 で判断）」、`plan.md:210`「レビュー R1 の修正まで含めた実測は 27 ファイル」）。同じ語が同じディレクトリで 2 つのラウンドを指し、しかも台帳側は「as-of 以降の出来事が台帳に混ざっている」と誤読させる。M-56 が台帳からレビュー経緯を落とした結果、この 1 語だけが残った
  - 提案: 台帳側を「計画レビューで増えた差」または由来を書かない中立な見出し（`F. アップロード受理判定の入口`）へ改める。plan.md の他所は `計画レビュー R1 / R2 / R3` と明示しているので、台帳だけが省略形になっている

### 1 回目の修正の検証結果（本観点が担当する Key）

| Key | 内容 | 判定 |
| --- | --- | --- |
| M-15 | ADR 056 リンクの深さ ＋ `spec/inventory/test.md` の 6 本 | **正しく入っていた**。`spec/` 全 253 ファイル・918 本の相対リンクをファイル存在とアンカー実在の両方で解決して **切れ 0 件**。`spec/testcases/storage/deleteFilesByOwner.md` は `../../adr/`、`spec/inventory/test.md` は `../adr/` で正しい |
| M-16 | `spec/domains/identity.md` のユースケース概要 21 → 24 | **正しく入っていた**。`:574` の列挙は 24 個で、`spec/usecases/identity.md` の 24 節（`## 共通の約束` を除く 25 見出し）/ `spec/testcases/identity/*.md` 24 本 / `UC-identity-*` 24 行と**順序も含めて**一致 |
| M-17 | `spec/manual-tests/index.md` の集計 | **正しく入っていた**。10 ファイルを自分で数え直し、`account.md` = 42 / 14 / 24 / 4、合計 319 / 133 / 161 / 25 が**全列で一致**（他 9 カテゴリーの行も実測と一致） |
| M-18 | `spec/adr/022` 誤引用 | **正しく入っていた**。`research-2.md:318` は `.thread/2/adr.md` ADR-057 / ADR-022 と `spec/adr/056:11` を併記し、「`spec/adr/022` ではない」と明示 |
| M-19 | 台帳への as-of 宣言 | **正しく入っていた**。`research.md:5` / `research-2.md:5` の両方に同文の as-of `55a5bb9` 宣言（読み方と振り直さない理由つき） |
| M-29 | ADR 057 からの経緯記述の削除 | **正しく入っていた**。`spec/adr/057:39` は「同じ論点が次のレビューで再燃する。」で終わり、「実際にそれが起きた。」は無い |
| M-45 | `.thread/14/testing.md` のファイル数 | **正しく入っていた**。件数を写さず AC-63 を正典として参照する形に変わっている（`:13` / `:75`）。副次的に確認した基準値（`pnpm test:unit` = 76 ファイル・925 passed・3 skipped）も HEAD で実測一致 |
| M-47 | 改訂履歴の文 3 か所 | **正しく入っていた**。`spec/usecases/storage.md:500` / `spec/testcases/storage/deleteFilesByOwner.md` / `spec/inventory/test.md:1748` のいずれも「今こうである」だけを書く。`spec/` 全域を改訂履歴語で引いても残置は 0 件 |
| M-48 | `ObjectStorage.put` の編集判断の混入 | **正しく入っていた**。`spec/domains/storage.md:306` は責務の移転・要求元の名指し・実装スライスの引き継ぎの 3 点だけを残し、「未実装なので狭めない」の 1 文が消えている |
| M-49 | `docs/backend_implementation_example.md` の `removeIdentity` 例 | **正しく入っていた**。`:334` の例に `identityRemovalReceiptStore.findByIdentityId` による正常復帰の分岐が入り、実装 `removeIdentity.ts:71-81` と一致する |
| M-51 | 逆引き表の件数 4 行 | **正しく入っていた**。23 行すべてを数え直して件数と ID 数が一致 |
| M-52 | 分類別内訳の合計 | **正しく入っていた**。A11+B7+C9+D10+E2+F1+G2+H1+**I1** = 44 で、集計表の 44 と一致 |
| M-53 | 自ファイル行番号参照 | **正しく入っていた**。`:10` は「本ファイル『集計』節の表と一致」と見出し名で指す |
| M-54 | PR #17 の ADR 本数 | **正しく入っていた**。`research-2.md:19` / `research.md:334` とも「ADR 29 本（`023`〜`051`）＋ `index.md` の計 30 ファイル」で一致 |
| M-55 | 未決着時の一人称の意見表明 | **正しく入っていた**。`## 台帳の外で決着した論点` の 6 行に畳まれ、「私は〜を推す」等は 0 件 |
| M-56 | レビュー経緯 23 か所 | **不完全（1 か所残置）** → W-005。訂正の結果は残り経緯文は落ちているが、`F.` 群の見出しだけが「レビュー R1」を名乗ったまま |
| M-57 | 自己否定の並置段落 | **正しく入っていた**。`research.md` に打ち消し合う段落は残っていない |
| M-58 | `#クエリ予算` アンカー | **正しく入っていた**。`research-2.md:313` は「`#クエリ予算` という見出しは存在しない」と明記して `### Scope DO` を指す |
| M-59 | SYNC-237 の受け皿一覧 | **正しく入っていた**。`:542` は「#3 / #4 / #5 / #7。起票単位は `plan.md` Phase 5 の 7. が正」で plan と一致 |
| M-60 | 凍結前提・件数の陳腐化 | **正しく入っていた**。`.thread/1/` 凍結を前提にした記述は消え、`research.md:203` の note.md エラーケース行は実測どおり 7 か所 |

**退行:** 0 件。片側だけ直して対を置き去りにした修正は見つからなかった（W-004 は U9 が触った同一ファイル内の残置なので「退行」ではなく取りこぼしとして扱う）。

### `.thread/14/adr.md` ADR-027〜032 の妥当性

いずれも決定の内容は妥当で、既存の判断と矛盾しない。個別の確認:

- **ADR-027**（`UnauthorizedError` / `ValidationError("UNAUTHENTICATED")` の使い分けを presentation で立法しない）— 妥当。`spec/presentation/index.md:196,197` に `unauthorized | 401` / `forbidden | 403` の 2 行が入り、`forbidden` には「どの経路も投げない / 権限不足は `NotFoundError` へ畳む」が添えられている。`spec/index.md` が正典から進捗を排する立場とも整合
- **ADR-028**（サービス全体の既定を PAGE 行へ写さない）— 妥当。判定基準（「その記述が画面ごとに違いうるか」）が次回以降も適用できる形で書かれている
- **ADR-029**（連記の許可）— 決定は妥当。ただし影響節の検査が自分の決定で破れている（W-002）。また **B-001 が示すとおり、連記の許可は「`describe` 名で追う」という 052 の文言と噛み合っておらず、ADR-029 が「ADR 052 の本文を改訂して連記を明文化する」を代替案として棄却した根拠（「連記は 052 の不変を一切侵していない」）は、052 の文言が `it` 名に直った後で再確認が要る**
- **ADR-030**（実装 JSDoc は spec を名指しで否定しない）— 妥当。`errorCode.ts` の全文削除と `uniqueness.ts` / `removeIdentity.ts` / `view.ts` の扱いを揃えた点は AC-58 との非対称の解消として筋が通る。影響節の grep のみ不正確（W-001）
- **ADR-031**（`AccountDeletionRetryPolicy` が数えるのは terminal 行）— 妥当かつ**実物への反映も完全**。`grep -rn "rejected attempt" spec/` = 0 件、`spec/usecases/identity.md:771,814` / `spec/testcases/identity/deleteAccount.md:18` / `spec/inventory/test.md:193` の 4 か所すべてが「保持中の terminal 行（`completed` / `rejected`）」へそろっており、`domain/identity/services/accountDeletionRetryPolicy.ts` の実装（`retentionWindowMs` 120 日 / `maxTerminalAttempts` 8 / `windowStart` / `ensureRetryable`）と一致。`spec/domains/identity.md:344-362` の節は既存 3 ドメインサービスと同じ様式、`DOM-identity-063` も採番済み。`ExternalServiceError` を先送りして `rejected attempt` は今直す非対称の線引き（裏づけが揃っているか）も明示されている
- **ADR-032**（台帳の行番号を振り直さず as-of を宣言する）— 妥当。M-50 を wont-fix にした判断との整合もトレードオフ節で明示されている

### `plan.md` AC-63（27 ファイル）の検証

**実測と一致する。** `git diff --name-status $(git merge-base origin/main HEAD) -- packages/ apps/` = **27 件 = 変更 24 / 削除 3 / 追加 0** で、`plan.md:219-254` の内訳表 27 行と**集合として 1 対 1**（過不足なし）。

「振る舞いを変える差分がゼロ」も検証可能な形で残っており、実際に再現できた:

```
git diff -U0 <merge-base> -- 'packages/**/*.ts' 'apps/**/*.ts' 'apps/**/*.tsx' \
  | grep -E '^[+-]' | grep -vE '^(\+\+\+|---)' \
  | grep -vE '^[+-]\s*(\*|/\*\*?|//)' | grep -vE '^[+-]\s*(it|describe)\('
```

残りは **12 行**ちょうどで、内訳も AC-63 の記述どおり — (a) `conformance/scopeCleanupAdmissionStore.ts` の `ADP-common-008` ケースへの追加アサーション **9 行**（区切りの空行 1 を含む）、(b) `containerStore.ts` のエラーメッセージ文字列 **3 行**（`server.cloudflare.ts` の言及を落とす 2 行削除 ＋ 1 行追加）。それ以外の追加・削除行はすべてコメント / JSDoc / `it` 名の文字列。`pnpm test:unit` も **76 ファイル・925 passed・3 skipped** で `testing.md:35` の基準値どおり。

### `plan.md` Phase 5 起票リストの検証

**漏れも重複も見つからなかった。**

- 件数体系が整合している: 新規 11 本（1〜4 / 5〜7 / 12〜15）＋ 既存 Issue へのコメント 4 件（8〜11）= 15。AC-23 が 1〜4 の 4 本、AC-60 が 5〜15 の **11 参照**を担い、合計 15 で「スコープ節の一覧と 1 対 1」が成立する
- R1 の唯一の defer（M-06 = `usecase:B-004` の `REAUTHENTICATION_REQUIRED`）の受け皿が 5.（起票必須）として明記され、`AC-60` 側にも「5. の起票は必須」と二重に書かれている
- R1 の修正中に見つかった 4 件（12: ADR 048 の前提陳腐化 / 13: リポジトリ設定の残骸 / 14: `spec/inventory/test.md` の重複行 / 15: `linkOAuthIdentity` の自己所有分岐）はいずれも**実測で裏が取れた**:
  - 13(a): `.gitignore:14-17` は実在し、`scripts/render-wrangler.ts` / `wrangler.staging.toml` / `wrangler.production.toml` はいずれも実在しない。13(b): `Dockerfile` は 0 本
  - 14: 「要素」列が完全に重複する行は実測でちょうど 2 組（`requestBulkExport: 閲覧権限のないノートを含む — 要求する` / `runConversion: 変換結果に外部参照がある — 実行する`）
- 6. の配下は R1 の M-11 / U8 が閉じた分を取り消し線で落とし、残る責務（ADP ID を持たない 5 ポートの採番 ＋ 網羅の規約化）に絞られている。B-001（`describe` か `it` か）は「網羅の要否」とは別の面なので、この Issue には**含まれていない** — 本 PR 内で閉じるべき

### 乖離台帳が恒久参照ドキュメントとして成立しているか

**成立している。** 件数体系を突き合わせた結果:

- `research.md` 集計: 残 21 / 済 1 / 乖離なし 1 / 外 3 / 外 1 = **27**、うち progress.md 由来 24 件の内訳「残 19 / 済 1 / 乖離なし 1 / 外 3」も加算が合う
- `research-2.md` 集計: 残 38 / 済 1 / 外 4 / 重複 1 = **44**、分類別内訳 A〜I の合計も **44**、集計表の残 38 の ID 列挙も `plan.md:32` の列挙と**完全一致**
- 統合実数: 27 + 44 − 1（SYNC-225 = SYNC-15）= **70**、内訳「要修正 59 / スコープ外 8 / 解消済み 2 / 乖離なし 1」= 70。`plan.md:36` と一致

判定（要修正 / スコープ外 / 解消済み）も壊れていない。スコープ外の 4 件について spec が狭められていないことを AC-62 の向きで確認した — `createDownloadUrl` = 3 件 / `workspaceCursor` = 1 件 / `next_attempt_at` = 2 件 / `spec/pages/index.md` の P-25 機能行に「削除されるもの / されないもの」が残存。SYNC-27（`ExternalServiceError`）も identity 側 3 か所は 0 件、残る 8 件はすべて conversion / integration / job / storage の未実装ドメイン行で、スコープ外の線どおり。

### `CLAUDE.md` / `README.md` / `docs/` の実在性

**実在しない固有名・パス・コマンドは 0 件。**

- `plan.md` の grep（`serverCloudflare|serverAws|serverGcp|infra/*|components/todo|routes/todo|Todo*|inputValidator|libSQL|Turso|drizzle|migrate.*|runtime_*`）を 4 ファイルへ実行 → **0 件**
- 4 ファイルが `` ` `` で囲んで参照する `apps/` / `packages/` / `docs/` / `spec/` パス **76 個**をすべて `test -e` で検証 → 実在しないのは `apps/web/public/`（`docs/runtime_node.md:44` が「まだ存在しない」と明示して案内している箇所）だけで、これは正しい記述
- 相対 Markdown リンクを `CLAUDE.md` / `README.md` / `docs/` で解決 → **切れ 0 件**
- コマンド: root `package.json` の scripts は実測 13 個（`dev` `dev:node` `build` `build:node` `start` `start:node` `typecheck` `lint` `lint:fix` `format` `format:check` `test` `test:unit`）で、`README.md`「Development commands」の列挙と一致。`pnpm -r typecheck` の受け手（`packages/core` / `apps/web` の `typecheck: tsgo`）も実在
- 構造: `CLAUDE.md:53` の「domain 8 フォルダー」= 実測 8、`:54` の application 配下、`:55` の adapters 4 群、`:56` の presentation 5 ファイル、`:100-104` の Node 参照ランタイム 5 ファイルはすべて実在
- コード中の ADR 参照 43 か所を全数解決 → **dangling 0 件**（M-42 の `ADR-006/095/099/110/112` は消え、`spec/adr/029/034/037/047/048` 等の実在番号に置き換わっている）

### `spec/adr/052`〜`057` の記述様式と前提の引用

様式は既存 ADR（`### ステータス` / `## コンテキスト` / `## 前提` / `## 決定` / `## 検討した代替案` / `## 影響`）に揃っている。前提の引用を 1 件ずつ当たった結果:

- 052 → **026 の誤引用**（B-001）
- 053 → 039（cleanup participants declaration）/ 046（port contract divergence）。両方とも実在し、引いている内容も本文と一致
- 054 → 038（provider account claim and identity row）/ 048（uniqueness reservation operation id）/ 028（account enumeration resistance）。一致
- 055 → ドメイン定数 `Session.ttlMs` の正典性のみ（ADR 番号を引いていない）。妥当
- 056 → 024（in-memory adapter as first-class backend）/ 026。一致。移送先の記述（`### Scope DO` の 3 列表が行数の軸を持つ）も実物と一致し、`spec/platform/index.md` の該当段落は表の直後に「上限ではなく実装が満たすべき設計目標」と明記して置かれている
- 057 → 029（verification session binding）。一致

参照の到達性も確認した — 052 は inventory 4 ファイル、053 は `spec/domains/index.md` / `spec/usecases/identity.md`、054 は `spec/domains/identity.md`、055 は `spec/usecases/identity.md` / `spec/presentation/index.md`、056 は `spec/platform/index.md` / `spec/usecases/storage.md` / `spec/testcases/storage/deleteFilesByOwner.md`（＋ `spec/inventory/test.md`）、057 は `spec/manual-tests/account.md` からリンクされており、AC-29 / AC-61 / AC-69 を満たす。`spec/adr/index.md` の一覧（`:57-62`）と前提依存マップ（`:114-119`）にも 6 行ずつある。

### 残す必要のない記述

`spec/` 側は**きれいになっている**。改訂履歴語・レビュー経緯語で `spec/` 全域を引いた結果、ヒットするのは「旧 URL」「やり直す」等のドメイン記述と、ADR 本文の「レビューで守る」という設計上の規律だけで、本 PR / 本 Issue の作業経緯を語る文は 0 件。M-29 / M-47 / M-48 で落とした 5 か所も再発していない。

台帳側は W-005 の 1 語を除いて経緯が落ちている。`plan.md` / `adr.md` に残る取り消し線（AC-24 → AC-63 の上書き等）は受け入れ基準の系譜を追うための作業成果物の様式で、`spec/` の正典には漏れていないため指摘しない。

### カバレッジ

**確認（75 件）:**

- `.dockerignore`（W-004）
- `.thread/14/adr.md`, `.thread/14/plan.md`, `.thread/14/research.md`, `.thread/14/research-2.md`, `.thread/14/steps.md`, `.thread/14/testing.md`
- `CLAUDE.md`, `README.md`
- `docs/backend_implementation_example.md`, `docs/frontend_implementation_example.md`
- `apps/web/.dev.vars.example`, `apps/web/.env.aws.example`, `apps/web/.env.gcp.example`（削除の妥当性 — 読むコード 0 件を再確認）
- `apps/web/app/components/settings/DeleteAccountPanel/ticketStorage.ts`, `apps/web/app/presentation/oauthStateCookie.ts`, `apps/web/app/presentation/session.ts`, `apps/web/app/start.ts`（ADR 参照の実在性 ＋ AC-63 の行分類）
- `packages/core/src/adapters/conformance/{accountDeletionManifestStore,authTokenRepository,identityUniqueDirectory,noteProjection,objectStorage,scopeCleanupAdmissionStore,signInOAuthClient}.ts`（ADP ID の命名 — B-001 / W-002 の根拠。7 件）
- `packages/core/src/application/di/containerStore.ts`, `packages/core/src/application/identity/{completeOAuthCallback,removeIdentity,uniqueness,view}.ts`, `packages/core/src/application/ports/{accountDeletionManifestStore,scopeCleanupAdmissionStore,shareTokenProtector}.ts`, `packages/core/src/application/storage/__tests__/deleteFilesByOwner.test.ts`, `packages/core/src/domain/identity/errorCode.ts`, `packages/core/src/domain/identity/ports/{identityRepository,identityUniqueDirectory}.ts`, `packages/core/src/domain/storage/errorCode.ts`（AC-63 の機械検査で追加・削除行を全数分類。W-001 の根拠を含む。13 件）
- `spec/adr/052-adapter-inventory-granularity.md`, `spec/adr/053-account-deletion-rollback-completion.md`, `spec/adr/054-provider-account-uniqueness-owner.md`, `spec/adr/055-session-expiry-derivation.md`, `spec/adr/056-performance-budget-placement.md`, `spec/adr/057-manual-test-followthrough.md`, `spec/adr/index.md`
- `spec/database/index.md`, `spec/domains/identity.md`, `spec/domains/index.md`, `spec/domains/note.md`, `spec/domains/storage.md`, `spec/domains/usage.md`（ADR 参照・リンク・語彙整合・M-48 / ADR-031 の反映）
- `spec/inventory/adapter.md`, `spec/inventory/domain.md`, `spec/inventory/frontend.md`, `spec/inventory/test.md`, `spec/inventory/usecase.md`（採番規則ヘッダー・最終同期日・M-15 のリンク・AC-55 / AC-64 の件数）
- `spec/manual-tests/account.md`, `spec/manual-tests/index.md`（M-17 の数え直し）
- `spec/pages/index.md`, `spec/platform/index.md`, `spec/presentation/index.md`, `spec/scenario/account.md`（ADR 参照とリンク解決、ADR-027 / 056 の反映）
- `spec/testcases/identity/{addPasswordIdentity,checkHandleAvailability,completeOAuthCallback,completeOAuthSignIn,deleteAccount,getProfile,requestPasswordReset,signUpWithPassword,startOAuthFlow}.md`, `spec/testcases/storage/deleteFilesByOwner.md`（TC 採番・リンク深さ・M-47 の改訂履歴語。10 件）
- `spec/usecases/identity.md`, `spec/usecases/storage.md`, `spec/usecases/usage.md`（ADR 参照・語彙整合・M-47 / ADR-031 の反映）

**スキップ（8 件）:**

- `.thread/14/review/review-001.md`, `.thread/14/review/review-001-{docs,domain,general,inventory,presentation,usecase}.md`, `.thread/14/review/triage.md` — レビューの中間成果物（`triage.md` は既出判定として**読んだ**が、内容のレビュー対象外）

確認 75 ＋ スキップ 8 = **83**（変更ファイル一覧と一致）。
