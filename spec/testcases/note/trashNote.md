# テストケース: trashNote

| 前提条件 | 操作 | 期待結果 | 実装ステータス |
|---|---|---|---|
| 削除権限のあるノート | ゴミ箱に入れる | `lifecycle: "trashed"` になり、`purgeAfter` が 30 日後になる | |
| 公開ノート | ゴミ箱に入れる | 公開 URL が「見つかりません」になる | |
| 限定公開のノート | ゴミ箱に入れる | 共有リンクが「見つかりません」になる | |
| 変換処理中のノート | ゴミ箱に入れる | 実行中のジョブがキャンセルされてから削除される | |
| `excludingJobId: null`（画面からの呼び出し） | ゴミ箱に入れる | `listActiveByTarget` を `limit: 100` で引き、返った未終端ジョブがすべて `Job.cancel` される（除外すべきジョブが存在しないため） | |
| 網が 100 件を返した | ゴミ箱に入れる | 同じ UoW で継続要求 `job.terminationContinued { origin: { path: "trashNote", noteId, excludingJobId } }` を積む。1 ノートの網なので実際には達しないが、達しないことは規模の見積もりであって型の保証ではないため、規則は経路ごとに省かない | |
| 継続要求の `origin` | 内容を確認する | `excludingJobId` を必ず運ぶ。落とすと 2 巡目で除外規約（「共通: ユースケースを合成するときの副作用の範囲」）が黙って外れ、`runBulkNoteOperationItem` が自分自身を取り消す | |
| `excludingJobId` に一括操作の子ジョブの ID を渡す（`runBulkNoteOperationItem` からの呼び出し） | ゴミ箱に入れる | 一致する 1 件だけが強制終端から外れ、同じノートを対象とする他のジョブ（変換・再生成・PDF 書き出し・別の一括操作の子）は通常どおり取り消される（取り消すべき理由は呼び出し経路によらない。「共通: ユースケースを合成するときの副作用の範囲」） | |
| `excludingJobId` に、そのノートを対象としないジョブの ID を渡す | ゴミ箱に入れる | 除外は起きず、`listActiveByTarget` が返したジョブがすべて取り消される（除外は ID の一致する 1 件だけに効く） | |
| 本文が `processing` のまま変換ジョブを強制終端した | ゴミ箱に入れる | 「共通: 強制終端の後始末」に従い `Note.markConversionFailed("canceled")` が適用され、本文が `failed(canceled)` になる（`restoreNote` で戻したときに `processing` のまま固定されない） | |
| 同上 | 適用順を確認する | `Note.markConversionFailed` を `Note.trash` より**先に**適用する（`markConversionFailed` は `ActiveNote` しか受け取らない）。ジョブの取り消し・本文の回復・ゴミ箱への移動はすべて同一 UoW で保存される | |
| 実行中のジョブが `kind: "regeneration"` | ゴミ箱に入れる | ジョブは取り消されるが本文は `ready` のまま変更されない（後始末の本文回復は `conversion` のみ） | |
| 取り消したジョブ | 破棄された生成物を確認する | 回収の対象は空になる。「共通: 強制終端の後始末」の 2 が回収するのは batch 親の**既に成功した子**の artifact だけで、`listActiveByTarget({ type: "note", noteId })` が返すのは未終端かつ `target.type === "note"` のジョブ（＝ batch 親ではない）に限られるためである | |
| そのノートに対する匿名の PDF 書き出しジョブが実行中 | ゴミ箱に入れる | `listActiveByTarget` は要求者を問わないため匿名ジョブも取り消される（ADR 010）。未終端なので artifact はまだ存在せず、回収するものはない | |
| そのノートの成功済みの PDF 書き出し（匿名を含む）の artifact が期限内に残っている | ゴミ箱に入れる | 終端させる集合が未終端のジョブだけであるため破棄されず、期限（`expiresAt`）の経過による `collectExpiredArtifacts` の自動回収に委ねられる | |
| ゴミ箱に入れた | 応答の `version` を確認する | 移動後の版が返り、追加の読み取りなしにそのまま `restoreNote` の `expectedVersion` に使える | |
| 本文の回復（`markConversionFailed`）が同じ transaction に入った | 応答の `version` を確認する | 2 つ進んだ版が返る。送った版から数えて当てると `ConflictError("OPTIMISTIC_LOCK_FAILURE")` になる | |
| 既にゴミ箱にある | 再度ゴミ箱に入れる | 変更なしで成功する（応答の `version` は現在の版） | |
| viewer である | ゴミ箱に入れる | `NotFoundError("NOTE_NOT_FOUND")` が投げられる | |
| ゴミ箱に入れた後 | 一覧を開く | そのノートは一覧に現れない | |
| ゴミ箱に入れた後 | ゴミ箱を開く | そのノートが現れる | |
| 他者が先に更新した | 古い `expectedVersion` で削除する | `ConflictError("OPTIMISTIC_LOCK_FAILURE")` が投げられる | |
| 保持期限の違うノートが複数ゴミ箱にある | ゴミ箱に入れる | scope の保持期限アラームが最も早い `purgeAfter` に張り替わる（手順 5） |  |
