// random.c: the GBA's LCG. Seeded once at boot (the GBA seeds from a timer at the title screen).

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
