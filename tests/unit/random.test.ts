import { describe, expect, test } from 'vitest';
import { random, random32, seedRng } from '../../src/util/random';

/** random.c written out independently with BigInt: next = seed * 1103515245 + 24691 (mod 2^32), result = next >> 16. */
function referenceLcg(seed: number, count: number): number[] {
  let s = BigInt(seed);
  const out: number[] = [];
  for (let i = 0; i < count; i++) {
    s = (s * 1103515245n + 24691n) & 0xffffffffn;
    out.push(Number(s >> 16n));
  }
  return out;
}

describe('random (random.c)', () => {
  test('matches the GBA LCG from a known seed', () => {
    for (const seed of [0, 1, 0x12345678, 0xffffffff]) {
      seedRng(seed);
      const got = Array.from({ length: 50 }, () => random());
      expect(got).toEqual(referenceLcg(seed, 50));
    }
  });

  test('seed 0 starts 0, then the usual sequence', () => {
    seedRng(0);
    expect(random()).toBe(0); // 24691 >> 16
    expect(random()).toBe(referenceLcg(0, 2)[1]);
  });

  test('stays a u16', () => {
    seedRng(42);
    for (let i = 0; i < 1000; i++) {
      const v = random();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(0x10000);
    }
  });

  test('random32 is low half first, then high half', () => {
    seedRng(7);
    const [lo, hi] = referenceLcg(7, 2);
    seedRng(7);
    expect(random32()).toBe((lo | (hi << 16)) >>> 0);
  });

  test('reseeding replays the sequence', () => {
    seedRng(1234);
    const a = Array.from({ length: 20 }, random);
    seedRng(1234);
    expect(Array.from({ length: 20 }, random)).toEqual(a);
  });
});
