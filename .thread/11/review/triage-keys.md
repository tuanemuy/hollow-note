# 指摘台帳 — 薄いビュー（次ラウンドのレビュアーへ）

Round 001 / 002 / 003 / 004 で **wont-fix / defer / 要確認** と判定した指摘、および各ラウンドで決着させた付随判断。同じ内容を再指摘する場合は、判定を覆すべき新事実を添えること。
fix 判定の全件は `triage.md` を参照。

## wont-fix

| Key | 判定 | 理由 | Issue |
|---|---|---|---|
| `do/repositories/{storedFileRepository,noteRepository}.ts:readForUpdate 事前読み` | wont-fix | adr.md ADR-008 / ADR-013 / ADR-025 で決着済み。二段構え（ステージ時の読みで固有符号、guard は同時実行の砦）はこの PR の中核規律で、省くと版の不一致が呼び出し地点ではなく commit で現れる。最適化は ADR-002 が範囲外に置いた別作業 | — |
| `authTokenRepository:findPending の「最新の発行を返す」を契約化する` | wont-fix（Round 002） | adr.md ADR-039 が「複数 pending 時の戻り値は契約としては未定義の領域。memory を触らずに済む側（AC-7）を採る」と決着済みで、契約化を別 Issue と明記している。適合スイートへのケース追加と memory の振る舞い変更が同時に要り、AC-7 と「適合スイート本体は変更しない」の双方に抵触する。四者不整合そのものはポート JSDoc を「未定義」へ、spec を「D1 実装の選択」へ倒して閉じる | 未起票 |
| `CLAUDE.md:Adapters / Reference runtime / Development Commands の追随` | wont-fix（Round 003） | 指摘の事実関係は正しい（README / `docs/test.md` / `package.json` は改訂済みで CLAUDE.md だけが古い）が、**`CLAUDE.md` は本フェーズでは書き換えない方針**。coding agent への規範であり、採否はユーザーの判断に委ねる。提案文面（Adapters 節に `cloudflare/` を足す / Reference runtime 末尾を README と同文にする / Development Commands に `test:node` / `test:workers` を併記する）は完了報告でユーザーへ提示済み | — |

### wont-fix に準じる副論点

| Key | 扱い | 理由 |
|---|---|---|
| `globalMaintenanceRunStore:PRUNE_WORKER_ID がプロセス定数` | 誤指摘（親の指摘自体は fix） | `PRUNE_LEASE_OWNER = crypto.randomUUID()` は isolate ごとに異なるので「全 Worker が同一 owner を名乗る」は成立しない。`_occ_guard` 欠落の本体だけを直す |
| `routing B-003 の対案 (b)「createWorkerContainer から scopeTaskQueue を外す」` | 採らない | ADR-003 の due index はまさに中央 runner の `listDue` のために新設した表であり、ポート契約が `listDue` の実装を要求している。対案 (a)（空レジストリでは claim しない）側を採る |

## defer

| Key | 判定 | 理由 | Issue |
|---|---|---|---|
| `application/ports:1 operation = 何行かの契約統一` | defer | ポート JSDoc・memory 実装・適合スイートが同時に動く。memory の振る舞い変更は AC-7 に抵触し、本 Issue のスコープ（今日ポートがある 30 スイートの CF 実装）を越える | 未起票 |
| `di/runtime.ts:MemoryRuntime の AppRuntime 適合` | defer | 塞ぐには `memoryRuntime.ts` の型注釈書き換えが要り、Node 参照ランタイムの配線に手を入れる形になる（AC-7 の保守的な線）。次スライスの先頭で片付ける | 未起票 |
| `adapters/memory:暗号 / Intl アダプターの分離` | defer | plan.md「含まれないもの」が明示的にスコープ外と定め、ADR-030 が理由を述べている | 未起票 |
| `DEFAULT_MAINTENANCE_TABLES の単一正本化` | 部分 defer | 本 PR ではテストで一致を固定するに留める。正本統合は別ブランチ `issue/16/sweep-table-order-single-source` の持ち分 | #16 |
| `spec/inventory/adapter.md:5 ポートの ADP 行が 0 件` | defer（Round 002） | `ScopeTaskScheduler` / `ScopeTaskQueue` / `OutboxRepository` / `DistributedOperationStore` / `AppliedOperationStore` は台帳生成時点からの既存の穴で本 PR の作り込みではない。埋めるには 5 ポート ≒ 25 行を全バックエンド共通の採番規則で起こし memory 側の ADP 行とも整合させる必要があり、plan.md のスコープ（今日ポートがある 30 スイートの CF 実装）を越える | 未起票 |
| `publicNoteQueryService:public 検索の並び順が spec と食い違う` | defer（Round 003） | 実装は `ORDER BY note_id ASC` 固定で canon（`spec/domains/note.md:485` の `updatedAt DESC, noteId` / FTS 順位の RRF）と食い違うが、**本 PR の退行ではなく memory も同型**で、`PublicSearchCriteria` に sort が無いため現行ポートでは表現できない。倒すにはポート契約＋両バックエンド＋適合スイートが同時に動き、plan.md「含まれないもの」の「relevance 順の契約強化」を越える。canon を現状へ弱める案は採らない（RRF は物理 shard 化まで生きる設計意図）。理由は `.thread/11/adr.md` に記録 | 未起票 |

## 要確認（メイン判断待ち）

| Key | 判定 | 迷った理由 |
|---|---|---|
| `spec/adr/021-scope-sharded-data-plane.md:41 の「署名cursor」の扱い`（Round 002） | 要確認 | ADR-048 で cursor の「署名付き」契約を撤回した結果、canon 側 6 か所が旧い約束のまま残っている。そのうち `spec/adr/021` だけは在force の ADR 本文であり、(a) 当該語を直接直すか (b) ADR-048 を `spec/adr/063` へ昇格して 021 から参照を張るかで扱いが変わる。**(b) を推す** — `spec/adr/` は 062 止まりで Round 001 の束 7 が意図した昇格が未実行のままであり、(b) なら「決定がどこにも canon として着地していない」問題ごと閉じられる |
| `adapters/conformance/scopeTaskScheduler.ts:並行claimケース` | 決着済み（#48 へ起票） | 契約の穴を塞ぐ本筋だが適合スイート本体の変更にあたる。AC-8 / ADR 046 の手続き（memory も同じケースを通す）が要り、偽クロック下の並行ケースは不安定化リスクもある。CF アダプター側の occGuard 修正＋バックエンド固有テストだけでも Blocker 自体は閉じる |
| `d1/repositories/publicNoteProjection.ts:非public行のD1投影` | 決着済み（#47 へ起票） | spec/database と ADR 021 は「public かつ active の行だけ」と明記しており canon 違反だが、memory も同型。CF 側だけ直す（世代ベクトルの比較可能性をどう保つかが自明でない）か、canon を実装に合わせるかは正本レベルの判断 |

## 起票済み（Round 001）

| Key | 判定 | Issue |
|---|---|---|
| `publicNoteProjection:非public行のD1投影` | defer | #47 |
| `conformance/scopeTaskScheduler.ts:並行claimケース` | wont-fix | #48 |
| `identityUniqueDirectory:1 operation = 何行か` | defer | #49 |
| `adapters/memory:暗号 / Intl アダプターの分離` | defer | #50 |
| `di/memoryRuntime.ts:AppRuntime 適合の型固定` | defer | #51 |
| `DEFAULT_MAINTENANCE_TABLES:単一正本化` | 部分 defer | 既存 #16 |

## 起票が必要（Round 002・未起票）

| Key | 判定 | タイトル案 |
|---|---|---|
| `spec/inventory/adapter.md:5 ポートの ADP 行が 0 件` | defer | spec/inventory/adapter.md に ScopeTaskScheduler / ScopeTaskQueue / OutboxRepository / DistributedOperationStore / AppliedOperationStore の ADP 行を追加する |
| `authTokenRepository:findPending の順序を契約化する` | wont-fix（この PR では行わない） | AuthTokenRepository.findPendingByUserAndPurpose の「最新の発行を返す」を契約化する（適合スイート + memory） |

## 起票済み（Round 002）

| Key | 判定 | Issue |
|---|---|---|
| `spec/inventory/adapter.md:ADP 行欠落 5 ポート` | defer | #52 |
| `authTokenRepository:findPendingByUserAndPurpose の順序契約` | wont-fix | #53 |
| `spec/database/index.md:978 公開 workspace 一覧の署名 cursor` | wont-fix | ポート未実装のため範囲外（`spec/adr/063` の影響節に記録） |

## 起票が必要（Round 003・未起票）

| Key | 判定 | タイトル案 |
|---|---|---|
| `publicNoteQueryService:public 検索の並び順が spec と食い違う` | defer | 公開ノート検索の並び順を契約（`updatedAt DESC, noteId` / FTS 順位の RRF）に合わせる — ポートに sort を足し両バックエンドと適合スイートを同時に動かす |

## Round 003 で決着させた付随判断（再審議しないこと）

| Key | 決定 | 根拠 |
|---|---|---|
| `do/scopeObject.ts:due index の drift をどちらで治すか` | **publish 失敗時だけレジストリの有無に関わらず再試行 alarm を張る（案 a）** | (b) publish を write-set と同じ原子単位に入れるのは「D1 と scope DO を 1 transaction に含めない」規約に反する。(c) `listDue` 側で欠落を検出するには DO の全列挙が要り `spec/platform/index.md`「Global Cron」が禁じている。(a) はレジストリ空でも `alarm()` が `EMPTY_TURN` → `finally` の `armAndPublish` を通るので既存機構だけで閉じる |
| `adapters/__tests__/conformanceCoverage.test.ts:実引数を見ない` | fix（textual な識別子検査を 1 つ足す） | 今日は CF 側 7 ファイルすべてが `makeCloudflareConformanceBackend` を渡しており AC-3 は実際には満たされている。穴は「テスト名が主張する性質を観測していない」種類のもので、既存の textual 検査に 1 ケース足せば閉じる |

## 起票済み（Round 003）

| Key | 判定 | Issue |
|---|---|---|
| `publicNoteQueryService:公開検索の並び順が canon と食い違う` | defer | #54 |
| `CLAUDE.md:CF アダプター追加後の追随` | wont-fix（完了報告でユーザーに提案） | — |

## Round 004 で決着させた付随判断（再審議しないこと）

| Key | 決定 | 根拠 |
|---|---|---|
| `do/scopeObject.ts:constructor が再試行 alarm を消す` | **constructor は alarm を「張るだけ」にし、決して消さない**（`scopeAlarmDrivesTasks()` が真のときだけ `nextWakeAt` を読んで `armNoLaterThan`、偽なら何もしない） | 案 (a)「constructor で due index と自分のスライスを突き合わせる」は `spec/platform/index.md`「外部要求」の「`blockConcurrencyWhile` の中で external I/O を待たない」に反する。案 (b)「再試行の意思を DO storage へ永続化」は、alarm 自体が既に DO の耐久状態で、消していたのは自分のコードだけなので二重に持つだけ（schema と `spec/database/index.md` の追随まで連れてくる）。採った形は cold start で成立し、駆動する配備が残置行を拾う役目も `armNoLaterThan(nextWakeAt)` で保たれる |
| `do/scopeObject.ts:armAndPublish の並行 publish` | **object インスタンス内で `armAndPublish` を直列化する**（`private publishing: Promise<void>` の鎖。読みも鎖の中） | スライスは全置換なので順序さえ保てば最後の publish が正しい。世代列を足す案は `scope_task_due_index` の schema と AC-9 の追随、D1 側の条件付き削除まで連れてくる。production の合成では autocommit publish が no-op なので、object 内の直列化で writer は 1 本に揃う |
| `d1/repositories/{accountDeletionManifestStore,distributedOperationStore}.ts:guard 敗北再読みの到達範囲` | **コードは消さない／staged へ通す仕掛けも入れない。到達範囲を ADR-073 の Consequences とテストの JSDoc に書く** | `SqlSession` の契約は「同じリポジトリコードが staged と autocommit の両方で走る」で、`ConformanceBackend` は両方の形でポートを呼ぶ。消せば ADR-073 が閉じた乖離が autocommit の形で再び開く。staged 経路で到達させるには UoW commit がどの mutation が guard だったかをポートへ返す仕掛けが要り ADR-001 の範囲を越える（別 Issue） |
| `domain/note/ports/publicNoteProjectionWriter.ts:removeForPurge の ack 契約` | **契約を実態へ倒す（JSDoc から acknowledgement の語を落とす）。memory の `publicPurgeAcks` は動かさない** | ack を読む者が両バックエンドにも適合スイートにもいないので、ADR 046 の「正本のある側」は end state での冪等性の側。実装を契約へ寄せる案は読み手のいない表を 2 つ目のバックエンドにも作り、適合スイートへケースを足す（AC-8）。memory の表除去は AC-7 のため本 PR では行わず起票へ |
| `spec/platform/index.md:197:fencing 決着文の直し方` | **driver で場合分けして書き直し、参照先を `spec/database/index.md` の `scheduled_tasks` / `scope_task_due_index` 節へ差し替える** | 中央 runner 配備では due index が全 scope 共有なので「起動が分かれても writer は分かれない」。`spec/domains/index.md` に `ScopeTaskScheduler` 節を起こす案は #52（ADP 行欠落）の受け皿と重なるので本 PR では採らない |

## 起票が必要（Round 004・未起票）

| Key | 判定 | タイトル案 |
|---|---|---|
| `execution/globalUnitOfWork.ts:staged 敗北の guard 翻訳をポート契約の答えへ返す` | defer | UoW commit で敗れた `_occ_guard` を、その mutation を出したポートの読み経路の答えへ翻訳して返す |
| `adapters/memory:publicPurgeAcks の死んだ表を落とす` | defer | `PublicNoteProjectionWriter.removeForPurge` の ack 契約撤回に合わせ、memory の `publicPurgeAcks` 表を落とす |

## 起票済み（Round 004）

| Key | 判定 | Issue |
|---|---|---|
| `execution/writeSet.ts:staged 経路の guard 敗北翻訳` | defer | #55 |
| `adapters/memory:publicPurgeAcks の死んだ表` | defer（AC-7 のため本 PR では触らない） | #56 |
