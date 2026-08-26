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

## Round 003

レビュー 5 本の指摘（Blocker 2 / Warning 19 = 21 件）を重複統合したもの。総数 **20 件**（fix 18 / wont-fix 1 / defer 1 / 要確認 0）。
Blocker は重複統合後 **2 件**（`B-U01`≡`W-R01` を 1 件へ束ねた）。

Round 001 / 002 の台帳と Key を突き合わせた結果、**既出（wont-fix / defer 済み）の再指摘は 0 件**。`review-003-uow.md` は `conformance/scopeTaskScheduler.ts:並行claimケース`（#48）を明示的に「蒸し返さない」と断っており、`readForUpdate 事前読み` / `findPending の順序` / `publicNoteProjection の非public行` / `spec/inventory の ADP 行` / `DEFAULT_MAINTENANCE_TABLES` はいずれも再指摘されていない。

判定の付随決定を 3 件（B-U01 の倒し方 / W-C02 の扱い / W-S04 の扱い）、末尾の「付随決定」表に置く。

### UoW / 実行機構・SQL 土台

| Key | 指摘 | 判定 | 理由 | 再指摘 |
|---|---|---|---|---|
| `do/scopeObject.ts:armAndPublish/publish 失敗の欠落方向に自己修復経路が無い` | 既定配備（ハンドラレジストリ空）では publish 失敗で索引に載らなかった行が永久に中央 runner から見えない（**Blocker**、uow B-001 ≡ routing W-001） | fix | コードで成立を確認した。`alarm.ts:257` の `rescheduleAlarm` は `scopeAlarmDrivesTasks()`（`handlers.size > 0`）が偽なら常に `deleteAlarm()` で、`registerScopeTaskHandler` の呼び出しは production コードに 0 件。したがって `scopeObject.ts:150-156` の `armAndPublish` は既定配備では「alarm を消してから publish する」形になり、publish が落ちると (a) 索引に行が無い (b) object は武装されない (c) `scopeTaskQueue.listDue` は索引しか読まない、の 3 つが同時に成り立って回復経路が消える。`dueIndex.ts:24-27` の「absorbed by the central runner … a stale row costs at most one failed claim」は**余分な行**の方向しか覆っておらず、`spec/database/index.md:1089` の「Alarm が治す」は ADR-045 が既定配備でその Alarm を消したことで成り立たない。plan.md「リスクと注意点」最終行の最悪ケース（personal cleanup の継続が止まり `accountDeletionBarrier` が開いたまま User が `deleting` で残る）にそのまま乗る。**倒し方は下記「付随決定」の (a)** — publish が落ちたときだけレジストリの有無に関わらず再試行用 alarm を張る | 1 |
| `sql/session.ts:readRows/compare がページ外へ動かす更新` | LIMIT ガードが「述語から外れた／消えた」しか見ず、`compare` の並べ替えでページ外へ出た行を取りこぼす | fix | `session.ts:147-165` の `dropsAStoredRow()` が `staged[i] === null`（削除）と `!spec.matches(row)`（述語外）の 2 つだけを見ることを確認。`matches` を満たしたまま `compare` の順序上ページ外へ動く更新はガードを素通りし、storage 側の n+1 番目の行を欠いた**中身の違うページ**が返る。`RowsRead` の JSDoc は落ち方を "deleted, or updated out of the predicate" と数え上げているので、契約上は「安全」と読める。現行の呼び出し 6 か所が到達しないことはレビュアーが確認済みだが、ガードを広げるのは同一ファイル完結で 2 行。ADR-064 が決めた「結果から落ちた stored 行で判定する」の趣旨をそのまま拡張する形で、決定の蒸し返しではない | 1 |
| `__tests__/sessionOverlay.test.ts:112 の修正経緯コメント` | 「以前のガードはこれを通していた」という過去形の説明が残る | fix | round 002 時点のガード（`staged.includes(null)`）を指した記述で、現在のコードに存在しない状態を説明している。CLAUDE.md「Default to no comments」と ADR-052 の向きの双方に合わない。現在形の理由へ書き換えるだけ | 1 |

### Identity / directory / operation

| Key | 指摘 | 判定 | 理由 | 再指摘 |
|---|---|---|---|---|
| `spec/usecases/identity.md+domains/index.md+testcases/deleteAccount.md:manifest header の状態語彙` | header の status が canon 内で自己矛盾（`preparing` / `committing` / `compactingRejected` が残存）（**Blocker**、AC-9） | fix | 4 ファイルを突き合わせて確認した。`spec/database/index.md:172` は本 PR で `CHECK IN ('building','built','rollingBack','completed','rejected')` の 5 値へ改訂済みで、実装（`application/ports/accountDeletionManifestStore.ts` と `begin` が入れる `'building'`）とも一致する。一方 `spec/usecases/identity.md:809/815/821/827`、`spec/domains/index.md:147`、`spec/testcases/identity/deleteAccount.md:26` は `preparing` / `committing` / `compactingRejected` を header の実在する state として断定している。**加えて `spec/database/index.md:160`（`distributed_operations` 節）自身も「`preparing` / `committing` などは …`account_deletion_manifests.state` が持つ」と書いており、同じ文書の中で列名（`status`）と語彙の両方が食い違う** — 指摘の範囲より 1 か所広い。ADR-055 の Consequences は「usecases 側の追随が別途要る（本 Issue では確認していない）」であって反映しない理由ではないので、AC-9 では救えない | 1 |
| `d1/repositories/identityUniqueDirectory.ts:beginRelease の guard 敗北翻訳` | ポート JSDoc が「一致しない行は no-op」と契約している経路で `OPTIMISTIC_LOCK_FAILURE` を投げる | fix | ポート JSDoc（`domain/identity/ports/identityUniqueDirectory.ts:102-107`）が「An absent row, a `reserved` row, a `releasing` row, another user's row, and a token that no longer matches are all no-ops」と列挙で契約していること、実装（`identityUniqueDirectory.ts:380-417`）が読み経路では正しく早期 return する一方、読みと適用のあいだに相手が着地すると `throwTranslated` へ落ちることを確認。相手が先なら**静かに成功**する呼び出しが、後なら失敗する。ADR-057 が本ラウンドで掲げた「guard 敗北時の翻訳は読み経路の答えへ倒す」を `activate` にだけ適用した非対称そのもので、決定の蒸し返しではなく適用漏れ。呼び出し側 `identityRemovalRelease` は outbox consumer で、負け続ければ quarantine に届く | 1 |
| `d1/repositories/identityUniqueDirectory.ts:activateLoss の同一 operation リプレイ` | 同じ operation の並行リプレイに負けた場合も `OPTIMISTIC_LOCK_FAILURE` になる | fix | `identityUniqueDirectory.ts:145-158` の `activateLoss` が `readByOperation(operationId).length === 0` の 2 分岐しか持たないことを確認。guard は `state <> 'active'` を含むので同じ operationId・同じ `expectedUserVersion` のリプレイが先に着地しただけで外れるが、読み経路の答えは「`state !== 'active'` の予約が 0 件 → mutation 0 件 → 成功」である。ポート JSDoc は「A caller that loses the `activate` / `release` response reconciles by re-issuing the same operation's call — both must be idempotent for the same `operationId`」と冪等性を契約しており、継続配送は at-least-once なので二重配送は実在する経路。関数自身の JSDoc（「読み経路が返したはずの答え」）とも食い違う | 1 |
| `d1/repositories/distributedOperationStore.ts:beginOrResume の unique 違反` | 同一 request key のリプレイが `resumed: true` を受け取れず `ALREADY_RUNNING` に倒れる | fix | `distributedOperationStore.ts:177-186` が `occGuard` / `unique` を一律 `DISTRIBUTED_OPERATION_ALREADY_RUNNING` へ倒すことを確認。表は `UNIQUE(kind, partition_key, request_key)` と `UNIQUE(kind, partition_key) WHERE state NOT IN (...)` の 2 本を持ち、`spec/database/index.md:160` が前者を「同じ送信の再生を担う」と定めている。直列実行なら `siblings.find(row => row.requestKey === ...)` が当たって `resumed: true` を返す分岐があるので、敗者だけ答えが違う。ADR-040 が `reserve` について決めた「どの索引が外れたかで翻訳を分ける」の適用漏れ。ADR-057 の「敗北時は読み経路を撃ち直す」でも同じ結論になる | 1 |
| `d1/repositories/sessionRepository.ts:55-59 の索引名指し` | 削除済みの `(user_id, token_hash)` 索引を実在するものとして JSDoc が名指す | fix | `0001_global_schema.sql` の `sessions` が持つ索引は `token_hash` の UNIQUE・`sessions_user_epoch_idx`・`sessions_expires_idx` の 3 本だけで、複合索引は本 PR（ADR-069）が落としたことを確認。走査路は等価なので実害は無いが、この JSDoc を根拠に索引を足し直す改修を招く。1 文の書き換え | 1 |
| `d1/repositories/accountDeletionManifestStore.ts:writeHeader guard の観測` | ADR-057 で足した状態 guard に実行されるテストが 1 本も無い | fix | `grep -rn "markBuilt\|markCompleted\|beginRollback" adapters/cloudflare/__tests__/` が 0 件であることを確認。`globalConcurrency.test.ts` が固定しているのは `reserve` / `activate` / `acknowledgeReceipt` / `beginOrResume` / maintenance lease の 5 系統のみ。共有適合スイートは memory が UoW を直列化するのでこの分岐に構造的に到達できず、ADR-057 の「観測は `globalConcurrency.test.ts` の実バインディングに置いた」が 3 変更のうち 1 つについて成立していない。`interposeOnce` の既存の形をそのまま使える | 1 |

### Routing / outbox / scope インフラ

| Key | 指摘 | 判定 | 理由 | 再指摘 |
|---|---|---|---|---|
| `application/workers/scopeTaskRunner.ts:claim catch の広さ` | `isConflictError` で全 `ConflictError` を握り潰し、契約が許した 1 コード以外も無言 skip する | fix | `scopeTaskRunner.ts:169-178` が `code` を見ないこと、本 PR が追記したポート JSDoc（`application/ports/scopeTaskScheduler.ts:153-161`）が許した追加の失敗は `ConflictError("OPTIMISTIC_LOCK_FAILURE")` **1 コードだけ**であることを確認。ADR-056 の Consequences はこの広さを「skip は安全側」としてトレードオフに記録しているが、そこで想定しているのは**一過性の競合**であり、恒常的な別コードが同じ scope を毎ラウンド「claim を競り負けた」と偽って飛ばし続ける形（＝継続の鎖が warn 1 行で無言停止する）は評価されていない。契約行を正本として実装をそこへ寄せる 1 式の変更で、memory も適合スイートも動かない。ADR-056 の Consequences の当該行は書き直す | 1 |
| `d1/repositories/noteRouteFanOutReader.ts:page の順序と索引` | `state <> 'reserved'` + `ORDER BY note_id` が canon 索引 `(created_by, state, note_id)` で順序を取れない | fix | 発行 SQL（`noteRouteFanOutReader.ts:92-99`）と DDL（`0001_global_schema.sql:213-214`）、`spec/database/index.md:121` の索引行を突き合わせて確認。`state` が不等値なので `note_id` 順は索引から出ず、`created_by` 一致ぶんを読んでからのソートになる。keyset の意味（前方の削除で位置がずれない）は残るが 1 page のコストが著者の route 総数に比例し、account deletion の author route 固定は 100 件 page を繰り返すので多作な利用者ほど効く。**対案 (a)（`state IN (...)` の等値集合）は採らない** — SQLite は IN の各値をループするので複数値では結局ソートが入り、順序は索引から出ない。**(b) を採る**: 索引を `(created_by, note_id)` / `(scope_type, scope_id, note_id)` に改め `state` は残余述語にする。migration は未適用の 1 ファイルなので追記の規律は掛からず、spec の索引行（AC-9）を同時に直す | 1 |

### Scope business / 投影・全文検索 / R2

| Key | 指摘 | 判定 | 理由 | 再指摘 |
|---|---|---|---|---|
| `__tests__/searchEdges.test.ts:166-213 の打ち切り観測` | 索引テキストの打ち切りを観測するテストが無く、それを主張するコメントが算術的に誤っている | fix | 当該ケースの唯一の境界アサーションが `<= MAX_BOUND_VALUE_BYTES`（2,000,000）であること、`"記録".repeat(133_333)` の重なりビグラムが 1,866,654 バイトで**打ち切りを外しても 2,000,000 を超えない**ことを算術で確認した。つまりケース名の "without exceeding a bound value" は `MAX_INDEX_TEXT_BYTES` の働きを一切証明しない。一方でこの本文は 1,800,000 の予算は**実際に超える**ので、打ち切り自体は走っている — 観測だけが無い。コメント（167-171 行）の「2.33x — past the 2,000,000-byte cap」も誤りで、上限を越えさせるのは倍率ではなく NFKC 展開（`bigram.ts:86-97` の JSDoc は正しく書いている）。spec「既知の限界」の約束（頭からは引ける・末尾は落ちる）と 1 対 1 に対応する観測へ差し替える | 1 |
| `spec/platform/index.md:### Scope DO の ADR 056 引用` | 「決定 3」を、その決定が述べていない主張の根拠として引き、同 ADR の決定 2 と食い違う | fix | 在force の `spec/adr/056` の決定 2 は「**バックエンド依存の数値は実行基盤の予算文書に置く**（表の直後の段落として、上限ではなく設計目標と明記して）」、決定 3 は「**どのバックエンドがその数に届かないか**は予算文書ではなく本 ADR のコンテキストに残す」であることを原文で確認。`spec/platform/index.md:155` の新しい文「バックエンドごとの実測値と内訳は各アダプターの持ち分で、予算文書には置かない（ADR 056 決定 3）」は決定 3 を一般化して決定 2 を反転させており、その反転はどこにも記録が無い。結果として AC-5 が求めた「当該行を実測値へ改める」が canon 上は未達で、`4n + 3` は `.thread/` とテストコメントにしか無い。決定 2 に従って実測値 1 行を段落へ戻し、引用を決定 2 へ直す | 1 |
| `search/bigram.ts:119-133:非 CJK run が 1 トークン` | 長い非 CJK run が予算を越えるとその列の索引テキストが丸ごと空になる | fix | `bigramIndexText` が `run.cjk ? bigramsOf(run.text) : [run.text]` で**非 CJK run 全体を 1 トークン**として積み、最初の反復で予算を越えると `return tokens.join(" ")` が空文字列を返すことをコードで確認。空白も非 CJK なので「本文中の連続する非 CJK 部分」がまとめて 1 run になる。到達経路も成立する — U+FDFA は 3 バイトだが NFKC で 18 文字（約 33 バイト、約 11 倍）へ展開するので、`PlainTextContent` の上限 800,000 バイトの 2 割程度でも展開後 1 run が 1.8MB を越える。`spec/database/index.md`「既知の限界」の「本文の前方から入るので頭からは引ける」がこの経路だけ成り立たない。非 CJK run を空白で割って積めば `unicode61` が見るトークン列は 1 バイトも変わらず（＝既存索引の取り消し互換性も保たれる）、予算超過時の落ち方だけが「前方から入る」へ戻る | 1 |
| `d1/repositories/publicNoteQueryService.ts:public 検索の並び順` | `note_id` 昇順固定で spec の `updatedAt DESC, noteId` / FTS 順位 RRF と食い違う | defer | 実装（`publicNoteQueryService.ts:137` の `ORDER BY ns.note_id ASC`、`bm25` 不使用）と canon（`spec/domains/note.md:485`）の食い違いを確認した。**本 PR の退行ではない** — memory も同型で、`PublicSearchCriteria` に sort 相当のフィールドが無く現行ポートでは表現できない。倒すにはポート契約の変更＋両バックエンド＋適合スイートが同時に動く必要があり、plan.md「含まれないもの」の「`localNoteQueryService` / `publicNoteQueryService` の relevance 順の契約強化」を越える。canon 側を現状（`noteId` keyset）へ書き換える案は採らない — RRF は物理 shard 化まで生きる設計意図であり、実装が追いつくまでの間 canon を弱めると引き直す根拠が消える。**AC-8 / AC-9 の「倒さないなら理由を残す」として `.thread/11/adr.md` に 1 項を残し、別 Issue を起票する**（#47 / #49 と同じ扱い） | 1 |

### 合成・スキーマ・テストハーネス・spec/docs

| Key | 指摘 | 判定 | 理由 | 再指摘 |
|---|---|---|---|---|
| `spec/adr/021:41 と spec/adr/063:42 の食い違い` | 021 の書き換えが ADR 063 の適用範囲を越え、063 の影響節を同一 PR が反証している | fix | 021:41 が「公開検索、**公開workspace一覧**、Note routeの…cursorでshard別keysetを持ち…公開読みモデルのcursorは認証しない（ADR 063）」となっている一方、`spec/adr/063` の影響節が「workspace directory 側のカーソル（`UserWorkspaceDirectory.listActiveByUser` / `PublicWorkspaceDirectoryReader.listPublished`）は…**それらの記述は今も「署名 cursor」のまま**」と明言していることを原文で確認。`spec/domains/workspace.md` ほかは実際に「署名 cursor」のまま残っており、021 だけが片側へ倒れている。021 の当該文で公開 workspace 一覧を分離し、「認証しない」の主語を ADR 063 が観測したポートに限る（Round 002 の要確認で採った「範囲は観測したポートに限る」＝ ADR-067 と同じ線） | 1 |
| `CLAUDE.md:Adapters / Reference runtime / Development Commands` | README・`docs/test.md` と同じ主張を持つ CLAUDE.md だけが古い | wont-fix | 指摘の事実関係は正しい（README:30 は `cloudflare (D1 / DO / R2)` を含み、README:54 は「adapter group と DI wiring は in place」へ、`package.json` は `test:node` / `test:workers` を持つ）。ただし **`CLAUDE.md` は本フェーズでは書き換えない方針**（coding agent 向けの規範であり、書き換えの可否はユーザーの判断に委ねる）。**提案内容は完了報告に載せてユーザーに委ねる** | 1 |
| `spec/database/index.md:実在しない制約の宣言` | 列表の「制約」列が、表にも migration にも無い制約を宣言している | fix | 2 か所を原文で確認した。(1) `note_routes.migration_id` の制約列は「`state = 'moving'` のとき NOT NULL」だが、3 行下の本文は「`migration_id` / `last_migration_id` はCHECKを持たず、対で状態機械だけが動かす」と書く（migration にも CHECK は無い）。(2) `scope_task_due_index.lease_expires_at` の制約列は「`status = 'running'` の行だけ NOT NULL」だが、**この表に `status` 列は存在しない**（由来表 `scheduled_tasks` の状態を指しており、実装コメントのほうが正しい）。同じ PR が `note_routes` に相関 CHECK 5 本を実装しているため、読み手は制約列を「DB が守るもの」と読む。実効でない項目は「状態機械が守る（DB 制約は置かない）」の書き方へ統一し、`lease_expires_at` は由来表を名指す | 1 |
| `do/schema.ts:249 vs 0001_global_schema.sql:404 の processed 索引` | scope 平面の `outbox_events` にだけ processed 索引が無い | fix | global 側が `outbox_events_pending_idx` と `outbox_events_processed_idx` の 2 本、scope 側（`do/schema.ts:249-250`）が pending の 1 本だけであることを確認。`OutboxRepository` は両平面で同一実装で、`pruneProcessed` は `WHERE processed_at IS NOT NULL AND processed_at < ?` を撃つ。今日は scope 側 outbox が `save` にしか使われていないので実害は無いが、非対称の理由がコードにも canon にも無く、scope outbox の relay / prune を配線する次のスライスが全表走査を踏む。DDL 2 行で対称にするのが最も安い | 1 |
| `adapters/__tests__/conformanceCoverage.test.ts:80 が実引数を見ない` | CF スイートが memory ファクトリーを渡しても緑のまま通り AC-3 が静かに崩れる | fix | 検査が呼び出し**名**の集合比較（`CALL_SITES` 正規表現）と絶対数（30 / 31）だけで、`describe…Contract(BACKEND, X)` の `X` を一切見ないことを確認。`makeMemoryConformanceBackend` と `makeCloudflareConformanceBackend` はどちらも `MakeConformanceBackend` なので型でも止まらず、memory バックエンドは workerd 上でも動くのでテストも緑のまま通る。**今日は 7 ファイルすべてが `makeCloudflareConformanceBackend` を渡しており AC-3 は実際には満たされている**ので、これは「現に壊れている穴」ではなく「テスト名が主張する性質を観測していない」種類の穴。既に textual な検査なので、CF 側の `conformance/*.test.ts` に `makeCloudflareConformanceBackend` 以外の `make…ConformanceBackend` 識別子が現れないことを 1 つ足せば閉じる（memory 側も対称に） | 1 |

### 付随決定

| Key | 判定 | 理由 |
|---|---|---|
| `B-U01:due index の drift をどちらの側で治すか` | **(a) publish 失敗時だけ、レジストリの有無に関わらず再試行用の alarm を張る** | (b)「publish を write-set と同じ原子単位に入れる」は採れない — `spec/database/index.md`「共通の規約」が D1 と scope DO を 1 transaction に含めないことを明示しており、ADR-003 の索引はその前提の上に立っている。(c)「drift を `ScopeTaskQueue.listDue` 側で検出して治す」も採れない — 索引に**無い** scope を検出するには DO の全列挙が要り、`spec/platform/index.md`「Global Cron」が禁じている（そもそもこの表の存在理由）。(a) は既存の機構だけで閉じる: レジストリが空でも `alarm()` は `runScopeAlarmTurn` が `EMPTY_TURN` を返して即 `finally` の `armAndPublish` へ入るので、turn を回さないまま publish だけ再試行できる。ADR-060 が選んだ「arm 先行」の順序も動かさない。実装上の注意は 2 つ — 再試行 alarm は `rescheduleAlarm` の `deleteAlarm` を**後から**上書きする位置に置くこと、レジストリ非空の配備では既に武装済みの時刻を遅らせないよう `getAlarm()` と比較して早い方を採ること。あわせて `dueIndex.ts` の JSDoc・ADR-060 の「互いの保険」・`spec/database/index.md:1089` を「欠落方向は publish 再試行 alarm が、余分方向は中央 runner の失敗 claim 1 回が吸収する」へ書き直す（AC-9）。既定配備（`register` せずに publish を落とす）を観測するテストを 1 本足す |
| `W-C02:CLAUDE.md の追随` | **wont-fix（この PR では変更しない）＋ 提案を完了報告へ** | `CLAUDE.md` は coding agent への規範であり、本フェーズでは書き換えない方針。指摘の事実関係は正しいので、Adapters 節 / Reference runtime 末尾 / Development Commands の 3 か所の具体的な文面を完了報告でユーザーへ提示し、採否を委ねる |
| `W-S04:public 検索の並び順` | **defer（別 Issue 起票）＋ `.thread/11/adr.md` に理由を記録** | spec を現状へ書き換えると RRF という設計意図が canon から消える。実装へ倒すにはポート（`PublicSearchCriteria` に sort が無い）から動かす必要があり plan.md のスコープ外。AC-9 の「反映しない差分は adr.md に理由とともに残す」で本 PR 内は閉じ、契約強化は Issue へ |

### fix の観点別内訳

- UoW / 実行機構・SQL 土台: 3
- Identity / directory / operation: 6
- Routing / outbox / scope インフラ: 2
- Scope business / 投影・全文検索 / R2: 3
- 合成・スキーマ・テストハーネス・spec/docs: 4

合計 18（wont-fix 1 / defer 1 を除く）

## 修正の実行計画（Round 003）

束 1〜5 は担当ファイルが重ならないので並列委譲できる。束 6 は 1〜5 の完了後に直列で走らせる（spec / ADR の追随が束 1・束 5 の結論を材料にするため）。**各束は自分が決めた判断を作業メモに残し、`.thread/11/adr.md` への追記は束 6 がまとめて行う**（Round 001 / 002 と同じ規律）。

### 束 1: due index の欠落方向を治す

- 含む指摘: `review-003-uow.md` の B-001 ／ `review-003-routing.md` の W-001（同一）
- 触るファイル:
  - `packages/core/src/adapters/cloudflare/do/scopeObject.ts`
  - `packages/core/src/adapters/cloudflare/do/dueIndex.ts`（JSDoc）
  - `packages/core/src/adapters/cloudflare/__tests__/alarm.test.ts`
- 修正方針: `armAndPublish` の publish 側 catch で再試行 alarm を張る。`rescheduleAlarm` が先に `deleteAlarm` している（レジストリ空の配備）ことを前提に、publish が落ちたときだけ `getAlarm()` と `now + 再試行間隔` を比べて早い方を `setAlarm` する（レジストリ非空の配備で既に武装済みの turn を遅らせないため）。`alarm()` は既に `finally` で `armAndPublish` を通すので、レジストリが空でも `runScopeAlarmTurn` が `EMPTY_TURN` を返して publish だけが再試行される。`dueIndex.ts` の JSDoc は「drift は Alarm が治す／余分な行は中央 runner が吸収する」を「**欠落方向**は publish 再試行 alarm、**余分方向**は失敗 claim 1 回」へ書き直す。テストは `register` せずに publish を落とし、(i) object が武装されること (ii) alarm を 1 度走らせると索引に行が現れること、の 2 点を実バインディングで固定する。`spec/database/index.md:1089` と ADR-060 の書き直しは束 6 へ渡す

### 束 2: control-plane store の guard 敗北翻訳と観測

- 含む指摘: `review-003-identity.md` の W-001, W-002, W-003, W-004, W-005
- 触るファイル:
  - `packages/core/src/adapters/cloudflare/d1/repositories/identityUniqueDirectory.ts`
  - `packages/core/src/adapters/cloudflare/d1/repositories/distributedOperationStore.ts`
  - `packages/core/src/adapters/cloudflare/d1/repositories/sessionRepository.ts`（JSDoc 1 文）
  - `packages/core/src/adapters/cloudflare/__tests__/globalConcurrency.test.ts`
- 修正方針: ADR-057 の「guard 敗北時は読み経路を撃ち直してその答えへ倒す」を、`activate` 以外の 3 経路へ一様に適用する。`beginRelease` は敗北時に `readOne(kind, normalizedKey)` を撃ち、観測した claim（`active` かつ `expectedUserId` かつ `expectedClaimToken`）が無ければ **return**（契約どおりの no-op）、それ以外は `throwTranslated`。`activateLoss` は 3 分岐にし、`state === 'active'` かつ `user_version === expectedUserVersion` の行が残っていれば成功として扱う。`beginOrResume` は `occGuard` / `unique` を受けたら `inPartition(kind, partitionKey)` を撃ち直し、同じ request key の行があれば `{ operation, resumed: true }`、無ければ現行どおり `ALREADY_RUNNING`。`sessionRepository` の JSDoc は「`token_hash` の UNIQUE で 1 行に絞り、`user_id` は所有者の照合として掛ける」へ。`globalConcurrency.test.ts` に `interposeOnce` のケースを 3 本足す — `writeHeader` の状態 guard（`begin` → `markBuilt` に対抗 `markBuilt` を割り込ませ、敗者が `stateViolation` を受け `status` が二重に進まない）、`beginRelease` の no-op、同一 request key の並行 `beginOrResume`

### 束 3: SQL 土台のガードと runner の catch

- 含む指摘: `review-003-uow.md` の W-001, W-002 ／ `review-003-routing.md` の W-002
- 触るファイル:
  - `packages/core/src/adapters/cloudflare/sql/session.ts`
  - `packages/core/src/adapters/cloudflare/__tests__/sessionOverlay.test.ts`
  - `packages/core/src/application/workers/scopeTaskRunner.ts`
  - `packages/core/src/application/workers/__tests__/scopeTaskRunner.test.ts`
- 修正方針: `readRows` の LIMIT ガードを「`compare` を持つ読みでは、overlay が書き換えた stored 行が 1 件でもあれば拒否する（`matches` を満たしていても）」まで広げ、`RowsRead` の JSDoc の落ち方の列挙に「`compare` の順序を動かす更新」を足す。`sessionOverlay.test.ts:112-114` のコメントは現在形の理由へ書き換え、あわせて並べ替えでページ外へ動くケースを 1 本足す。`scopeTaskRunner` の catch は `isConflictError(cause) && cause.code === "OPTIMISTIC_LOCK_FAILURE"` に絞り、それ以外は再 throw。既存の `withLostClaim` は `OPTIMISTIC_LOCK_FAILURE` を注入しているので、別コードの `ConflictError` が素通ししないケースを 1 本足す。memory の観測は 1 ビットも変わらない（AC-7）。ADR-056 の Consequences の書き直しは束 6 へ渡す

### 束 4: bigram の予算とその観測

- 含む指摘: `review-003-scope.md` の W-001, W-003
- 触るファイル:
  - `packages/core/src/adapters/cloudflare/search/bigram.ts`
  - `packages/core/src/adapters/cloudflare/__tests__/searchEdges.test.ts`
- 修正方針: `bigramIndexText` の非 CJK run を空白で割って 1 語 1 トークンとして積む。`unicode61` が見るトークン列は変わらないので既存索引の取り消し互換性は保たれる（`bigram.ts` 冒頭の「変更すれば全索引を作り直し」に抵触しない）。JSDoc に「予算は前方から詰めるので、超過は末尾のトークンだけを落とす」を 1 文。`searchEdges.test.ts:166-213` は spec「既知の限界」と 1 対 1 に対応する観測へ差し替える — 本文の頭のキーワードは引け、予算を越えた末尾にしかないキーワードは引けず、`replaceSnapshotIfNewer` は `"written"` を返す。境界アサーションは `MAX_BOUND_VALUE_BYTES` ではなく `MAX_INDEX_TEXT_BYTES` に対して置く（前者は打ち切りを外しても通る）。167-171 行のコメントは `bigram.ts` の JSDoc と同じ根拠（NFKC 展開）へ直す

### 束 5: 索引の非対称と適合スイートの実引数

- 含む指摘: `review-003-routing.md` の W-003 ／ `review-003-composition.md` の W-004, W-005
- 触るファイル:
  - `packages/core/src/adapters/cloudflare/d1/migrations/0001_global_schema.sql`
  - `packages/core/src/adapters/cloudflare/do/schema.ts`
  - `packages/core/src/adapters/cloudflare/d1/repositories/noteRouteFanOutReader.ts`（JSDoc のみ）
  - `packages/core/src/adapters/__tests__/conformanceCoverage.test.ts`
- 修正方針: `note_routes` の 2 索引を `(created_by, note_id)` / `(scope_type, scope_id, note_id)` へ改め、`state <> 'reserved'` は残余述語として残す（keyset の順序が索引から出るようにする。migration は未適用の 1 ファイルなので追記の規律は掛からない）。`noteRouteFanOutReader` の JSDoc に「不等値の `state` を索引の前置に置かないのは、`note_id` 順を索引から取るため」を 1 文。`do/schema.ts` に global 側と同じ `outbox_events_processed_idx`（部分索引）を足して両平面を対称にする。`conformanceCoverage.test.ts` は、CF 側 `__tests__/conformance/*.test.ts` に `makeCloudflareConformanceBackend` 以外の `make…ConformanceBackend` 識別子が現れないこと（memory 側も対称に）を 1 ケース足し、テスト名が主張する性質を観測させる。`spec/database/index.md` の索引行の追随は束 6 へ渡す

### 束 6: canon の追随（spec / ADR）— 束 1〜5 の後に直列

- 含む指摘: `review-003-identity.md` の B-001 ／ `review-003-scope.md` の W-002, W-004（記録） ／ `review-003-composition.md` の W-001, W-003 ／ 束 1・束 3・束 5 が渡した canon 側の持ち分
- 触るファイル:
  - `spec/usecases/identity.md`
  - `spec/domains/index.md`
  - `spec/testcases/identity/deleteAccount.md`
  - `spec/database/index.md`
  - `spec/platform/index.md`
  - `spec/adr/021-scope-sharded-data-plane.md`
  - `.thread/11/adr.md`
- 修正方針:
  - **manifest header の 5 値化（B-I01）**: `spec/usecases/identity.md:809` は「manifest header を `building` で開く」、`:821` の「`committing` へ進め」は「author route 固定完了で `markBuilt`（`built`）」、`:815` / `:827` / `deleteAccount.md:26` の `compactingRejected` は「`rollingBack` のまま item を 100 件ずつ縮約する」へ。`spec/domains/index.md:147` の括弧書きは「`preparing` / `committing` という語は使わない。header の status は 5 値」へ。**`spec/database/index.md:160`（`distributed_operations` 節）の「`preparing` / `committing` などは `account_deletion_manifests.state` が持つ」も同時に直す**（列名も `status`）。`:827` / `deleteAccount.md:69` の `expiresAt` は header の列名 `retain_until` に合わせる。`spec/database/index.md` 側へ 9 値を戻す案は ADR 026 / ADR-055 に反するので採らない
  - **AC-5 の実測値（W-S02）**: `spec/platform/index.md:155` の引用を決定 3 から**決定 2** へ直し、同じ段落に実測値を 1 行入れる（「Cloudflare 実装の実測は 1 turn `4n + 3` 文・commit 1 回」）。上限ではなく設計目標であることを明記する（決定 2 の要求）
  - **署名 cursor の範囲（W-C01）**: `spec/adr/021:41` の当該文で公開 workspace 一覧を分離し、「認証しない」の主語を ADR 063 が観測したポート（`PublicNoteQueryService` の 3 メソッドと `NoteRouteFanOutReader` の 2 メソッド）に限る。`spec/adr/063` の影響節は動かさない（両者が同じことを言えばよい）
  - **列表の制約（W-C03）**: `note_routes.migration_id` / `last_migration_id` と `distributed_operations` / `account_deletion_manifests` の terminal 系は「状態機械が守る（DB 制約は置かない）」へ統一。`scope_task_due_index.lease_expires_at` は「`scheduled_tasks.status = 'running'` の行だけ NOT NULL」と由来表を名指す
  - **索引行（束 5 の持ち分）**: `spec/database/index.md:121` の `note_routes` indexes 行を `(created_by, note_id)` / `(scope_type, scope_id, note_id)` へ改め、`state` を残余述語にした理由を 1 文。`outbox_events` / `processed_events` の両平面共通の節を足し、processed 索引を両平面に置くことを書く
  - **drift（束 1 の持ち分）**: `spec/database/index.md:1089` を「欠落方向は publish 再試行 alarm が、余分方向は中央 runner の失敗 claim 1 回が吸収する」へ。ADR-060 の「互いの保険」も同じ形へ訂正
  - **`.thread/11/adr.md`**: 束 1〜5 の判断を追記し、ADR-056 の Consequences（catch の広さ）と ADR-057 の Consequences（観測の所在）を実態へ直す。**W-S04（public 検索の並び順）を 1 項として残す** — 現行ポートに sort が無く両バックエンドとも `noteId` keyset であること、canon の RRF 記述は物理 shard 化と同時に引き直すこと、別 Issue へ起票したこと

### 要確認の決定（メイン・Round 003）

なし（本ラウンドの `要確認` は 0 件。付随決定 3 件はいずれもメインが上表で決着させた）

## defer で起票した Issue（Round 003）

| Key | 判定 | 起票 Issue |
|---|---|---|
| `publicNoteQueryService:public 検索の並び順が spec と食い違う` | defer（canon は動かさず `.thread/11/adr.md` ADR-076 に理由を記録） | #54 |

## Round 004

レビュー 5 本の指摘（Blocker 2 / Warning 14 = 16 件）を重複統合したもの。総数 **13 件**（fix 13 / wont-fix 0 / defer 0 / 要確認 0）。
束ねたのは 3 組 — `B-U01`≡`B-R01`（uow / routing が独立に検出した同一欠陥）、`W-U01`≡`W-R01`（並行 publish の上書き）、`W-R02`≡`W-C02`（`spec/platform/index.md:197` の同一段落。fencing の主張と参照先の 2 つの欠陥を 1 件として扱う）。

Round 001 / 002 / 003 の台帳と Key を突き合わせた結果、**既出（wont-fix / defer 済み）の再指摘は 0 件**。`CLAUDE.md` の追随・`findPending` の順序・`publicNoteQueryService` の並び順・`readForUpdate` 事前読み・`spec/inventory` の ADP 行（#52）・`DEFAULT_MAINTENANCE_TABLES`（#16）はいずれも再指摘されていない。W-C02 の対案（`spec/domains/index.md` に `ScopeTaskScheduler` 節を起こす）は #52 の受け皿と重なるので採らず、参照先の差し替えで閉じる。

fix のうち 2 件（W-I01 / W-S03）は**恒久対処を別 Issue へ送り、本 PR では正本側の記述を実態へそろえる**形で閉じる。起票が必要なものは末尾の表に置く。

判定の付随決定を 4 件（B-01 の倒し方 / W-U01 の倒し方 / W-I01 の扱い / W-S03 の倒し方）、末尾の「付随決定」表に置く。

### UoW / 実行機構・SQL 土台

| Key | 指摘 | 判定 | 理由 | 再指摘 |
|---|---|---|---|---|
| `do/scopeObject.ts:constructor が再試行 alarm を消す` | ADR-070 の republish 再試行 alarm が object 再構築時の `rescheduleAlarm` に `deleteAlarm` される（**Blocker**、uow B-001 ≡ routing B-001） | fix | コードで成立を確認した。`scopeObject.ts:85-93` は `stored !== null` なら必ず `rescheduleAlarm(ctx.storage)` を呼び、`alarm.ts:257-260` はレジストリが空（`registerScopeTaskHandler` の production 呼び出しは 0 件＝既定）なら `nextWakeAt` を読まずに `storage.deleteAlarm()` する。alarm は DO storage の耐久状態であり、これを消すコードは `rescheduleAlarm` だけなので、`armNoLaterThan` が張った 10 秒後の再試行は「evict → 任意の RPC → constructor」で失われる。しかも 10 秒アイドルは evict 閾値そのものなので、再試行の配送自体が cold start になる経路（constructor が `alarm()` の手前で消す）が通常経路になりうる。ADR-070 が塞いだのは `armAndPublish` 内の順序だけで、`rescheduleAlarm` のもう 1 つの呼び出し地点が残っていた。`dueIndex.ts:38-43` の「その再試行は配備が task を駆動するかに依存しない」と `spec/platform/index.md:201` の「レジストリが空のあいだは張り直しが Alarm の削除になる」が両立していない。`alarm.test.ts:515` は同一 live インスタンスへ `runDurableObjectAlarm` を撃つだけで constructor を再入していないため塞げていない。**倒し方は下記「付随決定」の (c′)** | 1 |
| `do/scopeObject.ts:armAndPublish の並行 publish` | 同一 scope への並行 commit が古いスライスで新しいスライスを上書きしうる（uow W-001 ≡ routing W-001） | fix | `applyWriteSet` は `this.sql.apply()`（storage 操作＝ input gate が閉じる）のあと `armAndPublish` で **D1 binding への `await`** に入る。D1 呼び出しは当該 object の storage 操作ではないので input gate が開き、次の `applyWriteSet` が配送されうる（`lease.test.ts:170,231` が同一 object への 2 呼び出しの交錯を実測している）。`publishDueIndex` は「`scheduled_tasks` を同期 SELECT → D1 へ `DELETE + INSERT`」の read-modify-write で排他が無く、A のスライスが B のあとに着地すると B が積んだ行が索引から消える。落ちるのは B-01 と同じ**欠落方向**で、しかも publish は成功しているので ADR-070 の再試行 alarm は張られず、既定配備では回復経路が無い（次に同じ scope の `scheduled_tasks` を触る write-set が来るまで鎖が止まる）。中央 runner の claim と利用者要求由来の `schedule` が同じ scope で重なれば起きる頻度。**倒し方は下記「付随決定」** | 1 |

### Identity / directory / operation

| Key | 指摘 | 判定 | 理由 | 再指摘 |
|---|---|---|---|---|
| `d1/repositories/{accountDeletionManifestStore,distributedOperationStore}.ts:guard 敗北再読みの到達範囲` | `writeHeader` / `beginOrResume` の guard 敗北再読みが production の呼び出し経路から 1 つも到達しない | fix（記録側へ倒す。恒久対処は別 Issue） | 事実関係をコードで確認した。`sql/session.ts:196-198` の staged `write` は `writeSet.stage()` を呼ぶだけで投げないので、再読みは autocommit セッションでしか走らない。`writeHeader` の配線済み 2 呼び出し（`manifestBuild.ts:138` / `compaction.ts:58`）と `beginOrResume` の唯一の呼び出し（`admission.ts:111`）はいずれも `globalUnitOfWorkProvider.run` 経由で、実際に起きるのは `globalUnitOfWork.ts:88-92` の既定翻訳（`OPTIMISTIC_LOCK_FAILURE` で UoW ごと巻き戻る）である。ただし**コードは死んでいない** — `SqlSession` の JSDoc が「同じリポジトリコードが staged / autocommit の両方で走る」ことを契約しており、`ConformanceBackend` は両方の形でポートを呼ぶ。消せば ADR-073 が閉じた乖離が autocommit の形で再び開き、`globalConcurrency.test.ts` の観測も落とすことになる。したがって**消さない／staged へ通す仕掛けも本 PR では入れない**（UoW commit 側に「どの mutation が guard だったか」を持たせる設計変更が要り、ADR-001 の範囲を越える）。正本側の穴だけを塞ぐ — ADR-073 の Consequences に到達範囲の 1 行、`globalConcurrency.test.ts` の冒頭 JSDoc に「この束は autocommit セッションで組んでいる」の限定を書く | 1 |

### Routing / outbox / scope インフラ

| Key | 指摘 | 判定 | 理由 | 再指摘 |
|---|---|---|---|---|
| `spec/platform/index.md:197:fencing 決着文と参照先` | 「引き金は 1 scope に複数 writer であって複数 worker プロセスではない」が中央 runner 配備で不成立、かつ `spec/domains/index.md` の存在しない `ScopeTaskScheduler` 節を参照している（routing W-002 ≡ composition W-002。**AC-6 に直結**） | fix | 両方とも成立を確認した。(1) 中央 runner は `scopeTaskQueue.listDue`（全 scope 共有の due index）で scope を選ぶので、runner の起動が 2 本並走すれば同じ scope を掴みうる。`scopeTaskRunner.ts` の `claimedScopes` は 1 ラウンド内の重複排除にすぎず起動をまたがない。したがって「scope が分かれていれば writer も分かれる」は Alarm driver の配備でしか言えない。claim 自体は `_occ_guard` で排他だが、AC-6 が問うているのは settle（`complete` / `backoff` / `schedule`）の fencing で、リース超過した起動 1 の `complete(kind, operationId)` が起動 2 の積んだ継続行を消す筋書きはポート JSDoc（`application/ports/scopeTaskScheduler.ts:132-147`）が既に書いている。(2) `grep -c ScopeTaskScheduler spec/domains/index.md` は 0。AC-6 の決着を canon に残すのがこの段落の役目なので、主張が事実と食い違い参照が空振りしている状態は AC-6 未達に等しい。実配備（Queue consumer / Cron ハンドラ）は plan.md「含まれないもの」なので、記述の訂正だけで閉じる | 1 |
| `do/repositories/scopeTaskScheduler.ts:146-159:claimDue 候補読みのコメント` | コメントが「同一 unit で staged 済みの claim は 2 度選ばれない」と、コードが持たない性質を主張している | fix | `queryCandidates` が `session.query`（オーバーレイ非参照の commit 済み直読み）であることを確認（`session.ts:142`）。同一 unit で `claimDue` を 2 度呼ぶと 1 度目に staged した claim は見えず、同じ行が再選択されて同じ `ScopeTask` が 2 度返る。memory はトランザクション内の table を直接書き換えるので 2 度目は候補にならず、**バックエンド間で振る舞いが割れる**。今日の唯一の呼び出し元（`runDueScopeTasks`）は 1 unit 1 回なので実害は無い。コメントの前半（候補は他の writer から見えている commit 済み行でなければならない）だけを残し、割れている前提はポート JSDoc 側へ「1 つの unit of work で `claimDue` を複数回呼ばない」として 1 行で明記する（ADR 046 の「正本のある側へ倒す」。memory も適合スイートも動かない） | 1 |

### Scope business / 投影・全文検索 / R2

| Key | 指摘 | 判定 | 理由 | 再指摘 |
|---|---|---|---|---|
| `projection/snapshotWriter.ts:redactAuthor + do/repositories/noteProjection.ts:bump の割り込み観測` | OCC guard を持つ 2 経路に割り込みテストが無く、guard を外しても全テストが緑 | fix | どちらも JSDoc が具体的な失敗像で guard の必要性を主張している（ADR-050 / 投影 revision の lost update）のに、`projectionConcurrency.test.ts` が pin しているのは `replaceSnapshotIfNewer` / `removeIfNewer` / 初回 insert の 3 経路だけであることを確認。memory は単一スレッドなので共有適合スイートは原理的にこの割り込みを観測できず（AC-4 が「適合スイートが観測できない driver 固有の性質」として置いた枠そのもの）、`bump` は scope DO の 2 RPC（read → applyWriteSet）にまたがるので実際に割り込みうる。既存の `interposeOnce` をそのまま使え、適合スイート本体に触れないので AC-8 の手続きは不要 | 1 |
| `__tests__/deleteFilesByOwner.test.ts:56 のコメントと ADR 056` | AC-5 テストの冒頭コメントが「実測値は予算文書に属さない」と決定 3 を根拠に主張し、決定 2 に従って実測値を載せた `spec/platform/index.md:155` と正反対 | fix | 原文で確認した。`spec/platform/index.md:155` は Round 003 で決定 2 どおりに直っており（`4n + 3` を本文に持ち、届かないバックエンドの話だけを ADR へ送る）、テストコメントだけが逆を言っている。canon と実装コメントが同じ論点で食い違って残ると、次に触る人がどちらを正とするか判断できない。当該 2 文を「予算文書が設計目標として持つ `4n + 3` をこのファイルが実測で pin する（ADR 056 決定 2）」へ直し、決定 3 への言及を落とす | 1 |
| `domain/note/ports/publicNoteProjectionWriter.ts:44:removeForPurge の ack 契約` | ポート JSDoc の「acknowledged under the operation」を D1 は実装せず、memory の ack 表は誰も読まない | fix（契約を実態へ倒す） | 三者不整合を確認した。D1 実装は `operationId` / `routeVersion` / `projectionRevision` を 1 つも使わず行を消すだけ、memory の `publicPurgeAcks` は `store.ts:422` の宣言と `noteProjection.ts:219` の書き込みだけで**読み手が 0 件**、適合スイート `ADP-note-032` は「2 回呼んでも失敗しない」しか見ない。ADR 046 の「正本のある側へ倒す」に照らすと、観測者のいない ack を契約語として残す理由が無い。**ポート JSDoc を「冪等性は end state で満たし、別途の acknowledgement 行は契約しない」へ直す**。memory の死んだ表を落とす案は採らない — `adapters/memory/` の変更は AC-7 が禁じている。表の除去は別 Issue へ送る（下表） | 1 |
| `search/highlight.ts:72:mapPositions の正規化コスト` | 未認証の公開検索 1 ページで書記素クラスタ単位の NFKC 正規化が最大 16 万回 | fix | `mapPositions` が `clusters.segment(source)` の 1 クラスタごとに `normalizeForSearch`（`bigram.ts:48` の `normalize("NFKC").toLowerCase()`）を呼ぶことを確認。`bodyHighlights` は `substr(text, 1, 4000)` に対して走り、excerpt に一致が無かった行は全行がそうなりうるので、`limit` 20 なら 1 リクエストで 4,000 × 20 × 2 呼び出し。`spec/database/index.md:966` の 4,000 文字上限は**転送量**の根拠であって CPU の見積もりはどこにも無く、`searchPublic` はサインイン不要の経路（ADR 063）。1 コードユニットで `< 0x80` のクラスタは NFKC が恒等・`toLowerCase` が長さを変えないので、ASCII 速路は写像の意味を 1 ビットも変えない。全文正規化での事前フィルタは採らない（クラスタ境界を跨ぐ合成で取りこぼす方向にずれる） | 1 |

### 合成・スキーマ・テストハーネス・spec/docs

| Key | 指摘 | 判定 | 理由 | 再指摘 |
|---|---|---|---|---|
| `spec/domains/note.md:620:投影 writer のエラーケース行` | 2 ポートの JSDoc だけ `OPTIMISTIC_LOCK_FAILURE` へ広げ、spec のエラーケース行が `SystemError(DatabaseError)` のまま | fix | 原文で確認した（`spec/domains/note.md:620` は `**エラーケース**: SystemError(DatabaseError)`）。ADR-068 が広げた契約が canon に着地していない。同じ PR が `spec/domains/identity.md:482` は JSDoc に合わせて書き換えており、他ドメインの同種の節（`usage.md:158` / `storage.md:262` / `note.md:423`）はいずれもエラーケース行に `ConflictError("OPTIMISTIC_LOCK_FAILURE")` を並べているので、この節だけが例外になる。AC-9 の「spec の持ち分を変えた決定は反映されている」に直接効く | 1 |
| `spec/database/index.md:14:FOREIGN KEY を置かない決定が canon に無い` | 物理制約の指示として読める規約が残り、両バックエンドの DDL は FK を 1 本も置かない | fix | `0001_global_schema.sql:11-18` と `do/schema.ts:39-40` が FK を置かないこと、`spec/database/index.md:14` の共通の規約が「同じ database / domain の親子は原則 `ON DELETE CASCADE`」と物理制約の指示として書かれ、各表の「制約」列にも `FK → …` が入っていることを確認。理由は `.thread/11/adr.md` ADR-006 にあり AC-9 の逃げ道は満たすが、`.thread/` は canon ではない。同じ PR が隣接項目（scope 検証）と「制約」列の実効性（ADR-077）は実装に合わせて書き換えているので、ここだけ非対称。ADR-006 の決定文を規約 1 文として canon 語へ落とす（列の「制約」列は動かさない） | 1 |
| `docs/runtime_node.md + application/cleanup/*.ts:着地済みの #11 を未来形で指す参照` | スライスが着地したのに `#11` を「これから来る」ものとして指す記述が本番ソースと docs に残る | fix | 4 か所を確認した。`docs/runtime_node.md:5`（「arrives as Issue #11 and swaps only the adapter + entry layers」）/ `:94` の表見出し / `:102`、`personalCleanup.ts:92`（「a backend that can hold several exists — #11」）、`participants.ts:54`（`"#11 / the slice adding a scope outbox read side"`）。README は本 PR で現在形へ直っているので docs 側だけが取り残されている。`personalCleanup.ts` の待っていた条件（1 scope に複数 barrier receipt を保持できるバックエンド）は CF の `ScopeCleanupAdmissionStore` の到着で満たされ、`participants.ts` の `#11` は scope outbox の読み側を足さずに閉じたので誤誘導になる。ADR-052（本番ソースから作業記録への参照を全廃する）と同じ向き | 1 |
| `spec/inventory/*.md:3:最終同期の日付` | 行を書き換えたのに「最終同期」日付が 1 日前のまま | fix | `adapter.md` / `domain.md` / `test.md` / `usecase.md` が `2026-08-25`、`frontend.md` が `2026-08-16` であることを確認。本 PR は生成元（`spec/domains/` / `spec/testcases/` / `spec/usecases/`）と台帳の行を同じコミット群で書き換えているので、日付だけが嘘になる。行を触った 4 ファイルを `2026-08-26` にする（`frontend.md` は生成元 `spec/pages/` が未変更なので動かさない） | 1 |

### 付随決定

| Key | 判定 | 理由 |
|---|---|---|
| `B-01:再試行 alarm を cold start から守る倒し方` | **(c′) constructor は alarm を「張るだけ」にし、決して消さない** — `scopeAlarmDrivesTasks()` が真のときだけ `nextWakeAt` を読んで `armNoLaterThan` で武装し、偽のときは何もしない | 案 (a)「constructor で due index と自分のスライスを突き合わせる」は採れない — `spec/platform/index.md`「外部要求」が「DO transaction / `blockConcurrencyWhile` の中で external I/O を待たない」と明示しており、constructor の再武装はその `blockConcurrencyWhile` の中にある。案 (b)「再試行の意思を DO storage に永続化する」も採らない — alarm 自体が既に DO の耐久状態であり、消していたのは自分のコードだけなので、`_scope_identity` へ `due_index_dirty` を足すのは同じ耐久性を二重に持つだけで、schema と `spec/database/index.md` の追随（AC-9）まで連れてくる。(c′) は cold start で成立する — constructor が何も消さないので、evict 後に任意の RPC が来ても再試行 alarm は残り、配送時も constructor が `alarm()` の手前で消さない。alarm() 側は従来どおり `EMPTY_TURN` → `finally` の `armAndPublish` で publish を再試行し、成功すれば `rescheduleAlarm` が同じ turn の中で alarm を落とす（レジストリ空の配備で古い alarm が残り続けることはない）。constructor が持っていた「駆動する配備が、駆動しない配備の残した行を拾う」役目は `armNoLaterThan(nextWakeAt)` で保たれ、既に武装済みの早い alarm（＝再試行）を遅らせない。観測は「`state.abort()` で object を作り直し、次の RPC のあとも `getAlarm()` が非 null」を `alarm.test.ts` に足す |
| `W-U01/W-R01:並行 publish の倒し方` | **object インスタンス内で `armAndPublish` を直列化する（`private publishing: Promise<void>` の鎖）** | スライスは全置換なので、順序さえ保てば最後の publish が正しい。世代を載せる案は `scope_task_due_index` に列を足し（AC-9 の追随）、D1 側の条件付き削除まで連れてくるのに対し、直列化は object 内の数行で閉じ、`spec/database/index.md` の「D1 と scope DO を 1 transaction に含めない」にも触れない。読み（`scheduled_tasks` の SELECT）も鎖の中に入るので、A の読みと B の読みが交差する経路ごと消える。production の合成では `do/repositories/scopeTaskScheduler.ts` の autocommit publish は staged 判定で no-op になるため、object 内の直列化で writer は 1 本に揃う。`dueIndex.ts` の「Replacing the whole slice … converge on the same result」に「順序は object が直列化して保つ」を書き足す。観測は並行 `applyWriteSet` 2 本のあと索引が最新スライスと一致すること |
| `W-I01:死んでいる再読み経路の扱い` | **消さない／staged へ通す仕掛けも入れない。到達範囲を正本（ADR-073 の Consequences とテストの JSDoc）に書く。恒久対処は別 Issue** | `SqlSession` の契約は「同じリポジトリコードが staged と autocommit の両方で走る」であり、`ConformanceBackend` は両方の形でポートを呼ぶ。したがって再読みは autocommit の形では到達する生きたコードで、消せば ADR-073 が閉じた乖離がその形で再び開き、`globalConcurrency.test.ts` の 2 ケースも落ちる。staged 経路で到達させるには UoW の commit が「どの mutation が guard だったか」をポートへ返す仕掛けが要り、ADR-001（write-set は commit 時に 1 度だけ適用する）の範囲を越える。実害は「1 turn の無駄と、契約が resume と言う場面での 409」に留まり収束もするので、本 PR では記述で閉じる |
| `W-S03:ack 契約をどちらへ倒すか` | **契約を実態へ倒す（ポート JSDoc から acknowledgement の語を落とす）。memory の `publicPurgeAcks` は動かさず別 Issue** | ADR 046 の手続きは「振る舞いの正本がどちらにあるか」で倒すこと。ここでは ack を読む者が両バックエンドにも適合スイートにも 1 人もいないので、正本は「end state での冪等性」の側にある。実装を契約へ寄せる案（D1 に ack 表を足す）は、読み手のいない表を 2 つ目のバックエンドにも作り、適合スイートへケースを足す（AC-8 の手続き）ことになる。memory の死んだ表を落とすのは筋だが `adapters/memory/` の変更は AC-7 が禁じているので、本 PR では触らず起票に回す。`spec/inventory/adapter.md:218` の ADP-note-032 行は語を変えずに済む |

### fix の観点別内訳

- UoW / 実行機構・SQL 土台: 2
- Identity / directory / operation: 1
- Routing / outbox / scope インフラ: 2
- Scope business / 投影・全文検索 / R2: 4
- 合成・スキーマ・テストハーネス・spec/docs: 4

合計 13（wont-fix 0 / defer 0）

## 修正の実行計画（Round 004）

束 1〜5 は担当ファイルが重ならないので並列委譲できる。束 6 は 1〜5 の完了後に直列で走らせる（spec / ADR の追随が束 1・束 2・束 3 の結論を材料にするため）。**各束は自分が決めた判断を作業メモに残し、`.thread/11/adr.md` への追記は束 6 がまとめて行う**（Round 001〜003 と同じ規律）。

### 束 1: 再試行 alarm の生存と publish の直列化

- 含む指摘: `review-004-uow.md` の B-001・W-001 ／ `review-004-routing.md` の B-001・W-001（いずれも同一の 2 件）
- 触るファイル:
  - `packages/core/src/adapters/cloudflare/do/scopeObject.ts`
  - `packages/core/src/adapters/cloudflare/do/dueIndex.ts`（JSDoc）
  - `packages/core/src/adapters/cloudflare/__tests__/alarm.test.ts`
- 修正方針: constructor の `rescheduleAlarm` を「張るだけ」に置き換える — `scopeAlarmDrivesTasks()` が真のときだけ `nextWakeAt(ctx.storage)` を読み、非 null なら `armNoLaterThan` で武装する（偽なら何もしない）。constructor から `deleteAlarm` へ至る経路が消えるので、`armNoLaterThan` が張った再試行が cold start を越えて残る。`armAndPublish` は `private publishing: Promise<void>` の鎖に繋いで object インスタンス内で直列化し、`publishDueIndex` の読み（`scheduled_tasks` の SELECT）ごと鎖の中に入れる。`dueIndex.ts` の JSDoc は (i) 再試行 alarm を消す者がいなくなったこと (ii) 全置換の収束は object が publish を直列化することで保たれること、の 2 点を現在形で書く。テストは `alarm.test.ts` に 2 本 — (a) publish を落として武装したあと `runInDurableObject(stub, (_i, state) => state.abort())` で作り直し、次の RPC のあとも `getAlarm()` が非 null であること、(b) 同一 scope への並行 `applyWriteSet` 2 本のあと索引が最新スライスと一致すること。`spec/platform/index.md:201` と ADR-070 の Consequences の書き直しは束 6 へ渡す

### 束 2: ポート契約と実態の突き合わせ（scope task / control plane）

- 含む指摘: `review-004-routing.md` の W-003 ／ `review-004-identity.md` の W-001
- 触るファイル:
  - `packages/core/src/adapters/cloudflare/do/repositories/scopeTaskScheduler.ts`（コメント）
  - `packages/core/src/application/ports/scopeTaskScheduler.ts`（JSDoc 1 行）
  - `packages/core/src/adapters/cloudflare/__tests__/globalConcurrency.test.ts`（冒頭 JSDoc）
- 修正方針: `queryCandidates` のコメントは前半（候補は他の writer から見えている commit 済み行でなければならない）だけを残し、成り立っていない後半を落とす。割れている前提はポート JSDoc 側へ「1 つの unit of work で `claimDue` を複数回呼ばない（オーバーレイを参照しないバックエンドは同じ行を 2 度配る）」の 1 行として明記する — memory も適合スイートも動かないので AC-7 / AC-8 に触れない。`globalConcurrency.test.ts` の冒頭 JSDoc に「この束は `createAutocommitSession` でストアを組んでおり、`writeHeader` / `beginOrResume` の guard 敗北再読みはこの形でだけ到達する」の限定を書く。ADR-073 の Consequences への追記と別 Issue の起票は束 6 へ渡す

### 束 3: 投影の割り込み観測と purge の ack 契約

- 含む指摘: `review-004-scope.md` の W-001, W-003
- 触るファイル:
  - `packages/core/src/adapters/cloudflare/__tests__/projectionConcurrency.test.ts`
  - `packages/core/src/domain/note/ports/publicNoteProjectionWriter.ts`（JSDoc）
  - `packages/core/src/adapters/cloudflare/d1/repositories/publicNoteProjection.ts`（`removeForPurge` の JSDoc を契約側の語に合わせる範囲のみ）
- 修正方針: 既存の `interposeOnce` をそのまま使い 2 ケース足す — (a) `redactAuthor` の読みと write の間に rival の `replaceSnapshotIfNewer`（より新しい `authorVersion`）を差し込み、敗者が `ConflictError` になること・旧表示名が復活しないことを観測する、(b) scope セッションで `bump` の read と write の間に別の `bump` を差し込み、2 つの呼び出しが同じ revision を返さない（敗者が `ConflictError`）ことを観測する。適合スイート本体には触れない（AC-8 の手続き不要）。`removeForPurge` のポート JSDoc は「Idempotent purge-side removal. 冪等性は end state で満たし、別途の acknowledgement 行は契約しない」へ直す。**`adapters/memory/` は 1 行も触らない**（AC-7）。memory の `publicPurgeAcks` 除去の起票は束 6 へ渡す

### 束 4: ハイライト位置写像の ASCII 速路

- 含む指摘: `review-004-scope.md` の W-004
- 触るファイル:
  - `packages/core/src/adapters/cloudflare/search/highlight.ts`
  - `packages/core/src/adapters/cloudflare/__tests__/searchEdges.test.ts`
- 修正方針: `mapPositions` に「1 コードユニットかつ `< 0x80` のクラスタは `normalize` を呼ばず `toLowerCase` だけ」の速路を足す（NFKC は ASCII 上で恒等、`toLowerCase` は長さを変えないので写像は不変）。JSDoc には「なぜ速路が写像を変えないか」だけを書く。`searchEdges.test.ts` に、ASCII 本文と非 ASCII 本文の双方で `bodyHighlights` の位置が速路の有無で変わらないことを固定するケースを 1 本足す（マークが元テキストの切り出しであることを見る既存の形を流用）

### 束 5: テストコメントと着地済みスライスへの参照

- 含む指摘: `review-004-scope.md` の W-002 ／ `review-004-composition.md` の W-004
- 触るファイル:
  - `packages/core/src/adapters/cloudflare/__tests__/deleteFilesByOwner.test.ts`（冒頭コメント）
  - `docs/runtime_node.md`
  - `packages/core/src/application/cleanup/personalCleanup.ts`（コメント）
  - `packages/core/src/application/cleanup/participants.ts`（`absent` の理由文字列）
- 修正方針: `deleteFilesByOwner.test.ts:56` の 2 文を「予算文書（`spec/platform/index.md`「実行予算と分割単位」→「Scope DO」）が設計目標として持つ `4n + 3` を、このファイルが実測で pin する（ADR 056 決定 2）」へ直し、決定 3 への言及を落とす。`docs/runtime_node.md:5` は README と同じ現在形（adapter group と DI wiring は in place、残るのは entry point と配備設定）へ、`:94` の表見出しは `Cloudflare` から Issue 番号を外し、`:102` の「Issue #11」も同様に扱う（`#15` を指す行は動かさない）。`personalCleanup.ts:92` は「複数の barrier receipt を保持できるバックエンドが実在するので、観測を足すなら適合スイート側（ADR 046 の手続き）」へ書き換えて `#11` を外す。`participants.ts:54` は `"the slice adding a scope outbox read side"` へ縮める。**`apps/web/` と `adapters/memory/` は触らない**

### 束 6: canon の追随（spec / ADR / 起票）— 束 1〜5 の後に直列

- 含む指摘: `review-004-routing.md` の W-002 ≡ `review-004-composition.md` の W-002 ／ `review-004-composition.md` の W-001, W-003, W-005 ／ 束 1〜3 が渡した canon 側の持ち分
- 触るファイル:
  - `spec/platform/index.md`
  - `spec/domains/note.md`
  - `spec/database/index.md`
  - `spec/inventory/{adapter,domain,test,usecase}.md`
  - `.thread/11/adr.md`
  - `.thread/11/review/triage-keys.md`
- 修正方針:
  - **AC-6 の決着文（W-R02 ≡ W-C02）**: `spec/platform/index.md:197` の最後の一文を driver で場合分けする — 「object Alarm が driver の配備では scope ごとに writer が分かれるので worker プロセスの多重度は引き金にならない。中央 runner が driver の配備では due index が全 scope 共有なので、**runner の起動が重ならないこと**（1 配備あたり同時 1 起動）が単一 writer 前提そのものである」。参照は `spec/domains/index.md` の存在しない節から `spec/database/index.md` の `scheduled_tasks` / `scope_task_due_index` 節へ差し替える（`:220` の run lease fencing 段落が経由する参照も同時に）。`spec/domains/index.md` に `ScopeTaskScheduler` 節を起こす案は #52 の受け皿と重なるので本 PR では採らない
  - **再試行 alarm（束 1 の持ち分）**: `spec/platform/index.md:201` の「レジストリが空のあいだはこの張り直しが Alarm の削除になるので、既定の配備では何も起きない」を「起動時の張り直しは alarm を足すだけで消さない。レジストリが空の配備では turn が 1 行も動かさず、publish の再試行だけがそこを通る」へ。ADR-070 の Consequences に constructor 経路と (c′) の決定を書き足す
  - **投影 writer のエラーケース（W-C01）**: `spec/domains/note.md:620` を `**エラーケース**: ConflictError("OPTIMISTIC_LOCK_FAILURE")（読みと適用のあいだに行が動いた場合。再配送が読み直して収束する）、SystemError(DatabaseError)` にする
  - **FOREIGN KEY（W-C03）**: `spec/database/index.md:14` に「`ON DELETE CASCADE` / `RESTRICT` の記述は論理的な所有関係の宣言であり、物理制約の宣言を要求しない。親子の後始末はドメインイベントの購読者が行う」を 1 文足す（ADR-006 / ADR-077 の決定文を canon 語へ落とすだけ。列の「制約」列は動かさない）
  - **台帳の日付（W-C05）**: `spec/inventory/{adapter,domain,test,usecase}.md:3` の最終同期を `2026-08-26` へ（`frontend.md` は生成元未変更のため動かさない）
  - **`.thread/11/adr.md`**: 束 1〜5 の判断を追記する。少なくとも (i) constructor は alarm を消さない（B-01 の (c′)、案 (a) / (b) を退けた理由込み） (ii) object 内 publish の直列化 (iii) ADR-073 の Consequences に guard 敗北再読みの到達範囲（staged 経路は commit 時の既定翻訳のまま） (iv) `removeForPurge` の ack 契約を実態へ倒した判断と memory 側の死んだ表を残した理由（AC-7） (v) `claimDue` を 1 unit 1 回に限る旨をポート JSDoc へ書いた判断
  - **起票（本 PR では行わず、完了報告で提示）**: 下表の 2 件を `triage-keys.md` の「起票が必要」へ記録する

### 要確認の決定（メイン・Round 004）

なし（本ラウンドの `要確認` は 0 件。付随決定 4 件はいずれもメインが上表で決着させた）

## 起票が必要（Round 004・未起票）

| Key | 判定 | タイトル案 |
|---|---|---|
| `execution/globalUnitOfWork.ts:staged 敗北の guard 翻訳をポート契約の答えへ返す` | defer（W-I01 の恒久対処） | UoW commit で敗れた `_occ_guard` を、その mutation を出したポートの読み経路の答えへ翻訳して返す |
| `adapters/memory:publicPurgeAcks の死んだ表を落とす` | defer（W-S03 の memory 側。AC-7 のため本 PR では触らない） | `PublicNoteProjectionWriter.removeForPurge` の ack 契約撤回に合わせ、memory の `publicPurgeAcks` 表を落とす |

## Round 005

レビュー 5 本の指摘（Blocker 0 / Warning 22 = 22 件）を重複統合したもの。総数 **19 件**（fix 17 / wont-fix 2 / defer 0 / 要確認 0）。
束ねたのは 3 組 — `W-U01`≡`W-C04`（commit 経路の alarm 削除）、`W-U03`≡`W-R05`（publish 鎖の合流）、`W-U04`≡`W-R02`（autocommit publish の非対称）。**Blocker は 0 件**。

Round 001〜004 の台帳と Key を突き合わせた結果、**既出の判定を継承したものが 1 件**（`spec/inventory/frontend.md:3` の最終同期日 ＝ Round 004 の `spec/inventory/*.md:3:最終同期の日付` の除外判断。再指摘 2）。
`W-C05`（`.thread/11/adr.md` の ADR-026 欠番）は Round 001 で **fix** と判定しながら実施が落ちていた項目で、判定を継承したまま再度 fix とする（再指摘 2）。
`readForUpdate` 事前読み・`findPending` の順序（#53）・`publicNoteQueryService` の並び順（#54）・`spec/inventory` の ADP 行（#52）・`DEFAULT_MAINTENANCE_TABLES`（#16）・`CLAUDE.md` の追随は、いずれも再指摘されていない。

判定の付随決定を 5 件（W-U01 の倒し方 / W-U02 の範囲 / W-U04 の倒し方 / W-I03 の範囲 / W-C03 の倒し方）、末尾の「付随決定」表に置く。

### UoW / 実行機構・SQL 土台

| Key | 指摘 | 判定 | 理由 | 再指摘 |
|---|---|---|---|---|
| `do/scopeObject.ts:armAndPublishNow が publish の前に alarm を消す` | commit 経路の `rescheduleAlarm` が、前回の publish 失敗が張った再試行 alarm を publish の前に消す（uow W-001 ≡ composition W-004） | fix | **コードで成立を確認した。** `scopeObject.ts:179-193` は `rescheduleAlarm` → `publishDueIndex` の順で走り、`alarm.ts:254-263` は `scopeAlarmDrivesTasks()` が偽（`registerScopeTaskHandler` の production 呼び出しは 0 件＝既定配備）なら `nextWakeAt` を読まずに `storage.deleteAlarm()` する。したがって `scheduled_tasks` を触る commit のたびに、前回の publish 失敗が `armNoLaterThan` で張った再試行が先に消える。非クラッシュ経路では直後の全置換 publish が回復させるが、`deleteAlarm` 成功後・publish 完了前に isolate が落ちると (a) 索引に載らない行 (b) 唯一の回復経路である再試行 alarm、が同時に失われる。`spec/database/index.md:1113` が「自然回復しない」と名指した向きで、復旧はその scope への次の書き込みのみ。Round 004 の (c′) が閉じたのは constructor 経路だけで、`rescheduleAlarm` のもう 1 つの呼び出し地点が残っていた。本 PR が書いた `spec/platform/index.md:202`「Alarm を消す地点は turn の出口 1 か所に限る」とも正面から食い違う。**倒し方は下記「付随決定」** | 1 |
| `execution/writeSet.ts+sql/session.ts:ステージ行の列が読み文の射影に足りないとき集合読みが黙って行を落とす` | `readRows` が `matches` / `compare` をステージ像に適用するので、像に欠けた列があると行が静かに消え順序が壊れる | fix（JSDoc のみ。実行時検査は入れない） | 事実関係を確認した。`session.ts:151-195` は `spec.matches` / `spec.compare` をステージ像にだけ適用し、欠けた列は `undefined` になる。**今日の全リポジトリは完全な行像を積んでおり実害は無い**（`noteRevisionRepository.ts:95-96` はこの前提を call site のコメントとして明記している）。穴は正本側にある — `RowMutation.upsert.row` の JSDoc（`writeSet.ts:3-19`）も `RowsRead`（`session.ts:30-52`）も「その表を読む文が選ぶ列を全部持つこと」を要求していない。**提案された実行時検査は採らない** — `readRows` が比較できるのは `stored[0]` のキー集合だけで、射影を絞った読み（`noteRevisionRepository` の `KEY_SELECTION = "id, created_at"`）では stored 側が狭いので不変条件を検査できず、毎読みのコストで偽の安心を買うことになる。不変条件は「ステージ像は常に全列」であり、それは書き手側の契約なので JSDoc に置くのが正しい位置である | 1 |
| `do/scopeObject.ts:armAndPublish の鎖に合流が無い` | 同一 scope の継続 arming が D1 往復 1 本ずつに serialize する（uow W-003 ≡ routing W-005） | wont-fix | **性能のみの指摘で、正しさは両レビュアーとも保たれると認めている**（routing W-005「急がないなら現状のままでも正しさは保たれるので、性能上の指摘に留める」）。直列化は Round 004 の付随決定 `W-U01/W-R01` で「古いスライスが新しいスライスを上書きする」欠陥を閉じるために意図して採った形であり、新事実は出ていない。加えて **Cloudflare 配備一式（Worker entry / Queue consumer / Cron）は plan.md「含まれないもの」で、今日 production から `applyWriteSet` を叩く呼び出し元は存在しない** — 同時実行数も D1 RTT も測れないまま「実行中 1 本 ＋ 保留フラグ」の合流機構を足すのは、観測できない改善のために alarm 周りの唯一の順序保証を複雑にする取引になる。トレードオフ（1 scope あたりのスループットが D1 RTT で頭打ち）を `.thread/11/adr.md` の直列化の Consequences に書き足し、配備スライスが実測してから引き直す | 1 |
| `do/repositories/scopeTaskScheduler.ts:autocommit publish が直列化の外にあり alarm も張らない` | autocommit 経路は due index を publish するが object の鎖にも入らず arming もしない（uow W-004 ≡ routing W-002） | fix | 事実関係を確認した。`scopeTaskScheduler.ts:101-124` の autocommit 分岐は object の `upkeep` 鎖の外で publish し、`scopeStub.apply` は `touchedTables` に `[]` を渡す（`scopeStub.ts:44-46`）ので `armAndPublish` に入らない。**今日 production の呼び出し元は 0 件**（`cloudflareRuntime.ts:294` は `buildRepositories` の中でしか組み立てず、`runDueScopeTasks` は claim も settle も UoW の中で行う）だが、`ConformanceBackend.forScope` がこの形を公開しており、配備スライスが Queue consumer から UoW を開かずに settle した瞬間に (a) 古いスライスの上書き (b) object 駆動配備で誰も起こさない行、の 2 つが同時に開く。そのとき気づける仕掛けが今は無い。**倒し方は下記「付随決定」** | 1 |

### Identity / directory / operation

| Key | 指摘 | 判定 | 理由 | 再指摘 |
|---|---|---|---|---|
| `d1/repositories/identitySupport.ts+accountDeletionManifestStore.ts+globalMaintenanceRunStore.ts:cursor の null ガード` | `(? IS NULL OR key > ?)` が索引のレンジ制約に落ちず keyset が読み飛ばしにしかならない | fix | 4 か所（`identitySupport.ts:84`、`accountDeletionManifestStore.ts:336,767`、`globalMaintenanceRunStore.ts:747`）を `grep` で確認した。`? IS NULL` は列に対する制約ではないので SQLite はこの `OR` 項を索引のレンジ制約へ落とせず、残余述語としてしか評価できない（SQLite は束縛値を見ずに文をコンパイルするため、値が非 NULL でも計画は変わらない）。`deleteExpiredPage` の 5 表は利用者数に比例して伸び、掃引はページごとに cursor 以前の**生存行**を走査し直す。`globalMaintenanceRunStore.pruneCompleted` は正しい複合 keyset を組み立てたうえで `global_maintenance_runs_expiry_idx` の利用ごと潰している。**これは「今日到達しない経路の理論的な性能懸念」ではなく、掃引という定常経路の計画そのもの**で、修正は文の組み立てを cursor の有無で分けるだけ（`identitySupport` は 1 か所で 5 表に効く）。契約も適合スイートも動かない | 1 |
| `spec/database/index.md:309,325,341,354,697:期限索引の役割` | 期限索引を「安定 keyset で回収する」と書くが、掃引の順序は表キーだけで索引は順序を与えない（AC-9） | fix | ポート契約（`domain/common/pagination.ts` の `PrunePage`、`adapters/memory/support.ts`、`identitySupport.ts:62-69` の JSDoc）が揃って「`expiresAt <= now` はフィルタであって順序ではない」と定め、発行 SQL も `ORDER BY <表キー>` であることを確認した。`(expires_at, key)` 索引は expired 集合への絞り込みには効くが順序は与えられないので、「同一 expiry を安定 keyset で回収する」はどの表でも成立していない。正本はポート契約側（ADR 026 / 046）にあるので spec の 5 行を実態へ改める。逆に `(expires_at, key)` keyset を本当に採るのは `PrunePage` の cursor 意味論・memory・適合スイートが同時に動く別 Issue（本 PR では採らない） | 1 |
| `d1/repositories/identitySupport.ts:103,149:有界削除が選択述語を DELETE へ持ち越さない` | 読みと書きのあいだに条件から外れた行も消える（TOCTOU）／1 行 1 文で発行している | fix（(1) 述語の持ち越しのみ。(2) 文数は現状維持） | (1) を採る。`deleteExpiredPage` / `deleteBoundedByKey` は `SELECT` を `expires_at <= ?` や `user_id = ? AND auth_epoch < ?` で絞るのに `DELETE` は `WHERE key = ?` だけで撃つ。`SessionRepository.refreshAuthEpoch` と `authResidueCleanup.deleteOlderEpochByUser` は同じ行を逆向きに動かしうるので、旧世代として選ばれた直後に refresh が着地すると現在の session が消えて強制サインアウトになる。`login_attempts` でも `recordFailure` が延ばした行を掃引が消してスロットルが緩む。memory は同期区間で読み書きするのでこの窓を持たず、適合スイートには観測できない乖離である。各 `DELETE` に選択述語を足すだけで閉じ、`remove()` のオーバーレイ寄与も保たれる。(2) の「1 行 1 文」は採らない — `spec/database/index.md` の共通の規約が禁じているのは**1 文にバインド変数を件数ぶん並べること**（上限 100）で、ここは 1 文 1 変数の別々の文なのでその規約には触れない。文数は `MAX_STATEMENTS_PER_COMMIT = 250` の番人が既に見ており、`json_each` 1 文へ畳むと `remove()` のオーバーレイ（同一 UoW の read-your-writes）を捨てることになる。理由を `.thread/11/adr.md` に残す | 1 |
| `__tests__/globalConcurrency.test.ts:116-128:手書きの部分 wipe` | `GLOBAL_WIPE_STATEMENTS` を使わず 6 表を名指しし `account_deletion_manifest_items` が漏れている | fix | `beforeEach` が 6 表の `DELETE` を手書きしていること、`conformanceBackend.ts:79` と `projectionConcurrency.test.ts:136` は導出された `GLOBAL_WIPE_STATEMENTS` を使っていることを確認した。`d1/schema.ts:47-60` は「`GLOBAL_TABLES` に足した表が wipe から漏れない」ことを目的に導出しているのに、このファイルだけが手書きの副本を置いて穴を開け直している。`appendMembershipPage` / `appendAuthorRoutePage` を使うケースを 1 つ足した瞬間に実行順依存になる。置き換えは 1 か所。同型の部分 wipe が `idempotency.test.ts` / `lease.test.ts` にもあるので併せて揃える | 1 |

### Routing / outbox / scope インフラ

| Key | 指摘 | 判定 | 理由 | 再指摘 |
|---|---|---|---|---|
| `spec/database/index.md:1110:autocommit publish 経路の利用者` | 「中央 runner の claim / settle」と書くが runner は staged 経路を通る（AC-9） | fix | 原文と実装を突き合わせて確認した。`runDueScopeTasks` は claim も settle も `scopeUnitOfWorkProvider.run` の中で行い（`workers/scopeTaskRunner.ts:169-171, 205, 219-221`）、staged 経路＝ object が publish する側に落ちる。アダプター自身の JSDoc（`scopeTaskScheduler.ts:83-86`）は逆に「the central runner included, takes that path」と書いており、canon と実装コメントが正面から食い違う。`createCloudflareRuntime` も scheduler を `buildRepositories` の中でしか組み立てないので、autocommit 経路を通る production の呼び出し元は今日 1 つも無い。「反映済みのつもりで書かれた誤り」なので AC-9 の逃げ道（adr.md に理由を残す）にも当たらない | 1 |
| `do/scopeObject.ts:86-101:constructor の再武装を観測するテストが無い` | `armForStoredRows` を no-op にしても全テストが緑 | fix | `alarm.test.ts:587-608` の `rebuild()` ケースがハンドラを登録しないまま走るため、`armForStoredRows` が `scopeAlarmDrivesTasks()` の偽分岐で即 return することを確認した。このテストが固定しているのは「constructor が alarm を**消さない**」ことだけで、`spec/platform/index.md` が新しく約束した「切り替え時に既に積まれている行は次に起きたときに武装され直す」側は 1 行も観測されていない。既存ヘルパー（`register` / `seed` / `rebuild` / `armedAt`）だけで 1 ケース書ける。W-U01 の修正と同じファイルなので同じ束で閉じる | 1 |
| `spec/database/index.md:1112:due index スライスの並び順` | canon は「`due_at` の早い 25 行」だが実装は `COALESCE(lease_expires_at, due_at)` 順（AC-9） | fix | 実装（`scheduledTasks.ts:89-104` の `ROW_NUMBER() OVER (PARTITION BY priority ORDER BY COALESCE(lease_expires_at, due_at), kind, operation_id)`）と canon 行を突き合わせて確認した。**実装のほうが正しい** — `running` 行が次に取れるのはリース失効時なので、`due_at` で並べると遠い将来にリースが切れる行がいま due な `pending` 行をスライスから押し出す。canon の文言だけが古い | 1 |

### Scope business / 投影・全文検索 / R2

| Key | 指摘 | 判定 | 理由 | 再指摘 |
|---|---|---|---|---|
| `projection/viewerCalendar.ts:formatterFor が行ごとに構築` | `Intl.DateTimeFormat` の構築が行数に比例する（不正 TZ 時は行あたり 2 回＋例外 2 回） | fix | `formatterFor` が毎回 `new Intl.DateTimeFormat` を作り、`wallClockOf` / `dayKeyOf` がそれを呼ぶ形であることを確認した。`countByDay` は行ごと、`listMonthsWithNotes` は行あたり 2 回呼ぶ。1 回の呼び出しのあいだ `timeZone` は不変なので、構築は完全に外へ括り出せる。**モジュールスコープの `Map` によるメモ化は採らない** — `timeZone` は利用者設定由来の文字列で、不正値がそのまま鍵になると無界に伸びる。`wallClockOf` / `dayKeyOf` を「フォーマッタを受け取る」形にし、`countByDay` / `listMonthsWithNotes` が 1 回だけ作る側へ倒す。`LocalNoteQueryService` を呼ぶ usecase は今日まだ無いが、適合スイートが通る定常経路であり修正は 1 ファイルに閉じる | 1 |
| `r2/objectStorage.ts:sha256Of が本文全体を複製` | `crypto.subtle.digest` は view の範囲を尊重するので複製は不要、かつコメントの根拠が事実と違う | fix | `objectStorage.ts:51-62` を確認した。WebCrypto の `digest(algorithm, data: BufferSource)` は「get a copy of the bytes held by the buffer source」で定義され、view の `byteOffset` / `byteLength` が示す範囲だけを見る。したがって「view をそのまま渡すと誤ったバイトを digest する」というコメントの前提は成立せず、複製はアップロード本文ぶんの `ArrayBuffer` を余計に確保しているだけ（Workers の 128MB 制約下で大きな `put` が本文を 2 部持つ）。CLAUDE.md「WHY が非自明なときだけコメントを置く」に照らすと、誤った WHY はコメントが無いより悪い | 1 |
| `search/highlight.ts:237-248:窓がサロゲートペアを割る` | `highlightBody` の窓が UTF-16 ユニット境界で切られ、対にならないサロゲートを返しうる | fix | `from = first[0] - WINDOW_LEAD` / `to = from + WINDOW_LENGTH` がコードユニットのオフセットで、コードポイント境界にも揃っていないことを確認した。表示は U+FFFD になるので安全側には倒れるが、モジュール JSDoc の「返す断片は利用者が実際に書いたテキストの一部である」と `spec/database/index.md` の「返す文字列は常に元テキストの一部」からは外れる。影響は `highlightBody` の経路だけ（`highlightExcerpt` は窓が全域）。境界をクラスタ境界（`map.starts` / `map.ends`）へ丸める形で閉じる | 1 |

### 合成・スキーマ・テストハーネス・spec/docs

| Key | 指摘 | 判定 | 理由 | 再指摘 |
|---|---|---|---|---|
| `do/schema.ts:43-46:scope 検証の範囲を主張するコメント` | 「全 scope 表が帰属列を持ち復元・保存の両方で検査する」が本 PR 自身の改訂と食い違う | fix | 原文を突き合わせて確認した。`spec/database/index.md:22` は本 PR で「`stored_files.owner_type / owner_id`、`storage_quotas.owner_type / owner_id`、`llm_usages.user_id` は会計上の帰属であって scope 鍵ではないので検査の対象外」へ改訂済みで、実装もそちら側で正しい（`storedFileRepository.ts:231`、`__tests__/ports/scopeBusiness.ts:25`）。さらに `llm_usages` は `owner_type` / `owner_id` 列を持たないので「Every scope table carries …」自体が事実に反する。schema ファイルは次のバックエンド実装者が最初に読む場所で、ここだけが旧規約を主張している | 1 |
| `spec/adr/056-performance-budget-placement.md:9,11:撤回済みの目標と不完全な一覧` | `spec/platform/index.md:796` が委譲した先の ADR が「3 文」目標と in-memory のみの一覧のまま | fix | 原文で確認した。ADR 056 のコンテキストは今も (a) 目標値として「件数によらず 3 文」を引用し、(b) 届かないバックエンドとして in-memory だけを名指す。本 PR は 3 文目標そのものを platform 側で取り下げ、Cloudflare 実装も `4n + 3` で届かないことを実測した。委譲先を辿った読み手が撤回済みの数字に着地する状態は、CLAUDE.md「Design canon」が `spec/adr/` を「今も有効な判断」の索引と定めていることに反する。決定文（3 つの決定）は動かさず、コンテキストへ 1〜2 文足す | 1 |
| `domain/note/ports/{local,public}NoteQueryService.ts:タグ名重複の契約文` | 「重複は 1 件と同じ」を JSDoc に新設したが適合スイートにも `spec/domains/note.md` にも降りていない（AC-8） | fix（JSDoc から契約文を落とし、実装コメントへ降ろす） | 事実関係を確認した。両ポートの `tagNames` に「a repeated name filters no differently from one」という契約文が新設され、`adapters/conformance/{local,public}NoteQueryService.ts` に重複タグを渡すケースは 0 件、`spec/domains/note.md:471,507` も据え置き。CLAUDE.md「Port contracts and conformance」と AC-8 は「contractual behaviour を足すならポート JSDoc と適合スイートの両方に触れる」と定めるので、片側だけの状態は解消しなければならない。**適合スイートへケースを足す側は採らない** — 本 PR の方針は「適合スイート本体を変更しない」であり、AC-8 の手続き（両バックエンドが同じケースを通ることの確認）を収束ラウンドで開く価値が無い。実装側の WHY は既に `projection/searchClauses.ts:64-70`（`COUNT(DISTINCT …)` の左辺と釣り合わせるため重複を落とす）に現在形で書かれており、正本を失わない。契約文を 2 ポートの JSDoc から落とせば、契約とスイートの非対称は消え `spec/domains/note.md` は触らずに済む。契約化したいなら適合スイート＋両バックエンドを同時に動かす別 Issue（今回は起票しない） | 1 |
| `.thread/11/adr.md:ADR-026 欠番` | ADR-025 → ADR-027 で番号が飛んだまま注記が無い | fix（Round 001 の判定を継承。実施漏れ） | Round 001 で **fix** と判定し（`triage.md:90`）修正対象にも挙げていた（`triage.md:228`）が、ファイルには何も入っていない（`grep 欠番 .thread/11/adr.md` → 0 件）。採番は 001〜085 の 84 本で重複も順序の乱れも無く、026 だけが飛んでいる。1 行で閉じる | 2 |
| `spec/inventory/frontend.md:3:最終同期の日付` | 行を改訂したのに最終同期日だけ据え置き | wont-fix（Round 004 の判定を継承） | Round 004 の `spec/inventory/*.md:3:最終同期の日付` で **「行を触った 4 ファイルを 2026-08-26 にする（`frontend.md` は生成元 `spec/pages/` が未変更なので動かさない）」** と決着済みで、覆すべき新事実は出ていない。台帳の「最終同期」は「この日付時点で**生成元**と一致している」という主張であり、`spec/pages/` は本 PR で 1 行も変わっていない（`grep cursor spec/pages/` → 0 件）。今回直した `PAGE-p41-002` の要点欄は、そもそも生成元に対応物を持たない記述の訂正であって突き合わせの結果ではないので、日付を上げると「していない照合をした」と主張することになる。理由を `.thread/11/adr.md` に残す | 2 |

### 付随決定

| Key | 判定 | 理由 |
|---|---|---|
| `W-U01/W-C04:commit 経路の alarm 削除をどう倒すか` | **commit 経路は「足すだけ」にする** — `armAndPublishNow` を呼び出し元で分け、`applyWriteSet` からは `armForStoredRows`（決して消さない）、`alarm()` の `finally` からは従来どおり `rescheduleAlarm` を通す | uow が提案した「publish 先・reschedule 後」は採らない — `armAndPublishNow` のコメントが述べる「arming first keeps the object's self-healing independent of D1」を壊し、D1 の往復中にクラッシュすると駆動する配備で行が武装されないまま残る。composition の提案（commit 経路を `armForStoredRows` へ）は、`spec/platform/index.md:202` の「Alarm を消す地点は turn の出口 1 か所に限る」という本 PR 自身の宣言と実装を初めて 1 対 1 にする。副作用は「最後の行が消えた commit の直後も古い alarm が残り、空 turn が 1 回走ってから turn の出口が消す」だけで、これは宣言どおりの経路である。turn の出口で消すのは既に配送済みの alarm なので、再試行を消す窓は構造的に消える。観測は `alarm.test.ts` に 1 ケース — publish を落として再試行を張ったあと、`scheduled_tasks` を触る `applyWriteSet` を成功させても `getAlarm()` が非 null のまま（＝再試行が消えない）こと。`spec/platform/index.md` は既に正しいので動かさない |
| `W-U02:ステージ像の完全性をどう担保するか` | **`RowMutation.upsert.row` と `RowsRead` の JSDoc に「その表を読む文が選ぶ列をすべて持つこと」を書く。実行時検査は入れない** | `readRows` がステージ像と比較できるのは `stored[0]` のキー集合だけで、射影を絞った読み（`noteRevisionRepository` の `KEY_SELECTION`）では stored 側が狭い。したがって検査は「ステージ像が読み文の射影を満たす」ことを検査できず、満たさない像を見逃したまま毎読みのコストだけが乗る。不変条件の持ち主は書き手（mutation を組む側）なので、契約は書き手側の JSDoc に置く。`LIMIT` の修復不能検査（`session.ts:173-180`）は「stored 側だけで判定できる」から実行時に置けたのであって、同じ形にはならない |
| `W-U04/W-R02:autocommit publish の非対称をどう倒すか` | **(a) を採る — autocommit 経路の scheduler は `scopeAlarmDrivesTasks()` が真なら `databaseError` で拒む。あわせて JSDoc の前提条件を明示する** | routing の提案 (c)（`createAutocommitSession.write` が touched tables を集め、`ScopeSqlExecutor` なら `applyWriteSet` を呼ぶ）は筋が良いが、`sql/session.ts` / `sql/executor.ts` / `do/scopeStub.ts` / `scopeTaskScheduler.ts` の依存（`db` / `logger`）／`di/cloudflareRuntime.ts` ／適合ハーネス `__tests__/ports/scopeInfra.ts` まで連鎖し、Blocker ゼロの収束ラウンドで開く範囲としては大きい。(b) の JSDoc だけでは「その時に気づける仕掛けが無い」という指摘そのものが残る。(a) はレジストリを読むだけの 3 行で、production（`registerScopeTaskHandler` の呼び出し 0 件）でも適合ハーネス（`__tests__/ports/scopeInfra.ts` / `lease.test.ts` はハンドラを登録しない。登録するのは `alarm.test.ts` だけで、そちらは `applyWriteSet` 経由で seed する）でも一切発火しないことを確認済み。object 駆動配備が autocommit で settle した瞬間に静かにドリフトする代わりに、その場で落ちる。構造的な移送 (c) は配備スライスの持ち分として `.thread/11/adr.md` に残す |
| `W-I03:有界削除をどこまで直すか` | **選択述語を各 `DELETE` へ持ち越す。1 行 1 文は維持する** | (1) の TOCTOU は memory が構造的に持たない乖離で、`refreshAuthEpoch` との競合は「現在の session が消えて強制サインアウト」という実害に届く。(2) の文数は別の軸 — 共通の規約が禁じているのは 1 文にバインド変数を件数ぶん並べること（上限 100）であり、1 文 1 変数の別々の文はその規約に触れない。`json_each` 1 文へ畳むと `remove()` が積むオーバーレイ（同一 UoW の read-your-writes）を捨てることになり、`SqlSession` が staged / autocommit の両方で同じリポジトリコードを走らせる契約の下では「今日の呼び出し形では読み戻さない」に正しさを寄りかからせる形になる。文数は `MAX_STATEMENTS_PER_COMMIT = 250` が既に見ている |
| `W-C03:タグ名重複の契約をどちらへ倒すか` | **ポート JSDoc から契約文を落とし、実装コメント（`projection/searchClauses.ts`）に残す** | ADR 026 は「契約の正本はポート定義とその JSDoc、その実行形が適合スイート」と定める。片側だけに契約文がある状態は AC-8 が禁じた非対称なので、スイートを足すか JSDoc から落とすかのどちらかしかない。本 PR は「適合スイート本体を変更しない」を通しており（#48 も同じ理由で起票へ回した）、両バックエンドが今日同じ答えを返す（memory は `every`、CF は `new Set(...).size`）ことを踏まえると、収束ラウンドで AC-8 の手続きを開く価値は無い。実装側の WHY は `tagFilterBindings` の JSDoc に現在形で残るので、次の実装者が「重複をどう扱うか」を再発明することもない。`spec/domains/note.md` は触らない |

### fix の観点別内訳

- UoW / 実行機構・SQL 土台: 3
- Identity / directory / operation: 4
- Routing / outbox / scope インフラ: 3
- Scope business / 投影・全文検索 / R2: 3
- 合成・スキーマ・テストハーネス・spec/docs: 4

合計 17（wont-fix 2 を除く）

## 修正の実行計画（Round 005）

束 1〜5 は担当ファイルが重ならないので並列委譲できる。束 6 は 1〜5 の完了後に直列で走らせる（spec / ADR の追随が束 1・束 3・束 5 の結論を材料にするため）。**各束は自分が決めた判断を作業メモに残し、`.thread/11/adr.md` への追記は束 6 がまとめて行う**（Round 001〜004 と同じ規律）。

### 束 1: 再試行 alarm の生存・autocommit publish の前提・constructor 再武装の観測

- 含む指摘: `review-005-uow.md` の W-001（≡ composition W-004）, W-004（≡ routing W-002）／ `review-005-routing.md` の W-003
- 触るファイル（4）:
  - `packages/core/src/adapters/cloudflare/do/scopeObject.ts`
  - `packages/core/src/adapters/cloudflare/do/repositories/scopeTaskScheduler.ts`
  - `packages/core/src/adapters/cloudflare/do/alarm.ts`（JSDoc のみ）
  - `packages/core/src/adapters/cloudflare/__tests__/alarm.test.ts`
- 修正方針:
  - `armAndPublishNow` を「後始末の種類」で分岐させる — `applyWriteSet` からの upkeep は `armForStoredRows`（消さない）、`alarm()` の `finally` からの upkeep は `rescheduleAlarm`（turn の出口）。`armAndPublish(scope, mode)` の 1 引数で足りる。publish 失敗時の `armNoLaterThan` は両方で従来どおり。JSDoc の「Arming first keeps the object's self-healing independent of D1」は残し、「commit 経路は決して消さない — 前回の publish 失敗が張った再試行を次の commit が消さないため」を足す。
  - autocommit の `publishDueIndex` は入口で `scopeAlarmDrivesTasks()` を見て、真なら `databaseError`（「object 駆動配備では scheduler を unit of work 越しに使うこと。この経路は arming を伴わないので継続が誰にも起こされない」）。`scopeTaskScheduler.ts:79-92` の「## Due index」節から「the central runner included」を落とし、autocommit の利用者を「UoW を開かずに scheduler を組み立てた呼び出し側（今日は適合ハーネスの `forScope` だけ）」へ言い換える。
  - `alarm.test.ts` に 2 ケース — (a) publish を落として再試行 alarm を張ったあと、`scheduled_tasks` を触る `applyWriteSet` を**成功**させても `armedAt(scope)` が非 null のまま、(b) `register(...)` してから `arm = false` の `seed` で行を置き、`rebuild(scope)` → 任意の読みで `armedAt(scope)` が `nextWakeAt` になること（`armForStoredRows` を no-op にすると赤くなる）。
  - canon 側（`spec/database/index.md:1110`）の言い換えは束 6 へ渡す。`spec/platform/index.md:202` は既に正しいので**動かさない**。

### 束 2: ステージ像の完全性を契約に書く

- 含む指摘: `review-005-uow.md` の W-002
- 触るファイル（2）:
  - `packages/core/src/adapters/cloudflare/execution/writeSet.ts`（`RowMutation.upsert.row` の JSDoc）
  - `packages/core/src/adapters/cloudflare/sql/session.ts`（`RowsRead` の JSDoc）
- 修正方針: `upsert` の `row` に「その表を読む文が選ぶ列をすべて持つこと。欠けた列は `readRows` の `matches` / `compare` で静かに誤動作する」を書く。`RowsRead` 側には「`matches` / `compare` はステージ像にだけ当たる」ことを現在形で 1 文。**実行時検査は入れない**（付随決定）。振る舞いは 1 ビットも変えない。

### 束 3: D1 identity の keyset・有界削除・テストの wipe

- 含む指摘: `review-005-identity.md` の W-001, W-003, W-004
- 触るファイル（4〜6）:
  - `packages/core/src/adapters/cloudflare/d1/repositories/identitySupport.ts`
  - `packages/core/src/adapters/cloudflare/d1/repositories/accountDeletionManifestStore.ts`
  - `packages/core/src/adapters/cloudflare/d1/repositories/globalMaintenanceRunStore.ts`
  - `packages/core/src/adapters/cloudflare/__tests__/globalConcurrency.test.ts`（＋同型の部分 wipe を持つ `idempotency.test.ts` / `lease.test.ts`）
- 修正方針:
  - cursor 節は述語ではなく**文の組み立て**で分ける — `cursor === null` なら節ごと落とし、非 NULL なら `AND key > ?`（複合 keyset の 2 か所も同じ形）。`identitySupport` の 1 か所が 5 表に効く。
  - 各 `DELETE` に `SELECT` と同じ述語を足す（`deleteExpiredPage` は `AND ${expiresColumn} <= ?`、`deleteBoundedByKey` は `AND ${where.sql}`）。`remove()` の積み上げと 1 行 1 文は維持する（付随決定）。
  - `beforeEach` を `executor.apply(GLOBAL_WIPE_STATEMENTS.map(statement))` へ置き換える。

### 束 4: 投影のフォーマッタ・R2 の digest・ハイライトの窓

- 含む指摘: `review-005-scope.md` の W-001, W-002, W-003
- 触るファイル（5）:
  - `packages/core/src/adapters/cloudflare/projection/viewerCalendar.ts`
  - `packages/core/src/adapters/cloudflare/do/repositories/localNoteQueryService.ts`（呼び出し側）
  - `packages/core/src/adapters/cloudflare/r2/objectStorage.ts`
  - `packages/core/src/adapters/cloudflare/search/highlight.ts`
  - `packages/core/src/adapters/cloudflare/__tests__/searchEdges.test.ts`（サロゲート境界の 1 ケース）
- 修正方針:
  - `wallClockOf` / `dayKeyOf` を「フォーマッタを受け取る」形にし、`countByDay` / `listMonthsWithNotes` が呼び出しごとに 1 回だけ作る。モジュールスコープのメモ化は採らない（利用者設定由来の文字列が鍵になるため）。
  - `sha256Of` は `crypto.subtle.digest("SHA-256", body)` へ直し、成立しない WHY のコメントを落とす。
  - `highlightBody` の `from` / `to` を最も近いクラスタ境界（`map.starts` / `map.ends`）へ丸める。サロゲートペアを跨ぐ本文で、返る断片が常に元テキストの部分文字列であることを固定するケースを 1 本。

### 束 5: タグ名重複の契約文を落とす

- 含む指摘: `review-005-composition.md` の W-003
- 触るファイル（2）:
  - `packages/core/src/domain/note/ports/localNoteQueryService.ts`
  - `packages/core/src/domain/note/ports/publicNoteQueryService.ts`
- 修正方針: `tagNames` の JSDoc から «a repeated name filters no differently from one» を落とす（`localNoteQueryService` は「AND match. Normalized (`TagName` rules) names.」へ、`publicNoteQueryService` は「Normalized names.」へ）。実装側の WHY は `projection/searchClauses.ts` の `tagFilterBindings` に既にあるので足さない。**適合スイート・`adapters/memory/`・`spec/domains/note.md` は 1 行も触らない**（AC-7 / AC-8）。

### 束 6: canon の追随（spec / ADR / 台帳）— 束 1〜5 の後に直列

- 含む指摘: `review-005-identity.md` の W-002 ／ `review-005-routing.md` の W-001, W-004 ／ `review-005-composition.md` の W-001, W-002, W-005 ／ 束 1〜5 が渡した canon 側の持ち分
- 触るファイル（5）:
  - `spec/database/index.md`
  - `spec/adr/056-performance-budget-placement.md`
  - `packages/core/src/adapters/cloudflare/do/schema.ts`（ヘッダーコメント）
  - `.thread/11/adr.md`
  - `.thread/11/review/triage-keys.md`
- 修正方針:
  - **期限索引（W-I02）**: `:309` / `:325` / `:341` / `:354` / `:697` を「掃引は表キー順の keyset で進み、`expires_at` は絞り込みの述語である。`(expires_at, key)` 索引は期限切れ集合への絞り込みに効く」の線へ改める。`(expires_at, key)` keyset へ寄せる側は採らない（`PrunePage` の cursor 意味論・memory・適合スイートが同時に動く）。
  - **autocommit publish の利用者（W-R01）**: `:1110` の「— 中央 runner の claim / settle —」を落とし、「UoW を開かずに scheduler を組み立てた呼び出し側（今日は適合ハーネスの `forScope` だけ）。object 駆動配備ではこの経路を拒む」へ。束 1 の (a) と 1 対 1 にする。
  - **スライスの並び順（W-R04）**: `:1112` を「優先度ごとに、次に取れる時刻（`pending` は `due_at`、`running` はリース失効時刻）の早い 25 行」へ。
  - **scope 検証（W-C01）**: `do/schema.ts:43-46` のコメントを 2 文に割る — 「scope 鍵として使う列（`notes.owner_type / owner_id` と `_scope_identity`）は復元・保存の両方で検査する」「`stored_files` / `storage_quotas` / `llm_usages` の帰属列は scope 鍵ではないので検査しない — 物理分離は `_scope_identity` の pin が担保する」。`spec/database/index.md`「共通の規約」への参照は残す。
  - **ADR 056（W-C02）**: コンテキストへ 1〜2 文 — 「D1 / DO 実装も 1 件ごとの `findById` で版トークンを採る契約から `4n + 3` 文になり、3 文の目標は実測を経て `spec/platform/index.md` 側で `commit 1 回` へ改めた」。決定文（3 つの決定）は動かさない。
  - **`.thread/11/adr.md`**: (i) ADR-025 の直後に「ADR-026 は欠番」の 1 行（W-C05） (ii) commit 経路は alarm を消さない（W-U01 の決定と、退けた「publish 先・reschedule 後」の理由） (iii) autocommit scheduler を object 駆動配備で拒む決定と、構造的な移送を配備スライスへ送った理由（W-U04） (iv) 有界削除は述語だけ持ち越し 1 行 1 文を維持した理由（W-I03） (v) タグ名重複の契約文を JSDoc から落とした判断（W-C03） (vi) publish 鎖に合流を入れない判断とトレードオフ（W-U03、wont-fix） (vii) `spec/inventory/frontend.md` の同期日を動かさない理由（W-C06、Round 004 継承）。
  - **`triage-keys.md`**: 本ラウンドの wont-fix 2 件を追記する。**新規の Issue 起票は無い**。

## Round 006

レビュー 5 本の指摘（Blocker 0 / Warning 8 = 8 件）。重複束ねは無し（同じ Key を 2 人が挙げたものは 0 件）。総数 **8 件**（fix 8 / wont-fix 0 / defer 0 / 要確認 0）。**Blocker は 0 件。**

Round 001〜005 の台帳と Key を突き合わせた結果、**既出の判定を継承したものは 0 件**（8 件すべて新規）。`readForUpdate` 事前読み・`findPending` の順序（#53）・`publicNoteQueryService` の並び順（#54）・`spec/inventory` の ADP 行（#52）・`DEFAULT_MAINTENANCE_TABLES`（#16）・`CLAUDE.md` の追随・`armAndPublish` の合流欠如は、いずれも再指摘されていない。

指摘の内訳は「canon と実装の乖離 3 件（W-R01 / W-R02 / W-I01）」「テストが主張どおりの性質を観測していない 4 件（W-U01 / W-U02 / W-U03 / W-C01）」「作業記録の参照追随 1 件（W-C02）」で、**振る舞いを変える修正は W-R02 の 1 件だけ**である。

判定の付随決定を 3 件（W-R01 の倒し方 / W-R02 の注入点 / W-I01 の DDL の扱い）、末尾の「付随決定」表に置く。

### UoW / 実行機構・SQL 土台

| Key | 指摘 | 判定 | 理由 | 再指摘 |
|---|---|---|---|---|
| `do/scopeObject.ts:turn 出口の publish 失敗 → 再武装が観測されていない` | `withPublishBroken` を使う 4 ケースはすべて commit 経路で、turn 経路で publish を壊したケースが無い（uow W-001） | fix | **コードで成立を確認した。** `armAndPublishNow` は `turnExit` で `rescheduleAlarm`（唯一の `deleteAlarm()` 地点）を先に通すので、続く publish が落ちたときに `catch` の `armNoLaterThan` が効かなければ、その scope は索引にも載らず alarm も持たない状態で固定される — `dueIndex.ts` の JSDoc と `spec/database/index.md` が「自然回復しない唯一の方向」と名指した状態そのもの。既存 4 ケース（`alarm.test.ts:531,567,599,629`）はすべて commit 経路で、`rescheduleAlarm` を publish の後ろへ動かす将来の変更をこのファイルは止められない。既存ヘルパー（`withPublishBroken` / `armedAt` / `indexedOf`）だけで 1 ケース書ける | 1 |
| `__tests__/unitOfWork.test.ts:391:_occ_guard が行を残さない主張が beforeEach の wipe で無条件に通る` | テスト名の「even after it has fired」は前のテストの出来事で、その効果は wipe で消えている（uow W-002） | fix | `GLOBAL_TABLES_TO_WIPE` が FTS5 以外の全 `GLOBAL_TABLES` を含み `_occ_guard` も毎テスト `DELETE FROM` されることを確認した。ケースは guard を一度も発火させずに 0 件を数えており、`occGuard()` の「実行されれば必ず `CHECK` に反する」が守られていない退行（sentinel を `SELECT 0` から `CHECK` に触れない値へ変える）を検出できない。同一テスト内で `bumpVersion` を 2 回撃って発火させてから数える形にすれば、テスト間順序にも依存しなくなる。**実測**: `occGuard` の `SELECT 0` を `SELECT 1` に変えると本ケースが赤くなる（変更前は緑のまま通る） | 1 |
| `__tests__/alarm.test.ts:765:drops the alarm once nothing is scheduled が一度も張らない alarm の null を見ている` | `applyWriteSet([], [SCHEDULED_TASKS_TABLE])` は 0 文で `apply` が即 return し、`armForStoredRows` も `nextWakeAt() === null` で何もしない（uow W-003） | fix | 事実関係を確認した。`user-empty` はこのファイル内で他に使われない新規 scope なので、`getAlarm()` が `null` なのは「消したから」ではなく「一度も張っていないから」で、アサーションは無条件に通る。加えて Round 005 の決定で commit 経路は**そもそも alarm を消さない**ので、テスト名が主張する性質はこの経路に存在しない。「最後の行が消えた commit は alarm を残し、続く 1 回の空 turn がそれを落とす」へ組み替えると、Round 005 の決定「副作用は空 turn が 1 回走るだけ」を固定する唯一のケースにもなる | 1 |

### Identity / directory / operation

| Key | 指摘 | 判定 | 理由 | 再指摘 |
|---|---|---|---|---|
| `spec/database/index.md:180,207+usecases/identity.md:827+testcases/identity/deleteAccount.md:70:pruneTerminal の keyset` | 実装は `operation_id` 単独 keyset（`retain_until <= asOf` は絞り込み）だが canon 4 か所は複合 keyset を約束したまま（identity W-001、AC-9） | fix（spec を実装へ倒す。DDL は動かさない） | 両バックエンドの実装（`accountDeletionManifestStore.ts:768-780` / `memory/repositories/accountDeletionManifestStore.ts:467-498`）が `ORDER BY operation_id` / `operation_id > cursor` で一致し、ポート JSDoc は cursor の中身を規定していないことを確認した。これは本 PR が新設した「有界な掃引 / 削除」の形そのもので、前進も冪等性も保たれる。canon 側は指摘の 4 か所に加えて `spec/platform/index.md:218` と `spec/inventory/test.md:245` にも同じ約束が残っており、**計 6 か所**を実態へ倒す。逆向き（実装を複合 keyset へ）は `PrunePage` 相当の cursor 意味論・memory・適合スイート（ADP-common-025）が同時に動き、AC-7 と「適合スイート本体を変更しない」の双方に触れる。**DDL の扱いは下記「付随決定」** | 1 |

### Routing / outbox / scope インフラ

| Key | 指摘 | 判定 | 理由 | 再指摘 |
|---|---|---|---|---|
| `d1/repositories/outboxRepository.ts:pruneProcessed が scope 平面で実行不能なのに canon が索引を正当化している` | `applyCounted` を持つのは `createD1Executor` だけなのに、spec は「plane を問わず撃つ」を現在形で書いている（routing W-001、AC-9） | fix（canon を将来形へ。実装は動かさない） | **コードで両方を確認した。** (1) `createScopeStubExecutor` / `createStorageExecutor` に `applyCounted` は無く、`createAutocommitSession.writeCounted` は無ければ `databaseError` を投げる（`sql/session.ts:132-138`）。(2) `pruneProcessed` を scope 平面から呼ぶ配線は**存在しない** — `createD1OutboxRepository` の呼び出しは production では `stageOutbox`（`save` のみ）と `createWorkerContainer`（global session）の 2 か所だけで、`pruneOutbox` は `WorkerContainer.outboxRepository` しか触らない。適合ハーネスの `ports/route.ts` も D1 session で組む。したがって今日壊れている経路は無く、canon の現在形（「plane を問わず撃つので両 plane に索引を置く」）だけが誤り。ADR-063 の「`refuseStaged` により global 平面からしか呼べない」も、`refuseStaged` が平面を弁別しない以上根拠として成立しない。**倒し方は下記「付随決定」** | 1 |
| `do/scopeObject.ts:leaseMs が SCOPE_TASK_LEASE_MS 定数の直読み` | AC-6 の決着が配備へ委ねた唯一のつまみを object 駆動配備だけ回せない（routing W-002、AC-6） | fix | **AC-6 に直結するので裏を取った。** ポート JSDoc（`scopeTaskScheduler.ts:139-151`）は「`leaseMs` は配備が選ぶ値で、最悪ケースの turn を超え、かつ age SLO を下回らねばならない」と書き、`spec/platform/index.md`「Scope Alarm」はその 2 つの境界が作る帯を定義している。中央 runner 側は `runDueScopeTasks` の `options.leaseMs` と `SCOPE_TASK_LEASE_MS` 環境変数（`di/env.ts:44`）で帯から選べるのに、`ScopeObject.alarm()` だけが定数を直読みしており、`ScopeObjectEnv` は `GLOBAL_DB` しか持たない。つまり **AC-6 の決着（fencing token を足さない）の安全性が依存している前提が、object 駆動配備では成立していない**。今日 production に object 駆動配備が無いのは事実だが、`spec/platform` の「駆動する配備は帯から選ぶ」は object 駆動を明示的に含む。**注入点は下記「付随決定」** | 1 |

### Scope business / 投影・全文検索 / R2

指摘 0 件。

### 合成・スキーマ・テストハーネス・spec/docs

| Key | 指摘 | 判定 | 理由 | 再指摘 |
|---|---|---|---|---|
| `adapters/__tests__/conformanceCoverage.test.ts:84-108:任意メンバーの脱落を検知できない` | `seedMembershipEdges` が落ちても 3 ケースが静かに skip されて緑のまま通る（composition W-001、AC-2 / AC-3） | fix | 事実関係を確認した。本テストが固定するのはスイート名の集合・factory の同定・全スイートの配線の 3 つで、ケース数は固定していない（ADR-043 の決定）。`seedMembershipEdges` は `ConformanceBackend` で任意（`backend.ts:133`）、スイートは `ctx.skip()` で 3 ケースを飛ばす（`accountDeletionManifestStore.ts:413,444,512`）。**なお指摘の「node 側 3 skip は memory が `seedMembershipEdges` を持たないため」は誤り** — memory も CF も実装しており（`memory/__tests__/conformanceBackend.ts:144` / `cloudflare/__tests__/conformanceBackend.ts:231`）、node の 3 skip は資格情報が無い `adapters/oauth` の実 API ケース。したがって今日の実害は無いが、**どちらのハーネスからメンバーが落ちても緑のまま通る**という穴は指摘のとおり成立する。塞ぐのは `backend.ts` から任意メンバーの集合を導いて両ハーネスに要求する検査（ADR-097）。ケース数を絶対値で固定する案は ADR-043 が決着済みなので採らない | 1 |
| `.thread/11/testing.md:37:存在しないファイルを名指ししている` | `__tests__/conformance.test.ts` は 7 ファイルへ分割済み（composition W-002） | fix | `packages/core/src/adapters/cloudflare/__tests__/conformance/` に `{identity,directory,route,scopeBusiness,scopeInfra,projection,unitOfWork}.test.ts` の 7 本があり、単一ファイルは存在しないことを確認した。分割の判断と代替手段は ADR-031 に記録済みなので、記録の欠落ではなく参照の追随漏れ。手順自体は動くが、期待結果を字義どおり照合すると空振りする。`plan.md` / `steps.md` は計画時点の記録なので動かさない | 1 |

### 付随決定

| Key | 判定 | 理由 |
|---|---|---|
| `W-R01:scope 平面の pruneProcessed をどちらへ倒すか` | **(b) を採る — 実装は動かさず canon を将来形へ倒す**（`spec/database/index.md` の索引正当化、ADR-063 の Consequences、`outboxRepository.ts` の class JSDoc の 3 か所） | (a)「`createStorageExecutor` に `applyCounted` を足し `ScopeObject` に RPC を 1 本生やす」は、scope 平面の relay / prune を配線するスライスが来るまで**呼び出し元が 0 件**のまま、`ScopeSqlExecutor` を組み立てる全地点（`do/scopeStub.ts`、テストの装飾 executor）に責務を増やす。ADR-063 が `applyCounted` を optional にしたのは「affected-row count はドライバの応答の性質であって seam の性質ではない」からで、利用者のいない実装を先に置くのはその判断を裏返す。契約と利用者が同じスライスで揃うほうが、配線側が何を一緒に足すべきかを 1 か所で読める。部分索引を両 plane に置く決定自体は動かさない（配線の順序に索引の有無を依存させない） |
| `W-R02:leaseMs をどこから注入するか` | **`ScopeObjectEnv` に任意の `SCOPE_TASK_LEASE_MS?: string` を足し、`alarm()` が turn ごとに読む。未設定は定数へフォールバック、不正値は `dataIntegrityError`** | Durable Object は DI コンテナから設定を受け取れず、構成が届く経路は constructor の env だけである（`di/cloudflareRuntime.ts` は object の**外**で組み立てられ、`ScopeUnitOfWorkProvider.run` のコールバックは RPC 境界を越えられない）。読みを `alarm()` に置いたのは、値が `this.env` に残るので turn ごとで足り、object の構築（＝ scope のデータ面すべて）を設定ミスで止めないため。**不正値で既定へ落とさない** — 黙って定数へ戻ると、配備が選んだ帯の外で turn が走っていることを誰も知らない。`application/di/env.ts` の `readScopeTaskTuning` を再利用する案は採らない（adapter が DI 配線を import して依存の向きが逆流する。規則自体は 2 行で、メッセージ文言は揃えてある） |
| `W-I01:DDL の terminal 索引をどう扱うか` | **`account_deletion_manifests_terminal_idx (retain_until, operation_id) WHERE status IN ('completed','rejected')` は動かさない。spec の索引欄を「絞り込みに使う（順序は「有界な掃引 / 削除」）」へ揃える** | この索引が与えるのは「terminal かつ保持期限を過ぎた集合」への絞り込みで、順序は与えない。同じ性質を持つ identity 系の期限索引（`sessions_expires_idx` / `auth_tokens` / `identity_removal_receipts` / `login_attempts` / `oauth_flow_states`）は本 PR が既にその言い回しへ揃えており、`account_deletion_manifests` だけが取り残されていた。索引を `(operation_id)` へ組み替える案は、terminal 行への絞り込みという本来の効き目を捨てて PK 索引の重複を作るだけになる |

### fix の観点別内訳

- UoW / 実行機構・SQL 土台: 3
- Identity / directory / operation: 1
- Routing / outbox / scope インフラ: 2
- Scope business / 投影・全文検索 / R2: 0
- 合成・スキーマ・テストハーネス・spec/docs: 2

合計 8（wont-fix / defer は 0 件）

## Round 007

レビュー 3 本の指摘（Blocker 0 / Warning 4）。uow W-001 と routing W-001 が同一 Key なので束ねて **3 件**（fix 3 / wont-fix 0 / defer 0 / 要確認 0）。**Blocker は 0 件。**

Round 001〜006 の台帳と Key を突き合わせた結果、**既出の判定を継承したものは 0 件**（3 件すべて新規）。`readForUpdate` 事前読み・`findPending` の順序（#53）・`publicNoteQueryService` の並び順（#54）・`spec/inventory` の ADP 行（#52）・`DEFAULT_MAINTENANCE_TABLES`（#16）・`CLAUDE.md` の追随・`armAndPublish` の合流欠如は、いずれも再指摘されていない。ADR-094（`leaseMs` の注入点）は Round 006 で決着済みで、W-01 はその決定の**観測**が無いことを指すので再審議には当たらない。

指摘の内訳は「テストが主張どおりの性質を観測していない 1 件（W-01）」「Phase 4 が実行する手順書と最終状態の食い違い 2 件（W-02 / W-03）」で、**本番コードの振る舞いを変える修正は 0 件**である。

`testing.md` は Phase 4 の動作検証がそのまま実行する成果物なので、W-02 / W-03 の 2 か所だけでなく**全 11 項目を最終状態と突き合わせて直した**（下記「testing.md の全面照合」）。

### UoW / 実行機構・SQL 土台

| Key | 指摘 | 判定 | 理由 | 再指摘 |
|---|---|---|---|---|
| `do/scopeObject.ts:leaseMsOf の不正値拒否と既定値フォールバックが観測されていない` | 3 分岐のうち有効値の分岐しかテストが無く、`Number(raw) \|\| SCOPE_TASK_LEASE_MS` へ戻しても全テストが緑（uow W-001 / routing W-001、AC-6） | fix | **実測で成立を確認した。** ADR-094 の決定と `spec/platform/index.md`「Scope Alarm」は「未設定なら既定値、正の整数のミリ秒でない値は turn を落とす — 黙って既定へ戻すと帯の外で turn が走っていることを誰も知らない」を canon にしており、fencing token を持たない settle の安全性はこの 1 関数に載っている。ところが観測点は `alarm.test.ts` の「grants the lease the deployment configured」（有効値 `"90000"`）1 件のみだった。`di/env.ts` の `leaseMsField` は別実装・別経路なのでこの穴を埋めない。既存ヘルパー（`withLeaseMs` / `rowsOf`）だけで 2 ケース書ける。**実測**: `leaseMsOf` を `Number(raw) \|\| SCOPE_TASK_LEASE_MS` の 1 行へ戻すと `refuses the turn and claims nothing when the configured lease is not a positive integer` が赤になる（`promise resolved "true" instead of rejecting`）。修正前は 22 ケース全緑 | 2 |

### Routing / outbox / scope インフラ

指摘 1 件は上の UoW 欄へ束ねた（同一 Key）。routing 固有の指摘は 0 件。

### Identity / directory / operation

指摘 0 件。

### Scope business / 投影・全文検索 / R2

休止（Round 006 で fix ゼロ）。

### 合成・スキーマ・テストハーネス・spec/docs

| Key | 指摘 | 判定 | 理由 | 再指摘 |
|---|---|---|---|---|
| `.thread/11/testing.md:確認項目 4 の確認ポイントが最終実測と矛盾する` | 「件数を変えても文数が変わらないこと（比例していないこと）」は `4n + 3` の実測と逆で、Phase 4 が偽の赤を出す（composition W-001、AC-5） | fix | **canon 側と突き合わせて確認した。** `spec/platform/index.md:153-155` は「書き込みはバッチ件数によらず 1 回の原子適用」を設計目標に置き、「1 turn の SQL 文の総数と読み側の RPC 往復は件数に比例する。実測は `4n + 3`」と明記している。`deleteFilesByOwner.test.ts` の 4 ケースも `commits` が常に 1、`reads` / `commitStatements` の差分が `2×30` で比例部分を分離する形になっており、比例しないのは commit の回数と outbox flush だけ。取り残されていたのは testing.md の確認ポイント 1 行と、旧目標（「3 文」）を引いていた目的の 1 行。両方を実測後の主張へ置き換える。`spec/testcases/storage/deleteFilesByOwner.md` の「件数に比例した往復を要求しない」は**ポート呼び出しの往復**の話で別の量なので動かさない（その旨も手順書に書き添える） | 1 |
| `.thread/11/testing.md:確認項目 6 の期待件数が実態と合わない` | 「既存 76 ファイル・978 件（適合スイートにケースを足した場合はその増分）」に対し実測は 77 ファイル・984 passed / 3 skipped で、増分は適合スイート由来ではない（composition W-002、AC-7） | fix | **`git diff origin/main...HEAD -- packages/core/src/adapters/conformance/` が空**であることを確認した。増分の出どころは (a) 新設の `packages/core/src/adapters/__tests__/conformanceCoverage.test.ts`（node プロジェクトへ +1 ファイル・+4 ケース）、(b) `application/workers/__tests__/scopeTaskRunner.test.ts` の +2 ケースで、括弧内の免責はこの差分を説明しない。3 skipped は資格情報の無い `adapters/oauth` の実 API ケースで変更前から skip されている。あわせて AC-7 の本体（memory / apps/web の差分ゼロ）を確認ポイントから期待結果側へ上げる | 1 |

### testing.md の全面照合（W-02 / W-03 の付随作業）

Phase 4 が読む手順書なので、指摘のあった 2 項目以外も最終状態と突き合わせた。直したのは次の 8 か所。

| 箇所 | 直した内容 |
|---|---|
| 検証環境の起動 | 「`--project workers` はステップ 1 完了前は存在しない」という計画時点の但し書きを落とし、`pnpm test:workers` / `pnpm test:node` の別名を併記 |
| 確認項目 1 期待結果 | 実測値（22 ファイル / 368 passed / 0 skipped）を明示。適合入口 7 ファイルの実ファイル名を列挙。`conformanceCoverage.test.ts` が node プロジェクト側であることを明記 |
| 確認項目 1 確認ポイント | 「出力に miniflare / workerd 由来の起動がある」は実際の出力に現れないので偽の赤になる。vitest の `\|workers\|` プロジェクト名と `harness.test.ts` の実バインディング観測ケースへ置き換え |
| 確認項目 2 | 「ケース数が一致する」→「**集合**が一致する。ケース数の絶対値は固定していない」（ADR-043 の決定と揃える）。適合スイート本体の差分ゼロを先に確認する手順を追加 |
| 確認項目 3 | 「unitOfWork / durability / alarm / r2 等」を実在するテストファイル 12 本の列挙に。(a)〜(d) にそれぞれ実在するケース名を添える |
| 確認項目 4 | W-02 の本体（目的・期待結果・確認ポイント） |
| 確認項目 5 | 「claim token を足した場合」の条件分岐を、実際の決着（運用で足りる／契約は無変更）を前提にした確認手順へ。明文化先 3 か所を実ファイルパスで名指しし、確認ポイントに新規 3 ケースの観測を足す |
| 確認項目 6 ＋ 既存機能への影響確認 | W-03 の本体。`pnpm test` の和（99 ファイル・1352 passed / 3 skipped）も明示 |

エッジケース 3 項目と確認項目 7 / 8 は、コマンド・ファイルパス・検証手段（api / browser）とも最終状態と一致していたので、ケース名の補強のみに留めた。**存在しないファイルパスの名指しは 0 件**（Round 006 の W-C02 で直った `conformance.test.ts` 以外に残っていない）。

### 付随決定

| Key | 判定 | 理由 |
|---|---|---|
| `W-01:不正値の分岐を何で観測するか` | **例外が飛ぶことだけでなく「1 行も claim されない」ことまで観測する**（`status = 'pending'` / `attempts = 0`）。値の分岐は `"0"` 1 種に絞る | 例外だけを見るケースは `leaseMsOf` を「不正なら既定値」へ緩める退行を止められる一方、`Number(raw) \|\| DEFAULT` へ戻す形（`"0"` が偽値なので既定へ落ちる）では**turn が成功して行を claim する**ところまで進む。claim の有無まで見て初めて 1 ケースで両方の退行を捕まえられる。文字列 `"abc"` / `"1.5"` / `"-1"` を並べる案は同じ 1 行を通るだけなので採らない |
| `W-01:失敗した turn が残す alarm の後始末` | **ケースの末尾で env を既定へ戻し `scheduled_tasks` を空にする** | `alarm()` の `finally` は turn が落ちても `armAndPublish("turnExit")` を通す（Round 004 / 005 で決着した「turn の出口だけが alarm を消せる」形）ので、過去日時で due な行が残ったままだと workerd が同じ失敗 turn を配送し続け、以降のケースへノイズが漏れる。行を消せば次の配送は空 turn として自分で alarm を落として終わる |

### fix の観点別内訳

- UoW / 実行機構・SQL 土台: 1（routing との重複 1 件を束ねた後）
- Identity / directory / operation: 0
- Routing / outbox / scope インフラ: 0
- Scope business / 投影・全文検索 / R2: 0（休止）
- 合成・スキーマ・テストハーネス・spec/docs: 2

合計 3（wont-fix / defer は 0 件、新規の Issue 起票も 0 件）

## Round 008（確認ラウンド）

指摘ゼロ。`fix` と仕分けた指摘は 0 件のため、レビューループは **APPROVED** で完了。

| 観点 | 状態 |
|---|---|
| UoW / 実行機構・SQL 土台 | Blocker 0 / Warning 0 |
| Routing / outbox / scope インフラ | Blocker 0 / Warning 0 |
| 合成・スキーマ・テストハーネス・spec/docs | Blocker 0 / Warning 0 |
| Identity / directory / operation | 休止（Round 007 で fix ゼロ） |
| Scope business / 投影・全文検索 / R2 | 休止（Round 006 で fix ゼロ） |

### fix の観点別内訳

すべて 0。
