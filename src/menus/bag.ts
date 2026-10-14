// bag.c: the bag screen's windows (list, description, pocket name) and its pop-up windows.

import { gfx16 } from '../gba/gfx';
import {
  ClearDialogWindowAndFrameToTransparent,
  ClearStdWindowAndFrameToTransparent,
  CreateYesNoMenuWithCallbacks,
  DrawStdFrameWithCustomTileAndPalette,
  DrawTextBorderOuter,
  LoadMenuMessageWindowGfx,
  LoadStdWindowGfx,
  LoadUserWindowGfx,
  ScheduleBgCopyTilemapToVram,
} from '../gba/menu';
import { BG_PLTT_ID } from '../gba/palette';
import { LoadPalette } from '../gba/palette';
import type { TaskFunc } from '../gba/task';
import {
  AddTextPrinterParameterized,
  AddTextPrinterParameterized3,
  AddTextPrinterParameterized4,
  AddWindow,
  ClearWindowTilemap,
  DeactivateAllTextPrinters,
  FillWindowPixelBuffer,
  GetStringWidth,
  InitWindows,
  PutWindowTilemap,
  RemoveWindow,
  type WindowTemplate,
  DUMMY_WIN_TEMPLATE,
} from '../gba/window';
import { K } from '../battle/constants';
import { state } from '../battle/env';
import { text } from './common';
import { PrintMoneyAmountInMoneyBoxWithBorder } from './money';
import { gBagMenuState } from './itemMenuState';

/** sTextColors */
const sTextColors = [
  [0, 1, 2],
  [0, 2, 3],
  [0, 3, 2],
  [0, 8, 9],
];

const win = (bg: number, tilemapLeft: number, tilemapTop: number, width: number, height: number, paletteNum: number, baseBlock: number): WindowTemplate => ({
  bg,
  tilemapLeft,
  tilemapTop,
  width,
  height,
  paletteNum,
  baseBlock,
});

const sDefaultBagWindowsStd: WindowTemplate[] = [win(0, 11, 1, 18, 12, 15, 0x008a), win(0, 5, 14, 25, 6, 15, 0x0162), win(0, 1, 1, 9, 2, 15, 0x01f8), DUMMY_WIN_TEMPLATE];

const sDefaultBagWindowsDeposit: WindowTemplate[] = [win(0, 11, 1, 18, 12, 15, 0x008a), win(0, 5, 14, 25, 6, 15, 0x0162), win(0, 1, 1, 8, 2, 12, 0x01f8), DUMMY_WIN_TEMPLATE];

const sWindowTemplates: WindowTemplate[] = [
  win(0, 24, 15, 5, 4, 15, 0x242),
  win(0, 17, 9, 12, 4, 15, 0x242),
  win(0, 1, 1, 8, 3, 12, 0x272),
  win(0, 23, 15, 6, 4, 15, 0x28a),
  win(0, 21, 9, 6, 4, 15, 0x28a),
  win(0, 2, 15, 26, 4, 15, 0x2a2),
  win(0, 6, 15, 14, 4, 12, 0x2a2),
  win(0, 6, 15, 15, 4, 12, 0x2da),
  win(0, 6, 15, 16, 4, 12, 0x316),
  win(0, 6, 15, 23, 4, 12, 0x356),
  win(0, 22, 17, 7, 2, 15, 0x20a),
  win(0, 22, 15, 7, 4, 15, 0x20a),
  win(0, 22, 13, 7, 6, 15, 0x20a),
  win(0, 22, 11, 7, 8, 15, 0x20a),
];

const sOpenWindows = new Array<number>(11).fill(0xff);

export function InitBagWindows(): void {
  if (gBagMenuState.location !== K.ITEMMENULOCATION_ITEMPC) InitWindows(sDefaultBagWindowsStd);
  else InitWindows(sDefaultBagWindowsDeposit);
  DeactivateAllTextPrinters();
  LoadUserWindowGfx(0, 0x64, BG_PLTT_ID(14));
  LoadMenuMessageWindowGfx(0, 0x6d, BG_PLTT_ID(13));
  LoadStdWindowGfx(0, 0x81, BG_PLTT_ID(12));
  LoadPalette(gfx16('sBagWindowPalF'), BG_PLTT_ID(15), 32);
  for (let i = 0; i < 3; i++) {
    FillWindowPixelBuffer(i, 0x00);
    PutWindowTilemap(i);
  }
  ScheduleBgCopyTilemapToVram(0);
  sOpenWindows.fill(0xff);
}

export function BagPrintTextOnWindow(windowId: number, fontId: number, str: number[], x: number, y: number, letterSpacing: number, lineSpacing: number, speed: number, colorIdx: number): void {
  AddTextPrinterParameterized4(windowId, fontId, x, y, letterSpacing, lineSpacing, sTextColors[colorIdx], speed, str);
}

export function BagPrintTextOnWin1CenteredColor0(str: number[]): void {
  const x = 0x48 - GetStringWidth(K.FONT_NORMAL_COPY_1, str, 0);
  AddTextPrinterParameterized3(2, K.FONT_NORMAL_COPY_1, x >>> 1, 1, sTextColors[0], 0, str);
}

export function BagDrawDepositItemTextBox(): void {
  DrawStdFrameWithCustomTileAndPalette(2, false, 0x081, 12);
  const x = 0x40 - GetStringWidth(K.FONT_SMALL, text('gText_DepositItem'), 0);
  AddTextPrinterParameterized(2, K.FONT_SMALL, text('gText_DepositItem'), x >>> 1, 1, 0);
}

export function ShowBagWindow(whichWindow: number, nItems: number): number {
  if (sOpenWindows[whichWindow] === 0xff) {
    sOpenWindows[whichWindow] = AddWindow(sWindowTemplates[whichWindow + nItems]);
    if (whichWindow !== 6) DrawStdFrameWithCustomTileAndPalette(sOpenWindows[whichWindow], false, 0x064, 14);
    else DrawStdFrameWithCustomTileAndPalette(sOpenWindows[whichWindow], false, 0x081, 12);
    ScheduleBgCopyTilemapToVram(0);
  }
  return sOpenWindows[whichWindow];
}

export function HideBagWindow(whichWindow: number): void {
  ClearStdWindowAndFrameToTransparent(sOpenWindows[whichWindow], false);
  ClearWindowTilemap(sOpenWindows[whichWindow]);
  RemoveWindow(sOpenWindows[whichWindow]);
  ScheduleBgCopyTilemapToVram(0);
  sOpenWindows[whichWindow] = 0xff;
}

export function OpenBagWindow(whichWindow: number): number {
  if (sOpenWindows[whichWindow] === 0xff) sOpenWindows[whichWindow] = AddWindow(sWindowTemplates[whichWindow]);
  return sOpenWindows[whichWindow];
}

export function CloseBagWindow(whichWindow: number): void {
  if (sOpenWindows[whichWindow] !== 0xff) {
    ClearDialogWindowAndFrameToTransparent(sOpenWindows[whichWindow], false);
    ClearWindowTilemap(sOpenWindows[whichWindow]);
    RemoveWindow(sOpenWindows[whichWindow]);
    PutWindowTilemap(1);
    ScheduleBgCopyTilemapToVram(0);
    sOpenWindows[whichWindow] = 0xff;
  }
}

export function GetBagWindow(whichWindow: number): number {
  return sOpenWindows[whichWindow];
}

export function BagCreateYesNoMenuBottomRight(taskId: number, ptrs: { yesFunc: TaskFunc; noFunc: TaskFunc }): void {
  CreateYesNoMenuWithCallbacks(taskId, sWindowTemplates[3], K.FONT_NORMAL, 0, 2, 0x064, 14, ptrs);
}

export function BagCreateYesNoMenuTopRight(taskId: number, ptrs: { yesFunc: TaskFunc; noFunc: TaskFunc }): void {
  CreateYesNoMenuWithCallbacks(taskId, sWindowTemplates[4], K.FONT_NORMAL, 0, 2, 0x064, 14, ptrs);
}

export function BagPrintMoneyAmount(): void {
  PrintMoneyAmountInMoneyBoxWithBorder(ShowBagWindow(2, 0), 0x081, 0x0c, state.money);
}

export function BagDrawTextBoxOnWindow(windowId: number): void {
  DrawTextBorderOuter(windowId, 0x064, 14);
}
