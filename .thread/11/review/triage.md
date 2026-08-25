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
