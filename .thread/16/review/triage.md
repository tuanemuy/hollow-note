# レビュー台帳 — Issue #16 / PR #45

| Key | 初出 | 判定 | 理由（一行） | 再指摘 |
|---|---|---|---|---|
| `application/identity/__tests__/pruneExpiredAuthState.test.ts:TC-identity-349/アサーションの形骸化` | R1 | fix | 実物確認: fixture の `tables: ["job_tombstones","sessions"]` は `sessions` が成功して `successes=1` になるため `failures += 1` を戻しても緑のまま、AC-6 の中心主張が未拘束（`.thread/16/testing.md:225` の「view の `failures` が 0」も実在しないフィールドを指す） | 0 |
| `application/ports/globalMaintenanceRunStore.ts:advanceOrAck/契約1の実行形が無い` | R1 | fix | 統合元: usecase [W-002] + adapter [W-001]。適合 fixture が表集合を構築時に固定するため「run のスナップショットから引く」と「配備の設定から引く」が同じく緑（変異検証済み）で、本 PR の中心主張だけが ADR 026 の実行形を持たない | 0 |
| `application/ports/globalMaintenanceRunStore.ts:advanceOrAck/契約2の null 列挙が不完全` | R1 | fix | 統合元: usecase [W-001] + adapter [W-003]。memory:275-303 に第 3 経路（ack 後 pending 無し・他 lane claimed → `{next:null,runCompleted:false}`）が実在し、JSDoc の列挙にも適合ケースにも無い。同じ文の「the table and cursor it was released with」が virgin lane を言い当てていない点も同時に直す | 0 |
| `adapters/conformance/globalMaintenanceRunStore.ts:ADP-common-029/自動claimのasOf未検証` | R1 | fix | 実物確認: 次表分岐にのみ `asOf` の assert があり自動 claim 分岐に無い。AC-8 が両分岐に要求しており、`asOf` をその場の時刻で埋める変異が 12 件全緑で通ることを検証済み | 0 |
| `application/ports/globalMaintenanceRunStore.ts:advanceOrAck/契約3(a)の主語がスイートより狭い` | R1 | fix | 実物確認: run 生成時の position も store が作るもので ADP-common-027 がそれを拘束しているのに契約文は「次表へ進めたとき」だけを列挙。あわせて staging 追加で消えた virgin lane の自動 claim 被覆（現在 0 件）を 1 ケースで戻す | 0 |
| `adapters/conformance/globalMaintenanceRunStore.ts:ADP-common-028/解放の拘束が置き場所違い` | R1 | fix-editorial | 実物確認: `spec/inventory/adapter.md` は 028=`checkpointLane`・029=`advanceOrAck` と定めており、解放の戻り値拘束は 029 の主張。AC-8 も 029 を指定。fixture 追加不要でアサーションの移動のみ | 0 |
| `spec/usecases/identity.md:879/手順2に表名ベースのcheckpoint記述が残存` | R1 | fix | 実物確認: 同一段落の前半が「`checkpointLane` が次table…を保存する」のまま後半に新契約を足しており自己矛盾。`spec/database/index.md:161` は本 PR で「現在positionの…（表は進めない）」へ是正済みで、usecase canon だけ旧表現 | 0 |
| `spec/usecases/job.md:551/手順0が旧契約（呼び出し側が次表を名指す）のまま` | R1 | fix | 実物確認: 「100件未満なら次table」は本 PR が偽にした文と同型。`GlobalMaintenanceRunStore` は 3 kind 共有ポート（`spec/domains/index.md:152`）なのでポート契約の別解釈が canon に残る。plan の除外は `jobTombstonePrune` の *usecase 実装* であって canon 記述ではない。2 文の修正で収まるので defer しない | 0 |
| `packages/core/src/application/di/types.ts:AuthStateTable/JSDocがADR062と矛盾` | R1 | fix | 実物確認: JSDoc は「登録漏れは型エラーであって二度と掃かれない表にはならない」と書くが、ADR 062 の残存条件はまさにその状態を受容した。読者が最初に当たる面に canon と逆の主張が残る。コメント 1 文 | 0 |
| `spec/testcases/identity/pruneExpiredAuthState.md:20/TC-identity-165の条件欄がshard単位のまま` | R1 | fix | 実物確認: エラーケース表は「その invocation で試みた削除がすべて失敗」へ直り実装（`failures > 0 && successes === 0`）とも一致するが、本文 20 行と `spec/inventory/test.md:306` は「あるshardで」のまま。AC-11 の「本文と台帳の片側だけを直さない」に反する | 0 |
| `spec/platform/index.md:207/checkpoint内容がdatabase canonとずれた` | R1 | fix-editorial | 実物確認: `table/cursor/command key` の列挙が、本 PR で「現在positionのcursorと次command key（表は進めない）」へ畳んだ `spec/database/index.md:161` と食い違う。1 語の削除で 2 正典が一致 | 0 |
| `application/ports/globalMaintenanceRunStore.ts:契約1〜4/ADR061・062をコードから引いていない` | R1 | fix-editorial | 事実確認: `spec/adr/NNN` を JSDoc から引く慣行は実在（`domain/note/ports/htmlProcessor.ts`, `application/identity/removeIdentity.ts`, `di/memoryRuntime.ts` ほか 20 箇所超）。CLAUDE.md の「既定でコメントを付けない」は新規コメントの話で、既存 JSDoc への出典 1 語追加は抵触しない。`.thread` ローカル番号の禁止（adr.md 10 行）にも触れない | 0 |
| `application/identity/pruneExpiredAuthState.ts:runContinuation/未知表skipが継続経路に無い` | R1 | fix-editorial | ADR-006 が決着させたのは契約 4 の**主体**であって未知表 skip の経路限定ではないので蒸し返しではない。ただし実物確認どおり `PruneExpiredAuthStateInput.table: AuthStateTable` で継続は transport 境界に閉じており、挙動追加はスコープ外（Queue 配線）。ADR 062 の「影響」と usecase JSDoc に cron 経路限定を 1 行ずつ書く記述のみ | 0 |
| `spec/usecases/identity.md:860,864/「4種」表記の混在と残債の追跡先` | R1 | wont-fix | `.thread/16/plan.md:44` が既に spec-sync 管轄と明示しており追跡先は存在する。plan へ追跡行を足すのは同じ線引きを二重に書くだけで、本 PR が偽にした文（手順 2・エラーケース表・TC-165）は別行で直す | 0 |

R1: 新規 14 / fix 9 / fix-editorial 4 / wont-fix 1 / defer 0 / 継承 0（方針フェーズ: 実施）
fix内訳: usecase 3 / adapter 6 / spec 4
