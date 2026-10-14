import Phaser from 'phaser';
import type { MapData } from '../data/types';
import { NUM_METATILES_IN_PRIMARY, type AtlasLayer, type TilesetPair } from './TilesetPair';

export const TILE = 16;

export const MAPGRID_METATILE_ID_MASK = 0x03ff;
export const MAPGRID_COLLISION_MASK = 0x0c00;
export const MAPGRID_COLLISION_SHIFT = 10;
export const MAPGRID_ELEVATION_SHIFT = 12;

// Depth bands mirror the field's BG/OAM priorities: `below` holds BG3+BG2 and `above` holds BG1.
// Within a band objects sort like SortSprites: by subpriority, then by screen top.
export const DEPTH_BORDER = -2;
export const DEPTH_BELOW = -1;
const DEPTH_OBJECTS_PRIORITY_2 = 0;
export const DEPTH_ABOVE = 300_000;
const DEPTH_OBJECTS_PRIORITY_1 = 400_000;

/**
 * Depth of an object sprite (higher draws in front). SortSprites orders OAM by
 * `oam.priority << 8 | subpriority`, and on a tie puts the sprite whose top (oam.y) is lower on screen
 * first, i.e. in front. Priority 2 draws over BG2 and under BG1; priority 1 also draws over BG1.
 * (Priority 0 would also draw over the text window on BG0 and 3 under BG2; no map elevation gives
 * either, so they share 1's and 2's bands.) Any remaining tie keeps creation order.
 */
export function objectDepth(priority: number, subpriority: number, screenTop: number): number {
  const base = priority <= 1 ? DEPTH_OBJECTS_PRIORITY_1 : DEPTH_OBJECTS_PRIORITY_2;
  const top = Math.max(-512, Math.min(511, screenTop)) + 512; // only on-screen sprites can tie
  return base + (255 - subpriority) * 1024 + top;
}

/**
 * One map placed in world tile space at (originX, originY), drawn as two tilemaps:
 * "below" (under objects) and "above" (over objects), mirroring the GBA BG priorities.
 */
export class MapChunk {
  private maps: Phaser.Tilemaps.Tilemap[] = [];
  private pair?: TilesetPair;
  /** Per-visit copy of the map grid, so setmetatile edits don't leak into the cached map data. */
  readonly blocks: number[];

  constructor(
    readonly data: MapData,
    readonly originX: number,
    readonly originY: number,
  ) {
    this.blocks = data.blocks.slice();
  }

  get name(): string {
    return this.data.name;
  }

  contains(wx: number, wy: number): boolean {
    const x = wx - this.originX;
    const y = wy - this.originY;
    return x >= 0 && y >= 0 && x < this.data.width && y < this.data.height;
  }

  /** Raw map grid value at a world tile, or undefined if outside this map. */
  blockAt(wx: number, wy: number): number | undefined {
    if (!this.contains(wx, wy)) return undefined;
    return this.blocks[(wy - this.originY) * this.data.width + (wx - this.originX)];
  }

  /** MapGridSetMetatileIdAt with map-local coords; `value` is the full grid value (metatile | collision). */
  setBlock(x: number, y: number, value: number): void {
    if (x < 0 || y < 0 || x >= this.data.width || y >= this.data.height) return;
    const old = this.blocks[y * this.data.width + x];
    this.blocks[y * this.data.width + x] = (old & ~0x0fff) | (value & 0x0fff);
    if (this.pair) {
      const gid = this.pair.gid(value & MAPGRID_METATILE_ID_MASK);
      for (const m of this.maps) m.putTileAt(gid, x, y);
    }
  }

  render(scene: Phaser.Scene, pair: TilesetPair): void {
    this.pair = pair;
    const { width, height } = this.data;
    const blocks = this.blocks;
    const grid: number[][] = [];
    for (let y = 0; y < height; y++) {
      const row: number[] = [];
      for (let x = 0; x < width; x++) row.push(blocks[y * width + x] & MAPGRID_METATILE_ID_MASK);
      grid.push(row);
    }
    this.maps.push(
      createLayer(scene, grid, pair, 'below', this.originX, this.originY, DEPTH_BELOW),
      createLayer(scene, grid, pair, 'above', this.originX, this.originY, DEPTH_ABOVE),
    );
  }

  destroy(): void {
    for (const m of this.maps) m.destroy();
    this.maps = [];
  }
}

/** Build one tilemap layer from a grid of metatile ids (-1 = empty). */
export function createLayer(
  scene: Phaser.Scene,
  grid: number[][],
  pair: TilesetPair,
  atlas: AtlasLayer,
  originX: number,
  originY: number,
  depth: number,
): Phaser.Tilemaps.Tilemap {
  const gids = grid.map((row) => row.map((m) => (m < 0 ? -1 : pair.gid(m))));
  const map = scene.make.tilemap({ data: gids, tileWidth: TILE, tileHeight: TILE });
  const tilesets = [
    map.addTilesetImage(pair.primaryTexture(atlas), pair.primaryTexture(atlas), TILE, TILE, 0, 0, 0),
    map.addTilesetImage(pair.pairTexture(atlas), pair.pairTexture(atlas), TILE, TILE, 0, 0, NUM_METATILES_IN_PRIMARY),
  ];
  if (tilesets.some((t) => !t)) throw new Error(`Missing tileset textures for ${pair.key}`);
  const layer = map.createLayer(0, tilesets as Phaser.Tilemaps.Tileset[], originX * TILE, originY * TILE);
  layer?.setDepth(depth);
  return map;
}
