# テストケース: listSitemapEntries

| 前提条件 | 操作 | 期待結果 | 実装ステータス |
|---|---|---|---|
| 公開ノートが 3 件ある | 列挙する | 3 件の ID と更新日時が返る | |
| 非公開・限定公開のノートがある | 列挙する | それらは含まれない | |
| ゴミ箱の公開ノートがある | 列挙する | それは含まれない | |
| 件数が `limit` を超える | 列挙する | `limit` 件と `nextCursor` が返る | |
| `nextCursor` を渡す | 列挙する | 続きが重複なく返る | |
| 対象が 0 件 | 列挙する | 空配列と `nextCursor: null` が返る | |
| 多数のscopeに公開Noteがある | query先を確認する | global D1のpublic projectionだけを読む。Durable Objectの列挙は行わない | |
| public Noteが32 shardへ分散する | 列挙する | 同時6接続のwaveで全体limit件へmergeし、cursorにgenerationと各shard位置を保持する | |
| 1page目の後にreshard cutoverする | 旧cursorで続ける | cursorの固定generationを読み、旧新にあるNoteIdを重複排除して欠落・重複なく返す | |
| 空shardが混ざる | 列挙する | 空shardの位置も進め、他shardの結果を全体limitまで返す | |
