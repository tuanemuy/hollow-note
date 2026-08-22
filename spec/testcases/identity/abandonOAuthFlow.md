# テストケース: abandonOAuthFlow

| 前提条件 | 操作 | 期待結果 | 実装ステータス |
|---|---|---|---|
| フローの `state` が保存されている | 一致する `stateBinding` で放棄する | `abandoned: true` が返り、state 行が解放される（TTL を待たない） | |
| フローの `state` が保存されている | 一致しない `stateBinding` で放棄する | `abandoned: false` が返り、state 行は残る（他人の進行中フローを壊せない） | |
| `state` が保存されていない | 放棄する | `abandoned: false` が返る（エラーにはしない） | |
