// What battle code needs from the screen beyond the controllers: the GBA calls these directly
// (HandleBattleWindow, BattlePutTextOnWindow, JOY_NEW, palette fades, ...). BattleScene implements it.

import type { Pokemon } from '../pokemon/Pokemon';

export type GbaButton = 'A' | 'B' | 'START' | 'SELECT' | 'L' | 'R' | 'UP' | 'DOWN' | 'LEFT' | 'RIGHT';

export interface BattleUi {
  /** JOY_NEW */
  joyNew(button: GbaButton): boolean;
  /** JOY_HELD */
  joyHeld(button: GbaButton): boolean;
  /** gMain.newKeys != 0 */
  anyNewKeys(): boolean;
  /** HandleBattleWindow(xStart, yStart, xEnd, yEnd, flags): draw/clear a std-framed box on BG0/BG1. */
  handleBattleWindow(xStart: number, yStart: number, xEnd: number, yEnd: number, flags: number): void;
  /** BattlePutTextOnWindow */
  putTextOnWindow(text: number[], windowIdFlags: number): void;
  /** BattleCreateYesNoCursorAt / BattleDestroyYesNoCursorAt (cursor position in gBattleCommunication[1]) */
  createYesNoCursor(position: number): void;
  destroyYesNoCursor(position: number): void;
  /** BeginNormalPaletteFade to/from black over all palettes; and gPaletteFade.active */
  beginFade(toBlack: boolean): void;
  fadeActive(): boolean;
  /** PlaySE (audio isn't implemented; kept so call sites read like the C) */
  playSE(songId: number): void;
  /** PlayCry_* (no audio yet) */
  playCry(species: number): void;
  /** PlayBGM / PlayFanfare (no audio yet) */
  playBGM(songId: number): void;
  playFanfare(songId: number): void;
  /** AddBagItem */
  addBagItem(itemId: number, count: number): void;
  /** gSaveBlock2Ptr->playerGender (MALE 0 / FEMALE 1, which is also the TRAINER_BACK_PIC id) */
  playerGender(): number;
  /** Cmd_drawlvlupbox pages: DrawLevelUpWindowPg1/Pg2 into B_WIN_LEVEL_UP_BOX (null hides it). */
  levelUpBox(page: 1 | 2 | null, before: ArrayLike<number>, after: ArrayLike<number>): void;
  /** The level-up banner for a mon that isn't sent out: BG2 x scroll and contents. */
  levelUpBanner(mon: Pokemon | null, bg2X: number): void;
  /**
   * ShowSelectMovePokemonSummaryScreen + GetMoveSlotToReplace: start choosing a move to forget;
   * poll() returns undefined while open, then the slot (MAX_MON_MOVES = keep old moves).
   */
  selectMoveToForget(mon: Pokemon, moveToLearn: number): { poll(): number | undefined };
}

export let ui: BattleUi;

export function setBattleUi(u: BattleUi): void {
  ui = u;
}
