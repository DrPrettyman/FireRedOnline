import type { Input } from '../input/Input';
import type { MenuWindow } from './MenuWindow';

export type MenuResult = number | 'cancel' | undefined;

export interface MenuOptions {
  /** Pixel x of the cursor; items are drawn after it. */
  left: number;
  top: number;
  /** Pixel distance between rows (Menu_InitCursor cursorHeight). */
  rowHeight: number;
  /** Menu_MoveCursor wraps; Menu_ProcessInputNoWrapAround doesn't. */
  wrap: boolean;
  /** Frames to ignore input after opening (Task_YesNoMenu_HandleInput waits 5). */
  inputDelay?: number;
}

/**
 * A vertical cursor menu inside a MenuWindow (menu.c): the cursor is the ▶ glyph, redrawn
 * by clearing its cell and printing at the new row (Menu_RedrawCursor).
 */
export class Menu {
  cursor: number;
  private delay: number;

  constructor(
    private win: MenuWindow,
    private input: Input,
    private cursorGlyph: number[],
    readonly count: number,
    private opts: MenuOptions,
    initial = 0,
  ) {
    this.cursor = initial;
    this.delay = opts.inputDelay ?? 0;
    this.drawCursor();
  }

  /** One frame of input. Returns the chosen index, 'cancel' for B, or undefined. */
  tick(): MenuResult {
    if (this.delay > 0) {
      this.delay--;
      return undefined;
    }
    if (this.input.pressed('UP')) this.move(-1);
    else if (this.input.pressed('DOWN')) this.move(1);
    else if (this.input.pressed('A')) return this.cursor;
    else if (this.input.pressed('B')) return 'cancel';
    return undefined;
  }

  private move(delta: number): void {
    let next = this.cursor + delta;
    if (this.opts.wrap) next = (next + this.count) % this.count;
    else next = Math.max(0, Math.min(this.count - 1, next));
    if (next === this.cursor) return;
    this.clearCursor();
    this.cursor = next;
    this.drawCursor();
  }

  private clearCursor(): void {
    this.win.clearRect(this.opts.left, this.opts.top + this.cursor * this.opts.rowHeight, 8, this.opts.rowHeight);
  }

  private drawCursor(): void {
    this.win.print(this.cursorGlyph, this.opts.left, this.opts.top + this.cursor * this.opts.rowHeight);
  }
}
