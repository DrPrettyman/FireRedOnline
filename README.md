# FireRed in Phaser

A browser rebuild of Pokémon FireRed in [Phaser 3](https://phaser.io), using the
[pret/firered](https://github.com/pret/pokefirered) decompilation as the source of truth for data and behaviour.

No game assets are committed. `tools/extract.py` reads a local decomp checkout and writes
everything the game needs into `public/gen/` (gitignored). Keep that folder local; don't publish it.

## Setup

```sh
npm install
pip3 install pillow           # extractor dependency
npm run extract               # reads ../pret/firered by default
npm run dev                   # http://localhost:5173
```

To point at a decomp somewhere else, use `FIRERED_DECOMP=/path/to/firered npm run extract`
or `python3 tools/extract.py --decomp /path/to/firered`.

### Controls

| GBA | Keys |
| --- | --- |
| D-pad | Arrow keys |
| A | Z / Space |
| B | X (hold to run) |
| Start | Enter |
| Select | Backspace |
| L / R | A / S |
| (debug) | <code>`</code> toggles the HUD (map, coords, metatile, behavior, elevation) |

Bindings live in `src/input/Input.ts`.

Debug: `?map=PalletTown&x=12&y=10` starts at any map and coordinate. In dev builds, `window.game` exposes the Phaser game.

## How it works

### Extraction (`tools/extract.py` → `public/gen/`)

| Output | Source in decomp |
| --- | --- |
| `maps/<Name>.json`, `maps/index.json` | `data/maps/*/map.json`, `data/layouts/layouts.json`, `map.bin`/`border.bin` |
| `tilesets/<Primary>_{below,above}.png` | primary tileset metatiles 0–639 (shared by every map using that primary) |
| `tilesets/<Primary>__<Secondary>_{below,above}.png` | secondary metatiles 640–1023, plus "override" copies of primary metatiles that use secondary palettes |
| `tilesets/index.json` | per-tileset metatile attributes (behavior, layer type, encounter type) + per-pair override lists |
| `sprites/<Name>.png`, `sprites/manifest.json` | overworld pic tables/palettes in `src/data/object_events/*.h`, NPC text colour (`sTextColorTable`) |
| `text/latin_*.png`, `text/fonts.json` | latin fonts, glyph widths (`src/text.c`), font metrics (`gFontInfos`) |
| `text/charmap.json` | `charmap.txt` (used to encode strings exactly like `preproc`) |
| `text/strings.json` | every `.string` label reachable from `data/event_scripts.s`, plus C strings in `src/strings.c` |
| `text/dialogue_frame.png`, `frame_type1..10.png`, `down_arrows.png` | dialogue frame, user window frames, page arrow |
| `scripts/scripts.json` | `data/event_scripts.s` and all its includes flattened to `[op, ...args]` with labels; script-file macros and pure event macros (`giveitem_msg`, `famechecker`, ...) expanded; numeric `#define`s (incl. simple expressions); std script table |
| `pokemon/species.json`, `moves.json`, `items.json` | `gSpeciesInfo` + names + level-up learnsets + national dex numbers, `gBattleMoves` + names, `src/data/items.json` |
| `pokemon/tables.json` | `gExperienceTables` (EXP_* macros evaluated), `sNatureStatTable`, `gStdStringPtrs`, dex counts |
| `pokemon/front/<species>.png` | front pics with the normal palette (`gMonFrontPicTable`, `gMonPaletteTable`) |
| `constants.json` | metatile behavior ids, new-game hidden-object flags |

Each metatile's two layers are split by layer type into a **below** atlas (under sprites) and an **above** atlas
(over sprites), reproducing the GBA BG priorities. A map layer uses the primary atlas at gid 0 and the pair atlas at gid 640.

### Runtime (`src/`)

| Area | Files | What it does |
| --- | --- | --- |
| Boot | `main.ts`, `scenes/BootScene.ts`, `data/assets.ts` | 240×160 game, loads indexes, lazy-loads maps/textures |
| World | `world/World.ts`, `MapChunk.ts`, `TilesetPair.ts`, `behaviors.ts` | current map + connected neighbours in one world space; per-tile collision/elevation/behavior; `setmetatile` edits |
| Objects | `entities/ObjectEvent.ts`, `NpcBrain.ts` | grid movement at GBA speeds (walk/run/jump/slow/fast/in-place), NPC movement types |
| Field | `scenes/OverworldScene.ts` | fixed 60 Hz tick; input order (START, A, then movement); warps; coord triggers; map scripts; object spawning (on map entry and as objects come into view) |
| Input | `input/Input.ts` | GBA buttons sampled once per tick (`held` / `pressed`) |
| Text | `text/charmap.ts`, `Font.ts`, `TextWindow.ts`, `TextPrinter.ts`, `MessageBox.ts`, `placeholders.ts` | port of `RenderText`; pixel-buffer windows; field message box |
| Scripts | `script/ScriptEngine.ts`, `MovementRunner.ts`, `Defines.ts`, `specials.ts` | interpreter for decomp scripts at macro level; movement scripts; constant resolution; `special` table |
| Pokémon | `pokemon/Pokemon.ts`, `util/random.ts` | CreateMon, stats, movesets, gender/nature; the GBA RNG |
| State | `state/GameState.ts`, `Bag.ts` | flags/vars by numeric id, names, text speed, party, bag, Pokédex (memory only) |
| UI | `ui/MenuWindow.ts`, `Menu.ts`, `YesNoMenu.ts`, `StartMenu.ts`, `MonPicBox.ts`, `ScreenFade.ts` | std-framed windows, cursor menus, `showmonpic` box, `fadescreen` |

### Testing

- `npm run typecheck`
- In the browser: `?map=<Name>&x=<x>&y=<y>` starts anywhere; <code>`</code> shows the debug HUD; `window.game` in dev.
- Headless: `tools/browser-test.mjs` drives Chrome (keys, evals, screenshots). See the header of that file.

## Progress

See [PROGRESS.md](PROGRESS.md) for the detailed checklist and log.

## Roadmap

- [x] Map, tileset and sprite extraction
- [x] Overworld rendering with connections and border
- [x] Player movement: walk, run, turn, ledges, collision and elevation
- [x] Warps: doors, mats/arrow warps, stairs, ladders
- [x] NPCs with basic movement types
- [x] Text engine: the decomp's fonts, GBA-style printer, message box
- [~] Script interpreter for `data/maps/*/scripts.inc`, `data/scripts/*.inc` and `data/event_scripts.s` (msgbox, flags/vars, movement, give items)
- [x] Signs, coord triggers, map scripts (on load / on frame)
- [ ] Door and tile animations, field effects (grass rustle, shadows, reflections)
- [ ] Save data model: party, bag, flags, vars, PC
- [ ] Wild encounters (`src/data/wild_encounters.json`)
- [ ] Battle engine: species, moves and types data, then the damage formula, battle scripts and AI
- [~] Menus: start (shell), YES/NO; still to do: bag, party, summary, Pokédex, options
- [ ] Audio: convert `sound/` (MIDI and samples) to web-playable formats
- [ ] Title screen, intro, Oak's speech, naming
