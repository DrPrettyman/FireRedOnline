import type { ObjectEventData } from '../data/types';
import { DELTA, DIRECTIONS, OPPOSITE, type Direction } from '../world/direction';
import type { ObjectEvent } from './ObjectEvent';

/** Decides what an NPC does each frame, following its MOVEMENT_TYPE_* from the map data. */
export class NpcBrain {
  private wait: number;
  private readonly homeX: number;
  private readonly homeY: number;
  private readonly kind: string;
  private readonly lookDirs: Direction[];
  private walkDir: Direction | undefined;

  constructor(
    readonly obj: ObjectEvent,
    readonly data: ObjectEventData,
    private canMove: (obj: ObjectEvent, dir: Direction) => boolean,
  ) {
    this.homeX = obj.tileX;
    this.homeY = obj.tileY;
    this.kind = data.movement_type.replace('MOVEMENT_TYPE_', '');
    this.lookDirs = parseLookDirections(this.kind);
    this.walkDir = this.lookDirs[0];
    this.wait = randomWait();
    if (this.lookDirs.length) obj.face(this.lookDirs[0]);
  }

  /** Paused NPCs (e.g. while talking) hold still. */
  paused = false;

  tick(): void {
    this.obj.tick();
    if (this.paused || this.obj.isMoving) return;
    if (--this.wait > 0) return;
    this.wait = randomWait();

    switch (true) {
      case this.kind === 'WANDER_AROUND':
        return this.wander(DIRECTIONS);
      case this.kind.startsWith('WANDER_UP_AND_DOWN') || this.kind.startsWith('WANDER_DOWN_AND_UP'):
        return this.wander(['up', 'down']);
      case this.kind.startsWith('WANDER_LEFT_AND_RIGHT') || this.kind.startsWith('WANDER_RIGHT_AND_LEFT'):
        return this.wander(['left', 'right']);
      case this.kind.startsWith('WALK_') && this.walkDir !== undefined:
        return this.pace();
      case this.kind === 'LOOK_AROUND':
        return this.obj.face(pick(DIRECTIONS));
      case this.kind.startsWith('FACE_') && this.lookDirs.length > 1:
        return this.obj.face(pick(this.lookDirs));
    }
  }

  private wander(dirs: readonly Direction[]): void {
    const dir = pick(dirs);
    this.obj.face(dir);
    if (this.withinRange(dir) && this.canMove(this.obj, dir)) this.obj.move(dir);
  }

  /** WALK_* types pace back and forth along an axis, reversing at the range edge or when blocked. */
  private pace(): void {
    let dir = this.walkDir!;
    if (!this.withinRange(dir) || !this.canMove(this.obj, dir)) {
      dir = OPPOSITE[dir];
      this.walkDir = dir;
    }
    this.wait = 1;
    if (this.withinRange(dir) && this.canMove(this.obj, dir)) this.obj.move(dir);
    else this.obj.face(dir);
  }

  private withinRange(dir: Direction): boolean {
    const { dx, dy } = DELTA[dir];
    const rx = this.data.movement_range_x;
    const ry = this.data.movement_range_y;
    const nx = this.obj.tileX + dx - this.homeX;
    const ny = this.obj.tileY + dy - this.homeY;
    return (rx === 0 || Math.abs(nx) <= rx) && (ry === 0 || Math.abs(ny) <= ry) && (dx === 0 || rx > 0) && (dy === 0 || ry > 0);
  }
}

function parseLookDirections(kind: string): Direction[] {
  const m = /^(?:FACE|WALK)_(.+)$/.exec(kind);
  if (!m) return [];
  const map: Record<string, Direction> = { UP: 'up', DOWN: 'down', LEFT: 'left', RIGHT: 'right' };
  return m[1]
    .split('_')
    .map((w) => map[w])
    .filter((d): d is Direction => d !== undefined);
}

function pick<T>(arr: readonly T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

function randomWait(): number {
  // GBA wanderers idle 32/64/96/128 frames between moves.
  return 32 * (1 + Math.floor(Math.random() * 4));
}
