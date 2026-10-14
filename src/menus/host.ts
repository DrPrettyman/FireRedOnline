// What a host scene does before the party menu, bag or summary screen can run: load menus.json, preload every
// graphic the screens can touch (graphics are fetched asynchronously, the screens use them
// synchronously), and point the menu helpers at the save-block options and string tables.
// Call after initBattleEnv (the K constants and battle data are needed).

import { K } from '../battle/constants';
import { ballGfxSymbols, monPalSymbols, monPicSymbol } from '../battle/gfx';
import { loadGfx } from '../gba/gfx';
import { menuEnv } from '../gba/menu';
import { setStringVarLookup } from '../gba/window';
import type { GameState } from '../state/GameState';
import { TEXT_SPEED } from '../text/TextPrinter';
import { StringExpandPlaceholders, text } from './common';
import { loadMenusData } from './data';
import { itemIconSymbols } from './itemMenuIcons';
import { GetIconSpecies, monIconSymbol } from './pokemonIcon';
import { SUMMARY_SCREEN_GFX } from './summaryScreen';

const PARTY_MENU_GFX = [
  'gPartyMenuBg_Gfx',
  'gPartyMenuBg_Tilemap',
  'gPartyMenuBg_Pal',
  'gPartyMenuPokeball_Gfx',
  'gPartyMenuPokeballSmall_Gfx',
  'gPartyMenuPokeball_Pal',
  'sConfirmButton_Tilemap',
  'sCancelButton_Tilemap',
  'sSlotTilemap_Main',
  'sSlotTilemap_MainNoHP',
  'sSlotTilemap_Wide',
  'sSlotTilemap_WideNoHP',
  'sSlotTilemap_WideEmpty',
  'sHeldItemGfx',
  'sHeldItemPalette',
  'gStatusGfx_Icons',
  'gStatusPal_Icons',
  'gMonIconPalettes',
];

const BAG_GFX = [
  'gBagBg_Gfx',
  'gBagBg_Tilemap',
  'gBagBg_ItemPC_Tilemap',
  'gBagBgPalette',
  'gBagBgPalette_FemaleOverride',
  'gBagMale_Gfx',
  'gBagFemale_Gfx',
  'gBag_Pal',
  'gSwapLine_Gfx',
  'gSwapLine_Pal',
  'sItemListTilemap',
  'sBagWindowPalF',
  'sBlit_SelectButton',
  'sRedArrowOtherGfx',
  'sRedArrowPal',
];

const WINDOW_GFX = ['gMenuMessageWindow_Gfx', 'gStdTextWindow_Gfx', 'gTextWindowPalettes', 'gHelpMessageWindow_Gfx', 'sDownArrowTiles', 'gKeypadIconTiles'];

/** Every graphics symbol the party menu, bag and summary screen can load for this save. */
export function menuGfxSymbols(state: GameState): string[] {
  const syms = new Set<string>([...PARTY_MENU_GFX, ...BAG_GFX, ...WINDOW_GFX, ...SUMMARY_SCREEN_GFX, ...ballGfxSymbols()]);
  // Summary screen front pics and their palettes (normal and shiny).
  for (const mon of state.party) {
    const species = mon.isEgg ? K.SPECIES_EGG : mon.species;
    syms.add(monPicSymbol(true, species, mon.personality));
    for (const p of monPalSymbols(species)) syms.add(p);
  }
  const frame = `sUserFrame_Type${state.optionsWindowFrameType + 1}`;
  syms.add(`${frame}_Gfx`).add(`${frame}_Pal`);
  syms.add(monIconSymbol(K.SPECIES_EGG));
  for (const mon of state.party) syms.add(monIconSymbol(GetIconSpecies(mon.isEgg ? K.SPECIES_EGG : mon.species, mon.personality)));
  // Icons for whatever can show up in the bag: its items, and held items that can be taken.
  const items = new Set<number>();
  for (const pocket of state.bag.pockets) for (const slot of pocket) if (slot.itemId) items.add(slot.itemId);
  for (const mon of state.party) if (mon.heldItem) items.add(mon.heldItem);
  for (const s of itemIconSymbols(items)) syms.add(s);
  return [...syms];
}

/** Load menus.json and the screens' graphics, and set up the menu helpers for this save. */
export async function prepareMenus(state: GameState): Promise<void> {
  await loadMenusData('gen');
  await loadGfx(menuGfxSymbols(state));
  configureMenuEnv(state);
}

export function configureMenuEnv(state: GameState): void {
  menuEnv.textSpeedDelay = TEXT_SPEED[state.textSpeed].delay;
  menuEnv.buttonMode = state.optionsButtonMode;
  menuEnv.windowFrameType = state.optionsWindowFrameType;
  menuEnv.textYesNo = text('gText_YesNo');
  menuEnv.textSelectorArrow2 = text('gText_SelectorArrow2');
  menuEnv.expandPlaceholders = StringExpandPlaceholders;
  setStringVarLookup((n) => state.stringVars[n]);
}
