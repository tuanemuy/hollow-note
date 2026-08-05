# テストケース: continueForcedTermination

強制終端が1回で終端しきれなかったぶんを、current scopeの `scheduled_tasks` / Alarmで引き受ける。網・追加の絞り込み・遷移は `origin.path` から導き、1回の上限は100件。別scopeのJobを同じtaskで扱わない。

| 前提条件 | 操作 | 期待結果 | 実装ステータス |
|---|---|---|---|
| 網が 100 件を返した | 処理する | 100 件を同一 UoW で終端させ、`finalizeTerminatedJobs` を同じ `ctx` で実行し、同じ UoW で `job.terminationContinued`（`origin` をそのまま写したもの）を 1 件だけ積む（境界値） | |
| 網がちょうど 99 件を返した | 処理する | 99 件を終端させ、継続要求は積まない（境界値。上限に達していないので続きはない） | |
| 網が 0 件を返した | 処理する | 何もせず成功として返る。**継続要求は積まず、メッセージも失敗させない**（対象が尽きた正常な終端であり、「進捗がなければ継続しない」の対象ではない） | |
| 対象が残っているのに 1 件も終端できなかった | 処理する | 継続要求を積まず、失敗として返る（キューの再試行と DLQ に委ねる。恒久的に失敗する 1 件が列の先頭に居座って継続が無限に回るのを防ぐ） | |
| 継続を積むとき | `origin` を確認する | 受け取った `origin` をそのまま写す（書き換えない）。カーソルを持たない継続であり、終端したジョブは `listActive*` の結果から外れるため同じ `origin` で引き直すだけで必ず前に進む | |

## 経路ごとの網と絞り込みの再現

| 前提条件 | 操作 | 期待結果 | 実装ステータス |
|---|---|---|---|
| `origin: { path: "removeMember", workspaceId, memberUserId }` | 処理する | current workspace scopeで `listActiveByRequester(memberUserId, 100)` を引く。他のメンバーと匿名ジョブには触れない | |
| 同上 | スコープだけで引いていないことを確認する | `origin` が `{ scopeType, scopeId }` だけだと、続きがワークスペースの全ジョブを取り消してしまう。`memberUserId` は payload が運ぶ | |
| `origin: { path: "leaveWorkspace", workspaceId, memberUserId }` | 処理する | `removeMember` と同じ網・同じ絞り込み・同じ遷移（脱退は除名と同じ後始末） | |
| `origin: { path: "deleteWorkspace", workspaceId, deletionOperationId }` | 処理する | owner一致を確認し、`listActiveByScope({ type: "workspace", workspaceId })` の**全件**を `Job.cancel` する | |
| `origin: { path: "changeMemberRole", workspaceId, memberUserId, nextRole: "viewer" }` | 処理する | `listActiveByRequesterAndKinds(memberUserId, disallowedKinds, 100)` が最終述語をDBで適用してからlimitする | |
| 対象外jobが先頭に100件以上ある | integration / role changeの継続を処理する | 対象外に遮られず、該当kindを最大100件処理する | |
| 同上 | `kind` の絞り込みの出どころを確認する | `nextRole` から [usecases/workspace.md](../../usecases/workspace.md) の kind → 要ロール表を引いて導く。継続要求に `kind` の並びを焼き付けない（焼き付けると表を変えたときに配送中のメッセージだけが古い規則で動く） | |
| `origin: { path: "changeMemberRole", …, nextRole: "viewer" }` で、対象が `bulkExport` の未終端ジョブを持つ | 処理する | `bulkExport` は viewer でも実行できるため取り消されない（1 巡目と同じ判定） | |
| `origin: { path: "trashNote", noteId, excludingJobId }` | 処理する | `listActiveByTarget({ type: "note", noteId })` を引き、`excludingJobId` に一致するものを除いて `Job.cancel` する。所有文脈の他のノートに対するジョブには触れない | |
| 同上（`excludingJobId` が非 `null`） | 除外を確認する | 継続の 2 巡目でも除外が効く。1 ノートの網なので実際には 100 件に達しないが、達しないことは規模の見積もりであって型の保証ではないため `origin` に含める | |
| `origin: { path: "disconnectIntegration", userId, provider: "openrouter" }` | 処理する | `listActiveByRequester(userId)` を `conversion` / `regeneration` に絞って `Job.cancel` する。`driveBackup` / `bulkBackup` には触れない | |
| 同上（`provider: "googleDrive"`） | 処理する | `driveBackup` / `bulkBackup` に絞られる | |
| `origin: { path: "integrationExpired", userId, provider }` | 処理する | 同じ網・同じ絞り込みだが、遷移は **`Job.fail("providerAuthFailed")`**（`Job.cancel` ではない） | |
| 同上 | 本文の回復理由を確認する | `cause.noteFailureReason` は `providerAuthFailed`。9 経路で唯一 `fail` を使う経路であり、遷移と理由を `path` から導くのはこの 1 経路のためである（`cause` だけを運ぶ形だと 2 巡目で `canceled` にすり替わる） | |

## deleteAccount の scope 分割

| 前提条件 | 操作 | 期待結果 | 実装ステータス |
|---|---|---|---|
| personal scope command | 処理する | `listActiveByScope({ type: "user", userId })` を100件ずつ引き、匿名PDF Jobを含めて終端する | |
| workspace scope command | 処理する | current workspaceの `listActiveByRequester(userId)` を100件ずつ引き、他メンバーのJobには触れない | |
| membership directoryに3 workspaceがある | account deletionを処理する | 3つのscope taskが独立に進み、互いのtransactionにJobを混ぜない | |
| 1 scopeで100件返る | 処理する | 同じscopeのcontinuation taskを保存し、Alarmを直後に再設定する | |

## 後始末・冪等性・競合

| 前提条件 | 操作 | 期待結果 | 実装ステータス |
|---|---|---|---|
| 終端させたジョブに `kind: "conversion"` があり、対象ノートが `processing` のまま | 処理する | `finalizeTerminatedJobs` の手順 1 により `Note.markConversionFailed` が同一 UoW で適用される。理由は `origin.path` から導いた `cause.noteFailureReason`（`integrationExpired` なら `providerAuthFailed`、それ以外は `canceled`） | |
| 終端させたのが `bulkExport` の batch 親で、成功済みの子が artifact を持つ | 処理する | `finalizeTerminatedJobs` の手順 2 により、`succeeded` の子の artifact が「保管ファイルの削除手順」で同一 UoW から破棄される（`cause.type` は `forced`） | |
| ジョブの終端と後始末 | トランザクションを確認する | 同一の `UnitOfWorkProvider.run` で行う。1 巡目と同じ保証であり、継続に分けたことで結果整合に落ちない | |
| 同じ継続要求を 2 回受け取る | 2 回処理する | 終端したジョブは `listActive*` の結果に現れないため、2 回目は残っているぶんだけを終端させる（冪等） | |
| 継続要求が重複配送され 2 系列が並走する | 処理する | 両系列とも「残っているものを引いて終端させる」だけなので結果は変わらず、網が 0 件になった系列から順に止まる | |
| 個々のジョブの保存が版で競合した | 処理する | そのジョブを飛ばして続ける。現在taskをAlarmで再試行して拾う | |
| `origin` が指すワークスペース・利用者・ノート・連携が、継続が届くまでに削除されていた | 処理する | 実体の存在確認は行わない。網は述語に一致する未終端ジョブを返すだけなので、対象があれば終端させ、なければ 0 件で正常終了する（存在確認を足すと、消えた実体のせいで残っているジョブを終端させずに打ち切ることになる） | |
| 継続が届く前に利用者が `failed` の親を `retryJob` で開き直そうとする | 操作する | 9 経路が batch 親に当てるのは必ず `Job.cancel` で、`canceled` の親は `Job.reopenBatch` の受理型（`SucceededJob \| FailedJob`）に入らないため開き直せない。継続が終端させたものが後から復活することはない | |
| 1 回の実行量 | 確認する | current scopeの最大100 Jobに固定され、CPU時間・local event fan-out・再試行量が有界である | |
| 列挙時に DB が落ちている | 処理する | `SystemError(DatabaseError)` が投げられる（再試行される） | |
