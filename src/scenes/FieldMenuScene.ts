// The GBA-layer screens opened from the field: the party menu and bag from the start menu
// (CB2_PartyMenuFromStartMenu / CB2_BagMenuFromStartMenu) and the Poké Mart's buy menu and sell bag
// (CB2_InitBuyMenu / CB2_GoToSellMenu). The overworld isn't a GBA screen, so its return points
// (CB2_ReturnToFieldWithOpenMenu, CB2_ReturnToField) end this scene instead.

import type { Assets } from '../data/assets';
import { K } from '../battle/constants';
import { initBattleEnv, setTextStrings } from '../battle/env';
import { loadGfx } from '../gba/gfx';
import { gMain, SetMainCallback1, SetMainCallback2, SetVBlankCallback } from '../gba/main';
import { initGbaText } from '../gba/window';
import { fieldReturn } from '../menus/fieldCallbacks';
import { prepareMenus } from '../menus/host';
import { CB2_BagMenuFromStartMenu } from '../menus/itemMenu';
import { setObjectEventGraphicsInfo } from '../menus/objectEventGraphics';
import { CB2_PartyMenuFromStartMenu } from '../menus/partyMenu';
import { buyMenuGfxSymbols, CB2_GoToSellMenu, CB2_InitBuyMenu, LoadFieldTilesetsForShop, type ShopFieldView } from '../menus/shop';
import type { PokemonData } from '../pokemon/Pokemon';
import type { GameState } from '../state/GameState';
import type { Charmap } from '../text/charmap';
import { Fonts } from '../text/Font';
import { TEXT_SPEED } from '../text/TextPrinter';
import { sharedBattleData } from './BattleScene';
import { GbaHostScene } from './GbaHostScene';

const TEXTURE = 'field_menu_screen';

export interface FieldMenuStart {
  menu: 'party' | 'bag' | 'buy' | 'sell';
  /** For 'buy': what the buy menu's map view reads from the field. */
  shopField?: ShopFieldView;
  state: GameState;
  pokemon: PokemonData;
  charmap: Charmap;
  /** Back to the field; `openStartMenu` for CB2_ReturnToFieldWithOpenMenu. */
  onExit(openStartMenu: boolean): void;
}

export class FieldMenuScene extends GbaHostScene {
  private start!: FieldMenuStart;

  constructor() {
    super('FieldMenu');
  }

  async create(start: FieldMenuStart): Promise<void> {
    this.start = start;
    this.initHost(TEXTURE);
    const assets: Assets = this.registry.get('assets');
    // Item effects, anim tables and battle strings come with the battle data.
    const data = await sharedBattleData();
    initBattleEnv(data, assets.scripts.defines, start.pokemon, start.state, start.charmap);
    setTextStrings(assets.strings);
    await loadGfx(['sDownArrowTiles']);
    await prepareMenus(start.state);
    initGbaText(new Fonts(this, assets.fonts), this.buttons, TEXT_SPEED[start.state.textSpeed].scroll);
    this.lEqualsA = start.state.optionsButtonMode === K.OPTIONS_BUTTON_MODE_L_EQUALS_A;

    if (start.menu === 'buy') {
      setObjectEventGraphicsInfo(assets.sprites);
      await loadGfx(buyMenuGfxSymbols(start.shopField!));
      LoadFieldTilesetsForShop(start.shopField!);
    }

    fieldReturn.withOpenMenu = () => this.exit(true);
    fieldReturn.plain = () => this.exit(false);
    gMain.inBattle = false;
    SetMainCallback1(null);
    const entry = { party: CB2_PartyMenuFromStartMenu, bag: CB2_BagMenuFromStartMenu, buy: CB2_InitBuyMenu, sell: CB2_GoToSellMenu };
    SetMainCallback2(entry[start.menu]);
    this.startHost();
  }

  private exit(openStartMenu: boolean): void {
    this.stopHost();
    SetMainCallback2(null);
    SetVBlankCallback(null);
    this.start.onExit(openStartMenu);
  }
}
