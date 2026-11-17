"""Shared helpers for the brand build: WCAG contrast, number formatting, font outlines."""
import os

from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.transformPen import TransformPen
from fontTools.ttLib import TTFont


def _lin(c):
    c = c / 255
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4


def lum(hexc):
    h = hexc.lstrip("#")
    r, g, b = (int(h[i:i + 2], 16) for i in (0, 2, 4))
    return 0.2126 * _lin(r) + 0.7152 * _lin(g) + 0.0722 * _lin(b)


def contrast(a, b):
    la, lb = lum(a), lum(b)
    hi, lo = max(la, lb), min(la, lb)
    return (hi + 0.05) / (lo + 0.05)


def fmt(v):
    s = f"{v:.2f}".rstrip("0").rstrip(".")
    if s.startswith("0."):
        s = s[1:]
    elif s.startswith("-0."):
        s = "-" + s[2:]
    return "0" if s in ("-0", "", "-") else s


_font_cache = {}


def load_font(path, axes=None):
    key = (path, tuple(sorted((axes or {}).items())))
    if key not in _font_cache:
        f = TTFont(os.path.expanduser(path))
        if axes:
            from fontTools.varLib.instancer import instantiateVariableFont
            f = instantiateVariableFont(f, axes)
        _font_cache[key] = f
    return _font_cache[key]


def text_paths(font, text, size, x=0.0, baseline=0.0, tracking=0.0, kern=None):
    """Glyph outlines of `text` as SVG path data: ([(char, d)], advance)."""
    upm = font["head"].unitsPerEm
    scale = size / upm
    gs = font.getGlyphSet()
    cmap = font.getBestCmap()
    hmtx = font["hmtx"]
    out, cx = [], x
    for i, ch in enumerate(text):
        gname = cmap[ord(ch)]
        pen = SVGPathPen(gs, ntos=fmt)
        gs[gname].draw(TransformPen(pen, (scale, 0, 0, -scale, cx, baseline)))
        out.append((ch, pen.getCommands()))
        adv = hmtx[gname][0] * scale + tracking * size
        if kern and i + 1 < len(text):
            adv += kern.get(text[i:i + 2], 0) * size
        cx += adv
    return out, cx - x - tracking * size


def x_height(font):
    return font["OS/2"].sxHeight / font["head"].unitsPerEm
