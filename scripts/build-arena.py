"""Converts one top-down level painting into the arena texture.

    python3 scripts/build-arena.py assets/raw/level-1.jpg

Deliberately almost nothing: a resize, an alpha key, and one measured
rescale of the checker. Everything else about
*where* the painting goes — which rows are the ground, which are the ruins,
how its arena is stretched onto ROOM_WIDTH x ROOM_DEPTH — is UV arithmetic in
`src/three/world.ts`, against the pixel coordinates named there. Cropping and
re-compositing here would only be doing a mapping's job in Pillow, and would
hide the source image's own coordinates behind a bake.

The alpha key is the one thing a mapping cannot do: the painting leaves a
near-black void around the ruins, JPEG has no alpha channel, and without one
the ruins are a black rectangle standing at the far wall. The doorway keys
out with the rest of the void, which is the point — it becomes a hole.

The checker rescale is the other. In the real game's own frames the squares
measure 156 x 157 px — square on *screen*, under a camera tilted ~52 degrees,
which means its painted squares are about 1.26x long in z. This painting's
are square in its own pixels, and its field is 1034 px wide by 1635 tall for
a room 9 by 16, so through that mapping they land at 0.84 tall-to-wide. No
resize can fix it: scaling the file scales the squares with it and the ratio
cancels. What has to change is how many rows of squares the field holds, so
the field is scaled up in y and cropped back to its own height. Nothing
outside the coral border moves, so every coordinate in world.ts still means
what it meant.
"""
import math
import os
import sys
from PIL import Image

SRC = sys.argv[1] if len(sys.argv) > 1 else "assets/raw/level-1.jpg"
DST = os.path.join(os.path.dirname(__file__), "..", "assets", "arena.webp")

# 70 px per world unit, against the 114.9 the painting is drawn at: the
# texture is only ever seen at a 48.5-degree glance and the arena is nine
# units of a phone's width.
SCALE = 70 / 114.9

# The arena field, coral border to coral border, and the room it maps onto —
# the same numbers `src/three/world.ts` works from.
FIELD = (93, 465, 1127, 2100)
ROOM_W, ROOM_D = 9, 16
ELEVATION = math.radians(48.5)

im = Image.open(SRC).convert("RGBA")

# How tall a painted square reads against its own width, on screen, as things
# stand. The real game's read 1.0; see the note above.
field_w = FIELD[2] - FIELD[0]
field_h = FIELD[3] - FIELD[1]
read = (field_w / field_h) * (ROOM_D / ROOM_W) * math.sin(ELEVATION)

# Taller squares, same field: scaled up in y about its far edge, then cropped
# back. What the crop loses is the near end, which the painting had already
# cut off, and what it loses is more of the same checker.
field = im.crop(FIELD)
field = field.resize(
    (field_w, round(field_h / read)), Image.LANCZOS
).crop((0, 0, field_w, field_h))
im.paste(field, (FIELD[0], FIELD[1]))
print(f"checker read {read:.3f} tall-to-wide; field rows rescaled by {1 / read:.3f}")
px = im.load()
for y in range(im.size[1]):
    for x in range(im.size[0]):
        r, g, b, _ = px[x, y]
        if r < 55 and g < 70 and b < 30:
            px[x, y] = (r, g, b, 0)

out = im.resize(
    (round(im.size[0] * SCALE), round(im.size[1] * SCALE)), Image.LANCZOS
)
out.save(DST, "WEBP", quality=84, method=6)
print(f"arena.webp {out.size} {os.path.getsize(DST) / 1024:.1f} KB  (source {im.size})")
