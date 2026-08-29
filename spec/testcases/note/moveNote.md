# テストケース: moveNote

| 前提条件 | 操作 | 期待結果 | 実装ステータス |
|---|---|---|---|
| 個人ノート、移動先ワークスペースの editor | ワークスペースへ移動する | 所有者が変わり、`note.moved` が旧所有者つきで発行される | |
| ワークスペースのノート、そこの editor | 個人へ移動する | 所有者が変わる | |
| 移動先ワークスペースの viewer | 移動する | `BusinessRuleError(InsufficientRole)` が投げられる | |
| 移動元で編集権限がない | 移動する | `NotFoundError("NOTE_NOT_FOUND")` が投げられる（権限不足は存在秘匿に統一する） | |
| 移動先ワークスペースが存在しない（削除済みを含む） | 移動する | `WorkspaceRepository.findById` の実在確認で `NotFoundError("WORKSPACE_NOT_FOUND")` が投げられる（移動先は要求者が選んだ先であり隠す対象ではないため、移動元の権限不足の `NOTE_NOT_FOUND` とは分ける） | |
| 変換処理中のノート | 移動する | `BusinessRuleError(CannotMoveWhileProcessing)` が投げられる | |
| 同じ所有者を指定する | 移動する | 変更もイベントも起きず成功する | |
| 限定公開のノート | 移動する | 共有リンクの URL は変わらず、引き続き到達できる | |
| 移動元にのみ存在するタグが付いている | 移動する | `droppedTagNames` にそのタグ名が含まれ、付与が外れる | |
| 移動先に同名のタグがある | 移動する | そのタグに付け替えられる | |
| 元ファイルとメディアを持つノート | 移動する | 保管ファイルの所有者も移動先に移り、使用量が付け替わる | |
| 移動が成功した | snapshotを確認する | Note・Revision・Tag assignment・StoredFile metadata・Backup・Usage deltaを1つのmigration snapshotとしてtarget scopeへ取り込み、target local projectionも同じscopeで作る | |
| 移動先の使用量が既に容量クォータを超えている | 移動する | 移動は成功する（移動時に容量クォータを検査しないのは意図的な設計。クォータの強制は取り込み時のみ） | |
| 移動によって移動先がクォータを超える | 移動する | 移動は成功し、以後の新規アップロードが拒否されるだけになる（サガは消費量を付け替えるが判定はしない） | |
| 移動先にクォータの行がまだない | 移動する | 初期値を作ってから加算する | |
| 移動の確定時点で移動元のワークスペースから除名されていた | 移動する | `NotFoundError("NOTE_NOT_FOUND")` が投げられる（`ensureMovable` の `AccessDenied` には到達しない） | |
| 移動の確定時点で移動先のワークスペースから除名されていた | 移動する | `BusinessRuleError(InsufficientRole)` が投げられる | |
| 事前確認後・source freeze前に移動元Membership versionが変わる | freezeする | actorと期待Membership versionをlocal transactionで再検査し、移動を中止する | |
| target stage後にactorの除名・降格を試みる | 変更する | target authorization lockと競合して拒否され、activateまたはabort後に解放される | |
| ワークスペースのノートを個人へ移動した | ワークスペースの他メンバーが開く | 「見つかりません」が返る | |
| 他者が先に更新した | 古い `expectedVersion` で移動する | `ConflictError("OPTIMISTIC_LOCK_FAILURE")` が投げられる | |
| sourceをfreezeした直後に失敗する | 同じmigration IDで再開する | source snapshotを再利用し、重複したtarget Noteを作らない | |
| target staging後に失敗する | recoveryを実行する | routeはsourceのままで利用者には旧scopeだけが見え、staged targetは直接読めない | |
| targetCredit後・route switch前に再認可失敗 | abortする | creditを逆仕訳し、stage/lockを削除、sourceをthawしてrouteをactive sourceへ戻す | |
| abortMoveの応答を失う | recoveryする | 同じmigration IDで各rollbackを再適用し、二重debit/creditなしでactive sourceへ戻る | |
| target stage後にworkspace削除を試みる | 削除する | `WORKSPACE_MOVE_IN_PROGRESS`で拒否され、activate/abort後に再試行できる | |
| route switch後に失敗する | recoveryする | abortせずtarget activate・source retire・sourceDebitへ前進する | |
| target credit後・route switch前に長時間停止する | sourceでuploadする | source quotaはまだ減算されておらず空きを過大に見積もらない。中間状態は二重計上側になる | |
| route switch後・source debit前に停止する | recoveryを実行する | targetがactiveでsourceは過剰計上のまま。source debitを冪等に再試行する | |
| route switchの応答を失う | 再開する | D1のmigration IDとrouteVersionを読み、切替済みならactivateへ進む。二重switchしない | |
| route切替後・source tombstone前 | noteを読む | current routeからtargetへ到達する。sourceへの遅延writeはfreeze/version不一致で拒否される | |
| move前のpublic projection eventが遅延 | 処理する | routeVersionが古いためtarget ownerのpublic行を上書きしない | |
| source cleanupが失敗する | recoveryを実行する | routeはtargetを維持し、source tombstoneだけを再試行する。利用者向け所属をsourceへ戻さない | |
| 事前確認とclaimの間にノートが別のscopeへ移った | 移動する | claimせず `ConflictError("STALE_SCOPE_ROUTE")` が返り、誰も使わない `moving` を残さない | |
| route切替の応答だけを失い、プロセスは生きている | abortが走る | routeのCASが拒否するので何も補償せず停止する。targetのNote・Revision・staged file metadata・creditはどれも消えない | |
| 同じワークスペースの別のeditorが、失敗した移動と同じ移動を要求する | 移動する | 走行中operationに合流せず、そのメンバー自身のMembershipで認可される（`requestKey` がactorを含むため） | |
| 前の試行のstagingがreceiptで飛ばされ、その間にsourceへファイルが増えた | 同じmigration IDで再開する | retireするのはtargetが実際に受け取った集合だけで、増えた metadata はsourceに残る | |
| 前の試行がstagingを残しており、再開した試行がrouteのclaimに失敗する | 同じmigration IDで再開する | routeをactive sourceへ戻すだけでなく、前の試行のstaged複製・credit・両scopeのmove lockも同じ補償で戻す（恒久的に残るlockを作らない） | |
| 前の試行のstagingがreceiptで飛ばされ、その間にsourceのノートが編集された | 同じmigration IDで再開する | staged複製が今回freezeした版へ引き上げられ、switch後にsourceのNoteとRevisionを消しても編集が失われない | |
| 前の試行のstagingがreceiptで飛ばされ、その間にsourceのRevisionだけが増えた（Noteの版は動かない） | 同じmigration IDで再開する | staged複製のRevisionも今回のsnapshotへ同期され、switch後にsourceのRevisionを消しても失われない | |
| routeを手放した後、同じtarget scopeを別のmigrationがstageした | 中止する | 自分のstaged importのreceiptが立っていないので何も解体せず、別migrationの複製・credit・file metadataを残したまま両scopeのlockだけ返す | |
| 中止のthawが返したrouteを別のmigrationが既にclaimしている | 中止する | routeがsourceの同じ世代を指す限り補償は走り、この migration 自身のstaged複製・credit・lockが戻る（掴んだ相手を理由に降りない） | |
| switchがcommitして応答だけを失い、その後rollbackが走る | 中止する | 何も補償せず停止し、operationは `running` のまま終端しない（両scopeのmove lockを解放できる主体が残る） | |
