import type { TilesetAttributes, TilesetPairInfo } from '../data/types';

// include/fieldmap.h
export const NUM_METATILES_IN_PRIMARY = 640;
const NUM_METATILES_IN_SECONDARY = 1024 - NUM_METATILES_IN_PRIMARY;

export type AtlasLayer = 'below' | 'above';

/**
 * A map's (primary, secondary) tileset combination, drawn from two atlases:
 * - the primary atlas (shared by every pair using that primary), slots 0..639;
 * - the pair atlas: secondary metatiles in slots 0..383, then any primary metatiles whose
 *   colours depend on the secondary's palettes ("overrides").
 * In a Phaser tilemap the pair atlas sits at firstgid 640, so a metatile id maps to a gid directly,
 * except overrides, which are redirected past the secondary block.
 */
export class TilesetPair {
  private overrideGid = new Map<number, number>();

  constructor(
    readonly key: string,
    readonly info: TilesetPairInfo,
    private primary: TilesetAttributes,
    private secondary: TilesetAttributes,
  ) {
    info.overrides.forEach((metatile, i) =>
      this.overrideGid.set(metatile, NUM_METATILES_IN_PRIMARY + NUM_METATILES_IN_SECONDARY + i),
    );
  }

  gid(metatile: number): number {
    return this.overrideGid.get(metatile) ?? metatile;
  }

  behavior(metatile: number): number {
    return metatile < NUM_METATILES_IN_PRIMARY
      ? (this.primary.behaviors[metatile] ?? 0)
      : (this.secondary.behaviors[metatile - NUM_METATILES_IN_PRIMARY] ?? 0);
  }

  /** METATILE_ATTRIBUTE_ENCOUNTER_TYPE (TILE_ENCOUNTER_*) */
  encounterType(metatile: number): number {
    return metatile < NUM_METATILES_IN_PRIMARY
      ? (this.primary.encounters[metatile] ?? 0)
      : (this.secondary.encounters[metatile - NUM_METATILES_IN_PRIMARY] ?? 0);
  }

  primaryTexture(layer: AtlasLayer): string {
    return `ts_${this.info.primary}_${layer}`;
  }

  pairTexture(layer: AtlasLayer): string {
    return `ts_${this.key}_${layer}`;
  }
}
