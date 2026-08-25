# 指摘台帳 — Issue #11

## Round 001

レビュー 5 本の指摘を重複統合したもの。総数 **62 件**（fix 56 / wont-fix 1 / defer 3 / 要確認 2）。
Blocker は重複統合後 **6 件**（ラウンドサマリーの B-007 は B-001 と同一のため計上しない）。

### UoW / 実行機構・SQL 土台

| Key | 指摘 | 判定 | 理由 | 再指摘 |
|---|---|---|---|---|
| `do/repositories/scopeTaskScheduler.ts:claimDue/排他` | 条件付き UPDATE の結果を見ずに全候補を `ScopeTask` として返し、並行 claim が同じ行を 2 度配る（**Blocker**） | fix | コード確認済み。`claimDue` 188 行が `selected` を無条件に返す。ポート JSDoc「two `claimDue` calls running at once never hand out the same row」に反する実装漏れで ADR 046 の手続きも経ていない | 1 |
| `__tests__/lease.test.ts:二重claim観測` | 「exactly one of two writers」が格納 lease 値しか見ず API レベルの排他を観測していない | fix | 上の欠陥が緑で通った原因そのもの。テストが名乗る性質を観測する形へ書き直す | 1 |
| `adapters/conformance/scopeTaskScheduler.ts:並行claimケース` | 並行 `claimDue` を観測する適合ケースが 1 件も無い | 要確認 | 契約の穴を塞ぐ本筋だが適合スイート本体の変更にあたる。AC-8 / ADR 046 の手続き（memory も同じケースを通す）が要り、偽クロック下の並行ケースは不安定化リスクもある。メインが可否を決める | 1 |
| `do/alarm.ts:runScopeAlarmTurn/失敗耐性` | ハンドラ失敗の try/catch と backoff が無く `attempts` が永久に増えない。ハンドラ経路のテストが 0 件 | fix | `alarm.ts:129-137` に try/catch 無しを確認。CLAUDE.md「worker → root」と参照実装 `scopeTaskRunner.ts:176-189` の双方に反する。ハンドラを引数で注入可能にすれば失敗経路もテストできる | 1 |
| `execution/scopeUnitOfWork.ts:occGuard翻訳の未検証` | scope 平面の `_occ_guard` → `OPTIMISTIC_LOCK_FAILURE` 翻訳が DO RPC 越しに成立するか一度も検証されていない | fix | `classifySqlError` は文字列一致。global 平面のみ実バインディングで検証済み。scope 平面のケースを 1 件足す（AC-4） | 1 |
| `do/scopeObject.ts:exec/bindable検査` | bound parameter 100 の検査が scope 平面で効かず `createStorageExecutor` が死にコード | fix | `grep` で `createStorageExecutor` の参照は定義と JSDoc のみ。`ScopeObject.exec` は `storage.sql.exec` 直叩き。spec/platform も両平面に同じ上限を定めている | 1 |
| `do/scopeObject.ts:bind/メモ化` | `bind` が全 RPC で INSERT+SELECT を撃ち、読み 1 回が 3 文になる。`scopeColumnsFromName` / `scopeColumns` が死にコードで解析を手書き再実装（**Blocker B-005 の根**） | fix | `scopeObject.ts:126-155` を確認。読み専用 RPC が書き込みトランザクションを開く点も含め、AC-5 の実測値がずれる直接の原因。束縛済み ScopeKey をインスタンスにメモ化する | 1 |
| `do/dueIndex.ts:再公開の無界とサイズ` | due index 再公開が scope 全タスク数に比例し、`dueIndexRowsStatement` は LIMIT を持たず 1 binding に全行を畳む | fix | routing W-008 と同根。`assertBindable` が守るのは個数のみでサイズは無防備。上限と超過時の扱いを決め、JSDoc に前提を書く | 1 |
| `sql/session.ts:readRows/matches・limit` | staged 削除 + LIMIT で件数を取りこぼす。`matches` が optional で型に守られていない | fix | 現時点で踏んでいる箇所は無いことをレビュアーが確認済みだが、`matches` 必須化と JSDoc の制約明記は同一ファイル完結で安い。あわせて ADR-014 の「掃引後も read-your-writes が正しい」の書きぶりを狭める | 1 |
| `execution/writeSet.ts+sql/executor.ts+do/alarm.ts:未使用export` | 呼び出し元 0 の export が 6 つ。`markTouched` 未使用が「`opaque` で `scheduled_tasks` を触ると index publish と alarm 再武装が黙って飛ぶ」穴を不可視にしている | fix | `grep` で 6 件すべて未参照を確認。削除するか型で規約を表現する。`createStorageExecutor` は ADR-002 の alarm ローカル適用が未達である証拠なので、消すなら adr.md の当該行も直す | 1 |
| `do/repositories/scopeTaskScheduler.ts:queryCandidates素通し` | staged で候補読みがオーバーレイを通らず、同一リポジトリ内で読みの一貫性が割れている | fix | 契約違反ではないが ADR-009 の「意図的な素通しと読める」を満たすコメント 1 行で済む | 1 |
| `execution/globalUnitOfWork.ts:1 commit の文数上限` | 1 batch の文数に番人が無く D1 の invocation 予算（500）が守られていない | fix | ADR-008 自身が「`_occ_guard` で文数が最大 2 倍」と書いた前提。`assertBindable` と対称に上限チェックか JSDoc 明記を置く | 1 |
| `di/cloudflareRuntime.ts:ephemeralKeyRing` | 鍵束の既定値が isolate ごとに変わり、共有リンクと deletion ticket が isolate 境界で黙って壊れる | fix | Workers はリクエストごとに別 isolate になりうる。ADR-030 が `mailSender` について述べた理由がそのまま当てはまるので必須オプション化する | 1 |

### Identity / directory / operation

| Key | 指摘 | 判定 | 理由 | 再指摘 |
|---|---|---|---|---|
| `d1/repositories/globalMaintenanceRunStore.ts:occGuard欠落` | lease・lane の条件付き更新に `_occ_guard` が無く「lease 保持者だけが進める」契約が成立しない（**Blocker**） | fix | `grep` で当該ファイルの `occGuard` 参照 0 件を確認（他の identity 束は全て積んでいる）。ADR-008 の二段構えからこの 1 ファイルだけが外れている。**ただし「`PRUNE_WORKER_ID` がプロセス定数なので全 Worker が同一 owner を名乗る」という副論点は誤り** — `PRUNE_LEASE_OWNER = crypto.randomUUID()` は isolate ごとに異なる。この副論点は採らない | 1 |
| `d1/migrations/0001:auth_tokens 部分UNIQUE + findPending 非決定` | spec が要求する pending 部分 UNIQUE が無く省略の記録も無い。`findPendingByUserAndPurpose` が `ORDER BY` 無しで非決定 | fix | 索引が非 UNIQUE であること、`LIMIT 1` に `ORDER BY` が無いことをコードで確認。適合スイートが複数 pending を許すので索引は張れない → spec を改め adr.md に記録し、`ORDER BY created_at DESC, id DESC` を足す（AC-8 / AC-9） | 1 |
| `d1/migrations/0001:新設2表がspec未反映` | `account_deletion_manifest_items` / `global_maintenance_run_lanes` が spec の物理配置表にも列定義にも無い | fix | AC-9 の直接の取りこぼし。同じ PR が `scope_task_due_index` / `_scope_identity` は反映しているので非対称 | 1 |
| `d1/migrations/0001:列・索引のspec差分` | `user_version`（読み手なし）・`(user_id, kind)` 索引（使用箇所なし）が spec に無く、`created_at` が欠落 | fix | AC-9。読み手が無い列と索引はどちらかへ倒す。使われない索引は D1 の write コストに乗る | 1 |
| `d1/migrations/0001:identities 8件上限トリガー` | spec が多層防御として明示する `BEFORE INSERT` トリガーが無く省略の記録も無い | fix | トリガーは足さず、ADR 054 に倣って「ポート契約が要求せず適合スイートも観測しないので置かない」を adr.md へ記録する（AC-9） | 1 |
| `d1/repositories/globalMaintenanceRunStore.ts:beginOrResumeKind/PK違反` | 同一 hour bucket に completed run が残ると PK 違反で `SystemError`。memory は `started` を返し観測が割れる | fix | `candidateRunId` が決定的で completed が 30 日残る以上、cron 再駆動で確実に踏む。memory 側が契約に合っているので `ON CONFLICT DO UPDATE` で揃える | 1 |
| `di/cloudflareRuntime.ts+conformanceBackend.ts:DEFAULT_MAINTENANCE_TABLES 3コピー` | 表集合の実体が 3 コピーになり、ドリフトが ADR 062 の「静かに掃かれない」経路に直結する | fix | 本 PR で 2 コピー増やした分の責任は取る。`runtimeComposition.test.ts` に `DEFAULT_MAINTENANCE_TABLES.authStatePrune` と `authStateSweeps` のキー集合一致を固定する。**単一正本への統合は別ブランチ `issue/16/sweep-table-order-single-source` の持ち分なのでここでは行わない** | 1 |
| `d1/repositories/{accountDeletionManifestStore,identityRemovalReceiptStore}.ts:DO NOTHING+upsert像` | `DO NOTHING` の文に `upsert` の行像を添えており read-your-writes が嘘をつく | fix | 「SQL は何もしないのにオーバーレイだけ自分の行像を持つ」形。ADR-029 が manifest の item 側で採った `opaque` と同じ判断へ揃えるだけで済む | 1 |
| `__tests__:一意性予約・distributed operation の競合観測` | `_occ_guard` と部分ユニーク索引が守る性質に実バインディングテストが無い | fix | AC-4 が名指しする「memory が原理的に証明できない性質」の中心。`lease.test.ts` の既存ケースと同じ形で 2 ケース書ける | 1 |
| `__tests__/pendingPorts.ts:足場とコメント残存` | `PENDING_PORTS` が空で機構が到達不能、12 ファイルのコメントが偽情報＋作業指示になっている | fix | composition W-001 と同一。`isPendingPort` は常に false、`port(name, build)` は恒等関数。CLAUDE.md「Default to no comments」と現在の状態について嘘を言うコメントの両方に当たる | 1 |
| `d1/repositories/identityUniqueDirectory.ts:operation_id UNIQUE` | 「全部か無かで publish する」ループが `operation_id UNIQUE` により 1 行しか回らない。`translateReserve` が `operation_id` 衝突を「鍵が使われている」と誤訳しうる | fix | 成立しない性質を説明するコメントの削除と、PK 衝突と `operation_id` 衝突を区別する翻訳修正は同一ファイル完結 | 1 |
| `application/ports:1 operation = 何行かの契約統一` | ポート JSDoc（複数形）・memory（`rowsByOperation` が配列）・D1 スキーマ（UNIQUE）の三者で理解が割れている | defer | 統一にはポート JSDoc・memory 実装・適合スイートが同時に動く。memory の振る舞い変更は AC-7 に抵触し、本 Issue のスコープ（今日ポートがある 30 スイートの CF 実装）を越える。別 Issue 起票 | 1 |

### Routing / outbox / scope インフラ

| Key | 指摘 | 判定 | 理由 | 再指摘 |
|---|---|---|---|---|
| `d1/repositories/{noteRouteStore,outboxRepository,idempotencyStore,noteRouteFanOutReader}.ts+scopeTaskQueue+scopeRouter:エラー翻訳` | 駆動エラーを翻訳しておらず生の D1 エラーが application 層へ抜ける（**Blocker**） | fix | `grep` で 6 ファイルとも `throwTranslated` / `classifySqlError` を import すらしていないことを確認。`noteRouteStore` は UoW 外（autocommit）で呼ばれるので commit 側の翻訳にも拾われない。`noteRouteStore.ts:96-101` の JSDoc が「surfaces as `ConflictError("OPTIMISTIC_LOCK_FAILURE")`」と書いていて実装と食い違う。CLAUDE.md「adapter → application」に正面から反する | 1 |
| `do/scopeObject.ts+do/alarm.ts+di/cloudflareRuntime.ts:2 writer 併走` | DO Alarm turn と中央 runner の 2 writer を既定で出荷し ADR-019 の単一 writer 前提が崩れる。空のハンドラ表で claim するため中央 runner が飢餓する（**Blocker**） | fix | コードで確認 — `applyWriteSet` は `scheduled_tasks` を触れば無条件に `rescheduleAlarm`、`alarm()` は無条件に `runScopeAlarmTurn`、`registerScopeTaskHandler` の呼び出しは repo 内 0 件、`createWorkerContainer` は `scopeTaskQueue` を配線。空レジストリで claim → `running` 放置 → `nextWakeAt` = lease 満了 → 再武装、で中央 runner は永久に取れない。ADR-019 が「再訪の引き金」と呼んだ構成を既定で踏んでいる | 1 |
| `do/scopeObject.ts:applyWriteSet/publishDueIndex 失敗で alarm 未武装` | `publishDueIndex` が落ちると `rescheduleAlarm` に到達せず、ADR-003 の「次の alarm が治す」自己修復が成立しない | fix | `scopeObject.ts:75-78` の await 順を確認。alarm 再武装を D1 の可用性に依存させないだけで直る | 1 |
| `do/alarm.ts:CPU budget とハンドラ実行` | budget が打ち切るのは次チャンクの claim だけで、AC-6 の `leaseMs` 下限論拠が担保されていない | fix | `while (remaining > 0 && elapsedMs() < cpuBudgetMs)` の外にハンドラ実行がある。ADR-019 の決着そのものではなくその根拠の記述精度の問題なので、budget をハンドラ後にも見るか ADR-019 の当該行を正確に書き直す | 1 |
| `d1/repositories/outboxRepository.ts:staged 拒否` | `claimPending` / `pruneProcessed` が staged セッションで黙って write-set を素通りする | fix | `grep staged` で当該ファイルにフラグ参照 0 件（`idempotencyStore` は分岐している）。`SqlSession.staged` の JSDoc がまさにこの用途を書いている。1 行の明示的拒否で済む | 1 |
| `__tests__:NoteRouteStore の occGuard 発火` | ADR-015 が「同時実行の砦」と位置づけた 10 遷移ぶんの仕掛けが完全に未検証 | fix | 適合スイートは全て逐次呼び出しで分岐側の判定が先に捕まえる。上のエラー翻訳漏れが表に出なかった原因でもあるので、翻訳修正とセットで足す | 1 |
| `do/dueIndex.ts:名前空間欠落` | due index 行に名前空間が乗らず ADR-004 の factory ごとの分離がこの表だけ効かない | fix | UoW 経由で `scheduled_tasks` を触るテストを同一ファイルへ足した瞬間に不安定化する。ADR-004 の分離規約を破る唯一の表なので塞ぐか制約として明記する | 1 |
| `d1/repositories/outboxRepository.ts:save/1 binding サイズ` | 1 UoW 分のイベントを 1 binding に畳み、値サイズ上限（2,000,000 バイト）に無防備 | fix | `assertBindable` が守るのは個数のみ。`assertBindable` にサイズ検査を足して「静かに壊れる」代わりに落とす | 1 |
| `do/repositories/scopeTaskScheduler.ts:write/publish 失敗の扱い` | scope 側 commit 成功後の D1 失敗を「書き込み失敗」として呼び出し元へ返す | fix | `write` が `session.write` と `publishDueIndex` を同じ try に入れているのを確認。ADR-003 が index の drift を許容している以上、後者の失敗を握って警告に留めるのが契約に忠実 | 1 |
| `spec/database/index.md:scope_task_due_index の autocommit publish` | 更新主体が 2 つあることが spec に書かれておらず、ADR-020 が作業ファイルにしか無い | fix | AC-9 の取りこぼし。1 行の追記で済む | 1 |

### Scope business / 投影・全文検索 / R2

| Key | 指摘 | 判定 | 理由 | 再指摘 |
|---|---|---|---|---|
| `spec/platform/index.md:AC-5 実測値` | `4n + 3` は DO 内の実 SQL 文数ではない（`bind()` が全 RPC で +2 文、実際は約 `8n + 9`）（**Blocker**） | fix | `scopeObject.ts` の `query` / `applyWriteSet` がどちらも先頭で `bind` を呼び、`bind` が INSERT + SELECT を撃つことをコードで確認。計測 harness は executor 呼び出し回数を数えているだけで DO 内文数ではない。**`bind` メモ化（UoW 側の対応行）を先に入れ、そのうえで実測し直して canon を実測値に合わせる** | 1 |
| `d1/repositories/publicNoteProjection.ts:非public行のD1投影` | `public_note_search` に private / trashed の本文まで投影され、可視性の絞り込みが read 側だけに置かれている | 要確認 | `replaceSnapshotIfNewer` が可視性を一切見ないことをコードで確認。spec/database と ADR 021 は「public かつ active の行だけ」と明記しており canon 違反。ただし memory も同型で、CF だけ直すか canon を実装へ合わせるかは正本レベルの判断。CF 側だけ直す場合も世代ベクトルの比較可能性をどう保つかが自明でない。メインが方向を決める | 1 |
| `{localNoteQueryService,publicNoteQueryService}.ts:SELECT ns.*` | `text`（最大 800KB）を全行ぶん運ぶ | fix | `NoteSummary` に `text` は無く、使うのは excerpt 不一致時のハイライトだけ。列を明示すれば済む | 1 |
| `do/repositories/noteRevisionRepository.ts:全列読み+1行1文削除` | 削除のためだけに `html` 全列を読み、削除は 1 行 1 文 | fix | 保持 20 版 × 800KB で最大 16MB を DO から Worker へ運ぶ。`deleteRowsFromJson` があるのに使っていない | 1 |
| `do/repositories/{storedFileRepository,noteRepository}.ts:readForUpdate 事前読み` | `readForUpdate` の事前読みが契約上不要で `4n+3` の `2n` を作っている | wont-fix | **adr.md ADR-008 / ADR-013 / ADR-025 で決着済み。** 二段構え（ステージ時の読みで固有符号を決め、guard は同時実行の砦）はこの PR の中核規律で、ADR-025 が「省くと版の不一致が呼び出し地点ではなく commit で初めて現れる」を明示的にトレードオフとして記録している。新事実は出ていない。最適化は ADR-002 が「契約を満たしてから行う」と範囲外に置いたとおり別作業 | 1 |
| `search/highlight.ts:mapPositions 文字単位NFKC` | 1 文字単位 NFKC が全体 NFKC と一致せず、結合列の本文でハイライトが `null` になる | fix | NFKC は合成を含むので文字単位適用は全体適用と等しくない。spec が「双方に同じ前処理」と定めており規定違反。取り込み HTML 由来の NFD 混じりは普通に起こる | 1 |
| `projection/searchClauses.ts:tagNames 重複` | `COUNT(DISTINCT …) = ?` に `tagNames.length` を渡すため重複があると必ず 0 件になる | fix | 呼び出し 2 箇所とも `criteria.tagNames.length` を push しているのをコードで確認。memory は `every` なので重複は無害 → 同じ入力で 2 バックエンドの答えが違う。`new Set(...).size` で直る | 1 |
| `do/repositories/localNoteQueryService.ts:listMonthsWithNotes 無界` | 所有者の全 active ノートを Worker のメモリへ引き上げる | fix | spec/platform の分割単位表は他の全経路に 50〜200 行の上限を置いており、ここだけ無制限 | 1 |
| `r2/objectStorage.ts:deleteMany の 1,000 件上限` | 1 回の `bucket.delete` に渡す key 数の上限を確認しない | fix | コードで確認（`keys.map(physical)` をそのまま渡す）。R2 の制約はアダプターの内側にあるべき知識。1,000 件チャンクで済む | 1 |
| `projection/snapshotWriter.ts:redactAuthor 戻り値` | 条件付き UPDATE が 0 行でも `true` を返し overlay を無条件に書く | fix | ポート JSDoc「Returns whether a row changed」に反する。戻り値を数える運用イベントが過大に出る | 1 |
| `spec/platform/index.md:ADR056 配置違反` | アダプターの実装内訳を予算文書に書いており ADR 056 の決定 3 に反する | fix | ADR 056 が「どのバックエンドが届かないかは予算文書ではなく ADR のコンテキストに残す」と明記。AC-5 が許したのは当該行を実測値へ改めることだけ | 1 |
| `spec/database/index.md:scope検証の縮小と llm_usages` | 縮小が canon に反映されず、`llm_usages` は ADR-024 の列挙にも無い | fix | 判断（ADR-024）は妥当だが置き場所が作業ファイル。`spec/database/index.md:20` を narrow し、ADR-024 を `spec/adr/` へ昇格して `llm_usages` を列挙に加える（AC-9） | 1 |
| `本番ソース 24 箇所:.thread/11/adr.md 参照` | canon でない作業ファイルを `spec/adr/` と衝突する「ADR 001〜004」番号で参照（**Blocker**） | fix | `grep` で本番ソース含む 19 ファイル 24 箇所を確認。`spec/adr/003` `004` は実在するので確実に取り違える。参照されている判断（write-set、RPC 1 往復、due index、テスト名前空間、AC-6 の決着）は次の実装者が必ず読むもの。`spec/adr/` へ昇格して索引と前提依存マップに載せる | 1 |
| `cursor.ts:signed でない` | ポートが言う "signed" になっていない | fix | base64url した JSON で fingerprint は criteria から決定的に計算できるため改竄検出になっていない。memory も同型で、AC-7 が memory 変更を禁じる以上ここで採れるのは「ポート JSDoc を『opaque かつ fingerprint 付き』へ弱める」側のみ。ADR 046 の手続き（正本のある側へ倒す）として adr.md に記録する。適合スイートは変更しない | 1 |

### 合成・スキーマ・テストハーネス・spec/docs

| Key | 指摘 | 判定 | 理由 | 再指摘 |
|---|---|---|---|---|
| `d1/schema.ts+do/schema.ts:MIGRATION_VERSION` | 未参照の死に定数、かつ spec の不変条件（両平面が同じ migration version を共有）を破ったまま守っていると書いている | fix | `grep` で参照が定義行 2 つのみを確認。global が 3 で scope が 1 の現状は spec の不変条件違反。削除するか導出する | 1 |
| `d1/migrations:0002 欠番と 0003 の索引作り直し` | 未適用スキーマに対し `0003` が `0001` の索引を DROP して作り直し、`0002` は欠番 | fix | `ls` で 0001 と 0003 のみを確認。配備一式がスコープ外＝どこにも適用されていない以上、`0001` に畳んで 1 ファイルにできる | 1 |
| `d1/schema.ts:GLOBAL_TABLES_IN_WIPE_ORDER` | 手書き二重管理で漏れ検知テストが無く、「in an order safe to delete in」も FK が無い以上ミスリード | fix | 漏れると適合スイートの backend 間で行が残り、症状はテスト順依存の偶発的な赤になる。導出化か逆方向の一致テストで塞ぐ | 1 |
| `adapters/__tests__/conformanceCoverage.test.ts:件数固定なし` | 集合の相対比較のみで、スイート本体と呼び出しを同時に消すと緑のまま契約が 1 本消える | fix | ADR-031 が動機に挙げた「間引きは緑のまま起きる」の一番素直な形が抜けている。`toBe(31)` / `toBe(30)` を足す | 1 |
| `vitest.config.ts+vitest.workers.config.ts:include の窓` | 和集合が全体を覆っておらず `.test.ts` が漏れる窓がある。`CLOUDFLARE_ADAPTER_GLOB` は同ファイル内でしか使われない export | fix | node 側 exclude が `adapters/cloudflare/**`、workers 側 include が `**/__tests__/**/*.test.ts` であることを確認。`d1/` 直下の `foo.test.ts` はどちらも拾わない | 1 |
| `.github/workflows/ci.yml:timeout-minutes` | workers 追加で実測 +107s、`timeout-minutes: 10` が逼迫 | fix | 現状 10 分のままであることを確認。落ちたとき「テストが壊れた」ではなく「タイムアウト」として現れる。apps/web や memory を触らないので AC-7 に抵触しない | 1 |
| `docs/test.md:nothing is stubbed` | workers プロジェクトの実態と食い違う | fix | `deleteFilesByOwner.test.ts` の `notImplementedPort` と `runtimeComposition.test.ts` の `mailSender: vi.fn()` が反例。fake 方針は docs/test.md が正本なので条件を付ける | 1 |
| `spec/platform/index.md:「往復」の語` | 契約文（往復は件数に比例しない）と実測（往復は 2n）が同じ語で同じ節に並ぶ | fix | AC-5 が testcases 側を動かすなと定めた結果、platform 側に軸の説明を足す義務が生じている | 1 |
| `packages/core/tsconfig.json:cloudflareRuntime 名指し` | `exclude` / `include` にファイル 1 つを名指しで両方書く二重管理 | fix | 2 つ目のランタイムを足すとき片方だけ更新するとそのファイルが型検査から静かに落ちる。`src/application/di/cloudflare*.ts` の規約パターンで済む | 1 |
| `.thread/11/adr.md:ADR-026 欠番` | ADR-025 → ADR-027 で番号が飛んでいる | fix | 読み手が「削られた判断があるのか」を確認する手間になる。1 行で済む | 1 |
| `adapters/conformance/backend.ts:1テスト2backend の制約` | 「1 テストで 2 backend を作ると D1 面の分離が破綻する」制約が JSDoc に無い | fix | 適合スイートの**振る舞い**は変えない JSDoc 1 行のみ。ADR 046 の手続きは不要 | 1 |
| `di/runtime.ts:MemoryRuntime の AppRuntime 適合` | 適合が `asAppRuntime(null as unknown as MemoryRuntime)` 1 ケースだけで固定されている | defer | 塞ぐには `memoryRuntime.ts` の型注釈を書き換える。振る舞いは変わらないが Node 参照ランタイムの配線に手を入れる形になり AC-7 の保守的な線を越える。次スライスの先頭で片付ける | 1 |
| `adapters/memory:暗号 / Intl アダプターの分離` | Cloudflare ランタイムが `adapters/memory/` から暗号アダプターを import している | defer | plan.md「含まれないもの」が明示的にスコープ外と定め、ADR-030 が理由を述べている。起票のみ行う（`adapters/crypto/` への移動を提案に含める） | 1 |

### fix の観点別内訳

- UoW / 実行機構・SQL 土台: 12
- Identity / directory / operation: 11
- Routing / outbox / scope インフラ: 10
- Scope business / 投影・全文検索 / R2: 12
- 合成・スキーマ・テストハーネス・spec/docs: 11

合計 56（wont-fix 1 / defer 3 / 要確認 2 を除く）

## 修正の実行計画（Round 001）

束 1〜6 は担当ファイルが重ならないので並列委譲できる。束 7 は 1〜6 の完了後に直列で走らせる（本番ソース 24 箇所のリンク張り替えが全束のファイルに掛かるため）。

### 束 1: Scope task の claim 排他・alarm turn・due index

- 含む指摘: `review-001-uow.md` の B-001, W-001, W-003, W-004, W-005, W-008 ／ `review-001-routing.md` の B-002, B-003, W-001, W-002, W-003, W-007, W-008(dueIndex 側), W-009 ／ `review-001-scope.md` の B-001(bind メモ化側)
- 触るファイル:
  - `packages/core/src/adapters/cloudflare/do/repositories/scopeTaskScheduler.ts`
  - `packages/core/src/adapters/cloudflare/do/scheduledTasks.ts`
  - `packages/core/src/adapters/cloudflare/do/alarm.ts`
  - `packages/core/src/adapters/cloudflare/do/scopeObject.ts`
  - `packages/core/src/adapters/cloudflare/do/dueIndex.ts`
  - `packages/core/src/adapters/cloudflare/do/scopeName.ts`
  - `packages/core/src/adapters/cloudflare/do/scopeStub.ts`
  - `packages/core/src/adapters/cloudflare/sql/executor.ts`
  - `packages/core/src/adapters/cloudflare/__tests__/lease.test.ts`
  - `packages/core/src/adapters/cloudflare/__tests__/alarm.test.ts`
- 修正方針:
  - **claim 排他**: `claimStatement` の直前に候補述語を再掲した `occGuard` を積む（ADR-008 の形をそのまま適用）。敗者は commit 時に中断して `OPTIMISTIC_LOCK_FAILURE` になり、ポート JSDoc の「offering one row to two runners costs no more than a claim one of them loses」と一致する。autocommit 経路で batch 全体が落ちる粒度が困る場合のみ `RETURNING` / `meta.changes` で実際に更新できた行だけを返す形へ分ける。`do/alarm.ts` の turn 側も同じ文を共有するので同じ guard を積み、「await が無いから安全」という読み取れない前提をコードから消す。
  - **2 writer 併走**: routing B-003 の対案 (a) を採る — **レジストリが空のときは claim せず `rescheduleAlarm` だけ行う**。対案 (b)（`createWorkerContainer` から `scopeTaskQueue` を外す）は採らない。ADR-003 の due index は中央 runner の `listDue` のために新設した表で、ポート契約が `listDue` の実装を要求しているため。倒した側を `.thread/11/adr.md` の ADR-019 / ADR-020 と `spec/platform/index.md` の単一 writer 前提の節に書く（spec 反映は束 7）。
  - **bind メモ化**: 束縛済み `ScopeKey` をインスタンス変数へキャッシュし、2 回目以降は照合だけにする。読み経路から書き込み文が消え、AC-5 の実測値が `bind` 抜きの値に戻る。解析と列変換は `scopeName.ts` の 3 関数へ寄せてインラインの重複を消す（`scopeColumnsFromName` が生き返る）。measurement 結果は束 7 が spec へ反映するので、実測値を `.thread/11/adr.md` ADR-025 に記録すること。
  - **`createStorageExecutor`**: 束 1 で `ScopeObject.exec` から使って生かす（W-003 の bindable 検査と同時に解消）。生かせないと判断したら削除し、ADR-002 の「alarm 経路はローカル適用」の行を配備スライスの宿題として書き直す。
  - `publishDueIndex` は `rescheduleAlarm` より後（または `finally`）へ移し、alarm 再武装を D1 の可用性に依存させない。`scopeTaskScheduler.write` は `session.write` と `publishDueIndex` を別 try に分け、後者の失敗は握って警告に留める。

### 束 2: D1 routing / outbox のエラー翻訳と staged 拒否

- 含む指摘: `review-001-routing.md` の B-001, W-005, W-006, W-008(outbox save 側)
- 触るファイル:
  - `packages/core/src/adapters/cloudflare/d1/repositories/noteRouteStore.ts`
  - `packages/core/src/adapters/cloudflare/d1/repositories/outboxRepository.ts`
  - `packages/core/src/adapters/cloudflare/d1/repositories/idempotencyStore.ts`
  - `packages/core/src/adapters/cloudflare/d1/repositories/noteRouteFanOutReader.ts`
  - `packages/core/src/adapters/cloudflare/scopeTaskQueue.ts`
  - `packages/core/src/adapters/cloudflare/scopeRouter.ts`
  - `packages/core/src/adapters/cloudflare/sql/statement.ts`（`assertBindable` にサイズ検査）
  - `packages/core/src/adapters/cloudflare/__tests__/routeConflict.test.ts`（新規）
- 修正方針: 翻訳先は既定の `OPTIMISTIC_LOCK_FAILURE` でよい（ADR-013 / ADR-015 が確認済み）。`claimPending` / `pruneProcessed` は `session.staged` を明示的に拒否する（`idempotencyStore` と一貫）。新規テストは `beginMove` / `switchMove` / `finishPurge` のいずれかで読み込み後・commit 前に別経路が行を進める状況を作り、`ConflictError("OPTIMISTIC_LOCK_FAILURE")` を固定する。

### 束 3: Global maintenance run / identity store の並行制御と冪等

- 含む指摘: `review-001-identity.md` の B-001, W-001(ORDER BY 側), W-005, W-007, W-008, W-010
- 触るファイル:
  - `packages/core/src/adapters/cloudflare/d1/repositories/globalMaintenanceRunStore.ts`
  - `packages/core/src/adapters/cloudflare/d1/repositories/accountDeletionManifestStore.ts`
  - `packages/core/src/adapters/cloudflare/d1/repositories/identityRemovalReceiptStore.ts`
  - `packages/core/src/adapters/cloudflare/d1/repositories/identityUniqueDirectory.ts`
  - `packages/core/src/adapters/cloudflare/d1/repositories/authTokenRepository.ts`
  - `packages/core/src/adapters/cloudflare/__tests__/globalConcurrency.test.ts`（新規。`lease.test.ts` は束 1 が触るので分ける）
- 修正方針:
  - `_occ_guard` は他の store と同じ形へそろえる。run 行を書く 3 か所に「読んだ `lease_owner` / `lease_until` そのもの」の guard を前置し、外れたら `foreignLease` へ翻訳。`laneUpdate` には ADR-015 と同型の行同一性 guard を前置。
  - **`PRUNE_WORKER_ID` がプロセス定数なので全 Worker が同一 owner を名乗る、という副論点は採らない**（`PRUNE_LEASE_OWNER = crypto.randomUUID()` は isolate ごとに異なる）。`application/identity/pruneExpiredAuthState.ts` は触らない。
  - `beginOrResumeKind` は `ON CONFLICT (run_id) DO UPDATE` で memory と同じ「作り直し」に揃える（memory 側が契約に合っている）。
  - manifest / receipt の `DO NOTHING` は `opaque` へ倒してオーバーレイに寄与させない（ADR-029 と同じ判断）。
  - `identityUniqueDirectory` は成立しないコメントを削り、`translateReserve` が PK 衝突と `operation_id` 衝突を区別するようにする。契約の単数/複数の統一は defer。

### 束 4: Scope business / 投影・全文検索 / R2

- 含む指摘: `review-001-scope.md` の W-002, W-003, W-005, W-006, W-007, W-008, W-009, W-013（W-001 は 要確認 の判断が出てから着手）
- 触るファイル:
  - `packages/core/src/adapters/cloudflare/do/repositories/localNoteQueryService.ts`
  - `packages/core/src/adapters/cloudflare/do/repositories/noteRevisionRepository.ts`
  - `packages/core/src/adapters/cloudflare/d1/repositories/publicNoteQueryService.ts`
  - `packages/core/src/adapters/cloudflare/d1/repositories/publicNoteProjection.ts`（要確認の結論が出た場合のみ）
  - `packages/core/src/adapters/cloudflare/projection/searchClauses.ts`
  - `packages/core/src/adapters/cloudflare/projection/snapshotWriter.ts`
  - `packages/core/src/adapters/cloudflare/search/highlight.ts`
  - `packages/core/src/adapters/cloudflare/r2/objectStorage.ts`
  - `packages/core/src/adapters/cloudflare/cursor.ts`
- 修正方針:
  - `cursor.ts` は **実装を変えず、ポート JSDoc の "signed" を「opaque かつ fingerprint 付き」へ弱める側へ倒す**。HMAC を入れると memory も同時に変わり AC-7 に抵触する。ADR 046 の「正本のある側へ倒す」手続きとして `.thread/11/adr.md` に判断を記録し、適合スイートは変更しない。ポート JSDoc の変更は `packages/core/src/domain/note/ports/publicNoteQueryService.ts` に及ぶので、束 4 の担当がそこも持つ。
  - `redactAuthor` は `occGuard` + 無条件 UPDATE（当たらなければ中断）か、autocommit 経路では変更行数で戻り値を決める。overlay に無条件で赤字化行を置かない。
  - `mapPositions` は `normalizeForSearch(source)` を一度掛け、写像を「正規化後のコード単位 → 元テキストの区間」として作る。完全に閉じられない場合は `spec/database/index.md`「既知の限界」への追記を束 7 へ渡す。

### 束 5: UoW 実行機構・SQL 土台の型と番人

- 含む指摘: `review-001-uow.md` の W-002, W-006, W-007(writeSet 側), W-009
- 触るファイル:
  - `packages/core/src/adapters/cloudflare/sql/session.ts`
  - `packages/core/src/adapters/cloudflare/execution/writeSet.ts`
  - `packages/core/src/adapters/cloudflare/execution/globalUnitOfWork.ts`
  - `packages/core/src/adapters/cloudflare/execution/scopeUnitOfWork.ts`
  - `packages/core/src/adapters/cloudflare/__tests__/unitOfWork.test.ts`
- 修正方針: `matches` を必須にし、全表読みは `ALL_ROWS` のような明示的な番人を通す。`limit` については「ステージ済み削除があると SQL の `LIMIT` を補正できない」を JSDoc の制約として明記。`markTouched` は「`opaque` で `scheduled_tasks` を触る mutation を作る側が必ず呼ぶ」規約を型で表現する（`opaque` に `table?` を持たせ `stage` 側で `touched` に入れるのが素直）。`stagedDeletions` / `isEmpty` は使うか消す。scope 平面の occ guard ケース（`Promise.all` で同じ scope へ 2 本 commit し、敗者が `OPTIMISTIC_LOCK_FAILURE` で落ちる）を 1 件足す。1 commit の文数上限は `apply` 入口のチェックか JSDoc 明記のどちらかで閉じる。

### 束 6: スキーマ・migration・DI 合成・テストハーネス・CI

- 含む指摘: `review-001-uow.md` の W-010 ／ `review-001-identity.md` の W-004(記録は束 7), W-006(テスト側), W-009 ／ `review-001-composition.md` の W-001〜W-009 と「判断」欄の tsconfig 名指し・`conformance/backend.ts` JSDoc
- 触るファイル:
  - `packages/core/src/adapters/cloudflare/d1/migrations/0001_global_schema.sql`
  - `packages/core/src/adapters/cloudflare/d1/migrations/0003_membership_directory.sql`（`0001` へ畳んで削除）
  - `packages/core/src/adapters/cloudflare/d1/schema.ts`
  - `packages/core/src/adapters/cloudflare/do/schema.ts`
  - `packages/core/src/application/di/cloudflareRuntime.ts`
  - `packages/core/src/adapters/cloudflare/__tests__/pendingPorts.ts`（削除）
  - `packages/core/src/adapters/cloudflare/__tests__/ports/*.ts`（7 ファイル）
  - `packages/core/src/adapters/cloudflare/__tests__/conformance/*.test.ts`（7 ファイル）
  - `packages/core/src/adapters/cloudflare/__tests__/conformanceBackend.ts`
  - `packages/core/src/adapters/cloudflare/__tests__/harness.test.ts`
  - `packages/core/src/adapters/cloudflare/__tests__/runtimeComposition.test.ts`
  - `packages/core/src/adapters/cloudflare/__tests__/deleteFilesByOwner.test.ts`
  - `packages/core/src/adapters/__tests__/conformanceCoverage.test.ts`
  - `packages/core/src/adapters/conformance/backend.ts`（JSDoc 1 行のみ）
  - `vitest.config.ts` / `packages/core/vitest.workers.config.ts`
  - `packages/core/tsconfig.json` / `packages/core/tsconfig.cloudflare.json`
  - `.github/workflows/ci.yml`
  - `docs/test.md`
- 修正方針:
  - migration は `0001` に索引の最終形と `membership_directory` を畳んで 1 ファイルにする（未適用スキーマなので append-only の規律は掛からない）。あわせて identity W-002 / W-003 が指摘した列・索引（`user_version`、`(user_id, kind)` 索引、`identity_removal_receipts.created_at`）を「足す / 落とす」どちらかへ倒す — 落とす側を既定にし、spec 反映は束 7 へ渡す。
  - `conformance/backend.ts` は **JSDoc 1 行のみ**（「1 テストで 2 backend を作ると D1 面の分離が破綻する」）。適合ケースの追加・変更は行わない（ADR 046 の手続きが不要な範囲に留める）。
  - `DEFAULT_MAINTENANCE_TABLES` は本 PR では単一正本化しない（Issue #16 の持ち分）。`runtimeComposition.test.ts` に `DEFAULT_MAINTENANCE_TABLES.authStatePrune` と `authStateSweeps` のキー集合一致を固定するだけに留める。
  - `ephemeralKeyRing` は `mailSender` と同じ必須オプションにし、合成根で必ず渡させる。
  - `pendingPorts.ts` は削除し `port<T>(name, build)` を `build()` へ畳む。`deleteFilesByOwner.test.ts` が使う `notImplementedPort` の 1 用途だけ当該ファイルへ移す。
  - CI は `timeout-minutes` 引き上げ（20）か workers を独立ジョブへ分離。後者を推す。

### 束 7: spec / canon の追随と ADR 昇格（束 1〜6 の後に直列）

- 含む指摘: `review-001-composition.md` の B-001, W-010 ／ `review-001-scope.md` の B-001(spec 側), W-010, W-011, W-012 ／ `review-001-routing.md` の W-010 ／ `review-001-identity.md` の W-001(spec 側), W-002, W-003(spec 側), W-004(記録)
- 触るファイル:
  - `spec/adr/063-…` 以降（新規。少なくとも ADR-001 / 002 / 003 / 004 / 006 / 007 / 008 / 019 / 020 / 024 / 025 / 030 を昇格）
  - `spec/adr/index.md`（索引と前提依存マップ）
  - `spec/database/index.md`
  - `spec/platform/index.md`
  - `.thread/11/adr.md`（昇格した ADR の参照先差し替え、ADR-026 欠番の明記、ADR-014 の書きぶりの狭め、新たに決めた判断の追記）
  - 本番ソース 19 ファイル 24 箇所のリンク張り替え（束 1〜6 が触る全ファイルに掛かる）
- 修正方針:
  - AC-5 の数字は**束 1 の `bind` メモ化を入れたうえで測り直した実測値**を書く。予算文書には「書き込みは件数によらず 1 回の原子適用」という実行基盤の軸の主張だけを残し、`4n + 3` の内訳は ADR 側（昇格した ADR-025）へ置く（ADR 056 決定 3）。
  - 「往復」の語は書き分ける（「書き込み側の RPC 往復は 1 回。読み側は 1 件あたり 2 回」）。`spec/testcases/storage/deleteFilesByOwner.md` は AC-5 のとおり動かさない。
  - `spec/database/index.md:20`（scope 検証）を「scope 鍵として使っている列」へ narrow し、`llm_usages` を ADR-024 の列挙に加える。
  - `scope_task_due_index` の節に autocommit 経路の publish（ADR-020）を 1 行足す。
  - `auth_tokens` の pending 部分 UNIQUE は「DB 制約としては置かない（適合スイート ADP-identity-024 が複数 pending を許す）」へ改め、ADR 046 の手続きとして判断を残す。`identities` の 8 件上限トリガーを置かない理由も同様に記録（ADR 054 に倣う）。
  - 新設 2 表（`account_deletion_manifest_items` / `global_maintenance_run_lanes`）を物理配置表と列定義へ足す（ADR 061 が対で定めよと言っている箇所）。


## 要確認の決定（メイン）

| Key | 決定 | 理由 |
|---|---|---|
| `conformance/scopeTaskScheduler.ts:並行claimケース` | **wont-fix（このPRでは変更しない）＋ 別Issue起票** | Blocker 本体は CF 側の `occGuard` とバックエンド固有テストで閉じる。共有スイートに並行 claim ケースを足すのは両バックエンドの契約変更で、偽クロック下の並行ケースは memory の直列化と観測が噛み合わず不安定化する。ADR 046 の手続きを踏む価値はあるが本 Issue のスコープを越える |
| `publicNoteProjection:非public行のD1投影` | **defer（別Issue起票）** | canon（ADR 021）違反だが memory も同型で、直すのは `PublicNoteProjectionWriter` の契約変更＝両バックエンド＋適合スイートの改訂。plan.md の「含まれないもの」に照らしてこの PR の外。ただし private 本文が global D1 に載り可視性が read 側フィルタ頼みになる点はセキュリティ上の実害があるため、優先度付きで起票する |

## defer / wont-fix で起票した Issue（Round 001）

| Key | 判定 | 起票 Issue |
|---|---|---|
| `publicNoteProjection:非public行のD1投影` | defer | #47（security） |
| `conformance/scopeTaskScheduler.ts:並行claimケース` | wont-fix（このPRでは変更しない） | #48 |
| `identityUniqueDirectory:1 operation = 何行か` | defer | #49 |
| `adapters/memory:暗号 / Intl アダプターの分離` | defer | #50 |
| `di/memoryRuntime.ts:AppRuntime 適合の型固定` | defer | #51 |
| `DEFAULT_MAINTENANCE_TABLES:単一正本化` | 部分 defer（この PR が増やした 3 つ目のコピーは解消済み） | 既存 #16 の持ち分 |

## Round 002

レビュー 5 本の指摘（Blocker 9 / Warning 26 = 35 件）を重複統合したもの。総数 **31 件**（fix 30 / defer 1 / wont-fix 0 / 要確認 0）。
Blocker は重複統合後 **8 件**（`B-U01`≡`W-R01`、`B-I03`≡`B-C02`、`B-C01`≡`W-S04`、`W-S02`≡`W-C01` の 4 組を 1 件へ束ねた）。

Round 001 の台帳と Key を突き合わせた結果、**既出（wont-fix / defer 済み）の再指摘は 0 件**。`review-002-routing.md` の B-001 は #48（適合スイートへの並行 claim ケース追加）を明示的に「蒸し返さない」と断ったうえで別論点（ポート JSDoc とランナーの耐性）を立てており、継承ではなく新規として審議した。

判定の付随決定を 2 件、末尾の「付随決定」表に置く。

### UoW / 実行機構・SQL 土台

| Key | 指摘 | 判定 | 理由 | 再指摘 |
|---|---|---|---|---|
| `do/scopeObject.ts:applyWriteSet/commit 後の失敗が呼び出し元へ` | commit 済みの scope UoW が commit 後の alarm 再武装・due index publish の失敗で「失敗」として返る（**Blocker**、uow B-001 ≡ routing W-001） | fix | コード確認済み。`scopeObject.ts:85-99` は `this.sql.apply(statements)`（= `transactionSync` で確定）の**後**に `rescheduleAlarm` → `publishDueIndex` を裸で await し、`scopeUnitOfWork.ts:89-95` の catch が `SystemError(DatabaseError)` にして返す。同じ「commit 後の publish」を行う `do/repositories/scopeTaskScheduler.ts:113-121` は明示的に逆（warn に落とす）で、非対称は設計判断ではなく書き漏らし。ADR 023 と適合スイート `unitOfWork.ts` の「失敗＝全ロールバック」が観測上破れ、outbox 行が commit 済みなのに relay kick が飛ばない。Round 001 の同ファイル指摘（publish 失敗で alarm 未武装）は順序入れ替えで解決済みで、これは別の欠陥 | 1 |
| `do/scopeObject.ts:alarm()/turn 例外で未武装` | turn の例外で `rescheduleAlarm` に到達せず object が武装されないまま残る | fix | `scopeObject.ts:101-115` に try/finally が無いことを確認。`runScopeAlarmTurn` はハンドラ例外だけを内側で捕まえ、claim の `transactionSync` や `release`/`backoff` の直接 exec は素通しで throw する。上の Blocker と同じ「後始末は失敗しても必ず通す」規律で、修正も同じ形 | 1 |
| `sql/session.ts:readRows/述語から外れる staged 更新` | LIMIT ガードが staged 削除しか見ておらず、短いページが静かに返る | fix | `session.ts:128-141` のガードが `staged.includes(null)` のみであること、直後のマージが `spec.matches` で staged 行を絞ることをコードで確認。ADR-035 は穴を 2 つ挙げたがこの 3 つ目には触れていない（＝決着済み判断の蒸し返しではない）。同一ファイル完結で、条件を「`stored` のうち結果へ残らなかった行があるか」へ広げれば削除と更新が 1 条件で閉じる | 1 |
| `d1/repositories/globalMaintenanceRunStore.ts:生 NUL バイト` | ファイルに U+0000 のリテラルが埋まり `file(1)` が `data` と判定、`grep` がマッチを出さない | fix | `file` で `data` 判定を再現。CF アダプター配下でこのファイルだけ。`sql/row.ts:114` の `compositeKey` が「the escape sequence (not a raw byte) keeps call sites greppable」と名指しで避けよと書いており、同ファイルは別の鍵でその関数を使っている。動作は壊れていないが、grep から消えるファイルは実質レビュー不能 | 1 |
| `d1/repositories/userBatchReader.ts:翻訳欠落` | `session.readRows` を直接叩きながら駆動エラーを翻訳しない唯一のファイル | fix | `resolveMany` に try/catch が無いことを確認。ADR-034 が「`session.*` を直接呼ぶ地点だけを包む」と決めた対象そのもので、CLAUDE.md「adapter → application」にも反する。`ids.length > MAX_BATCH` の自前 throw は try の外に置くこと（ADR-034 の Consequences） | 1 |
| `sql/session.ts:autocommit の文数上限` | `MAX_STATEMENTS_PER_COMMIT` が autocommit の 1 batch に掛かっていない | fix | 検査が `globalUnitOfWork.ts:87` にしか無く、`createAutocommitSession.write` は `executor.apply` へ直行することを確認。ADR-036 の決定は「global 平面の commit だけが検査する」であり、autocommit の global write も同じ 1 batch なので**決定の実装漏れ**（決定の蒸し返しではない）。検査を `createD1Executor.apply` の入口へ下ろせば `assertBindable` と同じ位置で両経路が通る | 1 |
| `do/schema.ts+sql/session.ts:JSDoc の実体不一致` | 存在しない `applyScopeSchema` を名指し、`matches` が optional である前提の記述が残る | fix | 前者は識別子がリポジトリに存在せず実体は `SCOPE_SCHEMA_STATEMENTS`、後者は ADR-035 で `matches` を必須化した際の書き換え漏れ（`ALL_ROWS` の JSDoc が「once `matches` is optional」のまま）。どちらも JSDoc 1〜2 文 | 1 |
| `execution/{scope,global}UnitOfWork.ts:kick が ALS 文脈の内側` | commit 後の kick が開いた UoW の `AsyncLocalStorage` 文脈内で走り、トリガ実装が UoW を開くと nesting 判定で落ちる | fix | `runInUnitOfWork` が `openUnit.run(plane, fn)` で、2 つの kick が `fn` の内側にあることを確認。memory は ALS を持たないので CF でだけ壊れる。踏むのは配備スライスの先頭で、`waitUntil` の中なら誰も catch せず relay が黙って止まる。kick を `openUnit.run` の解決後へ出すのは 5 行 | 1 |

### Identity / directory / operation

| Key | 指摘 | 判定 | 理由 | 再指摘 |
|---|---|---|---|---|
| `d1/repositories/accountDeletionManifestStore.ts:acknowledgeReceipt の JSON RMW` | receipts の read-modify-write で並行 ack が 1 件消え、account deletion が恒久停止する（**Blocker**） | fix | `:568-578` が「header を読む → JS で配列を組む → `writeHeader` の無条件 UPDATE」であること、`writeHeader`（`:226-248`）が guard を持たないことを確認。receipt を積むのは互いに独立した 3 本の継続（`authResidueCleanup` / `deleteAccount/globalCleanup` / `cleanupDispatch`）で、relay はリース下で複数 worker が同時に行を掴む。消えた側は terminal turn を通過済みなので二度と ack せず、`allRequiredAcknowledged` が永久に false になる。plan.md「リスクと注意点」が最悪ケースとして名指した経路そのもの。memory は UoW 直列化で原理的に観測できないので緑は反証にならない。`json_insert` + `EXISTS` の 1 文で列を触らずに原子化できる | 1 |
| `d1/repositories/identityUniqueDirectory.ts:activate が CAS でない` | guard も UPDATE も予約行の同一性を持たず、失効予約を奪った別 operation の行を active 化する（**Blocker**） | fix | `:271-334` を確認。guard は `SELECT 1 FROM users WHERE id = ? AND version = ?` で User の版しか見ず、UPDATE の WHERE は `kind = ? AND normalized_key = ?` のみ。同ファイルの JSDoc が「Every transition is a compare-and-set」と宣言し `reserve` / `beginRelease` / `release` は実際に行同一性を持つのに、`activate` だけが外れている。奪われた行を active 化すると `release` が `reserved`/`releasing` しか消さないため誰にも解放できず、鍵が恒久リークする。UPDATE に `operation_id` を足し guard を予約行の同一性まで含める修正は同一ファイル完結 | 1 |
| `d1/repositories/accountDeletionManifestStore.ts:guard 皆無の状態機械` | 本束で唯一 `_occ_guard` を 1 つも積まない store | fix | 状態機械を持つ D1 store で guard 0 なのはここだけ（`identityUniqueDirectory` 7 / `distributedOperationStore` 5 / `authTokenRepository` 3 …）。`markCompleted` の `requiredAcknowledged()` が write と別 round trip で評価されることを確認。今日実害が出ていないのは呼び出し側の都合であって store の性質ではない。上の Blocker を 1 文化してもこの形は残る | 1 |
| `d1/repositories/globalMaintenanceRunStore.ts:beginOrResumeKind の敗北戻り値` | 新規作成分岐の guard 敗北時に、作られなかった run の ID を返す | fix | `:500-505` が `leased(input.candidateRunId, input.candidateAsOf)` を返すことを確認。resume 分岐の敗北は実在する run を指しており非対称。ポートは `leased` を「a run leased by a live foreign owner」と説明している。今日の唯一の呼び出し側は `runId` を捨てるので実害は無いが、戻り値の意味は壊れている。敗北経路だけ `readRunningRun` を撃ち直せばよい | 1 |
| `d1/repositories/identitySupport.ts:作業経緯コメント` | 「並列委譲だから束内に閉じている」「後で統合する」が JSDoc に残っている | fix | `:10-16` を確認。前半は作業の経緯、後半は未実施の予定で、CLAUDE.md「Default to no comments」と ADR-052 の向きの双方に合わない。2 文削るだけ | 1 |

### Routing / outbox / scope インフラ

| Key | 指摘 | 判定 | 理由 | 再指摘 |
|---|---|---|---|---|
| `application/ports/scopeTaskScheduler.ts+workers/scopeTaskRunner.ts:claimDue の ConflictError` | `claimDue` 競合時の `ConflictError` がポートのエラー契約に無く、`runDueScopeTasks` が捕まえないので tick 全体が落ちる（**Blocker**） | fix | ポート JSDoc の `Error contract: SystemError(DatabaseError).`（`:153`）と、`scopeTaskRunner.ts:159-162` が `claimDue` を `scopeUnitOfWorkProvider.run` 越しに try の外で呼んでいることを確認。ADR-044 の Consequences は「runner は次 tick で取り直す」と書くが、取り直されるのは競合した行だけで同じ tick の他 scope は巻き添えで落ちる。#48（適合スイートへの並行 claim ケース追加）とは別論点。**staged 経路では guard が commit 時に発火し `the scope unit of work` として翻訳される**ため、アダプター内で握り潰す倒し方は取れず、ランナー側の耐性が必要 | 1 |
| `d1/migrations/0001:note_routes の新設 2 列が spec 未反映` | `migration_id` / `last_migration_id` が spec にも adr.md にも無い（**Blocker**、AC-9） | fix | `0001_global_schema.sql:200-201` の 2 列と、`spec/database/index.md:97-112` の列表に無いことを確認。`last_migration_id` は契約側に対応物が無い純粋な新規列で、`switchMove` の応答喪失再試行（`noteRouteStore.ts`）を単独で支えている。同じ PR が `_occ_guard` / `scope_task_due_index` / `_scope_identity` / `account_deletion_manifest_items` / `global_maintenance_run_lanes` は spec へ反映しているので非対称 | 1 |
| `do/alarm.ts:1 行も訪問しない turn の即再武装` | claim 自体が CPU 予算を食い切ると 1 行も訪問せず全 release、過去 `due_at` で即再武装して進捗ゼロのループになる | fix | `alarm.ts:142`（while 条件）/ `:183`（ハンドラ前の予算判定）/ `:208-217`（release + break）を確認。`index === 0` で break すると claim した最大 10 行を `due_at` 据え置きで release し、直後の `rescheduleAlarm` が過去時刻で `setAlarm` する。ADR-046 の「誰も試していない仕事に attempt を払わない」は正しいが、その裏返しの無限ループは述べていない。予算判定を `index > 0` と AND すれば構造的に消える | 1 |
| `do/alarm.ts+di/cloudflareRuntime.ts:writer の受け渡し` | 「レジストリが writer を決める」が受け渡しになっていない（runner は無条件配線／登録しても既存行は武装されない） | fix | `scopeAlarmDrivesTasks()` による claim / 武装の抑止（`alarm.ts:67-83, 248-257`）は正しく効いているが、`cloudflareRuntime.ts:409` が `scopeTaskQueue` を無条件に配線していること、`rescheduleAlarm` がレジストリ空のとき `deleteAlarm()` するため後からハンドラを登録しても既存行が誰にも武装されないことを確認。ADR-045 の決定自体は蒸し返さない。**`ScopeObject` の constructor（`blockConcurrencyWhile` 内）で 1 度 `rescheduleAlarm` を通せば既存行の再武装が閉じる**（レジストリ空なら `deleteAlarm` になるので既定配備は無害）。runner を止める手当ては ADR-045 の Consequences へ | 1 |
| `__tests__/lease.test.ts:staged 経路の per-row 排他` | 排他の観測が autocommit 経路だけで、実配備が通る staged 経路は未観測 | fix | `lease.test.ts:164-215` が `createAutocommitSession` で 2 本の scheduler を作ること、実配備は `cloudflareRuntime.ts` の `buildRepositories` 経由で常に `createStagedSession` であることを確認。guard の発火地点（即時適用 vs commit）と翻訳コンテキストが違うので、AC-2 / AC-3 の観点では実配備経路も固定したい。あわせて ADR-020 の Context の「中央 runner は UoW を開かない経路もある」を現状（`runDueScopeTasks` は常に開く）に合わせて訂正する | 1 |
| `d1/repositories/outboxRepository.ts:pruneProcessed の RETURNING` | 件数を数えるためだけに全削除行を materialize する | fix | `:241-252` を確認。ADR-016 は「`DELETE … RETURNING id` の 1 文、`COUNT(*)` を別に撃たない」と決めたが、根拠は原子性と文数であって**応答サイズは量っていない**ので蒸し返しに当たらない。ポートに limit が無いので keyset 分割は契約変更になる。`meta.changes` で件数を取れば文数は 1 のまま応答が縮む（`SqlExecutor` に「書いて件数を返す」1 本を足す） | 1 |

### Scope business / 投影・全文検索 / R2

| Key | 指摘 | 判定 | 理由 | 再指摘 |
|---|---|---|---|---|
| `projection/snapshotWriter.ts:replace/remove が条件付き書き込みでない` | 世代ベクトルの条件付き書き込みになっておらず、並行 public consumer で lost update と contentless FTS 索引の破損が起きる（**Blocker**） | fix | `snapshotWriter.ts:153-190` の `replace` / `remove` が `stored` を材料に mutation を組むだけで guard を積まないこと、`publicNoteProjection.ts:34-75` が read → compare → write の 3 段であること、同ファイルの `redactAuthor` は逆に guard へ寄せている（ADR-050）ことを確認。`spec/platform/index.md` の Queue 構成は `events-public-projection` を concurrency 4 と定め、根拠として「世代ベクトル条件付き書き込み」を 2 か所で明記している。索引に無い旧トークンへの `'delete'` は contentless FTS では復旧経路が無い（ADR 017 が `'rebuild'` を封じている）。memory は単一スレッドで read-compare-write が原子になるため共有スイートでは原理的に観測できない。契約側は動かさずバックエンド固有で閉じる。**同一 UoW 内で同じ note へ 2 回書く場合も 1 文目の適用後に guard が走るので行同一性 guard は成立する**（2 回目の `readStored` はオーバーレイ行を返すため `NOT EXISTS` 分岐に落ちない） | 1 |
| `projection/snapshotWriter.ts:bigram の binding サイズ` | bigram のバインド値が 2,000,000 バイト上限に無防備 | fix | `:73-78` が `bigramIndexText(text(row, "text"))` を素で bound value にすること、`bigram.ts:92-95` が CJK 連を空白区切り bigram へ展開することを確認。純日本語で `7n/3n ≒ 2.33` 倍 → 800,000 バイト本文で 1,866,000 バイト（上限の 93%）。NFKC は CJK 互換文字を展開するので超過は起こしうる。同アダプターは `outboxRepository.ts:124-127` の `MAX_SAVE_BINDING_BYTES` で同種の上限を既に認識しており、最大の bound value であるここだけが素通し。`assertBindable` は個数しか見ない | 1 |
| `__tests__/deleteFilesByOwner.test.ts+sql/json.ts:削除済み spec 文の引用` | 本 PR が spec から削除した「3 文の設計目標」を現行 canon として引くコメントが 3 か所（scope W-002 ≡ composition W-001） | fix | `spec/platform/index.md` の「実行予算と分割単位」→「Scope DO」表に 3 文の目標も実測値も無いこと、`deleteFilesByOwner.test.ts:49-55` / `:320-322` / `sql/json.ts:18-19` が存在しない spec 文を引いていることを確認。`:320-322` の「spec が実測値を持っている」は改訂後の spec の主張（ADR 056 決定 3 により予算文書に実測値を置かない）と逆で、かつレビュー指摘への弁明そのもの。測っている数（reads 22 / commitStatements 21）は正しいので直すのは文言だけ。`application/storage/__tests__/deleteFilesByOwner.test.ts:389` の同文言も巻き添えで直す（コメントのみなので AC-7 に抵触しない） | 1 |
| `__tests__/ports/scopeBusiness.ts:旧 scope 検証規約の JSDoc` | ハーネスの JSDoc が本 PR の scope 検証の決着と矛盾 | fix | `:17-21` が「Every port here gets `deps.scope`」「`owner_type` / `owner_id` must match … on both restore and save」と書く一方、`deps.scope` を受け取るのは `noteRepository` だけであること、ADR-024 と `spec/database/index.md`「共通の規約」の改訂で `stored_files` / `storage_quotas` / `llm_usages` が検査対象外になっていることを確認。この束の JSDoc だけが旧規約のまま | 1 |

### 合成・スキーマ・spec/docs

| Key | 指摘 | 判定 | 理由 | 再指摘 |
|---|---|---|---|---|
| `domain/identity/ports/authTokenRepository.ts:findPending の四者不整合` | spec・ポート JSDoc・適合スイート・memory / Cloudflare の観測が四者で割れている（**Blocker**、identity B-003 ≡ composition B-002、AC-8 / ADR 046） | fix | 四者をコードで確認した。(a) ポート JSDoc `:22-29` は今も「per the partial unique index on (`user_id`, `purpose`) over `status = 'pending'`」と、**自分が指す spec 節が「置くな」と言っている索引**を根拠に不変条件を主張している。(b) `spec/database/index.md:331` は本 PR で「DB 制約としては置かない」へ改訂されたが、同じ行で `ORDER BY created_at DESC, id DESC` を**canon として要求**してしまった。(c) 適合スイート ADP-identity-024 は同じ組の pending を 2 件 insert する（順序は観測しない）。(d) CF は最新を返し、memory は `values().find` で挿入順の先頭を返す。**正本はポート JSDoc に置く**：JSDoc から部分 UNIQUE への言及を落とし「同じ組に複数 pending が在りうる／最大 1 件は `deleteByUserAndPurpose` を撃つ呼び出し側の責務／複数在るときにどれが返るかは契約として未定義」と書く。`spec/database/index.md:331` の `ORDER BY` は「D1 実装の選択（ADR-039）」と読める書き方へ落とす。**memory も適合スイートも変更しない**ので AC-7 / AC-8 の両方を満たす。順序の契約化は別 Issue（下記「付随決定」） | 1 |
| `domain/note/ports/publicNoteQueryService.ts:署名 cursor の撤回が canon 未反映` | cursor の「署名付き」契約を JSDoc だけで撤回し、`spec/` 側が旧い約束のまま（**Blocker**、composition B-001 ≡ scope W-004、AC-9） | fix | ポート JSDoc が既に "not authenticated" へ書き換わっていること、`grep 署名 spec/` で `spec/database/index.md:115,978`、`spec/adr/021:41`、`spec/inventory/adapter.md:96,211,232,233`、`spec/domains/note.md` が旧記述のまま残ることを確認。ADR-048 の判断は `.thread/11/adr.md` にしか無く、Round 001 の「`spec/adr/` へ昇格」は参照削除だけで実行され昇格は行われていない（`ls spec/adr` は 062 止まり）ため、**この決定はどこにも canon として着地していない**。ADR 026 決定 1（ポート定義だけを読んで到達できること）に正面から反する。`spec/database/index.md` / `spec/platform/index.md` は本 PR の改訂対象で手の届く範囲にあった。`spec/domains/identity.md:416`（`UserBatchReader` の routing generation）と `spec/inventory/adapter.md:96`（`UserWorkspaceDirectory`）は cursor 族が別でポートも未実装なので本件の範囲に含めない | 1 |
| `d1/migrations/0001:distributed_operations の spec 差分` | `request_key NOT NULL` / `terminal_at` が spec の列表に無く、未駆動の 3 列も説明が無い（AC-9） | fix | `0001:224,231,227-228` と `spec/database/index.md` の列表を突き合わせて確認。(1) spec は `request_key` を「accountDeletion の userRequest では NOT NULL」とするが実装は全 kind で NOT NULL — SQLite が NULL を互いに相異なるものとして扱う以上 `UNIQUE(kind, partition_key, request_key)` は NULL を許すと再送の重複排除が効かないので**実装側が正しい**。(2) `terminal_at` は `countTerminalSince` / `deleteTerminal` が鍵にする現役の列なのに列表に無い。同じ PR が `user_version` / `kind` は反映済みで非対称。(3) `attempts` / `next_attempt_at` / `expires_at` は宣言だけで一度も読まれない | 1 |
| `d1/migrations/0001:spec に無い索引 3 本` | `sessions_user_token_idx` が `token_hash UNIQUE` と重複し、`auth_tokens` と判断が割れている（AC-9） | fix | `sessions.token_hash` が `UNIQUE`（`:88`）であること、`sessions_user_token_idx`（`:96`）が `(user_id, token_hash)` であることを確認。UNIQUE 1 本で 1 行に絞れるので選択度は上がらず、session 作成のたびに index write が 1 本増えるだけ。`auth_tokens` は同型のクエリを token_hash の UNIQUE だけで引いており 2 表で判断が割れている。`identity_removal_receipts` の 2 本（`:82-83`）は妥当な索引だが spec の当該段落が索引を 1 本も挙げていない | 1 |
| `vitest.shared.ts+vitest.workers.config.ts:拡張子パターンの非対称` | node は拡張子不問で exclude、workers は `.ts` のみ include のため「和集合が全体」が config として未保証 | fix | `vitest.config.ts` の node exclude が `${CLOUDFLARE_ADAPTER_DIR_FROM_ROOT}/**`、workers の include が `${CLOUDFLARE_ADAPTER_DIR}/**/*.{test,spec}.ts` であることを確認。vitest 既定 include は `**/*.{test,spec}.?(c|m)[jt]s?(x)` なので `.test.tsx` / `.test.mts` はどちらにも属さない。`vitest.shared.ts` の JSDoc と `docs/test.md` が明示的に排除したと謳う失敗そのもの。拡張子パターンも `vitest.shared.ts` に 1 か所で持たせれば「境界は 1 つの文字列」という主張が初めて成り立つ | 1 |
| `README.md:cloudflare アダプターとテストコマンド` | adapters 台帳に `cloudflare/` が無く、`test:node` / `test:workers` も未掲載 | fix | `:30` の台帳が `memory, node, oauth, conformance` のまま、`:98-99` が `pnpm test` / `pnpm test:unit` のみ、`:54` が Cloudflare 版を将来形で書いていることを確認。`docs/test.md` は丁寧に改訂されているだけに入口だけが古い。CLAUDE.md「Reference runtime」節は配備が未了である以上そのままで正しい | 1 |
| `spec/inventory/adapter.md:5 ポートの ADP 行が 0 件` | `ScopeTaskScheduler` / `ScopeTaskQueue` / `OutboxRepository` / `DistributedOperationStore` / `AppliedOperationStore` の行が無い | defer | `grep -c` で 0 件を確認。ADR 052 の「新しいバックエンドの実装者は実装すべきメソッドの全数を台帳から数えられる」が成り立っていないのは事実だが、**台帳生成時点からの既存の穴で本 PR の作り込みではなく**、埋めるには 5 ポート ≒ 25 行を全バックエンド共通の採番規則で起こす必要がある（memory 側の ADP 行との整合も要る）。plan.md のスコープ（今日ポートがある 30 スイートの CF 実装）を越える。別 Issue を起票し `.thread/11/progress.md` の当該行からリンクする | 1 |
| `__tests__/runtimeComposition.test.ts:テスト名の過大主張` | 「carrying every port the type declares」は網羅性を保証していない | fix | `REQUEST_PORTS` / `WORKER_PORTS` が `as const satisfies readonly (keyof RequestContainer)[]` であることを確認。これは「列挙した名前が型のキーであること」しか保証せず、ポートが増えてもリストを更新しない限り緑のまま。`Exclude<keyof RequestContainer, (typeof REQUEST_PORTS)[number]> extends never` の型アサーション 1 行で網羅性を型に載せられる | 1 |

### 付随決定

| Key | 判定 | 理由 |
|---|---|---|
| `authTokenRepository:「最新の発行を返す」の契約化（適合スイート + memory）` | wont-fix（この PR では契約化しない）＋ 別 Issue 起票 | `.thread/11/adr.md` ADR-039 が既に「memory は挿入順の `find` なので複数 pending 時の観測は D1 と揃わないが、契約としては未定義の領域にある。memory を触らずに済む側（AC-7）を採った」と決着させ、契約化を別 Issue と明記している。契約にするには適合スイートへのケース追加と memory の振る舞い変更が同時に要り、AC-7 と「適合スイート本体は変更しない」の両方に抵触する。上の fix（JSDoc を「未定義」へ、spec を「D1 実装の選択」へ）で四者不整合そのものは閉じる |
| `spec/adr/021-scope-sharded-data-plane.md:41 の「署名cursor」の扱い` | 要確認 | 在force の ADR 本文を書き換えるのは、`spec/adr/` が「現在有効な決定の記録」である以上ありうる選択だが、通常は新しい ADR で上書きする。(a) `spec/adr/021:41` の当該語を直接直す、(b) ADR-048 を `spec/adr/063` として昇格し 021 の当該行から参照を張る、のどちらを取るかはメインが決める。**(b) を推す** — Round 001 の束 7 が意図した「`.thread/11/adr.md` の判断を canon へ昇格する」がまだ実行されておらず（`spec/adr/` は 062 止まり）、B-C01 が指す「決定がどこにも着地していない」問題ごと閉じられるため |

### fix の観点別内訳

- UoW / 実行機構・SQL 土台: 8
- Identity / directory / operation: 5
- Routing / outbox / scope インフラ: 6
- Scope business / 投影・全文検索 / R2: 4
- 合成・スキーマ・spec/docs: 7

合計 30（defer 1 を除く）

## 修正の実行計画（Round 002）

束 1〜6 は担当ファイルが重ならないので並列委譲できる。束 7 は 1〜6 の完了後に直列で走らせる（`.thread/11/adr.md` と spec の追記が全束の結論を材料にするため）。**各束は自分が決めた判断を作業メモに残し、`.thread/11/adr.md` への追記は束 7 がまとめて行う**（Round 001 と同じ規律）。

### 束 1: scope object と alarm turn の後始末

- 含む指摘: `review-002-uow.md` の B-001, W-001 ／ `review-002-routing.md` の W-001（B-001 と同一）, W-002, W-003, W-004
- 触るファイル:
  - `packages/core/src/adapters/cloudflare/do/scopeObject.ts`
  - `packages/core/src/adapters/cloudflare/do/alarm.ts`
  - `packages/core/src/adapters/cloudflare/__tests__/durability.test.ts`
  - `packages/core/src/adapters/cloudflare/__tests__/alarm.test.ts`
  - `packages/core/src/adapters/cloudflare/__tests__/lease.test.ts`
- 修正方針:
  - `applyWriteSet` の post-commit ブロックは `rescheduleAlarm` と `publishDueIndex` を**それぞれ独立に** try/catch し、失敗は `Logger` へ落として RPC は成功で返す（`scopeTaskScheduler.write:113-121` と同じ方針へ揃える）。`alarm()` は `runScopeAlarmTurn` を `try / finally` に入れ、`finally` で 2 つの後始末を必ず通す。commit 済み write-set の publish が落ちた turn で `run` が解決することを `durability.test.ts` に 1 ケース（`publishDueIndex` を注入可能にするのが素直）。
  - alarm の予算判定は `index > 0` と AND して「claim したのに 0 件処理」で再武装するループを構造的に消す。
  - 既存行の再武装は `ScopeObject` の constructor（`blockConcurrencyWhile` 内）で 1 度 `rescheduleAlarm` を通して閉じる。レジストリが空なら `deleteAlarm` になるので既定配備は無害。runner を止める手当ての記述は束 7 へ渡す。
  - `lease.test.ts` の競合ケースを `scopeUnitOfWorkProvider.run` 越しにも 1 本足す（実配備が通る staged 経路の観測）。

### 束 2: SQL 土台（session / executor / nesting / 翻訳 / prune）

- 含む指摘: `review-002-uow.md` の W-002, W-003, W-005, W-006, W-007 ／ `review-002-routing.md` の W-005
- 触るファイル:
  - `packages/core/src/adapters/cloudflare/sql/session.ts`
  - `packages/core/src/adapters/cloudflare/sql/executor.ts`
  - `packages/core/src/adapters/cloudflare/sql/statement.ts`
  - `packages/core/src/adapters/cloudflare/execution/nesting.ts`
  - `packages/core/src/adapters/cloudflare/execution/globalUnitOfWork.ts`
  - `packages/core/src/adapters/cloudflare/execution/scopeUnitOfWork.ts`
  - `packages/core/src/adapters/cloudflare/do/schema.ts`
  - `packages/core/src/adapters/cloudflare/d1/repositories/userBatchReader.ts`
  - `packages/core/src/adapters/cloudflare/d1/repositories/outboxRepository.ts`
  - `packages/core/src/adapters/cloudflare/__tests__/unitOfWork.test.ts`
  - `packages/core/src/adapters/cloudflare/__tests__/sessionOverlay.test.ts`
- 修正方針:
  - `readRows` のガードを「`stored` のうち結果へ残らなかった行が 1 件でもあるか」へ広げ、メッセージも "deleted" ではなく "dropped" に寄せる。
  - kick を `runInUnitOfWork` の外へ出す（`runInUnitOfWork` が値と「kick すべきか」を返し、`run` の本体が解決後に kick する）。少なくとも `nesting.ts` の JSDoc に「`fn` の中で始めた非同期処理はこの文脈を継承する」を明記。
  - `MAX_STATEMENTS_PER_COMMIT` の検査は `createD1Executor.apply` の入口へ下ろす（`assertBindable` と同じ位置で UoW / autocommit の両方が通る）。下ろさない場合は ADR-036 の Decision に「autocommit の 1 write は検査対象外で、安全性は呼び出し側の `limit` に依存する」と明記して束 7 へ渡す。
  - `pruneProcessed` は `SqlExecutor` に「書いて件数を返す」1 本を足して `meta.changes` から件数を取る。文数は 1 のまま。

### 束 3: D1 control-plane store の原子性

- 含む指摘: `review-002-identity.md` の B-001, B-002, W-001, W-004, W-005 ／ `review-002-uow.md` の W-004
- 触るファイル:
  - `packages/core/src/adapters/cloudflare/d1/repositories/accountDeletionManifestStore.ts`
  - `packages/core/src/adapters/cloudflare/d1/repositories/identityUniqueDirectory.ts`
  - `packages/core/src/adapters/cloudflare/d1/repositories/globalMaintenanceRunStore.ts`
  - `packages/core/src/adapters/cloudflare/d1/repositories/identitySupport.ts`
  - `packages/core/src/adapters/cloudflare/sql/row.ts`（`compositeKey` の分解関数を置く場合のみ）
  - `packages/core/src/adapters/cloudflare/__tests__/globalConcurrency.test.ts`
- 修正方針:
  - `acknowledgeReceipt` は `CASE WHEN EXISTS (SELECT 1 FROM json_each(receipts) WHERE value = ?1) THEN receipts ELSE json_insert(receipts, '$[#]', ?1) END` の 1 文にして原子性を取り戻す。早期 return は round trip 節約として残してよいが、正しさをそこに依存させない。
  - `activate` は他の 3 メソッドと同じ形へ揃える — UPDATE に `AND operation_id = ?` を足し、guard を「予約行の同一性 + User の版」の 1 文にする。guard 敗北時の翻訳は読み経路が返す答え（`UNIQUE_RESERVATION_NOT_FOUND` / `OPTIMISTIC_LOCK_FAILURE`）へ倒す。
  - `writeHeader` に「読んだ `status` と一致すること」の guard を前置し、外れたら既存の `stateViolation` へ翻訳する。
  - `beginOrResumeKind` の新規作成分岐の敗北は `readRunningRun(input.kind)` を撃ち直して実在する run を返す（見つからなければ完了直後なので今の値でよい）。
  - 生 NUL バイト 2 箇所は `compositeKey(...)` かエスケープ表記へ置き換える（`sql/row.ts` の JSDoc が「エスケープ表記なら call site が grep できる」と名指しで求めている形）。
  - `globalConcurrency.test.ts` に 2 ケース追加 — 「別々の receipt を `interposeOnce` で交差させると両方残る」「lapsed 予約が別 operation に奪われたあとの `activate` は着地しない」。

### 束 4: 投影・全文検索の条件付き書き込み

- 含む指摘: `review-002-scope.md` の B-001, W-001, W-003
- 触るファイル:
  - `packages/core/src/adapters/cloudflare/projection/snapshotWriter.ts`
  - `packages/core/src/adapters/cloudflare/search/bigram.ts`
  - `packages/core/src/adapters/cloudflare/__tests__/ports/scopeBusiness.ts`
  - `packages/core/src/adapters/cloudflare/__tests__/searchEdges.test.ts`（または新規 `projectionConcurrency.test.ts`）
- 修正方針:
  - `replace` / `remove` の mutation 先頭に、読んだ行像に対する `occGuard` を積む（`stored === null` は `NOT EXISTS`、`stored !== null` は `projection_revision` / `author_version` / `workspace_version`（public は `route_version` も）の一致）。負けた側は `OPTIMISTIC_LOCK_FAILURE` になり、at-least-once の再配送が読み直して `stale` に落ちる（`redactAuthor` と同じ収束の形、ADR-050）。契約側（ポート JSDoc / 適合スイート）は動かさない。
  - 同一 note へ 2 本の `replaceSnapshotIfNewer` を並走させ、(i) 新しい方が残る (ii) `INSERT INTO <fts>(<fts>) VALUES('integrity-check')` が通る を実バインディングで観測するテストを 1 本。
  - bigram のバインド値はバイト長を測り、上限に触れるなら本文だけ前方 N 文字で打ち切る（ハイライトの 4,000 文字打ち切りと同型。「既知の限界」への 1 行追記は束 7 へ渡す）。最低でも `outboxRepository` と同じ名前付き `SystemError` にする。800,000 バイトの CJK 本文 1 件を投影して通ることを固定するテストを 1 本。
  - `ports/scopeBusiness.ts` の JSDoc を「scope 鍵を持つのは `notes` だけ。他は会計上の帰属列で検査しない。物理分離は `_scope_identity` の pin が担保する」へ書き換える。

### 束 5: `claimDue` のエラー契約とランナーの耐性

- 含む指摘: `review-002-routing.md` の B-001
- 触るファイル:
  - `packages/core/src/application/ports/scopeTaskScheduler.ts`
  - `packages/core/src/application/workers/scopeTaskRunner.ts`
  - `packages/core/src/application/workers/__tests__/`（既存の runner テストへ 1 ケース）
- 修正方針:
  - ポートのエラー契約行へ `ConflictError("OPTIMISTIC_LOCK_FAILURE")` を足し、「候補読みと適用のあいだに別 writer が同じ行を取ったとき。バッチ全体が 0 件になり、次ラウンドで取り直す」と条件まで書く。契約を**弱める**変更ではないので memory も適合スイートも変更不要。
  - `runDueScopeTasks` の `scopeUnitOfWorkProvider.run(...)` 呼び出しを per-scope の try/catch で囲み、競合した scope だけ skip して round を続ける。**catch は `ConflictError` に限定し、それ以外は再送出する** — こうすれば memory バックエンドの観測は 1 ビットも変わらず AC-7 の線を越えない（memory の `claimDue` はこの経路で決して投げない）。
  - staged 経路では guard が commit 時に発火して `the scope unit of work` として翻訳される点を、ポート JSDoc かランナーのコメントのどちらかに 1 文残す（アダプター内で握り潰せない理由）。

### 束 6: テスト構成・ハーネス・README・コメント

- 含む指摘: `review-002-scope.md` の W-002 ／ `review-002-composition.md` の W-001（同一）, W-002, W-003, W-005
- 触るファイル:
  - `packages/core/src/adapters/cloudflare/__tests__/deleteFilesByOwner.test.ts`
  - `packages/core/src/adapters/cloudflare/__tests__/runtimeComposition.test.ts`
  - `packages/core/src/adapters/cloudflare/sql/json.ts`
  - `packages/core/src/application/storage/__tests__/deleteFilesByOwner.test.ts`（コメント 1 文のみ）
  - `vitest.shared.ts`
  - `packages/core/vitest.workers.config.ts`
  - `README.md`
- 修正方針:
  - 「3 文」への言及 3 か所を改訂後の spec の文（「書き込みは件数によらず 1 回の原子適用」「読み側と 1 turn の文数は件数に比例する」）へ直し、`:320` の it は「今の実測値をここで固定する」だけを述べる。`before it was memoised` は「識別 pin は構築時に 1 度読んで保持する」だけを残す。
  - 拡張子パターンを `vitest.shared.ts` に 1 か所で持たせ（`TEST_FILE_GLOB`）、workers の include をそれで組み立てる。
  - `runtimeComposition.test.ts` は `Exclude<keyof RequestContainer, (typeof REQUEST_PORTS)[number]> extends never` の型アサーションを足して網羅性を型で固定する（テスト名を落とすより強い）。

### 束 7: canon の追随（spec / ポート JSDoc / ADR 昇格）— 束 1〜6 の後に直列

- 含む指摘: `review-002-identity.md` の B-003, W-002, W-003 ／ `review-002-composition.md` の B-001, B-002 ／ `review-002-routing.md` の B-002 ／ `review-002-scope.md` の W-004（composition B-001 と同一）
- 触るファイル:
  - `packages/core/src/domain/identity/ports/authTokenRepository.ts`
  - `packages/core/src/domain/note/ports/noteRouteFanOutReader.ts`（cursor の 1 文を追加）
  - `packages/core/src/adapters/cloudflare/d1/migrations/0001_global_schema.sql`（`sessions_user_token_idx` の削除）
  - `spec/database/index.md`
  - `spec/domains/note.md`
  - `spec/platform/index.md`
  - `spec/inventory/adapter.md`
  - `spec/adr/063-…`（新規。ADR-048 の昇格。要確認の結論次第で対象を広げる）／ `spec/adr/index.md`
  - `.thread/11/adr.md`（束 1〜6 の判断の追記、ADR-020 / 036 / 037 / 039 / 045 / 046 の書きぶりの訂正）
- 修正方針:
  - **`authTokenRepository` の四者不整合**: 正本をポート JSDoc に置く。JSDoc から「per the partial unique index …」を落とし、「同じ組に複数 pending が在りうる／最大 1 件は `deleteByUserAndPurpose` を撃つ呼び出し側の責務／複数在るときの戻り値は契約として未定義」と書く。`spec/database/index.md:331` の `ORDER BY` 指定は「D1 実装の選択」と読める形へ落とす。memory も適合スイートも触らない。順序の契約化は別 Issue。
  - **署名 cursor**: `spec/domains/note.md` の 3 か所、`spec/database/index.md:115,978`、`spec/platform/index.md:86,88,90`、`spec/inventory/adapter.md:211,232,233` を「opaque cursor（query fingerprint と shard generation を運ぶ。認証はしない）」へ改める。`spec/adr/021:41` の扱いは「付随決定」の要確認の結論に従う（推奨は ADR-048 を `spec/adr/063` へ昇格して 021 から参照）。`spec/domains/identity.md:416` と `spec/inventory/adapter.md:96` は cursor 族が別で対応ポートも未実装のため本 Issue の範囲に含めない。
  - **`note_routes`**: 列表に `migration_id`（`state = 'moving'` のとき NOT NULL）と `last_migration_id`（直近に完了した switch の識別子／応答喪失後の再試行判定）を足し、本文に「`switchMove` の再試行は `state='active' かつ route_version = expected+1 かつ last_migration_id = migrationId` で冪等に判定する」を 1 文加える。5 本の相関 CHECK も本文へ落とす。
  - **`distributed_operations`**: `request_key` を NOT NULL に改め kind ごとに閉じた一意性との関係を 1 行で説明、`terminal_at` を列として立てる。未駆動の 3 列は列表の備考に「recovery Cron / manifest pruner を足すスライスが使う」と書く。
  - **索引**: `sessions_user_token_idx` は落とす（`auth_tokens` と判断をそろえる）。`identity_removal_receipts` の 2 本は spec の当該段落へ索引行を足す。
  - 束 4 が閉じられなかった bigram の打ち切りは `spec/database/index.md`「既知の限界」へ 1 行。
  - 束 1 の「レジストリ有りの配備へ切り替えるとき runner を止める手当てが要る」を ADR-045 の Consequences へ。束 1 の staged 経路の観測を受けて ADR-020 の Context（「中央 runner は UoW を開かない経路もある」）を現状へ訂正する。

### 要確認の決定（メイン・Round 002）

| Key | 決定 | 理由 |
|---|---|---|
| `spec/adr/021:署名cursorの撤回をどう canon へ着地させるか` | **ADR-048 を `spec/adr/063` へ昇格し、ADR 021 の該当記述はその参照で上書きする** | 在force の ADR 本文を直接書き換えると「なぜ変えたか」が消える。昇格すれば `spec/adr/index.md` の前提依存マップにも載り、composition B-001 が指す「決定が canon に着地していない」問題ごと閉じられる |

## defer で起票した Issue（Round 002）

| Key | 判定 | 起票 Issue |
|---|---|---|
| `spec/inventory/adapter.md:ADP 行欠落 5 ポート` | defer（既存の穴で本 Issue が作ったものではない） | #52 |
| `authTokenRepository:findPendingByUserAndPurpose の順序契約` | wont-fix（正本をポート JSDoc に置き「未定義」と明記して解消）＋ 起票 | #53 |
