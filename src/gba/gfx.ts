// Graphics by C symbol (public/gen/gfx/<symbol>.bin, written by tools/extract_gfx.py): tile data,
// BGR555 palettes and tilemaps exactly as the ROM holds them once decompressed. Loads are async;
// code that runs per frame uses gfx(), so preload what a screen needs before starting it.

const cache = new Map<string, Uint8Array>();
let base = '/gen';
let index: Record<string, number> | undefined;

export function setGfxBase(path: string): void {
  base = path;
}

export async function loadGfxIndex(): Promise<void> {
  if (index) return;
  const res = await fetch(`${base}/gfx/index.json`);
  if (!res.ok) throw new Error(`Failed to load gfx/index.json: ${res.status}`);
  index = (await res.json()) as Record<string, number>;
}

export function hasGfx(symbol: string): boolean {
  return !!index && symbol in index;
}

export async function loadGfx(symbols: Iterable<string>): Promise<void> {
  await loadGfxIndex();
  const wanted = [...new Set(symbols)].filter((s) => !cache.has(s));
  await Promise.all(
    wanted.map(async (s) => {
      if (!index![s] && index![s] !== 0) throw new Error(`Unknown graphics symbol ${s}`);
      const res = await fetch(`${base}/gfx/${s}.bin`);
      if (!res.ok) throw new Error(`Failed to load gfx/${s}.bin: ${res.status}`);
      cache.set(s, new Uint8Array(await res.arrayBuffer()));
    }),
  );
}

/** Whether loadGfx() has fetched `symbol`. */
export function isGfxLoaded(symbol: string): boolean {
  return cache.has(symbol);
}

/** The bytes of a preloaded symbol. */
export function gfx(symbol: string): Uint8Array {
  const d = cache.get(symbol);
  if (!d) throw new Error(`Graphics ${symbol} used before loadGfx()`);
  return d;
}

/** A preloaded symbol as u16s (palettes, tilemaps). */
export function gfx16(symbol: string): Uint16Array {
  const d = gfx(symbol);
  return new Uint16Array(d.buffer, d.byteOffset, d.byteLength >> 1);
}
