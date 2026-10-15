// event_object_movement.c's sprite helpers for object event graphics on the GBA layer
// (CreateObjectGraphicsSprite): the shop's map view draws the field's objects with them. The field
// itself draws objects with Phaser (entities/ObjectEvent.ts) from the same graphics info.

import { animTable } from '../battle/gfx';
import type { ObjectEventGbaInfo, SpriteInfo } from '../data/types';
import { gfx, gfx16 } from '../gba/gfx';
import {
  CreateSprite,
  gDummySpriteAffineAnimTable,
  IndexOfSpritePaletteTag,
  LoadSpritePalette,
  oam,
  SPRITE_SHAPE,
  TAG_NONE,
  type SpriteCallback,
  type SpriteFrameImage,
  type SpriteTemplate,
} from '../gba/sprite';

/** gObjectEventGraphicsInfoPointers, as extracted into the sprite manifest (OBJ_EVENT_GFX_* name -> info). */
let sGraphicsInfo: Record<string, SpriteInfo> = {};

export function setObjectEventGraphicsInfo(sprites: Record<string, SpriteInfo>): void {
  sGraphicsInfo = sprites;
}

/** GetObjectEventGraphicsInfo */
export function GetObjectEventGraphicsInfo(graphicsId: string): SpriteInfo {
  const info = sGraphicsInfo[graphicsId];
  if (!info) throw new Error(`Unknown object event graphics ${graphicsId}`);
  return info;
}

/** The pic and palette symbols CreateObjectGraphicsSprite loads for these graphics ids, to preload. */
export function objectEventGfxSymbols(graphicsIds: Iterable<string>): string[] {
  const out = new Set<string>();
  for (const id of graphicsIds) {
    const gba = sGraphicsInfo[id]?.gba;
    if (!gba) continue;
    for (const [sym] of gba.images) out.add(sym);
    if (gba.palette) out.add(gba.palette);
  }
  return [...out];
}

// gObjectEventBaseOam_*: every object event OAM is priority 2.
function baseOam(name: string) {
  const [shape, size] = SPRITE_SHAPE[name as keyof typeof SPRITE_SHAPE] ?? SPRITE_SHAPE['16x32'];
  return oam({ shape, size, priority: 2 });
}

function frameImages(gba: ObjectEventGbaInfo): SpriteFrameImage[] {
  return gba.images.map(([sym, offset, size]) => {
    const data = gfx(sym);
    const n = size < 0 ? data.length : size;
    return { data: data.subarray(offset, offset + n), size: n };
  });
}

/**
 * CopyObjectGraphicsInfoToSpriteTemplate. The subsprite tables are left out: a new sprite uses table 0,
 * which is {0, NULL} for every object event size and so draws as the plain OAM.
 */
export function CopyObjectGraphicsInfoToSpriteTemplate(graphicsId: string, callback: SpriteCallback): SpriteTemplate {
  const info = GetObjectEventGraphicsInfo(graphicsId);
  return {
    tileTag: TAG_NONE,
    paletteTag: info.gba.paletteTag,
    oam: baseOam(info.gba.oam),
    anims: animTable('event_object_movement.c', info.anims),
    images: frameImages(info.gba),
    affineAnims: gDummySpriteAffineAnimTable,
    callback,
  };
}

/** LoadObjectEventPalette + TryLoadObjectPalette */
function LoadObjectEventPalette(info: ObjectEventGbaInfo): void {
  if (!info.palette || IndexOfSpritePaletteTag(info.paletteTag) !== 0xff) return;
  LoadSpritePalette({ data: gfx16(info.palette), tag: info.paletteTag });
}

/** CreateObjectGraphicsSprite */
export function CreateObjectGraphicsSprite(graphicsId: string, callback: SpriteCallback, x: number, y: number, subpriority: number): number {
  const template = CopyObjectGraphicsInfoToSpriteTemplate(graphicsId, callback);
  if (template.paletteTag !== TAG_NONE) LoadObjectEventPalette(GetObjectEventGraphicsInfo(graphicsId).gba);
  return CreateSprite(template, x, y, subpriority);
}
