export type Direction = 'down' | 'up' | 'left' | 'right';

export const DIRECTIONS: readonly Direction[] = ['down', 'up', 'left', 'right'];

export const DELTA: Record<Direction, { dx: number; dy: number }> = {
  down: { dx: 0, dy: 1 },
  up: { dx: 0, dy: -1 },
  left: { dx: -1, dy: 0 },
  right: { dx: 1, dy: 0 },
};

export const OPPOSITE: Record<Direction, Direction> = {
  down: 'up',
  up: 'down',
  left: 'right',
  right: 'left',
};

/** Maps MOVEMENT_TYPE_FACE_* suffixes and map-json connection directions to our directions. */
export function parseDirection(s: string): Direction | undefined {
  switch (s.toLowerCase()) {
    case 'down':
    case 'south':
      return 'down';
    case 'up':
    case 'north':
      return 'up';
    case 'left':
    case 'west':
      return 'left';
    case 'right':
    case 'east':
      return 'right';
  }
  return undefined;
}
