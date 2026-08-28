# テストケース: listPublicProfiles

母集合は**所有者基準**（`owner_type = "user"` の公開かつ有効なノートを 1 件以上持つ利用者）に統一する。`/@:handle` の一覧は `searchPublicNotes` が `ownerFilter: { type: "user", userId }` で引く所有者基準の集合であり、サイトマップに載せる集合はそれと一致しなければならない。

| 前提条件 | 操作 | 期待結果 | 実装ステータス |
|---|---|---|---|
| 個人所有の公開ノートを持ちハンドル設定済みの利用者が 3 名 | 列挙する | 3 件のハンドルが返る | |
| ハンドル設定済みだが公開ノートを持たない利用者 | 列挙する | その利用者は含まれない | |
| 公開ノートを持つがハンドル未設定の利用者 | 列挙する | その利用者は含まれない（`/@:handle` を持たないため `UserBatchReader.resolveMany` の解決後に落とす） | |
| 公開ノートをゴミ箱に入れた利用者 | 列挙する | その利用者は含まれない | |
| ワークスペース所有の公開ノートしか持たない利用者（ハンドル設定済み） | 列挙する | 含まれない（著者基準で列挙すると `/@:handle` が 0 件の空の公開ページを量産するため） | |
| ワークスペースから個人へ移したノートを持ち、そのノートの `createdBy` は別人である利用者 | 列挙する | 含まれる（所有者基準でのみ拾える） | |
| 個人所有の公開ノートを複数持つ利用者 | `updatedAt` を確認する | その利用者の**個人所有の公開ノート**の最新更新時刻が返る | |
| 対象が `limit` を超える | 列挙する | `limit` 件と `nextCursor` が返る | |
| `nextCursor` を渡す | 列挙する | 続きが重複なく返る | |
| 対象が 0 件 | 列挙する | 空配列と `nextCursor: null` が返る | |
| public Noteが32 shardへ分散する | 利用者を列挙する | 同時6接続のwaveで所有者を集約し、opaque cursorのshard別位置から続きを返す | |
| reshard中に同じ利用者が旧新へ現れる | 列挙する | UserIdで重複排除し、その利用者の最新updatedAtを採る | |
| 同じ利用者の公開Noteが複数shardにある | page境界をまたいで列挙する | 全shard headの同一UserIdを消費して1件だけ返し、次pageへ同じ利用者を再出現させない | |
| 1pageの利用者が32 User shardへ分散する | 表示を解決する | UserIdでgroupingして最大6接続のwaveで読み、全shard scanを行わない | |
| `limit: 101` | 列挙する | `ValidationError("INVALID_PAGINATION")`となり、UserBatchReaderの100件上限を超えない | |
| User shardをreshard中 | 同じ利用者を旧新から読む | UserIdで重複排除し、大きいUser versionのプロフィールを採る | |
