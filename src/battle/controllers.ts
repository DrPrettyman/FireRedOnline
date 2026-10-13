// battle_controllers.c: the engine → controller command buffers. Each Emit writes the command into
// gBattleBufferA/B[gActiveBattler] exactly as PrepareBufferDataTransfer does for non-link battles.
// Payloads the GBA copies as raw structs (BattleMsgData, ChooseMoveStruct, HpAndStatus[6],
// DisableStruct, BattlePokemon) also ride along as objects in battleBufferAObj/BObj.

import { K } from './constants';
import { g, gBattleMoves } from './env';
import { bit } from './globals';
import type { ChooseMoveStruct, DisableStruct, HpAndStatus } from './structs';
import { weatherHasEffect2 } from './util';

/** struct BattleMsgData */
export interface BattleMsgData {
  currentMove: number;
  originallyUsedMove: number;
  lastItem: number;
  lastAbility: number;
  scrActive: number;
  bakScriptPartyIdx: number;
  hpScale: number;
  itemEffectBattler: number;
  moveType: number;
  abilities: number[];
  textBuffs: number[][];
}

function transfer(bufferId: number, bytes: number[], obj?: unknown): void {
  const isA = bufferId === K.BUFFER_A;
  const buf = isA ? g.battleBufferA[g.activeBattler] : g.battleBufferB[g.activeBattler];
  for (let i = 0; i < bytes.length; i++) buf[i] = bytes[i] & 0xff;
  if (isA) g.battleBufferAObj[g.activeBattler] = obj;
  else g.battleBufferBObj[g.activeBattler] = obj;
}

/** MarkBattlerForControllerExec */
export function markBattlerForControllerExec(battler: number): void {
  g.battleControllerExecFlags = (g.battleControllerExecFlags | bit(battler)) >>> 0;
}

export function emitGetMonData(bufferId: number, requestId: number, monToCheck: number): void {
  transfer(bufferId, [K.CONTROLLER_GETMONDATA, requestId, monToCheck, 0]);
}

/** BtlController_EmitSetMonData: `data` is the raw bytes (little-endian) or a struct for REQUEST_ALL_BATTLE. */
export function emitSetMonData(bufferId: number, requestId: number, monToCheck: number, data: number[], obj?: unknown): void {
  transfer(bufferId, [K.CONTROLLER_SETMONDATA, requestId, monToCheck, ...data], obj);
}

export function emitLoadMonSprite(bufferId: number): void {
  const c = K.CONTROLLER_LOADMONSPRITE;
  transfer(bufferId, [c, c, c, c]);
}

export function emitSwitchInAnim(bufferId: number, partyId: number, dontClearSubstituteBit: boolean | number): void {
  transfer(bufferId, [K.CONTROLLER_SWITCHINANIM, partyId, dontClearSubstituteBit ? 1 : 0, 5]);
}

export function emitReturnMonToBall(bufferId: number, skipAnim: boolean | number): void {
  transfer(bufferId, [K.CONTROLLER_RETURNMONTOBALL, skipAnim ? 1 : 0]);
}

export function emitDrawTrainerPic(bufferId: number): void {
  const c = K.CONTROLLER_DRAWTRAINERPIC;
  transfer(bufferId, [c, c, c, c]);
}

export function emitTrainerSlide(bufferId: number): void {
  const c = K.CONTROLLER_TRAINERSLIDE;
  transfer(bufferId, [c, c, c, c]);
}

export function emitTrainerSlideBack(bufferId: number): void {
  const c = K.CONTROLLER_TRAINERSLIDEBACK;
  transfer(bufferId, [c, c, c, c]);
}

export function emitFaintAnimation(bufferId: number): void {
  const c = K.CONTROLLER_FAINTANIMATION;
  transfer(bufferId, [c, c, c, c]);
}

export function emitBallThrowAnim(bufferId: number, caseId: number): void {
  transfer(bufferId, [K.CONTROLLER_BALLTHROWANIM, caseId]);
}

export function emitMoveAnimation(bufferId: number, move: number, turnOfMove: number, movePower: number, dmg: number, friendship: number, disableStruct: DisableStruct): void {
  const weather = weatherHasEffect2() ? g.battleWeather : 0;
  transfer(
    bufferId,
    [
      K.CONTROLLER_MOVEANIMATION,
      move, move >> 8,
      turnOfMove,
      movePower, movePower >> 8,
      dmg, dmg >> 8, dmg >> 16, dmg >>> 24,
      friendship,
      g.multiHitCounter,
      weather, weather >> 8,
      0, 0,
    ],
    { ...disableStruct },
  );
}

function battleMsgData(full: boolean): BattleMsgData {
  return {
    currentMove: g.currentMove,
    originallyUsedMove: g.chosenMove,
    lastItem: g.lastUsedItem,
    lastAbility: g.lastUsedAbility,
    scrActive: g.battleScripting.battler,
    bakScriptPartyIdx: g.battleStruct.scriptPartyIdx,
    hpScale: full ? g.battleStruct.hpScale : 0,
    itemEffectBattler: full ? g.potentialItemEffectBattler : 0,
    moveType: full ? gBattleMoves[g.currentMove].type : 0,
    abilities: g.battleMons.map((m) => m.ability),
    textBuffs: [[...g.battleTextBuff1], [...g.battleTextBuff2], [...g.battleTextBuff3]],
  };
}

export function emitPrintString(bufferId: number, stringId: number): void {
  transfer(bufferId, [K.CONTROLLER_PRINTSTRING, g.battleOutcome, stringId, stringId >> 8], battleMsgData(true));
}

export function emitPrintSelectionString(bufferId: number, stringId: number): void {
  const c = K.CONTROLLER_PRINTSTRINGPLAYERONLY;
  transfer(bufferId, [c, c, stringId, stringId >> 8], battleMsgData(false));
}

/** itemId only relevant for B_ACTION_USE_ITEM */
export function emitChooseAction(bufferId: number, action: number, itemId: number): void {
  transfer(bufferId, [K.CONTROLLER_CHOOSEACTION, action, itemId, itemId >> 8]);
}

export function emitChooseMove(bufferId: number, isDoubleBattle: boolean, noPpNumber: boolean, movePpData: ChooseMoveStruct): void {
  transfer(bufferId, [K.CONTROLLER_CHOOSEMOVE, isDoubleBattle ? 1 : 0, noPpNumber ? 1 : 0, 0], movePpData);
}

export function emitChooseItem(bufferId: number, battlePartyOrder: Uint8Array): void {
  transfer(bufferId, [K.CONTROLLER_OPENBAG, battlePartyOrder[0], battlePartyOrder[1], battlePartyOrder[2]]);
}

export function emitChoosePokemon(bufferId: number, caseId: number, slotId: number, abilityId: number, data: ArrayLike<number>): void {
  transfer(bufferId, [K.CONTROLLER_CHOOSEPOKEMON, caseId, slotId, abilityId, data[0], data[1], data[2], 0]);
}

export function emitHealthBarUpdate(bufferId: number, hpValue: number): void {
  transfer(bufferId, [K.CONTROLLER_HEALTHBARUPDATE, 0, hpValue, hpValue >> 8]);
}

export function emitExpUpdate(bufferId: number, partyId: number, expPoints: number): void {
  transfer(bufferId, [K.CONTROLLER_EXPUPDATE, partyId, expPoints, expPoints >> 8]);
}

export function emitStatusIconUpdate(bufferId: number, status1: number, status2: number): void {
  transfer(bufferId, [K.CONTROLLER_STATUSICONUPDATE, ...u32(status1), ...u32(status2)]);
}

export function emitStatusAnimation(bufferId: number, status2: boolean | number, status: number): void {
  transfer(bufferId, [K.CONTROLLER_STATUSANIMATION, status2 ? 1 : 0, ...u32(status)]);
}

/** BtlController_EmitDataTransfer: `obj` carries the struct the bytes would hold (e.g. BattlePokemon). */
export function emitDataTransfer(bufferId: number, data: number[], obj?: unknown): void {
  const c = K.CONTROLLER_DATATRANSFER;
  transfer(bufferId, [c, c, data.length, data.length >> 8, ...data], obj);
}

export function emitTwoReturnValues(bufferId: number, ret8: number, ret16: number): void {
  transfer(bufferId, [K.CONTROLLER_TWORETURNVALUES, ret8, ret16, ret16 >> 8]);
}

export function emitChosenMonReturnValue(bufferId: number, partyId: number, battlePartyOrder: ArrayLike<number>): void {
  transfer(bufferId, [K.CONTROLLER_CHOSENMONRETURNVALUE, partyId, battlePartyOrder[0], battlePartyOrder[1], battlePartyOrder[2]]);
}

export function emitOneReturnValue(bufferId: number, ret: number): void {
  transfer(bufferId, [K.CONTROLLER_ONERETURNVALUE, ret, ret >> 8, 0]);
}

export function emitOneReturnValue_Duplicate(bufferId: number, ret: number): void {
  transfer(bufferId, [K.CONTROLLER_ONERETURNVALUE_DUPLICATE, ret, ret >> 8, 0]);
}

export function emitHitAnimation(bufferId: number): void {
  const c = K.CONTROLLER_HITANIMATION;
  transfer(bufferId, [c, c, c, c]);
}

export function emitCantSwitch(bufferId: number): void {
  const c = K.CONTROLLER_CANTSWITCH;
  transfer(bufferId, [c, c, c, c]);
}

export function emitPlaySE(bufferId: number, songId: number): void {
  transfer(bufferId, [K.CONTROLLER_PLAYSE, songId, songId >> 8, 0]);
}

export function emitPlayFanfare(bufferId: number, songId: number): void {
  transfer(bufferId, [K.CONTROLLER_PLAYFANFARE, songId, songId >> 8, 0]);
}

export function emitFaintingCry(bufferId: number): void {
  const c = K.CONTROLLER_FAINTINGCRY;
  transfer(bufferId, [c, c, c, c]);
}

export function emitIntroSlide(bufferId: number, terrainId: number): void {
  transfer(bufferId, [K.CONTROLLER_INTROSLIDE, terrainId]);
}

export function emitIntroTrainerBallThrow(bufferId: number): void {
  const c = K.CONTROLLER_INTROTRAINERBALLTHROW;
  transfer(bufferId, [c, c, c, c]);
}

export function emitDrawPartyStatusSummary(bufferId: number, hpAndStatus: HpAndStatus[], flags: number): void {
  const skip = K.PARTY_SUMM_SKIP_DRAW_DELAY;
  const c = K.CONTROLLER_DRAWPARTYSTATUSSUMMARY;
  transfer(bufferId, [c, flags & ~skip, (flags & skip) >> 7, c], hpAndStatus.map((h) => ({ ...h })));
}

export function emitHidePartyStatusSummary(bufferId: number): void {
  const c = K.CONTROLLER_HIDEPARTYSTATUSSUMMARY;
  transfer(bufferId, [c, c, c, c]);
}

export function emitEndBounceEffect(bufferId: number): void {
  const c = K.CONTROLLER_ENDBOUNCE;
  transfer(bufferId, [c, c, c, c]);
}

export function emitSpriteInvisibility(bufferId: number, isInvisible: boolean | number): void {
  const c = K.CONTROLLER_SPRITEINVISIBILITY;
  transfer(bufferId, [c, isInvisible ? 1 : 0, c, c]);
}

export function emitBattleAnimation(bufferId: number, animationId: number, argument: number): void {
  transfer(bufferId, [K.CONTROLLER_BATTLEANIMATION, animationId, argument, argument >> 8]);
}

/** mode is a LINK_STANDBY_* constant */
export function emitLinkStandbyMsg(bufferId: number, mode: number): void {
  transfer(bufferId, [K.CONTROLLER_LINKSTANDBYMSG, mode]);
}

export function emitResetActionMoveSelection(bufferId: number, caseId: number): void {
  transfer(bufferId, [K.CONTROLLER_RESETACTIONMOVESELECTION, caseId]);
}

export function emitEndLinkBattle(bufferId: number, battleOutcome: number): void {
  transfer(bufferId, [K.CONTROLLER_ENDLINKBATTLE, battleOutcome]);
}

export function u16(v: number): number[] {
  return [v & 0xff, (v >> 8) & 0xff];
}

export function u32(v: number): number[] {
  return [v & 0xff, (v >> 8) & 0xff, (v >> 16) & 0xff, (v >>> 24) & 0xff];
}
