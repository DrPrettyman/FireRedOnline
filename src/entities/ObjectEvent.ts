import Phaser from 'phaser';
import { spriteTextureKey } from '../data/assets';
import type { SpriteInfo } from '../data/types';
import { DELTA, type Direction } from '../world/direction';
import { DEPTH_OBJECTS, TILE } from '../world/MapChunk';

/** Standard 9-frame overworld sheet: face S/N/W, then two step frames per direction. East = west flipped. */
const FACE_FRAME: Record<Direction, number> = { down: 0, up: 1, left: 2, right: 2 };
const STEP_FRAMES: Record<Direction, [number, number]> = { down: [3, 4], up: [5, 6], left: [7, 8], right: [7, 8] };
/** Player-only run frames (sAnim_Run*): indices 9-17 of the player's pic table. */
const RUN_FRAMES: Record<Direction, [number, number, number]> = {
  down: [9, 10, 11],
  up: [12, 13, 14],
  left: [15, 16, 17],
  right: [15, 16, 17],
};

/** Parabolic hop: peaks `height` px up halfway through. */
function jumpLift(frame: number, frames: number, height: number): number {
  const t = frame / frames;
  return -Math.round(4 * height * t * (1 - t));
}

export type MoveKind =
  | 'walk'
  | 'run'
  | 'jump' // ledge: 2 tiles
  | 'jump1' // jump_*: 1 tile
  | 'slowest'
  | 'slower'
  | 'slow'
  | 'fast'
  | 'faster';

interface MoveSpec {
  tiles: number;
  frames: number;
  anim: 'walk' | 'run' | 'none';
  jump?: number;
}

/** Frames per tile follow the GBA movement speeds (1px/frame = 16 frames for a normal step). */
const MOVES: Record<MoveKind, MoveSpec> = {
  slowest: { tiles: 1, frames: 64, anim: 'walk' },
  slower: { tiles: 1, frames: 48, anim: 'walk' },
  slow: { tiles: 1, frames: 32, anim: 'walk' },
  walk: { tiles: 1, frames: 16, anim: 'walk' },
  fast: { tiles: 1, frames: 8, anim: 'walk' },
  faster: { tiles: 1, frames: 4, anim: 'walk' },
  run: { tiles: 1, frames: 8, anim: 'run' },
  jump: { tiles: 2, frames: 32, anim: 'none', jump: 8 },
  jump1: { tiles: 1, frames: 16, anim: 'none', jump: 6 },
};

export interface MoveOptions {
  /** Animate without changing tile (walk_in_place_*, jump_in_place_*). */
  inPlace?: boolean;
  /** Keep the current facing (lock_facing_direction). */
  keepFacing?: boolean;
}

interface Movement {
  dir: Direction;
  spec: MoveSpec;
  tiles: number;
  elapsed: number;
  fromX: number;
  fromY: number;
}

/**
 * Anything that stands on the map grid: the player and NPCs.
 * Positions are world tile coordinates; the sprite's feet sit on the tile's bottom edge.
 */
export class ObjectEvent {
  readonly sprite: Phaser.GameObjects.Sprite;
  tileX: number;
  tileY: number;
  facing: Direction = 'down';
  elevation: number;
  private movement?: Movement;
  private stepParity = 0;
  readonly hasRunFrames: boolean;

  constructor(
    scene: Phaser.Scene,
    readonly info: SpriteInfo,
    tileX: number,
    tileY: number,
    elevation = 3,
  ) {
    this.tileX = tileX;
    this.tileY = tileY;
    this.elevation = elevation;
    this.hasRunFrames = info.frameCount >= 18;
    this.sprite = scene.add.sprite(0, 0, spriteTextureKey(info), 0).setOrigin(0.5, 1);
    this.syncSprite(0, 0, 0);
    this.showFacing();
  }

  get isMoving(): boolean {
    return this.movement !== undefined;
  }

  /** Tile this object will occupy once its current move finishes. */
  get destination(): { x: number; y: number } {
    return { x: this.tileX, y: this.tileY };
  }

  face(dir: Direction): void {
    this.facing = dir;
    if (!this.movement) this.showFacing();
  }

  /**
   * Start a grid move. Logical position updates immediately (as on the GBA, where the
   * object's currentCoords switch at the start of a step) so collision checks stay simple.
   */
  move(dir: Direction, kind: MoveKind = 'walk', opts: MoveOptions = {}): void {
    const spec = MOVES[kind];
    const tiles = opts.inPlace ? 0 : spec.tiles;
    const { dx, dy } = DELTA[dir];
    if (!opts.keepFacing) this.facing = dir;
    this.movement = { dir: opts.keepFacing ? this.facing : dir, spec, tiles, elapsed: 0, fromX: this.tileX, fromY: this.tileY };
    this.tileX += dx * tiles;
    this.tileY += dy * tiles;
  }

  setVisible(v: boolean): void {
    this.sprite.setVisible(v);
  }

  /** Advance one 60Hz frame. Returns true on the frame a move completes. */
  tick(): boolean {
    const m = this.movement;
    if (!m) return false;
    m.elapsed++;
    const t = m.elapsed / m.spec.frames;
    const { dx, dy } = DELTA[m.dir];
    const px = Math.floor(t * m.tiles * TILE);
    const lift = m.spec.jump ? jumpLift(m.elapsed, m.spec.frames, m.spec.jump) : 0;
    const sx = this.tileX - m.fromX === 0 ? 0 : (m.fromX - this.tileX) * TILE + dx * px;
    const sy = this.tileY - m.fromY === 0 ? 0 : (m.fromY - this.tileY) * TILE + dy * px;
    this.syncSprite(sx, sy, lift);
    this.showStepFrame(m, t);
    if (m.elapsed >= m.spec.frames) {
      this.movement = undefined;
      this.stepParity ^= 1;
      this.syncSprite(0, 0, 0);
      this.showFacing();
      return true;
    }
    return false;
  }

  setPosition(tileX: number, tileY: number): void {
    this.tileX = tileX;
    this.tileY = tileY;
    this.movement = undefined;
    this.syncSprite(0, 0, 0);
    this.showFacing();
  }

  destroy(): void {
    this.sprite.destroy();
  }

  private syncSprite(offX: number, offY: number, lift: number): void {
    const x = this.tileX * TILE + TILE / 2 + offX;
    const y = this.tileY * TILE + TILE + offY;
    this.sprite.setPosition(x, y + lift);
    this.sprite.setDepth(DEPTH_OBJECTS + y);
  }

  private showFacing(): void {
    if (this.info.inanimate) return;
    this.sprite.setFrame(FACE_FRAME[this.facing]);
    this.sprite.setFlipX(this.facing === 'right');
  }

  private showStepFrame(m: Movement, t: number): void {
    if (this.info.inanimate) return;
    const dir = this.facing;
    let frame: number;
    if (m.spec.anim === 'run' && this.hasRunFrames) {
      const [stand, a, b] = RUN_FRAMES[dir];
      frame = t < 0.5 ? (this.stepParity ? b : a) : stand;
    } else if (m.spec.anim === 'none') {
      frame = FACE_FRAME[dir];
    } else {
      const [a, b] = STEP_FRAMES[dir];
      frame = t < 0.5 ? (this.stepParity ? b : a) : FACE_FRAME[dir];
    }
    this.sprite.setFrame(frame);
    this.sprite.setFlipX(dir === 'right');
  }
}
