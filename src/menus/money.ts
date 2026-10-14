// money.c: the money box text (the money itself is GameState.money).

import { K } from '../battle/constants';
import { DrawStdFrameWithCustomTileAndPalette } from '../gba/menu';
import { AddTextPrinterParameterized, GetStringWidth } from '../gba/window';
import { ConvertIntToDecimalStringN, gStringVar1, STR_CONV_MODE_LEFT_ALIGN, StringExpandPlaceholders, setStringVar4, text } from './common';

/** The ¥ amount right-aligned in 6 digits (PrintMoneyAmount's buffer). */
function moneyString(amount: number): number[] {
  gStringVar1.set(ConvertIntToDecimalStringN(amount, STR_CONV_MODE_LEFT_ALIGN, 6));
  const strLength = 6 - gStringVar1.get().length;
  const out = [...new Array<number>(strLength).fill(0), ...StringExpandPlaceholders(text('gText_PokedollarVar1'))];
  setStringVar4(out);
  return out;
}

export function PrintMoneyAmountInMoneyBox(windowId: number, amount: number, speed: number): void {
  const str = moneyString(amount);
  AddTextPrinterParameterized(windowId, K.FONT_SMALL, str, 64 - GetStringWidth(K.FONT_SMALL, str, 0), 0xc, speed);
}

export function PrintMoneyAmount(windowId: number, x: number, y: number, amount: number, speed: number): void {
  AddTextPrinterParameterized(windowId, K.FONT_SMALL, moneyString(amount), x, y, speed);
}

export function PrintMoneyAmountInMoneyBoxWithBorder(windowId: number, tileStart: number, paletteNum: number, amount: number): void {
  DrawStdFrameWithCustomTileAndPalette(windowId, false, tileStart, paletteNum);
  AddTextPrinterParameterized(windowId, K.FONT_NORMAL, text('gText_TrainerCardMoney'), 0, 0, 0xff);
  PrintMoneyAmountInMoneyBox(windowId, amount, 0);
}

