// random.c: the GBA's LCG. Seeded from Math.random at load; the GBA seeds it from a timer at the
// title screen, so sequences won't match a real cartridge.

const RAND_MULT = 1103515245;
let rngValue = (Math.random() * 0x100000000) >>> 0;

/** Random(): ISO_RANDOMIZE1, upper 16 bits. */
export function random(): number {
  rngValue = (Math.imul(RAND_MULT, rngValue) + 24691) >>> 0;
  return rngValue >>> 16;
}

/** Random32() */
export function random32(): number {
  return (random() | (random() << 16)) >>> 0;
}

export function seedRng(seed: number): void {
  rngValue = seed >>> 0;
}
