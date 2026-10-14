# Progress log

Running checklist of what exists and what doesn't. Newest log entries at the bottom.
`[x]` done · `[~]` partial (see note) · `[ ]` not started.

## Checklist

### Pipeline (tools/extract.py → public/gen/)
- [x] Maps + layouts (blocks, border, connections, events)
- [x] Tilesets: one atlas per primary, one per (primary, secondary) pair + overrides; attributes per tileset
- [x] Overworld sprites (object event pic tables + palettes)
- [x] Constants: metatile behaviors, new-game hidden-object flags
- [x] Fonts (latin normal/male/female/small) + glyph widths + font metrics
- [x] Charmap (for encoding decomp strings exactly as preproc does)
- [x] Text strings (all `.string` labels reachable from event_scripts.s)
- [x] Dialogue window frame graphics + palette, down-arrow indicator
- [x] Scripts (event_scripts.s + all includes → instruction streams with labels; macros defined in script files expanded)
- [x] Numeric constants (`#define`s incl. simple expressions, event macro symbols, std script table)
- [x] NPC text colours per graphics id (sTextColorTable)
- [x] C strings from src/strings.c (menu labels etc.)
- [x] Std window frames (type1..10, palette from each PNG); menu cursor is the ▶ font glyph
- [ ] Tile animations (water, flowers, etc.)
- [ ] Door animation graphics
- [ ] Field effect graphics (grass, shadows, emotes, ...)
- [x] Species (base stats, names, learnsets, national dex numbers), moves, items, experience tables, nature table, std strings
- [x] Trainers / trainer parties (battle/tables.json)
- [ ] Wild encounters data
- [x] Battle graphics by C INCBIN symbol as decompressed ROM bytes (`tools/extract_gfx.py` → gen/gfx/): interface, terrain, balls, trainer/mon front+back pics and palettes, fonts
- [x] Battle scripts (assembled ROM image), battle strings, mechanics tables, anim command tables (`tools/extract_anims.py`)
- [x] Party menu / bag / item icon / mon icon / help-window graphics; `menus.json` (`tools/extract_menus.py`: mon and item icon tables, TM/HM + tutor learnsets, TM/HM + tutor moves, evolutions)
- [ ] Move/status battle animation scripts
- [x] Pure event macros (giveitem_msg, famechecker, trainerbattle_*, ...) expanded like the assembler would, incl. `.if/.elseif/.else` on arguments
- [ ] Audio

### Engine
- [x] Map rendering (below/above layers), connections, border
- [x] Grid movement: walk, run, tap-to-turn, ledges
- [x] Collision: collision bits, elevation rules, directional impassable, objects
- [x] Sprite priority from elevation (UpdateObjectEventElevationAndPriority): priority-1 objects draw over the top map layer
- [x] Warps: doors (+ walk out), arrow/stair warps, step warps
- [x] NPC movement types (wander, look around, face, pace)
- [x] Hidden objects via flags
- [x] Object spawning: all of a map's sprites preloaded on entry, synchronous `addobject`, in-view spawning as the camera moves (TrySpawnObjectEvents)
- [x] Object lifetime across connections: replaced by the neighbour-map QOL change (see "Deliberate QOL changes"); templates reloaded from the header on every map entry (LoadObjEventTemplatesFromHeader)
- [x] `LOCALID_*` names resolved per map from map.json `local_id`
- [x] Input module with all GBA buttons (A, B, Start, Select, L, R), sampled per logic tick
- [x] Text engine: port of RenderText (speed + A/B speed-up, all FC control codes, \n \l \p, placeholders)
- [x] Message box (dialogue frame, down-arrow indicator)
- [~] Game state: flags, vars, names, text speed, trainer id, money, party, bag, Pokédex seen/caught (in memory only; names are placeholders until naming screen)
- [x] Pokémon creation: CreateMon/CreateBoxMon port (personality, IVs, nature, ability, initial moveset, stats); GBA RNG (random.c)
- [x] Bag: AddBagItem/RemoveBagItem/CheckBagHasItem/CheckBagHasSpace incl. TM case / berry pouch handling
- [~] Script interpreter: flow/branching, flags/vars, msgbox via std scripts, text colour, movements, object add/remove/move, setmetatile, warps, delay. Unimplemented commands log once to the console
- [x] NPC talk (incl. across counters) / signs / coord triggers / map scripts (on transition, on frame, on load, on warp-into)
- [x] NPC text colours by gender
- [x] YES/NO box (sYesNo_WindowTemplate, 5-frame input delay, B = NO)
- [ ] Multichoice menus
- [~] Specials (`special X` / `specialvar`): table in `script/specials.ts`; HealPlayerParty, GetPokedexCount, EnableNationalPokedex, GetQuestLogState, GetPartyMonSpecies, BufferMonNickname, ChangePokemonNickname (stub), plus no-ops for audio/quest log/help/fame checker. Unknown specials log once
- [~] Items: additem/removeitem/checkitem/checkitemspace/checkitemtype, giveitem/giveitem_msg through the std scripts. Not yet: hidden items, item balls (finditem) untested
- [x] Buffer commands (species/lead mon/party nick/item/item plural/number/std string/string); `waitstate`
- [x] givemon, getpartysize, showmonpic/hidemonpic (picture box), fadescreen (palette-fade timing)
- [x] White-out (CB2_WhiteOut → DoWhiteOut → FieldCB_RushInjuredPokemonToCenter) and `setrespawn`
- [x] trainerbattle: every mode (BattleSetup_ConfigureTrainerBattle + the trainer_battle.inc scripts and their specials, gotobeatenscript, rematch checks against vs_seeker.c sRematches). Talk-to only: trainer sight isn't implemented
- [x] Text colour through VAR_TEXT_COLOR / VAR_PREV_TEXT_COLOR (ContextNpcGetTextColor), VAR_LAST_TALKED
- [ ] Movement emotes (exclamation mark etc.) and other field effects in movement scripts
- [ ] Interacting with metatiles (PCs, bookshelves, TVs via behavior scripts)
- [~] Start menu shell: items by flags, wrap-around cursor, remembered position, B/START close. POKéMON and BAG open the real screens; the other entries (except EXIT) show a "not implemented" notice
- [ ] Start menu help/description window
- [ ] Door animations (`opendoor`/`closedoor`/`waitdooranim` are no-ops), tile animations, field effects
- [ ] Map name popup
- [ ] Save/load
- [x] Party menu (party_menu.c) and bag (item_menu.c, bag.c, item_use.c) on the GBA layer, from the field and in battle; list menus, scroll arrows, mon/item icons, std/dialog frames, YES/NO, money box
- [x] Summary screen (pokemon_summary_screen.c): INFO / SKILLS / KNOWN MOVES pages, move details, switching moves, choosing a move to forget (field and battle)
- [ ] Pokédex, options, TM case, berry pouch
- [ ] Wild encounters, trainer sight
- [x] Battle engine core: script interpreter, turn flow, damage/effects, messages, AI (battle_ai_script_commands.c + switch/items), player/opponent/Oak-Old Man controllers
- [x] GBA video layer (src/gba: VRAM/palette/regs, bg.c, window.c, sprite.c, task.c, palette fades, scanline effects, software PPU) and the battle presentation on it (BattleScene)
- [x] Battle: bag and party menu (choose item, use medicine/PP items/X items/balls, switch/send out) with reshow_battle_screen.c
- [ ] Battle: move/status animations, evolution scene, battle transitions, wild battles, white-out
- [ ] Audio playback
- [ ] Title screen / intro / Oak's speech / naming (ChangePokemonNickname keeps the name for now)

## Known deviations from the decomp

Things that are placeholders or approximations, so they aren't mistaken for ports. Remove entries as they get done properly.

- **Placeholders (not in the decomp):**
  - `ChangePokemonNickname`: keeps the name and fades back in instead of opening the naming screen.
  - Pokémon Center heal: the healing machine (`dofieldeffect FLDEFF_POKECENTER_HEAL`) and the nurse's bow
    (`nurse_joy_bow`) are skipped; the heal itself happens.
  - White-out after the Trainer Tower: its challenge state isn't tracked, so `spokeToOwner` reads as FALSE.
  - VS Seeker: `state.trainerRematches` is never set, so no trainer is ever ready for a rematch.
  - Battles: no move/status/special battle animation scripts (InitAndLaunchSpecialAnimation etc. finish at once;
    only the Poké Ball open burst is drawn); no shiny sparkle; no audio (PlaySE/cries/BGM are no-ops).
  - Battles: evolutions are skipped.
  - Summary screen: no box mons (PC), trade-screen view or multi-battle party order; the struct Pokemon fields the
    port doesn't store read as defaults (markings 0, met game FireRed, no fateful-encounter flag, English).
  - Party menu: field moves always say they can't be used
    here (badge checks are real); mail, Softboiled/Milk Drink, the move relearner, Union Room, minigames,
    Pokédude/Teachy TV demos are not ported. Evolution (Rare Candy, stones) doesn't happen; a stone is still used up.
  - Item use: the item-use animation (pokemon_special_anim.c) is skipped. Bag uses that need overworld systems
    (bike, rods, Escape Rope, Itemfinder, VS Seeker, Town Map, Fame Checker, Teachy TV, mail, TM case, berry pouch,
    registered SELECT items) log "not implemented" and return to the bag. Coins and berry powder read as 0; PC
    storage is never full for Poké Balls; the item PC / Pokémon storage give flows aren't ported.
  - Bag/party run in their own scene (FieldMenuScene) when opened from the field; the field side fades with the
    overworld's ScreenFade.
  - Battles: the level-up banner (exp to a mon that isn't sent out) has no mon icon; Spinda's spots aren't drawn;
    HP-as-text (SwapHpBarsWithHpText) and link/multi battles aren't implemented.
  - Battle transitions: a fade to black instead of the B_TRANSITION_* effects.
  - Full party: `givemon` returns MON_CANT_GIVE instead of sending the mon to the PC (`SendMonToPC`).
  - No-op specials (`NO_OP` in `script/specials.ts`): audio, quest log, help system, fame checker, GameCube link flags.
  - Player names are "PLAYER"/"RIVAL" until Oak's intro exists.
- **Approximations:**
  - `fadescreen` is an alpha overlay, not a palette blend: same ramp and timing, not bit-identical; weather palettes ignored.
  - `showmonpic`: the sprite appears when its PNG has loaded; no cry.
  - Text colour is reset to NPC_TEXT_COLOR_DEFAULT when a script starts, not in ProcessPlayerFieldInput.
  - The RNG (`random.c` formula) is seeded from `Math.random`; the trainer id is rolled when the game state is created instead of in Oak's intro.
  - A mon's met location is the MAPSEC_* name, not the numeric id.
  - Warps fade with Phaser's camera fade (200 ms), not the field warp fade.
  - Sprite order: `fixedPriority` (surf/fly field effects, the `set_fixed_priority` movement action and
    `setobjectsubpriority`, none of which FRLG scripts use) isn't ported, and neither are OAM priorities 0 and 3,
    which no map elevation produces. Sprites tied on priority, subpriority and screen top keep creation order rather
    than the previous frame's gSpriteOrder.
  - BIOS ObjAffineSet uses a computed sine table; mosaic isn't emulated by the PPU.
- **Data:** Castform has no front pic (its `front.png` isn't in the decomp; it's built from per-form images).

## Deliberate QOL changes

Places where we choose to differ from the GBA on purpose (not placeholders). Keep this list current.

- **NPCs on neighbouring maps are spawned** (`OverworldScene.syncNpcsWithLoadedMaps`). The GBA already draws the
  connected maps' tiles but only spawns the current map's objects in the view window (TrySpawnObjectEvents), so
  NPCs pop in when you cross a border. We spawn every object of the current map and its connected neighbours and
  drop them when their map stops being adjacent. Consequences:
  - Clone objects (OBJ_KIND_CLONE, 9 in the game, e.g. Route 21 North's copy of Pallet's fat man) are not needed
    and stay unsupported.
  - Objects aren't despawned/respawned by the view window (RemoveObjectEventsOutsideView), so wandering NPCs don't
    snap home when you come back.
  - A neighbour's templates are its header ones (or the ones it had while it was last current); its map scripts
    don't run until you enter it. On entry, any of its objects whose reloaded template disagrees (position,
    graphics, movement type, hidden) is marked stale and respawned once it's off screen, so nobody visibly teleports.
    A stale one that's on screen keeps its old place until it isn't, as a live object would on the GBA.
  - Exception: a neighbour's objects with dynamic graphics (OBJ_EVENT_GFX_VAR_*) aren't spawned until it's current,
    because VAR_OBJ_GFX_ID_* hold the current map's choices, not the neighbour's.
  - Future: trainer sight / any per-object logic should check that an object belongs to the current map where the
    GBA would only have current-map objects alive.

## Where to resume

State as of the last log entry:
- **Playable:** new game in Player's House 2F → Pallet Town → Oak's trigger → lab intro → choose a starter
  (picture box, YES/NO, nickname prompt) → rival picks → **the real rival battle** (Oak's tutorial narration,
  FIGHT/move menus, AI opponent, exp + level-up box) → rival leaves. Mom heals the party. Route 1 clerk Potion.
- **Battle architecture:** `src/gba` emulates the GBA video hardware; `src/battle` is a near line-for-line port of
  battle_main.c, battle_script_commands.c, battle_util.c, the controllers, battle_interface.c, battle_gfx_sfx_util.c,
  pokeball.c etc. on top of it. `BattleScene` runs CB2_InitBattle → CB2_HandleStartBattle → BattleMainCB1/CB2 +
  VBlankCB_Battle at 60 Hz and draws with the software PPU. `OverworldScene.startTrainerBattle` builds `BattleStart`.
- **Overworld sprites:** draw order follows the GBA. Each object's OAM priority comes from its elevation
  (`ObjectEvent.updateElevationAndPriority`), and the 16 px screen-row subpriority (`updateSubpriority`) is
  recomputed every frame against last frame's camera (`field.cameraTop`). `objectDepth` in MapChunk.ts packs
  them into Phaser depths between the `below`/`above` layers, or above `above` for priority 1. The camera follows
  `ObjectEvent.anchor`, which leaves out the jump lift. `OBJ_EVENT_GFX_VAR_*` graphics are resolved from
  `VAR_OBJ_GFX_ID_*` at spawn (`resolveGraphicsId`).
- **Open overworld follow-ups:** dynamic-graphics objects have only been checked on Viridian's old man; other maps
  that use them (e.g. rival appearances) are untested. A script that sets `VAR_OBJ_GFX_ID_*` and then `addobject`s
  in the same run only works if that sprite was already preloaded; otherwise it logs `[overworld] no sprite loaded`.
- **Next blockers on the main path:** Viridian City Mart parcel scene (`pokemart`, multichoice), trainer sight
  (trainers only battle when talked to; Route 22 rival, Viridian Forest, gym trainers), Oak's parcel → Pokédex scene; in battle: move animations
  (battle_anim scripts), wild battles, evolution scene.
- **GBA screens:** `src/gba/main.ts` is gMain (callbacks, ReadKeys with key repeat). `GbaHostScene` runs the
  main loop; `BattleScene` and `FieldMenuScene` extend it. Screens hand over with SetMainCallback2 like the C
  (battle → CB2_BagMenuFromBattle → ... → ReshowBattleScreenAfterMenu → BattleMainCB2). Graphics are fetched
  asynchronously, so `prepareMenus()` (src/menus/host.ts) preloads everything the bag/party/summary can draw
  (incl. each party mon's front pic and palettes). The summary is `ShowPokemonSummaryScreen` /
  `ShowSelectMovePokemonSummaryScreen` + `GetMoveSlotToReplace` (src/menus/summaryScreen.ts).
- **Bag tests:** `battleTest.launch({..., bag: [["ITEM_POTION", 3]]})` stocks the bag for a battle.
- **Quick battle test:** `npm run dev:battle` opens `battle-test.html`: pick both parties (species, level, moves,
  held item), trainer or wild, single/double, IVs, terrain, then Start. Scripted: `battleTest.launch({...config})`
  and `mash:battleTest.lastOutcome` in `browser-test.mjs`; `await import('/src/battle/env.ts')` exposes the live
  battle globals (`g`).
- **How to find what a script needs:** unimplemented script commands and specials log once to the browser console
  as `[script] unimplemented command ...`.
- **Skip the intro:** `?start=after-rival[&starter=bulbasaur|squirtle|charmander]` (dev only) starts in Oak's lab
  right after the first rival battle, won (`src/dev/startPresets.ts`); add `&map=&x=&y=` to start elsewhere with
  that state. When a script on the way changes, update the preset to match.
- **Bugs that depend on world position:** `?map=` always loads at origin 0, so maps that are far from the origin in
  a real playthrough (e.g. Viridian at y = -80 after walking up from Pallet) need either a real walk or
  `await s.world.load(name, ox, oy)`, then `s.player.setPosition(...)` and `await s.onMapLoaded(false)`.
- **Testing long scenes:** `tools/browser-test.mjs` has `mash:<js>` (press A until a condition holds), e.g.
  `mash:game.scene.getScene("Overworld").state.getVar("VAR_MAP_SCENE_PALLET_TOWN_PROFESSOR_OAKS_LAB")===2`.
  Build step lists as a bash array (`args+=(...)`) so JS with spaces survives word splitting.
- **Workflow used so far:** read the C in the decomp, port it, cite the function name, verify in headless Chrome with
  `tools/browser-test.mjs`, then add an entry below.

## Log

### Milestone 1: overworld
- Vite + TS + Phaser 3 scaffold; extractor for maps, tilesets, sprites.
- Walkable overworld with connections, warps, ledges, NPCs. Verified Player's House 2F → 1F → Pallet Town → Route 1.

### Tileset de-duplication
- Atlases split into per-primary + per-pair (with palette-dependent "override" metatiles). 3.6 MB → 1.2 MB.
  Verified pixel-identical to the old per-pair render for all 60 pairs.

### Text engine + scripts
- Input module: A=Z/Space, B=X, Start=Enter, Select=Backspace, L=A, R=S, D-pad=arrows (WASD dropped).
- Extracted fonts, charmap, strings, dialogue frame, script instruction streams, constants.
- Text printer ported from `RenderText`; message box from `field_message_box.c` / `WindowFunc_DrawDialogueFrame`.
- Script interpreter runs the decomp's own scripts at macro level; `msgbox` goes through the decomp's std scripts.
- Verified: signs, NPC dialogue across multiple pages, female NPC red text, dialogue closes and returns control.
- Fixed: the A press that closes a message could re-trigger the interaction in the same frame
  (field input now only runs if no script was active at the start of the frame, as on the GBA).

### Menus
- Std-framed windows (`MenuWindow`), generic cursor menu (`Menu`), YES/NO box, start menu shell.
- `yesnobox` now shows the real menu; verified YES → 1, NO → 0, B → 0 via `Std_MsgboxYesNo`.
- Fixed: an overlay handing off to another (start menu → notice) was immediately cleared.

### Oak sequence fixes (user report)
- A + held direction: A is now checked before movement (ProcessPlayerFieldInput order), so you can talk while still holding a direction.
- `LOCALID_*` names weren't resolved (they're generated per map from map.json `local_id`), so `addobject`/`applymovement` on NPCs targeted nothing → Oak never appeared. Now resolved per map; unknown ids warn.
- `addobject` spawned asynchronously (sprite still loading). All of a map's object sprites are now preloaded on map entry and spawning is synchronous.
- Player stayed invisible after `set_invisible` + warp. Warps now reset player visibility (the GBA recreates the player object).
- Extractor now expands assembler macros defined inside script files (e.g. movement macros in PalletTown/scripts.inc).
- Door animation commands stubbed (no animation yet).
- Verified: trigger → Oak appears → leads player to lab → lab scene with rival plays out.
- Blocking the rest of the lab (starter choice + rival battle): `special`/`specialvar` (10+), buffer commands,
  `showmonpic`/`hidemonpic`, `givemon` (needs party/species data), `giveitem_msg`/`checkitem`/`removeitem` (bag),
  `fadescreen`, `famechecker`, `trainerbattle_earlyrival` (battle engine).

### Oak trigger off-by-one (user report)
- Symptom: 1-tile gap between Oak and player; player walked over the lab's bottom row on the way to the door.
- Cause: holding Up onto the trigger tile. The coord trigger started the script on arrival, but field input for that
  same frame had already been allowed, so the player took one extra step north. All scripted player moves are
  relative, so everything after was shifted by a row.
- Fix: re-check script/overlay state after arrival before processing movement (matches ProcessPlayerFieldInput
  returning after TryStartCoordEventScript).
- Verified for both triggers, holding Up: player stays on (12,1)/(13,1), Oak stops at (12,2)/(13,2), player ends at
  (15,14) and Oak at (16,14), both enter the door at (16,13), and the lab scene starts.

### Missing Oak in the lab (user report)
- The lab scene does `removeobject` (sets FLAG_HIDE_OAK_IN_HIS_LAB) → `setobjectxyperm 6,3` → `clearflag`, with no
  `addobject`. On the GBA, Oak comes back because `TrySpawnObjectEvents` runs every time the camera moves a tile and
  spawns any unspawned template in view whose hide flag is clear.
- Implemented that view-window spawn check (player-relative x −9..+10, y −7..+9, from MAP_OFFSET bounds), run after
  every completed player step, scripted or not.
- Verified: Oak walks up, is removed, and reappears at (6,3) as soon as the player takes a step.
- Not yet: RemoveObjectEventsOutsideView (despawning objects that leave the view). Harmless for now.

### Starter selection: Pokémon, bag, specials
- Extractor: `pokemon/species.json` (gSpeciesInfo + names + level-up learnsets + national dex), `moves.json`
  (gBattleMoves + names), `items.json` (from the decomp's items.json), `tables.json` (gExperienceTables evaluated
  from the EXP_* macros, sNatureStatTable, gStdStringPtrs, dex counts), `pokemon/front/<species>.png`.
  `#define` parsing moved into `parse_defines` (shared by scripts and pokemon).
- Event macros made only of other script commands (giveitem_msg, msgreceiveditem, famechecker,
  trainerbattle_earlyrival, ...) are now expanded at extraction, with default arguments.
- `pokemon/Pokemon.ts`: CreateMon/CreateBoxMon, GiveBoxMonInitialMoveset, CalculateMonStats (incl. the u16
  ModifyStatByNature), GetLevelFromMonExp, gender, CalculatePPWithBonus. `util/random.ts`: the GBA LCG.
- `state/Bag.ts` (item.c), GameState party/bag/trainer id/money/Pokédex.
- Script commands: givemon, showmonpic/hidemonpic (`ui/MonPicBox.ts`), fadescreen (`ui/ScreenFade.ts`, follows
  UpdateNormalPaletteFade timing), item commands, buffer commands, special/specialvar/waitstate,
  trainerbattle/dotrainerbattle/gotopostbattlescript, trainer flag commands.
- Text colour now lives in VAR_TEXT_COLOR/VAR_PREV_TEXT_COLOR like the GBA (EventScript_RestorePrevTextColor
  depends on it); `setvar` accepts LOCALID_* names (RIVAL_STARTER_ID); NPC interaction sets VAR_LAST_TALKED
  (`removeobject VAR_LAST_TALKED` removes the chosen ball).
- Fixed: `STR_VAR_n` arguments are names, not constants (the `stringvar` macro maps them to 0..2).
- Verified in headless Chrome: Bulbasaur and Charmander paths (party mon species/level/moves/stats checked by hand
  against CalculateMonStats), rival takes the counter starter, battle trigger (right and left) → stub → rival
  exits, scene var 4 + FLAG_BEAT_RIVAL_IN_OAKS_LAB + trainer flag set. Route 1 Potion, Oak's 5 Poké Balls
  ("put the POKé BALLS in the POKé BALLS POCKET"), Mom's heal with fade to black and back.

### Decomp audit of the starter milestone
- Constants that were hardcoded are now read from the extracted defines: Pokémon constants (`readPokemonConstants`:
  MAX_LEVEL, PARTY_SIZE, SPECIES_SHEDINJA, ITEM_POKE_BALL, MON_GIVEN_TO_*, ...), FADE_*, POCKET_*,
  NPC_TEXT_COLOR_*, DIR_*, LOCALID_PLAYER. Only the bag's 999 stack limit stays a literal (it is one in item.c).
- Checked against the decomp: starting money 3000 (NewGameInitData), bufferleadmonspeciesname (GetLeadMonIndex).
- Fixed: losing an early-rival battle only heals with RIVAL_BATTLE_HEAL_AFTER (CB2_EndTrainerBattle); otherwise
  it's a white-out (not implemented, warns). GetPartyMonSpecies returns SPECIES_EGG for eggs (MON_DATA_SPECIES_OR_EGG).
- Added "Known deviations from the decomp" above.


### Battle engine: rival battle playable (controllers, BattleScene)
- Controllers ported from battle_controller_player.c, battle_controller_opponent.c and
  battle_controller_oak_old_man.c (incl. Oak's PrintOakText_* narration with the healthbox palette trick
  DoLoadHealthboxPalsForLevelUp, BtlCtrl_Draw/RemoveVoiceoverMessageFrame, the Old Man's simulated input).
- `Cmd_drawlvlupbox` now ported against the GBA layer (InitLevelUpBanner, Slide*LevelUpBanner, DrawLevelUpBannerText,
  DrawLevelUpWindowPg1/Pg2); BattleUi shrank to input/audio/save-data hooks — windows, yes/no cursor and fades call
  battleWindow.ts / palette.ts directly like the C.
- `BattleScene`: CB2_InitBattle/CB2_InitBattleInternal video setup, CB2_HandleStartBattle (single-player states),
  BattleMainCB2, VBlankCB_Battle, ReturnFromBattleToOverworld → `onEnd`. `OverworldScene.startTrainerBattle` replaces
  the stub: StartTrainerBattle's type flags (FIRST_BATTLE for RIVAL_BATTLE_TUTORIAL), BattleSetup_GetTerrainId (new
  metatile predicates in behaviors.ts), map battle scene/type/weather, trainer speeches, context text colour.
- Fixes found by running it: `PIXEL_FILL(c)` in sTextOnWindowsInfo was extracted as `c` (striped text boxes);
  small-font glyphs are packed two per latfont cell (DecompressGlyph_Small) — healthbox names/levels were blank;
  pokedex.h/berry.h added to the define headers; `K` must be initialised before listing gfx symbols.
- Verified headless: full Oak's Lab rival battle (Charmander vs Squirtle) to a win, Lv5→6 with both level-up pages,
  back in the lab overworld. `browser-test.mjs` now prints exception messages.

### Battle test harness
- `battle-test.html` + `src/battleTest.ts`: a standalone page that loads the assets and launches `BattleScene`
  without the overworld. A side panel edits both parties (datalists of species/moves/items, validated),
  trainer (any gTrainers id: name, pic, AI flags and items come from it) or wild, double battles, IVs
  (random/max/zero), terrain and text speed; random teams/moves buttons; config kept in localStorage.
- `BattleStart.enemyParty` / `double` (test-only) replace gEnemyParty and force BATTLE_TYPE_DOUBLE after
  CreateNPCTrainerParty. `npm run dev:battle` opens the page.
- Verified headless: trainer single (Giovanni intro, AI using Bite), wild single on grass terrain, and a trainer
  double battle, each to B_OUTCOME_WON.

### Party menu and bag
- Ported party_menu.c, item_menu.c, bag.c, item_use.c, item_menu_icons.c, pokemon_icon.c, list_menu.c,
  menu_indicators.c (scroll arrows), menu.c / new_menu_helpers.c / menu_helpers.c / text_window.c,
  reshow_battle_screen.c and money.c's money box, plus pokemon.c's PokemonUseItemEffects (now complete, in and out
  of battle), PokemonItemUseNoEffect, GetEvolutionTargetSpecies, CanMonLearnTMHM, Battle_PrintStatBoosterEffectMessage.
- gMain + `GbaHostScene`: the battle's CB2s/VBlank moved to `battle/battleCallbacks.ts` so the menus can replace
  and restore them; the player and Oak/Old Man controllers now open the real bag/party (incl. InitOldManBag and
  Oak's first-battle party narration).
- Extractor: menu graphics prefixes (party_menu, item_menu, items, help_system) and mon icons; anim tables for
  party_menu.c / item_menu_icons.c / pokemon_icon.c / menu_indicators.c (4-arg ANIMCMD_FRAME now parsed);
  `menus.json`; more define headers (item.h, list_menu.h, menu_helpers.h, task.h, ...), `((u8) -N)` values;
  gPPUpAddValues and sStatsToRaise in the mechanics tables.
- Fixes found on the way: glyph colour 0 now leaves the window pixel untouched (GLYPH_COPY), so text on a
  differently-filled background no longer punches holes; GetStringWidth ported from text.c (latin glyphs don't add
  letter spacing, control-code argument lengths).
- Verified headless: field party menu (render, action menu, SWITCH slide, back to the start menu), bag (pockets,
  scroll arrows, icons, descriptions, context menu), Potion on a hurt mon from the bag (HP bar animates 12→28, bag
  3→2, back to the bag), Rare Candy (Lv5→6, both stats pages), giving a held item; in battle: bag → Potion at full HP
  ("won't have any effect"), X Attack ("ATTACK rose!"), Poké Ball throw → B_OUTCOME_CAUGHT, cancel → battle screen
  rebuilt, party SHIFT → "Go! PIDGEY!"; a trainer battle still runs to B_OUTCOME_WON.
- Not verified: Oak's first-battle narration in the party menu (needs the lab rival battle), the Old Man bag.

### Summary screen
- Ported pokemon_summary_screen.c (all four pages, page flips with the BG slide and HP/EXP bar sprites, switching
  mons with UP/DOWN, the move details page with move switching, select-a-move-to-forget mode), plus the pieces it
  reaches for: trainer_pokemon_sprites.c (mon pic sprites), mon_markings.c (marking combo sprite),
  dynamic_placeholder_text_util.c, BlitMenuInfoIcon / ListMenuLoadStdPalAt (list_menu.c), SafeFreeMonIconPalette,
  StringCompareWithoutExtCtrlCodes, GetMapName, and text.c's keypad icons (DrawKeypadIcon, their widths in
  GetStringWidth).
- Wired like the C: party menu SUMMARY → ShowPokemonSummaryScreen → back with GetLastViewedMonIndex; learning a 5th
  move from the party menu (TM/Rare Candy/tutor) and in battle (Cmd_yesnoboxlearnmove → ReshowBattleScreenAfterMenu,
  waiting for BattleMainCB2) use ShowSelectMovePokemonSummaryScreen + GetMoveSlotToReplace. The BattleUi
  `selectMoveToForget` stub is gone. The TM path's forget animation is skipped like the other item-use animations.
- Extractor: graphics/summary_screen/ and graphics/misc/ prefixes; anim tables for pokemon_summary_screen.c and
  mon_markings.c; menus.json gains natureNames, abilityDescriptions, moveDescriptions, mapsecNames, menuInfoIcons;
  defines gain pokemon_summary_screen.h, mon_markings.h, data.h and the MAPSEC_* enum (rendered from the
  region_map_sections.json template). fonts.json gains sKeypadIcons.
- Fixes found on the way: the decomp now names glyph sheets `.hwlatfont`/`.fwlatfont` and latin_small.png is a plain
  8x16-cell sheet, so the font extractor had been producing no fonts; it now matches both and records `halfWidth`.
  `state.currentMapSection` was never updated (caught/given mons were met at MAPSEC_NONE); the overworld now sets it
  and `state.currentMap` on every map load.
- Verified headless: field party menu → SUMMARY on Charmander (INFO with type icon, OT/ID, nature + "Met in PALLET
  TOWN" memo; SKILLS with yellow HP bar, EXP bar, ability; KNOWN MOVES; move details), DOWN to a poisoned Pidgey
  holding an Oran Berry (PSN icon, two type icons), switching Tackle/Sand-Attack (party data swapped), B back to the
  party menu with Pidgey selected. In battle: Pidgey Lv8 → 9 learns GUST, "delete a move?" YES opens the
  select-move summary (GUST as the 5th row, "PICK" only), choosing SAND-ATTACK → "1, 2, and… Poof!".
- Also verified with an injected party: a shiny Charmander (shiny border palette, star, shiny pic), a Pidgey with
  cured Pokérus (the dot by the ball), an egg (egg pic, "almost ready to hatch", Day-Care memo, CANCEL-only
  controls), and Rare Candy on a Lv12 Charmander with four moves (Lv13, the forget summary lists METAL CLAW,
  Growl → Metal Claw with 35 PP).
- Not verified: the TM forget path (TMs can't be used until the TM Case exists). Eggs show their species name
  because nothing creates eggs yet (CreateEgg would set the "EGG" nickname).

### NPCs across map connections (user report)
- Report: leaving Pallet Town north, the sign lady (standing at the Route 1 entrance once
  FLAG_PALLET_LADY_NOT_BLOCKING_SIGN is set) vanished on the crossing while still on screen, and popped back on return.
- Cause: every map load destroyed all objects. On the GBA, LoadMapFromCameraTransition leaves gObjectEvents alone;
  the old map's objects keep their mapNum/mapGroup and are only removed by RemoveObjectEventsOutsideView once
  both their current and initial coords leave the view window.
- Fix: `Npc` records its `map` and spawn coords; each camera step runs UpdateObjectEventsForCameraUpdate
  (TrySpawnObjectEvents + RemoveObjectEventsOutsideView). Warps still ResetObjectEvents, and now spawn only in view
  like InitObjectEventsLocal. Local-id lookups (`objectByLocalId`, `removeObject`, `addObject`, spawn dedup) are
  scoped to the current map (GetObjectEventIdByLocalIdAndMap); collision and talking still see every object.
- Verified headless: with the lady at (12,2), walking north she stays on screen on Route 1, is removed at 10 rows
  away, and walking back she is the same object (no duplicate).
- As on the GBA, a neighbouring map's objects aren't spawned until you cross into it, so an object that was
  already removed pops in at the crossing.

### Neighbour-map NPCs (QOL) + template reload fix (user request)
- Template bug: `templates` cached each map's object templates for the whole session, so `setobjectxyperm` /
  `setobjectmovementtype` edits never reverted. The GBA reloads them from the header on every map entry
  (LoadObjEventTemplatesFromHeader in LoadMapFromWarp / LoadMapFromCameraTransition), so they only last while you're
  on the map. Now `onMapLoaded` reloads the current map's templates before ON_TRANSITION. Effect: after the start
  menu has been opened, the Pallet sign lady goes back to (3,10) and wanders instead of staying at the Route 1 entrance.
- QOL: replaced the view-window spawn/despawn from the previous entry with spawning all objects of the loaded
  (current + connected) maps; see "Deliberate QOL changes". `World.loaded` exposes the loaded chunks; `Npc` keeps its
  chunk, the template it spawned as, and a `stale` flag.
- Verified headless: in Pallet, Route 1's and Route 21 North's NPCs are out; stepping onto Route 1 drops Route 21
  North's and adds Viridian's, and the sign lady stays at (12,2) all the way up Route 1 and back. Re-entering Pallet
  after setting FLAG_OPENED_START_MENU: she's marked stale and stays put while on screen, and is respawned at (3,10)
  wandering once off screen; warping in gives (3,10) straight away and VAR_MAP_SCENE_PALLET_TOWN_SIGN_LADY = 2.

### Invisible sprites north of the Viridian sign (user report)
- Report: walking north from Pallet into Viridian, the player vanished past the sign at (20,16) and the old man was
  invisible (but still blocked the path); walking back south past the sign the player reappeared.
- Cause: world origins are never rebased, so after walking up from Pallet, Viridian sits at y = -80 tiles. Object depth
  was `1000 + pixel y`, which went negative from world tile y -64 (the sign's row) and sorted under the `below`
  tile layer at depth 0.
- Fix: depth bands in `MapChunk.ts` are now symmetric around 0 (border/below at -1e6, objects at pixel y,
  above at +1e6), which leaves ±62,500 tiles of room either way. (Superseded by "GBA sprite subpriority" below:
  depth no longer depends on world position. The old man had a second, separate cause; see "Invisible Viridian
  old man".)
- Verified headless by reloading Viridian at origin (0,-80) and walking up x=22 past the sign: the player and the
  Viridian NPCs are drawn (they weren't before the fix). `?map=` always loads at origin 0, so it can't reproduce
  bugs that depend on world position; for those, `await s.world.load(name, ox, oy)` then `s.player.setPosition(...)`
  and `await s.onMapLoaded(false)`.

### Sprite priority from elevation (user request)
- Ported sElevationToPriority / UpdateObjectEventElevationAndPriority / ObjectEventUpdateElevation. `ObjectEvent`
  now has `currentElevation` (collision; IsElevationMismatchAt), `previousElevation` (last non-zero; picks the
  priority), `priority` and previousCoords. Update points follow the ground-effect hooks: spawn and
  `setobjectxy`/warp (MoveObjectEventToMapCoords), step begin (a jump's halfway point), and step end; walking in
  place has none. The update is skipped while either coord is on elevation 15. NPC elevations used to stay fixed at
  their template values; now they're updated like the player's.
- Depth bands (`objectDepth` in MapChunk.ts): `below` (BG3+BG2) < priority-2 objects < `above` (BG1) < priority-1
  objects < UI. Only elevations 0, 1, 3, 4 and 5 occur in map data, and 4 is the only raised one (Victory Road,
  Cerulean Cave, Seafoam, Kindle Road, a corner of each Pokémon Center).
- Verified headless on Victory Road 1F: (10,10) elev 3 → stairs (10,9) elev 0 (priority stays 2) → platform (10,8)
  elev 4 (priority 1, depth 1.5M + y) and back down to priority 2; the Cooltrainer at elevation 4 spawns at
  priority 1. Pallet's Oak trigger and the Viridian sign walk are unchanged (priority 2).

### GBA sprite subpriority (user request)
- Replaced the exact pixel-y sort with SetObjectSubpriorityByElevation: `subpriority = sElevationToSubpriority[prevElev]
  + ((16 - (((screenBottom + 8) & 0xFF) >> 4)) << 1) + 1`, i.e. 16 px screen rows, lower rows in front. Ties
  go to the sprite whose top is lower on screen, as in SortSprites (oam.y compare). `objectDepth(priority,
  subpriority, screenTop)` packs this; depth no longer depends on world position at all.
- Like AnimateSprites → CameraUpdate, every object recomputes its subpriority each frame against last frame's
  camera (`field.cameraTop`, gSpriteCoordOffsetY), then the camera is updated. The player's feet are at screen y 88
  (derived from SetSpritePosToOffsetMapCoords + UpdateCameraPanning), matching our camera framing.
- Verified headless: at rest the player's subpriority is 136 (115 + 20 + 1), 104 on Victory Road's raised
  platform (base 83); NPCs n rows above get 2n more. While walking, the player's screen bottom reads 89 (one
  frame of camera lag, as on the GBA). Pallet's Oak trigger and the Viridian sign walk are unchanged.

### Camera ignores jump lift
- The camera followed the player sprite including the jump arc, so the whole screen bobbed on ledge jumps. On the
  GBA the camera object copies the player sprite's x/y but not y2 (CameraObject_1), and jumps animate y2, so the
  screen scrolls steadily while the player arcs. `ObjectEvent.anchor` is now the lift-free position, and the camera
  follows that.
- Verified headless on Route 1's ledge at (4,5): camera scrollY now rises linearly (-8 → 23) through the jump; before,
  it stalled and then caught up with the arc.

### Invisible Viridian old man (user report)
- Report: after the depth fix, the tutorial old man north of the Viridian sign was still invisible (but blocking).
- Cause: his template uses `OBJ_EVENT_GFX_VAR_0`, which ViridianCity_OnTransition points at OLD_MAN_LYING_DOWN /
  OLD_MAN_1 through `VAR_OBJ_GFX_ID_0`. Nothing resolved dynamic graphics ids, so there was no sprite sheet and
  `spawnNpc` silently returned nothing (the blocking is the map's coord event, not the object).
- Fix: `resolveGraphicsId` ports SetObjectEventDynamicGraphicsId / GetObjectEventGraphicsInfo (VAR_OBJ_GFX_ID_n,
  out-of-range → LITTLE_BOY). Sprites are preloaded again after ON_TRANSITION/ON_LOAD with the resolved ids; an
  object is marked stale if its resolved graphics changed; spawn failures now `console.warn` once per id.
  A neighbour map's var-graphics objects aren't spawned until that map is current, since its ON_TRANSITION hasn't
  set the vars yet (see "Deliberate QOL changes": neighbour spawning).
- Verified headless: walking north from Route 1 (10,3) up x=22, the old man is drawn lying at (21,11) and the
  coord trigger starts beside him; Pallet's Oak trigger unchanged.

### Dev start preset: after the rival battle (user request)
- `?start=after-rival[&starter=...]` applies, to a new-game state, what the scripts leave behind from the house
  through the won lab battle: house/Pallet/Oak scene vars, FLAG_WORLD_MAP_PALLET_TOWN, FLAG_VISITED_OAKS_LAB,
  starter + Pokédex, both balls' hide flags, VAR_STARTER_MON, trainer flag, FLAG_HIDE_RIVAL_IN_LAB, scene var 4,
  FLAG_BEAT_RIVAL_IN_OAKS_LAB. Battle effects follow MonGainEVs, Cmd_getexp (×1.5 trainer), TryIncrementMonLevel +
  AdjustFriendship(GROW_LEVEL, +1 met here), Cmd_getmoneyreward, then HealPlayerParty. Start: lab (6,8) facing down.
- Verified headless: a real playthrough (Squirtle, mid trigger, won) and the preset give identical flags, scene
  vars, money (3080), Pokédex and party (Lv6, exp 202, friendship 76, 1 Sp. Atk EV, moves/PP), apart from the house
  var the real run skipped. Bulbasaur/Charmander give exp 204/205 as the formula predicts.
- Not covered: losing the battle, and having opened the start menu before the rival picks
  (VAR_MAP_SCENE_PALLET_TOWN_SIGN_LADY).

### Trainer battles (user report: Brock gave TM39 without a battle)
- Causes: (1) the extractor never expanded `trainerbattle_single`/`_double`, whose bodies pick the mode with
  `.if/.elseif`, so the interpreter skipped the line and Brock's script fell through to `goto_if_unset
  FLAG_GOT_TM39_FROM_BROCK`; (2) `trainerbattle` only handled EARLY_RIVAL and SINGLE_NO_INTRO_TEXT.
- Extractor: macro bodies now go through `.if/.elseif/.else/.endif` (constants from the defines plus event.inc's
  `NO_MUSIC = FALSE` symbols; labels compare as themselves); all 729 trainer battles expand to `trainerbattle`.
  `sRematches` is extracted into scripts.json. Trainer parties: one-line dummy parties (`{DUMMY_TRAINER_MON};`)
  made the regex swallow the next party, leaving 64 real trainers (Youngster Ben, Camper Chris, ...) with none.
  The sprites folder is cleared before writing: an old `Blackbelt.png` survived on the case-insensitive disk and the
  dev server's case-sensitive lookup of `BlackBelt.png` failed (Route 4's Black Belt never spawned).
- Engine: `trainerbattle` ports BattleSetup_ConfigureTrainerBattle (all s*BattleParams layouts, SetMapVarsToTrainer,
  GetRematchTrainerId) and jumps to EventScript_TryDoNormalTrainerBattle / Double / Rematch / NoIntro. New:
  `gotobeatenscript`, `reveal_trainer` (no FRLG disguises), specials Script_HasTrainerBeenFought,
  SetBattledTrainerFlag, GetTrainerBattleMode, SetUpTrainerMovement (NpcBrain.setMovementType),
  ShowTrainerIntroSpeech, ShowTrainerCantBattleSpeech, HasEnoughMonsForDoubleBattle, ShouldTryRematchBattle,
  IsTrainerReadyForRematch, StartRematchBattle. CB2_EndTrainerBattle is shared; a white-out now ends the script
  (it used to continue, which would have handed out Brock's badge after a loss). `Assets.loadSprite` shares
  in-flight loads.
- Verified headless (`?start=after-rival` + a Lv70 Squirtle): Brock gives his intro, battles, then sets
  FLAG_DEFEATED_BROCK / FLAG_BADGE01_GET / trainer flag / VAR_MAP_SCENE_PEWTER_CITY, pays ₽1400 and gives TM39;
  talking again gives the post-battle line, no battle. Route 3 Ben: battle, ₽176, then ShouldTryRematchBattle →
  rematch script → not ready → post-battle line. Losing to Camper Liam with the Lv6 starter ends the script with no
  trainer flag. Oak's lab rival battle unchanged.

### White-out (user request)
- `setrespawn` (SetLastHealLocationWarp) stores `state.lastHealLocation`. The extractor numbers HEAL_LOCATION_* from
  src/data/heal_locations.json (as the decomp's build does) and adds that table plus ComputeWhiteOutMoneyLoss's
  arrays to scripts.json. The start preset now records the house's `setrespawn HEAL_LOCATION_PALLET_TOWN`.
- A lost battle leaves the field black: the script engine either returns to the field
  (CB2_ReturnToFieldContinueScriptPlayMapMusic, `TrainerBattleRun.returnToField`) or ends the script and calls
  `host.whiteOut()`. OverworldScene.whiteOut is CB2_WhiteOut as an overlay: 120 black frames; DoWhiteOut
  (EventScript_ResetEliteFourEnd, RemoveMoney(ComputeWhiteOutMoneyLoss), HealPlayerParty,
  Overworld_ResetStateAfterWhitingOut, SetWhiteoutRespawnWarpAndHealerNpc incl. its special-cased coordinates and
  VAR_LAST_TALKED = healer, warp facing north); then Task_RushInjuredPokemonToCenter: "scurried to a POKéMON
  CENTER" / "back home" in white on black (`ui/WhiteOutText.ts`, sWindowTemplate_WhiteoutText, 1 char/frame, no
  speed-up), fade in, EventScript_AfterWhiteOutHeal / EventScript_AfterWhiteOutMomHeal.
- Verified headless, losing to Camper Liam with the preset's Lv6 starter: with the house as respawn point → "scurried
  back home", house 1F (8,5) facing north, Mom's script, party healed, ₽48 lost (Lv6 × 4 × 2); after entering
  Pewter's Pokémon Center → "scurried to a POKéMON CENTER", Pewter PC 1F (7,4), VAR_LAST_TALKED = the nurse, her
  heal script. Winning against Brock still fades back to the field and continues his script.
