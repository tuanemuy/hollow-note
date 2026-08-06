# Hollow — アイコン & Wordmark

## ✅ 決定（確定案）

- **アイコン: Vesica**（二円の重なりが生むレンズ状の空白＝ hollow / 内部リンクの繋がり）
- **Wordmark: Avenir Next / lowercase / weight 400**
- 単色・差し色なし、線画 1.5px（`currentColor`）

確定プレビュー: [`final.html`](./final.html)。マスター: [`hollow-mark.svg`](./hollow-mark.svg)（currentColor）/ [`hollow-mark-ink.svg`](./hollow-mark-ink.svg)（色固定）/ [`hollow-lockup.svg`](./hollow-lockup.svg)。
検討した全案は [`proposals.html`](./proposals.html) に保持。

### 実装時の適用先（未実装）

配布アセット（`public/` 配下を正とする）:

- `favicon.svg` — Vesica マーク（`prefers-color-scheme` で light/dark 自動反転）
- `favicon.ico` — 16/32/48 マルチ解像度
- `apple-touch-icon.png` — 180・白地・不透明・余白付き
- `mask-icon.svg` — Safari ピン留めタブ用（`#1d1d1f`）
- `og-image.png` / `og-image.svg` — 白基調・Vesica + `hollow`(Avenir Next・**アウトライン化**) + tagline

ラスタは [`hollow-mark-ink.svg`](./hollow-mark-ink.svg) を元に ImageMagick で生成する。

アプリ内の可視ロゴ:

- `BrandMark`（Vesica マーク単体）/ `BrandLockup`（マーク＋アウトライン wordmark のロックアップ）を用意し、[`hollow-mark.svg`](./hollow-mark.svg) / [`hollow-lockup.svg`](./hollow-lockup.svg) をインライン SVG 化して `currentColor` でテーマ追従させる。aria は共通 `Icon` と同じコントラクト。
- 上部バーはマーク単体、公開ヘッダーとランディングはロックアップ（[`index.md` §8](../index.md)）。

### Wordmark / フォント（決定：Avenir Next をアウトライン化）

Wordmark は **Avenir Next / Regular（lowercase）を採用**。Apple プロプライエタリフォントだが、**グリフをベクターパスへアウトライン化**して埋め込むことでフォント依存を排除した（フォントファイルは配布しない）。

- `public/og-image.svg` — Vesica マーク（line）＋ `hollow`／tagline を **`<path>` でアウトライン化**。`<text>` 参照は廃止。
- `public/og-image.png` — 上記 SVG を librsvg でラスタライズ。**fontconfig は Avenir Next を解決できないが、パス化済みのため結果は不変＝再現可能**（旧版の Bold フォールバック問題を解消）。
- [`hollow-lockup.svg`](./hollow-lockup.svg) — マーク＋ wordmark の横組みロックアップ（アウトライン・`currentColor`）。

アウトライン生成は CoreText（Swift, `CTFontCreatePathForGlyph`）でグリフパスを抽出 → [`tools/glyph2svg.swift`](./tools/glyph2svg.swift) + [`tools/build-og.py`](./tools/build-og.py) で SVG を組成。再生成手順はこの 2 スクリプトを参照（Avenir Next 実体は macOS システムフォント `/System/Library/Fonts/Avenir Next.ttc`）。

> ライセンス: ロゴ用途のアウトライン化は多くの Foundry EULA で許容されるが、Apple 同梱フォントの条項は要確認。厳密に避けたい場合は案B（オープンフォント）へ切替可能。

### 不採用（案B：オープン幾何学サンセリフへの置換・記録として保持）

Avenir Next を**埋め込み可能なオープンフォント**へ置換する案も比較検討した（最終的に Avenir Next アウトライン採用で不採用）。候補比較プレビュー: [`wordmark-open-fonts.html`](./wordmark-open-fonts.html)（Jost / Urbanist / Outfit / Poppins / Montserrat / Manrope / DM Sans / Lexend / Sora を実測で字幅を Avenir に揃えて比較。最上段に本物 Avenir Next 参照）。将来ライセンス都合で切替が必要になった際の出発点として保持する。

---

## 検討経緯（全案・保持）

3 アイコン（Ensō / Vesica / Open Frame）に対して、**Helvetica Neue と Avenir Next ×（小文字 / 大文字）= 各 4 パターン**の lockup を一律に展開した。
ビジュアルは [`proposals.html`](./proposals.html) を開いて確認。フォント候補は macOS 標準で表示されるもの（環境で見え方が変わる）。単色・差し色なし。

## 各アイコン共通の 4 パターン

| # | Wordmark |
|---|----------|
| 1 | Helvetica Neue / lowercase |
| 2 | Helvetica Neue / UPPERCASE（字間 +0.18em） |
| 3 | Avenir Next / lowercase |
| 4 | Avenir Next / UPPERCASE（字間 +0.18em） |

- lowercase: weight 400 / 字間 −0.022em
- UPPERCASE: weight 400 / 字間 +0.18em（大文字の可読性確保）

> ウェイトは当初 300（Light）だったが、hairline 寄りで細すぎたため 400（Regular）に変更。さらに太く（500 Medium）したい場合も調整可。

各カードは **上段に light / dark の横並び比較（band）**、その下に上記 4 行の lockup ＋ app icon（dark/light）で構成。

## アイコン（据え置き）

| # | 名前 | 意味 |
|---|------|------|
| 1 | Ensō | 閉じきらない一筆の円＝空・間・余白 |
| 2 | Vesica | 二円の重なりのレンズ状の空白＝繋がり |
| 3 | Open Frame（NEW） | 角丸の枠だけ、中身は空＝書く前のノート |

## 次のステップ

気に入った「アイコン × フォント × 大小文字」1 組を指定してくれれば:

1. 字間・プロポーションを詰めて lockup 確定（横組み・縦積み）
2. `.svg` 化（アイコン / wordmark / lockup）
3. favicon 一式（`favicon.ico` / `apple-touch-icon` / `og:image` / `mask-icon`）
