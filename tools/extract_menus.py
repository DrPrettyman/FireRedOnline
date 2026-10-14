"""Tables the party menu and bag index (public/gen/menus.json).

- monIcons / monIconPaletteIndices: gMonIconTable / gMonIconPaletteIndices (pokemon_icon.c), by species
- itemIcons: sItemIconTable (data/item_icon_table.h), item id -> [tiles symbol, palette symbol]
- tmhmMoves: sTMHMMoves (data/party_menu.h); tutorMoves / tutorLearnsets (data/pokemon/tutor_learnsets.h)
- tmhmLearnsets: sTMHMLearnsets (data/pokemon/tmhm_learnsets.h) as [low u32, high u32] per species
- evolutions: gEvolutionTable (data/pokemon/evolution.h) as [[method, param, targetSpecies], ...] per species
- natureNames: gNatureNamePointers (data/text/nature_names.h); abilityDescriptions: gAbilityDescriptionPointers
  (data/text/abilities.h); moveDescriptions: gMoveDescriptionPointers (move_descriptions.c), indexed move - 1
- mapsecNames: sMapNames (generated from data/region_map/region_map_sections.json), indexed mapsec - KANTO_MAPSEC_START
- menuInfoIcons: sMenuInfoIcons (list_menu.c) as [width, height, tile offset]
"""

import json
import re

from extract import eval_const_expr, parse_defines
from extract_battle import c_array_body, c_numeric_table


def designated_entries(body):
    """`[KEY] = value,` entries at the top level of an array initializer -> [(key, value text)]."""
    body = re.sub(r"//[^\n]*", "", re.sub(r"/\*.*?\*/", "", body, flags=re.S))
    out = []
    for m in re.finditer(r"\[([^\]]+)\]\s*=", body):
        start, depth, i = m.end(), 0, m.end()
        while i < len(body):
            c = body[i]
            if c in "({":
                depth += 1
            elif c in ")}":
                if depth == 0:
                    break
                depth -= 1
            elif c == "," and depth == 0:
                break
            i += 1
        out.append((m.group(1).strip(), body[start:i].strip()))
    return out


def by_index(entries, defines, convert):
    table = []
    for key, val in entries:
        idx = eval_const_expr(key, defines)
        if idx is None:
            raise ValueError(f"unknown index {key}")
        table += [None] * (idx + 1 - len(table))
        table[idx] = convert(val)
    return table


def string_pointer_table(text, name, defines):
    """`[KEY] = sSym,` pointers to `const u8 sSym[] = _("...");` in the same file -> raw strings by index."""
    literals = dict(re.findall(r'\b(\w+)\s*\[\s*\]\s*=\s*_\("(.*?)"\);', text))
    return by_index(designated_entries(c_array_body(text, name)), defines, lambda v: literals[v] + "$")


def mapsec_names(decomp, defines):
    """sMapNames[mapsec - KANTO_MAPSEC_START]: every section with a name (clones repeat it)."""
    sections = json.loads((decomp / "src/data/region_map/region_map_sections.json").read_text())["map_sections"]
    start = defines["KANTO_MAPSEC_START"]
    names = [None] * (defines["MAPSEC_NONE"] - start)
    for m in sections:
        if "name" in m:
            names[defines[m["id"]] - start] = m["name"] + "$"
    return names


def extract_menus(decomp, out):
    defines = parse_defines(decomp)
    src = decomp / "src"

    icon_c = (src / "pokemon_icon.c").read_text()
    mon_icons = by_index(designated_entries(c_array_body(icon_c, "gMonIconTable")), defines, lambda v: v)
    mon_icon_pals = by_index(designated_entries(c_array_body(icon_c, "gMonIconPaletteIndices")), defines, lambda v: eval_const_expr(v, defines))

    item_icon_h = (src / "data/item_icon_table.h").read_text()
    item_icons = by_index(designated_entries(c_array_body(item_icon_h, "sItemIconTable")), defines, lambda v: re.findall(r"\w+", v))

    tmhm_moves = c_numeric_table((src / "data/party_menu.h").read_text(), "sTMHMMoves", defines)

    tutor_h = (src / "data/pokemon/tutor_learnsets.h").read_text()
    tutor_moves = c_numeric_table(tutor_h, "sTutorMoves", defines)

    def tutor_bits(v):
        bits = 0
        for move in re.findall(r"TUTOR\((\w+)\)", v):
            bits |= 1 << defines["TUTOR_" + move]
        return bits

    tutor_learnsets = by_index(designated_entries(c_array_body(tutor_h, "sTutorLearnsets")), defines, tutor_bits)

    def tmhm_bits(v):
        bits = 0
        for machine in re.findall(r"TMHM\((\w+)\)", v):
            bits |= 1 << (defines["ITEM_" + machine] - defines["ITEM_TM01_FOCUS_PUNCH"])
        return [bits & 0xFFFFFFFF, bits >> 32]

    tmhm_h = (src / "data/pokemon/tmhm_learnsets.h").read_text()
    tmhm_learnsets = by_index(designated_entries(c_array_body(tmhm_h, "sTMHMLearnsets")), defines, tmhm_bits)

    def evos(v):
        return [[eval_const_expr(x.strip(), defines) for x in e.split(",")] for e in re.findall(r"\{([^{}]+)\}", v)]

    evo_h = (src / "data/pokemon/evolution.h").read_text()
    evolutions = by_index(designated_entries(c_array_body(evo_h, "gEvolutionTable")), defines, evos)

    nature_names = string_pointer_table((src / "data/text/nature_names.h").read_text(), "gNatureNamePointers", defines)
    ability_descs = string_pointer_table((src / "data/text/abilities.h").read_text(), "gAbilityDescriptionPointers", defines)
    move_descs = string_pointer_table((src / "move_descriptions.c").read_text(), "gMoveDescriptionPointers", defines)
    flat = c_numeric_table((src / "list_menu.c").read_text(), "sMenuInfoIcons", defines)
    menu_info_icons = [flat[i : i + 3] for i in range(0, len(flat), 3)]

    data = {
        "natureNames": nature_names,
        "abilityDescriptions": ability_descs,
        "moveDescriptions": move_descs,
        "mapsecNames": mapsec_names(decomp, defines),
        "menuInfoIcons": menu_info_icons,
        "monIcons": mon_icons,
        "monIconPaletteIndices": mon_icon_pals,
        "itemIcons": item_icons,
        "tmhmMoves": tmhm_moves,
        "tutorMoves": tutor_moves,
        "tutorLearnsets": tutor_learnsets,
        "tmhmLearnsets": tmhm_learnsets,
        "evolutions": evolutions,
    }
    (out / "menus.json").write_text(json.dumps(data, separators=(",", ":")))
    print(f"  {len([s for s in mon_icons if s])} mon icons, {len([s for s in item_icons if s])} item icons, "
          f"{len(tmhm_moves)} TM/HM moves, {len([e for e in evolutions if e])} evolution entries")


if __name__ == "__main__":
    import sys
    from pathlib import Path

    extract_menus(Path(sys.argv[1]), Path(sys.argv[2]))
