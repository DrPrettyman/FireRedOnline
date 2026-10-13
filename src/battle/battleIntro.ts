// battle_intro.c: the terrain slide-in at the start of a battle (BattleIntroSlide1/2/3). The link
// VS slide isn't supported.

import { BG_ATTR_CHARBASEINDEX, BG_SCREEN_ADDR, SetBgAttribute } from '../gba/bg';
import {
  BLDALPHA_BLEND,
  BLDCNT_EFFECT_BLEND,
  BLDCNT_TGT1_BG1,
  BLDCNT_TGT2_BG3,
  BLDCNT_TGT2_OBJ,
  REG_OFFSET_BG1CNT,
  REG_OFFSET_BG2CNT,
  REG_OFFSET_BLDALPHA,
  REG_OFFSET_BLDCNT,
  REG_OFFSET_BLDY,
  REG_OFFSET_WININ,
  REG_OFFSET_WINOUT,
  SetGpuReg,
  vram,
  WININ_WIN0_BG_ALL,
  WININ_WIN0_CLR,
  WININ_WIN0_OBJ,
  WININ_WIN1_BG_ALL,
  WININ_WIN1_CLR,
  WININ_WIN1_OBJ,
  WINOUT_WIN01_BG_ALL,
  WINOUT_WIN01_CLR,
  WINOUT_WIN01_OBJ,
} from '../gba/hw';
import { gScanlineEffect, gScanlineEffectRegBuffers } from '../gba/scanline';
import { CreateTask, DestroyTask, gTasks, type TaskFunc } from '../gba/task';
import { K } from './constants';
import { g } from './env';
import { Cos2 } from './trig';

const BGCNT_PRIORITY = (n: number) => n;
const BGCNT_CHARBASE = (n: number) => n << 2;
const BGCNT_16COLOR = 0;
const BGCNT_SCREENBASE = (n: number) => n << 8;
const BGCNT_TXT256x512 = 0x8000;
const BGCNT_TXT512x256 = 0x4000;
const WINOUT_WINOBJ_BG_ALL = 0xf00;
const WINOUT_WINOBJ_OBJ = 0x1000;
const WINOUT_WINOBJ_CLR = 0x2000;
const BG_SCREEN_SIZE = 0x800;

/** HandleIntroSlide */
export function HandleIntroSlide(terrain: number): void {
  let taskId: number;
  if (g.battleTypeFlags & K.BATTLE_TYPE_LINK) {
    console.warn('[battle] link intro slide not supported');
    taskId = CreateTask(BattleIntroSlide3, 0);
  } else if (g.battleTypeFlags & K.BATTLE_TYPE_KYOGRE_GROUDON) {
    terrain = K.BATTLE_TERRAIN_UNDERWATER;
    taskId = CreateTask(BattleIntroSlide2, 0);
  } else {
    // sBattleIntroSlideFuncs
    const funcs = [BattleIntroSlide1, BattleIntroSlide1, BattleIntroSlide2, BattleIntroSlide2, BattleIntroSlide2, BattleIntroSlide1, BattleIntroSlide1, BattleIntroSlide1, BattleIntroSlide3, BattleIntroSlide3];
    taskId = CreateTask(funcs[terrain] ?? BattleIntroSlide3, 0);
  }
  const d = gTasks[taskId].data;
  d[0] = 0;
  d[1] = terrain;
  d[2] = d[3] = d[4] = d[5] = d[6] = 0;
}

/** BattleIntroSlideEnd */
function BattleIntroSlideEnd(taskId: number): void {
  DestroyTask(taskId);
  g.battle_BG1_X = 0;
  g.battle_BG1_Y = 0;
  g.battle_BG2_X = 0;
  g.battle_BG2_Y = 0;
  SetGpuReg(REG_OFFSET_BLDCNT, 0);
  SetGpuReg(REG_OFFSET_BLDALPHA, 0);
  SetGpuReg(REG_OFFSET_BLDY, 0);
  SetGpuReg(REG_OFFSET_WININ, WININ_WIN0_BG_ALL | WININ_WIN0_OBJ | WININ_WIN0_CLR | WININ_WIN1_BG_ALL | WININ_WIN1_OBJ | WININ_WIN1_CLR);
  SetGpuReg(REG_OFFSET_WINOUT, WINOUT_WIN01_BG_ALL | WINOUT_WIN01_OBJ | WINOUT_WIN01_CLR | WINOUT_WINOBJ_BG_ALL | WINOUT_WINOBJ_OBJ | WINOUT_WINOBJ_CLR);
}

/** Cases 1 and 2, shared by every slide. Returns true when case 2 just finished (extra setup by caller). */
function slideOpenWindow(taskId: number): boolean {
  const d = gTasks[taskId].data;
  switch (d[0]) {
    case 1:
      if (--d[2] === 0) {
        ++d[0];
        SetGpuReg(REG_OFFSET_WININ, WININ_WIN0_BG_ALL | WININ_WIN0_OBJ | WININ_WIN0_CLR);
      }
      break;
    case 2:
      g.battle_WIN0V -= 0xff;
      if ((g.battle_WIN0V & 0xff00) === 0x3000) {
        ++d[0];
        d[2] = 240;
        d[3] = 32;
        g.introSlideFlags &= ~1;
        return true;
      }
      break;
  }
  return false;
}

/** The scanline/window part of case 3, shared by every slide. */
function slideTerrainIn(taskId: number): void {
  const d = gTasks[taskId].data;
  if (g.battle_WIN0V & 0xff00) g.battle_WIN0V -= 0x3fc;
  if (d[2]) d[2] -= 2;
  // Scanline settings have already been set in CB2_InitBattleInternal
  const buf = gScanlineEffectRegBuffers[gScanlineEffect.srcBuffer];
  let i = 0;
  for (; i < 80; ++i) buf[i] = d[2];
  while (i < 160) buf[i++] = -d[2];
  if (!d[2]) {
    gScanlineEffect.state = 3;
    ++d[0];
    vram.fill(0, BG_SCREEN_ADDR(28), BG_SCREEN_ADDR(28) + BG_SCREEN_SIZE);
    SetBgAttribute(1, BG_ATTR_CHARBASEINDEX, 0);
    SetBgAttribute(2, BG_ATTR_CHARBASEINDEX, 0);
    SetGpuReg(REG_OFFSET_BG1CNT, BGCNT_PRIORITY(0) | BGCNT_CHARBASE(0) | BGCNT_16COLOR | BGCNT_SCREENBASE(28) | BGCNT_TXT256x512);
    SetGpuReg(REG_OFFSET_BG2CNT, BGCNT_PRIORITY(0) | BGCNT_CHARBASE(0) | BGCNT_16COLOR | BGCNT_SCREENBASE(30) | BGCNT_TXT512x256);
  }
}

const BattleIntroSlide1: TaskFunc = (taskId) => {
  const d = gTasks[taskId].data;
  g.battle_BG1_X += 6;
  switch (d[0]) {
    case 0:
      d[2] = g.battleTypeFlags & K.BATTLE_TYPE_LINK ? 16 : 1;
      ++d[0];
      break;
    case 1:
    case 2:
      slideOpenWindow(taskId);
      break;
    case 3:
      if (d[3]) {
        --d[3];
      } else if (d[1] === 1) {
        if (g.battle_BG1_Y !== 0xffb0) g.battle_BG1_Y -= 2;
      } else if (g.battle_BG1_Y !== 0xffc8) {
        g.battle_BG1_Y -= 1;
      }
      slideTerrainIn(taskId);
      break;
    case 4:
      BattleIntroSlideEnd(taskId);
      break;
  }
};

const BattleIntroSlide2: TaskFunc = (taskId) => {
  const d = gTasks[taskId].data;
  switch (d[1]) {
    case 2:
    case 4:
      g.battle_BG1_X += 8;
      break;
    case 3:
      g.battle_BG1_X += 6;
      break;
  }
  if (d[1] === 4) {
    g.battle_BG1_Y = Math.trunc(Cos2(d[6]) / 512) - 8;
    if (d[6] < 180) d[6] += 4;
    else d[6] += 6;
    if (d[6] === 360) d[6] = 0;
  }
  switch (d[0]) {
    case 0:
      d[4] = 16;
      d[2] = g.battleTypeFlags & K.BATTLE_TYPE_LINK ? 16 : 1;
      ++d[0];
      break;
    case 1:
    case 2:
      if (slideOpenWindow(taskId)) d[5] = 1;
      break;
    case 3:
      if (d[3]) {
        if (--d[3] === 0) {
          SetGpuReg(REG_OFFSET_BLDCNT, BLDCNT_TGT1_BG1 | BLDCNT_EFFECT_BLEND | BLDCNT_TGT2_BG3 | BLDCNT_TGT2_OBJ);
          SetGpuReg(REG_OFFSET_BLDALPHA, BLDALPHA_BLEND(15, 0));
          SetGpuReg(REG_OFFSET_BLDY, 0);
        }
      } else if (d[4] & 0x1f && --d[5] === 0) {
        d[4] += 0xff;
        d[5] = 4;
      }
      slideTerrainIn(taskId);
      break;
    case 4:
      BattleIntroSlideEnd(taskId);
      break;
  }
  if (d[0] !== 4) SetGpuReg(REG_OFFSET_BLDALPHA, BLDALPHA_BLEND(d[4], 0));
};

const BattleIntroSlide3: TaskFunc = (taskId) => {
  const d = gTasks[taskId].data;
  g.battle_BG1_X += 8;
  switch (d[0]) {
    case 0:
      SetGpuReg(REG_OFFSET_BLDCNT, BLDCNT_TGT1_BG1 | BLDCNT_EFFECT_BLEND | BLDCNT_TGT2_BG3 | BLDCNT_TGT2_OBJ);
      SetGpuReg(REG_OFFSET_BLDALPHA, BLDALPHA_BLEND(8, 8));
      SetGpuReg(REG_OFFSET_BLDY, 0);
      d[4] = BLDALPHA_BLEND(8, 8);
      d[2] = g.battleTypeFlags & K.BATTLE_TYPE_LINK ? 16 : 1;
      ++d[0];
      break;
    case 1:
    case 2:
      if (slideOpenWindow(taskId)) d[5] = 1;
      break;
    case 3:
      if (d[3]) {
        --d[3];
      } else if (d[4] & 0xf && --d[5] === 0) {
        d[4] += 0xff;
        d[5] = 6;
      }
      slideTerrainIn(taskId);
      break;
    case 4:
      BattleIntroSlideEnd(taskId);
      break;
  }
  if (d[0] !== 4) SetGpuReg(REG_OFFSET_BLDALPHA, BLDALPHA_BLEND(d[4], 0));
};
