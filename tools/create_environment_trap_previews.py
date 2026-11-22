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
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont, ImageOps

ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / 'assets' / 'sprites' / 'environment-traps'
OUT = ROOT / 'docs' / 'environment-traps'
OUT.mkdir(parents=True, exist_ok=True)
SHEETS = {
    'mechanical': (SRC / 'mechanical.png', 4, 6),
    'elemental': (SRC / 'elemental.png', 4, 6),
    'nature': (SRC / 'nature.png', 4, 9),
    'environment-variations': (SRC / 'environment-variations.png', 4, 12),
}
# name, atlas, row, intended material/environment, real floor atlas pack
TRAPS = [
 ('Pressure Plate','environment-variations',0,'Crypt mechanisms, plus material variants','catacombs'),
 ('Swinging Blade','mechanical',1,'Ruins, Castle Keep, Serpentine Tower','catacombs'),
 ('Collapsing Floor','mechanical',2,'Ruins, castles, forest paths, towers','castle_keep'),
 ('Poison Vent','environment-variations',6,'Swamps and plague zones','sewers'),
 ('Flame Jet','environment-variations',8,'Infernal environments; volcanic variant','eternal_breach'),
 ('Magical Turret','environment-variations',10,'Arcane environments; Storm Crags variant','eternal_breach'),
 ('Explosive Obstacle','elemental',3,'Timber crates and iron-banded destructible props','castle_keep'),
 ('Retractable Spike Trap','mechanical',3,'Castle and frozen traps; desert variant','castle_keep'),
 ('Falling Icicles','elemental',4,'Frozen caves and mountain environments','snowy_summit'),
 ('Storm Conductor','elemental',5,'Storm Crags and charged environments','catacombs'),
 ('Quicksand Sink','mechanical',4,'Sea of Sand and desert tombs','sea_of_sand'),
 ('Unstable Crystal','nature',8,'Crystal Caverns, Void and arcane regions','eternal_breach'),
 ('Lava Fissure','nature',7,'Molten and volcanic areas','eternal_breach'),
 ('Rolling Boulder','mechanical',5,'Deserts, mountain passes and mines','sea_of_sand'),
 ('Venomous Growth','nature',0,'Swamps, plague zones and fungal caves','dark_forest'),
 ('Thorn Snare','nature',1,'Dark Forest and thorn environments','dark_forest'),
 ('Cursed Cage Trap','nature',2,'Necropolis and haunted environments','cathedral_graveyard'),
 ('Bone Spikes','nature',3,'Catacombs and undead regions','catacombs'),
 ('Explosive Rune','nature',4,'Infernal, void, siege and deep-mine regions','eternal_breach'),
 ('Cracking Ice','nature',5,'Frozen environments','snowy_summit'),
 ('Freezing Vent','nature',6,'Frozen fortresses and icebound caves','snowy_summit'),
]
VARIATIONS = [
 ('Pressure Plate — Frozen Fortress','environment-variations',1,'Ice-bound steel and snow','snowy_summit'),
 ('Pressure Plate — Desert Tomb','environment-variations',2,'Sandstone and aged brass','sea_of_sand'),
 ('Root Snare — Dark Forest','environment-variations',3,'Roots, moss and hooked vines','dark_forest'),
 ('Bone Aperture — Crypt','environment-variations',4,'Pale bone and cracked crypt stone','catacombs'),
 ('Spike Aperture — Desert Tomb','environment-variations',5,'Sandstone and bronze','sea_of_sand'),
 ('Poison Vent — Moss Swamp','environment-variations',6,'Mossy iron and toxic growth','sewers'),
 ('Poison Vent — Sewer','environment-variations',7,'Corroded iron and stagnant vapor','sewers'),
 ('Flame Jet — Infernal','environment-variations',8,'Demonic iron and embers','eternal_breach'),
 ('Flame Jet — Volcanic Forge','environment-variations',9,'Obsidian and molten rock','eternal_breach'),
 ('Turret — Arcane Crystal','environment-variations',10,'Runed stone and amethyst','eternal_breach'),
 ('Turret — Storm Crags','environment-variations',11,'Weathered granite and charged cyan crystals','catacombs'),
]

def atlas_cell(sheet, row, col):
    path, cols, rows = SHEETS[sheet]
    im = Image.open(path).convert('RGBA')
    cw, ch = im.width / cols, im.height / rows
    return im.crop((round(col*cw), round(row*ch), round((col+1)*cw), round((row+1)*ch)))

def floor_tile(pack):
    if pack == 'sea_of_sand':
        im = Image.open(ROOT/'assets'/'tiles'/pack/'floor.webp').convert('RGBA')
        tile = im.crop((2,2,162,82))
        base = (120, 98, 58, 255)
    else:
        directory = ROOT/'assets'/'tiles'/pack
        path = directory/'floors.webp'
        if not path.exists():
            # Storm Spire uses the base dungeon floor atlas with an environment tint.
            path = ROOT/'assets'/'tiles'/'catacombs'/'floors.webp'
        im = Image.open(path).convert('RGBA')
        tile = im.crop((0,0,160,80))
        base = {
            'catacombs': (58, 55, 53, 255),
            'castle_keep': (76, 68, 58, 255),
            'dark_forest': (43, 58, 39, 255),
            'sewers': (54, 67, 48, 255),
            'eternal_breach': (67, 43, 42, 255),
            'snowy_summit': (151, 160, 164, 255),
        }.get(pack, (58, 55, 53, 255))
    backdrop = Image.new('RGBA', tile.size, base)
    backdrop.alpha_composite(tile)
    return backdrop

FONT_PATHS = [r'C:\Windows\Fonts\arial.ttf', r'C:\Windows\Fonts\segoeui.ttf']
def font(size, bold=False):
    choices = [r'C:\Windows\Fonts\arialbd.ttf', *FONT_PATHS] if bold else FONT_PATHS
    for path in choices:
        if Path(path).exists():
            try: return ImageFont.truetype(path,size)
            except OSError: pass
    return ImageFont.load_default()

F_TITLE, F_META, F_STATE = font(15, True), font(12), font(12, True)
STATES = ['Idle', 'Warning', 'Active', 'Destroyed']
CARD_W, CARD_H, LABEL_W, STATE_W = 836, 254, 190, 161

def make_sheet(entries, path, title):
    im = Image.new('RGB',(CARD_W, CARD_H*len(entries)),(18,14,11))
    d = ImageDraw.Draw(im)
    d.text((14,8), title, fill=(229,201,142), font=F_TITLE)
    d.text((14,31),'Each trap: lifecycle states and scale check',fill=(177,161,136),font=F_META)
    y0=48
    for idx,entry in enumerate(entries):
        name,sheet,row,environment,pack=entry
        y=y0+idx*CARD_H
        d.rounded_rectangle((8,y+3,CARD_W-8,y+CARD_H-6),radius=5,fill=(35,27,20),outline=(91,70,45),width=1)
        title_words=name.split(); title_lines=[]; title_line=''
        for word in title_words:
            candidate=(title_line+' '+word).strip()
            if d.textbbox((0,0),candidate,font=F_TITLE)[2] > LABEL_W-25 and title_line:
                title_lines.append(title_line); title_line=word
            else: title_line=candidate
        if title_line: title_lines.append(title_line)
        for n,text in enumerate(title_lines[:2]): d.text((18,y+10+n*17),text,fill=(240,218,166),font=F_TITLE)
        words=environment.split(); lines=[]; line=''
        for word in words:
            candidate=(line+' '+word).strip()
            if d.textbbox((0,0),candidate,font=F_META)[2] > LABEL_W-25 and line:
                lines.append(line); line=word
            else: line=candidate
        if line: lines.append(line)
        env_y=y+45+max(0,len(title_lines)-1)*17
        for n,text in enumerate(lines[:5]): d.text((18,env_y+n*17),text,fill=(194,181,157),font=F_META)
        tile=ImageOps.fit(floor_tile(pack),(148,58),method=Image.Resampling.NEAREST)
        for state in range(4):
            x=LABEL_W+state*STATE_W+4
            d.text((x+5,y+12),STATES[state],fill=(232,211,168),font=F_STATE)
            # Intended-size reference sits on the actual environment floor swatch.
            ground=tile.copy().convert('RGBA')
            art=atlas_cell(sheet,row,state)
            art.thumbnail((56,56),Image.Resampling.NEAREST)
            ground.alpha_composite(art,((148-art.width)//2,(58-art.height)//2))
            im.paste(ground.convert('RGB'),(x,y+35))
            d.text((x+3,y+96),'game size',fill=(160,149,128),font=F_META)
            # The same state is shown at 2x on a dark neutral inspection background.
            big=atlas_cell(sheet,row,state)
            big.thumbnail((112,112),Image.Resampling.NEAREST)
            panel=Image.new('RGBA',(148,118),(13,11,10,255))
            panel.alpha_composite(big,((148-big.width)//2,(118-big.height)//2))
            im.paste(panel.convert('RGB'),(x,y+116))
            d.text((x+3,y+235),'2x detail',fill=(160,149,128),font=F_META)
        if idx+1<len(entries): d.line((12,y+CARD_H-2,CARD_W-12,y+CARD_H-2),fill=(76,58,38),width=1)
    im.save(path,optimize=True)

for n,start in enumerate(range(0,len(TRAPS),7),1):
    make_sheet(TRAPS[start:start+7],OUT/f'trap-review-{n:02d}.png',f'Velscour Environmental Traps — Set {n}/3')
make_sheet(VARIATIONS,OUT/'trap-environment-variations.png','Velscour Environmental Traps — Environmental Variations')
print('labeled sprite preview PNG sheets written')
