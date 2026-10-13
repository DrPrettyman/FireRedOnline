// BattlePutTextOnWindow (battle_message.c) and HandleBattleWindow / the Yes-No cursor
// (battle_script_commands.c): battle text and boxes on BG0/BG1.

import { CopyBgTilemapBufferToVram, CopyToBgTilemapBufferRect_ChangePalette } from '../gba/bg';
import { AddTextPrinter, COPYWIN_FULL, CopyWindowToVram, FillWindowPixelBuffer, GetStringWidth, gTextFlags, PutWindowTilemap } from '../gba/window';
import { K } from './constants';
import { bdata, g } from './env';

const FONT_NORMAL = 2;
const FONT_MALE = 4;
const FONT_FEMALE = 5;

/** sNpcTextColorToFont */
function npcFont(color: number): number {
  if (color === K.NPC_TEXT_COLOR_MALE) return FONT_MALE;
  if (color === K.NPC_TEXT_COLOR_FEMALE) return FONT_FEMALE;
  return FONT_NORMAL;
}

/** Options text speed (GetTextSpeedSetting): frames per character. */
let textSpeedDelay = 4;
export function setBattleTextSpeed(delay: number): void {
  textSpeedDelay = delay;
}

/** BattlePutTextOnWindow: windowId's upper 2 bits are flags (0x40 NPC font, 0x80 don't clear). */
export function BattlePutTextOnWindow(text: number[], windowIdFlags: number): void {
  const textFlags = windowIdFlags & 0xc0;
  const windowId = windowIdFlags & 0x3f;
  const info = bdata.strings.textOnWindows[windowId]!;
  if (!(textFlags & 0x80)) FillWindowPixelBuffer(windowId, info.fillValue);
  const fontId = textFlags & 0x40 ? npcFont(g.npcTextColor) : info.fontId;
  let x: number;
  switch (windowId) {
    case K.B_WIN_VS_PLAYER:
    case K.B_WIN_VS_OPPONENT:
    case K.B_WIN_VS_MULTI_PLAYER_1:
    case K.B_WIN_VS_MULTI_PLAYER_2:
    case K.B_WIN_VS_MULTI_PLAYER_3:
    case K.B_WIN_VS_MULTI_PLAYER_4:
      x = Math.trunc((48 - GetStringWidth(info.fontId, text, info.letterSpacing)) / 2);
      break;
    case K.B_WIN_VS_OUTCOME_DRAW:
    case K.B_WIN_VS_OUTCOME_LEFT:
    case K.B_WIN_VS_OUTCOME_RIGHT:
      x = Math.trunc((64 - GetStringWidth(info.fontId, text, info.letterSpacing)) / 2);
      break;
    default:
      x = info.x;
  }
  if (x < 0) x = 0;
  gTextFlags.useAlternateDownArrow = windowId !== K.B_WIN_OAK_OLD_MAN;
  gTextFlags.autoScroll = !!(g.battleTypeFlags & K.BATTLE_TYPE_LINK || (g.battleTypeFlags & K.BATTLE_TYPE_POKEDUDE && windowId !== K.B_WIN_OAK_OLD_MAN));
  let speed: number;
  if (windowId === K.B_WIN_MSG || windowId === K.B_WIN_OAK_OLD_MAN) {
    speed = g.battleTypeFlags & K.BATTLE_TYPE_LINK ? 1 : textSpeedDelay;
    gTextFlags.canABSpeedUpPrint = true;
  } else {
    speed = info.speed;
    gTextFlags.canABSpeedUpPrint = false;
  }
  AddTextPrinter(
    {
      currentChar: text,
      windowId,
      fontId,
      x,
      y: info.y,
      letterSpacing: info.letterSpacing,
      lineSpacing: info.lineSpacing,
      fgColor: info.fgColor,
      bgColor: info.bgColor,
      shadowColor: info.shadowColor,
    },
    speed,
  );
  if (!(textFlags & 0x80)) {
    PutWindowTilemap(windowId);
    CopyWindowToVram(windowId, COPYWIN_FULL);
  }
}

/** HandleBattleWindow */
export function HandleBattleWindow(xStart: number, yStart: number, xEnd: number, yEnd: number, flags: number): void {
  for (let destY = yStart; destY <= yEnd; destY++) {
    for (let destX = xStart; destX <= xEnd; destX++) {
      let v: number;
      if (destY === yStart) v = destX === xStart ? 0x1022 : destX === xEnd ? 0x1024 : 0x1023;
      else if (destY === yEnd) v = destX === xStart ? 0x1028 : destX === xEnd ? 0x102a : 0x1029;
      else v = destX === xStart ? 0x1025 : destX === xEnd ? 0x1027 : 0x1026;
      if (flags & K.WINDOW_CLEAR) v = 0;
      CopyToBgTilemapBufferRect_ChangePalette(flags & K.WINDOW_BG1 ? 1 : 0, [v], destX, destY, 1, 1, 0x11);
    }
  }
}

/** BattleCreateYesNoCursorAt (position in gBattleCommunication[1]) */
export function BattleCreateYesNoCursorAt(): void {
  CopyToBgTilemapBufferRect_ChangePalette(0, [1, 2], 0x18, 9 + 2 * g.battleCommunication[1], 1, 2, 0x11);
  CopyBgTilemapBufferToVram(0);
}

export function BattleDestroyYesNoCursorAt(): void {
  CopyToBgTilemapBufferRect_ChangePalette(0, [32, 32], 0x18, 9 + 2 * g.battleCommunication[1], 1, 2, 0x11);
  CopyBgTilemapBufferToVram(0);
}
