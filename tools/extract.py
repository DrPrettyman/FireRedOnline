#!/usr/bin/env python3
"""Extract FireRed data from a local pret/firered checkout into web-friendly assets.

Output goes to public/gen/ (gitignored). Nothing here ships game content in the repo;
everything is regenerated from the decomp the user points us at.

Usage: python3 tools/extract.py [--decomp PATH] [--out PATH]
"""
import argparse
import json
import os
import re
import struct
import sys
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
DEFAULT_DECOMP = os.environ.get("FIRERED_DECOMP", str(ROOT.parent / "pret" / "firered"))

# include/fieldmap.h
NUM_TILES_IN_PRIMARY = 640
NUM_METATILES_IN_PRIMARY = 640
NUM_PALS_IN_PRIMARY = 7
NUM_METATILES_TOTAL = 1024
ATLAS_COLS = 32  # 32x32 metatiles of 16px -> 512x512 atlas

# src/fieldmap.c sMetatileAttrMasks
ATTR_BEHAVIOR_MASK = 0x000001FF
ATTR_ENCOUNTER_SHIFT, ATTR_ENCOUNTER_MASK = 24, 0x7
ATTR_LAYER_SHIFT, ATTR_LAYER_MASK = 29, 0x3
LAYER_NORMAL, LAYER_COVERED, LAYER_SPLIT = 0, 1, 2


def read_jasc(path):
    lines = Path(path).read_text().split()
    # "JASC-PAL" "0100" "16" then r g b triples
    n = int(lines[2])
    vals = list(map(int, lines[3 : 3 + n * 3]))
    return [tuple(vals[i : i + 3]) for i in range(0, n * 3, 3)]


def load_indexed(path):
    img = Image.open(path)
    if img.mode != "P":
        raise ValueError(f"{path} is not an indexed PNG (mode {img.mode})")
    return img


# ---------------------------------------------------------------- tilesets


class Tileset:
    def __init__(self, decomp, symbol, paths):
        self.symbol = symbol
        self.folder = decomp / paths["folder"]
        self.tiles = load_indexed(decomp / paths["tiles"])
        self.tile_cols = self.tiles.width // 8
        self.tile_count = self.tile_cols * (self.tiles.height // 8)
        self.tile_px = self.tiles.load()
        raw = (self.folder / "metatiles.bin").read_bytes()
        self.metatiles = [struct.unpack_from("<8H", raw, i) for i in range(0, len(raw) - 15, 16)]
        raw = (self.folder / "metatile_attributes.bin").read_bytes()
        self.attrs = [struct.unpack_from("<I", raw, i)[0] for i in range(0, len(raw) - 3, 4)]
        self.palettes = [read_jasc(decomp / p) for p in paths["palettes"]]


def parse_tileset_symbols(decomp):
    """Map gTileset_X -> {folder, tiles, palettes} by following headers.h into graphics.h/metatiles.h.

    Tilesets may share graphics (e.g. Silph Co uses another folder's tiles), so never assume paths.
    """
    td = decomp / "src/data/tilesets"
    headers = (td / "headers.h").read_text()
    metatiles_h = (td / "metatiles.h").read_text()
    # Some tile/palette symbols live in src/graphics.c rather than the tileset headers.
    graphics_h = (td / "graphics.h").read_text() + (decomp / "src/graphics.c").read_text()
    meta_paths = dict(re.findall(r"const u16 (gMetatiles_\w+)\[\] = INCBIN_U16\(\"(.+?)/metatiles\.bin\"\)", metatiles_h))
    tile_paths = {
        sym: re.sub(r"\.4bpp(\.lz)?$", ".png", path)
        for sym, path in re.findall(r"const u32 (gTilesetTiles_\w+)\[\] = INCBIN_U32\(\"(.+?)\"\)", graphics_h)
    }
    pal_paths = {
        sym: [re.sub(r"\.gbapal$", ".pal", p) for p in re.findall(r"INCBIN_U16\(\"(.+?)\"\)", body)]
        for sym, body in re.findall(r"const u16 (gTilesetPalettes_\w+)\[\]\[16\] =\s*\{(.*?)\};", graphics_h, re.S)
    }
    out = {}
    for name, body in re.findall(r"const struct Tileset (gTileset_\w+) =\s*\{(.*?)\};", headers, re.S):
        fields = dict(re.findall(r"\.(\w+)\s*=\s*(\w+)", body))
        try:
            out[name] = {
                "folder": meta_paths[fields["metatiles"]],
                "tiles": tile_paths[fields["tiles"]],
                "palettes": pal_paths[fields["palettes"]],
            }
        except KeyError as e:
            print(f"  tileset {name}: unresolved {e}", file=sys.stderr)
    return out


def depends_on_secondary(entries):
    """True if a primary metatile uses secondary palettes (7+) or tiles, so its look varies per pair."""
    return any(((e >> 12) & 0xF) >= NUM_PALS_IN_PRIMARY or (e & 0x3FF) >= NUM_TILES_IN_PRIMARY for e in entries)


def metatile_attrs(ts):
    """Per-metatile attributes for one tileset (independent of which tileset it is paired with)."""
    out = {"behaviors": [], "layers": [], "encounters": []}
    for i in range(len(ts.metatiles)):
        attr = ts.attrs[i] if i < len(ts.attrs) else 0
        out["behaviors"].append(attr & ATTR_BEHAVIOR_MASK)
        out["layers"].append((attr >> ATTR_LAYER_SHIFT) & ATTR_LAYER_MASK)
        out["encounters"].append((attr >> ATTR_ENCOUNTER_SHIFT) & ATTR_ENCOUNTER_MASK)
    return out


def render_atlas(slots, primary, secondary):
    """Render metatiles into 'below' and 'above' atlases, ATLAS_COLS per row, one slot per metatile.

    `slots` is a list of (entries, layer_type) or None for an empty slot. FRLG metatiles have two
    layers of 2x2 tiles; depending on layer type the top layer is drawn above or below object
    sprites, so we bake that split into two images.
    """
    palettes = primary.palettes[:NUM_PALS_IN_PRIMARY] + (secondary or primary).palettes[NUM_PALS_IN_PRIMARY:]
    backdrop = palettes[0][0]
    rows = max(1, -(-len(slots) // ATLAS_COLS))
    below = Image.new("RGBA", (ATLAS_COLS * 16, rows * 16), (0, 0, 0, 0))
    above = Image.new("RGBA", below.size, (0, 0, 0, 0))
    bpx, apx = below.load(), above.load()

    def draw_tile(px, entry, ox, oy, fill_backdrop):
        tile = entry & 0x3FF
        hflip, vflip = entry & 0x400, entry & 0x800
        pal = palettes[(entry >> 12) & 0xF]
        if tile < NUM_TILES_IN_PRIMARY:
            ts, t = primary, tile
        else:
            ts, t = secondary, tile - NUM_TILES_IN_PRIMARY
        in_range = ts is not None and t < ts.tile_count
        sx, sy = (t % ts.tile_cols) * 8 if in_range else 0, (t // ts.tile_cols) * 8 if in_range else 0
        for y in range(8):
            for x in range(8):
                c = 0
                if in_range:
                    c = ts.tile_px[sx + (7 - x if hflip else x), sy + (7 - y if vflip else y)] & 0xF
                if c:
                    px[ox + x, oy + y] = pal[c] + (255,)
                elif fill_backdrop:
                    px[ox + x, oy + y] = backdrop + (255,)

    for slot, item in enumerate(slots):
        if item is None:
            continue
        entries, layer = item
        mx, my = (slot % ATLAS_COLS) * 16, (slot // ATLAS_COLS) * 16
        top_target = bpx if layer == LAYER_COVERED else apx
        for i in range(4):
            ox, oy = mx + (i % 2) * 8, my + (i // 2) * 8
            draw_tile(bpx, entries[i], ox, oy, True)
            draw_tile(top_target, entries[4 + i], ox, oy, False)
    return below, above


def render_primary(primary):
    """Atlas of the primary's metatiles 0..639. Pair-dependent ones are left blank (see render_pair)."""
    attrs = metatile_attrs(primary)
    slots = [
        None if depends_on_secondary(m) else (m, attrs["layers"][i])
        for i, m in enumerate(primary.metatiles[:NUM_METATILES_IN_PRIMARY])
    ]
    return render_atlas(slots, primary, None)


def render_pair(primary, secondary):
    """Atlas of a pair's own content: secondary metatiles 640..1023 in slots 0..383, then the
    primary metatiles whose appearance depends on the secondary (listed in `overrides`)."""
    sec_attrs, prim_attrs = metatile_attrs(secondary), metatile_attrs(primary)
    n_sec = NUM_METATILES_TOTAL - NUM_METATILES_IN_PRIMARY
    slots = [(m, sec_attrs["layers"][i]) for i, m in enumerate(secondary.metatiles[:n_sec])]
    slots += [None] * (n_sec - len(slots))
    overrides = [i for i, m in enumerate(primary.metatiles[:NUM_METATILES_IN_PRIMARY]) if depends_on_secondary(m)]
    slots += [(primary.metatiles[i], prim_attrs["layers"][i]) for i in overrides]
    below, above = render_atlas(slots, primary, secondary)
    return below, above, overrides


# ---------------------------------------------------------------- maps


def extract_maps(decomp, out, ts_folders):
    layouts_json = json.loads((decomp / "data/layouts/layouts.json").read_text())
    layouts = {l["id"]: l for l in layouts_json["layouts"] if l.get("id")}
    maps_dir = decomp / "data/maps"
    tilesets = {}
    pairs = {}
    index = {}
    (out / "maps").mkdir(parents=True, exist_ok=True)

    def get_tileset(sym):
        if sym not in tilesets:
            tilesets[sym] = Tileset(decomp, sym, ts_folders[sym])
        return tilesets[sym]

    for map_dir in sorted(maps_dir.iterdir()):
        mj = map_dir / "map.json"
        if not mj.exists():
            continue
        m = json.loads(mj.read_text())
        layout = layouts.get(m["layout"])
        if not layout:
            print(f"  skip {m['name']}: no layout {m['layout']}", file=sys.stderr)
            continue
        w, h = layout["width"], layout["height"]
        blocks = list(struct.unpack(f"<{w*h}H", (decomp / layout["blockdata_filepath"]).read_bytes()[: w * h * 2]))
        bw, bh = layout["border_width"], layout["border_height"]
        border = list(struct.unpack(f"<{bw*bh}H", (decomp / layout["border_filepath"]).read_bytes()[: bw * bh * 2]))
        pair_key = f"{layout['primary_tileset']}__{layout['secondary_tileset']}".replace("gTileset_", "")
        pairs[pair_key] = (layout["primary_tileset"], layout["secondary_tileset"])
        data = {
            "id": m["id"],
            "name": m["name"],
            "width": w,
            "height": h,
            "blocks": blocks,
            "borderWidth": bw,
            "borderHeight": bh,
            "border": border,
            "tilesetPair": pair_key,
            "music": m.get("music"),
            "weather": m.get("weather"),
            "mapType": m.get("map_type"),
            "regionMapSection": m.get("region_map_section"),
            "allowCycling": m.get("allow_cycling"),
            "allowRunning": m.get("allow_running"),
            "showMapName": m.get("show_map_name"),
            "connections": m.get("connections") or [],
            "objectEvents": m.get("object_events") or [],
            "warpEvents": m.get("warp_events") or [],
            "coordEvents": m.get("coord_events") or [],
            "bgEvents": m.get("bg_events") or [],
        }
        (out / "maps" / f"{m['name']}.json").write_text(json.dumps(data, separators=(",", ":")))
        index[m["id"]] = m["name"]

    (out / "maps" / "index.json").write_text(json.dumps(index, indent=1))
    print(f"  {len(index)} maps")

    ts_dir = out / "tilesets"
    ts_dir.mkdir(parents=True, exist_ok=True)
    for old in ts_dir.glob("*.png"):
        old.unlink()
    short = lambda sym: sym.replace("gTileset_", "")
    index = {"primaries": {}, "secondaries": {}, "pairs": {}}
    for p in sorted({p for p, _ in pairs.values()}):
        below, above = render_primary(get_tileset(p))
        below.save(ts_dir / f"{short(p)}_below.png", optimize=True)
        above.save(ts_dir / f"{short(p)}_above.png", optimize=True)
        index["primaries"][short(p)] = metatile_attrs(get_tileset(p))
    for s_ in sorted({s_ for _, s_ in pairs.values()}):
        index["secondaries"][short(s_)] = metatile_attrs(get_tileset(s_))
    for key, (p, s_) in sorted(pairs.items()):
        below, above, overrides = render_pair(get_tileset(p), get_tileset(s_))
        below.save(ts_dir / f"{key}_below.png", optimize=True)
        above.save(ts_dir / f"{key}_above.png", optimize=True)
        index["pairs"][key] = {"primary": short(p), "secondary": short(s_), "overrides": overrides}
    (ts_dir / "index.json").write_text(json.dumps(index, separators=(",", ":")))
    (ts_dir / "attributes.json").unlink(missing_ok=True)
    print(f"  {len(pairs)} tileset pairs")


# ---------------------------------------------------------------- object event sprites


def extract_object_events(decomp, out):
    od = decomp / "src/data/object_events"
    pointers = dict(
        re.findall(r"\[(OBJ_EVENT_GFX_\w+)\]\s*=\s*&(gObjectEventGraphicsInfo_\w+)", (od / "object_event_graphics_info_pointers.h").read_text())
    )
    infos = {}
    for name, body in re.findall(r"const struct ObjectEventGraphicsInfo (\w+) = \{(.*?)\};", (od / "object_event_graphics_info.h").read_text(), re.S):
        fields = dict(re.findall(r"\.(\w+)\s*=\s*([^,]+),", body))
        infos[name] = fields
    pic_tables = {}
    for name, body in re.findall(r"static const struct SpriteFrameImage (\w+)\[\] = \{(.*?)\};", (od / "object_event_pic_tables.h").read_text(), re.S):
        frames = []
        for m in re.finditer(r"overworld_frame\((\w+),\s*(\d+),\s*(\d+),\s*(\d+)\)|obj_frame_tiles\((\w+)\)", body):
            if m.group(1):
                frames.append((m.group(1), int(m.group(4))))
            else:
                frames.append((m.group(5), None))
        pic_tables[name] = frames
    gfx_h = (od / "object_event_graphics.h").read_text()
    pic_paths = {k: v for k, v in re.findall(r"(\w+)\[\] = INCBIN_\w+\(\"(.+?)\"\)", gfx_h)}

    movement_c = (decomp / "src/event_object_movement.c").read_text()
    pal_by_tag = {tag: sym for sym, tag in re.findall(r"\{\s*(gObjectEventPal_\w+),\s*(OBJ_EVENT_PAL_TAG_\w+)\s*\}", movement_c)}

    def png_for(sym):
        p = pic_paths.get(sym)
        if not p:
            return None
        return decomp / re.sub(r"\.(4bpp|gbapal)(\.lz)?$", ".png", p)

    def pal_for(tag):
        sym = pal_by_tag.get(tag)
        if not sym or sym not in pic_paths:
            return None
        path = decomp / re.sub(r"\.gbapal$", ".pal", pic_paths[sym])
        return read_jasc(path) if path.exists() else None

    # GetColorFromTextColorTable: one nibble per graphics id (NPC_TEXT_COLOR_MALE/FEMALE/MON/NEUTRAL).
    color_src = (decomp / "src/dynamic_placeholder_text_util.c").read_text()
    gfx_ids = {n: int(v, 0) for n, v in re.findall(r"#define\s+(OBJ_EVENT_GFX_\w+)\s+(0x[0-9A-Fa-f]+|\d+)", (decomp / "include/constants/event_objects.h").read_text())}
    npc_colors = {n: int(v, 0) for n, v in re.findall(r"#define\s+(NPC_TEXT_COLOR_\w+)\s+(\d+)", (decomp / "include/constants/vars.h").read_text())}
    colors_by_gfx = {}
    for name, low, high in re.findall(r"\[(OBJ_EVENT_GFX_\w+)\s*/\s*2\]\s*=\s*COLORS\((\w+),\s*(\w+)\)", color_src):
        base = gfx_ids.get(name)
        if base is not None:
            colors_by_gfx[base & ~1] = npc_colors.get(low, 3)
            colors_by_gfx[(base & ~1) | 1] = npc_colors.get(high, 3)

    def text_color(gfx_id):
        n = gfx_ids.get(gfx_id)
        return colors_by_gfx.get(n, 3) if n is not None else 3

    (out / "sprites").mkdir(parents=True, exist_ok=True)
    manifest = {}
    written = {}
    for gfx_id, info_name in pointers.items():
        info = infos.get(info_name)
        if not info:
            continue
        table = pic_tables.get(info.get("images", ""))
        if not table:
            continue
        fw, fh = int(info["width"]), int(info["height"])
        key = info_name.replace("gObjectEventGraphicsInfo_", "")
        if key not in written:
            pal = pal_for(info.get("paletteTag", ""))
            strip = Image.new("RGBA", (fw * len(table), fh), (0, 0, 0, 0))
            ok = True
            for i, (sym, frame) in enumerate(table):
                path = png_for(sym)
                if not path or not path.exists():
                    ok = False
                    break
                img = Image.open(path)
                if frame is None:
                    sx, sy = 0, 0
                else:
                    cols = max(1, img.width // fw)
                    sx, sy = (frame % cols) * fw, (frame // cols) * fh
                cell = img.crop((sx, sy, sx + fw, sy + fh))
                if img.mode == "P":
                    idx = cell.load()
                    rgba = Image.new("RGBA", (fw, fh), (0, 0, 0, 0))
                    rp = rgba.load()
                    colors = pal or [tuple(img.getpalette()[c * 3 : c * 3 + 3]) for c in range(16)]
                    for y in range(fh):
                        for x in range(fw):
                            c = idx[x, y] & 0xF
                            if c:
                                rp[x, y] = colors[c] + (255,)
                    cell = rgba
                else:
                    cell = cell.convert("RGBA")
                strip.paste(cell, (i * fw, 0))
            if not ok:
                print(f"  skip sprite {key}: missing image", file=sys.stderr)
                continue
            strip.save(out / "sprites" / f"{key}.png", optimize=True)
            written[key] = {
                "key": key,
                "frameWidth": fw,
                "frameHeight": fh,
                "frameCount": len(table),
                "anims": info.get("anims", "").strip(),
                "inanimate": info.get("inanimate", "FALSE").strip() == "TRUE",
            }
        manifest[gfx_id] = {**written[key], "textColor": text_color(gfx_id)}
    (out / "sprites" / "manifest.json").write_text(json.dumps(manifest, indent=1))
    print(f"  {len(written)} sprite sheets, {len(manifest)} gfx ids")


# ---------------------------------------------------------------- text: charmap, fonts, windows


def parse_charmap(decomp):
    """charmap.txt -> {chars: {'A': [0xBB]}, names: {'PLAYER': [0xFD, 0x01]}} (as preproc reads it)."""
    chars, names = {}, {}
    for line in (decomp / "charmap.txt").read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("@"):
            continue
        m = re.match(r"^'((?:\\.|[^'])+)'\s*=\s*([0-9A-Fa-f ]+)", line) or re.match(r"^(\w+)\s*=\s*([0-9A-Fa-f ]+)", line)
        if not m:
            continue
        key, val = m.group(1), [int(b, 16) for b in m.group(2).split()]
        if line.startswith("'") and key in ("\\'", "\\\\"):
            key = key[1]  # '\'' -> ', '\\' -> \
        if line.startswith("'"):
            chars.setdefault(key, val)
        else:
            names.setdefault(key, val)
    return {"chars": chars, "names": names}


FONT_IDS = {"Small": 0, "NormalCopy1": 1, "Normal": 2, "NormalCopy2": 3, "Male": 4, "Female": 5}


def extract_text_assets(decomp, out):
    td = out / "text"
    td.mkdir(parents=True, exist_ok=True)
    (td / "charmap.json").write_text(json.dumps(parse_charmap(decomp), ensure_ascii=False, separators=(",", ":")))

    # Fonts: latin glyph sheets (16x16 cells, 16 per row, indexed by charmap byte). 2bpp values:
    # 1 = foreground, 2 = shadow, 0/3 = background (sFontHalfRowOffsets maps 3 like 0).
    text_c = (decomp / "src/text.c").read_text()
    glyph_imgs = dict(re.findall(r"static const u16 sFont(\w+)LatinGlyphs\[\] = INCBIN_U16\(\"(.+?)\.latfont\"\)", text_c))
    widths = {
        name: [int(v) for v in re.findall(r"\d+", body)]
        for name, body in re.findall(r"static const u8 sFont(\w+)LatinGlyphWidths\[\] =\s*\{(.*?)\};", text_c, re.S)
    }
    infos = {}
    menu_c = (decomp / "src/new_menu_helpers.c").read_text()
    for font, body in re.findall(r"\[(FONT_\w+)\]\s*=\s*\{(.*?)\}", menu_c, re.S):
        f = dict(re.findall(r"\.(\w+)\s*=\s*(\w+)", body))
        if "maxLetterWidth" in f:
            infos[font] = {k: int(f[k], 0) for k in ("maxLetterWidth", "maxLetterHeight", "letterSpacing", "lineSpacing", "fgColor", "bgColor", "shadowColor")}
    id_to_const = {0: "FONT_SMALL", 1: "FONT_NORMAL_COPY_1", 2: "FONT_NORMAL", 3: "FONT_NORMAL_COPY_2", 4: "FONT_MALE", 5: "FONT_FEMALE"}
    fonts = {}
    written = set()
    for name, path in glyph_imgs.items():
        if name not in FONT_IDS or name not in widths:
            continue
        img_name = Path(path).name
        if img_name not in written:
            src = Image.open(decomp / f"{path}.png")
            px = src.load()
            mask = Image.new("L", src.size, 0)
            mp = mask.load()
            for y in range(src.height):
                for x in range(src.width):
                    v = px[x, y]
                    mp[x, y] = 255 if v == 1 else 128 if v == 2 else 0
            mask.save(td / f"{img_name}.png", optimize=True)
            written.add(img_name)
        fid = FONT_IDS[name]
        fonts[fid] = {"name": name, "image": img_name, "widths": widths[name], **infos.get(id_to_const[fid], {})}

    # Dialogue frame (menu_message) + down arrow, rendered with the text window palette (stdpal_0).
    pal = read_jasc(decomp / "graphics/text_window/stdpal_0.pal")

    def render_indexed(src_path, dst_name):
        src = Image.open(src_path)
        px = src.load()
        dst = Image.new("RGBA", src.size, (0, 0, 0, 0))
        dp = dst.load()
        for y in range(src.height):
            for x in range(src.width):
                c = px[x, y] & 0xF
                if c:
                    dp[x, y] = pal[c] + (255,)
        dst.save(td / dst_name, optimize=True)

    render_indexed(decomp / "graphics/text_window/menu_message.png", "dialogue_frame.png")
    # User-selectable std window frames (options "FRAME" setting); each has its own palette.
    for n in range(1, 11):
        png = decomp / f"graphics/text_window/type{n}.png"
        if not png.exists():
            continue
        src = Image.open(png)
        # typeN.gbapal is generated from the PNG's own embedded palette.
        raw_pal = src.getpalette()[:48]
        frame_pal = [tuple(raw_pal[i : i + 3]) for i in range(0, 48, 3)]
        px = src.load()
        dst = Image.new("RGBA", src.size, (0, 0, 0, 0))
        dp = dst.load()
        for y in range(src.height):
            for x in range(src.width):
                c = px[x, y] & 0xF
                if c:
                    dp[x, y] = frame_pal[c] + (255,)
        dst.save(td / f"frame_type{n}.png", optimize=True)
    render_indexed(decomp / "graphics/fonts/down_arrows.png", "down_arrows.png")
    (td / "fonts.json").write_text(json.dumps({"fonts": fonts, "windowPalette": pal}, separators=(",", ":")))
    print(f"  {len(fonts)} fonts, charmap")


# ---------------------------------------------------------------- scripts + strings

DIRECTIVES_SKIP = (".include", ".global", ".align", ".section", ".set", ".equ", ".macro", ".endm", ".if", ".endif", ".else", ".ifdef", ".ifndef")


def split_args(s):
    """Split macro arguments on commas, respecting quotes and parentheses."""
    args, cur, depth, quote = [], "", 0, False
    for ch in s:
        if ch == '"':
            quote = not quote
        if not quote and ch in "([":
            depth += 1
        if not quote and ch in ")]":
            depth -= 1
        if ch == "," and depth == 0 and not quote:
            args.append(cur.strip())
            cur = ""
        else:
            cur += ch
    if cur.strip():
        args.append(cur.strip())
    return args


def strip_comment(line):
    out, quote = "", False
    i = 0
    while i < len(line):
        ch = line[i]
        if ch == '"' and (i == 0 or line[i - 1] != "\\"):
            quote = not quote
        if not quote and (ch == "@" or line.startswith("//", i)):
            break
        out += ch
        i += 1
    return out


def eval_const_expr(expr, known):
    """Evaluate a C constant expression made of numbers, known names and + - * / << >> | &."""
    tokens = re.findall(r"0x[0-9A-Fa-f]+|\d+|\w+|<<|>>|[()+\-*/|&]", expr)
    out = []
    for t in tokens:
        if re.fullmatch(r"0x[0-9A-Fa-f]+|\d+", t):
            out.append(str(int(t, 0)))
        elif re.fullmatch(r"\w+", t):
            if t not in known:
                return None
            out.append(str(known[t]))
        else:
            out.append("//" if t == "/" else t)
    try:
        v = eval(" ".join(out), {"__builtins__": {}}, {})
    except Exception:
        return None
    return int(v) if isinstance(v, int) else None


def extract_scripts(decomp, out):
    """Flatten event_scripts.s and everything it includes into one instruction stream.

    code: [[op, arg, ...], ...]   labels: {label: index}   (fall-through between labels is preserved)
    strings: {label: raw decomp string}   (.string data, encoded at runtime with the charmap)
    """
    code, labels, strings = [], {}, {}
    equs = {}
    seen = set()

    def subst(tok):
        return equs.get(tok, tok)

    macros = {}  # name -> (params, body lines); only macros defined in script files (asm/ is skipped)

    def walk(rel):
        if rel in seen or rel.startswith("asm/") or rel.endswith(("script_cmd_table.inc", "specials.inc")):
            return
        seen.add(rel)
        path = decomp / rel
        if not path.exists():
            return
        st = {"pending": [], "after_label": False, "macro": None}

        def handle(line):
            if st["macro"] is not None:
                if line.startswith(".endm"):
                    name, params, body = st["macro"]
                    macros[name] = (params, body)
                    st["macro"] = None
                else:
                    st["macro"][2].append(line)
                return
            m = re.match(r"^\.macro\s+(\w+)\s*(.*)$", line)
            if m:
                params = [a.split("=")[0].split(":")[0].strip() for a in split_args(m.group(2))] if m.group(2).strip() else []
                st["macro"] = (m.group(1), params, [])
                return
            m = re.match(r'^\.include\s+"(.+?)"', line)
            if m:
                walk(m.group(1))
                return
            m = re.match(r"^\.(?:equ|set)\s+(\w+)\s*,\s*(.+)$", line)
            if m:
                equs[m.group(1)] = subst(m.group(2).strip())
                return
            m = re.match(r"^([A-Za-z_][\w.]*)::?\s*(.*)$", line)
            if m and not line.startswith("."):
                labels[m.group(1)] = len(code)
                st["pending"] = st["pending"] + [m.group(1)] if st["after_label"] else [m.group(1)]
                st["after_label"] = True
                line = m.group(2).strip()
                if not line:
                    return
            st["after_label"] = False
            if line.startswith(".string"):
                text = "".join(re.findall(r'"((?:\\.|[^"\\])*)"', line))
                for lab in st["pending"]:
                    strings[lab] = strings.get(lab, "") + text
                code.append([".string", text])
                return
            if line.startswith(DIRECTIVES_SKIP):
                return
            parts = line.split(None, 1)
            op = parts[0]
            args = split_args(parts[1]) if len(parts) > 1 else []
            if op in macros:
                params, body = macros[op]
                for bl in body:
                    for i, prm in enumerate(params):
                        bl = bl.replace("\\" + prm, args[i] if i < len(args) else "")
                    handle(bl)
                return
            code.append([op] + [subst(a) for a in args])

        for raw in path.read_text(encoding="utf-8").splitlines():
            line = strip_comment(raw).strip()
            if line:
                handle(line)

    walk("data/event_scripts.s")

    # Numeric constants scripts compare against (TRUE, MALE, DIR_*, MSGBOX_*, ITEM_*, ...).
    defines = {}
    for hdr in sorted((decomp / "include/constants").glob("*.h")) + [decomp / "include/global.h"]:
        for name, val in re.findall(r"^#define\s+(\w+)\s+\(?(-?(?:0x[0-9A-Fa-f]+|\d+))\)?\s*(?://.*)?$", hdr.read_text(errors="ignore"), re.M):
            defines.setdefault(name, int(val, 0))
    # Assembler symbols such as MSGBOX_NPC = 2 / STD_OBTAIN_ITEM = 0 live in the event macros.
    for name, val in re.findall(r"^\s*(\w+)\s*=\s*(\d+)\s*$", (decomp / "asm/macros/event.inc").read_text(), re.M):
        defines.setdefault(name, int(val))
    # Resolve aliases and simple arithmetic (#define FLAG_X (SYS_FLAGS + 0x90)) until nothing changes.
    pending = {}
    for hdr in sorted((decomp / "include/constants").glob("*.h")) + [decomp / "include/global.h"]:
        for name, expr in re.findall(r"^#define\s+(\w+)\s+(.+?)\s*(?://.*)?$", hdr.read_text(errors="ignore"), re.M):
            if name not in defines and re.fullmatch(r"[\w\s()+\-*/<>|&]+", expr):
                pending[name] = expr
    progress = True
    while progress and pending:
        progress = False
        for name, expr in list(pending.items()):
            v = eval_const_expr(expr, defines)
            if v is not None:
                defines[name] = v
                del pending[name]
                progress = True
    std = []
    i = labels.get("gStdScripts")
    while i is not None and i < len(code) and code[i][0] == ".4byte":
        std.append(code[i][1])
        i += 1

    sd = out / "scripts"
    sd.mkdir(parents=True, exist_ok=True)
    (sd / "scripts.json").write_text(json.dumps({"code": code, "labels": labels, "defines": defines, "stdScripts": std}, ensure_ascii=False, separators=(",", ":")))
    # C strings (menu labels etc.): const u8 gText_X[] = _("..." "...");
    for cfile in ("src/strings.c",):
        src = (decomp / cfile).read_text(encoding="utf-8")
        for name, body in re.findall(r"const u8 (\w+)\[\]\s*=\s*_\((.*?)\);", src, re.S):
            parts = re.findall(r'"((?:\\.|[^"\\])*)"', body)
            if parts and name not in strings:
                strings[name] = "".join(parts) + "$"
    (out / "text" / "strings.json").write_text(json.dumps(strings, ensure_ascii=False, separators=(",", ":")))
    print(f"  {len(seen)} files, {len(code)} instructions, {len(labels)} labels, {len(strings)} strings")


# ---------------------------------------------------------------- misc tables


def extract_constants(decomp, out):
    """Flags set at new game by EventScript_ResetAllMapFlags, so hidden NPCs start hidden."""
    src = (decomp / "data/event_scripts.s").read_text()
    m = re.search(r"EventScript_ResetAllMapFlags::(.*?)\n\s*(?:end|return)\b", src, re.S)
    flags = re.findall(r"setflag (FLAG_\w+)", m.group(1)) if m else []
    behaviors = dict(
        (name, int(val, 0)) for name, val in re.findall(r"#define (MB_\w+)\s+(0x[0-9A-Fa-f]+|\d+)", (decomp / "include/constants/metatile_behaviors.h").read_text())
    )
    (out / "constants.json").write_text(json.dumps({"newGameFlags": flags, "metatileBehaviors": behaviors}, indent=1))
    print(f"  {len(flags)} new-game flags, {len(behaviors)} behaviors")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--decomp", default=DEFAULT_DECOMP)
    ap.add_argument("--out", default=str(ROOT / "public" / "gen"))
    args = ap.parse_args()
    decomp, out = Path(args.decomp), Path(args.out)
    if not (decomp / "data/maps").is_dir():
        sys.exit(f"Not a pret/firered checkout: {decomp}")
    out.mkdir(parents=True, exist_ok=True)
    print("constants")
    extract_constants(decomp, out)
    print("text")
    extract_text_assets(decomp, out)
    print("scripts")
    extract_scripts(decomp, out)
    print("sprites")
    extract_object_events(decomp, out)
    print("maps + tilesets")
    extract_maps(decomp, out, parse_tileset_symbols(decomp))


if __name__ == "__main__":
    main()
