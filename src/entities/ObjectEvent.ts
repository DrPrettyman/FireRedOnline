import Phaser from 'phaser';
import { spriteTextureKey } from '../data/assets';
import type { SpriteInfo } from '../data/types';
import { DELTA, type Direction } from '../world/direction';
import { TILE, objectDepth } from '../world/MapChunk';

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

/** sElevationToPriority: the OAM priority an object gets from its (previous) elevation. */
const ELEVATION_TO_PRIORITY = [2, 2, 2, 2, 1, 2, 1, 2, 1, 2, 1, 2, 1, 0, 0, 2];
/** sElevationToSubpriority: base of the y-sort key within a priority (lower draws in front). */
const ELEVATION_TO_SUBPRIORITY = [115, 115, 83, 115, 83, 115, 83, 115, 83, 115, 83, 115, 83, 0, 0, 115];

/** What an object needs from the field. */
export interface ObjectEventField {
  /** MapGridGetElevationAt, in world tile coords. */
  elevationAt(x: number, y: number): number;
  /**
   * World pixel y of the screen's top edge as of the last camera update (gSpriteCoordOffsetY).
   * Objects update their subpriority before the camera moves each frame, so they see last frame's.
   */
  cameraTop: number;
}

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
  /** The sprite's position without jump lift (sprite->x/y minus y2): what the camera follows (CameraObject_1). */
  readonly anchor = new Phaser.Math.Vector2();
  tileX: number;
  tileY: number;
  facing: Direction = 'down';
  /** Elevation used for collision; 0 (e.g. stairs) is compatible with every elevation. */
  currentElevation: number;
  /** The last non-zero elevation, which picks the sprite's priority. */
  previousElevation: number;
  /** oam.priority: 2 = drawn under the map's top layer (BG1), 1 = over it (e.g. on a bridge). */
  priority: number;
  /** Sprite y-sort key within its priority; lower draws in front. */
  subpriority = 0;
  /** previousCoords: the tile a step started from; equal to the current tile when still. */
  private previousX: number;
  private previousY: number;
  /** World pixel y of the sprite's bottom edge, ignoring jump lift (sprite->y - centerToCornerVecY). */
  feetY = 0;
  /** World pixel y of the sprite's top edge, including jump lift (oam.y before the camera offset). */
  private topY = 0;
  private movement?: Movement;
  private stepParity = 0;
  readonly hasRunFrames: boolean;

  constructor(
    scene: Phaser.Scene,
    readonly info: SpriteInfo,
    tileX: number,
    tileY: number,
    private readonly field: ObjectEventField,
    elevation = 3,
  ) {
    this.tileX = tileX;
    this.tileY = tileY;
    this.previousX = tileX;
    this.previousY = tileY;
    this.currentElevation = elevation;
    this.previousElevation = elevation;
    this.priority = ELEVATION_TO_PRIORITY[elevation]; // InitObjectPriorityByElevation
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
    // ShiftObjectEventCoords + DoGroundEffects_OnBeginStep. A jump only shifts coords at its halfway
    // point (JUMP_HALFWAY); walking in place doesn't shift them at all.
    if (tiles > 0 && !spec.jump) this.beginStep();
  }

  /**
   * UpdateObjectEventElevationAndPriority, run by the GBA's ground-effect hooks: on spawn, when a
   * step begins and when it ends. Skipped entirely while either coord is on elevation 15.
   */
  updateElevationAndPriority(): void {
    const cur = this.field.elevationAt(this.tileX, this.tileY);
    const prev = this.field.elevationAt(this.previousX, this.previousY);
    if (cur !== 15 && prev !== 15) {
      // ObjectEventUpdateElevation
      this.currentElevation = cur;
      if (cur !== 0) this.previousElevation = cur;
    }
    this.priority = ELEVATION_TO_PRIORITY[this.previousElevation];
    this.updateSubpriority();
  }

  /**
   * ObjectEventUpdateSubpriority → SetObjectSubpriorityByElevation(previousElevation, sprite, 1):
   * the screen is cut into 16 px rows (offset by 8) and lower rows get lower subpriorities. The GBA
   * runs this for every object every frame, since the camera moving changes the rows.
   */
  updateSubpriority(): void {
    const y = (this.feetY - this.field.cameraTop + 8) & 0xff;
    this.subpriority = ELEVATION_TO_SUBPRIORITY[this.previousElevation] + ((16 - (y >> 4)) << 1) + 1;
    this.sprite.setDepth(objectDepth(this.priority, this.subpriority, this.topY - this.field.cameraTop));
  }

  private beginStep(): void {
    const m = this.movement!;
    this.previousX = m.fromX;
    this.previousY = m.fromY;
    this.updateElevationAndPriority();
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
    if (m.spec.jump && m.tiles > 0 && m.elapsed === m.spec.frames >> 1) this.beginStep();
    const sx = this.tileX - m.fromX === 0 ? 0 : (m.fromX - this.tileX) * TILE + dx * px;
    const sy = this.tileY - m.fromY === 0 ? 0 : (m.fromY - this.tileY) * TILE + dy * px;
    this.syncSprite(sx, sy, lift);
    this.showStepFrame(m, t);
    if (m.elapsed >= m.spec.frames) {
      this.movement = undefined;
      // ShiftStillObjectEventCoords + DoGroundEffects_OnFinishStep (walking in place has no finish hook)
      if (m.tiles > 0 || m.spec.jump) {
        this.previousX = this.tileX;
        this.previousY = this.tileY;
        this.updateElevationAndPriority();
      }
      this.stepParity ^= 1;
      this.syncSprite(0, 0, 0);
      this.showFacing();
      return true;
    }
    return false;
  }

  /** MoveObjectEventToMapCoords: SetObjectEventCoords, then the spawn ground effects run again. */
  setPosition(tileX: number, tileY: number): void {
    this.tileX = tileX;
    this.tileY = tileY;
    this.previousX = tileX;
    this.previousY = tileY;
    this.movement = undefined;
    this.updateElevationAndPriority();
    this.syncSprite(0, 0, 0);
    this.showFacing();
  }

  destroy(): void {
    this.sprite.destroy();
  }

  private syncSprite(offX: number, offY: number, lift: number): void {
    const x = this.tileX * TILE + TILE / 2 + offX;
    const y = this.tileY * TILE + TILE + offY;
    this.feetY = y;
    this.topY = y + lift - this.info.frameHeight;
    this.sprite.setPosition(x, y + lift);
    this.anchor.set(x, y);
    this.updateSubpriority();
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
