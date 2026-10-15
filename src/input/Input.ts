import Phaser from 'phaser';

export type Button = 'A' | 'B' | 'START' | 'SELECT' | 'L' | 'R' | 'UP' | 'DOWN' | 'LEFT' | 'RIGHT';

const K = Phaser.Input.Keyboard.KeyCodes;

/** Keyboard layout, emulator-style. Arrows only for the D-pad so letter keys are free for buttons. */
export const KEY_BINDINGS: Record<Button, number[]> = {
  A: [K.Z, K.SPACE],
  B: [K.X],
  START: [K.ENTER],
  SELECT: [K.BACKSPACE],
  L: [K.A],
  R: [K.S],
  UP: [K.UP],
  DOWN: [K.DOWN],
  LEFT: [K.LEFT],
  RIGHT: [K.RIGHT],
};

const BUTTONS = Object.keys(KEY_BINDINGS) as Button[];

/**
 * GBA-style button state sampled once per logic tick: `held` mirrors gMain.heldKeys and
 * `pressed` mirrors gMain.newKeys (true only on the tick the button went down). Sampling per
 * tick rather than per render frame keeps input deterministic with the fixed 60Hz loop.
 */
export class Input {
  private keys: Record<Button, Phaser.Input.Keyboard.Key[]>;
  private heldNow = new Set<Button>();
  private heldPrev = new Set<Button>();

  constructor(scene: Phaser.Scene) {
    const kb = scene.input.keyboard!;
    this.keys = Object.fromEntries(
      BUTTONS.map((b) => [b, KEY_BINDINGS[b].map((code) => kb.addKey(code, true))]),
    ) as Record<Button, Phaser.Input.Keyboard.Key[]>;
  }

  /** Call once at the start of every logic tick. */
  sample(): void {
    this.heldPrev = this.heldNow;
    this.heldNow = new Set(BUTTONS.filter((b) => this.keys[b].some((k) => k.isDown)));
  }

  /** For this tick, `b` is the only button held, and newly pressed (QuestLogOverrideJoyVars). */
  override(b: Button): void {
    this.heldNow = new Set([b]);
    this.heldPrev = new Set();
  }

  held(b: Button): boolean {
    return this.heldNow.has(b);
  }

  pressed(b: Button): boolean {
    return this.heldNow.has(b) && !this.heldPrev.has(b);
  }

  /** A or B newly pressed: the usual "advance text" check (JOY_NEW(A_BUTTON | B_BUTTON)). */
  pressedAorB(): boolean {
    return this.pressed('A') || this.pressed('B');
  }
}
