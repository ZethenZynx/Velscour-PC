from pathlib import Path
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / 'assets' / 'sprites' / 'environment-traps'
OUT = ROOT / 'docs' / 'environment-traps' / 'gifs'
OUT.mkdir(parents=True, exist_ok=True)
SHEETS = {
    'mechanical': (SRC / 'mechanical.png', 4, 6),
    'elemental': (SRC / 'elemental.png', 4, 6),
    'nature': (SRC / 'nature.png', 4, 9),
    'environment-variations': (SRC / 'environment-variations.png', 4, 12),
}

def frame(sheet_id, row, col):
    path, cols, rows = SHEETS[sheet_id]
    source = Image.open(path).convert('RGBA')
    cw, ch = source.width / cols, source.height / rows
    box = (round(col * cw), round(row * ch), round((col + 1) * cw), round((row + 1) * ch))
    tile = source.crop(box)
    target_w = 112
    target_h = max(1, round(tile.height * target_w / tile.width))
    tile = tile.resize((target_w, target_h), Image.Resampling.NEAREST)
    canvas = Image.new('RGBA', (160, 160), (0, 0, 0, 0))
    canvas.alpha_composite(tile, ((160 - target_w) // 2, 150 - target_h))
    rgb = canvas.convert('RGB').quantize(colors=255, method=Image.Quantize.FASTOCTREE, dither=Image.Dither.NONE)
    px = bytearray(rgb.tobytes())
    alpha = canvas.getchannel('A').tobytes()
    for i in range(len(px)):
        px[i] = px[i] + 1 if alpha[i] >= 8 else 0
    out = Image.frombytes('P', canvas.size, bytes(px))
    palette = rgb.getpalette() or [0] * 768
    out.putpalette([0, 0, 0] + palette[:765])
    out.info['transparency'] = 0
    out.info['duration'] = 180
    out.info['disposal'] = 2
    return out

previews = {
    'swinging-blade.gif': ('mechanical', 1, [0, 1, 2, 1, 0]),
    'retractable-spikes.gif': ('mechanical', 3, [0, 1, 2, 1, 0]),
    'rolling-boulder.gif': ('mechanical', 5, [0, 1, 2, 2, 3]),
    'falling-icicles.gif': ('elemental', 4, [0, 1, 2, 3]),
    'arcane-turret.gif': ('environment-variations', 10, [0, 1, 2, 2, 3]),
    'volcanic-flame-jet.gif': ('environment-variations', 9, [0, 1, 2, 2, 3]),
}
for name, (sheet, row, states) in previews.items():
    frames = [frame(sheet, row, col) for col in states]
    frames[0].save(OUT / name, save_all=True, append_images=frames[1:], duration=180, loop=0, disposal=2, transparency=0, optimize=False)
    print(f'{name}: {len(frames)} frames')
