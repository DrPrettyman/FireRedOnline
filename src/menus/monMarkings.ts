// mon_markings.c: the marking-combination sprite the summary screen shows. The markings menu
// itself (PC / summary marking editor) isn't ported.

import { animTable } from '../battle/gfx';
import { gfx, gfx16 } from '../gba/gfx';
import {
  CreateSprite,
  gDummySpriteAffineAnimTable,
  gSprites,
  LoadSpritePalette,
  LoadSpriteSheet,
  MAX_SPRITES,
  oam,
  SPRITE_SHAPE,
  type Sprite,
} from '../gba/sprite';
import { K } from '../battle/constants';

const sOamData_MarkingCombo = oam({ shape: SPRITE_SHAPE['32x8'][0], size: SPRITE_SHAPE['32x8'][1] });

function SpriteCB_Dummy(_sprite: Sprite): void {}

/** CreateMonMarkingAllCombosSprite: one sheet holding every combination; the anim picks one. */
export function CreateMonMarkingAllCombosSprite(tileTag: number, paletteTag: number, palette: Uint16Array | null): Sprite | null {
  return CreateMarkingComboSprite(tileTag, paletteTag, palette ?? gfx16('sMonMarkings_Pal'), 1 << K.NUM_MON_MARKINGS);
}

function CreateMarkingComboSprite(tileTag: number, paletteTag: number, palette: Uint16Array, size: number): Sprite | null {
  LoadSpriteSheet({ data: gfx('sMonMarkings_Gfx'), size: size * 0x80, tag: tileTag });
  LoadSpritePalette({ data: palette, tag: paletteTag });
  const spriteId = CreateSprite(
    {
      tileTag,
      paletteTag,
      oam: sOamData_MarkingCombo,
      anims: animTable('mon_markings.c', 'sAnims_MarkingCombo'),
      images: null,
      affineAnims: gDummySpriteAffineAnimTable,
      callback: SpriteCB_Dummy,
    },
    0,
    0,
    0,
  );
  return spriteId !== MAX_SPRITES ? gSprites[spriteId] : null;
}
