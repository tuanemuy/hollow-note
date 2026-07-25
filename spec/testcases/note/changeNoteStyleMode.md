# テストケース: changeNoteStyleMode

| 前提条件 | 操作 | 期待結果 | 実装ステータス |
|---|---|---|---|
| `styleMode: "default"` のノート | `preserve` に変更する | 値が更新される | |
| `styleMode: "preserve"` のノート | `default` に変更する | 値が更新される | |
| — | 未知の値を指定する | `BusinessRuleError(InvalidStyleMode)` が投げられる | |
| viewer である | 変更する | `NotFoundError("NOTE_NOT_FOUND")` が投げられる | |
| 変更後 | 公開ページを開く | 変更後のスタイルで表示される | |
| 変更後 | HTML でダウンロードする | `default` のときだけ既定スタイルが埋め込まれる | |
| 変更後に本文を編集する | 編集する | `styleMode` は自動では変わらない | |
| 同じ値を指定する | 変更する | 変更もイベントも起きず成功する | |
