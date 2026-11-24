"""Guidesk colour tokens (brand direction A, Bienvenida) and the WCAG 2.2 contrast checks behind them.

Run: python3 tokens.py            -> prints every checked pair and fails if one is below its minimum
     python3 tokens.py --css      -> prints the :root and dark-mode blocks for globals.css
"""
import sys

from lib import contrast

# Brand palette (names used in docs/brand/README.md).
BRAND = {
    "terracota": "#B4452A",
    "terracota-oscuro": "#8E3420",
    "sol": "#F5BC4C",
    "arena": "#F7F1EA",
    "cal": "#FFFCF8",
    "piedra": "#F5F4F2",
    "blanco": "#FFFFFF",
    "carbon": "#2B211C",
    "terracota-claro": "#F0906F",
    "noche": "#17120F",
}

LIGHT = {
    "bg": "#FFFFFF",
    "surface": "#F5F4F2",
    "text": "#2B211C",
    "text-muted": "#66574D",
    "primary": "#B4452A",
    "primary-strong": "#8E3420",
    "on-primary": "#FFFFFF",
    "link": "#8E3420",
    "accent": "#F5BC4C",
    "border": "#E6DCD1",
    "border-strong": "#8C7B70",
    "focus": "#1E5BD6",
    "danger": "#A0153E",
    "on-danger": "#FFFFFF",
    "danger-bg": "#FCEBEF",
    "warning": "#7A4D00",
    "warning-bg": "#FFF3DC",
    "success": "#1B6E3A",
    "success-bg": "#E7F5EC",
    "info": "#1F5AA6",
    "info-bg": "#E8F0FB",
    "disclosure": "#4A3F38",
    "disclosure-bg": "#F1EAE2",
}

DARK = {
    "bg": "#17120F",
    "surface": "#221B17",
    "text": "#F3ECE6",
    "text-muted": "#BFB1A6",
    "primary": "#F0906F",
    "primary-strong": "#F6B29A",
    "on-primary": "#2A0F06",
    "link": "#F0906F",
    "accent": "#F5BC4C",
    "border": "#3A302A",
    "border-strong": "#8A7A6F",
    "focus": "#8AB4F8",
    "danger": "#FF9BB5",
    "on-danger": "#2B0A12",
    "danger-bg": "#3B1A22",
    "warning": "#F0B357",
    "warning-bg": "#3A2C12",
    "success": "#6FCF97",
    "success-bg": "#16301F",
    "info": "#8AB4F8",
    "info-bg": "#18263D",
    "disclosure": "#DDD2C9",
    "disclosure-bg": "#2E2621",
}

TEXT, LARGE, UI = 4.5, 3.0, 3.0

# (foreground, background, minimum, what it is used for)
PAIRS = [
    ("text", "bg", TEXT, "Body text"),
    ("text", "surface", TEXT, "Text on cards"),
    ("text-muted", "bg", TEXT, "Secondary text"),
    ("text-muted", "surface", TEXT, "Secondary text on cards"),
    ("primary", "bg", TEXT, "Links, nav, ready badge"),
    ("primary", "surface", TEXT, "Links inside cards"),
    ("on-primary", "primary", TEXT, "Primary button label"),
    ("on-primary", "primary-strong", TEXT, "Primary button, hover and pressed"),
    ("link", "bg", TEXT, "Links (underlined)"),
    ("link", "surface", TEXT, "Links in cards"),
    ("link", "info-bg", TEXT, "Links in info banners"),
    ("link", "danger-bg", TEXT, "Links in error banners"),
    ("link", "warning-bg", TEXT, "Links in warning banners"),
    ("link", "success-bg", TEXT, "Links in success banners"),
    ("link", "disclosure-bg", TEXT, "Links in disclosure pills"),
    ("border-strong", "bg", UI, "Input and control borders"),
    ("border-strong", "surface", UI, "Control borders on cards"),
    ("focus", "bg", UI, "Focus ring (2 px offset keeps it on the page)"),
    ("focus", "surface", UI, "Focus ring on cards"),
    ("danger", "bg", TEXT, "Field errors"),
    ("danger", "surface", TEXT, "Field errors in cards"),
    ("danger", "danger-bg", TEXT, "Error banner"),
    ("on-danger", "danger", TEXT, "Destructive button label"),
    ("warning", "warning-bg", TEXT, "Warning banner"),
    ("success", "success-bg", TEXT, "Success banner"),
    ("success", "bg", TEXT, "Success text"),
    ("info", "info-bg", TEXT, "Info banner"),
    ("info", "bg", TEXT, "Info text and warning badge (feature 002)"),
    ("disclosure", "disclosure-bg", TEXT, "Disclosure pill"),
]


def check(theme, name):
    failures = 0
    print(f"\n{name}")
    for fg, bg, minimum, use in PAIRS:
        ratio = contrast(theme[fg], theme[bg])
        ok = ratio >= minimum
        failures += not ok
        print(f"  {fg:15} on {bg:15} {theme[fg]} / {theme[bg]}  {ratio:5.2f}:1  min {minimum}  "
              f"{'ok' if ok else 'FAIL'}  {use}")
    return failures


def css():
    def block(theme, indent):
        return "\n".join(f"{indent}--color-{k}: {v.lower()};" for k, v in theme.items())
    return block(LIGHT, "  "), block(DARK, "    ")


if __name__ == "__main__":
    if "--css" in sys.argv:
        light, dark = css()
        print(light)
        print("----")
        print(dark)
        sys.exit(0)
    bad = check(LIGHT, "Light") + check(DARK, "Dark")
    print("\nLogo (graphic, WCAG 1.4.11 minimum 3:1)")
    for fg, bg, use in (("sol", "terracota", "Sun door on the bubble"),
                        ("terracota", "blanco", "Mark on the light page"),
                        ("terracota", "noche", "Mark on the dark page"),
                        ("carbon", "blanco", "Wordmark on the light page"),
                        ("cal", "noche", "Wordmark on the dark page")):
        ratio = contrast(BRAND[fg], BRAND[bg])
        bad += ratio < UI
        print(f"  {fg:15} on {bg:15} {BRAND[fg]} / {BRAND[bg]}  {ratio:5.2f}:1  {'ok' if ratio >= UI else 'FAIL'}  {use}")
    # Primary and danger must not look alike: compare their luminance contrast.
    for name, t in (("light", LIGHT), ("dark", DARK)):
        print(f"\n{name}: primary vs danger luminance contrast {contrast(t['primary'], t['danger']):.2f}:1")
    print(f"\n{'All pairs pass.' if not bad else f'{bad} pair(s) fail.'}")
    sys.exit(1 if bad else 0)
