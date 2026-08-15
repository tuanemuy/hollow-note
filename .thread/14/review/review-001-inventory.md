# レビュー 001 — 台帳（inventory）の整合性・ID 採番

対象: PR #22（`origin/main...HEAD`）/ 契約: `.thread/14/plan.md`

## 総評（機械検査の結果）

まず結論として、**このレビューの最優先項目である「既存 ID の指す要素が変わっていないか」は全ファイルで守られている**。

- 5 ファイルとも既存 ID の削除・繰り下げ・付け替えは 0 件。差分は「既存行の要点欄の書き換え」と「群の末尾への追加」だけ
- `spec/inventory/domain.md` の `要素` 集合と `spec/inventory/adapter.md` の `要素` 集合は**完全一致**（片側にだけ行があるポートメソッドは 0）
- ID の重複は 5 ファイルとも 0
- 表の列数の逸脱は新規・変更行に 0（`spec/inventory/test.md` に `NF=7` の行が 5 本あるが、いずれも本文中の `\|` エスケープを含む既存行で、本 PR は触っていない）
- `TC-identity-*` は 001〜322 が連番で埋まっており穴なし。`TC-identity-024` は `completeOAuthSignIn` の 1 件目のまま
- `spec/testcases/identity/requestPasswordReset.md` はソース側の**表の途中**に 2 行を挿入したが、台帳側は `TC-identity-321/322` として末尾に採番しており、既存 `TC-identity-187`〜`193` の指す行は 1 つも動いていない（ADR 052 決定 3 の意図どおり）

契約の件数検査もすべて通る。

| 検査 | 期待 | 実測 |
| --- | --- | --- |
| `grep -cE "DOM-common-04[12]\|DOM-identity-06[012]\|DOM-note-07[12]\|DOM-storage-038" domain.md` | 8 | **8** |
| `grep -cE "ADP-common-04[01]\|ADP-identity-0(39\|4[01])\|ADP-note-05[56]\|ADP-storage-024" adapter.md` | 8 | **8** |
| `grep -cE "UC-identity-02[234]" usecase.md` | 3 | **3** |
| 新規 TC 行（`TC-identity-305`〜`322`） | 18 | **18** |
| `ls spec/testcases/identity/*.md \| wc -l` | 24 | **24** |
| `grep -c "^\| UC-identity-" usecase.md` | 24 | **24** |
| `ls spec/adr/05[2-7]-*.md` | 6 | **6** |
| 5 ファイルの「最終同期」 | 2026-08-16 | **5/5 更新済み** |

新規採番 19 行はすべて実在の要素と 1 対 1 に対応している。`spec/domains/` の diff から net-new のポートメソッドを機械抽出すると `beginRelease` / `findPendingByUserAndPurpose` / `deriveCodeChallenge` / `describePersonalCleanup` / `describe` / `redactAuthor` ×2 / `publicUrl` の **ちょうど 8 本**で、DOM 8 行・ADP 8 行と一致する。`spec/usecases/identity.md` に新設された `##` 見出しも `completeOAuthCallback` / `getProfile` / `checkHandleAvailability` の**ちょうど 3 本**で UC 3 行と一致し、`spec/domains/index.md` のユースケース数表（Identity 21 → 24、合計 143 → 146）とも整合する。`StorageQuota.replaceTotals` / `UploadValidationPolicy.ensureAcceptable` / `AppliedOperationStore.markApplied` には行を作っておらず、適合ケースに新規 ID を採番した箇所も 0（ADR 052 決定 1・2 を守っている）。`PAGE-p25-001` の participant 完備の文言（「削除されるもの / されないもの」「ワークスペース所有のノートは残る」）も削られていない。

一方で、**本文を直したのに台帳が置き去りになっている行**が複数ある。以下がそれで、いずれも「新しい ID を振る」話ではなく「既に存在する行の要点欄と実在要素の対応」の問題である。

---

## Blockers

- **[B-001]** `spec/database/index.md` が `AccountDeletionRetryPolicy` を名指ししたが、この要素は `spec/domains/` にも `spec/inventory/domain.md` にも存在しない
  - 場所: `spec/database/index.md:154`（追加行）/ 欠落先は `spec/domains/identity.md` の `### ドメインサービス` 節（`:260`〜`:320` 付近）と `spec/inventory/domain.md`（`DOM-identity-019`〜`021` の並び）
  - 理由: 本 PR が新たに「しきい値（8 件）と窓（120 日）の判定は**ドメインの `AccountDeletionRetryPolicy`** が行う」と書いた。これは実装に**実在する**ドメインサービスで（`packages/core/src/domain/identity/services/accountDeletionRetryPolicy.ts`、`application/identity/deleteAccount/admission.ts:100` から呼ばれ、`domain/identity/__tests__/policies.test.ts:231` にテストもある）、`IdentityPolicy` / `AccountLinkingPolicy` / `LoginThrottlePolicy` と同格の要素である。にもかかわらず `grep -rn 'AccountDeletionRetryPolicy' spec/` のヒットは `spec/database/index.md:154` の 1 件だけで、定義箇所も `DOM-identity-*` 行も無い。**名前だけが宙に浮く状態**であり、これは同じ PR の AC-66 が `AppliedOperationStore` について明示的に禁じた状態そのもの（あちらは `spec/domains/index.md` に 1 行言及を足して回避した）。実装者は台帳から「実装すべきドメインサービスの全数」を数えられない（ADR 052「影響」の 4 点目が成立しない）
  - 提案: `spec/domains/identity.md` の `### ドメインサービス` に `AccountDeletionRetryPolicy` を既存 3 サービスと同じ様式（振る舞い表 + 依存ポート）で足し、`spec/inventory/domain.md` の identity 群の**末尾**（`DOM-identity-063`）に 1 行採番する。`ensureRetryable` / `windowStart` を畳んだ 1 行でよい（ドメインサービスは 1 行が全振る舞いを畳む既存規則どおり）。定義を足すのが本 PR のスコープを超えるなら、少なくとも `spec/database/index.md:154` から名前を落として「ドメイン側のポリシーが判定する」に留め、名前の導入を実装スライスへ送ること

- **[B-002]** `UC-storage-002` / `UC-storage-003` が ADR 050 の入力 DTO 縮小に追随していない。同一の変更を受けた `UC-storage-004` だけが更新されている
  - 場所: `spec/inventory/usecase.md:99`（`UC-storage-002` `storeUpload`）, `:100`（`UC-storage-003` `storeMedia`）。対比は `:101`（`UC-storage-004` `storeAvatar`）
  - 理由: 本 PR は `spec/usecases/storage.md` の 3 ユースケースから**同一の変更**（`declaredMimeType` / `size` を入力 DTO から落とし、「型は先頭バイトの署名、サイズは実バイト長から決める」段落を追加。`storeUpload` はさらに手順 5 の「宣言サイズと実サイズが食い違う場合は実サイズを採用する」を削除）を加えた。ところが台帳側は `UC-storage-004` にだけ「入力に宣言 MIME・宣言サイズを受け取らず、型は先頭バイトの署名から、サイズは実バイト長から決める」を書き足し、`UC-storage-002` / `UC-storage-003` は素通しになっている。3 分の 1 だけ追随した状態は、素通しよりも読み手を誤らせる — 台帳だけを見た実装者は「storeAvatar だけが宣言値を受けない特例」と読む
  - 提案: `UC-storage-002` / `UC-storage-003` の要点欄に `UC-storage-004` と同趣旨の 1 文を足す。`UC-storage-002` は「stream を保管し」の記述が `body: ReadableStream` 据え置き（AC-65(d)）と整合しているのでそこは触らず、宣言値を受けない旨だけを追加する

- **[B-003]** `allRollbackReleased` の 2 行（DOM / ADP）が、ADR 053 を新設するほどの本文改訂に追随していない。**対になる `allRequiredAcknowledged` だけが書き換えられている**
  - 場所: `spec/inventory/domain.md:27`（`DOM-common-021`）, `spec/inventory/adapter.md:28`（`ADP-common-020`）。どちらも「rollback release の全完了を判定する」のまま
  - 理由: 本 PR は `spec/domains/index.md` に「**rollback の正本**は固定済み membership item の release ack だけ（`allRollbackReleased`）で、『prepare を出した先へ解放を配り切ったか』を問う。`personalAbort` receipt はこの述語の判定対象に入らない」を追加し、この非対称のために `spec/adr/053-account-deletion-rollback-completion.md` を新設した。ところが台帳の該当行は改訂前の「全完了を判定する」のままで、これは**まさに ADR 053 が曖昧だと指摘した書き方**である（「全完了」が receipt を含むのかどうかが読めない）。同時に、対になる `ADP-common-021`（`allRequiredAcknowledged`）は「固定済み全 item の完全 ack と宣言された全 receipt の両方がそろって初めて true にする…」と全面的に書き換わっている。**明示的に非対称だと宣言したペアの片側だけを詳しく書いた**結果、台帳だけを読むと「finalize は厳密、rollback は全部」と読め、ADR 053 の決定と逆の印象を与える。AC-9 は本文側の AC だが、`spec/inventory/*.md` は `spec/domains/` の生成物であり、これは適合ケース由来の差分（ADP だけに書く分）ではない
  - 提案: `DOM-common-021` / `ADP-common-020` の要点欄を「固定済み membership item の release ack がすべて揃ったかを判定する。`personalAbort` receipt は判定対象に含まない（利用者を `active` へ戻す条件はユースケース側 — ADR 053）」に改める。DOM と ADP で同文でよい

- **[B-004]** `PAGE-p03-003` / `PAGE-p03-004` が、本 PR が書き換えた P-03 の状態列挙に追随していない。`PAGE-p03-003` は実装とも食い違う
  - 場所: `spec/inventory/frontend.md:19`（`PAGE-p03-003`）, `:20`（`PAGE-p03-004`）
  - 理由: 本 PR は `spec/pages/index.md` の P-03 の `**状態**` 行を `処理中 / 成功 / 確認済み・サインインが必要（サインインへ）/ 使用済み（サインインへ）/ 期限切れ（再送）/ **無効（再送）** / 一時障害（再試行）` に改訂した（改訂前の `無効` には導線の注記が無かった）。同じ P-03 ブロックの `PAGE-p03-001` / `002` は追随したが、
    - `PAGE-p03-003`「**期限切れ状態から** email を送信して…」は `無効` を落としている。実装側は `apps/web/app/components/auth/VerifyEmailPanel` の冒頭コメントが「**期限切れ・無効からは確認メールを再送できる（PAGE-p03-003）**」と、この PAGE ID を名指しで参照している。つまり台帳の行が、それを参照している実装コードの記述と直接矛盾している
    - `PAGE-p03-004`「使用済み・無効状態から P-02 へ遷移する」は、本 PR が新設した状態「確認済み・サインインが必要（サインインへ）」を含んでいない。この状態は `PAGE-p03-001` の要点欄に「7 状態」として明記された新規状態であり、その導線が台帳に無い
  - 提案: `PAGE-p03-003` を「期限切れ・無効の状態から email を送信して、存在秘匿された再送完了を表示する」に、`PAGE-p03-004` を「確認済み・サインインが必要 / 使用済みの状態から P-02 へ遷移する」に改める（`無効` は再送導線側へ寄せる）。ID は動かさない

- **[B-005]** 新規採番した `ADP-common-041` が、適合スイート内で既に別の意味で使われている `ADP-common-012` と衝突している
  - 場所: `spec/inventory/adapter.md:47`（`ADP-common-041` = `AccountDeletionManifestStore.describe`）vs `packages/core/src/adapters/conformance/accountDeletionManifestStore.ts:100`
  - 理由: 本 PR は `AccountDeletionManifestStore.describe` に `ADP-common-041` を採番したが、適合スイートには `it("ADP-common-012: describe reports the header a continuation resumes from")` が残っている。`ADP-common-012` は台帳では `begin` を指しており（同ファイル `:73` の `it("ADP-common-012: a replayed begin preserves everything already recorded")` が正しい方）、**同一 ID が 2 つの異なるポートメソッドを指す**状態になった。ADR 026 は「ADP 行との対応を `describe` / `it` 名の命名規約で追う」ことを契約追跡の唯一の手段と定めており、ADR 052 はその上に「ID は行位置ではなく行の識別子」と積んでいる。ID の一意性が壊れると両方の前提が崩れる。同ファイル `:26` のヘッダーコメント `(ADP-common-012..025)` も新設の `ADP-common-041` を含まない範囲のままで、`packages/core/src/adapters/conformance/objectStorage.ts:23` の `(ADP-storage-018..020 + \`publicUrl\`)` も同様に新設 `ADP-storage-024` を反映していない
  - 提案: `accountDeletionManifestStore.ts:100` の `it` 名を `ADP-common-041:` に直す（1 語の変更で振る舞いは変わらない）。あわせて `:26` と `objectStorage.ts:23` のヘッダー範囲を更新する。`.thread/14/plan.md`「Phase 5 で起票するもの」6. の相乗り 2 件がこれを後続 Issue へ送っているが、**衝突を作ったのは本 PR の採番**であり、AC-63 の「コード差分 9 ファイル」を守るために ID の一意性を壊した状態でマージするのは順序が逆である。1 ファイル増やすか、AC-63 の 9 ファイル制約を 10 に改めて本 PR で閉じるべき

---

## Warnings

- **[W-001]** `spec/domains/index.md` の改訂に対して ADP 行だけが追随し、対になる DOM 行が置き去りになっている（4 メソッド）
  - 場所: `spec/inventory/domain.md:15`（`DOM-common-009` `assertOwner`）, `:24`（`DOM-common-018` `claimPending`）, `:26`（`DOM-common-020` `acknowledgeReceipt`）, `:28`（`DOM-common-022` `allRequiredAcknowledged`）
  - 理由: `spec/inventory/domain.md` も `adapter.md` も生成元は `spec/domains/` で、同じポートメソッドに 1 行ずつを持つ。適合ケース由来の細部（AC-19b が言う `describe` 名の主張）が ADP 側にだけ載るのは ADR 052 決定 1 の設計どおりで妥当だが、上記 4 件は**本文（`spec/domains/index.md`）そのものが変わった**分である — `assertOwner` は「別 ID・欠落・未 commit・**完了済み**を拒否する」、`acknowledgeReceipt` / `allRequiredAcknowledged` は「必須集合は**配備が宣言した集合**であって enum 全体でも固定件数でもない」、`claimPending` は「membership item の完全 ack は cleanup phase の ack を含む」。いずれも「ドメイン契約として何が保証されるか」であってアダプター実装の詳細ではない。DOM 側だけを読む実装者に届かない
  - 提案: 4 行の要点欄に ADP 側と同趣旨の追記を入れる（文言まで揃える必要はないが、主張は同じにする）。少なくとも `DOM-common-009`（`assertOwner` の完了済み拒否）は、本 PR が `packages/core/src/application/ports/scopeCleanupAdmissionStore.ts` の JSDoc と適合スイートの両方に足した主張なので、台帳の DOM 側だけが取り残されるのは不自然

- **[W-002]** `ADP-identity-010`（`IdentityRepository.insert`）が ADR 054 の契約縮小に追随していない。**W-001 と向きが逆**
  - 場所: `spec/inventory/adapter.md:59`（`ADP-identity-010`）。対比は `spec/inventory/domain.md:79`（`DOM-identity-031`、更新済み）
  - 理由: 本 PR は `spec/domains/identity.md` の `IdentityRepository` の `**エラーケース**` から `ConflictError("PROVIDER_ACCOUNT_ALREADY_LINKED")` を落とし、「`(provider, providerAccountId)` の一意性はここでは検査しない。バックエンドが DB 側に一意制約を置くのは自由だが、**契約としては要求しない**」を追加した（ADR 054）。DOM-identity-031 には追記されたが、ADP-identity-010 は「新規 Identity を保存する」のまま。これは**アダプター実装者に最も届く必要がある情報**（新バックエンドの実装者が `adapter.md` だけを見て一意制約と `PROVIDER_ACCOUNT_ALREADY_LINKED` を実装してしまう）で、DOM だけに書くのは配置として逆
  - 提案: `ADP-identity-010` に「provider account の一意性はここでは検査しない（担保は `IdentityUniqueDirectory` の claim 索引だけが持つ — ADR 054）。DB 側に一意制約を置くのは自由だが契約としては要求しない」を足す

- **[W-003]** 採番規則のヘッダー行が `adapter.md` / `test.md` の 2 ファイルにしか無く、同じ規則で末尾採番した `domain.md` / `usecase.md` に無い
  - 場所: `spec/inventory/domain.md:3-5`, `spec/inventory/usecase.md:3-5`（追加無し）vs `spec/inventory/adapter.md:5`, `spec/inventory/test.md:5`
  - 理由: AC-61 / AC-64 の要求（`adapter.md` と `test.md` に 1 行ずつ）は満たされており、その 2 ファイルのあいだの非対称は解消されている。しかし ADR 052 決定 2 は「採番は各群の末尾に足し、出現順に挿入して既存 ID を繰り下げない」を **DOM / ADP / UC すべて**に当てており、本 PR は実際に `domain.md` へ 8 行（`DOM-common-041/042` は `IdempotencyStore` 行の後、`DOM-storage-038` は `DnsResolver` 行の後、など）、`usecase.md` へ 3 行を出現順を無視して末尾追加している。規則の説明が無いファイルでは、読み手は行位置に意味を読み、`DOM-storage-038` が `ObjectStorage` 群から離れて `DnsResolver` の下にある理由を「間違い」と解釈しうる。AC-64 が `test.md` について「`adapter.md` だけに書く非対称を作らない」と述べた理由がそのまま残り 2 ファイルにも当てはまる
  - 提案: `domain.md` / `usecase.md` のヘッダーにも 1 行（「新規要素は各群の末尾に採番し、出現順の位置に挿入しない（ID は行位置ではない）— ADR 052」）を足す

- **[W-004]** 4 つの PAGE 行が、本 PR が `spec/presentation/index.md` から削除した「`FormData` を受ける場合は」という条件を保存し続けている
  - 場所: `spec/inventory/frontend.md:68`（`PAGE-p12-006`「file を **FormData で送る場合は** Origin を必須検証し」）, `:74`（`PAGE-p13-004`）, `:101`（`PAGE-p21-003`）, `:128`（`PAGE-p31-004`）
  - 理由: AC-16 の改訂で CSRF 規約表は「**すべての server function 呼び出しに同一オリジン検証を強制する**（`createCsrfMiddleware`）」になり、「`FormData` を受ける場合は」という条件付けは「アプリ側がその形を書いていないことは攻撃者を縛らない」として明示的に否定された。`spec/inventory/frontend.md` はヘッダーで生成元に `spec/presentation/` を挙げており（`:3`）、これらの行は削除された条件をそのまま台帳に残している。なお `spec/pages/index.md` には `Origin` も `FormData` も 1 度も現れないので、これらの行の内容の出所は presentation 側しかない
  - 提案: 4 行から「FormData で送る場合は」の条件を外し、「同一オリジン検証は全 server function に掛かる（`createCsrfMiddleware`）」を前提とした書き方に改める。行の主眼（進捗・形式・size・quota の表示）は変えない

- **[W-005]** `Cache-Control: private, no-store` を `PAGE-p47-001` だけに足したのは、本文が「サービス全体の既定」と書いていることと粒度が合わない
  - 場所: `spec/inventory/frontend.md:168`（追加）。対比は `:147`（`PAGE-p41-001`）, `:151`（`PAGE-p42-001`）, `:154`（`PAGE-p43-001`）, `:157`（`PAGE-p44-001`）, `:160`（`PAGE-p45-001`）
  - 理由: 本 PR は `spec/presentation/index.md` の「その他のヘッダー」表に `Cache-Control: private, no-store` を足し、「**サービス全体の既定**として敷く」「公開ノートの応答だけを緩める方針は公開閲覧スライスで確定する」と書いた。台帳側では P-47 の行にだけこれを追記している。P-41〜P-45 の行も同じくヘッダー集合（`公開 CSP` / `nosniff` / `referrer policy`）を要点欄に列挙しており、同じ既定が掛かる面である。1 行だけに足すと「P-47 固有の要件」と読める
  - 提案: (a) 5 行にも同様に足して揃える、(b) あるいは `PAGE-p47-001` からも外し、サービス全体の既定は `spec/presentation/index.md` 側だけの記述に留める、のどちらかへ寄せる。台帳は 162 行あるので (b) のほうが保守しやすい

- **[W-006]** `PAGE-p40-004`「アプリへ戻る」が、もはや P-40 に存在しない要素の行になっている
  - 場所: `spec/inventory/frontend.md:146`
  - 理由: 本 PR は P-40 の状態を「通常 のみ（サインイン済みはノート一覧へリダイレクトするため P-40 に到達しない）」に改訂し、台帳の要点欄も「P-40 は画面内の導線ではなく `/` のリダイレクトでこの役割を果たすため、sign-in 済みの訪問者はこの画面を見ない」に追随させた。ID 安定性の観点で行を残した判断自体は妥当だが、結果として `PAGE-p40-004` は「P-40 の要素」ではなく「`/` ルートのリダイレクト挙動」を指す行になっており、「1 行 = 1 要素」の要素が P-40 の外へ移っている
  - 提案: 要素名を「アプリへ戻る」から「サインイン済みのリダイレクト（`/` → P-10）」のような、実在する挙動を指す名前へ変える（ID は据え置き）。あるいは定義場所を `/` の URL 割り当て表を指す形に直す

- **[W-007]** `spec/adr/057` にレビューの経緯を指す 1 文が残っている
  - 場所: `spec/adr/057-manual-test-followthrough.md:38`
  - 理由: 「…同じ論点が次のレビューで再燃する。**実際にそれが起きた。**」。ADR は長寿命の設計判断の記録で、「この PR のレビューでこう指摘された」という経緯は残す必要のない記述にあたる。他の 5 本（052〜056）にはこの種の文は無い
  - 提案: 「実際にそれが起きた。」を削除するか、経緯に依存しない形（例: 「判断の基準が文書に無い限り、同じ論点が繰り返し再燃する」）へ書き換える

- **[W-008]** `DOM-note-013`（`Note` エンティティ）が、本 PR が追加した 2 つの不変条件に追随していない
  - 場所: `spec/inventory/domain.md:253`
  - 理由: 本 PR は `spec/domains/note.md` の不変条件節に (a) 公開⇄本文降格の**双方向**禁止（`markConversionFailed` / `markAwaitingIntegration` が `visibility.status !== "private"` を拒否する）と (b) `Note.reconstruct` が ready 本文の必須列の欠落を空文字で補完せず拒否する、の 2 点を足した。要点欄は「content・visibility・lifecycle の合法状態と全遷移 event を保つ」のままで、抽象的には偽ではないが、同じ PR で `DOM-usage-006`（`StorageQuota` エンティティ）は `replaceTotals` の追加に合わせて要点欄を伸ばしている。エンティティ行の追随粒度が 2 つの群で揃っていない
  - 提案: `DOM-note-013` に「公開・限定公開と `ready` 以外の本文の組は**どちらの向きからも**作れない」「`reconstruct` は必須列の欠落を補完せず拒否する」を足すか、逆に `DOM-usage-006` の粒度を戻して揃える。前者を推す

---

## カバレッジ

52 件のうち **確認 32 件 / スキップ 20 件**。

### 確認

- `spec/inventory/domain.md`, `spec/inventory/adapter.md`, `spec/inventory/usecase.md`, `spec/inventory/test.md`, `spec/inventory/frontend.md` — 本レビューの中心。ID 対応の新旧突き合わせ、新規採番の 1 対 1 検証、DOM/ADP 集合の照合、列数・重複・連番検査、ヘッダーの生成元・最終同期
- `spec/domains/index.md`, `spec/domains/identity.md`, `spec/domains/note.md`, `spec/domains/storage.md`, `spec/domains/usage.md` — DOM / ADP 行の生成元。net-new ポートメソッドの抽出と 8 行との照合、要点欄と本文の一致検証
- `spec/usecases/identity.md`, `spec/usecases/storage.md`, `spec/usecases/usage.md` — UC 行の生成元。新設 3 ユースケースの見出し抽出、既存 UC 行の追随検証（B-002 の根拠）
- `spec/testcases/identity/getProfile.md`, `spec/testcases/identity/checkHandleAvailability.md`, `spec/testcases/identity/completeOAuthCallback.md`, `spec/testcases/identity/requestPasswordReset.md`, `spec/testcases/identity/signUpWithPassword.md`, `spec/testcases/identity/startOAuthFlow.md`, `spec/testcases/storage/deleteFilesByOwner.md` — TC 行の生成元。表の行数と TC-identity-305〜322 / 261 / 268 / TC-storage-043 の 1 対 1 照合、4 列様式
- `spec/pages/index.md`, `spec/presentation/index.md` — PAGE 行の生成元。P-03 / P-25 / P-40 の改訂と台帳の照合（B-004 / W-004 / W-005 / W-006 の根拠）
- `spec/database/index.md` — ポート名・ドメインサービス名の導入箇所として確認（B-001 の根拠）
- `spec/adr/052-adapter-inventory-granularity.md`, `spec/adr/053`, `spec/adr/056`, `spec/adr/057`, `spec/adr/index.md` — 採番規則の正本。052 が適合ケース非採番・末尾採番・TC 同規則の 3 決定を持つこと、index の一覧と前提依存マップに 052〜057 の 6 行があること、`grep -rn "adr/05[2-7]-" spec/` の参照先がすべて実在すること
- `packages/core/src/adapters/conformance/scopeCleanupAdmissionStore.ts` — 適合スイートへの追加が 1 ケース（`ADP-common-008`）に留まり新規 ID を採番していないこと（ADR 052 決定 1）
- `.thread/14/plan.md` — 契約（AC-19a / 19b / 55 / 56 / 57 / 61 / 64 / 66 の全文）
- `spec/adr/054-provider-account-uniqueness-owner.md`, `spec/adr/055-session-expiry-derivation.md` — index 登録とリンク元の実在確認のみ（本文の設計判断は他観点）

### スキップ

- `.thread/14/adr.md`, `.thread/14/research.md`, `.thread/14/research-2.md`, `.thread/14/steps.md`, `.thread/14/testing.md` — 作業記録・台帳の由来。台帳（`spec/inventory/`）そのものではない
- `CLAUDE.md`, `README.md`, `docs/backend_implementation_example.md`, `docs/frontend_implementation_example.md` — 実在しない固有名の除去が主題で、`spec/inventory/` の ID を参照していない（`grep` で ID 参照 0 件を確認）
- `apps/web/app/start.ts` — コメントの参照先差し替えのみ。台帳の ID を参照していない
- `packages/core/src/application/di/containerStore.ts`, `packages/core/src/application/ports/accountDeletionManifestStore.ts`, `packages/core/src/application/ports/scopeCleanupAdmissionStore.ts`, `packages/core/src/application/ports/shareTokenProtector.ts`, `packages/core/src/domain/identity/errorCode.ts`, `packages/core/src/domain/identity/ports/identityRepository.ts`, `packages/core/src/domain/storage/errorCode.ts` — JSDoc / コメントの spec 追随。ポート契約の観点であって台帳の行構造ではない（ただし `identityRepository.ts` の契約変更が W-002 の背景）
- `spec/scenario/account.md`, `spec/manual-tests/account.md`, `spec/platform/index.md` — 台帳を持たない成果物。PAGE 行への波及（P-03 の状態列挙）は `spec/pages/index.md` 経由で確認済み
