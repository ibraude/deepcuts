#!/usr/bin/env python3
"""Generate a 1200x630 og-image.png for social sharing.

Solid near-black background, DEEPCUTS wordmark centered, small tagline below.
Matches the site's aesthetic (Direction A — Gallery on Black).
"""

from PIL import Image, ImageDraw, ImageFont
import os

WIDTH, HEIGHT = 1200, 630
BG = (10, 10, 10)         # --bg
INK = (245, 245, 245)     # --ink
MUTED = (122, 122, 122)   # --muted

OUT = os.path.join(os.path.dirname(__file__), '..', 'public', 'og-image.png')

# Candidate font paths — first one that exists wins.
FONT_CANDIDATES_BOLD = [
    '/System/Library/Fonts/Helvetica.ttc',
    '/System/Library/Fonts/HelveticaNeue.ttc',
    '/System/Library/Fonts/Supplemental/Arial.ttf',
]

def pick_font(size: int) -> ImageFont.FreeTypeFont:
    for path in FONT_CANDIDATES_BOLD:
        if os.path.exists(path):
            try:
                return ImageFont.truetype(path, size)
            except Exception:
                continue
    return ImageFont.load_default()

img = Image.new('RGB', (WIDTH, HEIGHT), BG)
draw = ImageDraw.Draw(img)

# Wordmark
wordmark = 'DEEPCUTS'
font_word = pick_font(120)
bbox = draw.textbbox((0, 0), wordmark, font=font_word)
w = bbox[2] - bbox[0]
h = bbox[3] - bbox[1]
x = (WIDTH - w) // 2
y = (HEIGHT - h) // 2 - 40
draw.text((x, y), wordmark, fill=INK, font=font_word)

# Tagline
tag = 'LISTENING DOCUMENTARIES FOR MUSIC FANS'
font_tag = pick_font(24)
bbox2 = draw.textbbox((0, 0), tag, font=font_tag)
w2 = bbox2[2] - bbox2[0]
draw.text(((WIDTH - w2) // 2, y + h + 40), tag, fill=MUTED, font=font_tag)

img.save(OUT, 'PNG')
print(f'wrote {OUT}')
