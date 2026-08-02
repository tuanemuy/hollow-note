# 011. 全文検索は書き込み時前処理による bigram 方式で行う

## ステータス

承認済み（FTS 表の構成は [ADR 017](./017-content-size-budget.md) が改訂した — external content から contentless に変わり、`note_search` の `title_fts` / `text_fts` / `tag_names_fts` の 3 列は存在しない。前処理・クエリ構築・タグ絞り込みの決定は本 ADR のまま）

## コンテキスト

読み取りモデル `note_search` の全文検索（[ADR 009](./009-read-models.md)）は、当初 FTS5 の `trigram` トークナイザーで構成していた。しかし実機検証で 2 つの欠陥が確認された。

1. trigram は 3 文字未満のクエリに 1 行も返さない。検索仕様は「2 文字で有効」を求めており、「東京」「猫」のような短い日本語クエリが全滅する
2. 全角英数を取り逃す。trigram は NFKC 正規化を行わないため、「ＡＢＣ」を含む本文が「ABC」で引けない

日本語の部分一致・2 文字クエリ・関連度順ページングをすべて満たすトークナイズ方式を選び直す必要がある。

あわせて、タグの AND 絞り込みも当初は `note_search.tag_names`（連結したタグ名）への MATCH で行っていたが、こちらも実機検証で偽陽性（「日本」で「日本語」タグのノートがヒットする）と偽陰性（トークナイザーの最小長を下回る 1〜2 文字のタグが引けない）の両方が確認された。全文検索とタグ絞り込みは求める一致の意味が異なる（前者は部分一致、後者は完全一致）ため、同じ索引で兼ねられるかを判断し直す必要がある。

## 決定

trigram トークナイザーを廃止し、書き込み時前処理 + FTS5(unicode61) の bigram 方式を採用する。

- 前処理は次の順序の単一の純関数として定義し、書き込み側とクエリ側で完全に共有する
  1. NFKC 正規化（全角英数・半角カナを解決）
  2. 小文字化
  3. CJK run 分割（CJK 連続部分と非 CJK 部分に分割）
  4. CJK run（2 文字以上）は重なりビグラム化（「東京都」→「東京 京都」）、1 文字 run は unigram、非 CJK は空白区切りでそのまま
- CJK 文字クラスは Hiragana U+3040–309F、Katakana U+30A0–30FF（長音 `ー` 含む）、Katakana Phonetic Extensions U+31F0–31FF、CJK Unified U+4E00–9FFF、Ext A U+3400–4DBF、CJK Compatibility U+F900–FAFF、および U+3005 `々`・U+3006 `〆`（「佐々木」の分断防止）とする。半角カナ・全角英数は NFKC が先に解決する
- クエリは前処理後、run ごとに二重引用符で包んだフレーズ（内部の `"` は `""` に倍化し、FTS5 演算子の無力化を兼ねる）とし、run 間は AND で結ぶ。全滅時はキーワードなし扱い。英数字トークンには前方一致（`word*`）を付与する
- external content は「前処理済み列を content に指定する」変種とする。`note_search` に `title_fts` / `text_fts` / `tag_names_fts` 列を追加し、`note_search_fts = fts5(title_fts, text_fts, tag_names_fts, content='note_search', content_rowid='rowid', tokenize='unicode61')` とする。生テキスト列を content に指定すると `'rebuild'` でインデックスが全損する（実測）ため禁止する
- SQL トリガーによる同期は廃止し、アダプター管理とする。`NoteProjectionWriter` の各メソッドが FTS 同期（`'delete'` → INSERT）まで責任を持ち、`note_search` 本体・前処理列・FTS を D1 の `batch()`（暗黙トランザクション）1 バッチで書く。`updateAuthor` / `updateWorkspace` は FTS 対象列に触れないため FTS 更新は不要
- 関連度順の列重みはタイトル > タグ名 > 本文（例: `bm25(fts, 5.0, 1.0, 3.0)`。具体値は実装時に調整可）
- 2 文字クエリは公開全体検索を含む全検索で有効になる。1 文字は従来どおり `QUERY_TOO_SHORT` / null 落としとする

### タグの AND 絞り込みは FTS ではなく専用表への JOIN で行う

読み取りモデルに `note_search_tags (note_id, normalized)` を設け、タグの AND 絞り込みは本表への JOIN（関係除算。または `INTERSECT`）による正規化済みタグ名の完全一致で行う。`note_search.tag_names` / `tag_names_fts` は絞り込みには使わず、キーワード検索の関連度（bm25 のタグ名列）に寄与させるためだけに残す。

タグの投影先は関連度用の `tag_names` / `tag_names_fts`、絞り込み用の `note_search_tags`、一覧の表示名用の `tag_display_names` の 4 か所になる。`NoteProjectionWriter.updateTags(noteId, tags: readonly { name; normalized }[])` を 4 か所の唯一の書き手とし、ノートのタグ集合を丸ごと入れ替えて同一バッチで更新する。関連度用の 3 経路には `normalized` を、`tag_display_names` には `name` を使う。`upsert` は 4 か所に一切触れない（`NoteProjectionEntry` にタグのフィールドがないため）。FTS の取り消し → 再挿入で `tag_names_fts` を渡す必要があるが、そこには現在値をそのまま書き戻す。タグを伴う投影の再構築は `upsert` と `updateTags` の 2 呼び出しで行う。

## 検討した代替案

### 短いクエリだけ LIKE にフォールバックする

trigram を残し、3 文字未満のクエリを `LIKE '%…%'` で処理する案。文脈内の検索なら行数が絞れるが、公開全体検索では全公開ノートのフルスキャンになり、認証不要のエンドポイントに計算量攻撃の攻撃面を作る。検索経路も 2 本に分かれ、関連度順の一貫性も失われる。不採用。

### trigram と bigram を併用する

3 文字以上は trigram、2 文字は bigram と使い分ける案。FTS 表とインデックスが二重になり記憶容量も書き込みも倍かかる一方、bigram は 3 文字以上のクエリもフレーズ AND で正しく処理できるため、trigram を残す利点がない。不採用。

### タグの AND 絞り込みを `tag_names` 列への MATCH で続ける

FTS 表 1 つで全文検索とタグ絞り込みを兼ねられ、表もインデックスも増えない。しかし実機検証のとおり偽陽性と偽陰性の両方が出る。偽陽性はビグラム化しても解消しない（「日本」のビグラムは「日本語」のビグラム集合に含まれる）し、偽陰性はトークナイザーの最小長に依存するため、タグ名の正規化だけでは埋められない。完全一致が要件である以上、索引の型が合っていない。不採用。

## 影響

- `note_search` に前処理済み列（`title_fts` / `text_fts` / `tag_names_fts`）が加わり、`note_search_fts` の定義が変わる。FTS5 仮想テーブルと raw SQL は Drizzle スキーマ外のマイグレーションで管理する
- 移行はトリガー DROP → FTS 表再作成 → `rebuildNoteProjection` の順で行う。再構築には `INSERT INTO note_search_fts(note_search_fts) VALUES('rebuild')` が使え、`integrity-check` を運用手順に含める
- 検索結果のハイライト（`NoteSummary.highlightedExcerpt`。OR-03 手順 3）の生成手段が変わる。content が前処理済み列になったため FTS5 の `snippet()` / `highlight()` はビグラム列を返し、trigram + 生テキスト content の旧構成のようにそのまま使うことはできない。FTS は「どの行が一致したか」だけを担い、一致位置は生テキスト列（`note_search.excerpt` / `text`）に同じ NFKC + 小文字化を適用した照合でアダプターが求める（[database/index.md](../database/index.md) の「ハイライトと抜粋の生成」）
- 既知の限界として次を明文化する（テストケースは「ヒットしてよい」側で書く）
  - 句読点・空白のみの境界をまたぐ偽陽性がある（「日本。本語」が「日本語」にヒットする。bm25 で下位に沈む）
  - 英単語の中間部分一致は失われる（`flare` で Cloudflare は引けない。前方一致 `cloud*` は可能）
  - クエリ内の 1 文字 CJK run は unigram の挙動になる
  - ハイライトの一致位置は生テキストへの部分一致で求めるため、FTS のヒットと必ずしも一致しない。境界をまたぐ偽陽性の行や、`excerpt` にも `text` にも一致が現れない行（タイトルやタグ名だけで一致した行）では `highlightedExcerpt` が `null` になり、画面は素の抜粋を出す
- 前処理関数は書き込み側とクエリ側の 1 か所で共有し、テストもこの関数単体に対して書ける
- 読み取りモデルに `note_search_tags` 表が加わり、タグの AND 絞り込みの経路が全文検索と分かれる。`NoteProjectionWriter.updateTags` はタグの投影先 4 か所（`tag_names` / `tag_names_fts` / `note_search_tags` / `tag_display_names`）を更新する唯一の書き手となる（[ADR 009](./009-read-models.md)）
