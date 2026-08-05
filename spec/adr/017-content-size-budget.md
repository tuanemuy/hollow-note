# 017. 全文検索インデックスを contentless FTS5 にし、本文の上限を D1 の行サイズから逆算する

## ステータス

承認済み（本文サイズとcontentless FTSの決定は維持。Note / private FTSはscope DO、public FTSはglobal D1へ置くことを [S-001](../../.adr/001-scope-sharded-data-plane.md) が追加）

## コンテキスト

[クロスフェーズ検証 004](../review/cross-phase/004.md) の H-02。**D1 の 1 行（および 1 つの文字列 / BLOB）の上限は 2,000,000 バイト**である（[platform/index.md](../platform/index.md)）。超えると書き込みが失敗する硬い上限で、回避手段はない。

現行の設計はこの上限を 2 か所で超える。

1. **`note_search`**。[ADR 011](./011-bigram-search.md) は FTS5 を external content 構成にし、bigram 前処理済みのテキストを `title_fts` / `text_fts` / `tag_names_fts` として `note_search` の**同じ行**に持たせている。重なりビグラム化は日本語でおよそ 2.2 倍に膨らむため、生テキストと合わせると本文由来の 2 列だけで生テキストの約 3.2 倍になる。`NoteHtml` の上限 1 MB に対して 1 行が 3 MB を超えうる
2. **`notes`**。`content_html` と `content_text` を同じ行に持つ。本文から抽出した平文は HTML のバイト数を超えないが、装飾の少ない文書では HTML とほぼ同じ大きさになる。上限 1 MB では 2 列だけで 2 MB に達する

## 決定

### FTS5 を contentless（`content=''`）にする

`note_search` から `title_fts` / `text_fts` / `tag_names_fts` の 3 列を**削除する**。bigram 化したテキストはどこにも保存せず、FTS5 の索引の中だけに存在させる。

```sql
CREATE VIRTUAL TABLE note_search_fts USING fts5(
  title_fts,
  text_fts,
  tag_names_fts,
  content='',
  tokenize='unicode61'
);
```

- `rowid` は `note_search.rowid` を明示して挿入する（contentless では自動で対応づかない）
- 取り消し（`'delete'`）は旧値を要求する。旧値は保存していないので、**生テキスト列（`note_search.title` / `text` / `tag_names`）から前処理関数を再適用して求める**。前処理は純関数なので同じ値が必ず得られる（[ADR 011](./011-bigram-search.md)）
- 前処理関数を変更した場合、それ以前に挿入した索引行は取り消せなくなる。**前処理の変更は FTS 表の再作成を伴う**ことを移行手順に明記する
- `'rebuild'` は contentless では使えない。一括再構築は 1 件ずつの再挿入で行う。[ADR 016](./016-projection-single-writer.md) により `rebuildNoteProjection` は既に 1 件ずつ投影キューへ要求を積む形になっているため、経路は増えない

これは行サイズの問題を根から断つと同時に、ADR 011 が明記していた地雷（生テキスト列を content に指定すると `'rebuild'` で索引が全損する）も消す。**利用者に見えるものは何も変わらない** — ハイライトと抜粋は既に FTS の `snippet()` / `highlight()` を使わず生テキスト列から求める設計であり（[database/index.md](../database/index.md) の「ハイライトと抜粋の生成」）、bigram 化したテキストを読み返す経路は最初から存在しない。

### 本文の上限を 800,000 バイトにする

`NoteHtml` の上限を 1 MB から **800,000 バイト（UTF-8）** に下げる。あわせて派生列にも明示の上限を置く。

| 値 | 上限 | 根拠 |
| --- | --- | --- |
| `NoteHtml` | 800,000 バイト | 下記の予算 |
| `PlainTextContent` | 800,000 バイト | 抽出は決してバイト数を増やさない（タグの除去・実体参照の解決・空白の畳み込みはいずれも縮む方向）ため構造上 `NoteHtml` を超えないが、明示の上限としても同値を置く |
| `NoteHeading[]` の JSON | 96,000 バイト | 見出しは最大 200 件、1 件あたり `text` 100 文字まで。1 件は JSON で最大 480 バイト程度（`text` 100 文字 = 300 バイト + `anchorId` + 構文）なので、200 件で 96,000 バイトに収まる。超過分は切り捨てる（目次の網羅性より行サイズの保証を優先する） |
| `Excerpt` | 200 文字（変更なし） | 既存 |

`notes` の 1 行の予算は次のとおり。

```
content_html      800,000
content_text      800,000
content_headings   96,000
content_excerpt       800（200 文字 × 4 バイト）
title                 800
その他の固定列      < 2,000
────────────────────────
合計             < 1,700,000  = 上限 2,000,000 の 85%
```

`note_search` は `*_fts` 3 列を落としたことで `text`（≤ 800,000）が支配的になり、タグ 2 列（50 個 × 50 文字 × 2 系統で各 10,100 バイト）とその他を足して 830,000 バイト程度、上限の 42% に収まる。`note_revisions` は `html`（≤ 800,000）とタイトルだけなので 41% に収まる。

### 設計規則として残す

**上限を持たない可変長列を、他の可変長列と同じ行に置かない。** 新しい表を設計するときは、可変長列の上限の合計が 2,000,000 バイトを下回ることを示せること。示せないなら列を別表に分けるか、上限を与えること。

## 検討した代替案

### `content_html` を専用表（`note_contents`）に切り出し、上限を 1 MB のまま保つ

行を分ければ 1 MB を維持できる。しかし `notes` は `content_status = 'ready'` のとき本文 4 列がすべて NOT NULL、そうでなければすべて NULL という CHECK 制約で**不正な状態を DB で表現できなくしている**（[database/index.md](../database/index.md)）。列を別表へ出すとこの制約が表をまたぎ、SQLite では表現できなくなる。集約 1 つが 1 行に載るという読みやすさも失う。得られるのは上限 1 MB と 800 KB の差だけで、取引が合わない。不採用。

### 本文を R2 に置き、D1 には参照だけを持つ

大きなバイト列は R2 の役目であり、行サイズの問題は完全に消える。しかし本文の書き込みが D1 のトランザクションから外れる。[ADR 008](./008-domain-boundaries.md) は「オブジェクトストレージのような外部資源への書き込みは必ずイベント駆動になる」と定めており、本文をそちらに置くと**ノートの本文更新が結果整合になる**。版の作成・復元・楽観ロックがすべて 2 相の後始末を要するようになる。ノート本体はこのサービスの中核の集約であり、そこを結果整合にする理由がない。不採用。

### `content_text` を保存せず、必要になったら HTML から抽出し直す

`notes` の予算は半減する。しかし平文は検索の投影（`note_search.text`）と抜粋の生成に要り、投影のたびに `HtmlProcessor` を通すことになる。投影は同時実行数 1 のキューで直列に処理される（[ADR 016](./016-projection-single-writer.md)）ため、そこに HTML 解析を持ち込むと投影の遅延が本文の大きさに比例して伸びる。加えて `NoteContent` の `ready` は 4 つ組で 1 つの値であり、片方だけを保存しないのは値オブジェクトの分解にあたる。不採用。

### FTS5 の external content を保ったまま、前処理済み列を別表に移す

行サイズの上限は満たせる。しかし bigram テキストを保存すること自体は変わらないため、記憶容量は生テキストの約 3.2 倍のまま残る。contentless なら保存しない。読み返す経路がない値をなぜ保存するのか、という問いに答えられない。不採用。

### `NoteHtml` の上限を 982,000 バイト（予算の上限ぎりぎり）にする

計算上は収まる。しかし SQLite の行は列ごとのヘッダーを持ち、上限の 98% を常用の設計値にすると、将来 `notes` に列を 1 本足しただけで最大サイズの本文が保存できなくなる。上限に対する余裕は「まだ設計していないもののための予算」であり、使い切らない。800,000 は 2 桁の丸めが効き、余裕が 15% 残る。

## 影響

- `note_search` から 3 列が消える。`NoteProjectionWriter` の各メソッドは FTS 同期のために生テキスト列から bigram を再計算する。`upsert` が `tag_names_fts` に「現在値を書き戻す」という不自然な手順（[ADR 011](./011-bigram-search.md)）は消え、`note_search.tag_names` から計算するだけになる
- `note_search_fts` の定義と移行手順が変わる。`'rebuild'` は使えなくなり、`integrity-check` は索引の内部整合性のみを検査する
- `NoteHtml` の上限が利用者に見える形で変わる（[scenario/editing.md](../scenario/editing.md) の「1 MB 超は保存を拒否」→ 800 KB）。テストデータの境界値も動く
- 変換結果が上限を超えた場合の扱いは既存のまま（`ConversionFailureReason` の `sizeExceeded`）。編集からの保存は `BusinessRuleError(ContentTooLarge)` のまま
- 見出しに上限が付く。200 件を超える見出しを持つ文書では目次が途中までになる
- 新しい表を設計するときの規則が 1 つ増える（可変長列の合計が 2,000,000 バイトを下回ることを示せること）
