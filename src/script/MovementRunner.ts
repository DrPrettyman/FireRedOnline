import type { ObjectEvent, MoveKind } from '../entities/ObjectEvent';
import { OPPOSITE, type Direction } from '../world/direction';

export type Instruction = string[];

const DIRS = ['down', 'up', 'left', 'right'] as const;

/** Walk speeds per movement-macro prefix (asm/macros/movement.inc). */
const WALKS: [string, MoveKind][] = [
  ['walk_slowest_', 'slowest'],
  ['walk_slower_', 'slower'],
  ['walk_slow_', 'slow'],
  ['walk_faster_', 'faster'],
  ['walk_fast_', 'fast'],
  ['player_run_', 'run'],
  ['slide_', 'fast'],
  ['ride_water_current_', 'fast'],
  ['jump_2_', 'jump'],
  ['jump_special_', 'jump1'],
  ['walk_', 'walk'],
  ['jump_', 'jump1'],
];

const IN_PLACE: [string, MoveKind][] = [
  ['walk_in_place_slow_', 'slow'],
  ['walk_in_place_faster_', 'faster'],
  ['walk_in_place_fast_', 'fast'],
  ['walk_in_place_', 'walk'],
  ['jump_in_place_', 'jump1'],
];

/**
 * Executes a movement script (applymovement) on one object, one action at a time.
 * Scripted movement ignores collision, as on the GBA.
 */
export class MovementRunner {
  done = false;
  private wait = 0;
  private keepFacing = false;

  constructor(
    readonly obj: ObjectEvent,
    private code: Instruction[],
    private pc: number,
    private player: ObjectEvent,
  ) {}

  tick(): void {
    if (this.done) return;
    if (this.obj.isMoving) return;
    if (this.wait > 0) {
      this.wait--;
      return;
    }
    for (;;) {
      const ins = this.code[this.pc++];
      if (!ins || ins[0] === 'step_end' || ins[0].startsWith('.')) {
        this.done = true;
        return;
      }
      if (this.exec(ins[0])) return; // action started; resume next tick
    }
  }

  /** Returns true if the action takes time. */
  private exec(op: string): boolean {
    const obj = this.obj;
    const dir = suffixDir(op);

    if (op.startsWith('face_') && dir && !op.includes('player')) {
      obj.face(dir);
      return false;
    }
    if (op.startsWith('delay_')) {
      this.wait = Number(op.slice(6)) - 1;
      return true;
    }
    if (dir) {
      for (const [prefix, kind] of IN_PLACE) {
        if (op.startsWith(prefix)) {
          obj.move(dir, kind, { inPlace: true });
          return true;
        }
      }
      for (const [prefix, kind] of WALKS) {
        if (op.startsWith(prefix)) {
          obj.move(dir, kind, { keepFacing: this.keepFacing });
          return true;
        }
      }
    }
    switch (op) {
      case 'face_player':
        obj.face(towards(obj, this.player));
        return false;
      case 'face_away_player':
        obj.face(OPPOSITE[towards(obj, this.player)]);
        return false;
      case 'lock_facing_direction':
        this.keepFacing = true;
        return false;
      case 'unlock_facing_direction':
        this.keepFacing = false;
        return false;
      case 'set_invisible':
        obj.setVisible(false);
        return false;
      case 'set_visible':
        obj.setVisible(true);
        return false;
      default:
        // emotes, affine anims, bike tricks etc. are not implemented yet
        console.debug('[movement] unimplemented', op);
        return false;
    }
  }
}

function suffixDir(op: string): Direction | undefined {
  return DIRS.find((d) => op.endsWith(`_${d}`));
}

/** Direction from `from` towards `to` (GetDirectionToFace-style, preferring the larger axis). */
export function towards(from: ObjectEvent, to: ObjectEvent): Direction {
  const dx = to.tileX - from.tileX;
  const dy = to.tileY - from.tileY;
  if (Math.abs(dx) > Math.abs(dy)) return dx > 0 ? 'right' : 'left';
  return dy > 0 ? 'down' : 'up';
}
