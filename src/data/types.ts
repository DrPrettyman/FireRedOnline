// Shapes of the JSON written by tools/extract.py.

export type ConnectionDirection = 'up' | 'down' | 'left' | 'right' | 'dive' | 'emerge';

export interface MapConnection {
  map: string; // MAP_* id
  offset: number;
  direction: ConnectionDirection;
}

export interface ObjectEventData {
  local_id?: string;
  type: string;
  graphics_id: string;
  x: number;
  y: number;
  elevation: number;
  movement_type: string;
  movement_range_x: number;
  movement_range_y: number;
  trainer_type: string;
  trainer_sight_or_berry_tree_id: string;
  script: string;
  flag: string;
}

export interface WarpEventData {
  x: number;
  y: number;
  elevation: number;
  dest_map: string;
  dest_warp_id: string;
}

export interface CoordEventData {
  type: string;
  x: number;
  y: number;
  elevation: number;
  var: string;
  var_value: string;
  script: string;
}

export interface BgEventData {
  type: string;
  x: number;
  y: number;
  elevation: number;
  script?: string;
  [key: string]: unknown;
}

export interface MapData {
  id: string;
  name: string;
  width: number;
  height: number;
  /** Map grid values: bits 0-9 metatile, 10-11 collision, 12-15 elevation. */
  blocks: number[];
  borderWidth: number;
  borderHeight: number;
  border: number[];
  tilesetPair: string;
  music: string | null;
  weather: string | null;
  mapType: string | null;
  regionMapSection: string | null;
  allowCycling: boolean;
  allowRunning: boolean;
  showMapName: boolean;
  connections: MapConnection[];
  objectEvents: ObjectEventData[];
  warpEvents: WarpEventData[];
  coordEvents: CoordEventData[];
  bgEvents: BgEventData[];
}

/** Per-metatile attributes of one tileset (primary: ids 0..639, secondary: ids 640.. offset by 640). */
export interface TilesetAttributes {
  behaviors: number[];
  layers: number[];
  encounters: number[];
}

export interface TilesetPairInfo {
  primary: string;
  secondary: string;
  /** Primary metatile ids drawn in the pair atlas because they use secondary palettes/tiles. */
  overrides: number[];
}

export interface TilesetIndex {
  primaries: Record<string, TilesetAttributes>;
  secondaries: Record<string, TilesetAttributes>;
  pairs: Record<string, TilesetPairInfo>;
}

export interface SpriteInfo {
  key: string;
  frameWidth: number;
  frameHeight: number;
  frameCount: number;
  anims: string;
  inanimate: boolean;
  /** NPC_TEXT_COLOR_*: 0 male (blue), 1 female (red), 2 mon, 3 neutral. */
  textColor: number;
}

export interface Constants {
  newGameFlags: string[];
  metatileBehaviors: Record<string, number>;
}
