// trig.c: Sin/Cos over gSineTable (256 steps per turn, Q8.8) and Sin2/Cos2 in degrees (Q4.12).

import { bdata } from './env';

const table = (name: 'gSineTable' | 'gSineDegreeTable') => (bdata.tables.mech as Record<string, number[]>)[name];

/** Sin(index, amplitude) */
export function Sin(index: number, amplitude: number): number {
  return ((amplitude * table('gSineTable')[index]) >> 8) << 16 >> 16;
}

/** Cos(index, amplitude) */
export function Cos(index: number, amplitude: number): number {
  return ((amplitude * table('gSineTable')[index + 64]) >> 8) << 16 >> 16;
}

/** Sin2(angle): angle in degrees */
export function Sin2(angle: number): number {
  angle &= 0xffff;
  const value = table('gSineDegreeTable')[angle % 180];
  return Math.trunc(angle / 180) & 1 ? -value : value;
}

/** Cos2(angle) */
export function Cos2(angle: number): number {
  return Sin2(angle + 90);
}
