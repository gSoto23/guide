"""Build the Guidesk logo files (SVG) from one geometry source.

Usage: python3 build.py
  Writes ../logo/*.svg, ../icons/*.svg and ../../../apps/portal/app/icon.svg.
  PNG and ICO files come from raster.mjs and ico.py (see ../README.md, "Rebuilding the files").

The wordmark is the word "guidesk" set in Poppins SemiBold (SIL Open Font License 1.1), tracked
-1 %, converted to outlines, with the dot of the i in the sun colour. Outlines are cached in
wordmark.json so the build runs without the font; set POPPINS=/path/to/Poppins-SemiBold.ttf to
regenerate them.
"""
import json
import os
import re

from fontTools.pens.boundsPen import BoundsPen
from fontTools.pens.transformPen import TransformPen

from lib import fmt, load_font, text_paths, x_height
from tokens import BRAND, DARK

HERE = os.path.dirname(os.path.abspath(__file__))
BRAND_DIR = os.path.dirname(HERE)
REPO = os.path.dirname(os.path.dirname(BRAND_DIR))
TERRACOTA, SOL, CARBON, WHITE = BRAND["terracota"], BRAND["sol"], BRAND["carbon"], "#FFFFFF"
NIGHT_TEXT = DARK["text"]

# ---- The mark, "Luz": a speech bubble with one square corner and an open, lit doorway (24 grid).
BUBBLE = "M2 21V8a6 6 0 0 1 6-6h8a6 6 0 0 1 6 6v7a6 6 0 0 1-6 6Z"
DOOR = "M8.5 21v-8.5a3.5 3.5 0 0 1 7 0V21Z"
# Optical version for 16-32 px (16 grid, whole pixels): wider walls, a 4 px door.
BUBBLE_16 = "M1 14V5a4 4 0 0 1 4-4h6a4 4 0 0 1 4 4v5a4 4 0 0 1-4 4Z"
DOOR_16 = "M6 14V8a2 2 0 0 1 4 0v6Z"

# ---- Wordmark
WORD_XH = 21.0          # x-height in lockup units (the mark is 38 units tall)
WORD_TRACKING = -0.01
CACHE = os.path.join(HERE, "wordmark.json")


def wordmark_outlines():
    """[(char, path d)] at baseline 0, x 0, plus (xmin, ymin, xmax, ymax) of the ink."""
    font_path = os.environ.get("POPPINS")
    if font_path or not os.path.exists(CACHE):
        f = load_font(font_path or "~/Library/Fonts/Poppins-SemiBold.ttf")
        size = WORD_XH / x_height(f)
        paths, _ = text_paths(f, "guidesk", size, tracking=WORD_TRACKING)
        # Ink bounds, glyph by glyph.
        gs, cmap, hmtx = f.getGlyphSet(), f.getBestCmap(), f["hmtx"]
        scale = size / f["head"].unitsPerEm
        bp = BoundsPen(gs)
        x = 0.0
        for ch in "guidesk":
            g = cmap[ord(ch)]
            gs[g].draw(TransformPen(bp, (scale, 0, 0, -scale, x, 0)))
            x += hmtx[g][0] * scale + WORD_TRACKING * size
        json.dump({"paths": paths, "bounds": bp.bounds}, open(CACHE, "w"), indent=1)
    data = json.load(open(CACHE))
    return data["paths"], data["bounds"]


def split_i(d):
    """Split the i into (dot, stem): the dot is the sub-path that starts highest."""
    subs = ["M" + s for s in d.split("M") if s]
    subs.sort(key=lambda sp: float(re.findall(r"-?[\d.]+", sp)[1]))
    return subs[0], "".join(subs[1:])


def word_svg(ink, dot, dx, dy):
    paths, _ = wordmark_outlines()
    body, plain = [], []
    for ch, d in paths:
        if ch == "i":
            dot_d, stem = split_i(d)
            plain.append(stem)
            body.append(("dot", dot_d))
        else:
            plain.append(d)
    out = f'<path fill="{ink}" d="{"".join(plain)}"/>'
    dot_d = body[0][1]
    out += f'<path fill="{dot}" d="{dot_d}"/>'
    return f'<g transform="translate({fmt(dx)} {fmt(dy)})">{out}</g>'


def doc(w, h, body, label="Guidesk"):
    return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {fmt(w)} {fmt(h)}" role="img" '
            f'aria-label="{label}"><title>{label}</title>{body}</svg>\n')


def mark_body(bubble, door, mono=False):
    if mono:
        return f'<path fill="{bubble}" fill-rule="evenodd" d="{BUBBLE}{DOOR}"/>'
    return f'<path fill="{bubble}" d="{BUBBLE}"/><path fill="{door}" d="{DOOR}"/>'


def mark(bubble, door, mono=False, label="Guidesk"):
    # Ink spans 2..22 x 2..21: crop the viewBox to the ink.
    return doc(20, 19, f'<g transform="translate(-2 -2)">{mark_body(bubble, door, mono)}</g>', label)


def lockup(bubble, door, ink, dot, mono=False):
    _, (xmin, ymin, xmax, ymax) = wordmark_outlines()
    s = 2.0                      # mark at 2x: 40 x 38 units of ink
    gap = 10.0                   # about a quarter of the mark's height
    base = 38.0                  # the wordmark sits on the bubble's floor
    top = min(0.0, base + ymin)  # ymin is negative (ascenders)
    bottom = max(38.0, base + ymax)
    m = f'<g transform="translate({fmt(-2 * s)} {fmt(-2 * s - top)}) scale({fmt(s)})">{mark_body(bubble, door, mono)}</g>'
    w = word_svg(ink, dot, 40 + gap - xmin, base - top)
    return doc(40 + gap + (xmax - xmin), bottom - top, m + w)


def wordmark_only(ink, dot):
    _, (xmin, ymin, xmax, ymax) = wordmark_outlines()
    return doc(xmax - xmin, ymax - ymin, word_svg(ink, dot, -xmin, -ymin))


def app_icon(rounded):
    # The full-colour mark on a cal tile (terracota on cal 5.37:1, sol door on terracota 3.18:1).
    # Full-bleed square: platforms apply their own mask, and the bubble stays inside the 80 % safe
    # circle of maskable icons. The rounded version is for documents and presentations.
    k = 48 * 0.672 / 24
    tx, ty = 24 - 12 * k, 24 - 11.5 * k
    radius = ' rx="10.8"' if rounded else ""
    bg = f'<rect width="48" height="48"{radius} fill="{BRAND["cal"]}"/>'
    inner = (f'<g transform="translate({fmt(tx)} {fmt(ty)}) scale({fmt(k)})">'
             f'<path fill="{TERRACOTA}" d="{BUBBLE}"/><path fill="{SOL}" d="{DOOR}"/></g>')
    return doc(48, 48, bg + inner, "Guidesk app icon")


def favicon():
    return doc(16, 16, f'<path fill="{TERRACOTA}" d="{BUBBLE_16}"/><path fill="{SOL}" d="{DOOR_16}"/>')


def palette():
    """Swatches of the brand palette, in the order of the table in ../README.md (no text)."""
    names = ["terracota", "terracota-oscuro", "sol", "blanco", "piedra", "carbon", "terracota-claro", "noche"]
    cells = "".join(
        f'<rect x="{i * 56 + 0.5}" y=".5" width="48" height="48" rx="10" fill="{BRAND[n]}" stroke="#D9CCBE"/>'
        for i, n in enumerate(names))
    return doc(len(names) * 56 - 7, 49, cells, "Guidesk brand palette")


FILES = {
    "palette.svg": palette,
    "logo/guidesk-logo.svg": lambda: lockup(TERRACOTA, SOL, CARBON, SOL),
    "logo/guidesk-logo-dark.svg": lambda: lockup(TERRACOTA, SOL, NIGHT_TEXT, SOL),
    "logo/guidesk-logo-mono-black.svg": lambda: lockup(CARBON, None, CARBON, CARBON, mono=True),
    "logo/guidesk-logo-mono-white.svg": lambda: lockup(WHITE, None, WHITE, WHITE, mono=True),
    "logo/guidesk-mark.svg": lambda: mark(TERRACOTA, SOL),
    "logo/guidesk-mark-mono-black.svg": lambda: mark(CARBON, None, mono=True),
    "logo/guidesk-mark-mono-white.svg": lambda: mark(WHITE, None, mono=True),
    "logo/guidesk-wordmark.svg": lambda: wordmark_only(CARBON, SOL),
    "logo/guidesk-wordmark-dark.svg": lambda: wordmark_only(NIGHT_TEXT, SOL),
    "icons/favicon.svg": favicon,
    "icons/app-icon.svg": lambda: app_icon(rounded=False),
    "icons/app-icon-rounded.svg": lambda: app_icon(rounded=True),
}

if __name__ == "__main__":
    for rel, make in FILES.items():
        path = os.path.join(BRAND_DIR, rel)
        os.makedirs(os.path.dirname(path), exist_ok=True)
        svg = make()
        open(path, "w").write(svg)
        print(f"{rel:36} {len(svg.encode()):5} bytes")
    portal_icon = os.path.join(REPO, "apps/portal/app/icon.svg")
    open(portal_icon, "w").write(favicon())
    print(f"{'apps/portal/app/icon.svg':36} {os.path.getsize(portal_icon):5} bytes")
