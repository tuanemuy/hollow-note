# テストケース: requestBackup

| 前提条件 | 操作 | 期待結果 | 実装ステータス |
|---|---|---|---|
| Drive 連携済み、元ファイルのあるノート 1 件 | 要求する | 単体のバックアップジョブが登録される | |
| 元ファイルのあるノート 5 件 | 要求する | 親ジョブと 5 件の子ジョブが登録される | |
| 元ファイルのないノートを含む | 要求する | それらは対象から外れ、`skipped` に `{ noteId, reason: "noSourceFile" }` として積まれる | |
| 存在しない `noteId` を含む | 要求する | `listByIds` の結果に現れないその ID は `skipped` に `{ noteId, reason: "notFound" }` として積まれる（入力の `noteIds` と結果を突き合わせる。省くと存在しない ID が無言で落ちる） | |
| 存在しない `noteId` だけを指定する | 要求する | 対象が 0 件になり `ValidationError("NO_BACKUPABLE_TARGET")` が投げられる。`skipped` にはすべての ID が `reason: "notFound"` として載る | |
| 存在しない ID・編集権限のない ID・元ファイルのない ID を混ぜて指定する | 要求する | `skipped` に `notFound` / `permissionDenied` / `noSourceFile` がそれぞれ対応する `noteId` とともに積まれ、残りだけが対象になる | |
| ワークスペースの viewer が自分の参加ワークスペースのノートを指定する | 要求する | `NoteAccessPolicy.canEdit` が偽のため対象から外れ、`skipped` に `{ noteId, reason: "permissionDenied" }` として積まれる（バックアップは `downloadNote` ではなく `editNote` を要する。`runBackup` が `BackupRecord` を書き、既存記録の所有者を付け替えるため） | |
| ワークスペースの viewer が指定したノートしかない | 要求する | 対象が 0 件になり `ValidationError("NO_BACKUPABLE_TARGET")` が投げられる（`skipped` にはすべての ID と理由が載る） | |
| ワークスペースの editor が同じノートを指定する | 要求する | 対象になり、ジョブが登録される | |
| 個人所有のノートを本人が指定する | 要求する | `canEdit` が真のため対象になる（個人所有ではロールの概念がなく所有者が編集できる） | |
| `skipped` の形 | `requestBulkNoteOperation` / `requestBulkExport` と比べる | 3 経路とも `{ noteId, reason }[]` で揃っている（どれがなぜ外れたかを画面が案内できる） | |
| `skipped` の `reason` の語彙 | 同じく 3 経路を比べる | 語彙は経路ごとに固有（`noSourceFile` は本経路にしかない）だが、「対象が引けなかった」という同じ事象には 3 経路とも同じ `notFound` を使う | |
| すべて元ファイルがない | 要求する | `ValidationError("NO_BACKUPABLE_TARGET")` が投げられる | |
| 未連携 | 要求する | `NotFoundError("CONNECTION_NOT_FOUND")` が投げられる | |
| 同じノートのバックアップが実行中 | 要求する | `BusinessRuleError(DuplicateJob)` が投げられる | |
| 編集権限のないノートを含む | 要求する | それらは対象から外れる | |
| 連携が失効している | 要求する | ジョブは登録され、実行時に失敗する | |
| 対象 1 件 | 登録されたジョブの `kind` / `payload` / `target` を確認する | `kind: "driveBackup"`、`payload: { kind: "driveBackup" }`、`target: { type: "storedFile", fileId }`、`parentId: null` になる | |
| 対象 5 件 | 登録された親子の `kind` / `payload` を確認する | 親子とも `kind: "bulkBackup"`、`payload: { kind: "bulkBackup" }` になる（単体と一括で `kind` が変わる非対称。実行体はどちらも `runBackup`） | |
| 個人所有のノートの元ファイルだけを要求した | ジョブの `scope` を確認する | 対象ファイルの `StorageOwner`（＝取り込み先ノートの所有文脈）から `{ type: "user", userId }` が入る | |
| 参加ワークスペース所有のノートの元ファイルだけを要求した（要求者は owner ではないメンバー） | ジョブの `scope` を確認する | `{ type: "workspace", workspaceId }` が入る（要求者からは導かない） | |
| 複数件で親子が作られた | 親ジョブと子ジョブの `scope` を比べる | 親子で一致する | |
| source scope と異なるノートIDを混ぜて要求する | 要求する | 異なるIDは存在を漏らさず `notFound` でskipされ、指定scope以外のDOは呼ばれない | |
| 指定時は混在しているが、権限・元ファイルの絞り込みのあとに残る所有文脈が 1 つになる | 要求する | 判定は絞り込みのあとに行うため成功する | |
| 入力source scopeと異なるNoteIdを混ぜる | 要求する | route一括検証で`notFound`にし、指定scope DOだけを呼ぶ | |
