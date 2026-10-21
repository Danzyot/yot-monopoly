# Contact sheet of the stills: desktop ones 3 across, phone ones beside them; each labelled with
# its name, frame count and frame size. Usage: make-sheet.py <screens dir> <out.png>
import sys, os, glob
from PIL import Image, ImageDraw, ImageFont
root, out = sys.argv[1], sys.argv[2]
font = ImageFont.truetype(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'nunito-800.ttf'), 22)
DESK = ['home', 'hub', 'poker-lobby', 'poker-table', 'cards-table', 'monopoly-game']
PHONE = ['dailies-phone', 'home-phone']
W, H, L, G = 640, 360, 58, 12
PH = H * 2 + L  # phone thumbs span two desktop rows
pw = round(PH * 1170 / 2532)
sheet = Image.new('RGB', (G + 3 * (W + G) + len(PHONE) * (pw + G), G + 2 * (H + L + G)), (18, 12, 30))
d = ImageDraw.Draw(sheet)
def info(n):
    fs = sorted(glob.glob(f'{root}/{n}/*.png'))
    size = Image.open(fs[0]).size if fs else (0, 0)
    return f'{n}\n{len(fs)} frames · {size[0]}x{size[1]}'
def place(n, x, y, w, h):
    p = f'{root}/{n}.png'
    if os.path.exists(p):
        im = Image.open(p).convert('RGB'); im.thumbnail((w, h)); sheet.paste(im, (x, y + L))
    d.multiline_text((x, y + 2), info(n), font=font, fill=(255, 220, 240), spacing=2)
for k, n in enumerate(DESK):
    place(n, G + (k % 3) * (W + G), G + (k // 3) * (H + L + G), W, H)
for k, n in enumerate(PHONE):
    place(n, G + 3 * (W + G) + k * (pw + G), G, pw, PH)
sheet.save(out)
print(out, sheet.size)
