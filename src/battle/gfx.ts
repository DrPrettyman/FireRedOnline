// Battler sprites: battle_gfx_sfx_util.c (pic loading, BattleInitAllSprites, shadows), the sprite
// templates from pokemon.c/data.c, battle_anim_mons.c (battler coords, translation helpers),
// pokeball.c (send-out and healthbox slide-in), the ball-open effects from battle_anim_special.c,
// and the battler sprite callbacks of battle_main.c.
//
// Move/special battle animation scripts are not implemented: InitAndLaunchSpecialAnimation and
// TryHandleLaunchBattleTableAnimation finish immediately (see the per-animation notes below).

import { gfx, gfx16 } from '../gba/gfx';
import { DISPLAY_HEIGHT, OBJ_VRAM0, RGB, RGB_WHITE, vram } from '../gba/hw';
import { BeginNormalPaletteFade, BlendPalette, BG_PLTT_ID, gPaletteFade, gPlttBufferFaded, gPlttBufferUnfaded, LoadPalette, OBJ_PLTT_ID, PLTT_SIZE_4BPP } from '../gba/palette';
import {
  AnimateSprite,
  CreateInvisibleSprite,
  CreateSprite,
  DestroySprite,
  DestroySpriteAndFreeResources,
  FreeSpriteOamMatrix,
  FreeSpritePaletteByTag,
  FreeSpriteTilesByTag,
  gDummySpriteAffineAnimTable,
  gSprites,
  GetSpriteTileStartByTag,
  LoadCompressedSpritePalette,
  LoadCompressedSpriteSheet,
  LoadSpritePalette,
  LoadSpriteSheet,
  MAX_SPRITES,
  oam,
  SetCallbackToStoredInData6,
  SPRITE_SHAPE,
  SpriteCallbackDummy,
  StartSpriteAffineAnim,
  StartSpriteAnim,
  StartSpriteAnimIfDifferent,
  TAG_NONE,
  type AffineAnimCmd,
  type AnimCmd,
  type Sprite,
  type SpriteFrameImage,
  type SpriteTemplate,
} from '../gba/sprite';
import { CreateTask, DestroyTask, gTasks, type TaskFunc } from '../gba/task';
import type { Pokemon } from '../pokemon/Pokemon';
import {
  CreateBattlerHealthboxSprites,
  CreateSafariPlayerHealthboxSprites,
  GetHPBarLevel,
  InitBattlerHealthboxCoords,
  SetHealthboxSpriteInvisible,
  SetHealthboxSpriteVisible,
  UpdateHealthboxAttribute,
} from './battleInterface';
import { ui } from './battleUi';
import { K } from './constants';
import { bdata, g } from './env';
import { bufferBattlePartyCurrentOrderBySide } from './partyOrder';
import { Cos, Sin } from './trig';
import { getBattlerAtPosition, getBattlerPosition, getBattlerSide } from './util';

const isDoubleBattle = () => (g.battleTypeFlags & K.BATTLE_TYPE_DOUBLE) !== 0;
const sbd = () => g.battleSpritesDataPtr;

// ------------------------------------------------------------------ anim tables (extracted)

/** An AnimCmd pointer table from a C file (battle/anims.json). */
export function animTable(unit: string, name: string): AnimCmd[][] {
  const u = bdata.anims.units[unit];
  const t = u?.tables[name];
  if (!t) throw new Error(`Unknown anim table ${unit}:${name}`);
  return t.map((n) => (n ? (u.anims[n] as AnimCmd[]) : [{ type: -1 }]));
}

export function affineAnimTable(unit: string, name: string): AffineAnimCmd[][] {
  const u = bdata.anims.units[unit];
  const t = u?.affineTables[name];
  if (!t) throw new Error(`Unknown affine anim table ${unit}:${name}`);
  return t.map((n) => (n ? (u.affineAnims[n] as AffineAnimCmd[]) : [{ type: 0x7fff }]));
}

// ------------------------------------------------------------------ gMonSpritesGfxPtr

const MON_PIC_SIZE = 0x800;

/** gMonSpritesGfxPtr: per-position 4-frame pic buffers and the battler templates using them. */
class MonSpritesGfx {
  readonly sprites = [0, 1, 2, 3].map(() => new Uint8Array(0x2000));
  readonly images: SpriteFrameImage[][] = this.sprites.map((buf) => [0, 1, 2, 3].map((j) => ({ data: buf.subarray(j * MON_PIC_SIZE, (j + 1) * MON_PIC_SIZE), size: MON_PIC_SIZE })));
  templates: SpriteTemplate[] = [];
  readonly barFontGfx = new Uint8Array(0x1000);
}

export let gMonSpritesGfxPtr: MonSpritesGfx | null = null;

const gOamData_BattlerOpponent = () => oam({ affineMode: 1, shape: SPRITE_SHAPE['64x64'][0], size: SPRITE_SHAPE['64x64'][1], priority: 2, paletteNum: 0 });
const gOamData_BattlerPlayer = () => oam({ affineMode: 1, shape: SPRITE_SHAPE['64x64'][0], size: SPRITE_SHAPE['64x64'][1], priority: 2, paletteNum: 2 });

/** gSpriteTemplates_Battlers (pokemon.c), with images pointing at gMonSpritesGfxPtr. */
function spriteTemplatesBattlers(images: SpriteFrameImage[][]): SpriteTemplate[] {
  const player = affineAnimTable('data.c', 'gAffineAnims_BattleSpritePlayerSide');
  const opponent = affineAnimTable('data.c', 'gAffineAnims_BattleSpriteOpponentSide');
  const t: SpriteTemplate[] = [];
  t[K.B_POSITION_PLAYER_LEFT] = { tileTag: TAG_NONE, paletteTag: 0, oam: gOamData_BattlerPlayer(), anims: [], images: images[K.B_POSITION_PLAYER_LEFT], affineAnims: player, callback: SpriteCB_AllyMon };
  t[K.B_POSITION_OPPONENT_LEFT] = { tileTag: TAG_NONE, paletteTag: 0, oam: gOamData_BattlerOpponent(), anims: [], images: images[K.B_POSITION_OPPONENT_LEFT], affineAnims: opponent, callback: SpriteCB_EnemyMon };
  t[K.B_POSITION_PLAYER_RIGHT] = { tileTag: TAG_NONE, paletteTag: 0, oam: gOamData_BattlerPlayer(), anims: [], images: images[K.B_POSITION_PLAYER_RIGHT], affineAnims: player, callback: SpriteCB_AllyMon };
  t[K.B_POSITION_OPPONENT_RIGHT] = { tileTag: TAG_NONE, paletteTag: 0, oam: gOamData_BattlerOpponent(), anims: [], images: images[K.B_POSITION_OPPONENT_RIGHT], affineAnims: opponent, callback: SpriteCB_EnemyMon };
  return t;
}

/** AllocateMonSpritesGfx */
export function AllocateMonSpritesGfx(): void {
  const m = new MonSpritesGfx();
  m.templates = spriteTemplatesBattlers(m.images);
  gMonSpritesGfxPtr = m;
}

export function FreeMonSpritesGfx(): void {
  gMonSpritesGfxPtr = null;
}

/** gMultiuseSpriteTemplate */
export let gMultiuseSpriteTemplate: SpriteTemplate;

/** SetMultiuseSpriteTemplateToPokemon */
export function SetMultiuseSpriteTemplateToPokemon(speciesTag: number, battlerPosition: number): void {
  if (battlerPosition >= K.MAX_BATTLERS_COUNT) battlerPosition = 0;
  gMultiuseSpriteTemplate = { ...gMonSpritesGfxPtr!.templates[battlerPosition] };
  gMultiuseSpriteTemplate.paletteTag = speciesTag;
  gMultiuseSpriteTemplate.anims = animTable('data.c', 'gAnims_MonPic');
}

/** gTrainerBackPicTable_*: 0x800-byte frames of the back pic */
function trainerBackImages(trainerSpriteId: number): SpriteFrameImage[] {
  const pic = gfx(bdata.anims.trainerBackPics[trainerSpriteId]);
  const frames: SpriteFrameImage[] = [];
  for (let i = 0; i * 0x800 < pic.length; i++) frames.push({ data: pic.subarray(i * 0x800, (i + 1) * 0x800), size: 0x800 });
  return frames;
}

/** SetMultiuseSpriteTemplateToTrainerBack (sTrainerBackSpriteTemplates / gTrainerBackAnimsPtrTable) */
export function SetMultiuseSpriteTemplateToTrainerBack(trainerSpriteId: number, battlerPosition: number): void {
  if (battlerPosition === K.B_POSITION_PLAYER_LEFT || battlerPosition === K.B_POSITION_PLAYER_RIGHT) {
    gMultiuseSpriteTemplate = {
      tileTag: TAG_NONE,
      paletteTag: 0,
      oam: gOamData_BattlerPlayer(),
      anims: animTable('data.c', backAnimsTableName(trainerSpriteId)),
      images: trainerBackImages(trainerSpriteId),
      affineAnims: affineAnimTable('data.c', 'gAffineAnims_BattleSpritePlayerSide'),
      callback: SpriteCB_AllyMon,
    };
  } else {
    gMultiuseSpriteTemplate = { ...gMonSpritesGfxPtr!.templates[battlerPosition] };
    gMultiuseSpriteTemplate.anims = animTable('data.c', frontAnimsTableName(trainerSpriteId));
  }
  gMultiuseSpriteTemplate.paletteTag = trainerSpriteId;
}

/** gTrainerBackAnimsPtrTable[id] (by name from the extracted table) */
function backAnimsTableName(id: number): string {
  const n = bdata.anims.units['data.c'].tableTables['gTrainerBackAnimsPtrTable']?.[id];
  if (!n) throw new Error(`no back anims for trainer back pic ${id}`);
  return n;
}

function frontAnimsTableName(id: number): string {
  const n = bdata.anims.units['data.c'].tableTables['gTrainerFrontAnimsPtrTable']?.[id];
  if (!n) throw new Error(`no front anims for trainer pic ${id}`);
  return n;
}

// ------------------------------------------------------------------ coords (battle_anim_mons.c)

const sBattlerCoords = [
  [[72, 80], [176, 40], [48, 40], [112, 80]],
  [[32, 80], [200, 40], [90, 88], [152, 32]],
];

const GET_UNOWN_LETTER = (p: number) => ((((p >>> 24) & 3) << 6) | (((p >>> 16) & 3) << 4) | (((p >>> 8) & 3) << 2) | (p & 3)) % 28;

function battlerSpecies(battlerId: number): number {
  const t = sbd().battlerData[battlerId].transformSpecies;
  if (t) return t;
  const party = getBattlerSide(battlerId) !== K.B_SIDE_PLAYER ? g.enemyParty : g.playerParty;
  return party[g.battlerPartyIndexes[battlerId]]?.species ?? 0;
}

function battlerPersonality(battlerId: number): number {
  if (sbd().battlerData[battlerId].transformSpecies) return g.transformedPersonalities[battlerId];
  const party = getBattlerSide(battlerId) !== K.B_SIDE_PLAYER ? g.enemyParty : g.playerParty;
  return party[g.battlerPartyIndexes[battlerId]]?.personality ?? 0;
}

function coordsOf(table: ([number, number] | null)[], species: number): [number, number] {
  return table[species] ?? table[0] ?? [0x88, 0];
}

/** GetBattlerYDelta */
function GetBattlerYDelta(battlerId: number, species: number): number {
  const c = bdata.tables.coords;
  const table = getBattlerSide(battlerId) === K.B_SIDE_PLAYER ? c.monBack : c.monFront;
  if (species === K.SPECIES_UNOWN) {
    const letter = GET_UNOWN_LETTER(battlerPersonality(battlerId));
    return coordsOf(table, letter ? letter + K.SPECIES_UNOWN_B - 1 : species)[1];
  }
  if (species === K.SPECIES_CASTFORM) {
    if (getBattlerSide(battlerId) === K.B_SIDE_PLAYER) return 0; // sCastformBackSpriteYCoords
    return [17, 9, 9, 8][g.battleMonForms[battlerId]]; // gCastformFrontSpriteCoords
  }
  if (species > K.NUM_SPECIES) return coordsOf(table, 0)[1];
  return coordsOf(table, species)[1];
}

/** GetBattlerElevation */
function GetBattlerElevation(battlerId: number, species: number): number {
  if (getBattlerSide(battlerId) !== K.B_SIDE_OPPONENT) return 0;
  if (species === K.SPECIES_CASTFORM) return [13, 14, 13, 13][g.battleMonForms[battlerId]];
  const elev = bdata.tables.coords.enemyElevation;
  return species > K.NUM_SPECIES ? elev[0] : (elev[species] ?? 0);
}

function GetBattlerSpriteFinal_Y(battlerId: number, species: number, a3: boolean): number {
  let offset = GetBattlerYDelta(battlerId, species);
  if (getBattlerSide(battlerId) !== K.B_SIDE_PLAYER) offset -= GetBattlerElevation(battlerId, species);
  let y = (offset + sBattlerCoords[+isDoubleBattle()][getBattlerPosition(battlerId)][1]) & 0xff;
  if (a3) {
    if (getBattlerSide(battlerId) === K.B_SIDE_PLAYER) y = (y + 8) & 0xff;
    if (y > DISPLAY_HEIGHT - 64 + 8) y = DISPLAY_HEIGHT - 64 + 8;
  }
  return y;
}

/** GetBattlerSpriteCoord */
export function GetBattlerSpriteCoord(battlerId: number, coordType: number): number {
  switch (coordType) {
    case K.BATTLER_COORD_X:
    case K.BATTLER_COORD_X_2:
      return sBattlerCoords[+isDoubleBattle()][getBattlerPosition(battlerId)][0];
    case K.BATTLER_COORD_Y:
      return sBattlerCoords[+isDoubleBattle()][getBattlerPosition(battlerId)][1];
    default:
      return GetBattlerSpriteFinal_Y(battlerId, battlerSpecies(battlerId), coordType === K.BATTLER_COORD_Y_PIC_OFFSET);
  }
}

export function GetBattlerSpriteDefault_Y(battlerId: number): number {
  return GetBattlerSpriteCoord(battlerId, K.BATTLER_COORD_Y_PIC_OFFSET_DEFAULT);
}

export function GetSubstituteSpriteDefault_Y(battlerId: number): number {
  return GetBattlerSpriteCoord(battlerId, K.BATTLER_COORD_Y) + (getBattlerSide(battlerId) !== K.B_SIDE_PLAYER ? 16 : 17);
}

export function GetBattlerSpriteSubpriority(battlerId: number): number {
  const position = getBattlerPosition(battlerId);
  if (position === K.B_POSITION_PLAYER_LEFT) return 30;
  if (position === K.B_POSITION_PLAYER_RIGHT) return 20;
  if (position === K.B_POSITION_OPPONENT_LEFT) return 40;
  return 50;
}

export function GetBattlerSpriteBGPriorityRank(battlerId: number): number {
  const position = getBattlerPosition(battlerId);
  return position === K.B_POSITION_PLAYER_LEFT || position === K.B_POSITION_OPPONENT_RIGHT ? 2 : 1;
}

/** IsBattlerSpritePresent */
export function IsBattlerSpritePresent(battlerId: number): boolean {
  if (g.battlerPositions[battlerId] === 0xff) return false;
  const party = getBattlerSide(battlerId) !== K.B_SIDE_PLAYER ? g.enemyParty : g.playerParty;
  return (party[g.battlerPartyIndexes[battlerId]]?.hp ?? 0) !== 0;
}

/** IsBattlerSpriteVisible (battle_anim.c) */
export function IsBattlerSpriteVisible(battlerId: number): boolean {
  if (!IsBattlerSpritePresent(battlerId)) return false;
  return !sbd().battlerData[battlerId].invisible || !gSprites[g.battlerSpriteIds[battlerId]].invisible;
}

// Translation helpers (sTransl_* = data[0..5])
export function InitAnimLinearTranslation(sprite: Sprite): void {
  const d = sprite.data;
  const x = d[2] - d[1];
  const y = d[4] - d[3];
  let xDelta = (Math.abs(x) << 8) & 0xffff;
  let yDelta = (Math.abs(y) << 8) & 0xffff;
  xDelta = Math.trunc(xDelta / d[0]) & 0xffff;
  yDelta = Math.trunc(yDelta / d[0]) & 0xffff;
  xDelta = x < 0 ? xDelta | 1 : xDelta & ~1;
  yDelta = y < 0 ? yDelta | 1 : yDelta & ~1;
  d[1] = xDelta;
  d[2] = yDelta;
  d[4] = 0;
  d[3] = 0;
}

export function StartAnimLinearTranslation(sprite: Sprite): void {
  sprite.data[1] = sprite.x;
  sprite.data[3] = sprite.y;
  InitAnimLinearTranslation(sprite);
  sprite.callback = AnimTranslateLinear_WithFollowup;
  sprite.callback(sprite);
}

export function PlayerThrowBall_StartAnimLinearTranslation(sprite: Sprite): void {
  sprite.data[1] = sprite.x;
  sprite.data[3] = sprite.y;
  InitAnimLinearTranslation(sprite);
  sprite.callback = PlayerThrowBall_AnimTranslateLinear_WithFollowup;
  sprite.callback(sprite);
}

/** AnimTranslateLinear: true when finished */
export function AnimTranslateLinear(sprite: Sprite): boolean {
  const d = sprite.data;
  if (!d[0]) return true;
  const v1 = d[1] & 0xffff;
  const v2 = d[2] & 0xffff;
  const x = ((d[3] & 0xffff) + v1) & 0xffff;
  const y = ((d[4] & 0xffff) + v2) & 0xffff;
  sprite.x2 = v1 & 1 ? -(x >> 8) : x >> 8;
  sprite.y2 = v2 & 1 ? -(y >> 8) : y >> 8;
  d[3] = x;
  d[4] = y;
  --d[0];
  return false;
}

export function AnimTranslateLinear_WithFollowup(sprite: Sprite): void {
  if (AnimTranslateLinear(sprite)) SetCallbackToStoredInData6(sprite);
}

function PlayerThrowBall_AnimTranslateLinear_WithFollowup(sprite: Sprite): void {
  UpdatePlayerPosInThrowAnim(sprite);
  if (AnimTranslateLinear(sprite)) SetCallbackToStoredInData6(sprite);
}

export function InitAnimArcTranslation(sprite: Sprite): void {
  sprite.data[1] = sprite.x;
  sprite.data[3] = sprite.y;
  InitAnimLinearTranslation(sprite);
  sprite.data[6] = Math.trunc(0x8000 / sprite.data[0]);
  sprite.data[7] = 0;
}

export function TranslateAnimHorizontalArc(sprite: Sprite): boolean {
  if (AnimTranslateLinear(sprite)) return true;
  sprite.data[7] += sprite.data[6];
  sprite.y2 += Sin(((sprite.data[7] & 0xffff) >> 8) & 0xff, sprite.data[5]);
  return false;
}

export function SetSpritePrimaryCoordsFromSecondaryCoords(sprite: Sprite): void {
  sprite.x += sprite.x2;
  sprite.y += sprite.y2;
  sprite.x2 = 0;
  sprite.y2 = 0;
}

// ------------------------------------------------------------------ battle_main.c sprite callbacks

/** UpdatePlayerPosInThrowAnim (sPlayerThrowXTranslation) */
export function UpdatePlayerPosInThrowAnim(sprite: Sprite): void {
  const t = (bdata.tables.mech as Record<string, number[]>).sPlayerThrowXTranslation;
  if (sprite.animDelayCounter === 0) sprite.centerToCornerVecX = t[sprite.animCmdIndex];
}

export function SpriteCB_EnemyMon(sprite: Sprite): void {
  sprite.callback = SpriteCB_MoveWildMonToRight;
  StartSpriteAnimIfDifferent(sprite, 0);
  BeginNormalPaletteFade(0x20000, 0, 10, 10, RGB(8, 8, 8));
}

function SpriteCB_MoveWildMonToRight(sprite: Sprite): void {
  if ((g.introSlideFlags & 1) === 0) {
    sprite.x2 += 2;
    if (sprite.x2 === 0) {
      sprite.callback = SpriteCB_WildMonShowHealthbox;
      ui.playCry(sprite.data[2]);
    }
  }
}

function SpriteCB_WildMonShowHealthbox(sprite: Sprite): void {
  if (sprite.animEnded) {
    StartHealthboxSlideIn(sprite.data[0]);
    SetHealthboxSpriteVisible(g.healthboxSpriteIds[sprite.data[0]]);
    sprite.callback = SpriteCallbackDummy_2;
    StartSpriteAnimIfDifferent(sprite, 0);
    BeginNormalPaletteFade(0x20000, 0, 10, 0, RGB(8, 8, 8));
  }
}

export const SpriteCallbackDummy_2 = (_sprite: Sprite): void => {};

export function SpriteCB_FaintOpponentMon(sprite: Sprite): void {
  const battler = sprite.data[0];
  const species = sbd().battlerData[battler].transformSpecies || sprite.data[2];
  let yOffset: number;
  const front = bdata.tables.coords.monFront;
  if (species === K.SPECIES_UNOWN) {
    const letter = GET_UNOWN_LETTER(g.enemyParty[g.battlerPartyIndexes[battler]]!.personality);
    yOffset = coordsOf(front, letter === 0 ? K.SPECIES_UNOWN : K.NUM_SPECIES + letter)[1];
  } else if (species === K.SPECIES_CASTFORM) {
    yOffset = [17, 9, 9, 8][g.battleMonForms[battler]];
  } else if (species > K.NUM_SPECIES) {
    yOffset = coordsOf(front, 0)[1];
  } else {
    yOffset = coordsOf(front, species)[1];
  }
  sprite.data[3] = 8 - Math.trunc(yOffset / 8);
  sprite.data[4] = 1;
  sprite.callback = SpriteCB_AnimFaintOpponent;
}

function SpriteCB_AnimFaintOpponent(sprite: Sprite): void {
  if (--sprite.data[4] === 0) {
    sprite.data[4] = 2;
    sprite.y2 += 8; // Move the sprite down.
    if (--sprite.data[3] < 0) {
      FreeSpriteOamMatrix(sprite);
      DestroySprite(sprite);
    } else {
      // Erase bottom part of the sprite to create a smooth illusion of mon falling down.
      const buf = gMonSpritesGfxPtr!.sprites[getBattlerPosition(sprite.data[0])];
      const start = (g.battleMonForms[sprite.data[0]] << 11) + (sprite.data[3] << 8);
      buf.fill(0, start, start + 0x100);
      StartSpriteAnim(sprite, g.battleMonForms[sprite.data[0]]);
    }
  }
}

export function SpriteCB_ShowAsMoveTarget(sprite: Sprite): void {
  sprite.data[3] = 8;
  sprite.data[4] = +sprite.invisible;
  sprite.callback = SpriteCB_BlinkVisible;
}

function SpriteCB_BlinkVisible(sprite: Sprite): void {
  if (--sprite.data[3] === 0) {
    sprite.invisible = !sprite.invisible;
    sprite.data[3] = 8;
  }
}

export function SpriteCB_HideAsMoveTarget(sprite: Sprite): void {
  sprite.invisible = !!sprite.data[4];
  sprite.data[4] = 0;
  sprite.callback = SpriteCallbackDummy_2;
}

export function SpriteCB_AllyMon(sprite: Sprite): void {
  sprite.callback = oac_poke_ally_;
}

function oac_poke_ally_(sprite: Sprite): void {
  if (!(g.introSlideFlags & 1)) {
    sprite.x2 -= 2;
    if (sprite.x2 === 0) {
      sprite.callback = SpriteCB_Idle;
      sprite.data[1] = 0;
    }
  }
}

export function SetIdleSpriteCallback(sprite: Sprite): void {
  sprite.callback = SpriteCB_Idle;
}

function SpriteCB_Idle(_sprite: Sprite): void {}

export function SpriteCB_FaintSlideAnim(sprite: Sprite): void {
  if (!(g.introSlideFlags & 1)) {
    sprite.x2 += sprite.data[1];
    sprite.y2 += sprite.data[2];
  }
}

/** DoBounceEffect / EndBounceEffect / SpriteCB_BounceEffect */
export function DoBounceEffect(battler: number, which: number, delta: number, amplitude: number): void {
  const h = sbd().healthBoxesData[battler];
  if (which === K.BOUNCE_HEALTHBOX) {
    if (h.healthboxIsBouncing) return;
  } else if (h.battlerIsBouncing) {
    return;
  }
  const invisibleSpriteId = CreateInvisibleSprite(SpriteCB_BounceEffect);
  let bouncerSpriteId: number;
  if (which === K.BOUNCE_HEALTHBOX) {
    bouncerSpriteId = g.healthboxSpriteIds[battler];
    h.healthboxBounceSpriteId = invisibleSpriteId;
    h.healthboxIsBouncing = 1;
    gSprites[invisibleSpriteId].data[0] = 128; // 0
  } else {
    bouncerSpriteId = g.battlerSpriteIds[battler];
    h.battlerBounceSpriteId = invisibleSpriteId;
    h.battlerIsBouncing = 1;
    gSprites[invisibleSpriteId].data[0] = 192; // -1
  }
  const d = gSprites[invisibleSpriteId].data;
  d[1] = delta;
  d[2] = amplitude;
  d[3] = bouncerSpriteId;
  d[4] = which;
  gSprites[bouncerSpriteId].x2 = 0;
  gSprites[bouncerSpriteId].y2 = 0;
}

export function EndBounceEffect(battler: number, which: number): void {
  const h = sbd().healthBoxesData[battler];
  let bouncerSpriteId: number;
  if (which === K.BOUNCE_HEALTHBOX) {
    if (!h.healthboxIsBouncing) return;
    bouncerSpriteId = gSprites[h.healthboxBounceSpriteId].data[3];
    DestroySprite(gSprites[h.healthboxBounceSpriteId]);
    h.healthboxIsBouncing = 0;
  } else {
    if (!h.battlerIsBouncing) return;
    bouncerSpriteId = gSprites[h.battlerBounceSpriteId].data[3];
    DestroySprite(gSprites[h.battlerBounceSpriteId]);
    h.battlerIsBouncing = 0;
  }
  gSprites[bouncerSpriteId].x2 = 0;
  gSprites[bouncerSpriteId].y2 = 0;
}

function SpriteCB_BounceEffect(sprite: Sprite): void {
  const d = sprite.data;
  gSprites[d[3]].y2 = Sin(d[0], d[2]) + d[2];
  d[0] = (d[0] + d[1]) & 0xff;
}

export function SpriteCB_PlayerThrowInit(sprite: Sprite): void {
  StartSpriteAnim(sprite, 1);
  sprite.callback = SpriteCB_PlayerThrowUpdate;
}

function SpriteCB_PlayerThrowUpdate(sprite: Sprite): void {
  UpdatePlayerPosInThrowAnim(sprite);
  if (sprite.animEnded) sprite.callback = SpriteCB_Idle;
}

// ------------------------------------------------------------------ battle_gfx_sfx_util.c

export function SpriteCB_WaitForBattlerBallReleaseAnim(sprite: Sprite): void {
  const s = gSprites[sprite.data[1]];
  if (!s.affineAnimEnded) return;
  if (s.invisible) return;
  if (s.animPaused) {
    s.animPaused = false;
  } else if (s.animEnded) {
    s.callback = SetIdleSpriteCallback;
    StartSpriteAffineAnim(s, 0);
    sprite.callback = SpriteCallbackDummy;
  }
}

export function SpriteCB_TrainerSlideIn(sprite: Sprite): void {
  if (!(g.introSlideFlags & 1)) {
    sprite.x2 += sprite.data[0];
    if (sprite.x2 === 0) sprite.callback = SpriteCallbackDummy;
  }
}

/** CreateInvisibleSpriteWithCallback */
export const CreateInvisibleSpriteWithCallback = CreateInvisibleSprite;

/** InitAndLaunchChosenStatusAnimation: status anims are battle anim scripts (not implemented). */
export function InitAndLaunchChosenStatusAnimation(_isStatus2: boolean, _status: number): void {
  sbd().healthBoxesData[g.activeBattler].statusAnimActive = 0;
}

/**
 * TryHandleLaunchBattleTableAnimation: gBattleAnims_General scripts aren't implemented; the
 * substitute and Castform bookkeeping still happens. Returns true when done immediately.
 */
export function TryHandleLaunchBattleTableAnimation(activeBattler: number, _atkBattler: number, _defBattler: number, tableId: number, argument: number): boolean {
  if (tableId === K.B_ANIM_CASTFORM_CHANGE && argument & 0x80) {
    g.battleMonForms[activeBattler] = argument & ~0x80;
    return true;
  }
  if (sbd().battlerData[activeBattler].behindSubstitute && tableId === K.B_ANIM_SUBSTITUTE_FADE && gSprites[g.battlerSpriteIds[activeBattler]].invisible) {
    LoadBattleMonGfxAndAnimate(activeBattler, true, g.battlerSpriteIds[activeBattler]);
    ClearBehindSubstituteBit(activeBattler);
  }
  return true;
}

/**
 * InitAndLaunchSpecialAnimation: gBattleAnims_Special scripts aren't implemented. The effects the
 * battle flow depends on are applied directly: switching out hides the mon, the substitute swaps
 * load the right gfx, and the ball throw finishes at once.
 */
export function InitAndLaunchSpecialAnimation(activeBattler: number, atkBattler: number, _defBattler: number, tableId: number): void {
  switch (tableId) {
    case K.B_ANIM_SWITCH_OUT_PLAYER_MON:
    case K.B_ANIM_SWITCH_OUT_OPPONENT_MON:
      gSprites[g.battlerSpriteIds[atkBattler]].invisible = true;
      break;
    case K.B_ANIM_SUBSTITUTE_TO_MON:
      LoadBattleMonGfxAndAnimate(atkBattler, true, g.battlerSpriteIds[atkBattler]);
      break;
    case K.B_ANIM_MON_TO_SUBSTITUTE:
      LoadBattleMonGfxAndAnimate(atkBattler, false, g.battlerSpriteIds[atkBattler]);
      break;
    case K.B_ANIM_BALL_THROW:
    case K.B_ANIM_BALL_THROW_WITH_TRAINER:
      g.doingBattleAnim = false;
      break;
  }
  sbd().healthBoxesData[activeBattler].specialAnimActive = 0;
}

/** IsMoveWithoutAnimation: always FALSE */
export function IsMoveWithoutAnimation(_moveId: number, _animationTurn: number): boolean {
  return false;
}

/** HandleLoadSpecialPokePic / LoadSpecialPokePic: Unown letters use their own pic; Spinda's spots aren't drawn yet. */
export function LoadSpecialPokePic(front: boolean, species: number, personality: number, dest: Uint8Array): void {
  const table = front ? bdata.anims.monFrontPics : bdata.anims.monBackPics;
  let sp = species;
  if (species === K.SPECIES_UNOWN) {
    const letter = GET_UNOWN_LETTER(personality);
    if (letter) sp = K.NUM_SPECIES + letter;
  }
  if (species === K.SPECIES_SPINDA) console.warn('[battle] Spinda spots not drawn');
  const sym = table[sp] ?? table[0]!;
  const pic = gfx(sym);
  dest.fill(0);
  dest.set(pic.subarray(0, Math.min(pic.length, dest.length)));
}

/** The pic symbol LoadSpecialPokePic reads (for preloading). */
export function monPicSymbol(front: boolean, species: number, personality: number): string {
  const table = front ? bdata.anims.monFrontPics : bdata.anims.monBackPics;
  let sp = species;
  if (species === K.SPECIES_UNOWN) {
    const letter = GET_UNOWN_LETTER(personality);
    if (letter) sp = K.NUM_SPECIES + letter;
  }
  return table[sp] ?? table[0]!;
}

/** Both palette symbols GetMonSpritePalFromSpeciesAndPersonality can pick (for preloading). */
export function monPalSymbols(species: number): string[] {
  return [bdata.anims.monPalettes[species] ?? bdata.anims.monPalettes[0]!, bdata.anims.monShinyPalettes[species] ?? bdata.anims.monPalettes[0]!];
}

/** GetMonSpritePalStructFromOtIdPersonality: shiny palettes are tagged species + SPECIES_SHINY_TAG. */
export function GetMonSpritePalStructFromOtIdPersonality(species: number, otId: number, personality: number): { data: Uint16Array; tag: number } {
  const shinyValue = ((otId >>> 16) ^ (otId & 0xffff) ^ (personality >>> 16) ^ (personality & 0xffff)) & 0xffff;
  return { data: GetMonSpritePalFromSpeciesAndPersonality(species, otId, personality), tag: shinyValue < K.SHINY_ODDS ? species + K.SPECIES_SHINY_TAG : species };
}

/** GetMonSpritePalFromSpeciesAndPersonality */
export function GetMonSpritePalFromSpeciesAndPersonality(species: number, otId: number, personality: number): Uint16Array {
  const shinyValue = ((otId >>> 16) ^ (otId & 0xffff) ^ (personality >>> 16) ^ (personality & 0xffff)) & 0xffff;
  const sym = shinyValue < K.SHINY_ODDS ? bdata.anims.monShinyPalettes[species] : bdata.anims.monPalettes[species];
  return gfx16(sym ?? bdata.anims.monPalettes[0]!);
}

function loadBattlerPalette(mon: Pokemon, battlerId: number, species: number): void {
  const transform = sbd().battlerData[battlerId].transformSpecies !== K.SPECIES_NONE;
  const pal = transform ? GetMonSpritePalFromSpeciesAndPersonality(species, mon.otId, mon.personality) : GetMonSpritePalFromSpeciesAndPersonality(mon.species, mon.otId, mon.personality);
  const paletteOffset = OBJ_PLTT_ID(battlerId);
  LoadPalette(pal, paletteOffset, PLTT_SIZE_4BPP);
  LoadPalette(pal, BG_PLTT_ID(8) + BG_PLTT_ID(battlerId), PLTT_SIZE_4BPP);
  if (species === K.SPECIES_CASTFORM) LoadPalette(pal.subarray(g.battleMonForms[battlerId] * 16), paletteOffset, PLTT_SIZE_4BPP);
  // transform's pink color
  if (transform) {
    BlendPalette(paletteOffset, 16, 6, RGB_WHITE);
    gPlttBufferUnfaded.set(gPlttBufferFaded.subarray(paletteOffset, paletteOffset + 16), paletteOffset);
  }
}

/** BattleLoadOpponentMonSpriteGfx */
export function BattleLoadOpponentMonSpriteGfx(mon: Pokemon, battlerId: number): void {
  const t = sbd().battlerData[battlerId].transformSpecies;
  const species = t || mon.species;
  const personality = t ? g.transformedPersonalities[battlerId] : mon.personality;
  LoadSpecialPokePic(true, species, personality, gMonSpritesGfxPtr!.sprites[getBattlerPosition(battlerId)]);
  loadBattlerPalette(mon, battlerId, species);
}

/** BattleLoadPlayerMonSpriteGfx */
export function BattleLoadPlayerMonSpriteGfx(mon: Pokemon, battlerId: number): void {
  const t = sbd().battlerData[battlerId].transformSpecies;
  const species = t || mon.species;
  const personality = t ? g.transformedPersonalities[battlerId] : mon.personality;
  LoadSpecialPokePic(false, species, personality, gMonSpritesGfxPtr!.sprites[getBattlerPosition(battlerId)]);
  loadBattlerPalette(mon, battlerId, species);
}

/** DecompressTrainerFrontPic: sheet + palette tagged with the TRAINER_PIC id */
export function DecompressTrainerFrontPic(frontPicId: number, battlerId: number): void {
  const entry = bdata.anims.trainerFrontPics[frontPicId]!;
  const buf = gMonSpritesGfxPtr!.sprites[getBattlerPosition(battlerId)];
  buf.fill(0);
  buf.set(gfx(entry.pic).subarray(0, entry.size));
  LoadSpriteSheet({ data: buf, size: entry.size, tag: frontPicId });
  LoadCompressedSpritePalette({ data: gfx16(bdata.anims.trainerFrontPalettes[frontPicId]!), tag: frontPicId });
}

/** DecompressTrainerBackPalette */
export function DecompressTrainerBackPalette(index: number, palette: number): void {
  LoadPalette(gfx16(bdata.anims.trainerBackPalettes[index]), OBJ_PLTT_ID(palette), PLTT_SIZE_4BPP);
}

export function FreeTrainerFrontPicPaletteAndTile(frontPicId: number): void {
  FreeSpritePaletteByTag(frontPicId);
  FreeSpriteTilesByTag(frontPicId);
}

/** BattleLoadAllHealthBoxesGfx (singles and doubles; safari uses its own box) */
export function BattleLoadAllHealthBoxesGfx(state: number): boolean {
  if (!state) return false;
  const sheet = (sym: string, size: number, tag: number) => LoadCompressedSpriteSheet({ data: gfx(sym), size, tag });
  const healthbar = (position: number) =>
    LoadCompressedSpriteSheet({
      data: new Uint8Array(0x120), // gBlankGfxCompressed
      size: position & 1 ? 0x120 : 0x100,
      tag: [K.TAG_HEALTHBAR_PLAYER1_TILE, K.TAG_HEALTHBAR_OPPONENT1_TILE, K.TAG_HEALTHBAR_PLAYER2_TILE, K.TAG_HEALTHBAR_OPPONENT2_TILE][position],
    });
  if (state === 1) {
    LoadSpritePalette({ data: gfx16('gBattleInterface_Healthbox_Pal'), tag: K.TAG_HEALTHBOX_PAL });
    LoadSpritePalette({ data: gfx16('gBattleInterface_Healthbar_Pal'), tag: K.TAG_HEALTHBAR_PAL });
    return false;
  }
  if (!isDoubleBattle()) {
    if (state === 2) {
      if (g.battleTypeFlags & K.BATTLE_TYPE_SAFARI) sheet('gHealthboxSafariGfx', 0x1000, K.TAG_HEALTHBOX_SAFARI_TILE);
      else sheet('gHealthboxSinglesPlayerGfx', 0x1000, K.TAG_HEALTHBOX_PLAYER1_TILE);
    } else if (state === 3) sheet('gHealthboxSinglesOpponentGfx', 0x1000, K.TAG_HEALTHBOX_OPPONENT1_TILE);
    else if (state === 4) healthbar(g.battlerPositions[0]);
    else if (state === 5) healthbar(g.battlerPositions[1]);
    else return true;
  } else {
    if (state === 2) sheet('gHealthboxDoublesPlayerGfx', 0x800, K.TAG_HEALTHBOX_PLAYER1_TILE);
    else if (state === 3) sheet('gHealthboxDoublesPlayerGfx', 0x800, K.TAG_HEALTHBOX_PLAYER2_TILE);
    else if (state === 4) sheet('gHealthboxDoublesOpponentGfx', 0x800, K.TAG_HEALTHBOX_OPPONENT1_TILE);
    else if (state === 5) sheet('gHealthboxDoublesOpponentGfx', 0x800, K.TAG_HEALTHBOX_OPPONENT2_TILE);
    else if (state >= 6 && state <= 9) healthbar(g.battlerPositions[state - 6]);
    else return true;
  }
  return false;
}

/** LoadBattleBarGfx */
export function LoadBattleBarGfx(_arg0: number): void {
  gMonSpritesGfxPtr!.barFontGfx.set(gfx('gInterfaceGfx_HPNumbers').subarray(0, 0x1000));
}

/** BattleInitAllSprites */
export function BattleInitAllSprites(st: { state: number; battlerId: number }): boolean {
  switch (st.state) {
    case 0:
      ClearSpritesBattlerHealthboxAnimData();
      ++st.state;
      break;
    case 1:
      if (!BattleLoadAllHealthBoxesGfx(st.battlerId)) {
        ++st.battlerId;
      } else {
        st.battlerId = 0;
        ++st.state;
      }
      break;
    case 2:
      ++st.state;
      break;
    case 3:
      if (g.battleTypeFlags & K.BATTLE_TYPE_SAFARI && st.battlerId === 0) g.healthboxSpriteIds[st.battlerId] = CreateSafariPlayerHealthboxSprites();
      else g.healthboxSpriteIds[st.battlerId] = CreateBattlerHealthboxSprites(st.battlerId);
      if (++st.battlerId === g.battlersCount) {
        st.battlerId = 0;
        ++st.state;
      }
      break;
    case 4:
      InitBattlerHealthboxCoords(st.battlerId);
      if (++st.battlerId === g.battlersCount) {
        st.battlerId = 0;
        ++st.state;
      }
      break;
    case 5: {
      const b = st.battlerId;
      if (getBattlerSide(b) === K.B_SIDE_PLAYER) {
        if (!(g.battleTypeFlags & K.BATTLE_TYPE_SAFARI)) UpdateHealthboxAttribute(g.healthboxSpriteIds[b], g.playerParty[g.battlerPartyIndexes[b]]!, K.HEALTHBOX_ALL);
      } else {
        UpdateHealthboxAttribute(g.healthboxSpriteIds[b], g.enemyParty[g.battlerPartyIndexes[b]]!, K.HEALTHBOX_ALL);
      }
      SetHealthboxSpriteInvisible(g.healthboxSpriteIds[b]);
      if (++st.battlerId === g.battlersCount) {
        st.battlerId = 0;
        ++st.state;
      }
      break;
    }
    case 6:
      LoadAndCreateEnemyShadowSprites();
      // BufferBattlePartyCurrentOrder
      bufferBattlePartyCurrentOrderBySide(getBattlerAtPosition(K.B_POSITION_PLAYER_LEFT), 0);
      g.battlePartyCurrentOrder.set(g.battleStruct.battlerPartyOrders[getBattlerAtPosition(K.B_POSITION_PLAYER_LEFT)]);
      return true;
  }
  return false;
}

export function ClearSpritesHealthboxAnimData(): void {
  for (const h of sbd().healthBoxesData) Object.keys(h).forEach((k) => ((h as unknown as Record<string, number>)[k] = 0));
  const a = sbd().animationData as unknown as Record<string, number>;
  Object.keys(a).forEach((k) => (a[k] = 0));
}

function ClearSpritesBattlerHealthboxAnimData(): void {
  ClearSpritesHealthboxAnimData();
  for (const b of sbd().battlerData) Object.keys(b).forEach((k) => ((b as unknown as Record<string, number>)[k] = 0));
}

export function CopyAllBattleSpritesInvisibilities(): void {
  for (let i = 0; i < g.battlersCount; ++i) sbd().battlerData[i].invisible = +gSprites[g.battlerSpriteIds[i]].invisible;
}

export function CopyBattleSpriteInvisibility(battlerId: number): void {
  sbd().battlerData[battlerId].invisible = +gSprites[g.battlerSpriteIds[battlerId]].invisible;
}

/** BattleLoadSubstituteOrMonSpriteGfx */
export function BattleLoadSubstituteOrMonSpriteGfx(battlerId: number, loadMonSprite: boolean): void {
  if (!loadMonSprite) {
    const buf = gMonSpritesGfxPtr!.sprites[getBattlerPosition(battlerId)];
    const doll = gfx(getBattlerSide(battlerId) !== K.B_SIDE_PLAYER ? 'gSubstituteDollFrontGfx' : 'gSubstituteDollBackGfx');
    buf.set(doll.subarray(0, 0x800));
    for (let i = 1; i < 4; ++i) buf.copyWithin(i * 0x800, 0, 0x800);
    LoadPalette(gfx16('gSubstituteDollPal'), OBJ_PLTT_ID(battlerId), PLTT_SIZE_4BPP);
  } else if (getBattlerSide(battlerId) !== K.B_SIDE_PLAYER) {
    BattleLoadOpponentMonSpriteGfx(g.enemyParty[g.battlerPartyIndexes[battlerId]]!, battlerId);
  } else {
    BattleLoadPlayerMonSpriteGfx(g.playerParty[g.battlerPartyIndexes[battlerId]]!, battlerId);
  }
}

export function LoadBattleMonGfxAndAnimate(battlerId: number, loadMonSprite: boolean, spriteId: number): void {
  BattleLoadSubstituteOrMonSpriteGfx(battlerId, loadMonSprite);
  StartSpriteAnim(gSprites[spriteId], g.battleMonForms[battlerId]);
  gSprites[spriteId].y = loadMonSprite ? GetBattlerSpriteDefault_Y(battlerId) : GetSubstituteSpriteDefault_Y(battlerId);
}

export function TrySetBehindSubstituteSpriteBit(battlerId: number, move: number): void {
  if (move === K.MOVE_SUBSTITUTE) sbd().battlerData[battlerId].behindSubstitute = 1;
}

export function ClearBehindSubstituteBit(battlerId: number): void {
  sbd().battlerData[battlerId].behindSubstitute = 0;
}

/** HandleLowHpMusicChange: the low-HP beep isn't played (no audio). */
export function HandleLowHpMusicChange(mon: Pokemon, battlerId: number): void {
  sbd().battlerData[battlerId].lowHpSong = GetHPBarLevel(mon.hp, mon.maxHP) === K.HP_BAR_RED ? 1 : 0;
}

export function BattleStopLowHpSound(): void {
  const b = getBattlerAtPosition(K.B_POSITION_PLAYER_LEFT);
  sbd().battlerData[b].lowHpSong = 0;
  if (isDoubleBattle()) sbd().battlerData[b ^ K.BIT_FLANK].lowHpSong = 0;
}

/** SetBattlerSpriteAffineMode */
export function SetBattlerSpriteAffineMode(affineMode: number): void {
  for (let i = 0; i < g.battlersCount; ++i) {
    if (IsBattlerSpritePresent(i)) {
      const s = gSprites[g.battlerSpriteIds[i]];
      s.oam.affineMode = affineMode;
      if (affineMode === 0) {
        sbd().healthBoxesData[i].matrixNum = s.oam.matrixNum;
        s.oam.matrixNum = 0;
      } else {
        s.oam.matrixNum = sbd().healthBoxesData[i].matrixNum;
      }
    }
  }
}

const GFXTAG_SHADOW = 55129;
const PALTAG_SHADOW = 55039;

/** LoadAndCreateEnemyShadowSprites */
export function LoadAndCreateEnemyShadowSprites(): void {
  LoadCompressedSpriteSheet({ data: gfx('gEnemyMonShadow_Gfx'), size: 0x80, tag: GFXTAG_SHADOW });
  const template: SpriteTemplate = {
    tileTag: GFXTAG_SHADOW,
    paletteTag: PALTAG_SHADOW,
    oam: oam({ shape: SPRITE_SHAPE['32x8'][0], size: SPRITE_SHAPE['32x8'][1], priority: 3 }),
    anims: [[{ type: 0, imageValue: 0, duration: 0 }, { type: -1 }]],
    images: null,
    affineAnims: gDummySpriteAffineAnimTable,
    callback: SpriteCB_SetInvisible,
  };
  const make = (position: number) => {
    const b = getBattlerAtPosition(position);
    const id = CreateSprite(template, GetBattlerSpriteCoord(b, K.BATTLER_COORD_X), GetBattlerSpriteCoord(b, K.BATTLER_COORD_Y) + 29, 0xc8);
    sbd().healthBoxesData[b].shadowSpriteId = id;
    gSprites[id].data[0] = b;
  };
  make(K.B_POSITION_OPPONENT_LEFT);
  if (isDoubleBattle()) make(K.B_POSITION_OPPONENT_RIGHT);
}

function SpriteCB_EnemyShadow(shadowSprite: Sprite): void {
  const battlerId = shadowSprite.data[0];
  const battlerSprite = gSprites[g.battlerSpriteIds[battlerId]];
  if (!battlerSprite.inUse || !IsBattlerSpritePresent(battlerId)) {
    shadowSprite.callback = SpriteCB_SetInvisible;
    return;
  }
  let invisible = battlerSprite.invisible; // || gAnimScriptActive (no anim scripts)
  const t = sbd().battlerData[battlerId].transformSpecies;
  if (t !== K.SPECIES_NONE && (bdata.tables.coords.enemyElevation[t] ?? 0) === 0) invisible = true;
  if (sbd().battlerData[battlerId].behindSubstitute) invisible = true;
  shadowSprite.x = battlerSprite.x;
  shadowSprite.x2 = battlerSprite.x2;
  shadowSprite.invisible = invisible;
}

export function SpriteCB_SetInvisible(sprite: Sprite): void {
  sprite.invisible = true;
}

/** SetBattlerShadowSpriteCallback */
export function SetBattlerShadowSpriteCallback(battlerId: number, species: number): void {
  // The player's shadow is never seen.
  if (getBattlerSide(battlerId) === K.B_SIDE_PLAYER) return;
  const t = sbd().battlerData[battlerId].transformSpecies;
  if (t !== K.SPECIES_NONE) species = t;
  const shadow = gSprites[sbd().healthBoxesData[battlerId].shadowSpriteId];
  shadow.callback = (bdata.tables.coords.enemyElevation[species] ?? 0) !== 0 ? SpriteCB_EnemyShadow : SpriteCB_SetInvisible;
}

export function HideBattlerShadowSprite(battlerId: number): void {
  gSprites[sbd().healthBoxesData[battlerId].shadowSpriteId].callback = SpriteCB_SetInvisible;
}

/** BattleInterfaceSetWindowPals: give transparent pixels of two BG0 tile runs a real colour. */
export function BattleInterfaceSetWindowPals(): void {
  const fix = (start: number, tiles: number, nibble: number) => {
    for (let i = start; i < start + tiles * 32; i++) {
      let b = vram[i];
      if (!(b & 0x0f)) b |= nibble;
      if (!(b & 0xf0)) b |= nibble << 4;
      vram[i] = b;
    }
  };
  fix(0x240, 9, 0xf);
  fix(0x600, 18, 0x6);
}

/** ClearTemporarySpeciesSpriteData */
export function ClearTemporarySpeciesSpriteData(battlerId: number, dontClearSubstitute: boolean | number): void {
  sbd().battlerData[battlerId].transformSpecies = K.SPECIES_NONE;
  g.battleMonForms[battlerId] = 0;
  if (!dontClearSubstitute) ClearBehindSubstituteBit(battlerId);
}
export const clearTemporarySpeciesSpriteData = ClearTemporarySpeciesSpriteData;

/** ClearBattleMonForms */
export function clearBattleMonForms(): void {
  g.battleMonForms.fill(0);
}

/** ShouldPlayNormalMonCry */
export function ShouldPlayNormalMonCry(mon: Pokemon): boolean {
  if (mon.status & (K.STATUS1_ANY | K.STATUS1_TOXIC_COUNTER)) return false;
  return GetHPBarLevel(mon.hp, mon.maxHP) > K.HP_BAR_YELLOW;
}

// ------------------------------------------------------------------ pokeball.c

const BALL_GFX_TAG = (ballId: number) => 55000 + ballId;
const BALL_NAMES = ['Poke', 'Great', 'Safari', 'Ultra', 'Master', 'Net', 'Dive', 'Nest', 'Repeat', 'Timer', 'Luxury', 'Premier'];

/** ItemIdToBallId */
export function ItemIdToBallId(ballItem: number): number {
  const map: [string, string][] = [
    ['ITEM_MASTER_BALL', 'BALL_MASTER'],
    ['ITEM_ULTRA_BALL', 'BALL_ULTRA'],
    ['ITEM_GREAT_BALL', 'BALL_GREAT'],
    ['ITEM_SAFARI_BALL', 'BALL_SAFARI'],
    ['ITEM_NET_BALL', 'BALL_NET'],
    ['ITEM_DIVE_BALL', 'BALL_DIVE'],
    ['ITEM_NEST_BALL', 'BALL_NEST'],
    ['ITEM_REPEAT_BALL', 'BALL_REPEAT'],
    ['ITEM_TIMER_BALL', 'BALL_TIMER'],
    ['ITEM_LUXURY_BALL', 'BALL_LUXURY'],
    ['ITEM_PREMIER_BALL', 'BALL_PREMIER'],
  ];
  for (const [item, ball] of map) if (ballItem === K[item]) return K[ball];
  return K.BALL_POKE;
}

let ballTemplates: SpriteTemplate[] | undefined;
/** gBallSpriteTemplates */
export function gBallSpriteTemplates(): SpriteTemplate[] {
  if (ballTemplates) return ballTemplates;
  const anims = animTable('pokeball.c', 'sBallAnimSequences');
  const affine = affineAnimTable('pokeball.c', 'sAffineAnim_BallRotate');
  ballTemplates = BALL_NAMES.map((_, i) => ({
    tileTag: BALL_GFX_TAG(i),
    paletteTag: BALL_GFX_TAG(i),
    oam: oam({ affineMode: 3, shape: SPRITE_SHAPE['16x16'][0], size: SPRITE_SHAPE['16x16'][1], priority: 2 }),
    anims,
    images: null,
    affineAnims: affine,
    callback: SpriteCallbackDummy, // SpriteCB_BallThrow: only used by the unused throw case
  }));
  return ballTemplates;
}

export function ballGfxSymbols(): string[] {
  return [...BALL_NAMES.flatMap((n) => [`gBallGfx_${n}`, `gBallPal_${n}`]), 'gOpenPokeballGfx', 'gBattleAnimSpriteGfx_Particles', 'gBattleAnimSpritePal_CircleImpact'];
}

/** LoadBallGfx */
export function LoadBallGfx(ballId: number): void {
  const tag = BALL_GFX_TAG(ballId);
  if (GetSpriteTileStartByTag(tag) === TAG_NONE) {
    LoadCompressedSpriteSheet({ data: gfx(`gBallGfx_${BALL_NAMES[ballId]}`), size: 384, tag });
    LoadCompressedSpritePalette({ data: gfx16(`gBallPal_${BALL_NAMES[ballId]}`), tag });
  }
  if (ballId !== K.BALL_DIVE && ballId !== K.BALL_LUXURY && ballId !== K.BALL_PREMIER) {
    const start = GetSpriteTileStartByTag(tag);
    vram.set(gfx('gOpenPokeballGfx'), OBJ_VRAM0 + 0x100 + start * 32);
  }
}

export function DestroySpriteAndFreeResources_Ball(sprite: Sprite): void {
  DestroySpriteAndFreeResources(sprite);
}

export function FreeBallGfx(ballId: number): void {
  FreeSpriteTilesByTag(BALL_GFX_TAG(ballId));
  FreeSpritePaletteByTag(BALL_GFX_TAG(ballId));
}

function GetBattlerPokeballItemId(battlerId: number): number {
  const party = getBattlerSide(battlerId) === K.B_SIDE_PLAYER ? g.playerParty : g.enemyParty;
  return party[g.battlerPartyIndexes[battlerId]]?.pokeball ?? K.ITEM_POKE_BALL;
}

const sBattler = 6;

/** DoPokeballSendOutAnimation */
export function DoPokeballSendOutAnimation(pan: number, kindOfThrow: number): number {
  g.doingBattleAnim = true;
  sbd().healthBoxesData[g.activeBattler].ballAnimActive = 1;
  const taskId = CreateTask(Task_DoPokeballSendOutAnim, 5);
  gTasks[taskId].data[1] = pan;
  gTasks[taskId].data[2] = kindOfThrow;
  gTasks[taskId].data[3] = g.activeBattler;
  return 0;
}

const Task_DoPokeballSendOutAnim: TaskFunc = (taskId) => {
  const d = gTasks[taskId].data;
  if (d[0] === 0) {
    d[0]++;
    return;
  }
  const throwCaseId = d[2];
  const battlerId = d[3];
  const ballId = ItemIdToBallId(GetBattlerPokeballItemId(battlerId));
  LoadBallGfx(ballId);
  const ballSpriteId = CreateSprite(gBallSpriteTemplates()[ballId], 32, 80, 29);
  const ball = gSprites[ballSpriteId];
  ball.data[0] = 0x80;
  ball.data[1] = 0;
  ball.data[7] = throwCaseId;
  switch (throwCaseId) {
    case K.POKEBALL_PLAYER_SENDOUT:
      if (g.battleTypeFlags & K.BATTLE_TYPE_POKEDUDE) [ball.x, ball.y] = [32, 64];
      else [ball.x, ball.y] = [48, 70];
      g.battlerTarget = battlerId;
      ball.callback = SpriteCB_PlayerMonSendOut_1;
      break;
    case K.POKEBALL_OPPONENT_SENDOUT:
      ball.x = GetBattlerSpriteCoord(battlerId, K.BATTLER_COORD_X);
      ball.y = GetBattlerSpriteCoord(battlerId, K.BATTLER_COORD_Y) + 24;
      g.battlerTarget = battlerId;
      ball.data[0] = 0;
      ball.callback = SpriteCB_OpponentMonSendOut;
      break;
    default:
      console.warn('[battle] unused pokeball throw case', throwCaseId);
  }
  ball.data[sBattler] = g.battlerTarget;
  DestroyTask(taskId);
};

function SpriteCB_PlayerMonSendOut_1(sprite: Sprite): void {
  sprite.data[0] = 25;
  sprite.data[2] = GetBattlerSpriteCoord(sprite.data[sBattler], K.BATTLER_COORD_X_2);
  sprite.data[4] = GetBattlerSpriteCoord(sprite.data[sBattler], K.BATTLER_COORD_Y_PIC_OFFSET) + 24;
  sprite.data[5] = -30;
  sprite.oam.affineParam = sprite.data[sBattler];
  InitAnimArcTranslation(sprite);
  sprite.callback = SpriteCB_PlayerMonSendOut_2;
}

const HIBYTE = (x: number) => (x >> 8) & 0xff;

function SpriteCB_PlayerMonSendOut_2(sprite: Sprite): void {
  const d = sprite.data;
  if (HIBYTE(d[7]) >= 35 && HIBYTE(d[7]) < 80) {
    if ((sprite.oam.affineParam & 0xff00) === 0) {
      const r6 = d[1] & 1;
      const r7 = d[2] & 1;
      d[1] = (Math.trunc(d[1] / 3) & ~1) | r6;
      d[2] = (Math.trunc(d[2] / 3) & ~1) | r7;
      StartSpriteAffineAnim(sprite, 4);
    }
    const r4 = d[0];
    AnimTranslateLinear(sprite);
    d[7] += Math.trunc(d[sBattler] / 3);
    sprite.y2 += Sin(HIBYTE(d[7]), d[5]);
    sprite.oam.affineParam = (sprite.oam.affineParam + 0x100) & 0xffff;
    if ((sprite.oam.affineParam >> 8) % 3 !== 0) d[0] = r4;
    else d[0] = r4 - 1;
    if (HIBYTE(d[7]) >= 80) {
      const r6 = d[1] & 1;
      const r7 = d[2] & 1;
      d[1] = ((d[1] * 3) & ~1) | r6;
      d[2] = ((d[2] * 3) & ~1) | r7;
    }
  } else if (TranslateAnimHorizontalArc(sprite)) {
    sprite.x += sprite.x2;
    sprite.y += sprite.y2;
    sprite.y2 = 0;
    sprite.x2 = 0;
    d[sBattler] = sprite.oam.affineParam & 0xff;
    d[0] = 0;
    if (isDoubleBattle() && sbd().animationData.introAnimActive && d[sBattler] === getBattlerAtPosition(K.B_POSITION_PLAYER_RIGHT))
      sprite.callback = SpriteCB_ReleaseMon2FromBall;
    else sprite.callback = SpriteCB_ReleaseMonFromBall;
    StartSpriteAffineAnim(sprite, 0);
  }
}

function SpriteCB_ReleaseMon2FromBall(sprite: Sprite): void {
  if (sprite.data[0]++ > 24) {
    sprite.data[0] = 0;
    sprite.callback = SpriteCB_ReleaseMonFromBall;
  }
}

function SpriteCB_OpponentMonSendOut(sprite: Sprite): void {
  sprite.data[0]++;
  if (sprite.data[0] > 15) {
    sprite.data[0] = 0;
    if (isDoubleBattle() && sbd().animationData.introAnimActive && sprite.data[sBattler] === getBattlerAtPosition(K.B_POSITION_OPPONENT_RIGHT))
      sprite.callback = SpriteCB_ReleaseMon2FromBall;
    else sprite.callback = SpriteCB_ReleaseMonFromBall;
  }
}

/** SpriteCB_ReleaseMonFromBall (the cry task only matters for audio, which isn't implemented) */
function SpriteCB_ReleaseMonFromBall(sprite: Sprite): void {
  const battlerId = sprite.data[sBattler];
  StartSpriteAnim(sprite, 1);
  const ballId = ItemIdToBallId(GetBattlerPokeballItemId(battlerId));
  AnimateBallOpenParticles(sprite.x, sprite.y - 5, 1, 28, ballId);
  sprite.data[0] = LaunchBallFadeMonTask(true, battlerId, 14, ballId);
  sprite.callback = HandleBallAnimEnd;
  const party = getBattlerSide(battlerId) !== K.B_SIDE_PLAYER ? g.enemyParty : g.playerParty;
  ui.playCry(party[g.battlerPartyIndexes[battlerId]]?.species ?? 0);
  const mon = gSprites[g.battlerSpriteIds[battlerId]];
  StartSpriteAffineAnim(mon, K.BATTLER_AFFINE_EMERGE);
  AnimateSprite(mon);
  mon.data[1] = 0x1000;
}

function HandleBallAnimEnd(sprite: Sprite): void {
  let affineAnimEnded = false;
  const battlerId = sprite.data[sBattler];
  const mon = gSprites[g.battlerSpriteIds[battlerId]];
  mon.invisible = false;
  if (sprite.animEnded) sprite.invisible = true;
  if (mon.affineAnimEnded) {
    StartSpriteAffineAnim(mon, K.BATTLER_AFFINE_NORMAL);
    affineAnimEnded = true;
  } else {
    mon.data[1] -= 288;
    mon.y2 = mon.data[1] >> 8;
  }
  if (sprite.animEnded && affineAnimEnded) {
    mon.y2 = 0;
    g.doingBattleAnim = false;
    sbd().healthBoxesData[battlerId].ballAnimActive = 0;
    FreeSpriteOamMatrix(sprite);
    DestroySprite(sprite);
    if (sbd().healthBoxesData.every((h) => !h.ballAnimActive)) for (let i = 0; i < BALL_NAMES.length; i++) FreeBallGfx(i);
  }
}

/** StartHealthboxSlideIn */
export function StartHealthboxSlideIn(battlerId: number): void {
  const box = gSprites[g.healthboxSpriteIds[battlerId]];
  box.data[0] = 5;
  box.data[1] = 0;
  box.x2 = 0x73;
  box.y2 = 0;
  box.callback = SpriteCB_HealthboxSlideIn;
  if (getBattlerSide(battlerId) !== K.B_SIDE_PLAYER) {
    box.data[0] = -box.data[0];
    box.data[1] = -box.data[1];
    box.x2 = -box.x2;
    box.y2 = -box.y2;
  }
  const bar = gSprites[box.data[5]];
  bar.callback(bar);
  if (getBattlerPosition(battlerId) === K.B_POSITION_PLAYER_RIGHT) box.callback = SpriteCB_HealthboxSlideInDelayed;
}

function SpriteCB_HealthboxSlideInDelayed(sprite: Sprite): void {
  sprite.data[1]++;
  if (sprite.data[1] === 20) {
    sprite.data[1] = 0;
    sprite.callback = SpriteCB_HealthboxSlideIn;
  }
}

function SpriteCB_HealthboxSlideIn(sprite: Sprite): void {
  sprite.x2 -= sprite.data[0];
  sprite.y2 -= sprite.data[1];
  if (sprite.x2 === 0 && sprite.y2 === 0) sprite.callback = SpriteCallbackDummy;
}

/** DoHitAnimHealthboxEffect */
export function DoHitAnimHealthboxEffect(battlerId: number): void {
  const spriteId = CreateInvisibleSprite(SpriteCB_HitAnimHealthoxEffect);
  gSprites[spriteId].data[0] = 1;
  gSprites[spriteId].data[1] = g.healthboxSpriteIds[battlerId];
}

function SpriteCB_HitAnimHealthoxEffect(sprite: Sprite): void {
  const box = gSprites[sprite.data[1]];
  box.y2 = sprite.data[0];
  sprite.data[0] = -sprite.data[0];
  sprite.data[2]++;
  if (sprite.data[2] === 21) {
    box.x2 = 0;
    box.y2 = 0;
    DestroySprite(sprite);
  }
}

// ------------------------------------------------------------------ battle_anim_special.c (ball open)

const sBallOpenFadeColors = [
  RGB(31, 22, 30),
  RGB(16, 23, 30),
  RGB(23, 30, 20),
  RGB(31, 31, 15),
  RGB(23, 20, 28),
  RGB(21, 31, 25),
  RGB(12, 25, 30),
  RGB(30, 27, 10),
  RGB(31, 24, 16),
  RGB(29, 30, 30),
  RGB(31, 17, 10),
  RGB(31, 9, 10),
];
/** sBallParticleAnimNums */
const sBallParticleAnimNums = [0, 0, 0, 5, 1, 2, 2, 3, 5, 5, 4, 4];
// TAG_PARTICLES_POKEBALL .. TAG_PARTICLES_PREMIERBALL (file-local #defines in battle_anim_special.c)
const TAG_PARTICLES = (ballId: number) => 55020 + ballId;

function particleTemplate(ballId: number): SpriteTemplate {
  return {
    tileTag: TAG_PARTICLES(ballId),
    paletteTag: TAG_PARTICLES(ballId),
    oam: oam({ shape: 0, size: 0 }), // gOamData_AffineOff_ObjNormal_8x8
    anims: animTable('battle_anim_special.c', 'sAnims_BallParticles'),
    images: null,
    affineAnims: gDummySpriteAffineAnimTable,
    callback: SpriteCallbackDummy,
  };
}

/** AnimateBallOpenParticles: every ball uses the Poké Ball burst here (other bursts not ported). */
export function AnimateBallOpenParticles(x: number, y: number, priority: number, subpriority: number, ballId: number): number {
  const tag = TAG_PARTICLES(ballId);
  if (GetSpriteTileStartByTag(tag) === TAG_NONE) {
    LoadCompressedSpriteSheet({ data: gfx('gBattleAnimSpriteGfx_Particles'), size: 0x100, tag });
    LoadCompressedSpritePalette({ data: gfx16('gBattleAnimSpritePal_CircleImpact'), tag });
  }
  const taskId = CreateTask(PokeBallOpenParticleAnimation, 5);
  const d = gTasks[taskId].data;
  d[1] = x;
  d[2] = y;
  d[3] = priority;
  d[4] = subpriority;
  d[15] = ballId;
  ui.playSE(K.SE_BALL_OPEN);
  return taskId;
}

const PokeBallOpenParticleAnimation: TaskFunc = (taskId) => {
  const d = gTasks[taskId].data;
  const ballId = d[15];
  if (d[0] < 16) {
    const spriteId = CreateSprite(particleTemplate(ballId), d[1], d[2], d[4]);
    if (spriteId !== MAX_SPRITES) {
      sbd().animationData.numBallParticles++;
      StartSpriteAnim(gSprites[spriteId], sBallParticleAnimNums[ballId]);
      gSprites[spriteId].callback = PokeBallOpenParticleAnimation_Step1;
      gSprites[spriteId].oam.priority = d[3];
      let var0 = d[0] & 0xff;
      if (var0 >= 8) var0 -= 8;
      gSprites[spriteId].data[0] = var0 * 32;
    }
    if (d[0] === 15) {
      DestroyTask(taskId);
      return;
    }
  }
  d[0]++;
};

function PokeBallOpenParticleAnimation_Step1(sprite: Sprite): void {
  if (sprite.data[1] === 0) sprite.callback = PokeBallOpenParticleAnimation_Step2;
  else sprite.data[1]--;
}

function PokeBallOpenParticleAnimation_Step2(sprite: Sprite): void {
  sprite.x2 = Sin(sprite.data[0], sprite.data[1]);
  sprite.y2 = Cos(sprite.data[0], sprite.data[1]);
  sprite.data[1] += 2;
  if (sprite.data[1] === 50) DestroyBallOpenAnimationParticle(sprite);
}

function DestroyBallOpenAnimationParticle(sprite: Sprite): void {
  sbd().animationData.numBallParticles--;
  if (sbd().animationData.numBallParticles === 0) {
    for (let j = 0; j < BALL_NAMES.length; j++) {
      FreeSpriteTilesByTag(TAG_PARTICLES(j));
      FreeSpritePaletteByTag(TAG_PARTICLES(j));
    }
  }
  DestroySprite(sprite);
}

/** LaunchBallFadeMonTask */
export function LaunchBallFadeMonTask(unfadeLater: boolean, battler: number, selectedPalettes: number, ballId: number): number {
  const taskId = CreateTask(Task_FadeMon_ToBallColor, 5);
  const d = gTasks[taskId].data;
  d[15] = ballId;
  d[3] = battler;
  d[10] = selectedPalettes & 0xffff;
  d[11] = selectedPalettes >>> 16;
  if (!unfadeLater) {
    BlendPalette(OBJ_PLTT_ID(battler), 16, 0, sBallOpenFadeColors[ballId]);
    d[1] = 1;
  } else {
    BlendPalette(OBJ_PLTT_ID(battler), 16, 16, sBallOpenFadeColors[ballId]);
    d[0] = 16;
    d[1] = -1;
    gTasks[taskId].func = Task_FadeMon_ToNormal;
  }
  BeginNormalPaletteFade(selectedPalettes, 0, 0, 16, RGB_WHITE);
  return taskId;
}

const selected = (d: Int16Array) => ((d[10] & 0xffff) | ((d[11] & 0xffff) << 16)) >>> 0;

const Task_FadeMon_ToBallColor: TaskFunc = (taskId) => {
  const d = gTasks[taskId].data;
  if (d[2] <= 16) {
    BlendPalette(OBJ_PLTT_ID(d[3]), 16, d[0], sBallOpenFadeColors[d[15]]);
    d[0] += d[1];
    d[2]++;
  } else if (!gPaletteFade.active) {
    BeginNormalPaletteFade(selected(d), 0, 16, 0, RGB_WHITE);
    DestroyTask(taskId);
  }
};

const Task_FadeMon_ToNormal: TaskFunc = (taskId) => {
  if (!gPaletteFade.active) {
    BeginNormalPaletteFade(selected(gTasks[taskId].data), 0, 16, 0, RGB_WHITE);
    gTasks[taskId].func = Task_FadeMon_ToNormal_Step;
  }
};

const Task_FadeMon_ToNormal_Step: TaskFunc = (taskId) => {
  const d = gTasks[taskId].data;
  if (d[2] <= 16) {
    BlendPalette(OBJ_PLTT_ID(d[3]), 16, d[0], sBallOpenFadeColors[d[15]]);
    d[0] += d[1];
    d[2]++;
  } else {
    DestroyTask(taskId);
  }
};

/** Graphics a battle needs besides per-mon/trainer pics. */
export function battleSpriteGfxSymbols(): string[] {
  return [
    'gBattleInterface_Gfx',
    'gBattleInterface_Healthbox_Pal',
    'gBattleInterface_Healthbar_Pal',
    'gHealthboxSinglesPlayerGfx',
    'gHealthboxSinglesOpponentGfx',
    'gHealthboxDoublesPlayerGfx',
    'gHealthboxDoublesOpponentGfx',
    'gHealthboxSafariGfx',
    'gBattleInterface_PartySummaryBar_Gfx',
    'gEnemyMonShadow_Gfx',
    'gInterfaceGfx_HPNumbers',
    'gSubstituteDollFrontGfx',
    'gSubstituteDollBackGfx',
    'gSubstituteDollPal',
    ...ballGfxSymbols(),
  ];
}
