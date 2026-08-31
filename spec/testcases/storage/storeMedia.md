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
| サニタイズ後も 128 KB 以内に収まる | 128 KB（131,072 バイト）ちょうどの SVG をアップロードする | 成功する（境界値。SVG だけがラスタ画像と別の上限を持つ）。上限を当てる相手はサニタイズ後のバイト長なので、直列化で膨らむ入力はこの境界に載らない | |
| — | 128 KB を超える SVG をアップロードする | `BusinessRuleError(FileTooLarge)` が投げられる（本文の上限に触れて `NOTE_CONTENT_TOO_LARGE` になることはない） | |
| サニタイズで実バイト長が 128 KB を超える SVG | アップロードする | 保管する直前の測り直しで `BusinessRuleError(FileTooLarge)` になり、オブジェクトも `StoredFile` の行も残らない | |
| サニタイズ後に `</svg>` の後ろへ内容（テキスト・要素・2 つ目の `svg`）が残る SVG | アップロードする | `BusinessRuleError(UnsupportedMimeType)` が投げられ、オブジェクトも行も残らない（XML はルート要素の後ろの内容を致命的エラーとして扱うため、単体の `.svg` として開けない） | |
| サニタイズ後に `</svg>` の後ろへ BOM・EM SPACE・LINE SEPARATOR が残る SVG | アップロードする | 同じく `BusinessRuleError(UnsupportedMimeType)` になる。判定の物差しは XML が空白と定める 4 文字（空白・タブ・CR・LF）で、`trim()` が空白と呼ぶだけの文字は内容として扱う | |
| ルート要素の前後に XML の空白（空白・タブ・CR・LF）だけがある SVG | アップロードする | 成功する（境界値） | |
| ゴミ箱のノート | アップロードする | `BusinessRuleError(NoteIsTrashed)` が投げられ、オブジェクトも行も残らない（`NoteAccessPolicy` は所有者自身のゴミ箱のノートに `canEdit: true` を返すので、この門が無いと本文へ入れる手段のないメディアが容量だけ占める） | |
| 保存容量の残りが足りない | アップロードする | `BusinessRuleError(StorageQuotaExceeded)` が投げられる | |
| viewer である | アップロードする | `NotFoundError("NOTE_NOT_FOUND")` が投げられる | |
| 存在しないノート | アップロードする | `NotFoundError("NOTE_NOT_FOUND")` が投げられる | |
| move直後に旧routeを読む | アップロードする | scope miss後にprimaryで1回引き直し、target scopeへだけ保存する | |
| routeが`purging` | アップロードする | `NOTE_NOT_FOUND`となり、R2にもmetadataにも保存しない | |
| アップロード後 | 保管記録を確認する | `purpose: "media"`、挿入先の `noteId`、`uploadedBy: userId` が入っている（`collectOrphanMedia` の孤児判定と `deleteFilesForNote` の回収の手がかりになる） | |
| アップロード後 | 使用量を確認する | 保存容量が増えている | |
