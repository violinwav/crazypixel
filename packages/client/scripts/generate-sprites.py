#!/usr/bin/env python3
"""Procedural pixel-art sprite generator for CrazyPixel.

No AI image generation, on purpose: these are hand-placed pixel grids (suits, marble) and
simple procedural patterns (card back, board tiles), scaled up with nearest-neighbor so every
edge lands on a real pixel boundary.

UI chrome (tiles, card back) is monochrome - color is reserved for cards and marbles. PALETTE
below must stay in sync by hand with ../src/game/theme.ts and ../src/styles/theme.css.

Run:    python3 generate-sprites.py
Output: ../public/sprites/*.png
"""
import math
import os

from PIL import Image, ImageDraw

OUT_DIR = os.path.join(os.path.dirname(__file__), "..", "public", "sprites")
os.makedirs(OUT_DIR, exist_ok=True)

PALETTE = {
    "bg_deep": (0x00, 0x00, 0x00),
    "bg_panel": (0x18, 0x18, 0x18),
    "bg_raised": (0x2C, 0x2C, 0x2C),
    "ink": (0xFF, 0xFF, 0xFF),
    "players": [
        (0xFF, 0x54, 0x70),  # red
        (0x3F, 0xB0, 0xFF),  # blue
        (0xFF, 0xE6, 0x6D),  # yellow
        (0x38, 0xE5, 0x8F),  # green
        (0xB9, 0x67, 0xFF),  # purple
        (0xFF, 0x9F, 0x40),  # orange
    ],
    "marble_border": (0x0A, 0x08, 0x0A),
    "suit_dark": (0x00, 0x00, 0x00),
    "suit_red": (0xD2, 0x2C, 0x50),  # 4.98:1 against a white card face - don't lighten this
    # Card colors encode *rank group*, not suit (suit affects neither rules nor art). A and K
    # share one color - both are "start a marble", same weight - and the DOM rank text on top
    # is what disambiguates them. The house-rule ranks (2/4/7/8/J/JOKER) get their own loud
    # color plus a hand-drawn icon; every other rank gets a quieter flat tone with just the
    # bevel texture. "Crazy" is reserved for the cards that actually do something crazy.
    "card_high": (0xF4, 0xC4, 0x30),  # A, K - gold
    "card_2": (0xFF, 0x2D, 0x95),  # steal
    "card_4": (0x2D, 0xE0, 0xD8),  # forward/backward
    "card_7": (0x9B, 0x4D, 0xFF),  # split
    "card_8": (0xFF, 0x8A, 0x1E),  # copy last / move 8
    "card_j": (0xE5, 0x1E, 0x3C),  # swap
    "card_plain": {
        "3": (0x4A, 0x6F, 0xA5),
        "5": (0x3E, 0x8E, 0x5B),
        "6": (0x9C, 0x5A, 0x3C),
        "9": (0x5B, 0x4A, 0x9C),
        "10": (0x2E, 0x8E, 0x8A),
        "Q": (0x9C, 0x4A, 0x8E),
    },
}


# ---------------------------------------------------------------------------
# Drawing primitives
# ---------------------------------------------------------------------------

def new_canvas(w, h):
    return Image.new("RGBA", (w, h), (0, 0, 0, 0))


def set_px(img, x, y, color):
    if 0 <= x < img.width and 0 <= y < img.height:
        img.putpixel((x, y), (*color, 255))


def fill_range(img, y, x0, x1, color):
    for x in range(x0, x1 + 1):
        set_px(img, x, y, color)


def upscale(img, factor):
    return img.resize((img.width * factor, img.height * factor), Image.Resampling.NEAREST)


def shade(color, factor):
    """factor > 1 blends toward white (lighten), factor < 1 scales toward black (darken)."""
    r, g, b = color
    if factor >= 1:
        t = factor - 1
        return (int(r + (255 - r) * t), int(g + (255 - g) * t), int(b + (255 - b) * t))
    return (int(r * factor), int(g * factor), int(b * factor))


# ---------------------------------------------------------------------------
# Suit icons: 16x16 grids, hand-placed row ranges, symmetric about the 7/8 centerline.
# ---------------------------------------------------------------------------

def make_spade(color):
    g = new_canvas(16, 16)
    single = {1: (7, 8), 2: (6, 9), 3: (5, 10), 4: (4, 11), 5: (3, 12), 6: (3, 12), 7: (2, 13)}
    for y, (a, b) in single.items():
        fill_range(g, y, a, b, color)
    notch = {8: [(2, 6), (9, 13)], 9: [(3, 6), (9, 12)], 10: [(4, 6), (9, 11)]}
    for y, ranges in notch.items():
        for a, b in ranges:
            fill_range(g, y, a, b, color)
    for y in (11, 12):
        fill_range(g, y, 7, 8, color)
    fill_range(g, 13, 6, 9, color)
    fill_range(g, 14, 5, 10, color)
    fill_range(g, 15, 5, 10, color)
    return g


def make_heart(color):
    g = new_canvas(16, 16)
    notch = {0: [(2, 6), (9, 13)], 1: [(1, 7), (8, 14)]}
    for y, ranges in notch.items():
        for a, b in ranges:
            fill_range(g, y, a, b, color)
    solid = {
        2: (0, 15), 3: (0, 15), 4: (1, 14), 5: (2, 13), 6: (3, 12), 7: (4, 11),
        8: (5, 10), 9: (6, 9), 10: (6, 9), 11: (7, 8), 12: (7, 8), 13: (7, 8),
    }
    for y, (a, b) in solid.items():
        fill_range(g, y, a, b, color)
    return g


def make_diamond(color):
    g = new_canvas(16, 16)
    ranges = [
        (7, 8), (6, 9), (5, 10), (4, 11), (3, 12), (2, 13), (1, 14), (0, 15),
        (0, 15), (1, 14), (2, 13), (3, 12), (4, 11), (5, 10), (6, 9), (7, 8),
    ]
    for y, (a, b) in enumerate(ranges):
        fill_range(g, y, a, b, color)
    return g


def make_club(color):
    # What sells "three lobes" is the silhouette pinching narrower on *both* sides between the
    # top two lobes and the bottom one. A top notch alone (the first attempt) reads as a heart
    # with a stem.
    g = new_canvas(16, 16)
    two_range = {1: [(4, 5), (10, 11)], 2: [(3, 6), (9, 12)]}
    for y, ranges in two_range.items():
        for a, b in ranges:
            fill_range(g, y, a, b, color)
    # top lobes (3) -> waist pinch (4-5) -> bottom lobe bulging back out (6-8)
    single = {3: (2, 13), 4: (3, 12), 5: (4, 11), 6: (2, 13), 7: (1, 14), 8: (2, 13), 9: (4, 11)}
    for y, (a, b) in single.items():
        fill_range(g, y, a, b, color)
    fill_range(g, 10, 6, 9, color)
    for y in (11, 12):
        fill_range(g, y, 7, 8, color)
    fill_range(g, 13, 6, 9, color)
    fill_range(g, 14, 5, 10, color)
    fill_range(g, 15, 5, 10, color)
    return g


def generate_suits():
    # Exported at native 16x16: Phaser's pixelArt nearest-neighbor scaling enlarges at render
    # time, and pre-upscaling here would make its scale factor non-integer and risk uneven
    # pixels.
    dark_makers = {"spade": make_spade, "club": make_club}
    red_makers = {"heart": make_heart, "diamond": make_diamond}
    for name, maker in dark_makers.items():
        maker(PALETTE["suit_dark"]).save(os.path.join(OUT_DIR, f"suit-{name}.png"))
    for name, maker in red_makers.items():
        maker(PALETTE["suit_red"]).save(os.path.join(OUT_DIR, f"suit-{name}.png"))
    print("suits: ok")


# ---------------------------------------------------------------------------
# Marble: player-color fill, lighter inset facet, black outline. Deliberately not round -
# it matches the flat, hard-edged goal-field tiles, with corners chamfered (a diagonal cut,
# not a curve) just enough to read as softened without becoming a circle. The inset facet is
# what tells a piece from a tile at a glance; a flat single-tone marble was too easy to
# mistake for one. No pip or count indicator - that read as busier than intended.
# ---------------------------------------------------------------------------

MARBLE_SIZE = 22
MARBLE_CORNER_CUT = 7  # chamfer depth - higher is rounder, lower is more square
MARBLE_FACET_INSET = 5  # pixels between the outer edge and the inner facet, per side
MARBLE_FACET_CORNER_CUT = 3


def _chamfered(x, y, inner, corner_cut):
    if x < 0 or y < 0 or x > inner or y > inner:
        return False
    if x + y < corner_cut:
        return False
    if (inner - x) + y < corner_cut:
        return False
    if x + (inner - y) < corner_cut:
        return False
    if (inner - x) + (inner - y) < corner_cut:
        return False
    return True


def make_marble(color, size=MARBLE_SIZE, corner_cut=MARBLE_CORNER_CUT):
    border = PALETTE["marble_border"]
    facet = shade(color, 1.4)
    inner = size - 1

    def outer_filled(x, y):
        return _chamfered(x, y, inner, corner_cut)

    def facet_filled(x, y):
        fx, fy = x - MARBLE_FACET_INSET, y - MARBLE_FACET_INSET
        facet_inner = inner - MARBLE_FACET_INSET * 2
        return _chamfered(fx, fy, facet_inner, MARBLE_FACET_CORNER_CUT)

    g = new_canvas(size, size)
    for y in range(size):
        for x in range(size):
            if not outer_filled(x, y):
                continue
            on_edge = not (outer_filled(x - 1, y) and outer_filled(x + 1, y) and outer_filled(x, y - 1) and outer_filled(x, y + 1))
            if on_edge:
                set_px(g, x, y, border)
            elif facet_filled(x, y):
                set_px(g, x, y, facet)
            else:
                set_px(g, x, y, color)
    return g


def generate_marbles():
    # One neutral marble, recolored per player at runtime (TableScene.tintedMarbleKey) rather
    # than one baked PNG per color - player color is a continuous hue picked on a slider, so
    # baking a PNG per color isn't an option. Mid-grey, not white: the recolor multiplies, and
    # a white base would multiply every non-border pixel uniformly to the tint color, losing
    # the facet highlight entirely.
    neutral = (0xA8, 0xA8, 0xA8)
    make_marble(neutral).save(os.path.join(OUT_DIR, "marble-base.png"))
    print("marbles: ok")


# ---------------------------------------------------------------------------
# Card back: monochrome panel, white double border, offset dot pattern, diamond emblem.
# Sized to match the faces below, so hand, deck stack and discard pile agree.
# ---------------------------------------------------------------------------

def make_card_back(w=108, h=152):
    g = Image.new("RGBA", (w, h), (*PALETTE["bg_panel"], 255))
    draw = ImageDraw.Draw(g)
    draw.rectangle([0, 0, w - 1, h - 1], outline=PALETTE["ink"], width=4)
    draw.rectangle([10, 10, w - 11, h - 11], outline=PALETTE["bg_raised"], width=3)

    step = 16
    row = 0
    for yy in range(26, h - 22, step):
        offset = 0 if row % 2 == 0 else step // 2
        for xx in range(18 + offset, w - 16, step):
            draw.ellipse([xx - 3, yy - 3, xx + 3, yy + 3], fill=(*PALETTE["bg_raised"], 255))
        row += 1

    cx, cy = w // 2, h // 2
    draw.polygon([(cx, cy - 18), (cx + 14, cy), (cx, cy + 18), (cx - 14, cy)], fill=(*PALETTE["ink"], 255))
    draw.polygon([(cx, cy - 11), (cx + 7, cy), (cx, cy + 11), (cx - 7, cy)], fill=(*PALETTE["bg_panel"], 255))
    return g


def generate_card_back():
    make_card_back().save(os.path.join(OUT_DIR, "card-back.png"))
    print("card back: ok")


# ---------------------------------------------------------------------------
# Card faces: one texture per rank. Authored small then 3x-upscaled, same chunky-pixel
# approach as everything else here. Rank text is NOT baked in - the DOM overlays display-font
# text on top (see CardRankIndices.tsx), so this is background color, texture and icon only.
# ---------------------------------------------------------------------------

CARD_W, CARD_H = 36, 50


def _bevel(draw, w, h, base, inset=0):
    light = shade(base, 1.35)
    dark = shade(base, 0.6)
    draw.line([(inset, inset), (w - 1 - inset, inset)], fill=(*light, 255))
    draw.line([(inset, inset), (inset, h - 1 - inset)], fill=(*light, 255))
    draw.line([(w - 1 - inset, inset), (w - 1 - inset, h - 1 - inset)], fill=(*dark, 255))
    draw.line([(inset, h - 1 - inset), (w - 1 - inset, h - 1 - inset)], fill=(*dark, 255))


def _card_base(bg_color, stripes=False):
    g = Image.new("RGBA", (CARD_W, CARD_H), (*bg_color, 255))
    draw = ImageDraw.Draw(g)
    if stripes:
        # Reserved for the "crazy" ranks: a flat fill reads calm whatever the hue, and the
        # diagonal two-tone stripe is what actually sells "loud".
        stripe = shade(bg_color, 1.2)
        for d in range(-CARD_H, CARD_W, 7):
            draw.line([(d, 0), (d + CARD_H, CARD_H)], fill=(*stripe, 255), width=3)
    draw.rectangle([0, 0, CARD_W - 1, CARD_H - 1], outline=PALETTE["bg_deep"], width=2)
    _bevel(draw, CARD_W, CARD_H, bg_color, inset=2)
    return g, draw


def _icon_color(bg_color):
    """White or near-black ink, whichever contrasts more with this card's background."""
    r, g, b = bg_color
    luminance = 0.299 * r + 0.587 * g + 0.114 * b
    return PALETTE["ink"] if luminance < 150 else PALETTE["bg_deep"]


def _icon_double_arrow(draw, cx, cy, ink):
    """Card 4, move forward OR backward: two chevrons pointing apart along one axis."""
    draw.line([(cx - 9, cy - 6), (cx - 3, cy), (cx - 9, cy + 6)], fill=(*ink, 255), width=3)
    draw.line([(cx + 9, cy - 6), (cx + 3, cy), (cx + 9, cy + 6)], fill=(*ink, 255), width=3)
    draw.line([(cx - 3, cy), (cx + 3, cy)], fill=(*ink, 255), width=3)


def _icon_burst(draw, cx, cy, ink):
    """Card 2, a surprise steal: an 8-point starburst, alternating long/short radius."""
    points = []
    for i in range(16):
        angle = math.pi * 2 * i / 16
        radius = 10 if i % 2 == 0 else 4
        points.append((cx + math.cos(angle) * radius, cy + math.sin(angle) * radius))
    draw.polygon(points, fill=(*ink, 255))


def _icon_fork(draw, cx, cy, ink):
    """Card 7, split steps across marbles: one path branching into three."""
    draw.line([(cx, cy + 10), (cx, cy)], fill=(*ink, 255), width=3)
    draw.line([(cx, cy), (cx - 9, cy - 9)], fill=(*ink, 255), width=3)
    draw.line([(cx, cy), (cx, cy - 12)], fill=(*ink, 255), width=3)
    draw.line([(cx, cy), (cx + 9, cy - 9)], fill=(*ink, 255), width=3)


def _icon_loop(draw, cx, cy, ink):
    """Card 8, move 8 OR replay the last card: a looping arrow (go again)."""
    draw.arc([cx - 10, cy - 10, cx + 10, cy + 10], start=30, end=300, fill=(*ink, 255), width=3)
    draw.polygon([(cx + 9, cy - 8), (cx + 15, cy - 4), (cx + 6, cy - 1)], fill=(*ink, 255))


def _icon_swap(draw, cx, cy, ink):
    """Jack, swap two marbles: a bold X with dots on all four tips."""
    draw.line([(cx - 9, cy - 9), (cx + 9, cy + 9)], fill=(*ink, 255), width=3)
    draw.line([(cx - 9, cy + 9), (cx + 9, cy - 9)], fill=(*ink, 255), width=3)
    for dx, dy in ((-9, -9), (9, 9), (-9, 9), (9, -9)):
        draw.ellipse([cx + dx - 2, cy + dy - 2, cx + dx + 2, cy + dy + 2], fill=(*ink, 255))


def _make_joker_face():
    # Craziest of all - a dithered mosaic of every player color, no icon needed.
    g = Image.new("RGBA", (CARD_W, CARD_H), (*PALETTE["bg_deep"], 255))
    draw = ImageDraw.Draw(g)
    cell = 4
    colors = PALETTE["players"]
    for yy in range(0, CARD_H, cell):
        for xx in range(0, CARD_W, cell):
            idx = ((xx // cell) * 3 + (yy // cell) * 5) % len(colors)
            draw.rectangle([xx, yy, xx + cell - 1, yy + cell - 1], fill=(*colors[idx], 255))
    draw.rectangle([0, 0, CARD_W - 1, CARD_H - 1], outline=PALETTE["bg_deep"], width=2)
    return g


# rank -> (palette key, icon drawer). Ranks absent here fall back to card_plain, no icon.
_ICON_CARDS = {
    "2": ("card_2", _icon_burst),
    "4": ("card_4", _icon_double_arrow),
    "7": ("card_7", _icon_fork),
    "8": ("card_8", _icon_loop),
    "J": ("card_j", _icon_swap),
}


def make_card_face(rank):
    if rank == "JOKER":
        return _make_joker_face()
    if rank in ("A", "K"):
        g, _ = _card_base(PALETTE["card_high"])
        return g
    if rank in _ICON_CARDS:
        palette_key, draw_icon = _ICON_CARDS[rank]
        color = PALETTE[palette_key]
        g, draw = _card_base(color, stripes=True)
        # The 7's fork hangs low, so its icon sits slightly below center.
        cy_offset = 4 if rank == "7" else 0
        draw_icon(draw, CARD_W // 2, CARD_H // 2 + cy_offset, _icon_color(color))
        return g
    g, _ = _card_base(PALETTE["card_plain"][rank])
    return g


def generate_card_faces():
    ranks = ["A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K", "JOKER"]
    for rank in ranks:
        upscale(make_card_face(rank), 3).save(os.path.join(OUT_DIR, f"card-face-{rank}.png"))
    print("card faces: ok")


# ---------------------------------------------------------------------------
# Board tiles: authored small then 2x-upscaled, so the bevel edges read as chunky pixels
# rather than a thin smooth border.
# ---------------------------------------------------------------------------

def make_tile(fill_color, size=11):
    g = Image.new("RGBA", (size, size), (*fill_color, 255))
    draw = ImageDraw.Draw(g)
    light = shade(fill_color, 1.35)
    dark = shade(fill_color, 0.55)
    draw.line([(0, 0), (size - 1, 0)], fill=(*light, 255))
    draw.line([(0, 0), (0, size - 1)], fill=(*light, 255))
    draw.line([(size - 1, 0), (size - 1, size - 1)], fill=(*dark, 255))
    draw.line([(0, size - 1), (size - 1, size - 1)], fill=(*dark, 255))
    return g


def generate_tiles():
    upscale(make_tile(PALETTE["bg_panel"]), 2).save(os.path.join(OUT_DIR, "tile-track.png"))
    upscale(make_tile(PALETTE["ink"]), 2).save(os.path.join(OUT_DIR, "tile-start.png"))
    upscale(make_tile(PALETTE["bg_deep"]), 2).save(os.path.join(OUT_DIR, "tile-kennel.png"))
    # Every 4th track square (see TableScene.redrawBoard): a step between plain track and
    # start, so the ring reads as countable segments, still grayscale like the rest of the UI
    # chrome. Half-bright white rather than bg_raised (0x2C is only marginally lighter than
    # bg_panel's 0x18, which read as barely distinguishable from a plain square).
    upscale(make_tile(shade(PALETTE["ink"], 0.5)), 2).save(os.path.join(OUT_DIR, "tile-quarter.png"))
    print("tiles: ok")


if __name__ == "__main__":
    generate_suits()
    generate_marbles()
    generate_card_back()
    generate_card_faces()
    generate_tiles()
    print(f"\nAll sprites written to {os.path.abspath(OUT_DIR)}")
