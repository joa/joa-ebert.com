#!/usr/bin/env python3
"""
Subset variable fonts to Latin Unicode ranges and compress to woff2.

Usage:
  python scripts/subset-fonts.py

Requirements:
  pip install fonttools brotli

Input:  assets/fonts/NotoSans[wdth,wght].ttf
        assets/fonts/NotoSans-Italic[wdth,wght].ttf
Output: assets/fonts/NotoSans-Latin[wdth,wght].ttf  (+ .woff2)
        assets/fonts/NotoSans-Italic-Latin[wdth,wght].ttf  (+ .woff2)
"""

import os
from pathlib import Path
from fontTools import subset
from fontTools.ttLib.woff2 import compress

FONTS_DIR = Path(__file__).parent.parent / "assets" / "fonts"

PAIRS = [
    ("NotoSans[wdth,wght].ttf", "NotoSans-Latin[wdth,wght].ttf"),
    ("NotoSans-Italic[wdth,wght].ttf", "NotoSans-Italic-Latin[wdth,wght].ttf"),
]

# Latin + common punctuation, symbols, and math needed for a text-heavy blog
UNICODE_RANGES = [
    (0x0000, 0x007F),  # Basic Latin
    (0x0080, 0x00FF),  # Latin-1 Supplement
    (0x0100, 0x017F),  # Latin Extended-A
    (0x0180, 0x024F),  # Latin Extended-B
    (0x0250, 0x02AF),  # IPA Extensions
    (0x02B0, 0x02FF),  # Spacing Modifier Letters
    (0x0300, 0x036F),  # Combining Diacritical Marks
    (0x2000, 0x206F),  # General Punctuation
    (0x2070, 0x209F),  # Superscripts and Subscripts
    (0x20A0, 0x20CF),  # Currency Symbols
    (0x2100, 0x214F),  # Letterlike Symbols
    (0x2150, 0x218F),  # Number Forms
    (0x2190, 0x21FF),  # Arrows
    (0x2200, 0x22FF),  # Mathematical Operators
    (0x25A0, 0x25FF),  # Geometric Shapes
    (0x2600, 0x26FF),  # Miscellaneous Symbols
    (0xFEFF, 0xFEFF),  # BOM
    (0xFFFD, 0xFFFD),  # Replacement character
]

unicodes = [cp for start, end in UNICODE_RANGES for cp in range(start, end + 1)]


def process(src_name, dst_name):
    src = FONTS_DIR / src_name
    dst = FONTS_DIR / dst_name
    woff2_out = dst.with_suffix(".woff2")

    opts = subset.Options()
    opts.layout_features = ["*"]
    opts.name_IDs = ["*"]

    tt = subset.load_font(str(src), opts)
    subsetter = subset.Subsetter(options=opts)
    subsetter.populate(unicodes=unicodes)
    subsetter.subset(tt)
    subset.save_font(tt, str(dst), opts)
    compress(str(dst), str(woff2_out))

    src_kb = os.path.getsize(src) // 1024
    dst_kb = os.path.getsize(dst) // 1024
    woff2_kb = os.path.getsize(woff2_out) // 1024
    print(f"{src_name}: {src_kb}KB → subset ttf: {dst_kb}KB → woff2: {woff2_kb}KB")


if __name__ == "__main__":
    for src_name, dst_name in PAIRS:
        process(src_name, dst_name)
