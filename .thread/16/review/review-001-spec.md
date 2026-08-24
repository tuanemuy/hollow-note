# レビュー 001 — Issue #16 / Spec canon

## Spec canon

### Blockers

- **[B-001]** 書き換えた当の文に、表名ベースの checkpoint 記述が残っている（同一文内で矛盾している）
  - 場所: `spec/usecases/identity.md:879`
  - 理由: 手順 2 は前半で「run storeの`checkpointLane`が**次table**/cursor/決定的command keyと次Queue outboxをrouting catalog transactionで保存する」と述べたまま、後半に「表の走査順の正本はrun生成時に固定した表集合だけで、usecaseは表順を持たない」「ackは進めた先のpositionを返す」を足している。`checkpointLane` の `table` は**現在の表**（`packages/core/src/adapters/memory/repositories/globalMaintenanceRunStore.ts:220` の `MAINTENANCE_LANE_TABLE_MISMATCH` 照合に使うだけで保存もしない）であり、表を進めるのは `advanceOrAck` 側。本 PR は同じ主張を `spec/database/index.md:161` では明示的に是正しており（「現在positionのkeyset cursorと次command keyのcheckpoint…（表は進めない — 表を進めるのはshard ack側）」）、`spec/inventory/adapter.md:36` の ADP-common-028 も「cursor と次 command key を原子的に checkpoint する」で揃っている。usecase canon だけが旧表現のまま残り、しかも**同じ段落の後半と食い違う**。steps.md ステップ 2 が `spec/database/index.md` について「同じ段落に残る表名ベースの checkpoint 記述も同時にそろえる」と自ら要求した是正が、同じ事実を述べるもう 1 か所に適用されていない。
  - 提案: 「run storeの`checkpointLane`が現在positionのcursorと次command key、および次Queue outboxをrouting catalog transactionで保存する（表は進めない）」に直す。`spec/database/index.md:161` と同じ言い回しに寄せる。

- **[B-002]** 同じポートを使うもう 1 つの usecase canon が、廃止したはずの「呼び出し側が次表を名指す」モデルのまま残っている
  - 場所: `spec/usecases/job.md:551`（手順 0、`jobTombstonePrune` 分岐）
  - 理由: 「target shardのDELETE成功後、run storeの**table**/cursor/次command keyとQueue outboxだけを…checkpointする。100件なら同laneの次cursor、**100件未満なら次table**、shard完了ならrun storeへackして未claim shardを1件取得する」。これは `pruneExpiredAuthState` 側で本 PR が偽と判定して書き換えた文（旧 879 行「100件未満なら次表、全4表完了ならrun storeへshard ackして…」）と同型で、新しい契約 1（表の走査順は run のスナップショットが唯一の正本、呼び出し側は表順を持たない）と契約 2（`advanceOrAck` が進めた先の position を返す）に真正面から反する。`GlobalMaintenanceRunStore` は 3 kind が共有するポート（`spec/domains/index.md:152`）なので、この記述は kind 固有の例外ではなく**ポート契約の別解釈**として残る。ADR 061 が「D1 実装者が配備の設定から次表を引き、二重正本がバックエンド側で再生する」と警戒した経路そのものが、canon の側に温存されている。`jobTombstonePrune` の usecase 実装がまだ無いことは、canon が偽の記述を保持してよい理由にはならない（`spec/` は「現在有効な設計として真であること」を書く場所）。
  - 提案: `spec/usecases/job.md:551` の当該 2 文を identity 側と同じ表現へそろえる。checkpoint は「現在positionのcursorと次command key（表は進めない）」、前進は「100件未満なら`advanceOrAck`で前進し、返った position（同laneの次表、またはlane最終表ackで自動claimされた別shardの永続化済みposition）をそのまま次の対象にする」。スコープ外と判断するなら、plan.md の「含まれないもの」に**この文が偽として残ること**を明示し、追跡先（spec-sync / Issue）を書く。現状の plan は `jobTombstonePrune` の *usecase 実装* を除外しているだけで、canon が偽になる点には触れていない。

### Warnings

- **[W-001]** platform canon の checkpoint 内容が、書き換えた database canon とずれた
  - 場所: `spec/platform/index.md:207`
  - 理由: 「DELETE成功後にcatalog上の**table**/cursor/command keyと次Queue outboxだけを原子的にcheckpointし」。`spec/database/index.md:161` は本 PR で「現在positionのkeyset cursorと次command key…（表は進めない）」へ畳み、lane が持つのは表名ではなく position（index）だと決め切った。同じ 1 トランザクションの中身を 2 つの正典が違う列挙で述べている状態になる。steps.md は platform 207 を「応答形状にも表順の権威にも触れていないので対象外」と判定したが、判定の対象が「表順の権威」に絞られていて、**checkpoint が何を保存するか**という database canon 側の変更との整合が見落とされている。
  - 提案: 207 行の checkpoint 列挙から `table` を落とし、`spec/database/index.md:161` と同じ「現在positionのcursorと次command key」に寄せる。1 語の修正で 2 正典が一致する。

- **[W-002]** ADR 062 が「型で捕まえていた失敗を実行時の静かな取りこぼしへ戻す」と記録したのに、その型の JSDoc は逆の主張を続けている
  - 場所: `packages/core/src/application/di/types.ts:200-205`（`AuthStateTable`）
  - 理由: JSDoc は「this union is what makes a missing registration a type error rather than a table that is never collected」と書く。ADR 062 の残存条件は、同一配備内で run の表集合と sweep レジストリがずれた場合、その表が**恒久的に、静かに、掃かれない表**になると明記しており、まさにこの JSDoc が否定していた状態を受容している。読者が最初に当たるのは型の JSDoc なので、canon（062）と食い違う主張がコード側に残るのは、本 PR が ADR 046 の裏返し（記述と実態の乖離）を新設したことになる。
  - 提案: JSDoc の後段を「登録漏れは union を経由する呼び出しでは型エラーになるが、run の表集合（`readonly string[]`）経由で入る表は実行時に skip される（spec/adr/062）」に改め、062 を引く。ADR 側は既に正しいので、直すのはコメント 1 文でよい。

- **[W-003]** TC-identity-165 の条件欄が「あるshard」のまま残り、同時に直したエラーケース表（invocation 単位）と噛み合っていない
  - 場所: `spec/testcases/identity/pruneExpiredAuthState.md:20`、`spec/inventory/test.md:306`
  - 理由: エラーケース表は「**その invocation で試みた削除がすべて失敗**」へ直され、実装（`pruneExpiredAuthState.ts:432` の `failures > 0 && successes === 0`）とテスト（`TC-identity-165: when every sweep of the invocation fails …`）もこれと一致する。一方テストケース行と台帳行は「**あるshardで**、この配備が掃ける表の削除がすべて失敗する」のままで、shard 単位の全滅は実装では throw しない。plan.md AC-11 は両者を「同じ事実を述べる行」として扱っているが、揃えたのは括弧の但し書きだけで、条件のスコープ（shard / invocation）は揃っていない。
  - 提案: 条件欄を「その invocation で試みた削除がすべて失敗する（掃けない表の skip は分子にも分母にも入らない）」に直し、テストケースファイルと `spec/inventory/test.md` の両方を同時に更新する（本文が正本、台帳は写し）。期待欄の「上限超過時はDLQと運用通知へ送る」は本 Issue 外の既存乖離。

- **[W-004]** 新設 ADR 061 / 062 を、コード側のどこからも引いていない
  - 場所: `packages/core/src/application/ports/globalMaintenanceRunStore.ts:48-80`（契約 1〜4）、`packages/core/src/application/identity/pruneExpiredAuthState.ts:300-322`（未知表 skip）
  - 理由: このリポジトリは非自明な判断の出どころを JSDoc から `spec/adr/NNN` で引く運用がある（`domain/note/ports/htmlProcessor.ts:20,54,60`、`application/identity/removeIdentity.ts:21`、`application/di/memoryRuntime.ts:108` など）。CLAUDE.md も「コードで驚くところには ADR がある」を前提にしている。「行が掃かれないまま run が completed になる」（062）と「解放は絶対に position を返さない」（061 契約 2）は、実装を読んだ人が必ず理由を探す種類の挙動。steps.md が禁じたのは `.thread` ローカルの番号（ADR-001..006）であって、昇格後の `spec/adr/061` / `062` を引くことは steps.md 自身が想定していた（ステップ 6「canon 化するものだけ `spec/adr/061` / `062` として引く」）。
  - 提案: ポート JSDoc の契約段落末尾に `(spec/adr/061)`、未知表 skip のコメントに `(spec/adr/062)` を 1 語ずつ添える。ADR 062 の残存条件（同一配備内ドリフトは検出されない）への入口にもなる。

- **[W-005]** 同じ文書内で「4 種 / 4 表」表記と新しい「run の表集合」表記が混在し、残債の追跡先が canon にも plan にも無い
  - 場所: `spec/usecases/identity.md:860`（概要）・`:864`（入力 DTO の table union）・出力 DTO 表、`spec/testcases/identity/pruneExpiredAuthState.md:17-18`
  - 理由: plan.md「含まれないもの」がこれを spec-sync の管轄として明示的に除外しているのは妥当な線引きだが、本 PR で同じ表の隣接行（TC-165、エラーケース表、手順 2）が run の表集合ベースへ移ったため、1 文書内に 2 つのモデルが並ぶ状態になった。canon 側にも Issue 側にも追跡先が残っていないので、次に読む人は「どちらが現在有効か」を判断できない。
  - 提案: 是正自体はスコープ外のままでよい。ただし残債の追跡先（既存 Issue 番号、または spec-sync 実行の予定）を plan.md の該当箇所に 1 行として書き足す。`identity_removal_receipts` が出力 DTO と入力 DTO union の両方から欠けている点も同じ扱い。

### 良かった点（記録）

- ADR 061 / 062 は `spec/adr/index.md` の**一覧（66-67 行）と前提依存マップ（128-129 行）の両方**に登録され、既存行と同じ書式・同じ粒度で書かれている。前提として挙げた 026 / 046 / 061 / 025 はいずれも本文中でもリンクされており、依存マップの記載と ADR 本文の「前提」節が一致している。
- ADR 2 本とも「現在有効な判断」として書かれており、経緯・作業ログ・`.thread` ローカル番号の流入が無い。棄却案は既存 ADR（060 等）と同じ「検討した代替案」節に畳まれている。ADR-001 の Consequences が持っていた引き継ぎ（2 つの呼び出し元で返り lane の扱いが正反対である根拠）も 061 の「影響」に落ちており、`.thread` の掃除で根拠が消える経路が塞がれている（`terminalPrune.ts:203-214` の実装とも一致を確認）。
- 台帳と本文の対がすべて揃っている: DOM-common-030 / ADP-common-029（`spec/domains/index.md:138` の署名変更由来、ADR 059 の「本文由来のときだけそろえる」に適合）、UC-identity-021（行を足さず要点欄で追随、ADR 052 に適合）、TC-identity-347..349（テストケースファイルの追加 3 行と `spec/inventory/test.md` の追加 3 行が同文、末尾採番で 346 の次、実テスト名 `TC-identity-347/348/349` と 1 対 1）。
- `spec/database/index.md:161` の改訂が「表集合を足すだけ」に留まらず、lane 側の独立した `table` 列を position（index）表現へ畳み切っている。スキーマ canon 側で二重表現を作らないという ADR 061 の要求を満たしている。
- `.thread/16/{plan,steps,adr,testing}.md` をコミットに含める運用は既存の `.thread/1` / `.thread/13` 等と一致する（`git ls-files .thread` で確認）。`progress.md` だけ他スレッドにあって 16 に無いが、進行中成果物なので指摘としない。
- スコープ逸脱は見当たらない。`terminalPrune.ts` の変更は JSDoc 1 段落のみ（AC-12 の対象）で、plan が「挙動も型も変えない」と宣言した通り。

## カバレッジ

- 確認: `.thread/16/plan.md`, `.thread/16/steps.md`, `.thread/16/adr.md`, `.thread/16/testing.md`, `packages/core/src/adapters/conformance/globalMaintenanceRunStore.ts`, `packages/core/src/adapters/memory/repositories/globalMaintenanceRunStore.ts`, `packages/core/src/application/identity/__tests__/pruneExpiredAuthState.test.ts`, `packages/core/src/application/identity/deleteAccount/terminalPrune.ts`, `packages/core/src/application/identity/pruneExpiredAuthState.ts`, `packages/core/src/application/ports/globalMaintenanceRunStore.ts`, `spec/adr/061-maintenance-sweep-order-authority.md`, `spec/adr/062-unknown-sweep-table-skip.md`, `spec/adr/index.md`, `spec/database/index.md`, `spec/domains/index.md`, `spec/inventory/adapter.md`, `spec/inventory/domain.md`, `spec/inventory/test.md`, `spec/inventory/usecase.md`, `spec/testcases/identity/pruneExpiredAuthState.md`, `spec/usecases/identity.md`
- スキップ: なし

### 差分外で確認した参照

`spec/usecases/job.md`（B-002）、`spec/platform/index.md`（W-001）、`packages/core/src/application/di/types.ts`（W-002）、`packages/core/src/adapters/memory/store.ts`、`spec/adr/060-conditional-unique-claim-teardown.md`（ADR 書式の基準）、`.thread/1/`（`.thread` 運用の前例）。
