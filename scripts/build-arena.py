"""Converts one top-down level painting into the arena texture.

    python3 scripts/build-arena.py assets/raw/level-1.jpg

Four steps, no crop or re-composite: placement is UV arithmetic in
src/three/world.ts against the source image's own pixel coordinates, so those
coordinates must survive.

- Alpha key: the painting has a near-black void around the ruins and JPEG has
  no alpha, so without this the ruins are a black rectangle. The doorway keys
  out too and becomes a hole.
- Checker rescale: the reference game's squares read square on screen under
  its tilted camera, so its painted squares are ~1.26x long in z. This
  painting's are square in pixels, which through the room mapping reads 0.84
  tall-to-wide. Resizing the file cannot fix a ratio, so the field is scaled
  up in y and cropped back to its own height. Nothing outside the border moves.
- Near lip and apron: the painting ends on a row of checker, and the ground
  plane reaches past the near wall, so texture clamping repeated arena where
  there is none. The near border is drawn here and a flat green apron added
  below it for clamping to repeat.
"""
import math
import os
import sys
from PIL import Image

SRC = sys.argv[1] if len(sys.argv) > 1 else "assets/raw/level-1.jpg"
DST = os.path.join(os.path.dirname(__file__), "..", "assets", "arena.webp")

# 70 px per world unit, down from the painting's 114.9. Seen at a 48.5-degree
# glance across nine units of phone width.
SCALE = 70 / 114.9

# Arena field, border to border, and the room it maps onto. Same numbers as
# src/three/world.ts.
FIELD = (93, 465, 1127, 2100)
ROOM_W, ROOM_D = 9, 16
ELEVATION = math.radians(48.5)

# LIP is the painting's own side-border width in px, drawn on the fourth side
# inside the field: FIELD's edges are the border's outer edge, so clampToRoom
# stops a body on the line.
# APRON is how far the plate reaches past the near wall before clamping takes
# over (GROUND_NEAR minus the wall, in field rows).
LIP = 12
APRON = round(4.2 * (FIELD[3] - FIELD[1]) / ROOM_D)

# Sampled off the painting's surround and side border. Flat, because clamping
# repeats the last row and a textured row repeats as streaks.
SURROUND = (141, 200, 34, 255)
CORAL = (183, 136, 61, 255)

im = Image.open(SRC).convert("RGBA")

# How tall a painted square reads against its width on screen. Target is 1.0.
field_w = FIELD[2] - FIELD[0]
field_h = FIELD[3] - FIELD[1]
read = (field_w / field_h) * (ROOM_D / ROOM_W) * math.sin(ELEVATION)

# Scale the field up in y about its far edge, crop back to its height. The crop
# loses the near end, which is more of the same checker.
field = im.crop(FIELD)
field = field.resize(
    (field_w, round(field_h / read)), Image.LANCZOS
).crop((0, 0, field_w, field_h))
im.paste(field, (FIELD[0], FIELD[1]))
print(f"checker read {read:.3f} tall-to-wide; field rows rescaled by {1 / read:.3f}")

grown = Image.new("RGBA", (im.size[0], im.size[1] + APRON), SURROUND)
grown.paste(im, (0, 0))
grown.paste(
    Image.new("RGBA", (FIELD[2] - FIELD[0], LIP), CORAL),
    (FIELD[0], FIELD[3] - LIP),
)
im = grown
print(f"near lip {LIP} px, apron {APRON} px; IMAGE_H in world.ts is now {im.size[1]}")

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
