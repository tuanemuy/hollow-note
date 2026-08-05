# テストケース: searchPublicNotes

| 前提条件 | 操作 | 期待結果 | 実装ステータス |
|---|---|---|---|
| 複数の利用者の公開ノートがある | キーワードで検索する | 該当する公開ノートが関連度順で返る | |
| 全体検索 | query先を確認する | global D1の `public_note_search*` だけを読み、scope DOへfan-outしない | |
| move前scopeの遅延eventがある | 検索する | route/source version条件により旧ownerの行が復活しない | |
| 非公開・限定公開のノートがある | 検索する | それらは含まれない | |
| ゴミ箱の公開ノートがある | 検索する | それは含まれない | |
| 公開から外されたノートがある | 検索する | それは含まれない | |
| `ownerHandle` を指定する | 検索する | その利用者の公開ノートだけが返る | |
| `workspaceSlug` を指定する | 検索する | その公開ワークスペースの公開ノートだけが返る | |
| 存在しないハンドルを指定する | 検索する | `NotFoundError("OWNER_NOT_FOUND")` が投げられる | |
| 非公開ワークスペースのスラッグを指定する | 検索する | `NotFoundError("OWNER_NOT_FOUND")` が投げられる | |
| キーワードが 1 文字でタグも期間も未指定、`ownerFilter` も未指定 | 検索する | 転送境界で `keyword` が `null` に落とされた結果 条件が 1 つも残らず、`ValidationError("QUERY_TOO_SHORT")` が投げられる（下限違反そのものはエラーにしない。`searchNotes` と同じ落とし方） | |
| キーワードが 1 文字で `ownerHandle` を指定する | 検索する | `keyword` は `null` に落ちるが `ownerFilter` があるため `QUERY_TOO_SHORT` にはならず、その利用者の公開ノートの一覧が返る | |
| キーワードが 101 文字 | 検索する | `ValidationError`（転送境界の 100 文字上限） | |
| `tagNames` を 11 件指定する | 検索する | `ValidationError`（最大 10 件） | |
| `updatedFrom > updatedTo` | 検索する | `ValidationError("INVALID_DATE_RANGE")` が投げられる | |
| `limit` に 0 または 101 を指定する | 検索する | `ValidationError("INVALID_PAGINATION")` が投げられる | |
| `ownerHandle` を指定し、キーワードもタグも期間も指定しない | 検索する | `QUERY_TOO_SHORT` にはならず、その利用者の公開ノートの一覧が返る（公開ページの条件なし一覧） | |
| `workspaceSlug` を指定し、キーワードもタグも期間も指定しない | 検索する | `QUERY_TOO_SHORT` にはならず、その公開ワークスペースの公開ノートの一覧が返る | |
| キーワードなしでタグのみ指定する | 検索する | 該当ノートが返る | |
| 「日本」タグの公開ノートと「日本語」タグの公開ノートがある | タグ「日本」で絞り込む | 「日本」タグのノートだけが返り、「日本語」タグのノートは返らない（絞り込みは `note_search_tags.normalized` への JOIN による完全一致で行うため。`tag_names` / `tag_names_fts` への MATCH では bigram が前方一致して偽陽性になる。ADR 011） | |
| 「本」「AI」のような 1〜2 文字のタグ名が付いた公開ノートがある | そのタグ名で絞り込む | 該当ノートが返る（絞り込みは FTS を経ないため、キーワード検索の 2 文字下限や 1 文字の `QUERY_TOO_SHORT` の制約を受けず、1 文字のタグでも引ける） | |
| 表示名が「Design」のタグが付いた公開ノートがある | 「ｄｅｓｉｇｎ」（全角・大文字混じり）で絞り込む | 該当ノートが返る（入力の `tagNames` を `searchNotes` と同じ `TagName` の正規化規則で正規化してから正規化名で照合する） | |
| 表示名が「Design」のタグが付いた公開ノートがある | 検索する | `PublicNoteSummary.tagNames` には表示名の「Design」が返る（正規化名の `design` ではない） | |
| 本文に「東京都」を含む公開ノートがある | 「東京」（2 文字）で検索する | 該当ノートが返る（bigram 方式で 2 文字から有効） | |
| 本文に「ＡＢＣ」（全角）を含む公開ノートがある | 「abc」（半角小文字）で検索する | 該当ノートが返る（NFKC 正規化と小文字化） | |
| 本文に「日本。本語」を含む公開ノートがある | 「日本語」で検索する | ヒットしてよい（句読点・空白の境界をまたぐ既知の偽陽性。関連度で下位に沈む） | |
| 所属先の異なる同名タグがある | そのタグ名で検索する | どちらの所属先のノートも返る（正規化名で一致させる） | |
| `updatedFrom` と `updatedTo` の両方を指定する | 検索する | `updatedWithin: DateRange` に解決され、`from` は `updatedFrom` の 0 時、`toExclusive` は `updatedTo` の翌日 0 時になる。絞り込みの基準列は読み取りモデルの更新日時（`note_search.updated_at`） | |
| `updatedTo` に指定した日に更新されたノートがある | その日を `updatedTo` にして検索する | 含まれる（`toExclusive` を翌日 0 時に取ることで指定日を含める） | |
| `toExclusive`（`updatedTo` の翌日 0 時）ちょうどに更新されたノートがある | 検索する | 含まれない（`DateRange` の規約どおり `from` 以上 `toExclusive` 未満。境界値） | |
| `from`（`updatedFrom` の 0 時）ちょうどに更新されたノートがある | 検索する | 含まれる（下端は包含。境界値） | |
| `updatedFrom` だけを指定する | 検索する | 欠けた側が範囲の端で埋められ、`toExclusive` は十分先の未来になる（それ以降に更新されたノートも返る） | |
| `updatedTo` だけを指定する | 検索する | 欠けた側が範囲の端で埋められ、`from` は epoch になる（それ以前に更新されたノートも返る） | |
| 境界の解決 | タイムゾーンを確認する | UTC で解決される（サインイン不要の経路で閲覧者のタイムゾーンを持てないため。`searchNotes` の `createdWithin` が利用者のタイムゾーンで解決するのとは対になる） | |
| 作成日時は範囲内だが更新日時は範囲外のノートがある | 期間を指定して検索する | 含まれない（基準列は更新日時であり、`searchNotes` の作成日時基準とは異なる） | |
| キーワードもタグも `ownerFilter` も指定せず期間だけを指定する | 検索する | `QUERY_TOO_SHORT` にはならず、その期間に更新された公開ノートが返る | |
| `ownerHandle` と期間を組み合わせる | 検索する | その利用者の公開ノートのうち期間に該当するものだけが返る | |
| 短時間に大量に検索する | 検索する | `ValidationError("RATE_LIMITED")` が投げられる | |
| 一致が 0 件 | 検索する | 空配列が返る | |
| 2page以上の結果がある | `nextCursor`で続ける | 各shardのkeyset位置から続き、既出Noteを重複せず返す。page番号やexact countは返さない | |
| NoteId hash shardが32個ある | 1page検索する | 同時6接続のwaveで各shard最大`limit`候補だけを読み、深いpageでもworkがpage番号に比例しない | |
| keyword検索でshardごとのFTS統計が異なる | mergeする | shard内rankのReciprocal Rank Fusionと`updatedAt, noteId` tie-breakを使い、global bm25同値ではなく明示した安定順位を返す | |
| shard追加のdual-read中に同じNoteが旧新へある | 検索する | NoteIdで重複排除し、cursorのshard generationに従って次pageも同じ集合を読む | |
| cursorの検索条件・署名・shard generationが一致しない | 検索する | `ValidationError("INVALID_PAGINATION")` を返す | |
| 1page目の後に対象NoteのupdatedAtが変わる | 同じcursorで続ける | cursor時点のsnapshot isolationは保証しない。page内/dual-read重複は除くが、更新結果を確実に見るには先頭から再検索する | |
