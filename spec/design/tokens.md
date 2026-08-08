# デザイントークン

Hollow の UI で使用する CSS カスタムプロパティの正準定義。
様式は **Apple Calm**（apple.com / iCloud 系のミニマリズム ＋ GitHub Markdown 互換の本文表示）、UI 構造は **集中とコマンド**（常設ナビを持たず、中央 1 カラム ＋ コマンドパレット）。

すべての画面（`spec/design/pages/*.html`）でこのトークンを参照する。値の追加・変更はこのファイルを正としてから各画面に反映する。数値で表現できない判断基準は [`spec/design/index.md`](./index.md) を参照する。

---

## 1. カラー

### 1.1 ブランド / アクセント

| 用途 | プロパティ | OKLCH |
|------|-----------|-------|
| Primary (Accent) | `--color-accent` | `oklch(37.1% 0 0)` |
| Accent hover | `--color-accent-hover` | `oklch(43.9% 0 0)` |
| Accent pressed | `--color-accent-pressed` | `oklch(26.9% 0 0)` |
| Accent surface（淡背景） | `--color-accent-surface` | `oklch(97% 0 0)` |
| Accent ink（淡背景上の文字） | `--color-accent-ink` | `oklch(26.9% 0 0)` |

ブランドカラーは無彩色のグレースケールを主体に使う。色相を持たず明度だけで階調を作ることで、取り込んだ HTML が持ち込む色を邪魔しない。**このプロダクトは「他人が作った文書をそのまま表示する」ことが本体**なので、UI 側が彩度を持つと本文の色と競合する。彩度の高い別アクセントは追加しない。

### 1.2 ニュートラル / インク

| 用途 | プロパティ | HEX | OKLCH |
|------|-----------|-----|-------|
| Page BG | `--color-bg` | `#ffffff` | `oklch(1 0 0)` |
| Surface（淡グレー、入力欄・チップ背景） | `--color-surface` | `#f5f5f7` | `oklch(0.967 0.002 286.4)` |
| Surface hover | `--color-surface-hover` | `#ececef` | `oklch(0.942 0.003 286.4)` |
| Surface elevated（行ホバー・浮上面） | `--color-surface-elevated` | `#fbfbfd` | `oklch(0.989 0.001 286.4)` |
| Ink primary | `--color-ink` | `#1d1d1f` | `oklch(0.241 0.005 286.0)` |
| Ink secondary | `--color-ink-secondary` | `#6e6e73` | `oklch(0.515 0.005 286.4)` |
| Ink tertiary | `--color-ink-tertiary` | `#86868b` | `oklch(0.612 0.005 286.0)` |
| Hairline（区切り線、標準） | `--color-hairline` | `rgba(60,60,67,0.12)` | — |
| Hairline strong（区切り線、強） | `--color-hairline-strong` | `rgba(60,60,67,0.18)` | — |

ニュートラルは「ほぼ無彩色 ＋ ごくわずかな寒色寄り」。50/100/200… の段階スケールは持たず、上記の固定 8 段階で足りる。段階を増やすと「どれを使うか」の判断が発生し、画面ごとにブレるため。

### 1.3 セマンティック

| 用途 | プロパティ | HEX |
|------|-----------|-----|
| Success | `--color-success` | `#1f8f3a` |
| Success surface | `--color-success-surface` | `#e6f4ea` |
| Warning | `--color-warning` | `#a8580b` |
| Warning surface | `--color-warning-surface` | `#fdf3e7` |
| Error | `--color-error` | `#c43e3e` |
| Error surface | `--color-error-surface` | `#fbebeb` |
| Error hover | `--color-error-hover` | `#b03535` |
| Error pressed | `--color-error-pressed` | `#9a2e2e` |
| Info | `--color-info` | `var(--color-accent)` |

セマンティックカラーも低彩度に寄せる。**info は無彩色グレー**を維持し、彩度の高い青は足さない（案内のたびに画面に色が増えるのを避ける）。

### 1.4 公開ステータス

| 状態 | プロパティ | HEX |
|------|-----------|-----|
| 非公開 | `--color-status-private` | `#86868b` |
| リンクを知る人 | `--color-status-link` | `#a8580b` |
| 公開 | `--color-status-public` | `#1f8f3a` |

6px の小ドット ＋ テキストラベルの組で使う。**色だけで区別させない**（§ index.md のアクセシビリティ）。

### 1.5 変換ステータス

このプロダクト固有の軸。ノートは「ファイルを変換した成果物」なので、変換の状態が一覧・詳細の両方に常に現れる。

| 状態 | プロパティ | 値 |
|------|-----------|-----|
| 変換中 / 待機中 | `--color-convert-working` | `var(--color-accent)` |
| 要 AI 連携 | `--color-convert-awaiting` | `var(--color-warning)` |
| 変換失敗 | `--color-convert-failed` | `var(--color-error)` |
| 変換完了 | `--color-convert-done` | `var(--color-success)` |

既存のセマンティックへの別名にとどめ、新しい色を作らない。状態の種類は増えても、画面に現れる色数は増やさない。

### 1.6 コードハイライト（本文内）

| トークン | プロパティ | HEX |
|---------|-----------|-----|
| Keyword | `--code-keyword` | `#aa3e3e` |
| String | `--code-string` | `#2a8c4f` |
| Comment | `--code-comment` | `var(--color-ink-tertiary)` |
| Function | `--code-function` | `#5b3da1` |
| Number | `--code-number` | `#1d6fd6` |

本文レンダリングは GitHub の構造規約を踏襲しつつ、配色は Apple 側に寄せた低彩度のセットを使う。

---

## 2. タイポグラフィ

### 2.1 フォントファミリー

```css
--font-sans:
  "Helvetica Neue", Arial, "Hiragino Kaku Gothic ProN",
  "Hiragino Sans", Meiryo, sans-serif;

--font-mono:
  "SF Mono", ui-monospace, SFMono-Regular, Menlo, Monaco,
  Consolas, "Liberation Mono", "Courier New", monospace;

--font-heading: var(--font-sans);
--font-body: var(--font-sans);
```

見出しと本文で別フォントは使わない。サンセリフ 1 ファミリーのサイズ・ウェイト階層だけで情報構造を表現するのが Apple Calm の規律で、書体を足すと「静けさ」が壊れる。Web フォントはロードしない（システムフォント前提）。

**`--font-mono` を使う場所は 2 つに限る**:

1. 本文中の `<code>` / `<pre>`
2. **キーボードショートカットのチップ**（`⌘K` / `↵` / `esc` など）

2 は「集中とコマンド」構造に固有の例外。パレットが航法の中心である以上、キーの表記は本文とも UI ラベルとも視覚的に区別されている必要があり、モノスペースの矩形が慣行として最も速く読める。逆に **ID・タイムスタンプ・ファイルサイズをモノスペースにはしない**（等幅の並びが必要な数値列には `font-variant-numeric: tabular-nums` を使う）。

### 2.2 サイズスケール

`clamp(min, fluid, max)` で流動的に変化させる。

| プロパティ | 値 | 用途 |
|-----------|----|----|
| `--text-xs` | `clamp(11px, 0.7vw + 9px, 12px)` | キャプション、メタ、ステータス、キーチップ |
| `--text-sm` | `clamp(12px, 0.8vw + 10px, 13px)` | UI 標準（ボタン・ラベル・行のサブ情報） |
| `--text-base` | `clamp(14px, 1vw + 11px, 16px)` | 本文（ノート本文は 16px 基準） |
| `--text-md` | `clamp(15px, 1vw + 12px, 17px)` | 一覧行のタイトル、パレットの入力欄 |
| `--text-lg` | `clamp(17px, 1.2vw + 13px, 19px)` | h3 |
| `--text-xl` | `clamp(20px, 1.4vw + 14px, 24px)` | h2、セクション見出し |
| `--text-2xl` | `clamp(24px, 2vw + 16px, 30px)` | 本文内 h1 |
| `--text-3xl` | `clamp(24px, 4vw, 38px)` | ページタイトル / ノートタイトル |
| `--text-mono` | `clamp(12.5px, 0.6vw + 11px, 13.5px)` | code / pre |

UI 部分の標準は `--text-sm`。本文（ノートレンダリング部）は `--text-base` を上限 16px に固定し、可読性を優先する。

`--text-3xl` の上限は **38px** に留める。この構造ではページタイトルが画面の最上部（極薄バーの直下）に単独で置かれ、脇に競う要素がないため、40px を超えると過剰に主張する。

### 2.3 ウェイト

| プロパティ | 値 | 用途 |
|-----------|----|----|
| `--weight-light` | 300 | 一覧のページタイトル（`--text-3xl`） |
| `--weight-regular` | 400 | 本文、一覧行のタイトル、ノートタイトル |
| `--weight-medium` | 500 | UI ラベル、ボタン、アクティブなナビ |
| `--weight-semibold` | 600 | 本文内の h2 / h3、パネル見出し |

**「軽量な大見出し」が Apple Calm の指紋**。`--text-3xl` は `--weight-light`（一覧）または `--weight-regular`（ノートタイトル）で使い、決して 600 以上にしない。一覧行のタイトルも 400 のままにする — この構造では行が密に並ばないので、500 にしなくても十分に読み分けられ、500 にすると一覧全体が重くなる。

### 2.4 行間・字間

| プロパティ | 値 | 用途 |
|-----------|----|----|
| `--leading-tight` | `1.2` | 大見出し |
| `--leading-snug` | `1.35` | h2 / h3 |
| `--leading-normal` | `1.5` | UI 一般 |
| `--leading-relaxed` | `1.75` | 本文（ノート） |
| `--tracking-tightest` | `-0.022em` | 巨大タイトル |
| `--tracking-tighter` | `-0.014em` | h2 |
| `--tracking-tight` | `-0.008em` | h3、一覧行のタイトル |
| `--tracking-normal` | `-0.003em` | 本文・UI |

`--leading-relaxed` は **1.75** とやや広く取る。この構造では本文の周囲に何も置かないぶん行長が視覚的に長く感じられるので、行間で受け止める。

---

## 3. スペーシング

4px ベース。`--space-X` の数値部分はピクセルではなく段階インデックス。

| プロパティ | 値 | 用途目安 |
|-----------|----|---------|
| `--space-0` | `0` | — |
| `--space-1` | `4px` | アイコンとラベルの間 |
| `--space-2` | `8px` | 小ギャップ、チップ内 |
| `--space-3` | `12px` | 行内ギャップ、一覧行の縦パディング |
| `--space-4` | `16px` | パネル内パディング、段落間 |
| `--space-5` | `20px` | パネルパディング、本文の段落間 |
| `--space-6` | `24px` | セクション内 |
| `--space-8` | `32px` | セクション間（小）、h3 の上 |
| `--space-10` | `40px` | セクション間（中）、h2 の上 |
| `--space-12` | `48px` | セクション間（大） |
| `--space-16` | `64px` | ページ上下、本文と末尾ブロックの間 |
| `--space-20` | `80px` | ページ下端の余白 |

**「線で区切るくらいなら 1 段大きい余白を入れる」**が原則。この構造には区切るためのサイドバー境界もカード枠もないので、余白だけが構造を作る。リズムは「タイトに束ねて、大きく離す」— 行内は `--space-2`〜`3`、ブロック間は `--space-8`〜`16` と、中間の値を避けて跳ばす。

---

## 4. レイアウト

```css
--content-max: 680px;   /* ノート本文の読みやすい行長 */
--list-max: 780px;      /* 一覧・設定・処理履歴などの作業面 */
--wide-max: 1100px;     /* カレンダー / タイル表示・管理的な一覧が使う例外幅 */
--palette-max: 620px;   /* コマンドパレット */
--container-padding: clamp(16px, 4vw, 32px);

--bar-height: 56px;     /* 上部の極薄バー */
--actionbar-height: 56px; /* 下端の操作バー */
```

**幅は 4 段階だけ**。`--content-max: 680px` は日本語で 1 行 40 字前後に収まり、GitHub のリーダブル幅（760px 前後）よりわずかに狭い。この構造は本文の左右に何も置かないため、760px では 1 行が長く感じられる。

`--wide-max` は**カレンダー表示とタイル表示、および処理履歴の親子ジョブ表**にのみ使う例外。それ以外の画面が広い幅に逃げることを許すと、この構造の主張（中央 1 カラム）が崩れる。

`--bar-height` は **56px**。常設ナビを持たないぶんバーに載る要素が少なく、64px では空白が目立つ。

---

## 5. ボーダー半径

| プロパティ | 値 | 用途 |
|-----------|----|----|
| `--radius-xs` | `4px` | インライン code、キーチップ、小バッジ |
| `--radius-sm` | `6px` | 小チップ、スコープバッジ |
| `--radius-md` | `8px` | ボタン、入力欄、一覧行のホバー面、パレットの行 |
| `--radius-lg` | `12px` | パネル、コードブロック、画像、ダイアログ / パレット |
| `--radius-xl` | `16px` | 大きなドロップ領域（P-13） |
| `--radius-pill` | `980px` | ピルボタン、チップ、ステータスピル |
| `--radius-full` | `9999px` | アバター、ドット、円形インジケータ |

「コンテンツ系のコーナーは少し大きめ（12px）、ピルは完全な丸」が Apple Calm の指紋。中間の値（10px, 14px）は作らない。

正方形の icon-only ボタンは `--radius-pill` を使う（正方形では pill も full も同一の真円になるので視覚は変わらず、用途定義「pill = ボタン」に従える）。`--radius-full` はアバター・ドット・選択インジケータなど**真円の装飾**に限定する。

---

## 5.5 アイコン寸法

標準は **16 / 20 / 24px** の 3 段階。線画・ストローク 1.5px・`currentColor`。

| プロパティ | 値 | 用途 |
|-----------|----|----|
| `--icon-2xs` | `11px` | チップ内の × 解除、キャレット |
| `--icon-xs` | `13px` | セグメンテッドコントロール、パレット行のグリフ |
| `--icon-sm` | `14px` | 行アクション、ボタン内アイコン |
| `--icon-md` | `18px` | ダイアログの閉じる ×、空状態の小アイキャッチ |

16 未満の dense グリフのみこのトークンを参照する。16 / 20 / 24 は寸法を直接指定する。

---

## 6. シャドウ

シャドウは最小限。**浮いている要素だけ**が持つ。

| プロパティ | 値 | 用途 |
|-----------|----|----|
| `--shadow-none` | `none` | デフォルト（ベース UI はすべてこれ） |
| `--shadow-xs` | `0 1px 2px rgba(0,0,0,0.04)` | セグメンテッドコントロールの選択面 |
| `--shadow-sm` | `0 2px 8px rgba(0,0,0,0.06)` | ドロップダウン、メニュー |
| `--shadow-md` | `0 8px 24px rgba(0,0,0,0.08)` | ポップオーバー、トースト、モバイルのボトムシート |
| `--shadow-lg` | `0 16px 48px rgba(0,0,0,0.1)` | コマンドパレット、ダイアログ |
| `--shadow-focus` | `0 0 0 2px var(--color-accent)` | フォーカスリング |

区切りはヘアラインと余白で作る。カードにシャドウを付けない。

---

## 7. トランジション

```css
--ease-standard: cubic-bezier(0.4, 0, 0.2, 1);
--ease-decel: cubic-bezier(0, 0, 0.2, 1);
--ease-accel: cubic-bezier(0.4, 0, 1, 1);

--duration-fast: 120ms;
--duration-base: 180ms;
--duration-slow: 280ms;

--transition-default: all var(--duration-base) var(--ease-standard);
--transition-bg: background-color var(--duration-fast) var(--ease-standard);
--transition-color: color var(--duration-fast) var(--ease-standard);
```

ホバー・フォーカスは `--duration-fast`。パレットの開閉とボトムシートは `--duration-base` ＋ `--ease-decel`。`--duration-slow` はドロワー系のみで、この構造ではほぼ使わない。

---

## 7.5 状態

```css
--opacity-disabled: 0.55;
--opacity-pending: 0.6;
```

`--opacity-disabled` は `disabled` / `aria-disabled` / 意味的に disabled な要素の不透明度。値を 1 箇所に集約し、すべての無効状態でこの 1 値を使う。

`--opacity-pending` は**楽観的更新の保留中**（タグ付与・公開ステータス変更などをサーバーが確定するまで）。disabled とは別概念なので別トークンにする — 保留中の要素は押せる（取り消せる）が、disabled は押せない。

---

## 8. ブレークポイント

| 名前 | 最小幅 | メディアクエリ | このプロジェクトでの主な切り替え |
|------|--------|----------------|------------------------------|
| (base) | 0 | （未指定） | 単一カラム。フィルタはボトムシート。操作バーは下端に固定 |
| `sm` | 640px | `@media (min-width: 640px)` | ボタンのラベルが出る。フィルタチップがインライン展開。行のホバーアクションが有効 |
| `md` | 768px | `@media (min-width: 768px)` | 余白を一段拡大。タイル 2 列 |
| `lg` | 1024px | `@media (min-width: 1024px)` | 余白を最終形へ。タイル 3 列。カレンダーが月グリッド全表示 |
| `xl` | 1280px | `@media (min-width: 1280px)` | `--wide-max` 使用画面が最大幅に到達 |
| `2xl` | 1536px | `@media (min-width: 1536px)` | 余白のみ追加。カラム構成は変えない |

```css
--bp-sm: 640px;
--bp-md: 768px;
--bp-lg: 1024px;
--bp-xl: 1280px;
--bp-2xl: 1536px;
```

**この構造ではブレークポイントでカラム数が変わらない**（常設サイドバーを持たないため）。変わるのは余白・ラベルの露出・フィルタの形態・タイルの列数だけ。CSS カスタムプロパティはメディアクエリ条件式で評価できないため、メディアクエリ自体には数値リテラルを書く。

---

## 9. 上部バー / 下端操作バー（透過 ＋ blur）

Apple Calm の象徴的な要素。この構造では**上下 2 本のバーが唯一の常設クロームなので、どちらも同じ質感で揃える**。

```css
--bar-bg: rgba(255,255,255,0.82);
--bar-blur: saturate(180%) blur(20px);
--bar-border: 1px solid var(--color-hairline);
```

- 上部バー: `position: sticky; top: 0;`、下線は入れずスクロール時のみヘアラインを出す
- 下端操作バー: `position: sticky; bottom: 0;`、上線に `--bar-border` を常時入れる（下端は背景が抜けるため、線がないと浮遊して見える）
- `backdrop-filter` 非対応環境では `--bar-bg` を不透明 `#ffffff` にフォールバック（`@supports not (backdrop-filter: blur(1px))`）

---

## 10. フォーカスリング

```css
:focus-visible {
  outline: none;
  box-shadow: var(--shadow-focus);
  border-radius: inherit;
}
```

すべてのインタラクティブ要素に共通適用する。クリック / タップ起因では表示しない（`:focus-visible` のみ）。

**この構造ではキーボード操作の比重が高い**（⌘K パレット、↑↓ での候補移動、↵ で開く）ので、フォーカスリングは装飾ではなく機能。パレット内の選択行は `--color-surface` の塗りで現在位置を示し、リングと二重にしない。

書く面（エディタ本文・タイトルのインライン編集）はこの箱リングを適用せず、caret ＋ 選択色で示す。

---

## 10.5 チェックボックス / 選択状態

「**フォームの選択肢としてのチェックボックス**」と「**一覧の複数選択 UI**」を視覚的に分離する。

### A. フォーム用（ネイティブ）

利用規約への同意、削除確認など「フォームの一項目として on/off を入力する」用途では、ブラウザのネイティブ描画をそのまま使い、`accent-color` でブランドカラーに寄せるだけに留める。

```css
.checkbox-row input[type="checkbox"] {
  width: 16px; height: 16px; margin: 0;
  accent-color: var(--color-accent);
  flex-shrink: 0; cursor: pointer;
}
.checkbox-row { display: flex; align-items: flex-start; gap: var(--space-3); }
.checkbox-row input[type="checkbox"] { margin-top: 2px; }
```

複数行ラベルと並べるときは **必ず `align-items: flex-start`**。

### B. 一覧の複数選択（カスタム・円形）

ノート一覧・ゴミ箱・処理履歴の一括操作では、Apple Mail / Photos に揃えた **円形の選択インジケータ** を使う。

- 円形 20px、既定は `opacity: 0`（選択モードに入るか、行ホバーで現れる）
- 未選択: 透明背景 ＋ hairline 枠 / ホバー: 枠色 `--color-ink-secondary`
- 選択: `--color-accent` 塗り ＋ 白いチェック（`opacity: 1` で常時表示）

**タッチ環境ではホバーで出せない**ため、選択モードに入ると全行のインジケータを `opacity: 1` にする。選択モードへの入口は ⌘K パレットと一覧ツールバーの両方に置く。

---

## 10.6 アイコン ＋ 複数行コンテンツの整列

左端のアイコン（またはサムネ・アバター・ステータスドット）の右にタイトル ＋ サブテキストを並べる場合、**`align-items: center` にしない**。複数行を縦中央に寄せるとアイコンが行間に浮いて見える。

- フレックス: `align-items: flex-start`
- グリッド: `align-items: start`

必要に応じてアイコン側に `margin-top: 2〜4px`。コンテンツが確実に 1 行（`white-space: nowrap`）の場合だけ `center` でよい。

---

## 11. ルート定義の最終形（コピペ用）

```css
:root {
  /* Color: brand */
  --color-accent: oklch(37.1% 0 0);
  --color-accent-hover: oklch(43.9% 0 0);
  --color-accent-pressed: oklch(26.9% 0 0);
  --color-accent-surface: oklch(97% 0 0);
  --color-accent-ink: oklch(26.9% 0 0);

  /* Color: neutral */
  --color-bg: #ffffff;
  --color-surface: #f5f5f7;
  --color-surface-hover: #ececef;
  --color-surface-elevated: #fbfbfd;
  --color-ink: #1d1d1f;
  --color-ink-secondary: #6e6e73;
  --color-ink-tertiary: #86868b;
  --color-hairline: rgba(60,60,67,0.12);
  --color-hairline-strong: rgba(60,60,67,0.18);

  /* Color: semantic */
  --color-success: #1f8f3a;
  --color-success-surface: #e6f4ea;
  --color-warning: #a8580b;
  --color-warning-surface: #fdf3e7;
  --color-error: #c43e3e;
  --color-error-surface: #fbebeb;
  --color-error-hover: #b03535;
  --color-error-pressed: #9a2e2e;
  --color-info: var(--color-accent);

  /* Color: publish status */
  --color-status-private: #86868b;
  --color-status-link: #a8580b;
  --color-status-public: #1f8f3a;

  /* Color: convert status */
  --color-convert-working: var(--color-accent);
  --color-convert-awaiting: var(--color-warning);
  --color-convert-failed: var(--color-error);
  --color-convert-done: var(--color-success);

  /* Color: code */
  --code-keyword: #aa3e3e;
  --code-string: #2a8c4f;
  --code-comment: var(--color-ink-tertiary);
  --code-function: #5b3da1;
  --code-number: #1d6fd6;

  /* Typography */
  --font-sans: "Helvetica Neue", Arial, "Hiragino Kaku Gothic ProN", "Hiragino Sans", Meiryo, sans-serif;
  --font-mono: "SF Mono", ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace;
  --font-heading: var(--font-sans);
  --font-body: var(--font-sans);

  --text-xs: clamp(11px, 0.7vw + 9px, 12px);
  --text-sm: clamp(12px, 0.8vw + 10px, 13px);
  --text-base: clamp(14px, 1vw + 11px, 16px);
  --text-md: clamp(15px, 1vw + 12px, 17px);
  --text-lg: clamp(17px, 1.2vw + 13px, 19px);
  --text-xl: clamp(20px, 1.4vw + 14px, 24px);
  --text-2xl: clamp(24px, 2vw + 16px, 30px);
  --text-3xl: clamp(24px, 4vw, 38px);
  --text-mono: clamp(12.5px, 0.6vw + 11px, 13.5px);

  --weight-light: 300;
  --weight-regular: 400;
  --weight-medium: 500;
  --weight-semibold: 600;

  --leading-tight: 1.2;
  --leading-snug: 1.35;
  --leading-normal: 1.5;
  --leading-relaxed: 1.75;

  --tracking-tightest: -0.022em;
  --tracking-tighter: -0.014em;
  --tracking-tight: -0.008em;
  --tracking-normal: -0.003em;

  /* Spacing */
  --space-0: 0;
  --space-1: 4px;
  --space-2: 8px;
  --space-3: 12px;
  --space-4: 16px;
  --space-5: 20px;
  --space-6: 24px;
  --space-8: 32px;
  --space-10: 40px;
  --space-12: 48px;
  --space-16: 64px;
  --space-20: 80px;

  /* Layout */
  --content-max: 680px;
  --list-max: 780px;
  --wide-max: 1100px;
  --palette-max: 620px;
  --container-padding: clamp(16px, 4vw, 32px);
  --bar-height: 56px;
  --actionbar-height: 56px;

  /* Radius */
  --radius-xs: 4px;
  --radius-sm: 6px;
  --radius-md: 8px;
  --radius-lg: 12px;
  --radius-xl: 16px;
  --radius-pill: 980px;
  --radius-full: 9999px;

  /* Icon (dense sub-16px glyphs; 16/20/24 are specified directly) */
  --icon-2xs: 11px;
  --icon-xs: 13px;
  --icon-sm: 14px;
  --icon-md: 18px;

  /* Shadow */
  --shadow-none: none;
  --shadow-xs: 0 1px 2px rgba(0,0,0,0.04);
  --shadow-sm: 0 2px 8px rgba(0,0,0,0.06);
  --shadow-md: 0 8px 24px rgba(0,0,0,0.08);
  --shadow-lg: 0 16px 48px rgba(0,0,0,0.1);
  --shadow-focus: 0 0 0 2px var(--color-accent);

  /* Motion */
  --ease-standard: cubic-bezier(0.4, 0, 0.2, 1);
  --ease-decel: cubic-bezier(0, 0, 0.2, 1);
  --ease-accel: cubic-bezier(0.4, 0, 1, 1);
  --duration-fast: 120ms;
  --duration-base: 180ms;
  --duration-slow: 280ms;
  --transition-default: all var(--duration-base) var(--ease-standard);
  --transition-bg: background-color var(--duration-fast) var(--ease-standard);
  --transition-color: color var(--duration-fast) var(--ease-standard);

  /* State */
  --opacity-disabled: 0.55;
  --opacity-pending: 0.6;

  /* Bars */
  --bar-bg: rgba(255,255,255,0.82);
  --bar-blur: saturate(180%) blur(20px);

  /* Breakpoints (参照用。メディアクエリには数値リテラルを書く) */
  --bp-sm: 640px;
  --bp-md: 768px;
  --bp-lg: 1024px;
  --bp-xl: 1280px;
  --bp-2xl: 1536px;
}
```

---

## 12. ダークモード

スコープ外。将来導入する場合は `[data-theme="dark"]` で `:root` の値を上書きする方針のみ確定しており、上の定義はその構造になっている（すべての色が意味論的な名前を持ち、生の HEX を直接参照している箇所がない）。
