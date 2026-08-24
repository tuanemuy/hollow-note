# レビュー 002 — Issue #16 / Spec canon

## Spec canon

### Blockers

- **[B-001]** ポート JSDoc を広げた契約 2 / 3 の是正が、参照先として名指している ADR 061 に反映されていない（写しだけが直っている）
  - 場所: `spec/adr/061-maintenance-sweep-order-authority.md:22-23`（契約 2 / 契約 3(b)）
  - 理由: このラウンドでポート JSDoc（契約の正本、`packages/core/src/application/ports/globalMaintenanceRunStore.ts:56-75`）と適合スイートは、自動 claim が返す position を **一度も claim されていない lane（run 生成時の先頭 position）** まで含む形へ広げ、`ADP-common-029: acking a lane's last table auto-claims a lane never claimed before, at the head of its first table` で「その `commandKey` は呼び出し側が導けるキーと一致する」ことを拘束した（`packages/core/src/adapters/conformance/globalMaintenanceRunStore.ts:345-373`）。ところが ADR 061 の契約 3(b) は「store が**既存の position を返す**とき（別 shard の自動 claim）は…**その値の出どころは呼び出し側が checkpoint 時に渡したキーであり、規則を知っているのは呼び出し側だからである**」と書いたままで、この新ケース（スイート自身が「most of a real run」と注記している経路）では**偽**である。そこで返るキーの出どころは run 生成時に store が mint したキーであり、呼び出し側は `checkpointLane` を一度も呼んでいない。同様に契約 2 の「別 shard を自動 claim した場合は…（**解放済み lane が保持していた表と cursor**）」も、JSDoc が明示した「never claimed な lane は run の先頭表の head」を落としている。契約 3(a) の主語も「同一 lane を次表へ進めたとき」だけで、JSDoc が列挙する「run 生成時の先頭 position」を含まない。ポート JSDoc は `(Contracts 1–4: spec/adr/061.)` と ADR を契約列挙の出どころとして名指しているため、D1 実装者がリンクを辿った先に、正本より狭く一部が偽の記述が残る。R1 triage が `契約3(a)の主語がスイートより狭い` として JSDoc 側だけを直し、同じ主張を持つ ADR 側が追随していない。
  - 提案: 契約 2 の括弧書きを「その lane が立っている永続化済みの位置（一度も claim されていない lane なら run の先頭表の head、既に処理して解放された lane なら checkpoint 済みの表と cursor）」に広げる。契約 3(a) の主語を「store が position を作ったとき（run 生成時の先頭 position と、同一 lane を次表へ進めたとき）」にそろえ、3(b) の根拠文を「その値が呼び出し側の `checkpointLane` 由来である場合、規則を知っているのは呼び出し側だから」と条件付きに直す。あわせて契約 2 の `next: null` の列挙に、JSDoc が新設した第 3 経路（ack 後に pending が無く、他 lane は claimed のまま → `{ next: null, runCompleted: false }`）を 1 句足すと、`next === null` を run 完了と読む実装を canon 側でも塞げる。

### Warnings

- **[W-001]** 4 本の台帳の行を書き換えたのに、ヘッダーの「最終同期」が据え置かれている
  - 場所: `spec/inventory/test.md:3`, `spec/inventory/adapter.md:3`, `spec/inventory/domain.md:3`, `spec/inventory/usecase.md:3`
  - 理由: いずれも `（最終同期: 2026-08-24）` のままだが、本 PR（2026-08-25 のコミット 860490a / 0d37e2d）は TC-identity-165 の書き換え、TC-identity-347..349 の追加、DOM-common-030 / ADP-common-029 / UC-identity-021 の要点更新を行っている。直前の同種コミット c410926 は「台帳のヘッダーを同期した」として `2026-08-22 → 2026-08-24` を同時に上げており、ヘッダーの日付は台帳が本文へ追随した時点を主張する canon の一部として運用されている。現状はその主張が偽になっている。
  - 提案: 触れた 4 本のヘッダーを `（最終同期: 2026-08-25）` に更新する。

- **[W-002]** ADR 062 に今ラウンド足した 1 行が、型が保証しないことを保証として書いている
  - 場所: `spec/adr/062-unknown-sweep-table-skip.md:41`（同文が `packages/core/src/application/identity/pruneExpiredAuthState.ts:110-112` にも入っている）
  - 理由: 「継続 turn は `AuthStateTable` によって未知表を受け取らない」と書くが、`AuthStateTable` は静的な union であって、継続要求は Queue を経てプロセス／デプロイ境界を越えてくる payload である。ADR 062 が扱っている状況そのもの（表を減らす配備が、古い表集合で作られた run の続きを受け取る）では、旧配備が積んだ継続が未知表を名乗って届きうる。実際に起きるのは「型で受け取らない」ではなく「transport 境界の検証で弾かれる／sweep レジストリ参照が undefined になる」で、lane はリース失効まで claimed のまま残り、次の cron が本 ADR の skip 経路で回収する。継続の producer が未実装（本 PR 時点で grep 0 件）なので現在は到達しないが、canon の文としては「この経路は未知表に対して何もしなくてよい」と読める。
  - 提案: 「未知表の skip は cron（駆動）経路の振る舞いとして定める。継続 turn の入力は `AuthStateTable` に閉じており、境界を越えて未知表を名乗る継続が届いた場合はその turn では前進せず、lane はリース失効後の cron が同じ skip で回収する」程度に、保証ではなく回収経路として書き直す。JSDoc 側も同じ 1 文にそろえる。

- **[W-003]** スキーマ canon が「表を進めるのは shard ack 側」と書き、同じ段落の「shard 完了 ack」と衝突している
  - 場所: `spec/database/index.md:161`
  - 理由: 本 PR は checkpoint を position ベースへ畳んだうえで「（表は進めない — 表を進めるのは**shard ack 側**）」と補ったが、同じ段落は後段で「**shard 完了 ack**と次 position claim も同じ transaction で行い」と、shard ack を「lane の全表を終えたときの ack」の意味で使っている。実際に lane の position（index）を 1 つ進めるのは表完了 ack（`advanceOrAck(completed: true)` のうち最終表でない場合）で、shard 完了 ack はその index を使い切った場合の分岐である。この行は ADR 061 が「D1 実装者が進めた先の表を配備の設定から引かないための」必須記述として名指した箇所なので、進める主体が曖昧なまま残るのは重い。identity / job の usecase canon は同じ括弧書きを「表を進めるのは `advanceOrAck` 側」と正確に書いており、スキーマ canon だけが揺れている。
  - 提案: 「表は進めない — lane の position を進めるのは表完了 ack 側で、position を使い切ったときにそれが shard 完了 ack になる」に直す。ポート名を出さない方針を保つなら「shard ack」ではなく「表完了 ack」と呼び分けるだけでよい。

- **[W-004]** 動作検証手順書が、今ラウンドの適合スイート再編に追随していない
  - 場所: `.thread/16/testing.md:131-132`, `.thread/16/testing.md:257`
  - 理由: 確認項目 3 は「`ADP-common-028` を含む ✓ 行が存在し、そのケースが `advanceOrAck({ completed: false })` の戻り値について `{ next: null, runCompleted: false }` を主張している」ことを期待結果に置いているが、今ラウンドで解放の戻り値の拘束は `ADP-common-029: a release hands back no position even while another lane is pending` へ移った（R1 triage の `解放の拘束が置き場所違い` の是正）。また 257 行は「`GlobalMaintenanceRunStore conformance [memory]` の 11 ケースが 1 つも消えていない」と書くが、現在は 16 ケース（base 11 → R1 12 → R2 16）。手順どおりに検証すると、正しい状態が「期待と違う」と読まれる。
  - 提案: 確認項目 3 の ID を `ADP-common-029`（該当ケース名つき）へ、257 行のケース数を 16 へ更新する。plan の AC-8 も 029 を指定しているので、手順書だけが 028 のまま残っている。

- **[W-005]** ADR 061 の「影響」に、決定の帰結ではなく作業指示の形の文が残っている
  - 場所: `spec/adr/061-maintenance-sweep-order-authority.md:46-47`
  - 理由: 「これを [database/index.md] に書かないまま契約だけを足すと…」「同時に、lane が持つのは…と**決め切っておく必要がある**」「契約 3 を (a) / (b) に分けないと契約 2 と両立しない。…分けずに書くと…」は、いずれも本 PR で既に実施済みの作業に対する未来形の要求で、`.thread/16/plan.md:52-54` の「リスクと注意点」をほぼそのまま持ち込んだ形になっている。`spec/` は現在有効な設計だけを持ち、作業ログや工程判断を持たない場所であり、既存 ADR の「影響」節（例: 060、056）は成立済みの帰結の列挙になっている。なお `.thread/16/adr.md` が明示的に持ち込みを求めた「引き継ぎ」（2 つの呼び出し元で返り lane の扱いが正反対である根拠）は妥当な canon なので、これは対象外。
  - 提案: 46-47 行を成立済みの事実の形に畳む（例: 「run 行の順序付き表集合と、lane が表名ではなくその集合への position を持つことは `database/index.md` が定める。両方を決めないとスキーマ側で二重表現になるため」「契約 3 は (a) / (b) に分かれる。既存の checkpoint キーは規則外の文字列でも保持されるため、自動 claim で導出キーとの一致を要求すると契約 2 と両立しない」）。

- **[W-006]** 新規テストケース行の条件が「現行コード」基準で書かれている
  - 場所: `spec/testcases/identity/pruneExpiredAuthState.md:34`, `spec/inventory/test.md:488`
  - 理由: 「run の表集合が**現行コードの既定順**と違う」は、テストケース条件をコードの現在値に相対で定義している。`spec/` はコードについて真であることを書く場所であって、条件の基準点をコード側に置くと、既定の表集合が変わるたびに条件の意味が動く。本 PR の他の 2 行（348 / 349）は「同時 claim 上限（6）を超える」「この配備が sweep を持たない表」と配備・設計の語で書けている。
  - 提案: 「run の表集合がこの配備の既定の表集合と順序も内容も違う（表構成を変えたデプロイをまたいで resume する）」に直す。台帳の写しも同時に更新する（本文が正本）。

### 確認して問題なしと判断した点（記録）

- 変更されなかった spec 側の残存偽記述の洗い出し: `spec/` 全文を `advanceOrAck` / 表順 / lane / maintenance / prune で走査した。`spec/usecases/job.md:551` と `spec/platform/index.md:207` は今ラウンドで是正済み、`spec/testcases/job/pruneJobHistory.md`、`spec/testcases/identity/deleteAccount.md:72-73`、`spec/domains/{identity,job,workspace}.md` はいずれも run / lane の存在と active lane 上限しか述べておらず、新契約で偽にならない。`grep -rn "SWEEP_ORDER" packages apps` は 0 件（AC-2）。
- ADR 061 / 062 は `spec/adr/index.md` の一覧（66-67 行）と前提依存マップ（128-129 行）の両方に、既存行と同じ書式で登録されている。番号 061 / 062 に衝突なし。ADR 026 §1（契約の正本はポート定義、スイートだけが規定する振る舞いを残さない）に対しても、今ラウンドで足した 5 つの適合ケース（claimed のまま返る／virgin lane の自動 claim／pending 無しの ack／解放の戻り値／run 生成時の表集合で歩く）はすべてポート JSDoc 側に対応する記述がある。`setMaintenanceTables` を持たないバックエンドで契約 1 のケースが `ctx.skip()` になる形は、`accountDeletionManifestStore` の既存 optional hook と同じ前例に沿う。
- 台帳と本文の対: DOM-common-030 / ADP-common-029（`spec/domains/index.md:138` の署名変更由来、ADR 059 に適合）、UC-identity-021（行を足さず要点欄で追随、ADR 052）、TC-identity-165 の本文・台帳の同時更新、TC-identity-347..349（本文 3 行と台帳 3 行が同文、末尾採番で 346 の次、実テスト名と 1 対 1）。適合ケースには台帳行を採番していない（ADR 052 / 058）。
- コードからの ADR 参照はいずれも参照先と一致している: `di/types.ts:206`（union は型エラーにするが run の表集合経由は実行時 skip ＝ ADR 062 の残存条件と同義）、`pruneExpiredAuthState.ts:309`（skip + error ログ、`failures` に数えない）、`ports/globalMaintenanceRunStore.ts:53`（契約 1–4 の所在）。参照の書式 `spec/adr/NNN` も既存の慣行どおり。B-001 は参照先の記述そのものの問題。
- スコープ逸脱なし。`terminalPrune.ts` の変更は AC-12 が求める Runtime wiring note の 1 段落のみで、自動 claim された lane を即座に解放する挙動（ADR 061「影響」の引き継ぎ記述と一致）は変わっていない。`spec/platform/index.md` は steps.md が当初「対象外」と判定した箇所だが、R1 の指摘で checkpoint 記述を database canon にそろえた変更であり、逸脱ではなく整合の是正。
- triage-keys の `wont-fix`（`spec/usecases/identity.md:860,864` の「4 種」表記）に触れる指摘は出していない。

## カバレッジ

- 確認: `.thread/16/adr.md`, `.thread/16/plan.md`, `.thread/16/review/review-001-spec.md`, `.thread/16/review/triage-keys.md`, `.thread/16/review/triage.md`, `.thread/16/steps.md`, `.thread/16/testing.md`, `packages/core/src/adapters/conformance/backend.ts`, `packages/core/src/adapters/conformance/globalMaintenanceRunStore.ts`, `packages/core/src/adapters/memory/__tests__/conformanceBackend.ts`, `packages/core/src/adapters/memory/repositories/globalMaintenanceRunStore.ts`, `packages/core/src/application/di/types.ts`, `packages/core/src/application/identity/__tests__/pruneExpiredAuthState.test.ts`, `packages/core/src/application/identity/deleteAccount/terminalPrune.ts`, `packages/core/src/application/identity/pruneExpiredAuthState.ts`, `packages/core/src/application/ports/globalMaintenanceRunStore.ts`, `spec/adr/061-maintenance-sweep-order-authority.md`, `spec/adr/062-unknown-sweep-table-skip.md`, `spec/adr/index.md`, `spec/database/index.md`, `spec/domains/index.md`, `spec/inventory/adapter.md`, `spec/inventory/domain.md`, `spec/inventory/test.md`, `spec/inventory/usecase.md`, `spec/platform/index.md`, `spec/testcases/identity/pruneExpiredAuthState.md`, `spec/usecases/identity.md`, `spec/usecases/job.md`
- スキップ: `.thread/16/review/review-001-adapter.md` — 前ラウンドのレビュー記録そのもので、canon の真偽を左右しない（triage で判定済み）。`.thread/16/review/review-001-usecase.md` — 同上。`.thread/16/review/review-001.md` — 同上（統合レポート）。

### 差分外で確認した参照

`spec/adr/026-port-contract-and-conformance.md`, `spec/adr/060-conditional-unique-claim-teardown.md`（ADR 書式の基準）, `spec/adr/056-performance-budget-placement.md`, `spec/testcases/job/pruneJobHistory.md`, `spec/testcases/identity/deleteAccount.md`, `spec/domains/identity.md`, `spec/domains/job.md`, `spec/domains/workspace.md`, `packages/core/src/adapters/memory/store.ts`, `docs/runtime_node.md`, `git log`（台帳ヘッダー同期の前例 c410926）。
