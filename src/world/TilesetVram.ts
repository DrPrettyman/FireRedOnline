import type Phaser from 'phaser';
import { gfx, gfx16 } from '../gba/gfx';
import { ATLAS_LAYERS, NUM_METATILES_IN_PRIMARY, type AtlasLayer, type TilesetPair } from './TilesetPair';

// include/fieldmap.h
export const NUM_TILES_IN_PRIMARY = 640;
const NUM_PALS_IN_PRIMARY = 7;
const NUM_METATILES_IN_SECONDARY = 1024 - NUM_METATILES_IN_PRIMARY;
const TILE_SIZE_4BPP = 32;
const ATLAS_COLS = 32; // tools/extract.py ATLAS_COLS

// METATILE_LAYER_TYPE_*
const LAYER_COVERED = 1;
const LAYER_SPLIT = 2;

/** The palettes the atlases were drawn with, per tileset: 16 palettes of 16 [r, g, b] (palettes.json). */
export type TilesetPalettes = Record<string, number[][]>;

/**
 * A tileset's tiles as the field's BG VRAM holds them: a copy of the tileset's GBA-native tile data
 * that tile animations write into (tileset_anims.c), so the metatiles using those tiles can be redrawn.
 */
class TileStore {
  readonly tiles: Uint8Array;
  readonly metatiles: Uint16Array;
  /** Tiles that no longer match the atlas PNGs (written by an animation at least once). */
  readonly modified = new Set<number>();

  constructor(
    readonly name: string,
    tilesSymbol: string,
    metatilesSymbol: string,
    readonly palettes: number[][],
  ) {
    this.tiles = gfx(tilesSymbol).slice();
    this.metatiles = gfx16(metatilesSymbol);
  }

  get tileCount(): number {
    return this.tiles.length / TILE_SIZE_4BPP;
  }
}

export interface MetatileImages {
  bottom: ImageData;
  middle: ImageData;
  top: ImageData;
}

/** Tile pixels for one tile index of the field's VRAM (0..639 primary, 640.. secondary). */
type TileSource = (tile: number) => { data: Uint8Array; offset: number } | undefined;

/**
 * Draw one metatile (8 tilemap entries) the way tools/extract.py render_atlas does: DrawMetatile's split
 * of the two layers over BG3/BG2/BG1 by layer type, the bottom BG filled with the backdrop colour.
 */
export function renderMetatile(
  entries: ArrayLike<number>,
  layerType: number,
  tileAt: TileSource,
  palettes: number[][],
  height = 16,
  into?: MetatileImages,
  oy = 0,
): MetatileImages {
  const out = into ?? { bottom: new ImageData(16, height), middle: new ImageData(16, height), top: new ImageData(16, height) };
  const backdrop = palettes[0];
  const bottom = out.bottom.data;
  for (let y = oy; y < oy + 16; y++) {
    for (let x = 0; x < 16; x++) {
      const i = (y * 16 + x) * 4;
      bottom[i] = backdrop[0];
      bottom[i + 1] = backdrop[1];
      bottom[i + 2] = backdrop[2];
      bottom[i + 3] = 255;
    }
  }
  const [lower, upper] =
    layerType === LAYER_COVERED ? [out.bottom, out.middle] : layerType === LAYER_SPLIT ? [out.bottom, out.top] : [out.middle, out.top];
  for (let i = 0; i < 8; i++) {
    const entry = entries[i];
    const src = tileAt(entry & 0x3ff);
    if (!src) continue;
    const pal = palettes[(entry >> 12) & 0xf];
    const hflip = entry & 0x400;
    const vflip = entry & 0x800;
    const img = (i < 4 ? lower : upper).data;
    const ox = (i & 1) * 8;
    const ty = oy + ((i >> 1) & 1) * 8;
    for (let y = 0; y < 8; y++) {
      for (let x = 0; x < 8; x++) {
        const sx = hflip ? 7 - x : x;
        const sy = vflip ? 7 - y : y;
        const b = src.data[src.offset + sy * 4 + (sx >> 1)];
        const c = sx & 1 ? b >> 4 : b & 0xf;
        if (!c) continue;
        const p = ((ty + y) * 16 + ox + x) * 4;
        img[p] = pal[c * 3];
        img[p + 1] = pal[c * 3 + 1];
        img[p + 2] = pal[c * 3 + 2];
        img[p + 3] = 255;
      }
    }
  }
  return out;
}

/** One atlas (all three layers), turned into canvas textures so its slots can be redrawn. */
class AtlasCanvas {
  /** Global tile index (0..1023) → the slots whose metatile uses it. */
  private tileSlots = new Map<number, Set<number>>();
  private textures: Record<AtlasLayer, Phaser.Textures.CanvasTexture>;
  private dirty = false;

  constructor(
    textures: Phaser.Textures.TextureManager,
    keys: Record<AtlasLayer, string>,
    readonly primary: TileStore,
    readonly secondary: TileStore | undefined,
    /** Slot → [metatile entries offset in its store, store, layer type]. */
    private slots: ([number, TileStore, number] | undefined)[],
  ) {
    this.textures = {} as Record<AtlasLayer, Phaser.Textures.CanvasTexture>;
    for (const layer of ATLAS_LAYERS) this.textures[layer] = toCanvasTexture(textures, keys[layer]);
    slots.forEach((s, slot) => {
      if (!s) return;
      const [offset, store] = s;
      for (let i = 0; i < 8; i++) {
        const tile = store.metatiles[offset + i] & 0x3ff;
        let set = this.tileSlots.get(tile);
        if (!set) this.tileSlots.set(tile, (set = new Set()));
        set.add(slot);
      }
    });
  }

  uses(store: TileStore): boolean {
    return store === this.primary || store === this.secondary;
  }

  /** Redraw every slot using one of `tiles` (global tile indices). */
  redrawTiles(tiles: Iterable<number>): void {
    const slots = new Set<number>();
    for (const t of tiles) for (const s of this.tileSlots.get(t) ?? []) slots.add(s);
    for (const s of slots) this.redrawSlot(s);
  }

  private redrawSlot(slot: number): void {
    const s = this.slots[slot];
    if (!s) return;
    const [offset, store, layerType] = s;
    const palettes = this.secondary
      ? [...this.primary.palettes.slice(0, NUM_PALS_IN_PRIMARY), ...this.secondary.palettes.slice(NUM_PALS_IN_PRIMARY)]
      : this.primary.palettes;
    const images = renderMetatile(store.metatiles.subarray(offset, offset + 8), layerType, (t) => this.tile(t), palettes);
    const x = (slot % ATLAS_COLS) * 16;
    const y = Math.floor(slot / ATLAS_COLS) * 16;
    for (const layer of ATLAS_LAYERS) this.textures[layer].context.putImageData(images[layer], x, y);
    this.dirty = true;
  }

  tile(t: number): { data: Uint8Array; offset: number } | undefined {
    const store = t < NUM_TILES_IN_PRIMARY ? this.primary : this.secondary;
    const local = t < NUM_TILES_IN_PRIMARY ? t : t - NUM_TILES_IN_PRIMARY;
    if (!store || local >= store.tileCount) return undefined;
    return { data: store.tiles, offset: local * TILE_SIZE_4BPP };
  }

  /** Upload redrawn slots to the GPU (once per frame at most). */
  flush(): void {
    if (!this.dirty) return;
    this.dirty = false;
    for (const layer of ATLAS_LAYERS) this.textures[layer].refresh();
  }
}

/** Replace a loaded image texture by a canvas texture with the same key and content. */
function toCanvasTexture(textures: Phaser.Textures.TextureManager, key: string): Phaser.Textures.CanvasTexture {
  const existing = textures.get(key);
  // No runtime Phaser import here: test hooks (loaded by the Node unit tests via battle code) import this module.
  if ('context' in existing) return existing as Phaser.Textures.CanvasTexture;
  const img = existing.getSourceImage() as HTMLImageElement;
  textures.remove(key);
  const canvas = textures.createCanvas(key, img.width, img.height)!;
  canvas.context.drawImage(img, 0, 0);
  canvas.refresh();
  return canvas;
}

const stores = new Map<string, TileStore>();
const atlases = new Map<string, AtlasCanvas>();

/**
 * The field's BG VRAM as far as the overworld needs it: each loaded tileset's tiles, which tile
 * animations overwrite, and the atlases drawn from them.
 */
export const tilesetVram = {
  /** Register a tileset's tile data (its gfx symbols must be loaded). */
  addStore(name: string, tilesSymbol: string, metatilesSymbol: string, palettes: number[][]): void {
    if (!stores.has(name)) stores.set(name, new TileStore(name, tilesSymbol, metatilesSymbol, palettes));
  },

  hasStore(name: string): boolean {
    return stores.has(name);
  },

  /** A tileset's tiles as VRAM holds them now (animated frames included), or undefined if not loaded. */
  tiles(name: string): Uint8Array | undefined {
    return stores.get(name)?.tiles;
  },

  /** A tile's current 4bpp data (tests). */
  tileData(name: string, tile: number): Uint8Array | undefined {
    const store = stores.get(name);
    return store && tile < store.tileCount ? store.tiles.slice(tile * TILE_SIZE_4BPP, (tile + 1) * TILE_SIZE_4BPP) : undefined;
  },

  /**
   * Make a pair's primary and pair atlases redrawable (canvas textures). Slots whose tiles an animation
   * already changed are redrawn at once, since the PNGs show the tileset's original tiles.
   */
  makeAtlasesLive(textures: Phaser.Textures.TextureManager, pair: TilesetPair): void {
    const primary = stores.get(pair.info.primary)!;
    const secondary = stores.get(pair.info.secondary)!;
    const keys = (f: (l: AtlasLayer) => string) => ({ bottom: f('bottom'), middle: f('middle'), top: f('top') });
    const overrides = new Set(pair.info.overrides);
    if (!atlases.has(pair.primaryTexture('bottom'))) {
      const slots = Array.from({ length: Math.min(NUM_METATILES_IN_PRIMARY, primary.metatiles.length >> 3) }, (_, i) =>
        overrides.has(i) ? undefined : ([i * 8, primary, pair.layerType(i)] as [number, TileStore, number]),
      );
      this.addAtlas(new AtlasCanvas(textures, keys((l) => pair.primaryTexture(l)), primary, undefined, slots), pair.primaryTexture('bottom'));
    }
    if (!atlases.has(pair.pairTexture('bottom'))) {
      const slots: ([number, TileStore, number] | undefined)[] = [];
      for (let i = 0; i < NUM_METATILES_IN_SECONDARY; i++) {
        slots.push(i < secondary.metatiles.length >> 3 ? [i * 8, secondary, pair.layerType(NUM_METATILES_IN_PRIMARY + i)] : undefined);
      }
      for (const m of pair.info.overrides) slots.push([m * 8, primary, pair.layerType(m)]);
      this.addAtlas(new AtlasCanvas(textures, keys((l) => pair.pairTexture(l)), primary, secondary, slots), pair.pairTexture('bottom'));
    }
  },

  addAtlas(atlas: AtlasCanvas, key: string): void {
    atlases.set(key, atlas);
    for (const store of [atlas.primary, atlas.secondary]) {
      if (!store?.modified.size) continue;
      const base = store === atlas.primary ? 0 : NUM_TILES_IN_PRIMARY;
      atlas.redrawTiles([...store.modified].map((t) => t + base));
    }
    atlas.flush();
  },

  /** DmaCopy16 into BG VRAM: `count` tiles of `src` to the named tileset's tile `destTile` (local index). */
  writeTiles(name: string, destTile: number, src: Uint8Array, count: number): void {
    const store = stores.get(name);
    if (!store) return;
    const n = Math.min(count, store.tileCount - destTile);
    if (n <= 0) return;
    store.tiles.set(src.subarray(0, n * TILE_SIZE_4BPP), destTile * TILE_SIZE_4BPP);
    const changed: number[] = [];
    for (let i = 0; i < n; i++) {
      store.modified.add(destTile + i);
      changed.push(destTile + i);
    }
    for (const atlas of atlases.values()) {
      if (!atlas.uses(store)) continue;
      const base = store === atlas.primary ? 0 : NUM_TILES_IN_PRIMARY;
      atlas.redrawTiles(changed.map((t) => t + base));
    }
  },

  /** Send this frame's redraws to the GPU. */
  flush(): void {
    for (const atlas of atlases.values()) atlas.flush();
  },

  /**
   * Draw a metatile from explicit tilemap entries with a pair's current tiles and palettes, e.g. a door
   * frame. `extraTiles` stands in for VRAM tiles from `extraStart` on (the door tiles' slot).
   */
  renderEntries(
    pair: TilesetPair,
    entries: ArrayLike<number>,
    layerType: number,
    extra?: { start: number; data: Uint8Array },
    height = 16,
    into?: MetatileImages,
    oy = 0,
  ): MetatileImages {
    const primary = stores.get(pair.info.primary)!;
    const secondary = stores.get(pair.info.secondary)!;
    const palettes = [...primary.palettes.slice(0, NUM_PALS_IN_PRIMARY), ...secondary.palettes.slice(NUM_PALS_IN_PRIMARY)];
    const tileAt: TileSource = (t) => {
      if (extra && t >= extra.start && (t - extra.start) * TILE_SIZE_4BPP < extra.data.length) {
        return { data: extra.data, offset: (t - extra.start) * TILE_SIZE_4BPP };
      }
      const store = t < NUM_TILES_IN_PRIMARY ? primary : secondary;
      const local = t < NUM_TILES_IN_PRIMARY ? t : t - NUM_TILES_IN_PRIMARY;
      return local < store.tileCount ? { data: store.tiles, offset: local * TILE_SIZE_4BPP } : undefined;
    };
    return renderMetatile(entries, layerType, tileAt, palettes, height, into, oy);
  },
};
