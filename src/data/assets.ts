import Phaser from 'phaser';
import type { ScriptsData } from '../script/ScriptEngine';
import type { CharmapData } from '../text/charmap';
import { fontTextureKey, type FontsData } from '../text/Font';
import { MESSAGE_TEXTURES } from '../text/MessageBox';
import { userFrameTexture } from '../ui/MenuWindow';
import { TilesetPair } from '../world/TilesetPair';
import type { Constants, ItemInfo, MapData, MoveInfo, PokemonTables, SpeciesInfo, SpriteInfo, TilesetIndex } from './types';

const GEN = 'gen';

/**
 * Central registry for extracted data. Small indexes are loaded once at boot;
 * maps and textures are fetched on demand and cached.
 */
export class Assets {
  mapIndex: Record<string, string> = {}; // MAP_* id -> map name
  sprites: Record<string, SpriteInfo> = {}; // OBJ_EVENT_GFX_* -> sheet
  private tilesets!: TilesetIndex;
  private pairs = new Map<string, TilesetPair>();
  constants!: Constants;
  fonts!: FontsData;
  charmap!: CharmapData;
  strings: Record<string, string> = {};
  scripts!: ScriptsData;
  behaviorIds: Record<string, number> = {};
  species: SpeciesInfo[] = [];
  moves: MoveInfo[] = [];
  items: ItemInfo[] = [];
  pokemonTables!: PokemonTables;

  private maps = new Map<string, Promise<MapData>>();

  async init(): Promise<void> {
    const [index, sprites, tilesets, constants, fonts, charmap, strings, scripts, species, moves, items, tables] = await Promise.all([
      fetchJson<Record<string, string>>(`${GEN}/maps/index.json`),
      fetchJson<Record<string, SpriteInfo>>(`${GEN}/sprites/manifest.json`),
      fetchJson<TilesetIndex>(`${GEN}/tilesets/index.json`),
      fetchJson<Constants>(`${GEN}/constants.json`),
      fetchJson<FontsData>(`${GEN}/text/fonts.json`),
      fetchJson<CharmapData>(`${GEN}/text/charmap.json`),
      fetchJson<Record<string, string>>(`${GEN}/text/strings.json`),
      fetchJson<ScriptsData>(`${GEN}/scripts/scripts.json`),
      fetchJson<SpeciesInfo[]>(`${GEN}/pokemon/species.json`),
      fetchJson<MoveInfo[]>(`${GEN}/pokemon/moves.json`),
      fetchJson<ItemInfo[]>(`${GEN}/pokemon/items.json`),
      fetchJson<PokemonTables>(`${GEN}/pokemon/tables.json`),
    ]);
    this.species = species;
    this.moves = moves;
    this.items = items;
    this.pokemonTables = tables;
    this.fonts = fonts;
    this.charmap = charmap;
    this.strings = strings;
    this.scripts = scripts;
    this.mapIndex = index;
    this.sprites = sprites;
    this.tilesets = tilesets;
    this.constants = constants;
    this.behaviorIds = constants.metatileBehaviors;
  }

  mapNameForId(id: string): string | undefined {
    return this.mapIndex[id];
  }

  loadMap(name: string): Promise<MapData> {
    let p = this.maps.get(name);
    if (!p) {
      p = fetchJson<MapData>(`${GEN}/maps/${name}.json`);
      this.maps.set(name, p);
    }
    return p;
  }

  tilesetPair(key: string): TilesetPair {
    let pair = this.pairs.get(key);
    if (!pair) {
      const info = this.tilesets.pairs[key];
      if (!info) throw new Error(`Unknown tileset pair ${key}`);
      pair = new TilesetPair(key, info, this.tilesets.primaries[info.primary], this.tilesets.secondaries[info.secondary]);
      this.pairs.set(key, pair);
    }
    return pair;
  }

  /** Ensure the primary and pair atlases (below/above) for a tileset pair are in the texture manager. */
  loadTilesetTextures(scene: Phaser.Scene, key: string): Promise<void> {
    const pair = this.tilesetPair(key);
    const files = (['below', 'above'] as const).flatMap((layer): [string, string][] => [
      [pair.primaryTexture(layer), `${GEN}/tilesets/${pair.info.primary}_${layer}.png`],
      [pair.pairTexture(layer), `${GEN}/tilesets/${key}_${layer}.png`],
    ]);
    return loadImages(scene, files);
  }

  /** Font sheets and message box graphics, needed before any text can be shown. */
  loadTextTextures(scene: Phaser.Scene): Promise<void> {
    const images = new Set(Object.values(this.fonts.fonts).map((f) => f.image));
    return loadImages(scene, [
      ...[...images].map((img): [string, string] => [fontTextureKey(img), `${GEN}/text/${img}.png`]),
      [MESSAGE_TEXTURES.frame, `${GEN}/text/dialogue_frame.png`],
      [MESSAGE_TEXTURES.arrows, `${GEN}/text/down_arrows.png`],
      ...Array.from({ length: 10 }, (_, i): [string, string] => [userFrameTexture(i + 1), `${GEN}/text/frame_type${i + 1}.png`]),
    ]);
  }

  /** Ensure a species' front pic (64x64) is loaded; returns its texture key. */
  async loadMonFrontPic(scene: Phaser.Scene, species: number): Promise<string> {
    const key = monFrontPicKey(species);
    await loadImages(scene, [[key, `${GEN}/pokemon/front/${species}.png`]]);
    return key;
  }

  /** Ensure the sprite sheet for an OBJ_EVENT_GFX_* id is loaded. Returns its info, or undefined. */
  async loadSprite(scene: Phaser.Scene, gfxId: string): Promise<SpriteInfo | undefined> {
    const info = this.sprites[gfxId];
    if (!info) return undefined;
    const key = spriteTextureKey(info);
    if (!scene.textures.exists(key)) {
      await new Promise<void>((resolve) => {
        scene.load.spritesheet(key, `${GEN}/sprites/${info.key}.png`, {
          frameWidth: info.frameWidth,
          frameHeight: info.frameHeight,
        });
        scene.load.once(`filecomplete-spritesheet-${key}`, () => resolve());
        scene.load.once(Phaser.Loader.Events.COMPLETE, () => resolve());
        scene.load.start();
      });
    }
    return info;
  }
}

export function monFrontPicKey(species: number): string {
  return `mon_front_${species}`;
}

export function spriteTextureKey(info: SpriteInfo): string {
  return `spr_${info.key}`;
}

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to load ${url}: ${res.status}`);
  return res.json() as Promise<T>;
}

function loadImages(scene: Phaser.Scene, images: [string, string][]): Promise<void> {
  const missing = images.filter(([key]) => !scene.textures.exists(key));
  if (missing.length === 0) return Promise.resolve();
  return new Promise((resolve) => {
    let remaining = missing.length;
    const done = () => {
      if (--remaining === 0) resolve();
    };
    for (const [key, url] of missing) {
      scene.load.image(key, url);
      scene.load.once(`filecomplete-image-${key}`, done);
    }
    scene.load.once(Phaser.Loader.Events.COMPLETE, () => resolve());
    scene.load.start();
  });
}
