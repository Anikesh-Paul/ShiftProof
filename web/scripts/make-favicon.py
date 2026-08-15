"""Generate the ShiftProof favicon from the Fraunces wordmark + ember token.

Needs the Fraunces variable TTF at scripts/fonts/Fraunces-variable.ttf
(https://github.com/google/fonts/raw/main/ofl/fraunces/Fraunces%5BSOFT%2CWONK%2Copsz%2Cwght%5D.ttf).
"""

from __future__ import annotations

import struct
import tempfile
from io import BytesIO
from pathlib import Path

from fontTools.pens.boundsPen import BoundsPen
from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.ttLib import TTFont
from fontTools.varLib import instancer
from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parents[1]
PUBLIC = ROOT / "public"
FONT_SRC = ROOT / "scripts" / "fonts" / "Fraunces-variable.ttf"

# Live --accent / --on-accent as the browser paints them (oklch → sRGB).
EMBER = (156, 38, 32, 255)  # #9c2620
PAPER = (252, 252, 252, 255)  # #fcfcfc
EMBER_HEX = "#9c2620"
PAPER_HEX = "#fcfcfc"


def write_ico(path: Path, images: list[Image.Image]) -> None:
    pngs: list[bytes] = []
    for im in images:
        buf = BytesIO()
        im.save(buf, format="PNG")
        pngs.append(buf.getvalue())
    count = len(images)
    offset = 6 + 16 * count
    entries = []
    blob = b""
    for im, png in zip(images, pngs, strict=True):
        w, h = im.size
        entries.append(
            struct.pack(
                "<BBBBHHII",
                w if w < 256 else 0,
                h if h < 256 else 0,
                0,
                0,
                1,
                32,
                len(png),
                offset,
            )
        )
        offset += len(png)
        blob += png
    path.write_bytes(struct.pack("<HHH", 0, 1, count) + b"".join(entries) + blob)


def instance_font(opsz: float, wght: float, soft: float = 20.0) -> Path:
    font = TTFont(FONT_SRC)
    inst = instancer.instantiateVariableFont(
        font, {"opsz": opsz, "wght": wght, "SOFT": soft, "WONK": 0}
    )
    tmp = Path(tempfile.mkdtemp()) / f"fraunces-{int(opsz)}-{int(wght)}.ttf"
    inst.save(tmp)
    return tmp


def render_mark(size: int, font_path: Path, *, square: bool) -> Image.Image:
    """Ember tile + optically centered Fraunces S."""
    scale = 8
    s = size * scale
    img = Image.new("RGBA", (s, s), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)

    if square:
        draw.rectangle([0, 0, s - 1, s - 1], fill=EMBER)
    else:
        # Matches radius-sm on a 48px control (~21%).
        radius = round(s * 0.21)
        draw.rounded_rectangle([0, 0, s - 1, s - 1], radius=radius, fill=EMBER)

    # Display S fills most of the tile without crowding the corners.
    font_px = round(s * (0.80 if size <= 16 else 0.68))
    font = ImageFont.truetype(str(font_path), font_px)
    bbox = draw.textbbox((0, 0), "S", font=font)
    tw, th = bbox[2] - bbox[0], bbox[3] - bbox[1]
    x = (s - tw) / 2 - bbox[0]
    # Fraunces S sits optically high; nudge down a hair.
    y = (s - th) / 2 - bbox[1] + s * 0.02
    draw.text((x, y), "S", font=font, fill=PAPER)
    return img.resize((size, size), Image.Resampling.LANCZOS)


def write_svg(path: Path, font_path: Path) -> None:
    font = TTFont(font_path)
    gs = font.getGlyphSet()
    pen = SVGPathPen(gs)
    gs["S"].draw(pen)
    raw = pen.getCommands()
    bp = BoundsPen(gs)
    gs["S"].draw(bp)
    x0, y0, x1, y1 = bp.bounds
    gw, gh = x1 - x0, y1 - y0

    view = 32.0
    # Same ~21% radius as the rasters.
    rx = 6.7
    pad = 5.4
    target = view - 2 * pad
    scale = min(target / gw, target / gh)
    # Font y-up → SVG y-down; center in the tile with a slight optical drop.
    cx = (x0 + x1) / 2
    cy = (y0 + y1) / 2
    tx = view / 2 - cx * scale
    ty = view / 2 + cy * scale + 0.35

    # Round path numbers so the file stays readable.
    def round_path(cmd: str) -> str:
        out = []
        num = ""
        for ch in cmd:
            if ch in "0123456789.-+eE":
                num += ch
            else:
                if num:
                    out.append(f"{float(num):.2f}")
                    num = ""
                out.append(ch)
        if num:
            out.append(f"{float(num):.2f}")
        return "".join(out)

    svg = (
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">'
        f'<rect width="32" height="32" rx="{rx}" fill="{EMBER_HEX}"/>'
        f'<g transform="translate({tx:.2f} {ty:.2f}) scale({scale:.5f} {-scale:.5f})">'
        f'<path fill="{PAPER_HEX}" d="{round_path(raw)}"/>'
        f"</g></svg>\n"
    )
    path.write_text(svg, encoding="utf-8")


def main() -> None:
    if not FONT_SRC.exists():
        raise SystemExit(f"missing {FONT_SRC} — download Fraunces variable TTF first")

    tiny = instance_font(opsz=9, wght=700, soft=0)
    display = instance_font(opsz=72, wght=600, soft=20)

    icon16 = render_mark(16, tiny, square=True)
    icon32 = render_mark(32, display, square=False)
    icon48 = render_mark(48, display, square=False)
    icon180 = render_mark(180, display, square=True)
    icon512 = render_mark(512, display, square=False)

    icon16.save(PUBLIC / "favicon-16.png", format="PNG", optimize=True)
    icon32.save(PUBLIC / "favicon.png", format="PNG", optimize=True)
    icon48.save(PUBLIC / "favicon-48.png", format="PNG", optimize=True)
    icon180.save(PUBLIC / "apple-touch-icon.png", format="PNG", optimize=True)
    icon512.save(PUBLIC / "logo.png", format="PNG", optimize=True)
    write_ico(PUBLIC / "favicon.ico", [icon16, icon32, icon48])
    write_svg(PUBLIC / "favicon.svg", display)

    print("wrote favicon set")
    for name in (
        "favicon-16.png",
        "favicon.png",
        "favicon-48.png",
        "favicon.ico",
        "favicon.svg",
        "apple-touch-icon.png",
        "logo.png",
    ):
        p = PUBLIC / name
        print(f"  {name:22} {p.stat().st_size:6} bytes")


if __name__ == "__main__":
    main()
