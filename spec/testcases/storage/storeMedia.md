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
| — | 128 KB を超える SVG をアップロードする | `BusinessRuleError(FileTooLarge)` が投げられる（本文の上限に触れて `NOTE_CONTENT_TOO_LARGE` になることはない。これを支えるのは `storeMedia` の境界翻訳が `process` の投げうる Note のコードを覆い切ることであって、128 KB からの導出ではない） | |
| サニタイズで実バイト長が 128 KB を超える SVG | アップロードする | 保管する直前の測り直しで `BusinessRuleError(FileTooLarge)` になり、オブジェクトも `StoredFile` の行も残らない | |
| サニタイズ後に `</svg>` の後ろへ内容（テキスト・要素・2 つ目の `svg`）が残る SVG | アップロードする | `BusinessRuleError(UnsupportedMimeType)` が投げられ、オブジェクトも行も残らない（XML はルート要素の後ろの内容を致命的エラーとして扱うため、単体の `.svg` として開けない） | |
| サニタイズ後に `</svg>` の後ろへ BOM・EM SPACE・LINE SEPARATOR が残る SVG | アップロードする | 同じく `BusinessRuleError(UnsupportedMimeType)` になる。判定の物差しは XML が空白と定める 4 文字（空白・タブ・CR・LF）で、`trim()` が空白と呼ぶだけの文字は内容として扱う | |
| テキストまたは属性値に U+00A0 を含む SVG | アップロードする | 保管されたバイト列では `&#160;` になっている（HTML の直列化が書く `&nbsp;` は DTD を持たない `.svg` では未定義実体＝致命的エラーになる） | |
| 属性値とテキストの両方に `&lt;` を書いた整形式な SVG | アップロードする | 成功し、保管されたバイト列では属性値の `<` が `&lt;` に書き戻されている（HTML の属性値は `<` をエスケープしないので直列化で生の文字に戻るが、XML は属性値中の `<` を認めない）。テキスト側の `&lt;` はそのまま残る | |
| `<desc>` / `<title>` の配下に `style` / `img` / `br` / `b` を持つ SVG | アップロードする | それらは内容ごと除去され、`<desc>` にはテキストだけが残る（HTML の integration point なので配下では HTML 解析が再開するが、`<svg>` の内側の許可リストは SVG の部分集合ただ 1 つ） | |
| コメント・処理命令・CDATA の中に `&` を含む SVG | アップロードする | 成功する（実体参照の規則が効くのは文字データと属性値だけで、コメントの中の `&` は 1 文字にすぎない。書き出しツールの生成コメントが実際に持ちうる） | |
| XML として整形式でない SVG（タブ・CR・LF 以外の C0 制御文字、閉じないタグ、未定義実体 `&nbsp;`、属性値中の生の `<`） | アップロードする | `BusinessRuleError(UnsupportedMimeType)` が投げられ、オブジェクトも行も残らない（ブラウザもこれらを開けないので、受理を断っても描けたものは失わない） | |
| 入れ子が 64 段の SVG / 65 段の SVG | アップロードする | 64 段は成功し、65 段は `BusinessRuleError(UnsupportedMimeType)` になる（境界値。サニタイザーは木を素の再帰で歩くので、深さがそのままスタックの深さになる） | |
| 閉じない整形要素とブロック要素を交互に並べた 128 KB の SVG（`<b><p>` / `<em><p>` / `<b><i><p>` の反復） | アップロードする | `BusinessRuleError(UnsupportedMimeType)` になる（閉じないタグは XML として整形式でないので、受理判定がそこで断る） | |
| 整形式で、すべてのタグが閉じ、入れ子も 64 段以内、128 KB 以内でありながら HTML の breakout tag（`<table>` と 61 個の `<b>`、その下に `<tr>X</tr>` を約 13,000 行）を含む SVG | アップロードする | `BusinessRuleError(UnsupportedMimeType)` になる。整形式性でも長さでもなく**要素名**で拒む（前段の安価な防御。foster parenting で `<b>` が行ごとに作り直され、131 KB が 11 MB に膨らむ実測 86 倍の経路） | |
| 同じ形から breakout tag だけを除いた 128 KB の SVG（`a` / `font` を 62 段 + `<text>` の反復） | アップロードする | 成功し、保管サイズが 128 KB 以内に収まる（境界値。上限が到達可能であることの根拠になる） | |
| コメント（`<!-->`）または処理命令（`<?a>`）に隠して受理判定を素通りする breakout tag を持つ、128 KB 以内の整形式な SVG | アップロードする | 受理判定は通るが `BusinessRuleError(FileTooLarge)` になり、オブジェクトも行も残らない。Note の語彙（`NOTE_HTML_TOO_COMPLEX`）は漏れない — 資源の上限による打ち切りを境界で Storage の語彙へ翻訳する | |
| サニタイズで縮む SVG（`<script>` の中身が落ちる）を残容量より大きいバイト列で / 膨らむ SVG（U+00A0 が `&#160;` になる）を残容量ぎりぎりのバイト列で | アップロードする | 縮む側は成功して消費量がサニタイズ後の長さと一致し、膨らむ側は `BusinessRuleError(StorageQuotaExceeded)` になる（容量を測る値・行に載る値・上限を当てる値が 1 つに揃っている） | |
| 128 KB ちょうどで、単一引用符の属性値に生の `"` を詰めた整形式な SVG | アップロードする | 受理判定は通り、サニタイズ後の直列化は膨張の上限（入力長の 4 倍）を大きく超えて 786,073 バイトになる。資源のメーターがエスケープ前の長さを課金するためで、`storeMedia` は手順 4 の測り直しで `BusinessRuleError(FileTooLarge)` を返し、オブジェクトも行も残らない | |
| 同じ詰め方を隠した `<table>` の下に置いた 20 KB の SVG（128 KB の 1/8） | アップロードする | 資源のメーターには掛からず `process` が `NOTE_CONTENT_TOO_LARGE` で失敗するが、返るのは `BusinessRuleError(FileTooLarge)` である（Note の語彙は境界で翻訳され、漏れない）。オブジェクトも行も残らない | |
| ルート要素の前後に XML の空白（空白・タブ・CR・LF）だけがある SVG | アップロードする | 成功する（境界値） | |
| ゴミ箱のノート | アップロードする | `BusinessRuleError(NoteIsTrashed)` が投げられ、オブジェクトも行も残らない（`NoteAccessPolicy` は所有者自身のゴミ箱のノートに `canEdit: true` を返すので、この門が無いと本文へ入れる手段のないメディアが容量だけ占める） | |
| 保存容量の残りが足りない | アップロードする | `BusinessRuleError(StorageQuotaExceeded)` が投げられる | |
| viewer である | アップロードする | `NotFoundError("NOTE_NOT_FOUND")` が投げられる | |
| 存在しないノート | アップロードする | `NotFoundError("NOTE_NOT_FOUND")` が投げられる | |
| move直後に旧routeを読む | アップロードする | scope miss後にprimaryで1回引き直し、target scopeへだけ保存する | |
| routeが`purging` | アップロードする | `NOTE_NOT_FOUND`となり、R2にもmetadataにも保存しない | |
| アップロード後 | 保管記録を確認する | `purpose: "media"`、挿入先の `noteId`、`uploadedBy: userId` が入っている（`collectOrphanMedia` の孤児判定と `deleteFilesForNote` の回収の手がかりになる） | |
| アップロード後 | 使用量を確認する | 保存容量が増えている | |
