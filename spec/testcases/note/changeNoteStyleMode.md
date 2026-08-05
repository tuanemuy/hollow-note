# テストケース: changeNoteStyleMode

| 前提条件 | 操作 | 期待結果 | 実装ステータス |
|---|---|---|---|
| `styleMode: "default"` のノート | `preserve` に変更する | 値が更新され、`note.styleModeChanged`（payload に `noteId` と `styleMode`）が発行される | |
| `styleMode: "preserve"` のノート | `default` に変更する | 値が更新され、同じくイベントが発行される | |
| 変更を保存した | 読み取りモデルを確認する | `note.styleModeChanged` を購読する `projectNoteChanges` の完全snapshot置換で `style_mode` が反映される（このイベントを発行・購読しないと一覧が恒久的に古くなる） | |
| 変更を保存した | 一覧（`NoteSummary.styleMode`）を確認する | 変更後の値で表示される（ED-11 の切り替えが一覧に反映される） | |
| 同じ値を指定する | 変更する | 更新は成立し `note.styleModeChanged` が発行される（差分によるイベントの抑制はしない）。投影は現在の状態からの上書きのため結果は変わらない | |
| — | 未知の値を指定する | `BusinessRuleError(InvalidStyleMode)` が投げられる | |
| viewer である | 変更する | `NotFoundError("NOTE_NOT_FOUND")` が投げられる | |
| 古い `expectedVersion` で変更する | 変更する | `ConflictError("OPTIMISTIC_LOCK_FAILURE")` が投げられる | |
| 変更を保存した | ノートの `version` を確認する | 版が進む（同版の PDF 生成物の再利用条件がスタイル変更後に外れる） | |
| 変更後 | 公開ページを開く | 変更後のスタイルで表示される | |
| 変更後 | HTML でダウンロードする | `default` のときだけ既定スタイルが埋め込まれる | |
| 変更後に本文を編集する | 編集する | `styleMode` は自動では変わらない | |
