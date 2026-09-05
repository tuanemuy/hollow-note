# 013. HTML のサニタイズは許可リスト方式で行い、規則の正典を 1 か所に置く

## コンテキスト

本文の正データはサニタイズ済みの HTML 断片 1 つである（[ADR 006](./006-html-content-model.md)）。その本文は取り込み時に外部から与えられた任意の HTML であり、公開ページ（P-44）としてサイトマップ経由で検索エンジンにインデックスされる（[pages/index.md](../pages/index.md) の E-01）。つまり、攻撃者が任意の HTML を本サービスの正規ドメイン上に置ける設計になっている。

サニタイズには次の脅威と制約がある。

1. `<iframe srcdoc="...">` は、`<script>` を要素として除去するだけのサニタイザーを属性値の中から迂回できる。要素単位の否認リストでは、属性値に第二の HTML 文書が入る経路を構造的に塞げない
2. [ADR 007](./007-default-style-isolation.md) の `styleMode` 自動判定は `style` 要素と `link rel=stylesheet` を検出条件にするため、サニタイズ前後のどちらを入力にするかを定める必要がある
3. **Shadow DOM が隔離するのはセレクタのスコープであって、レイアウトではない**。シャドウツリー内の `position: fixed` はビューポートを基準に配置され、インラインの `<style>` 1 個で公開ページ全面を覆える
4. 外部参照の内部化は防御境界にならない。取得しない選択や取得失敗では外部 URL が残り、属性ベースの `ExternalReference` では `<style>@import url(...)</style>` や `style="background:url(...)"` を抽出できない

要するに、危険なものを列挙して落とす方針では、列挙から漏れた `<iframe>` が仕様の別の場所で「保持される前提」として固まるところまで進んでいた。列挙する対象を逆にする必要がある。

## 決定

### 許可リスト方式にする

サニタイズは**許可リスト方式**とする。許可する要素・属性・URL スキームを明示的に列挙し、**列挙にないものはすべて除去する**。除去した内容は利用者に提示する。

線引きの原則は「**本文は文書としての HTML である**」とする。ノートは読み物であり、見出し・段落・リスト・表・コード・引用・強調・リンク・画像・動画・音声・ルビによって表現できる。埋め込み・入力・遷移制御・スクリプトは文書の表現力に属さないため、許可しない。

### 許可する要素

| 分類 | 要素 |
| --- | --- |
| 文書構造 | `div`, `p`, `br`, `hr`, `span`, `section`, `article`, `aside`, `header`, `footer`, `nav`, `main`, `figure`, `figcaption`, `details`, `summary` |
| 見出し | `h1`〜`h6` |
| リスト | `ul`, `ol`, `li`, `dl`, `dt`, `dd` |
| 表 | `table`, `caption`, `colgroup`, `col`, `thead`, `tbody`, `tfoot`, `tr`, `th`, `td` |
| コード・整形済み | `pre`, `code`, `kbd`, `samp`, `var` |
| 引用 | `blockquote`, `q`, `cite` |
| 強調・書式 | `strong`, `em`, `b`, `i`, `u`, `s`, `del`, `ins`, `mark`, `small`, `sub`, `sup`, `abbr`, `time`, `wbr`, `bdi`, `bdo` |
| ルビ | `ruby`, `rb`, `rt`, `rtc`, `rp` |
| リンク | `a` |
| メディア | `img`, `picture`, `source`, `video`, `audio`, `track` |
| スタイル | `style`（内容に制約あり。後述） |
| 図版 | `svg` とその配下の描画要素（後述の部分集合のみ） |

メディアの範囲は保管側の対応形式（[domains/storage.md](../domains/storage.md) の `media`: PNG / JPEG / GIF / WebP / SVG / MP4 / WebM）に合わせる。`video` / `audio` を許可するのは、これらが取り込み・メディア挿入（ED-06）で正規に生成される要素だからである。

### 許可する属性

| 対象 | 属性 |
| --- | --- |
| 全要素 | `class`, `id`, `title`, `lang`, `dir`, `role`, `aria-*`, `data-*`, `style`（内容に制約あり。後述） |
| `a` | `href`, `target`, `rel`, `download`, `hreflang`, `type` |
| `img` | `src`, `srcset`, `sizes`, `alt`, `width`, `height`, `loading`, `decoding`, `referrerpolicy` |
| `source` | `src`, `srcset`, `sizes`, `type`, `media`, `width`, `height` |
| `video` / `audio` | `src`, `controls`, `poster`, `preload`, `loop`, `muted`, `playsinline`, `width`, `height` |
| `track` | `src`, `kind`, `srclang`, `label`, `default` |
| 表 | `colspan`, `rowspan`, `headers`, `scope`, `span`, `abbr` |
| `ol` / `li` | `start`, `reversed`, `type`, `value` |
| `blockquote` / `q` | `cite` |
| `del` / `ins` | `cite`, `datetime` |
| `time` | `datetime` |
| `details` | `open` |

`class` / `id` / `data-*` を許可するのは、これらがスクリプトのない環境では不活性であり、かつ取り込んだ HTML の装飾がセレクタの取っ掛かりとしてこれらに依存しているためである。Shadow DOM によりセレクタのスコープはアプリケーション側と衝突しない（[ADR 007](./007-default-style-isolation.md)）。`autofocus` のように振る舞いを持つグローバル属性は許可しない。

`a` の `target="_blank"` には `rel="noopener noreferrer"` を必ず付与する正規化を行う。`window.opener` 経由で遷移元を書き換えられる経路を残さないためである。

### SVG の許可する要素と属性

本文中のインライン `<svg>` と、保管する SVG ファイル（[usecases/storage.md](../usecases/storage.md) の `storeMedia`）で同じ部分集合を使う。要素名は HTML パーサーが補正したあとの綴り（`linearGradient` / `clipPath` / `textPath` のキャメルケース）で照合する。

| 分類 | 要素 |
| --- | --- |
| 構造 | `svg`, `g`, `defs`, `desc`, `title`, `symbol`, `use`, `marker` |
| 図形・パス | `path`, `rect`, `circle`, `ellipse`, `line`, `polyline`, `polygon` |
| テキスト | `text`, `tspan`, `textPath` |
| 塗り | `linearGradient`, `radialGradient`, `stop`, `pattern`, `clipPath`, `mask` |

| 分類 | 属性 |
| --- | --- |
| 構造・座標系 | `viewBox`, `preserveAspectRatio`, `width`, `height`, `x`, `y`, `dx`, `dy`, `transform`, `gradientTransform`, `gradientUnits`, `patternUnits`, `patternContentUnits`, `clipPathUnits`, `maskUnits`, `maskContentUnits`, `markerUnits`, `markerWidth`, `markerHeight`, `refX`, `refY`, `orient`, `overflow` |
| 図形 | `d`, `pathLength`, `points`, `cx`, `cy`, `r`, `rx`, `ry`, `x1`, `y1`, `x2`, `y2`, `fx`, `fy`, `offset`, `spreadMethod` |
| 塗り・線 | `fill`, `fill-opacity`, `fill-rule`, `stroke`, `stroke-width`, `stroke-opacity`, `stroke-linecap`, `stroke-linejoin`, `stroke-miterlimit`, `stroke-dasharray`, `stroke-dashoffset`, `opacity`, `color`, `stop-color`, `stop-opacity`, `clip-path`, `clip-rule`, `mask`, `paint-order`, `shape-rendering`, `vector-effect` |
| テキスト | `font-family`, `font-size`, `font-style`, `font-weight`, `letter-spacing`, `word-spacing`, `text-anchor`, `text-decoration`, `dominant-baseline`, `alignment-baseline`, `baseline-shift`, `writing-mode`, `startOffset`, `textLength`, `lengthAdjust`, `xml:space` |

上の表に加えて「全要素」の行（`class` / `id` / `title` / `lang` / `dir` / `role` / `aria-*` / `data-*` / `style`）も SVG の要素に効く。表示属性（`fill` などの、CSS プロパティを属性としても書ける組）はパターンで畳まず 1 つずつ並べる — 他の行と同じく集合を閉じたままにするためである。

`href` / `xlink:href` は**同一文書内のフラグメント（`#` で始まる値）だけ**を残し、それ以外は URL の除去として報告する。

**`desc` / `title` の配下も SVG の部分集合に閉じる。** この 2 つ（と非許可の `foreignObject`）は HTML の integration point であり、配下では HTML の解析が再開する。したがって要素ごとの名前空間で判定すると、`<svg><desc>…</desc></svg>` の内側だけ「許可する要素」の表がまるごと通ってしまう。実害は 2 つある。ADR がここから外した `<style>` が `<desc>` 経由で残り、保管した `.svg` を XML として読むとそれは **SVG 名前空間の `style` 要素**になって文書全体に CSS が効く。そして `img` / `br` のような void 要素は閉じタグ無しで直列化されるため、XML としては開始と終了の不一致になり、その `.svg` は 1 ドットも描かれない。**`<svg>` の内側では、要素の名前空間によらず上の SVG の表だけを許可リストとする**（載らない要素は内容ごと除去する。SVG 名前空間の未許可要素と同じ扱い）。

**名前空間宣言（`xmlns` / `xmlns:*`）は許可しない。** 本文の断片ではインライン `<svg>` の名前空間を HTML パーサーが与えるので宣言は不活性であり、単体の `.svg` として必要になる分は `storeMedia` が保管の直前に組み立て直す（[usecases/storage.md](../usecases/storage.md)）。除去は他の属性と同じく一覧に出る。

`script`、`foreignObject`、`animate` 系、`image`（どのポリシーも見ない外部取得になる）はいずれも表に無く、許可リスト外の要素として除去される。

### 許可する URL スキーム

| 対象 | 許可するもの |
| --- | --- |
| ナビゲーション（`href`, `cite`） | `https:`, `http:`, `mailto:`, `tel:`、およびフラグメント・ルート相対・相対パス |
| リソース参照（`src`, `srcset`, `poster`） | `https:`, `http:`、およびルート相対・相対パス、加えて `data:` のうち `image/png` / `image/jpeg` / `image/gif` / `image/webp` に限る |

`data:` をリソース参照にのみ、かつラスタ画像の MIME に限って許可するのは、`data:text/html` と `data:image/svg+xml` がスクリプトを運べるためである（[scenario/import.md](../scenario/import.md) の IM-05 が `data:` URI の埋め込みを前提にしているので、全面禁止にはしない）。`javascript:`、`vbscript:`、`file:`、`blob:`、および上記に該当しないすべてのスキームとイベントハンドラー属性（`on*`）は除去する。

### 明示的に許可しないもの

| 対象 | 許可しない理由 |
| --- | --- |
| `script` / `noscript` | スクリプトの実行そのもの。`noscript` は内容の解釈規則が実行環境で分かれ、パーサーによってはサニタイズを経ずに DOM へ復活する |
| `iframe` / `frame` / `frameset` | 本文の内側に別文書を埋め込む。任意のオリジンの画面を正規ドメイン上に描ける |
| **`srcdoc` 属性** | 要素単位の除去は属性値の中の HTML を見ないため、`<iframe srcdoc="&lt;script&gt;…">` は「`script` を落とす」規則を素通りしてスクリプト実行に至る。要素を落とせば付随して消えるが、**要素単位の列挙では塞げない経路が属性値の中に存在すること**を示す例として、属性としても単独で非許可に挙げる |
| `object` / `embed` / `applet` | プラグイン・外部データの埋め込み。`data` / `type` の組み合わせ次第でスクリプトを実行できる |
| `form` / `input` / `button` / `select` / `textarea` / `option` / `optgroup` / `fieldset` / `legend` / `label` / `output` / `progress` / `meter` | 公開ページは正規ドメイン上にあり検索エンジンからも到達できる。資格情報を受け取る入力欄を置ける状態はフィッシングそのものである。本文は文書であり、入力を受け付ける必要がない |
| `base` | 本文中のすべての相対 URL の解決先を書き換える。取り込みで内部 URL に差し替えた参照を、まとめて外部へ向け直せる |
| `meta` | 文書のメタ情報は本文断片の責務ではない。とくに `http-equiv="refresh"` は公開ページに自動遷移を仕込める |
| `head` / `title`（HTML の文脈） | 文書のメタ情報であって本文ではない。本文断片として解析しても省略タグの補完で現れうるので、名前として挙げる。`<svg>` 配下の `title` は上の SVG の表が別に許可する |
| `link`（`rel=stylesheet` を含む） | `ExternalFetchPolicy` を通らない外部取得経路になる。装飾の保持は次項の取り込みで代替する |
| `template` | 内容がパースされずに保持され、後段の走査（テキスト抽出・参照抽出）とサニタイズの見え方がずれる |
| `math`（MathML） | 配下は HTML ではなく foreign content として解析され、要素の入れ子・属性の扱いがこの文書の他のどの部分とも違う。要素を剥がして中身を本文へ昇格させると数式のトークンが地の文になり、`annotation-xml` のように解析を HTML へ戻す入口も残る。数式は本文の表現力の外に置き、内容ごと除去する |
| 上記以外の未列挙の要素・属性 | 許可リスト方式の定義そのもの |

除去には 2 段ある。**許可リストにない要素は要素だけを剥がし、中身を本文へ昇格させる** — 未知のラッパー（`center`、`font`、Web コンポーネント）も読める散文を包んでいるので、まるごと落とすと本文が黙って消え、[ADR 006](./006-html-content-model.md) が取り込みに求める「本文を失わない」に反する。**ただし中身が散文でないものは内容ごと除去する** — スクリプトとマークアップのソース（`script` / `noscript` / `template`）、埋め込み文書（`iframe` / `frame` / `frameset` / `object` / `embed` / `applet`）、文書のメタ情報（`head` / `title`）、UI のラベルしか持たない制御（`textarea` / `select` / `optgroup` / `option`）、`math`。これらを剥がすと中身が本文の地の文へ昇格し、`noscript` の復活経路そのものになる。同じ表の `form` / `button` / `label` / `legend` / `fieldset` は中身が散文でありうるので剥がすだけに留める。

### 外部スタイルシートは `<link>` ではなく `<style>` として取り込む

`link rel=stylesheet` を非許可にすると、外部スタイルシートで装飾された HTML の見た目が失われる。これは「装飾された HTML をそのまま取り込む」という中核要件に反する。したがって `importExternalReferences`（[usecases/storage.md](../usecases/storage.md)）は、スタイルシートの参照については取得した CSS を**本文中に `<style>` 要素としてインライン化**する。元の外部 URL を `<link>` として残す選択肢はない。インライン化された CSS にも次項の制約を等しく適用する。

サニタイズは取り込み時に走り、参照の取得はそのあとの非同期ジョブが行うため、`<link>` を除去するだけでは元の URL が両者のあいだで失われ、この決定は実行できない。そこで **`HtmlProcessor.process` は `<link rel="stylesheet" href="…">` を同じ位置の空の `<style data-stylesheet-href="元の URL">` に置き換える**（`style` 要素と `data-*` 属性はどちらも上の許可リストの内側にある）。元の位置に置くのはカスケード順が `<link>` の並びに依存するためである。痕跡は `data-*` 属性に URL を持つ通常の要素なので、`extractExternalReferences` は他の外部参照と同じ `ExternalReference` の形で返せ、参照取り込みジョブを登録するかどうかの判定も 1 つの規則のままで済む。書き戻しは `HtmlProcessor.inlineStylesheets` が行う。契約の詳細は [domains/note.md](../domains/note.md) の `HtmlProcessor` を正とする。

**取得の結果は痕跡の属性名で表す**（[ADR 014](./014-import-result-provenance.md)）。抽出対象を `data-stylesheet-href` に限定し、取り込み済み・取得不能の痕跡を再登録しないまま 3 状態を区別する。

| 状態 | 本文中の表現 | `extractExternalReferences` が拾うか |
| --- | --- | --- |
| 未取り込み | `<style data-stylesheet-href="URL">`（空） | ○ |
| 取り込み済み | `<style data-imported-stylesheet="URL">…CSS…</style>` | × |
| 取得できなかった | `<style data-stylesheet-unavailable="URL">`（空） | × |

これにより「どのスタイルシートが埋め込まれ、どれが取得できずに装飾を失ったか」が本文自身から読める。理由（404・タイムアウト・拒否・予算超過）までは本文が語れないため、そこは Storage 側の取得記録が持つ（ADR 014）。

### `<style>` と `style` 属性は残し、CSS の内容に制約を課す

`<style>` 要素とインライン `style` 属性は許可する。ADR 007 の `preserve` モードが装飾の保持のためにこれらを必要としており、単純な禁止はできない。代わりに **CSS の内容を検査し、次を除去する**。

| 除去するもの | 理由 |
| --- | --- |
| `position` のうち、値が `static` / `relative` / `absolute` とグローバルキーワード（`inherit` / `initial` / `revert` / `revert-layer` / `unset`）**以外**であるもの | Shadow DOM はセレクタのスコープを隔離するが**レイアウトは隔離しない**。シャドウツリー内の `position: fixed` はビューポートを基準に配置されるため、`<style>` 1 個で公開ページ全面を覆うオーバーレイを描ける。**値の判定も許可リストで行う**: `fixed` / `sticky`（ベンダー接頭辞付きの同義の指定を含む）を名指しで落とす否認リストにすると、`position: var(--x)` のように利用者が別の宣言で `fixed` を仕込める間接が素通りする。ブラウザは `var()` / `env()`（将来の `attr()`）をサニタイズのあとに解決するので、許可した綴りしか残さない形でなければこの防御は成立しない |
| `@import` | `ExternalFetchPolicy` を通らない外部取得経路であり、かつ `ExternalReference` の属性ベースの抽出に構造上乗らない |

検査は宣言・規則の単位で行い、違反した宣言だけを落とす。要素ごと捨てると、1 つの違反で本文全体の装飾が消える。

**宣言の切り出しは、ブラウザと同じ字句規則で行う。** コメント・文字列・**エスケープ**の 3 つはブラウザがプロパティ名を見る前に解決するので、走査がどれか 1 つでも知らないと宣言の切れ目そのものを見誤る。とくにエスケープは `\` の次の 1 文字を必ず飲み込み、けっして構文にならない: `content:\";position:fixed` の `\"` を文字列の開始と読むと `;` が見つからず、宣言全体が 1 つの `content` 宣言として素通りする（逆に `@import url\(a;.b{…}` では走査だけが括弧を開き、続く規則を丸ごと飲み込む）。

**ただし引用符なしの `url(` の内側では、この 3 つのうち前 2 つが効かない。** ブラウザは `url(` の直後が引用符でなければコード点をそのまま `)` まで読むので（CSS Syntax の `consume-a-url-token`）、そこに書かれた `/*` はコメントではなく URL の一部であり、`)` の次の `;` は宣言を終端する。`background:url(x/*);position:fixed` の `/*` をコメントと読む走査は入力末尾までコメントの閉じを探して `;` を失い、`position:fixed` を 1 つの `background` 宣言の一部として素通りさせる。したがって**引用符なしの `url(` から `)`（無ければ入力末尾）までは 1 つの字句**として扱い、その内側で解決するのはエスケープだけとする。`url` かどうかの判定はエスケープを解決したあとの識別子に対して行う（`\75 rl(` もブラウザは url-token として読む）。`url(` の直後が引用符のときだけは関数トークンのままで、文字列は文字列として読む。

**そして文字列は閉じ引用符だけでなく、素の改行でも終わる。** CSS Syntax の `consume-a-string-token` は改行（LF / CR / FF）に出会うと **bad-string-token** を返し、その改行を次の字句として読み直す。つまりブラウザは `content:"a⏎;position:fixed` を「壊れた `content` 宣言」と「`position:fixed` 宣言」の 2 つに切り、後者を**適用する**。閉じ引用符だけを終端とする走査は `;` を見失って全体を 1 つの `content` 宣言として通すので、`<style>` 1 個で公開ページ全面を覆うオーバーレイがそのまま成立する。`\` の次の改行は行継続であり、エスケープの規則がそのまま効くので特例は要らない。**その改行は書き戻す側でも落とさない。** 文字列を終わらせたのはその改行だけなので、前後を詰めて `;` を書くと出力では文字列が開き直し、入力では効いていた後続の規則が値の中に飲まれる。除去そのものは正しく行われているため `removed` は空か `position` 1 件のままで、利用者からは「何も除去されていないのに装飾が消えた」ようにしか見えない — 「違反した宣言だけを落とす」は書き戻しまで含めて守られなければならない。

**これら 5 つを認識する場所は実装内に 1 か所だけ置き、値の判定も宣言の分割もブロックの分割もそこを通す**。個別のパターンを潰す形では、次に足された走査が同じ穴を開ける。

url-token の判定は**識別子の頭でだけ**行う。直前が識別子の文字なら、それはブラウザにとって関数トークン（`myurl(`）であって url-token ではなく、その内側ではコメントも文字列も通常どおり字句になる。ここで過剰に一致させると、宣言の切れ目を余分に見た結果として除去した側が閉じ括弧を持ち去り、`.a{background:myurl(a(b);position:fixed);color:red}` の `color:red` が閉じない関数トークンに飲まれる。「違反した宣言だけを落とす」は宣言の単位でも規則の単位でも守られなければならない。

`position: absolute` は許可する。本文のホスト要素を包含ブロックにすることで、絶対配置の基準を本文の内側に閉じられるためである（描画側の具体は [presentation/index.md](../presentation/index.md)）。許可リストに載らない値は、ブラウザから見れば解決できるもの（`var()`）か無効な宣言として無視されるもの（綴り誤り）のどちらかであり、落としても装飾を失わない。

### 規則の正典を 1 か所に置く

**この ADR の上記の表がサニタイズ規則の正典である**。**保存する本文への適用点**は Note ドメインのポート `HtmlProcessor`（[domains/note.md](../domains/note.md)）ただ 1 つとし、次のすべてがこの規則を参照する。

- 取り込み時の変換結果の保存（`applyConversionResult` の入力生成）
- HTML / WYSIWYG エディタからの保存（`updateNoteBody`）
- メディア挿入（ED-06）
- SVG ファイルの保管（[usecases/storage.md](../usecases/storage.md) の `storeMedia`。`HtmlProcessor.process` と同じ規則を適用すると既に書かれている）

「許可する URL スキーム」の表だけは適用点が 1 つで足りない。編集画面は**まだ保存していない本文**を DOM に載せるので、載せる前に同じ表を適用する必要があり、その時点では `HtmlProcessor` を通っていない。この表の判定はドメインサービス `UrlSchemePolicy`（[domains/note.md](../domains/note.md)）に 1 本だけ置き、`HtmlProcessor` と編集画面の両方がそれを呼ぶ。実装が適用点ごとに分かれると、面が保存より**多く**落とす（読めていた本文が消える）向きにも、**少なく**落とす（拒むはずのスキームが載る）向きにも壊れる。

SVG の部分集合は上の「SVG の許可する要素と属性」が正典で、インラインの `<svg>` と保管する `.svg` の両方が同じ表を使う。ただし保管する `.svg` には表のほかに**文書としての条件**が要る（単体で XML として開けること）。それは許可リストの話ではないので [usecases/storage.md](../usecases/storage.md) の `storeMedia` が持つ。

### サニタイズは不動点である

**`process(process(x))` は `process(x)` と等しい。** 出力がそのまま入力に戻ってくる経路が 3 つあるためで、どれも本文を変えてはならない。

- `applyTextNodeEdits` — 自動保存のたびに保存済みの本文をもう一度通す
- `restoreNoteRevision` — 保持している版の本文を通してから保存し直す
- `listNoteRevisions` — 一覧の抜粋を組むために通す

破りやすいのは「元に無かったものを補う」正規化である。壊れた CSS を拒否せずそのまま運ぶ以上、走査が終端子を見つけられないのは閉じていない文字列や括弧に呑まれたときだけなので、補った終端子はその構文の内側に落ち、次の走査がまた 1 つ補う。したがって**終端子は入力にあったものだけを書き戻す**（`style="color:red"` は `;` を補われない）。逆向きに、入力にあった終端子を落とさないことも同じ規則の一部である — 宣言や規則の前置きの末尾の空白は、bad-string を終わらせた改行そのものでありうる。この性質は個別のパターンではなく、サニタイズ表全体を 2 度通す形で守る。

### サニタイズは資源で有界である

**`HtmlProcessor` は、入力の形について何も論証せずに、自分が使う資源の上限を自分で持つ。** 上限を超えたら `BusinessRuleError(NOTE_HTML_TOO_COMPLEX)` で打ち切る。壊れた HTML を補正して返す約束は変わらない — 拒むのは形ではなく費用である。**5 つの上限のうち 4 つは、本文の長さの上限から到達しうるどの文書も届かない高さに置く。節点数だけは違い、正当な本文が到達しうる高さにある** — 余裕からではなく費用から選んだ値であり、そのぶん「長さの上限の内側でも拒まれる形がある」ことを引き受けている。

この形にするのは、**「この入力の形なら費用は有界だ」という論証がどれも成立しないから**である。整形式であることは複製を防がない — foster parenting は完全に整形式な入力でも起きる。HTML の breakout tag を名前で拒む形も入口を塞がない — `<template>` は `table` の開始タグ無しで table 系の挿入モードへ入る。名前の列挙は HTML の挿入モード全体を相手にしており、網羅で証明する形になっていない。費用そのものを測って断つほうが短く、しかも本文（`updateNoteBody`）と保管する SVG（`storeMedia`）の両方に同じ 1 つの適用点で効く。

| 上限 | 値 | 根拠 |
| --- | --- | --- |
| 解析後の木の大きさ | 入力長の 4 倍。ただし下限 262,144 バイト・上限 4,000,000 バイト | HTML の解析は active formatting elements の再構成（foster parenting / adoption agency）以外で内容を複製しない。4 倍を超える木はその複製そのものである（正当な 1,040,000 バイトの本文の実測は 1.06 倍）。下限は、短い入力では省略タグの補完が相対的に大きい（`<table><tr><td>x` は 2.8 倍）ため。上限は本文の転送境界 2,000,000 バイトの 2 倍で、転送境界を持たない呼び手に対しても絶対の天井になる。**測るのは直列化した長さではない** — 課金するのは節点の**エスケープ前**の長さで、単位は UTF-16 code unit である。直列化は属性値の `"` を `&quot;` に、U+00A0 を `&nbsp;` に展開する（1 課金あたり最大 6 出力）。`NoteHtml` の 800,000 は UTF-8 バイトで測る別の量なので、**この上限から出力の長さを導いてはならない** |
| 解析後の節点数 | 50,000 | **ここだけが正当な本文の届く高さにある。** 解析器は最上位の節点を解析根から 1 つずつ移すので、平坦な木の費用はその個数の二乗になる。50,000 は、その二乗が「転送境界いっぱいの本文に同じ解析器が既に払う 0.25 秒」に並ぶ点である。800,000 バイトの本文が持つ節点数は散文で 11,899、見出しの反復で 72,731、5 セルの表で 118,924、素の `<br>` で 200,003 — 記事は必要量の 4 倍の余地を持つが、**1 節点あたり約 16 バイトより密な markup は拒まれる**。これがこの上限の取引である。同じ値が、節点数に線形な見出しの走査と unwrap の走査を `RangeError` の出る水準から遠ざける役目も兼ねる |
| 走査の深さ | 256 段 | 実在の文書の入れ子は数十段。この値なら木を辿るすべての走査が数百フレームに収まり、スタックが尽きる水準から 1 桁以上遠い |
| CSS のブロックの入れ子 | 32 段 | 実在のスタイルシートは 5 段程度。ブロックの終端探索はそのブロックを読み直すので、深さがそのまま走査を二乗にする。ここを切ると線形に戻る |
| CSS の走査の総量 | 1 回の `process` につき 8,000,000 歩 | 1 歩は走査が進める 1 位置であって 1 文字ではない — コメント・文字列・url-token は長さによらず 1 歩で飛ばすので、歩数は仕事の上界ではなく代理である。字句の長さは入力長が、読み直しの回数はブロックの入れ子の上限が別に縛っており、この値はその両方を掛けた総量に対する最後の歯止めとして置く（32 段の中の 300 KB はここで止まる） |

**「必ず失敗すると分かっている入力」の費用を縛るのは節点数の上限である。** 転送境界いっぱいの平坦な markup（`<p>` を 130,000 個 = 1,950,000 バイト）は膨張 1.0 倍・深さ 3・CSS 0 でほかのどの上限にも掛からず、サニタイズし切れば本文上限の 800,000 バイトで `ContentTooLarge` になる。**転送境界 2,000,000 と本文上限 800,000 の差はサニタイズが削る分の余地であり、その差の分だけこの種の入力が転送境界を通る** — サニタイズは内容を大きく削りうるので、入力長から出力長を先に決めて拒むことはできない。したがってこの費用は入力長に比例した範囲に収める必要があり、節点数の上限がそれを与える（130,000 個の `<p>` は解析の途中、二乗の費用を払い切る前に拒まれる）。**同じ上限が解析のどの経路にも掛かることが要件である** — 二乗は解析器が最上位の節点を 1 つずつ移す形から来るので、`<form>` の開始タグと `</template>`（解析が開いている `<template>` の数に依存する 2 つの構文）を含む入力にも、含まない入力と同じ上限が掛からなければならない。転送境界を動かす者はこの取引を見て動かすこと。

木の大きさは**解析しながら**測る。解析が終わってから測る形では、木を作る費用がすでに払われている（128 KB の `<template><tr><font …>` は 15 MB の木と 200 MB のヒープを作ってからでないと測れない）。深さも同じ理由で、解析器が開いている要素の数としても見る — 550 KB の入れ子は、木ができるまでに 21 秒かかる。

**再帰は `RangeError` を投げない形にする。** 深さを測る走査そのものは明示スタックで書き（それが溢れる深さこそがこの走査の対象である）、木を辿る他の走査と CSS のブロック走査は上の上限より深くならない。**深さでは縛れない形は節点数で縛る** — 非許可の要素を unwrap する経路は子をまとめて扱うため深さ 2 段でも引数の個数の上限に届きうるが、その個数は節点数の上限の内側にある。したがってどこにも `toSerialized()` を持たない例外は出ない。

### 多層防御として CSP を併用する

サニタイズだけに頼らない。公開ページには CSP を敷き、少なくとも `frame-ancestors`（クリックジャッキング）、`form-action`（万一残った送信先の制限）、`object-src`（プラグインの埋め込み）を指定する。**具体的なヘッダーの定義は presentation 層の責務**とし、[presentation/index.md](../presentation/index.md) に置く。この ADR が決めるのは「サニタイズを唯一の防御線にしない」という方針と、その所在だけである。

### `styleMode` の自動判定はサニタイズ前の入力を見る

`link rel=stylesheet` が非許可になるため、判定をサニタイズ後の本文に対して行うと ADR 007 の検出条件が成立しなくなる。`hasDecoration` の判定は**サニタイズで除去する前の入力**に対して行い、除去された `link rel=stylesheet` も装飾の痕跡として `preserve` の根拠に数える。`HtmlProcessor.process` が 1 度の走査でサニタイズと派生情報の抽出を行うという契約は変えない。

## 検討した代替案

### 否認リストを拡張し、危険な要素を個別に足していく

現在の記述に `iframe` / `object` / `form` / `base` などを追加する案。差分は最小で、既存の記述との連続性も保てる。しかし新しい抜け道が見つかるたびに後追いになり、その時点で本文として保存済みの HTML は既に危険なものを含んでいる。さらに `srcdoc` のように**属性値の中に第二の HTML 文書が入る**経路は、要素の列挙をいくら足しても構造的に塞げない。列挙から漏れたものが安全側に倒れないという性質そのものが問題なので不採用。

### 本文を iframe sandbox に隔離する

`<iframe sandbox>` に本文を描画すれば、スクリプトもフォーム送信もトップレベル遷移もブラウザ側で止められる。しかし [ADR 007](./007-default-style-isolation.md) は既に iframe を不採用としており、その理由（高さの同期、リンクの遷移、印刷・PDF 生成、テキスト選択、アクセシビリティのいずれもが扱いづらくなり、共有ページの表示品質を落とす）はここでも変わらない。加えて、隔離は表示時の防御にしかならず、書き出し（EX-01）の HTML には効かない。保存する本文そのものを安全にするほうが射程が広い。不採用。

### `<style>` と `style` 属性を全面的に禁止する

CSS を一切持ち込ませなければ、`position: fixed` によるオーバーレイも `@import` も原理的に発生しない。規則も最も短くなる。しかし ADR 007 の `preserve` モードが成立しなくなり、「装飾された HTML をそのまま取り込む」という中核要件（[ADR 006](./006-html-content-model.md)）に正面から反する。`styleMode` の自動判定も検出対象を失う。危険なのは CSS 一般ではなくビューポート基準の配置と外部取得の 2 点なので、その 2 点だけを宣言単位で落とす。不採用。

### 許可リストをサニタイザーライブラリの既定集合に委ねる

「一般的なサニタイザーの既定に従う」とだけ書く案。仕様の記述量はほぼゼロで済む。しかし既定集合はライブラリごとに異なり、版によっても変わるため、**仕様として参照できる固定点にならない**。実際に多くのライブラリは既定で `<style>` を落とすので、そのまま採ると ADR 007 の `preserve` が壊れる。ライブラリの選定は実装の判断に残しつつ、集合そのものは仕様側で定義する。不採用。

## 関連する設計

- `HtmlProcessor.process` は許可リストと CSS の宣言単位の検査を適用し、壊れた HTML は補正して返す。ただし上記の資源の上限を超える入力は `BusinessRuleError(NOTE_HTML_TOO_COMPLEX)` で拒む
- `RemovedNode` は要素・属性・URL に加えて、除去した CSS 宣言・規則も分類して報告する（[domains/note.md](../domains/note.md)）
- サニタイズのテストは許可リスト、`iframe srcdoc`、`base`、`form`、`position: fixed`、`@import`、`data:` スキームの選別を含む
- `importExternalReferences` は取得したスタイルシートを `<style>` としてインライン化し、結果を痕跡の属性名で表す（[ADR 014](./014-import-result-provenance.md)）
- `styleMode` の自動判定はサニタイズ前の入力を見る
- 公開ページの CSP は [presentation/index.md](../presentation/index.md) を正典とする
- 本文の外部参照が `<style>` の中の `url()` として残る経路は、この ADR では塞がらない（`ExternalReference` が属性ベースであるため）。サニタイズはこの穴を前提にせず、CSP の `style-src` / `img-src` / `font-src` を併用する
