# テストケース: requestBulkExport

| 前提条件 | 操作 | 期待結果 | 実装ステータス |
|---|---|---|---|
| 閲覧できるノートが 10 件 | 一括ダウンロードを要求する | 親ジョブと 10 件の子ジョブが作られる | |
| 501 件を指定する | 要求する | `ValidationError("TOO_MANY_TARGETS")` が投げられる | |
| 500 件を指定する | 要求する | 成功する（境界値） | |
| 本文が空のノートを含む | 要求する | それらは除外され、`skipped` に `{ noteId, reason: "contentNotReady" }` として積まれる | |
| 閲覧権限のないノートを含む | 要求する | それらは除外され、`skipped` に `{ noteId, reason: "permissionDenied" }` として積まれる | |
| 存在しない `noteId` を含む | 要求する | `listByIds` の結果に現れないその ID は `skipped` に `{ noteId, reason: "notFound" }` として積まれる（入力の `noteIds` と結果を突き合わせる。省くと存在しない ID が無言で落ちる） | |
| 存在しない `noteId` だけを指定する | 要求する | 対象が 0 件になり `ValidationError("NO_EXPORTABLE_TARGET")` が投げられる。`skipped` にはすべての ID が `reason: "notFound"` として載る（「どれが無かったのか」が返る） | |
| 存在しない ID・権限のない ID・本文が空の ID を混ぜて指定する | 要求する | `skipped` に 3 種類の `reason` がそれぞれ対応する `noteId` とともに積まれ、残りだけが対象になる | |
| すべて本文が空 | 要求する | `ValidationError("NO_EXPORTABLE_TARGET")` が投げられる | |
| 閲覧権限のないノートを含む | 要求する | それらは除外される | |
| `skipped` の `reason` の語彙 | `requestBulkNoteOperation` / `requestBackup` と比べる | 語彙は経路ごとに固有だが、「対象が引けなかった」という同じ事象には 3 経路とも同じ `notFound` を使う | |
| 合計サイズの見積もりが 1 GB を超える | 要求する | `ValidationError("EXPORT_TOO_LARGE")` が投げられる | |
| 一括ダウンロードが既に実行中 | 要求する | `BusinessRuleError(BulkExportInProgress)` が投げられる | |
| — | 要求後にジョブの `payload` を確認する | `{ kind: "bulkExport", format }` が親子で同じ値として保存されている | |
| 個人所有のノートだけを要求した | 親ジョブの `scope` を確認する | 対象ノートの所有文脈から `{ type: "user", userId: owner.userId }` が入る | |
| 参加ワークスペース所有のノートだけを要求した（要求者は owner ではないメンバー） | 親ジョブの `scope` を確認する | `{ type: "workspace", workspaceId }` が入る（要求者からは導かない） | |
| — | 親ジョブと子ジョブの `scope` を比べる | 親子で一致する | |
| 個人所有のノートとワークスペース所有のノートを混ぜて要求する | 要求する | `ValidationError("MIXED_OWNER_SCOPE")` が投げられ、親も子も 1 件も作られない（全体中止） | |
| 指定時は混在しているが、権限・本文の絞り込みのあとに残る所有文脈が 1 つになる | 要求する | 判定は絞り込みのあとに行うため成功し、残った文脈が `scope` になる | |
| 混在で全体が中止された | ジョブ一覧を確認する | 子ジョブが部分的に残らない | |
