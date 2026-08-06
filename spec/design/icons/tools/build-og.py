#!/usr/bin/env python3
# Avenir Next の "hollow" / tagline をアウトライン化し、public/og-image.{svg,png 用 svg} と
# hollow-lockup.svg を再生成する。Avenir Next 実体は macOS システムフォント。
#   実行: DEVELOPER_DIR=/Library/Developer/CommandLineTools python3 spec/design/icons/tools/build-og.py
#   その後: magick -background none -density 192 public/og-image.svg -resize 1200x630 public/og-image.png
import subprocess, os, sys

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.abspath(os.path.join(HERE, "..", "..", "..", ".."))
GLYPH = os.path.join(HERE, "glyph2svg.swift")
SWIFT = "/Library/Developer/CommandLineTools/usr/bin/swift"
ENV = {
    "HOME": os.environ.get("HOME", ""),
    "PATH": "/Library/Developer/CommandLineTools/usr/bin:/usr/bin:/bin",
    "DEVELOPER_DIR": "/Library/Developer/CommandLineTools",
    "SDKROOT": "/Library/Developer/CommandLineTools/SDKs/MacOSX.sdk",
}

def glyphs(text, font="AvenirNext-Regular", em=1000):
    out = subprocess.run([SWIFT, GLYPH, text, font, str(em)],
                         env=ENV, capture_output=True, text=True)
    W = H = None; path = None
    for line in out.stdout.splitlines():
        if line.startswith("W="): W = float(line[2:])
        elif line.startswith("H="): H = float(line[2:])
        elif line.startswith("PATH="): path = line[5:]
    if path is None:
        sys.exit("glyph extraction failed for %r:\n%s" % (text, out.stderr))
    return W, H, path

# --- 抽出（em=1000 単位、bbox 左上原点・y-down） ---
hwW, hwH, hwPath = glyphs("hollow")
tgW, tgH, tgPath = glyphs("A quiet, personal text archive")

# --- レイアウト（1200x630） ---
CW, CH = 1200, 630
INK, SUB = "#1d1d1f", "#6e6e73"

# Vesica マーク（24-box, 円 r6.5 @ cx9/cx15, cy12）
S = 5.83                      # 元 og と同じスケール
mark_vis_left, mark_vis_top = 2.5, 5.5   # 円の可視左/上（box 単位）
mark_w = (21.5 - 2.5) * S     # 可視幅
mark_h = (18.5 - 5.5) * S     # 可視高

# wordmark スケール（font-size 110 相当）
WS = 0.11
wm_w, wm_h = hwW * WS, hwH * WS
GAP = 40

lock_w = mark_w + GAP + wm_w
lock_left = (CW - lock_w) / 2.0
MID = 282.0                   # ロックアップ中心線

# マーク配置：円中心 y=12 を MID に、可視左を lock_left に
mx = lock_left - mark_vis_left * S
my = MID - 12 * S
# wordmark 配置：bbox 中心を MID に、左を lock_left+mark_w+GAP に
wx = lock_left + mark_w + GAP
wy = MID - wm_h / 2.0

# tagline 配置：中央寄せ、baseline 付近 y=430
TS = 0.03
tg_w, tg_h = tgW * TS, tgH * TS
tx = (CW - tg_w) / 2.0
ty = 416.0

svg = f'''<svg xmlns="http://www.w3.org/2000/svg" width="{CW}" height="{CH}" viewBox="0 0 {CW} {CH}" role="img" aria-label="hollow — A quiet, personal text archive">
  <rect width="{CW}" height="{CH}" fill="#ffffff"/>
  <g transform="translate({mx:.2f},{my:.2f}) scale({S})" fill="none" stroke="{INK}" stroke-width="1.5" stroke-linecap="round">
    <circle cx="9" cy="12" r="6.5"/>
    <circle cx="15" cy="12" r="6.5"/>
  </g>
  <path transform="translate({wx:.2f},{wy:.2f}) scale({WS})" fill="{INK}" d="{hwPath}"/>
  <path transform="translate({tx:.2f},{ty:.2f}) scale({TS})" fill="{SUB}" d="{tgPath}"/>
</svg>
'''
with open(f"{REPO}/public/og-image.svg", "w") as f:
    f.write(svg)
print("wrote public/og-image.svg  (lock_left=%.1f lock_w=%.1f)" % (lock_left, lock_w))

# --- 再利用ロックアップ（mark + wordmark、tight viewBox、currentColor でテーマ追従） ---
# mark 中心と wordmark 中心を viewBox 中央に揃える
vb_w = mark_w + GAP + wm_w
vb_h = max(mark_h, wm_h)
m2x = 0 - mark_vis_left * S
m2y = vb_h/2 - 12 * S
w2x = mark_w + GAP
w2y = vb_h/2 - wm_h/2
lock = f'''<svg xmlns="http://www.w3.org/2000/svg" width="{vb_w:.0f}" height="{vb_h:.0f}" viewBox="0 0 {vb_w:.2f} {vb_h:.2f}" role="img" aria-label="hollow">
  <g transform="translate({m2x:.2f},{m2y:.2f}) scale({S})" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round">
    <circle cx="9" cy="12" r="6.5"/>
    <circle cx="15" cy="12" r="6.5"/>
  </g>
  <path transform="translate({w2x:.2f},{w2y:.2f}) scale({WS})" fill="currentColor" d="{hwPath}"/>
</svg>
'''
with open(f"{REPO}/spec/design/icons/hollow-lockup.svg", "w") as f:
    f.write(lock)
print("wrote spec/design/icons/hollow-lockup.svg")
