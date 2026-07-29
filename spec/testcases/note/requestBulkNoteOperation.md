# テストケース: requestBulkNoteOperation

| 前提条件 | 操作 | 期待結果 | 実装ステータス |
|---|---|---|---|
| 編集できるノートが 20 件 | タグ追加（`addTag`）を要求する | 親ジョブと 20 件の子ジョブが作られる | |
| 編集できるノートが 20 件 | タグ削除（`removeTag`）を要求する | 親ジョブと 20 件の子ジョブが作られる | |
| 削除権限のあるノートが 20 件 | ゴミ箱への移動（`trash`）を要求する | 親ジョブと 20 件の子ジョブが作られる | |
| 削除権限のないノートが混ざる | `trash` を要求する | それらは `skipped` に積まれ、他は登録される | |
| 501 件を指定する | 要求する | `ValidationError("TOO_MANY_TARGETS")` が投げられる | |
| 500 件を指定する | 要求する | 成功する（境界値） | |
| 権限のないノートが混ざる | 要求する | それらは `skipped` に積まれ、他は登録される | |
| すべて権限がない | 要求する | `BusinessRuleError(AccessDenied)` が投げられる | |
| ハンドル未設定で公開への変更を要求する | 要求する | `ValidationError("PUBLIC_HANDLE_REQUIRED")` が投げられ、1 件も登録されない | |
| ワークスペースから個人へ移動したノート（`createdBy` は別人）で公開への変更を要求する | 要求する | 所有者 `owner.userId` の公開ハンドルで検査される（`createdBy` は用いない） | |
| 移動先の viewer である | 移動を要求する | `BusinessRuleError(InsufficientRole)` が投げられる | |
| 移動で閲覧できなくなる利用者が出る | 移動を要求する | `warnings` にその旨が含まれる | |
| 移動先にないタグが付いている | 移動を要求する | `warnings` に外れるタグ名が含まれる | |
| 対象が 1 件のみ | 要求する | ジョブとして登録される（経路を分けない） | |
| 未知の操作を指定する | 要求する | `ValidationError("INVALID_OPERATION")` が投げられる | |
| `addTag` / `removeTag` を要求した | 親子の `kind` と `payload` を確認する | `kind: "bulkTag"`、`payload: { kind: "bulkTag", action: "add" \| "remove", tagName }` が親子で同じ値になる | |
| `changeVisibility` / `move` / `trash` / `purge` を要求した | 親子の `kind` と `payload` を確認する | それぞれ `bulkVisibility` / `bulkMove` / `bulkDelete` に畳み込まれ、`trash` と `purge` の区別は `payload.mode` が持つ | |
| 個人所有のノートだけを要求した | 親ジョブの `scope` を確認する | 対象ノートの所有文脈から `{ type: "user", userId: owner.userId }` が入る | |
| 参加ワークスペース所有のノートだけを要求した（要求者は owner ではないメンバー） | 親ジョブの `scope` を確認する | `{ type: "workspace", workspaceId }` が入る（要求者からは導かない） | |
| — | 親ジョブと子ジョブの `scope` を比べる | 親子で一致する | |
| ワークスペース所有のノートを個人へ移す `move` を要求した | 親ジョブの `scope` を確認する | 移動**元**の `{ type: "workspace", workspaceId }` で固定される（移動先で取り直すと移動元の文脈のキャンセル網から外れるため） | |
| 個人所有のノートとワークスペース所有のノートを混ぜて要求する | 要求する | `ValidationError("MIXED_OWNER_SCOPE")` が投げられ、親も子も 1 件も作られない（全体中止） | |
| 指定時は混在しているが、権限の絞り込みのあとに残る所有文脈が 1 つになる | 要求する | 判定は手順 2 の絞り込みのあとに行うため成功する | |
| 混在で全体が中止された | ジョブ一覧を確認する | 子ジョブが部分的に残らない | |
| `emptyTrash` が 500 件ごとに分割した `purge` | 要求する | 対象は 1 つの文脈のゴミ箱に限られるため、どの分割も所有文脈は単一で `MIXED_OWNER_SCOPE` に当たらない | |
