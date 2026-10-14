import type Phaser from 'phaser';
import type { Input } from '../input/Input';
import type { GameState } from '../state/GameState';
import type { Charmap } from '../text/charmap';
import { FONT_NORMAL, type Fonts } from '../text/Font';
import { imageDataOf, MESSAGE_TEXTURES } from '../text/MessageBox';
import { expandPlaceholders } from '../text/placeholders';
import { TextPrinter } from '../text/TextPrinter';
import { TextWindow } from '../text/TextWindow';
import { DEPTH_FADE } from './ScreenFade';

// TEXT_COLOR_* (include/characters.h)
const TEXT_COLOR_TRANSPARENT = 0;
const TEXT_COLOR_WHITE = 1;
const TEXT_COLOR_DARK_GRAY = 2;

/** sWindowTemplate_WhiteoutText: tilemapLeft 0, tilemapTop 5, 30x11 tiles. */
const WIN = { left: 0, top: 5, width: 30, height: 11 };

/**
 * PrintWhiteOutRecoveryMessage (field_screen_effect.c): white text straight on the black screen, one
 * character per frame and no A/B speed-up, ending at the text's \p button prompt.
 */
export class WhiteOutText {
  private window: TextWindow;
  private printer: TextPrinter;

  constructor(scene: Phaser.Scene, fonts: Fonts, input: Input, charmap: Charmap, state: GameState, raw: number[]) {
    this.window = new TextWindow(scene, WIN.left * 8, WIN.top * 8, WIN.width * 8, WIN.height * 8, fonts.windowPalette);
    this.window.image.setDepth(DEPTH_FADE + 1); // drawn over the black screen, like palette 15 on the GBA
    this.window.fill(TEXT_COLOR_TRANSPARENT);
    // AddTextPrinterParameterized4(windowId, FONT_NORMAL, 2, 8, 1, 0, sWhiteoutTextColors, 1, gStringVar4)
    this.printer = new TextPrinter(this.window, fonts, input, imageDataOf(scene, MESSAGE_TEXTURES.arrows), expandPlaceholders(raw, charmap, state), {
      fontId: FONT_NORMAL,
      x: 2,
      y: 8,
      fgColor: TEXT_COLOR_WHITE,
      bgColor: TEXT_COLOR_TRANSPARENT,
      shadowColor: TEXT_COLOR_DARK_GRAY,
      lineSpacing: 0,
      speed: 1,
      canABSpeedUp: false,
      scrollSpeed: 1,
    });
  }

  /** Run one frame; true once the message has printed and been dismissed. */
  tick(): boolean {
    this.printer.tick();
    this.window.flush();
    return this.printer.finished;
  }

  destroy(): void {
    this.window.destroy();
  }
}
