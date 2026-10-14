import type Phaser from 'phaser';
import type { Input } from '../input/Input';
import { EOS, type Charmap } from '../text/charmap';
import { FONT_NORMAL, FONT_SMALL, type Fonts } from '../text/Font';
import { MenuWindow } from './MenuWindow';

/** money.c's field money box: "MONEY" over the amount, in a std-framed 8x3 window (DrawMoneyBox). */
export class MoneyBox {
  private win: MenuWindow;

  constructor(
    scene: Phaser.Scene,
    private fonts: Fonts,
    input: Input,
    private charmap: Charmap,
    strings: Record<string, string>,
    amount: number,
    x: number,
    y: number,
  ) {
    // SetWindowTemplateFields(0, x + 1, y + 1, 8, 3, 15, 8) with LoadStdWindowGfx's frame
    this.win = new MenuWindow(scene, { left: x + 1, top: y + 1, width: 8, height: 3 }, fonts, input, 'std');
    this.win.print(charmap.encode(strings.gText_TrainerCardMoney), 0, 0, FONT_NORMAL); // PrintMoneyAmountInMoneyBoxWithBorder
    this.change(amount);
  }

  /** ChangeAmountInMoneyBox / PrintMoneyAmountInMoneyBox: "¥N" right-aligned to x 64, padded to 6 digits with spaces. */
  change(amount: number): void {
    const digits = String(amount);
    const text = [...new Array(Math.max(0, 6 - digits.length)).fill(0), ...this.charmap.encodePlain(`¥${digits}$`)];
    const font = this.fonts.get(FONT_SMALL);
    const width = text.reduce((w, c) => w + font.width(c), 0); // GetStringWidth(FONT_SMALL, str, 0)
    this.win.clearRect(0, 12, 64, 12); // the leading spaces repaint the old amount on the GBA
    this.win.print([...text, EOS], 64 - width, 12, FONT_SMALL);
    this.win.flush();
  }

  /** HideMoneyBox */
  destroy(): void {
    this.win.destroy();
  }
}
