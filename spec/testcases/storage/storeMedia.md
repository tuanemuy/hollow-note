# テストケース: storeMedia

| 前提条件 | 操作 | 期待結果 | 実装ステータス |
|---|---|---|---|
| 編集できるノート | PNG をアップロードする | 保管され、配信用の URL が返る | |
| — | SVG をアップロードする | `HtmlProcessor.process` と同じ規則でサニタイズされてから保管される（本文中のインライン `svg` と保管する SVG ファイルで同じ部分集合を使う） | |
| `script` / `foreignObject` / `on*` 属性 / 外部を指す `href`・`xlink:href` を含む SVG | アップロードする | それらが除去されたうえで保管され、配信された SVG でスクリプトが実行されない | |
| 図形・パス・テキスト・グラデーション・同一文書内を指す `use` だけからなる SVG | アップロードする | 除去されずにそのまま保管される | |
| — | 未対応の形式をアップロードする | `BusinessRuleError(UnsupportedMimeType)` が投げられる | |
| — | 21 MB の画像をアップロードする | `BusinessRuleError(FileTooLarge)` が投げられる | |
| — | 20 MB の画像をアップロードする | 成功する（境界値） | |
| — | 201 MB の動画をアップロードする | `BusinessRuleError(FileTooLarge)` が投げられる | |
| 保存容量の残りが足りない | アップロードする | `BusinessRuleError(StorageQuotaExceeded)` が投げられる | |
| viewer である | アップロードする | `NotFoundError("NOTE_NOT_FOUND")` が投げられる | |
| 存在しないノート | アップロードする | `NotFoundError("NOTE_NOT_FOUND")` が投げられる | |
| move直後に旧routeを読む | アップロードする | scope miss後にprimaryで1回引き直し、target scopeへだけ保存する | |
| routeが`purging` | アップロードする | `NOTE_NOT_FOUND`となり、R2にもmetadataにも保存しない | |
| アップロード後 | 保管記録を確認する | `purpose: "media"`、挿入先の `noteId`、`uploadedBy: userId` が入っている（`collectOrphanMedia` の孤児判定と `deleteFilesForNote` の回収の手がかりになる） | |
| アップロード後 | 使用量を確認する | 保存容量が増えている | |
