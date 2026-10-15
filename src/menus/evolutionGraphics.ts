// evolution_graphics.c: the sparkle sprites and the pre/post-evolution sprite cycling that the
// evolution scene drives. The trade variant (EvolutionSparkles_SprayAndFlash_Trade) isn't ported:
// there's no trading.

import { Cos, Sin } from '../battle/trig';
import { gfx, gfx16 } from '../gba/gfx';
import { RGB_WHITE } from '../gba/hw';
import { BeginNormalPaletteFade, BG_PLTT_ID, gPaletteFade, gPlttBufferFaded, gPlttBufferUnfaded, OBJ_PLTT_ID, PLTT_SIZE_4BPP } from '../gba/palette';
import { PlaySE } from '../gba/sound';
import {
  ANIMCMD_END,
  ANIMCMD_FRAME,
  CreateSprite,
  DestroySprite,
  gDummySpriteAffineAnimTable,
  gSprites,
  LoadCompressedSpriteSheet,
  LoadSpritePalette,
  MAX_SPRITES,
  oam,
  SetOamMatrix,
  ST_OAM_AFFINE_NORMAL,
  ST_OAM_AFFINE_OFF,
  type Sprite,
  type SpriteTemplate,
} from '../gba/sprite';
import { CreateTask, DestroyTask, gTasks } from '../gba/task';
import { K } from '../battle/constants';
import { random } from '../util/random';
import { IsMovingBackgroundTaskRunning } from './evolutionScene';

/** The C symbols this file loads (for preloading). */
export const EVOLUTION_SPARKLE_GFX = ['sEvolutionSparklesPalData', 'sEvolutionSparklesTileData'];

const TAG_EVO_SPARKLES = 1001;

/** EvoGraphicsTaskEvoStop (evolution_graphics.h) */
export const EVO_GRAPHICS_TASK_EVO_STOP = 8;

const SpriteCallbackDummy_EvoSparkles = (_sprite: Sprite): void => {};

const sSpriteTemplate_EvolutionSparkles = (): SpriteTemplate => ({
  tileTag: TAG_EVO_SPARKLES,
  paletteTag: TAG_EVO_SPARKLES,
  oam: oam({ y: 160, priority: 1 }),
  anims: [[ANIMCMD_FRAME(0, 8), ANIMCMD_END]],
  images: null,
  affineAnims: gDummySpriteAffineAnimTable,
  callback: SpriteCallbackDummy_EvoSparkles,
});

const sEvolutionSparkleMatrixScales = [0x3c0, 0x380, 0x340, 0x300, 0x2c0, 0x280, 0x240, 0x200, 0x1c0, 0x180, 0x140, 0x100];

function SetEvoSparklesMatrices(): void {
  for (let i = 0; i < sEvolutionSparkleMatrixScales.length; i++) SetOamMatrix(i + 20, sEvolutionSparkleMatrixScales[i], 0, 0, sEvolutionSparkleMatrixScales[i]);
}

function SpriteCB_PreEvoSparkleSet1(sprite: Sprite): void {
  if (sprite.y > 8) {
    sprite.y = 88 - Math.trunc((sprite.data[7] * sprite.data[7]) / 80);
    sprite.y2 = Math.trunc(Sin(sprite.data[6] & 0xff, sprite.data[5]) / 4);
    sprite.x2 = Cos(sprite.data[6] & 0xff, sprite.data[5]);
    sprite.data[6] += 4;
    if (sprite.data[7] & 1) sprite.data[5]--;
    sprite.data[7]++;
    if (sprite.y2 > 0) sprite.subpriority = 1;
    else sprite.subpriority = 20;
    let mnum = (Math.trunc(sprite.data[5] / 4) + 20) & 0xff;
    if (mnum > 31) mnum = 31;
    sprite.oam.matrixNum = mnum;
  } else {
    DestroySprite(sprite);
  }
}

function CreatePreEvoSparkleSet1(a0: number): void {
  const spriteId = CreateSprite(sSpriteTemplate_EvolutionSparkles(), 120, 88, 0);
  if (spriteId !== MAX_SPRITES) {
    const s = gSprites[spriteId];
    s.data[5] = 48;
    s.data[6] = a0 & 0xff;
    s.data[7] = 0;
    s.oam.affineMode = ST_OAM_AFFINE_NORMAL;
    s.oam.matrixNum = 31;
    s.callback = SpriteCB_PreEvoSparkleSet1;
  }
}

function SpriteCB_PreEvoSparkleSet2(sprite: Sprite): void {
  if (sprite.y < 88) {
    sprite.y = 8 + Math.trunc((sprite.data[7] * sprite.data[7]) / 5);
    sprite.y2 = Math.trunc(Sin(sprite.data[6] & 0xff, sprite.data[5]) / 4);
    sprite.x2 = Cos(sprite.data[6] & 0xff, sprite.data[5]);
    sprite.data[5] = Sin((sprite.data[7] * 4) & 0xff, 40) + 8;
    sprite.data[7]++;
  } else {
    DestroySprite(sprite);
  }
}

function CreatePreEvoSparkleSet2(a0: number): void {
  const spriteId = CreateSprite(sSpriteTemplate_EvolutionSparkles(), 120, 8, 0);
  if (spriteId !== MAX_SPRITES) {
    const s = gSprites[spriteId];
    s.data[5] = 8;
    s.data[6] = a0 & 0xff;
    s.data[7] = 0;
    s.oam.affineMode = ST_OAM_AFFINE_NORMAL;
    s.oam.matrixNum = 25;
    s.subpriority = 1;
    s.callback = SpriteCB_PreEvoSparkleSet2;
  }
}

function SpriteCB_PostEvoSparkleSet1(sprite: Sprite): void {
  if (sprite.data[5] > 8) {
    sprite.y2 = Sin(sprite.data[6] & 0xff, sprite.data[5]);
    sprite.x2 = Cos(sprite.data[6] & 0xff, sprite.data[5]);
    sprite.data[5] -= sprite.data[3];
    sprite.data[6] += 4;
  } else {
    DestroySprite(sprite);
  }
}

function CreatePostEvoSparkleSet1(a0: number, a1: number): void {
  const spriteId = CreateSprite(sSpriteTemplate_EvolutionSparkles(), 120, 56, 0);
  if (spriteId !== MAX_SPRITES) {
    const s = gSprites[spriteId];
    s.data[3] = a1 & 0xff;
    s.data[5] = 120;
    s.data[6] = a0 & 0xff;
    s.data[7] = 0;
    s.oam.affineMode = ST_OAM_AFFINE_NORMAL;
    s.oam.matrixNum = 31;
    s.subpriority = 1;
    s.callback = SpriteCB_PostEvoSparkleSet1;
  }
}

function SpriteCB_PostEvoSparkleSet2(sprite: Sprite): void {
  if ((sprite.data[7] & 3) === 0) sprite.y++;
  if (sprite.data[6] < 128) {
    sprite.y2 = -Sin(sprite.data[6] & 0xff, sprite.data[5]);
    sprite.x = 120 + Math.trunc((sprite.data[3] * sprite.data[7]) / 3);
    sprite.data[6]++;
    let mnum = (31 - Math.trunc((sprite.data[6] * 12) / 128)) & 0xff;
    if (sprite.data[6] > 64) {
      sprite.subpriority = 1;
    } else {
      sprite.invisible = false;
      sprite.subpriority = 20;
      if (sprite.data[6] > 112 && sprite.data[6] & 1) sprite.invisible = true;
    }
    if (mnum < 20) mnum = 20;
    sprite.oam.matrixNum = mnum;
    sprite.data[7]++;
  } else {
    DestroySprite(sprite);
  }
}

function CreatePostEvoSparkleSet2(_unused: number): void {
  const spriteId = CreateSprite(sSpriteTemplate_EvolutionSparkles(), 120, 56, 0);
  if (spriteId !== MAX_SPRITES) {
    const s = gSprites[spriteId];
    s.data[3] = 3 - (random() % 7);
    s.data[5] = 48 + (random() & 63);
    s.data[7] = 0;
    s.oam.affineMode = ST_OAM_AFFINE_NORMAL;
    s.oam.matrixNum = 31;
    s.subpriority = 20;
    s.callback = SpriteCB_PostEvoSparkleSet2;
  }
}

/** LoadEvoSparkleSpriteAndPal */
export function LoadEvoSparkleSpriteAndPal(): void {
  LoadCompressedSpriteSheet({ data: gfx('sEvolutionSparklesTileData'), size: 0x20, tag: TAG_EVO_SPARKLES });
  LoadSpritePalette({ data: gfx16('sEvolutionSparklesPalData'), tag: TAG_EVO_SPARKLES });
}

/** EvolutionSparkles_SpiralUpward */
export function EvolutionSparkles_SpiralUpward(a0: number): number {
  const taskId = CreateTask(EvoTask_PreEvoSparkleSet1Init, 0);
  gTasks[taskId].data[1] = a0;
  return taskId;
}

function EvoTask_PreEvoSparkleSet1Init(taskId: number): void {
  SetEvoSparklesMatrices();
  gTasks[taskId].data[15] = 0;
  BeginNormalPaletteFade((3 << gTasks[taskId].data[1]) >>> 0, 10, 0, 16, RGB_WHITE);
  gTasks[taskId].func = EvoTask_CreatePreEvoSparkleSet1;
  PlaySE(K.SE_M_MEGA_KICK);
}

function EvoTask_CreatePreEvoSparkleSet1(taskId: number): void {
  const t = gTasks[taskId];
  if (t.data[15] < 64) {
    if ((t.data[15] & 7) === 0) {
      for (let i = 0; i < 4; i++) CreatePreEvoSparkleSet1(2 * (t.data[15] & 0x78) + 64 * i);
    }
    t.data[15]++;
  } else {
    t.data[15] = 96;
    t.func = EvoTask_WaitForPre1SparklesToGoUp;
  }
}

function EvoTask_WaitForPre1SparklesToGoUp(taskId: number): void {
  if (gTasks[taskId].data[15] !== 0) gTasks[taskId].data[15]--;
  else DestroyTask(taskId);
}

/** EvolutionSparkles_ArcDown */
export function EvolutionSparkles_ArcDown(): number {
  return CreateTask(EvoTask_PreEvoSparkleSet2Init, 0);
}

function EvoTask_PreEvoSparkleSet2Init(taskId: number): void {
  SetEvoSparklesMatrices();
  gTasks[taskId].data[15] = 0;
  gTasks[taskId].func = EvoTask_CreatePreEvoSparklesSet2;
  PlaySE(K.SE_M_BUBBLE_BEAM2);
}

function EvoTask_CreatePreEvoSparklesSet2(taskId: number): void {
  const t = gTasks[taskId];
  if (t.data[15] < 96) {
    if (t.data[15] < 6) {
      for (let i = 0; i < 9; i++) CreatePreEvoSparkleSet2(16 * i);
    }
    t.data[15]++;
  } else {
    t.func = EvoTask_PreEvoSparkleSet2Teardown;
  }
}

function EvoTask_PreEvoSparkleSet2Teardown(taskId: number): void {
  DestroyTask(taskId);
}

/** EvolutionSparkles_CircleInward */
export function EvolutionSparkles_CircleInward(): number {
  return CreateTask(EvoTask_PostEvoSparklesSet1Init, 0);
}

function EvoTask_PostEvoSparklesSet1Init(taskId: number): void {
  SetEvoSparklesMatrices();
  gTasks[taskId].data[15] = 0;
  gTasks[taskId].func = EvoTask_CreatePostEvoSparklesSet1;
  PlaySE(K.SE_SHINY);
}

function EvoTask_CreatePostEvoSparklesSet1(taskId: number): void {
  const t = gTasks[taskId];
  if (t.data[15] < 48) {
    if (t.data[15] === 0) {
      for (let i = 0; i < 16; i++) CreatePostEvoSparkleSet1(i * 16, 4);
    }
    if (t.data[15] === 32) {
      for (let i = 0; i < 16; i++) CreatePostEvoSparkleSet1(i * 16, 8);
    }
    t.data[15]++;
  } else {
    t.func = EvoTask_PostEvoSparklesSet1Teardown;
  }
}

function EvoTask_PostEvoSparklesSet1Teardown(taskId: number): void {
  DestroyTask(taskId);
}

/** EvolutionSparkles_SprayAndFlash */
export function EvolutionSparkles_SprayAndFlash(species: number): number {
  const taskId = CreateTask(EvoTask_PostEvoSparklesSet2Init, 0);
  gTasks[taskId].data[2] = species;
  return taskId;
}

function EvoTask_PostEvoSparklesSet2Init(taskId: number): void {
  SetEvoSparklesMatrices();
  gTasks[taskId].data[15] = 0;
  IsMovingBackgroundTaskRunning();
  gPlttBufferUnfaded.set(gPlttBufferFaded.subarray(BG_PLTT_ID(2), BG_PLTT_ID(2) + (3 * PLTT_SIZE_4BPP) / 2), BG_PLTT_ID(2));
  BeginNormalPaletteFade(0xfff90f1c, 0, 0, 16, RGB_WHITE);
  gTasks[taskId].func = EvoTask_CreatePostEvoSparklesSet2;
  PlaySE(K.SE_M_PETAL_DANCE);
}

function EvoTask_CreatePostEvoSparklesSet2(taskId: number): void {
  const t = gTasks[taskId];
  if (t.data[15] < 128) {
    switch (t.data[15]) {
      default:
        if (t.data[15] < 50) CreatePostEvoSparkleSet2(random() & 7);
        break;
      case 0:
        for (let i = 0; i < 8; i++) CreatePostEvoSparkleSet2(i);
        break;
      case 32:
        BeginNormalPaletteFade(0xffff0f1c, 16, 16, 0, RGB_WHITE);
        break;
    }
    t.data[15]++;
  } else {
    t.func = EvoTask_PostEvoSparklesSet2Teardown;
  }
}

function EvoTask_PostEvoSparklesSet2Teardown(taskId: number): void {
  if (!gPaletteFade.active) DestroyTask(taskId);
}

const SpriteCallbackDummy_MonSprites = (_sprite: Sprite): void => {};

// Task data for CycleEvolutionMonSprite
const tPreEvoSpriteId = 1;
const tPostEvoSpriteId = 2;
const tPreEvoScale = 3;
const tPostEvoScale = 4;
const tDirection = 5;
const tSpeed = 6;

/** CycleEvolutionMonSprite */
export function CycleEvolutionMonSprite(preEvoSpriteId: number, postEvoSpriteId: number): number {
  const palette = new Uint16Array(16).fill(RGB_WHITE);
  const taskId = CreateTask(EvoTask_PrePostEvoMonSpritesInit, 0);
  const d = gTasks[taskId].data;
  d[tPreEvoSpriteId] = preEvoSpriteId;
  d[tPostEvoSpriteId] = postEvoSpriteId;
  d[tPreEvoScale] = 256;
  d[tPostEvoScale] = 16;
  SetOamMatrix(30, Math.trunc(0x10000 / d[tPreEvoScale]), 0, 0, Math.trunc(0x10000 / d[tPreEvoScale]));
  SetOamMatrix(31, Math.trunc(0x10000 / d[tPostEvoScale]), 0, 0, Math.trunc(0x10000 / d[tPostEvoScale]));
  const pre = gSprites[preEvoSpriteId];
  pre.callback = SpriteCallbackDummy_MonSprites;
  pre.oam.affineMode = ST_OAM_AFFINE_NORMAL;
  pre.oam.matrixNum = 30;
  pre.invisible = false;
  gPlttBufferFaded.set(palette, OBJ_PLTT_ID(pre.oam.paletteNum));
  const post = gSprites[postEvoSpriteId];
  post.callback = SpriteCallbackDummy_MonSprites;
  post.oam.affineMode = ST_OAM_AFFINE_NORMAL;
  post.oam.matrixNum = 31;
  post.invisible = false;
  gPlttBufferFaded.set(palette, OBJ_PLTT_ID(post.oam.paletteNum));
  d[EVO_GRAPHICS_TASK_EVO_STOP] = 0;
  return taskId;
}

function EvoTask_PrePostEvoMonSpritesInit(taskId: number): void {
  gTasks[taskId].data[tDirection] = 0;
  gTasks[taskId].data[tSpeed] = 8;
  gTasks[taskId].func = EvoTask_ChooseNextEvoSpriteAnim;
}

function EvoTask_ChooseNextEvoSpriteAnim(taskId: number): void {
  const t = gTasks[taskId];
  if (t.data[EVO_GRAPHICS_TASK_EVO_STOP]) {
    PreEvoVisible_PostEvoInvisible_KillTask(taskId);
  } else if (t.data[tSpeed] === 128) {
    PreEvoInvisible_PostEvoVisible_KillTask(taskId);
  } else {
    t.data[tSpeed] += 2;
    t.data[tDirection] ^= 1;
    t.func = EvoTask_ShrinkOrExpandEvoSprites;
  }
}

function EvoTask_ShrinkOrExpandEvoSprites(taskId: number): void {
  const t = gTasks[taskId];
  const d = t.data;
  if (d[EVO_GRAPHICS_TASK_EVO_STOP]) {
    t.func = PreEvoVisible_PostEvoInvisible_KillTask;
    return;
  }
  let r6 = 0;
  if (!d[tDirection]) {
    if (d[tPreEvoScale] < 0x100 - d[tSpeed]) {
      d[tPreEvoScale] += d[tSpeed];
    } else {
      d[tPreEvoScale] = 0x100;
      r6 = 1;
    }
    if (d[tPostEvoScale] > 0x10 + d[tSpeed]) {
      d[tPostEvoScale] -= d[tSpeed];
    } else {
      d[tPostEvoScale] = 0x10;
      r6++;
    }
  } else {
    if (d[tPostEvoScale] < 0x100 - d[tSpeed]) {
      d[tPostEvoScale] += d[tSpeed];
    } else {
      d[tPostEvoScale] = 0x100;
      r6 = 1;
    }
    if (d[tPreEvoScale] > 0x10 + d[tSpeed]) {
      d[tPreEvoScale] -= d[tSpeed];
    } else {
      d[tPreEvoScale] = 0x10;
      r6++;
    }
  }
  SetOamMatrix(30, Math.trunc(0x10000 / d[tPreEvoScale]), 0, 0, Math.trunc(0x10000 / d[tPreEvoScale]));
  SetOamMatrix(31, Math.trunc(0x10000 / d[tPostEvoScale]), 0, 0, Math.trunc(0x10000 / d[tPostEvoScale]));
  if (r6 === 2) t.func = EvoTask_ChooseNextEvoSpriteAnim;
}

function PreEvoInvisible_PostEvoVisible_KillTask(taskId: number): void {
  const pre = gSprites[gTasks[taskId].data[tPreEvoSpriteId]];
  const post = gSprites[gTasks[taskId].data[tPostEvoSpriteId]];
  pre.oam.affineMode = ST_OAM_AFFINE_OFF;
  pre.oam.matrixNum = 0;
  pre.invisible = true;
  post.oam.affineMode = ST_OAM_AFFINE_OFF;
  post.oam.matrixNum = 0;
  post.invisible = false;
  DestroyTask(taskId);
}

function PreEvoVisible_PostEvoInvisible_KillTask(taskId: number): void {
  const pre = gSprites[gTasks[taskId].data[tPreEvoSpriteId]];
  const post = gSprites[gTasks[taskId].data[tPostEvoSpriteId]];
  pre.oam.affineMode = ST_OAM_AFFINE_OFF;
  pre.oam.matrixNum = 0;
  pre.invisible = false;
  post.oam.affineMode = ST_OAM_AFFINE_OFF;
  post.oam.matrixNum = 0;
  post.invisible = true;
  DestroyTask(taskId);
}
