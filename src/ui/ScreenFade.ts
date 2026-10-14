import Phaser from 'phaser';
import { DEPTH_UI } from '../text/TextWindow';

/** FADE_* modes (include/constants/field_weather.h). */
export interface FadeModes {
  FADE_FROM_BLACK: number;
  FADE_TO_BLACK: number;
  FADE_FROM_WHITE: number;
  FADE_TO_WHITE: number;
}

/** Above the map, objects and every window: the fade covers all palettes. */
export const DEPTH_FADE = DEPTH_UI + 1000;

/**
 * FadeScreen / BeginNormalPaletteFade over all palettes, drawn as a full-screen overlay.
 * Approximation: BlendPalette mixes 5-bit colour channels with integer maths; alpha-blending the fade
 * colour on top gives the same ramp but not bit-identical pixels. Weather palettes are ignored.
 *
 * Timing follows UpdateNormalPaletteFade with delay 0: the blend coefficient moves 2/16 per step,
 * each step takes two frames (BG palettes, then OBJ palettes), and the fade stays active for
 * 5 more frames after reaching the target (IsSoftwarePaletteFadeFinishing).
 */
export class ScreenFade {
  private rect: Phaser.GameObjects.Rectangle;
  private y = 0;
  private targetY = 0;
  private objToggle = false;
  private finishing = -1;
  active = false;

  constructor(
    scene: Phaser.Scene,
    private modes: FadeModes,
  ) {
    const { width, height } = scene.scale;
    this.rect = scene.add.rectangle(0, 0, width, height, 0x000000, 1).setOrigin(0, 0).setScrollFactor(0).setDepth(DEPTH_FADE);
    this.rect.setAlpha(0);
  }

  /** FadeScreen(mode, 0). Returns false (and does nothing) if a fade is already running. */
  begin(mode: number): boolean {
    const m = this.modes;
    if (this.active) return false;
    if (![m.FADE_FROM_BLACK, m.FADE_TO_BLACK, m.FADE_FROM_WHITE, m.FADE_TO_WHITE].includes(mode)) return false;
    const toWhite = mode === m.FADE_FROM_WHITE || mode === m.FADE_TO_WHITE;
    const fadeOut = mode === m.FADE_TO_BLACK || mode === m.FADE_TO_WHITE;
    this.rect.setFillStyle(toWhite ? 0xffffff : 0x000000);
    this.y = fadeOut ? 0 : 16;
    this.targetY = fadeOut ? 16 : 0;
    this.objToggle = false;
    this.finishing = -1;
    this.active = true;
    this.update(); // BeginNormalPaletteFade applies the first step immediately
    return true;
  }

  /** UpdatePaletteFade, once per frame. */
  tick(): void {
    if (this.active) this.update();
  }

  private update(): void {
    if (this.finishing >= 0) {
      if (this.finishing === 4) this.active = false;
      else this.finishing++;
      return;
    }
    this.rect.setAlpha(this.y / 16);
    this.objToggle = !this.objToggle;
    if (this.objToggle) return;
    if (this.y === this.targetY) {
      this.finishing = 0;
      return;
    }
    this.y = this.y < this.targetY ? Math.min(this.y + 2, this.targetY) : Math.max(this.y - 2, this.targetY);
  }
}
