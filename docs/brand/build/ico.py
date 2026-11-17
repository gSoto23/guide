"""Pack the 16, 32 and 48 px favicon PNGs (from raster.mjs) into favicon.ico files.

Usage: python3 ico.py   (needs Pillow)
"""
import os

from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(os.path.dirname(os.path.dirname(HERE)))
images = [Image.open(os.path.join(HERE, f"out/favicon-{s}.png")).convert("RGBA") for s in (48, 32, 16)]
for target in (os.path.join(HERE, "../icons/favicon.ico"), os.path.join(REPO, "apps/portal/app/favicon.ico")):
    images[0].save(target, format="ICO", sizes=[(16, 16), (32, 32), (48, 48)], append_images=images[1:])
    print(os.path.relpath(target, REPO), os.path.getsize(target), "bytes")
