import type Phaser from 'phaser';
import type { Input } from '../input/Input';
import type { GameState } from '../state/GameState';
import type { Charmap } from '../text/charmap';
import type { Fonts } from '../text/Font';
import { expandPlaceholders } from '../text/placeholders';
import { Menu } from './Menu';
import { MenuWindow } from './MenuWindow';

export type StartMenuItem = 'POKEDEX' | 'POKEMON' | 'BAG' | 'PLAYER' | 'SAVE' | 'OPTION' | 'EXIT';

/** sStartMenuActionTable labels (src/strings.c). */
const LABELS: Record<StartMenuItem, string> = {
  POKEDEX: 'gText_MenuPokedex',
  POKEMON: 'gText_MenuPokemon',
  BAG: 'gText_MenuBag',
  PLAYER: 'gText_MenuPlayer',
  SAVE: 'gText_MenuSave',
  OPTION: 'gText_MenuOption',
  EXIT: 'gText_MenuExit',
};

/** Remembered across openings, like sStartMenuCursorPos. */
let lastCursor = 0;

/**
 * The field start menu (start_menu.c): SetUpStartMenu_NormalField item order, a std-framed
 * window at tile (22, 1) sized to the item count, ▶ cursor that wraps, A selects, B/START close.
 */
export class StartMenu {
  readonly items: StartMenuItem[];
  private win: MenuWindow;
  private menu: Menu;

  constructor(
    scene: Phaser.Scene,
    fonts: Fonts,
    private input: Input,
    charmap: Charmap,
    strings: Record<string, string>,
    state: GameState,
  ) {
    this.items = [];
    if (state.getFlag('FLAG_SYS_POKEDEX_GET')) this.items.push('POKEDEX');
    if (state.getFlag('FLAG_SYS_POKEMON_GET')) this.items.push('POKEMON');
    this.items.push('BAG', 'PLAYER', 'SAVE', 'OPTION', 'EXIT');

    // CreateStartMenuWindow: SetWindowTemplateFields(0, 22, 1, 7, height * 2 - 1, ...)
    this.win = new MenuWindow(scene, { left: 22, top: 1, width: 7, height: this.items.length * 2 - 1 }, fonts, input);
    const text = (label: string) => expandPlaceholders(charmap.encode(strings[label] ?? '?$'), charmap, state);
    this.items.forEach((item, i) => this.win.print(text(LABELS[item]), 8, i * 15));
    lastCursor = Math.min(lastCursor, this.items.length - 1);
    this.menu = new Menu(this.win, input, text('gText_SelectorArrow2'), this.items.length, {
      left: 0,
      top: 0,
      rowHeight: 15,
      wrap: true,
    }, lastCursor);
  }

  /** Returns the chosen item, 'close' when dismissed, or undefined while open. */
  tick(): StartMenuItem | 'close' | undefined {
    if (this.input.pressed('START')) return this.close();
    const r = this.menu.tick();
    this.win.flush();
    lastCursor = this.menu.cursor;
    if (r === 'cancel') return this.close();
    if (r === undefined) return undefined;
    const item = this.items[r];
    if (item === 'EXIT') return this.close();
    this.win.destroy();
    return item;
  }

  private close(): 'close' {
    this.win.destroy();
    return 'close';
  }
}
