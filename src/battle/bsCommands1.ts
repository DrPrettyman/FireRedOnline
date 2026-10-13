// battle_script_commands.c, part 1: Cmd_attackcanceler (0x00) .. Cmd_jumpiftype (0x22), SetMoveEffect
// and the type-effectiveness helpers. Script arguments are read from the assembled script ROM at
// gBattlescriptCurrInstr exactly like the T1_READ_* macros.

import { random } from '../util/random';
import { recordAbilityBattle, recordItemEffectBattle } from './ai';
import { changeStatBuffs, attacksThisTurn, trySetDestinyBondToHappen, isTwoTurnsMove } from './bsCommands2';
import { K } from './constants';
import {
  emitFaintAnimation,
  emitHealthBarUpdate,
  emitMoveAnimation,
  emitPlaySE,
  emitPrintSelectionString,
  emitSetMonData,
  markBattlerForControllerExec,
  u16,
  u32,
} from './controllers';
import { btlCtrlOakOldManTestState2Flag } from './controllerOakOldMan';
import { bdata, g, gBattleMoves, gSpeciesInfo, mem } from './env';
import { bit } from './globals';
import { faintClearSetData } from './main';
import { adjustFriendship, calculateBaseDamage } from './pokemonBattle';
import { prepareMoveBuffer } from './textBuffers';
import {
  abilityBattleEffects,
  atkCanceller_UnableToUseMove,
  battlerHoldEffect,
  battlerHoldEffectParam,
  battleScriptPop,
  battleScriptPush,
  battleScriptPushCursor,
  bs,
  cancelMultiTurnMoves,
  getBattlerAtPosition,
  getBattlerForBattleScript,
  getBattlerSide,
  getMoveType,
  isBattlerOfType,
  isMonDisobedient,
  moveIsPermanent,
  prepareStringBattle,
  pressurePPLose,
  weatherHasEffect,
} from './util';

const mech = () => bdata.tables.mech as unknown as Record<string, number[]> & { sMoveEffectBS_Ptrs: string[] };

/** gBattlescriptCurrInstr[n] */
export function b(n: number): number {
  return mem.u8(g.battlescriptCurrInstr + n);
}
/** T1_READ_16 / T2_READ_16 */
export function h(n: number): number {
  return mem.u16(g.battlescriptCurrInstr + n);
}
/** T1_READ_32 / T1_READ_PTR / T2_READ_PTR */
export function w(n: number): number {
  return mem.u32(g.battlescriptCurrInstr + n);
}
export function adv(n: number): void {
  g.battlescriptCurrInstr += n;
}

// gTypeEffectiveness: TYPE_EFFECT_ATK_TYPE / DEF_TYPE / MULTIPLIER
export const typeAtk = (i: number) => bdata.tables.typeEffectiveness[i];
export const typeDef = (i: number) => bdata.tables.typeEffectiveness[i + 1];
export const typeMul = (i: number) => bdata.tables.typeEffectiveness[i + 2];

/** DEFENDER_IS_PROTECTED */
function defenderIsProtected(): boolean {
  return !!g.protectStructs[g.battlerTarget].protected && !!(gBattleMoves[g.currentMove].flags & K.FLAG_PROTECT_AFFECTED);
}

export function Cmd_attackcanceler(): void {
  if (g.battleOutcome !== 0) {
    g.currentActionFuncId = K.B_ACTION_FINISHED;
    return;
  }
  const atk = g.battlerAttacker;
  if (g.battleMons[atk].hp === 0 && !(g.hitMarker & K.HITMARKER_NO_ATTACKSTRING)) {
    g.hitMarker |= K.HITMARKER_UNABLE_TO_USE_MOVE;
    g.battlescriptCurrInstr = bs('BattleScript_MoveEnd');
    return;
  }
  if (atkCanceller_UnableToUseMove()) return;
  if (abilityBattleEffects(K.ABILITYEFFECT_MOVES_BLOCK, g.battlerTarget, 0, 0, 0)) return;
  if (
    !g.battleMons[atk].pp[g.currMovePos] &&
    g.currentMove !== K.MOVE_STRUGGLE &&
    !(g.hitMarker & (K.HITMARKER_ALLOW_NO_PP | K.HITMARKER_NO_ATTACKSTRING)) &&
    !(g.battleMons[atk].status2 & K.STATUS2_MULTIPLETURNS)
  ) {
    g.battlescriptCurrInstr = bs('BattleScript_NoPPForMove');
    g.moveResultFlags |= K.MOVE_RESULT_MISSED;
    return;
  }
  g.hitMarker &= ~K.HITMARKER_ALLOW_NO_PP;

  if (!(g.hitMarker & K.HITMARKER_OBEYS) && !(g.battleMons[atk].status2 & K.STATUS2_MULTIPLETURNS)) {
    switch (isMonDisobedient()) {
      case 0:
        break;
      case 2:
        g.hitMarker |= K.HITMARKER_OBEYS;
        return;
      default:
        g.moveResultFlags |= K.MOVE_RESULT_MISSED;
        return;
    }
  }
  g.hitMarker |= K.HITMARKER_OBEYS;

  if (g.protectStructs[g.battlerTarget].bounceMove && gBattleMoves[g.currentMove].flags & K.FLAG_MAGIC_COAT_AFFECTED) {
    pressurePPLose(atk, g.battlerTarget, K.MOVE_MAGIC_COAT);
    g.protectStructs[g.battlerTarget].bounceMove = 0;
    battleScriptPushCursor();
    g.battlescriptCurrInstr = bs('BattleScript_MagicCoatBounce');
    return;
  }
  for (let i = 0; i < g.battlersCount; i++) {
    const t = g.battlerByTurnOrder[i];
    if (g.protectStructs[t].stealMove && gBattleMoves[g.currentMove].flags & K.FLAG_SNATCH_AFFECTED) {
      pressurePPLose(atk, t, K.MOVE_SNATCH);
      g.protectStructs[t].stealMove = 0;
      g.battleScripting.battler = t;
      battleScriptPushCursor();
      g.battlescriptCurrInstr = bs('BattleScript_SnatchedMove');
      return;
    }
  }
  if (g.specialStatuses[g.battlerTarget].lightningRodRedirected) {
    g.specialStatuses[g.battlerTarget].lightningRodRedirected = 0;
    g.lastUsedAbility = K.ABILITY_LIGHTNING_ROD;
    battleScriptPushCursor();
    g.battlescriptCurrInstr = bs('BattleScript_TookAttack');
    recordAbilityBattle(g.battlerTarget, g.lastUsedAbility);
  } else if (
    defenderIsProtected() &&
    (g.currentMove !== K.MOVE_CURSE || isBattlerOfType(atk, K.TYPE_GHOST)) &&
    (!isTwoTurnsMove(g.currentMove) || g.battleMons[atk].status2 & K.STATUS2_MULTIPLETURNS)
  ) {
    cancelMultiTurnMoves(atk);
    g.moveResultFlags |= K.MOVE_RESULT_MISSED;
    g.lastLandedMoves[g.battlerTarget] = 0;
    g.lastHitByType[g.battlerTarget] = 0;
    g.battleCommunication[K.MISS_TYPE] = K.B_MSG_PROTECTED;
    adv(1);
  } else {
    adv(1);
  }
}

/** JumpIfMoveFailed */
function jumpIfMoveFailed(adder: number, move: number): void {
  let ptr = g.battlescriptCurrInstr + adder;
  if (g.moveResultFlags & K.MOVE_RESULT_NO_EFFECT) {
    g.lastLandedMoves[g.battlerTarget] = 0;
    g.lastHitByType[g.battlerTarget] = 0;
    ptr = w(1);
  } else {
    trySetDestinyBondToHappen();
    if (abilityBattleEffects(K.ABILITYEFFECT_ABSORBING, g.battlerTarget, 0, 0, move)) return;
  }
  g.battlescriptCurrInstr = ptr;
}

export function Cmd_jumpifaffectedbyprotect(): void {
  if (defenderIsProtected()) {
    g.moveResultFlags |= K.MOVE_RESULT_MISSED;
    jumpIfMoveFailed(5, 0);
    g.battleCommunication[K.MISS_TYPE] = K.B_MSG_PROTECTED;
  } else {
    adv(5);
  }
}

function jumpIfMoveAffectedByProtect(move: number): boolean {
  if (defenderIsProtected()) {
    g.moveResultFlags |= K.MOVE_RESULT_MISSED;
    jumpIfMoveFailed(7, move);
    g.battleCommunication[K.MISS_TYPE] = K.B_MSG_PROTECTED;
    return true;
  }
  return false;
}

function accuracyCalcHelper(move: number): boolean {
  const tgt = g.battlerTarget;
  if (g.statuses3[tgt] & K.STATUS3_ALWAYS_HITS && g.disableStructs[tgt].battlerWithSureHit === g.battlerAttacker) {
    jumpIfMoveFailed(7, move);
    return true;
  }
  if (!(g.hitMarker & K.HITMARKER_IGNORE_ON_AIR) && g.statuses3[tgt] & K.STATUS3_ON_AIR) {
    g.moveResultFlags |= K.MOVE_RESULT_MISSED;
    jumpIfMoveFailed(7, move);
    return true;
  }
  g.hitMarker &= ~K.HITMARKER_IGNORE_ON_AIR;
  if (!(g.hitMarker & K.HITMARKER_IGNORE_UNDERGROUND) && g.statuses3[tgt] & K.STATUS3_UNDERGROUND) {
    g.moveResultFlags |= K.MOVE_RESULT_MISSED;
    jumpIfMoveFailed(7, move);
    return true;
  }
  g.hitMarker &= ~K.HITMARKER_IGNORE_UNDERGROUND;
  if (!(g.hitMarker & K.HITMARKER_IGNORE_UNDERWATER) && g.statuses3[tgt] & K.STATUS3_UNDERWATER) {
    g.moveResultFlags |= K.MOVE_RESULT_MISSED;
    jumpIfMoveFailed(7, move);
    return true;
  }
  g.hitMarker &= ~K.HITMARKER_IGNORE_UNDERWATER;
  const eff = gBattleMoves[move].effect;
  if ((weatherHasEffect() && g.battleWeather & K.B_WEATHER_RAIN && eff === K.EFFECT_THUNDER) || eff === K.EFFECT_ALWAYS_HIT || eff === K.EFFECT_VITAL_THROW) {
    jumpIfMoveFailed(7, move);
    return true;
  }
  return false;
}

export function Cmd_accuracycheck(): void {
  let move = h(5);
  const atkIsPlayer = getBattlerSide(g.battlerAttacker) === K.B_SIDE_PLAYER;
  if (
    (g.battleTypeFlags & K.BATTLE_TYPE_FIRST_BATTLE && !btlCtrlOakOldManTestState2Flag(1) && gBattleMoves[move].power !== 0 && atkIsPlayer) ||
    (g.battleTypeFlags & K.BATTLE_TYPE_FIRST_BATTLE && !btlCtrlOakOldManTestState2Flag(2) && gBattleMoves[move].power === 0 && atkIsPlayer) ||
    g.battleTypeFlags & K.BATTLE_TYPE_POKEDUDE
  ) {
    jumpIfMoveFailed(7, move);
    return;
  }
  const tgt = g.battlerTarget;
  if (move === K.NO_ACC_CALC || move === K.NO_ACC_CALC_CHECK_LOCK_ON) {
    if (g.statuses3[tgt] & K.STATUS3_ALWAYS_HITS && move === K.NO_ACC_CALC_CHECK_LOCK_ON && g.disableStructs[tgt].battlerWithSureHit === g.battlerAttacker) adv(7);
    else if (g.statuses3[tgt] & (K.STATUS3_ON_AIR | K.STATUS3_UNDERGROUND | K.STATUS3_UNDERWATER)) g.battlescriptCurrInstr = w(1);
    else if (!jumpIfMoveAffectedByProtect(0)) adv(7);
    return;
  }
  if (move === K.ACC_CURR_MOVE) move = g.currentMove;
  const type = getMoveType(move);
  if (jumpIfMoveAffectedByProtect(move)) return;
  if (accuracyCalcHelper(move)) return;

  const atkM = g.battleMons[g.battlerAttacker];
  const defM = g.battleMons[tgt];
  // `acc` is a u8 copy of the s8 stage, then truncated back into an s8 (`buff`)
  let buff: number;
  if (defM.status2 & K.STATUS2_FORESIGHT) buff = atkM.statStages[K.STAT_ACC];
  else buff = ((atkM.statStages[K.STAT_ACC] + K.DEFAULT_STAT_STAGE - defM.statStages[K.STAT_EVASION]) << 24) >> 24;
  if (buff < K.MIN_STAT_STAGE) buff = K.MIN_STAT_STAGE;
  if (buff > K.MAX_STAT_STAGE) buff = K.MAX_STAT_STAGE;

  let moveAcc = gBattleMoves[move].accuracy;
  // check Thunder on sunny weather
  if (weatherHasEffect() && g.battleWeather & K.B_WEATHER_SUN && gBattleMoves[move].effect === K.EFFECT_THUNDER) moveAcc = 50;

  const ratios = mech().sAccuracyStageRatios;
  let calc = (ratios[buff * 2] * moveAcc) & 0xffff;
  calc = Math.trunc(calc / ratios[buff * 2 + 1]);
  if (atkM.ability === K.ABILITY_COMPOUND_EYES) calc = Math.trunc((calc * 130) / 100) & 0xffff; // 1.3 compound eyes boost
  if (weatherHasEffect() && defM.ability === K.ABILITY_SAND_VEIL && g.battleWeather & K.B_WEATHER_SANDSTORM) calc = Math.trunc((calc * 80) / 100); // 1.2 sand veil loss
  if (atkM.ability === K.ABILITY_HUSTLE && type < K.TYPE_MYSTERY) calc = Math.trunc((calc * 80) / 100); // 1.2 hustle loss

  const holdEffect = battlerHoldEffect(tgt);
  const param = battlerHoldEffectParam(tgt);
  g.potentialItemEffectBattler = tgt;
  if (holdEffect === K.HOLD_EFFECT_EVASION_UP) calc = Math.trunc((calc * (100 - param)) / 100) & 0xffff;

  // final calculation
  if ((random() % 100) + 1 > calc) {
    g.moveResultFlags |= K.MOVE_RESULT_MISSED;
    if (g.battleTypeFlags & K.BATTLE_TYPE_DOUBLE && (gBattleMoves[move].target === K.MOVE_TARGET_BOTH || gBattleMoves[move].target === K.MOVE_TARGET_FOES_AND_ALLY))
      g.battleCommunication[K.MISS_TYPE] = K.B_MSG_AVOIDED_ATK;
    else g.battleCommunication[K.MISS_TYPE] = K.B_MSG_MISSED;
    checkWonderGuardAndLevitate();
  }
  jumpIfMoveFailed(7, move);
}

export function Cmd_attackstring(): void {
  if (g.battleControllerExecFlags) return;
  if (!(g.hitMarker & (K.HITMARKER_NO_ATTACKSTRING | K.HITMARKER_ATTACKSTRING_PRINTED))) {
    prepareStringBattle(K.STRINGID_USEDMOVE, g.battlerAttacker);
    g.hitMarker |= K.HITMARKER_ATTACKSTRING_PRINTED;
  }
  adv(1);
  g.battleCommunication[K.MSG_DISPLAY] = 0;
}

export function Cmd_ppreduce(): void {
  let ppToDeduct = 1;
  if (g.battleControllerExecFlags) return;
  const atk = g.battlerAttacker;
  if (!g.specialStatuses[atk].ppNotAffectedByPressure) {
    switch (gBattleMoves[g.currentMove].target) {
      case K.MOVE_TARGET_FOES_AND_ALLY:
        ppToDeduct += abilityBattleEffects(K.ABILITYEFFECT_COUNT_ON_FIELD, atk, K.ABILITY_PRESSURE, 0, 0);
        break;
      case K.MOVE_TARGET_BOTH:
      case K.MOVE_TARGET_OPPONENTS_FIELD:
        ppToDeduct += abilityBattleEffects(K.ABILITYEFFECT_COUNT_OTHER_SIDE, atk, K.ABILITY_PRESSURE, 0, 0);
        break;
      default:
        if (atk !== g.battlerTarget && g.battleMons[g.battlerTarget].ability === K.ABILITY_PRESSURE) ppToDeduct++;
        break;
    }
  }
  const m = g.battleMons[atk];
  if (!(g.hitMarker & (K.HITMARKER_NO_PPDEDUCT | K.HITMARKER_NO_ATTACKSTRING)) && m.pp[g.currMovePos]) {
    g.protectStructs[atk].notFirstStrike = 1;
    if (m.pp[g.currMovePos] > ppToDeduct) m.pp[g.currMovePos] -= ppToDeduct;
    else m.pp[g.currMovePos] = 0;
    if (moveIsPermanent(atk, g.currMovePos)) {
      g.activeBattler = atk;
      emitSetMonData(K.BUFFER_A, K.REQUEST_PPMOVE1_BATTLE + g.currMovePos, 0, [m.pp[g.currMovePos]]);
      markBattlerForControllerExec(atk);
    }
  }
  g.hitMarker &= ~K.HITMARKER_NO_PPDEDUCT;
  adv(1);
}

export function Cmd_critcalc(): void {
  const atk = g.battlerAttacker;
  const m = g.battleMons[atk];
  const holdEffect = battlerHoldEffect(atk);
  g.potentialItemEffectBattler = atk;
  const eff = gBattleMoves[g.currentMove].effect;
  let critChance =
    2 * (m.status2 & K.STATUS2_FOCUS_ENERGY ? 1 : 0) +
    (eff === K.EFFECT_HIGH_CRITICAL ? 1 : 0) +
    (eff === K.EFFECT_SKY_ATTACK ? 1 : 0) +
    (eff === K.EFFECT_BLAZE_KICK ? 1 : 0) +
    (eff === K.EFFECT_POISON_TAIL ? 1 : 0) +
    (holdEffect === K.HOLD_EFFECT_SCOPE_LENS ? 1 : 0) +
    2 * (holdEffect === K.HOLD_EFFECT_LUCKY_PUNCH && m.species === K.SPECIES_CHANSEY ? 1 : 0) +
    2 * (holdEffect === K.HOLD_EFFECT_STICK && m.species === K.SPECIES_FARFETCHD ? 1 : 0);
  const chances = mech().sCriticalHitChance;
  if (critChance >= chances.length) critChance = chances.length - 1;
  const def = g.battleMons[g.battlerTarget];
  if (
    def.ability !== K.ABILITY_BATTLE_ARMOR &&
    def.ability !== K.ABILITY_SHELL_ARMOR &&
    !(g.statuses3[atk] & K.STATUS3_CANT_SCORE_A_CRIT) &&
    !(g.battleTypeFlags & K.BATTLE_TYPE_OLD_MAN_TUTORIAL) &&
    !(random() % chances[critChance]) &&
    (!(g.battleTypeFlags & K.BATTLE_TYPE_FIRST_BATTLE) || btlCtrlOakOldManTestState2Flag(1)) &&
    !(g.battleTypeFlags & K.BATTLE_TYPE_POKEDUDE)
  )
    g.critMultiplier = 2;
  else g.critMultiplier = 1;
  adv(1);
}

export function Cmd_damagecalc(): void {
  const sideStatus = g.sideStatuses[getBattlerSide(g.battlerTarget)];
  g.battleMoveDamage = calculateBaseDamage(
    g.battleMons[g.battlerAttacker],
    g.battleMons[g.battlerTarget],
    g.currentMove,
    sideStatus,
    g.dynamicBasePower,
    g.battleStruct.dynamicMoveType,
    g.battlerAttacker,
    g.battlerTarget,
  );
  g.battleMoveDamage = g.battleMoveDamage * g.critMultiplier * g.battleScripting.dmgMultiplier;
  if (g.statuses3[g.battlerAttacker] & K.STATUS3_CHARGED_UP && gBattleMoves[g.currentMove].type === K.TYPE_ELECTRIC) g.battleMoveDamage *= 2;
  if (g.protectStructs[g.battlerAttacker].helpingHand) g.battleMoveDamage = Math.trunc((g.battleMoveDamage * 15) / 10);
  adv(1);
}

/** AI_CalcDmg */
export function AI_CalcDmg(attacker: number, defender: number): void {
  const sideStatus = g.sideStatuses[getBattlerSide(defender)];
  g.battleMoveDamage = calculateBaseDamage(
    g.battleMons[attacker],
    g.battleMons[defender],
    g.currentMove,
    sideStatus,
    g.dynamicBasePower,
    g.battleStruct.dynamicMoveType,
    attacker,
    defender,
  );
  g.dynamicBasePower = 0;
  g.battleMoveDamage = g.battleMoveDamage * g.critMultiplier * g.battleScripting.dmgMultiplier;
  if (g.statuses3[attacker] & K.STATUS3_CHARGED_UP && gBattleMoves[g.currentMove].type === K.TYPE_ELECTRIC) g.battleMoveDamage *= 2;
  if (g.protectStructs[attacker].helpingHand) g.battleMoveDamage = Math.trunc((g.battleMoveDamage * 15) / 10);
}

/** ModulateDmgByType / ModulateDmgByType2: returns the updated flags. */
function modulateDmgByType(multiplier: number, move: number, flags: number): number {
  g.battleMoveDamage = Math.trunc((g.battleMoveDamage * multiplier) / 10);
  if (g.battleMoveDamage === 0 && multiplier !== 0) g.battleMoveDamage = 1;
  switch (multiplier) {
    case K.TYPE_MUL_NO_EFFECT:
      flags |= K.MOVE_RESULT_DOESNT_AFFECT_FOE;
      flags &= ~K.MOVE_RESULT_NOT_VERY_EFFECTIVE;
      flags &= ~K.MOVE_RESULT_SUPER_EFFECTIVE;
      break;
    case K.TYPE_MUL_NOT_EFFECTIVE:
      if (gBattleMoves[move].power && !(flags & K.MOVE_RESULT_NO_EFFECT)) {
        if (flags & K.MOVE_RESULT_SUPER_EFFECTIVE) flags &= ~K.MOVE_RESULT_SUPER_EFFECTIVE;
        else flags |= K.MOVE_RESULT_NOT_VERY_EFFECTIVE;
      }
      break;
    case K.TYPE_MUL_SUPER_EFFECTIVE:
      if (gBattleMoves[move].power && !(flags & K.MOVE_RESULT_NO_EFFECT)) {
        if (flags & K.MOVE_RESULT_NOT_VERY_EFFECTIVE) flags &= ~K.MOVE_RESULT_NOT_VERY_EFFECTIVE;
        else flags |= K.MOVE_RESULT_SUPER_EFFECTIVE;
      }
      break;
  }
  return flags & 0xff;
}

export function Cmd_typecalc(): void {
  let i = 0;
  if (g.currentMove === K.MOVE_STRUGGLE) {
    adv(1);
    return;
  }
  const moveType = getMoveType(g.currentMove);
  const atk = g.battlerAttacker;
  const tgt = g.battlerTarget;
  const def = g.battleMons[tgt];
  // check stab
  if (isBattlerOfType(atk, moveType)) {
    g.battleMoveDamage = g.battleMoveDamage * 15;
    g.battleMoveDamage = Math.trunc(g.battleMoveDamage / 10);
  }
  if (def.ability === K.ABILITY_LEVITATE && moveType === K.TYPE_GROUND) {
    g.lastUsedAbility = def.ability;
    g.moveResultFlags |= K.MOVE_RESULT_MISSED | K.MOVE_RESULT_DOESNT_AFFECT_FOE;
    g.lastLandedMoves[tgt] = 0;
    g.lastHitByType[tgt] = 0;
    g.battleCommunication[K.MISS_TYPE] = K.B_MSG_GROUND_MISS;
    recordAbilityBattle(tgt, g.lastUsedAbility);
  } else {
    while (typeAtk(i) !== K.TYPE_ENDTABLE) {
      if (typeAtk(i) === K.TYPE_FORESIGHT) {
        if (def.status2 & K.STATUS2_FORESIGHT) break;
        i += 3;
        continue;
      } else if (typeAtk(i) === moveType) {
        if (typeDef(i) === def.type1) g.moveResultFlags = modulateDmgByType(typeMul(i), g.currentMove, g.moveResultFlags);
        if (typeDef(i) === def.type2 && def.type1 !== def.type2) g.moveResultFlags = modulateDmgByType(typeMul(i), g.currentMove, g.moveResultFlags);
      }
      i += 3;
    }
  }
  const SE = K.MOVE_RESULT_SUPER_EFFECTIVE;
  const NVE = K.MOVE_RESULT_NOT_VERY_EFFECTIVE;
  if (
    def.ability === K.ABILITY_WONDER_GUARD &&
    attacksThisTurn(atk, g.currentMove) === 2 &&
    (!(g.moveResultFlags & SE) || (g.moveResultFlags & (SE | NVE)) === (SE | NVE)) &&
    gBattleMoves[g.currentMove].power
  ) {
    g.lastUsedAbility = K.ABILITY_WONDER_GUARD;
    g.moveResultFlags |= K.MOVE_RESULT_MISSED;
    g.lastLandedMoves[tgt] = 0;
    g.lastHitByType[tgt] = 0;
    g.battleCommunication[K.MISS_TYPE] = K.B_MSG_AVOIDED_DMG;
    recordAbilityBattle(tgt, g.lastUsedAbility);
  }
  if (g.moveResultFlags & K.MOVE_RESULT_DOESNT_AFFECT_FOE) g.protectStructs[atk].targetNotAffected = 1;
  adv(1);
}

/** CheckWonderGuardAndLevitate */
function checkWonderGuardAndLevitate(): void {
  let flags = 0;
  let i = 0;
  if (g.currentMove === K.MOVE_STRUGGLE || !gBattleMoves[g.currentMove].power) return;
  const moveType = getMoveType(g.currentMove);
  const tgt = g.battlerTarget;
  const def = g.battleMons[tgt];
  if (def.ability === K.ABILITY_LEVITATE && moveType === K.TYPE_GROUND) {
    g.lastUsedAbility = K.ABILITY_LEVITATE;
    g.battleCommunication[K.MISS_TYPE] = K.B_MSG_GROUND_MISS;
    recordAbilityBattle(tgt, K.ABILITY_LEVITATE);
    return;
  }
  while (typeAtk(i) !== K.TYPE_ENDTABLE) {
    if (typeAtk(i) === K.TYPE_FORESIGHT) {
      if (def.status2 & K.STATUS2_FORESIGHT) break;
      i += 3;
      continue;
    }
    if (typeAtk(i) === moveType) {
      const t2 = typeDef(i) === def.type2 && def.type1 !== def.type2;
      if (typeDef(i) === def.type1 && typeMul(i) === K.TYPE_MUL_NO_EFFECT) {
        g.moveResultFlags |= K.MOVE_RESULT_DOESNT_AFFECT_FOE;
        g.protectStructs[g.battlerAttacker].targetNotAffected = 1;
      }
      if (t2 && typeMul(i) === K.TYPE_MUL_NO_EFFECT) {
        g.moveResultFlags |= K.MOVE_RESULT_DOESNT_AFFECT_FOE;
        g.protectStructs[g.battlerAttacker].targetNotAffected = 1;
      }
      // check super effective
      if (typeDef(i) === def.type1 && typeMul(i) === 20) flags |= 1;
      if (t2 && typeMul(i) === K.TYPE_MUL_SUPER_EFFECTIVE) flags |= 1;
      // check not very effective
      if (typeDef(i) === def.type1 && typeMul(i) === 5) flags |= 2;
      if (t2 && typeMul(i) === K.TYPE_MUL_NOT_EFFECTIVE) flags |= 2;
    }
    i += 3;
  }
  if (def.ability === K.ABILITY_WONDER_GUARD && attacksThisTurn(g.battlerAttacker, g.currentMove) === 2) {
    if ((flags & 2 || !(flags & 1)) && gBattleMoves[g.currentMove].power) {
      g.lastUsedAbility = K.ABILITY_WONDER_GUARD;
      g.battleCommunication[K.MISS_TYPE] = K.B_MSG_AVOIDED_DMG;
      recordAbilityBattle(tgt, K.ABILITY_WONDER_GUARD);
    }
  }
}

/** TypeCalc */
export function typeCalc(move: number, attacker: number, defender: number): number {
  let i = 0;
  let flags = 0;
  if (move === K.MOVE_STRUGGLE) return 0;
  const moveType = gBattleMoves[move].type;
  const def = g.battleMons[defender];
  if (isBattlerOfType(attacker, moveType)) {
    g.battleMoveDamage = g.battleMoveDamage * 15;
    g.battleMoveDamage = Math.trunc(g.battleMoveDamage / 10);
  }
  if (def.ability === K.ABILITY_LEVITATE && moveType === K.TYPE_GROUND) {
    flags |= K.MOVE_RESULT_MISSED | K.MOVE_RESULT_DOESNT_AFFECT_FOE;
  } else {
    while (typeAtk(i) !== K.TYPE_ENDTABLE) {
      if (typeAtk(i) === K.TYPE_FORESIGHT) {
        if (def.status2 & K.STATUS2_FORESIGHT) break;
        i += 3;
        continue;
      } else if (typeAtk(i) === moveType) {
        if (typeDef(i) === def.type1) flags = modulateDmgByType(typeMul(i), move, flags);
        if (typeDef(i) === def.type2 && def.type1 !== def.type2) flags = modulateDmgByType(typeMul(i), move, flags);
      }
      i += 3;
    }
  }
  const SE = K.MOVE_RESULT_SUPER_EFFECTIVE;
  const NVE = K.MOVE_RESULT_NOT_VERY_EFFECTIVE;
  if (
    def.ability === K.ABILITY_WONDER_GUARD &&
    !(flags & K.MOVE_RESULT_MISSED) &&
    attacksThisTurn(attacker, move) === 2 &&
    (!(flags & SE) || (flags & (SE | NVE)) === (SE | NVE)) &&
    gBattleMoves[move].power
  )
    flags |= K.MOVE_RESULT_MISSED;
  return flags;
}

/** AI_TypeCalc */
export function AI_TypeCalc(move: number, targetSpecies: number, targetAbility: number): number {
  let i = 0;
  let flags = 0;
  const types = gSpeciesInfo[targetSpecies].types;
  const type1 = types[0];
  const type2 = types[1];
  if (move === K.MOVE_STRUGGLE) return 0;
  const moveType = gBattleMoves[move].type;
  if (targetAbility === K.ABILITY_LEVITATE && moveType === K.TYPE_GROUND) {
    flags = K.MOVE_RESULT_MISSED | K.MOVE_RESULT_DOESNT_AFFECT_FOE;
  } else {
    while (typeAtk(i) !== K.TYPE_ENDTABLE) {
      if (typeAtk(i) === K.TYPE_FORESIGHT) {
        i += 3;
        continue;
      }
      if (typeAtk(i) === moveType) {
        if (typeDef(i) === type1) flags = modulateDmgByType(typeMul(i), move, flags);
        if (typeDef(i) === type2 && type1 !== type2) flags = modulateDmgByType(typeMul(i), move, flags);
      }
      i += 3;
    }
  }
  const SE = K.MOVE_RESULT_SUPER_EFFECTIVE;
  const NVE = K.MOVE_RESULT_NOT_VERY_EFFECTIVE;
  if (targetAbility === K.ABILITY_WONDER_GUARD && (!(flags & SE) || (flags & (SE | NVE)) === (SE | NVE)) && gBattleMoves[move].power)
    flags |= K.MOVE_RESULT_DOESNT_AFFECT_FOE;
  return flags;
}

/** ApplyRandomDmgMultiplier: 85% to 100% inclusive */
function applyRandomDmgMultiplier(): void {
  const rand = random();
  const randPercent = 100 - (rand % 16);
  if (g.battleMoveDamage !== 0) {
    g.battleMoveDamage *= randPercent;
    g.battleMoveDamage = Math.trunc(g.battleMoveDamage / 100);
    if (g.battleMoveDamage === 0) g.battleMoveDamage = 1;
  }
}

function adjustDamage(checkFalseSwipe: boolean): void {
  applyRandomDmgMultiplier();
  const tgt = g.battlerTarget;
  const holdEffect = battlerHoldEffect(tgt);
  const param = battlerHoldEffectParam(tgt);
  g.potentialItemEffectBattler = tgt;
  if (holdEffect === K.HOLD_EFFECT_FOCUS_BAND && random() % 100 < param) {
    recordItemEffectBattle(tgt, holdEffect);
    g.specialStatuses[tgt].focusBanded = 1;
  }
  const def = g.battleMons[tgt];
  if (
    !(def.status2 & K.STATUS2_SUBSTITUTE) &&
    ((checkFalseSwipe && gBattleMoves[g.currentMove].effect === K.EFFECT_FALSE_SWIPE) || g.protectStructs[tgt].endured || g.specialStatuses[tgt].focusBanded) &&
    def.hp <= g.battleMoveDamage
  ) {
    g.battleMoveDamage = def.hp - 1;
    if (g.protectStructs[tgt].endured) {
      g.moveResultFlags |= K.MOVE_RESULT_FOE_ENDURED;
    } else if (g.specialStatuses[tgt].focusBanded) {
      g.moveResultFlags |= K.MOVE_RESULT_FOE_HUNG_ON;
      g.lastUsedItem = def.item;
    }
  }
  adv(1);
}

export function Cmd_adjustnormaldamage(): void {
  adjustDamage(true);
}

/** The same as adjustnormaldamage except it doesn't check for false swipe move effect. */
export function Cmd_adjustnormaldamage2(): void {
  adjustDamage(false);
}

export function Cmd_attackanimation(): void {
  if (g.battleControllerExecFlags) return;
  if (g.hitMarker & K.HITMARKER_NO_ANIMATIONS && g.currentMove !== K.MOVE_TRANSFORM && g.currentMove !== K.MOVE_SUBSTITUTE) {
    battleScriptPush(g.battlescriptCurrInstr + 1);
    g.battlescriptCurrInstr = bs('BattleScript_Pausex20');
    g.battleScripting.animTurn++;
    g.battleScripting.animTargetsHit++;
  } else {
    const target = gBattleMoves[g.currentMove].target;
    if ((target & K.MOVE_TARGET_BOTH || target & K.MOVE_TARGET_FOES_AND_ALLY || target & K.MOVE_TARGET_DEPENDS) && g.battleScripting.animTargetsHit) {
      adv(1);
      return;
    }
    if (!(g.moveResultFlags & K.MOVE_RESULT_NO_EFFECT)) {
      g.activeBattler = g.battlerAttacker;
      emitMoveAnimation(
        K.BUFFER_A,
        g.currentMove,
        g.battleScripting.animTurn,
        g.battleMovePower,
        g.battleMoveDamage,
        g.battleMons[g.battlerAttacker].friendship,
        g.disableStructs[g.battlerAttacker],
      );
      g.battleScripting.animTurn++;
      g.battleScripting.animTargetsHit++;
      markBattlerForControllerExec(g.battlerAttacker);
      adv(1);
    } else {
      battleScriptPush(g.battlescriptCurrInstr + 1);
      g.battlescriptCurrInstr = bs('BattleScript_Pausex20');
    }
  }
}

export function Cmd_waitanimation(): void {
  if (g.battleControllerExecFlags === 0) adv(1);
}

export function Cmd_healthbarupdate(): void {
  if (g.battleControllerExecFlags) return;
  if (!(g.moveResultFlags & K.MOVE_RESULT_NO_EFFECT)) {
    const ab = (g.activeBattler = getBattlerForBattleScript(b(1)));
    if (g.battleMons[ab].status2 & K.STATUS2_SUBSTITUTE && g.disableStructs[ab].substituteHP && !(g.hitMarker & K.HITMARKER_IGNORE_SUBSTITUTE)) {
      prepareStringBattle(K.STRINGID_SUBSTITUTEDAMAGED, ab);
    } else {
      // not present in R/S: ensures that huge damage values don't change sign
      const healthValue = g.battleMoveDamage <= 10000 ? g.battleMoveDamage : 10000;
      emitHealthBarUpdate(K.BUFFER_A, (healthValue << 16) >> 16);
      markBattlerForControllerExec(ab);
      if (getBattlerSide(ab) === K.B_SIDE_PLAYER && g.battleMoveDamage > 0) g.battleResults.playerMonWasDamaged = 1;
    }
  }
  adv(2);
}

export function Cmd_datahpupdate(): void {
  if (g.battleControllerExecFlags) return;
  let moveType: number;
  const dyn = g.battleStruct.dynamicMoveType;
  if (dyn === 0) moveType = gBattleMoves[g.currentMove].type;
  else if (!(dyn & K.F_DYNAMIC_TYPE_1)) moveType = dyn & K.DYNAMIC_TYPE_MASK;
  else moveType = gBattleMoves[g.currentMove].type;

  const ab = (g.activeBattler = getBattlerForBattleScript(b(1)));
  if (!(g.moveResultFlags & K.MOVE_RESULT_NO_EFFECT)) {
    const m = g.battleMons[ab];
    const d = g.disableStructs[ab];
    const ss = g.specialStatuses[ab];
    if (m.status2 & K.STATUS2_SUBSTITUTE && d.substituteHP && !(g.hitMarker & K.HITMARKER_IGNORE_SUBSTITUTE)) {
      if (d.substituteHP >= g.battleMoveDamage) {
        if (ss.dmg === 0) ss.dmg = g.battleMoveDamage;
        d.substituteHP = (d.substituteHP - g.battleMoveDamage) & 0xff;
        g.hpDealt = g.battleMoveDamage;
      } else {
        if (ss.dmg === 0) ss.dmg = d.substituteHP;
        g.hpDealt = d.substituteHP;
        d.substituteHP = 0;
      }
      // check substitute fading
      if (d.substituteHP === 0) {
        adv(2);
        battleScriptPushCursor();
        g.battlescriptCurrInstr = bs('BattleScript_SubstituteFade');
        return;
      }
    } else {
      g.hitMarker &= ~K.HITMARKER_IGNORE_SUBSTITUTE;
      if (g.battleMoveDamage < 0) {
        // hp goes up
        m.hp = (m.hp - g.battleMoveDamage) & 0xffff;
        if (m.hp > m.maxHP) m.hp = m.maxHP;
      } else {
        // hp goes down
        if (g.hitMarker & K.HITMARKER_SKIP_DMG_TRACK) {
          g.hitMarker &= ~K.HITMARKER_SKIP_DMG_TRACK;
        } else {
          g.takenDmg[ab] += g.battleMoveDamage;
          g.takenDmgByBattler[ab] = b(1) === K.BS_TARGET ? g.battlerAttacker : g.battlerTarget;
        }
        if (m.hp > g.battleMoveDamage) {
          m.hp -= g.battleMoveDamage;
          g.hpDealt = g.battleMoveDamage;
        } else {
          g.hpDealt = m.hp;
          m.hp = 0;
        }
        if (!ss.dmg && !(g.hitMarker & K.HITMARKER_PASSIVE_DAMAGE)) ss.dmg = g.hpDealt;
        const by = b(1) === K.BS_TARGET ? g.battlerAttacker : g.battlerTarget;
        if (moveType < K.TYPE_MYSTERY && !(g.hitMarker & K.HITMARKER_PASSIVE_DAMAGE) && g.currentMove !== K.MOVE_PAIN_SPLIT) {
          g.protectStructs[ab].physicalDmg = g.hpDealt;
          ss.physicalDmg = g.hpDealt;
          g.protectStructs[ab].physicalBattlerId = by;
          ss.physicalBattlerId = by;
        } else if (!(moveType < K.TYPE_MYSTERY) && !(g.hitMarker & K.HITMARKER_PASSIVE_DAMAGE)) {
          g.protectStructs[ab].specialDmg = g.hpDealt;
          ss.specialDmg = g.hpDealt;
          g.protectStructs[ab].specialBattlerId = by;
          ss.specialBattlerId = by;
        }
      }
      g.hitMarker &= ~K.HITMARKER_PASSIVE_DAMAGE;
      emitSetMonData(K.BUFFER_A, K.REQUEST_HP_BATTLE, 0, u16(m.hp));
      markBattlerForControllerExec(ab);
    }
  } else {
    if (g.specialStatuses[ab].dmg === 0) g.specialStatuses[ab].dmg = 0xffff;
  }
  adv(2);
}

export function Cmd_critmessage(): void {
  if (g.battleControllerExecFlags === 0) {
    if (g.critMultiplier === 2 && !(g.moveResultFlags & K.MOVE_RESULT_NO_EFFECT)) {
      prepareStringBattle(K.STRINGID_CRITICALHIT, g.battlerAttacker);
      g.battleCommunication[K.MSG_DISPLAY] = 1;
    }
    adv(1);
  }
}

export function Cmd_effectivenesssound(): void {
  if (g.battleControllerExecFlags) return;
  g.activeBattler = g.battlerTarget;
  const f = g.moveResultFlags;
  const se = (song: number) => {
    emitPlaySE(K.BUFFER_A, song);
    markBattlerForControllerExec(g.activeBattler);
  };
  if (!(f & K.MOVE_RESULT_MISSED)) {
    switch (f & ~K.MOVE_RESULT_MISSED & 0xff) {
      case K.MOVE_RESULT_SUPER_EFFECTIVE:
        se(K.SE_SUPER_EFFECTIVE);
        break;
      case K.MOVE_RESULT_NOT_VERY_EFFECTIVE:
        se(K.SE_NOT_EFFECTIVE);
        break;
      case K.MOVE_RESULT_DOESNT_AFFECT_FOE:
      case K.MOVE_RESULT_FAILED:
        break; // no sound
      default:
        if (f & K.MOVE_RESULT_SUPER_EFFECTIVE) se(K.SE_SUPER_EFFECTIVE);
        else if (f & K.MOVE_RESULT_NOT_VERY_EFFECTIVE) se(K.SE_NOT_EFFECTIVE);
        else if (!(f & (K.MOVE_RESULT_DOESNT_AFFECT_FOE | K.MOVE_RESULT_FAILED))) se(K.SE_EFFECTIVE);
        break;
    }
  }
  adv(1);
}

export function Cmd_resultmessage(): void {
  let stringId = 0;
  if (g.battleControllerExecFlags) return;
  const mc = g.battleCommunication;
  if (g.moveResultFlags & K.MOVE_RESULT_MISSED && (!(g.moveResultFlags & K.MOVE_RESULT_DOESNT_AFFECT_FOE) || mc[K.MISS_TYPE] > K.B_MSG_AVOIDED_ATK)) {
    stringId = mem.u16(mem.label('gMissStringIds') + mc[K.MISS_TYPE] * 2);
    mc[K.MSG_DISPLAY] = 1;
  } else {
    mc[K.MSG_DISPLAY] = 1;
    const focusBand = () => {
      g.lastUsedItem = g.battleMons[g.battlerTarget].item;
      g.potentialItemEffectBattler = g.battlerTarget;
      g.moveResultFlags &= ~(K.MOVE_RESULT_FOE_ENDURED | K.MOVE_RESULT_FOE_HUNG_ON);
      battleScriptPushCursor();
      g.battlescriptCurrInstr = bs('BattleScript_FocusBandActivates');
    };
    switch (g.moveResultFlags & ~K.MOVE_RESULT_MISSED & 0xff) {
      case K.MOVE_RESULT_SUPER_EFFECTIVE:
        stringId = K.STRINGID_SUPEREFFECTIVE;
        break;
      case K.MOVE_RESULT_NOT_VERY_EFFECTIVE:
        stringId = K.STRINGID_NOTVERYEFFECTIVE;
        break;
      case K.MOVE_RESULT_ONE_HIT_KO:
        stringId = K.STRINGID_ONEHITKO;
        break;
      case K.MOVE_RESULT_FOE_ENDURED:
        stringId = K.STRINGID_PKMNENDUREDHIT;
        break;
      case K.MOVE_RESULT_FAILED:
        stringId = K.STRINGID_BUTITFAILED;
        break;
      case K.MOVE_RESULT_DOESNT_AFFECT_FOE:
        stringId = K.STRINGID_ITDOESNTAFFECT;
        break;
      case K.MOVE_RESULT_FOE_HUNG_ON:
        focusBand();
        return;
      default:
        if (g.moveResultFlags & K.MOVE_RESULT_DOESNT_AFFECT_FOE) {
          stringId = K.STRINGID_ITDOESNTAFFECT;
        } else if (g.moveResultFlags & K.MOVE_RESULT_ONE_HIT_KO) {
          g.moveResultFlags &= ~K.MOVE_RESULT_ONE_HIT_KO;
          g.moveResultFlags &= ~K.MOVE_RESULT_SUPER_EFFECTIVE;
          g.moveResultFlags &= ~K.MOVE_RESULT_NOT_VERY_EFFECTIVE;
          battleScriptPushCursor();
          g.battlescriptCurrInstr = bs('BattleScript_OneHitKOMsg');
          return;
        } else if (g.moveResultFlags & K.MOVE_RESULT_FOE_ENDURED) {
          g.moveResultFlags &= ~(K.MOVE_RESULT_FOE_ENDURED | K.MOVE_RESULT_FOE_HUNG_ON);
          battleScriptPushCursor();
          g.battlescriptCurrInstr = bs('BattleScript_EnduredMsg');
          return;
        } else if (g.moveResultFlags & K.MOVE_RESULT_FOE_HUNG_ON) {
          focusBand();
          return;
        } else if (g.moveResultFlags & K.MOVE_RESULT_FAILED) {
          stringId = K.STRINGID_BUTITFAILED;
        } else {
          mc[K.MSG_DISPLAY] = 0;
        }
    }
  }
  if (stringId) prepareStringBattle(stringId, g.battlerAttacker);
  adv(1);
}

export function Cmd_printstring(): void {
  if (g.battleControllerExecFlags === 0) {
    prepareStringBattle(h(1), g.battlerAttacker);
    adv(3);
    g.battleCommunication[K.MSG_DISPLAY] = 1;
  }
}

export function Cmd_printselectionstring(): void {
  g.activeBattler = g.battlerAttacker;
  emitPrintSelectionString(K.BUFFER_A, h(1));
  markBattlerForControllerExec(g.activeBattler);
  adv(3);
  g.battleCommunication[K.MSG_DISPLAY] = 1;
}

export function Cmd_waitmessage(): void {
  if (g.battleControllerExecFlags === 0) {
    if (!g.battleCommunication[K.MSG_DISPLAY]) {
      adv(3);
    } else {
      const toWait = h(1);
      if (++g.pauseCounterBattle >= toWait) {
        g.pauseCounterBattle = 0;
        adv(3);
        g.battleCommunication[K.MSG_DISPLAY] = 0;
      }
    }
  }
}

export function Cmd_printfromtable(): void {
  if (g.battleControllerExecFlags === 0) {
    const ptr = w(1) + g.battleCommunication[K.MULTISTRING_CHOOSER] * 2;
    prepareStringBattle(mem.u16(ptr), g.battlerAttacker);
    adv(5);
    g.battleCommunication[K.MSG_DISPLAY] = 1;
  }
}

export function Cmd_printselectionstringfromtable(): void {
  if (g.battleControllerExecFlags === 0) {
    const ptr = w(1) + g.battleCommunication[K.MULTISTRING_CHOOSER] * 2;
    g.activeBattler = g.battlerAttacker;
    emitPrintSelectionString(K.BUFFER_A, mem.u16(ptr));
    markBattlerForControllerExec(g.activeBattler);
    adv(5);
    g.battleCommunication[K.MSG_DISPLAY] = 1;
  }
}

/** GetBattlerTurnOrderNum */
export function getBattlerTurnOrderNum(battlerId: number): number {
  let i = 0;
  for (; i < g.battlersCount; i++) if (g.battlerByTurnOrder[i] === battlerId) break;
  return i;
}

function moveEffectScript(effectByte: number): number {
  return bs(mech().sMoveEffectBS_Ptrs[effectByte]);
}

/** SetMoveEffect */
export function setMoveEffect(primary: boolean, certain: number): void {
  let statusChanged = false;
  let affectsUser = 0; // 0x40 otherwise
  let noSunCanFreeze = true;
  const mc = g.battleCommunication;
  const E = K.MOVE_EFFECT_BYTE;
  const statusFlags = mech().sStatusFlagsForMoveEffects;
  const isCertain = primary || certain === K.MOVE_EFFECT_CERTAIN;

  if (mc[E] & K.MOVE_EFFECT_AFFECTS_USER) {
    g.effectBattler = g.battlerAttacker; // battlerId that effects get applied on
    mc[E] &= ~K.MOVE_EFFECT_AFFECTS_USER;
    affectsUser = K.MOVE_EFFECT_AFFECTS_USER;
    g.battleScripting.battler = g.battlerTarget; // theoretically the attacker
  } else {
    g.effectBattler = g.battlerTarget;
    g.battleScripting.battler = g.battlerAttacker;
  }
  const eb = g.effectBattler;
  const em = g.battleMons[eb];
  // INCREMENT_RETURN
  if (g.battleTypeFlags & K.BATTLE_TYPE_POKEDUDE && mc[E] !== 1 && getBattlerSide(eb) === K.B_SIDE_OPPONENT) return adv(1);
  if (em.ability === K.ABILITY_SHIELD_DUST && !(g.hitMarker & K.HITMARKER_STATUS_ABILITY_EFFECT) && !primary && mc[E] <= 9) return adv(1);
  if (g.sideStatuses[getBattlerSide(eb)] & K.SIDE_STATUS_SAFEGUARD && !(g.hitMarker & K.HITMARKER_STATUS_ABILITY_EFFECT) && !primary && mc[E] <= 7) return adv(1);
  if (em.hp === 0 && mc[E] !== K.MOVE_EFFECT_PAYDAY && mc[E] !== K.MOVE_EFFECT_STEAL_ITEM) return adv(1);
  if (em.status2 & K.STATUS2_SUBSTITUTE && affectsUser !== K.MOVE_EFFECT_AFFECTS_USER) return adv(1);

  const preventedBy = (ability: number, label: string) => {
    g.lastUsedAbility = ability;
    recordAbilityBattle(eb, ability);
    battleScriptPush(g.battlescriptCurrInstr + 1);
    g.battlescriptCurrInstr = bs(label);
    if (g.hitMarker & K.HITMARKER_STATUS_ABILITY_EFFECT) {
      mc[K.MULTISTRING_CHOOSER] = K.B_MSG_ABILITY_PREVENTS_ABILITY_STATUS;
      g.hitMarker &= ~K.HITMARKER_STATUS_ABILITY_EFFECT;
    } else {
      mc[K.MULTISTRING_CHOOSER] = K.B_MSG_ABILITY_PREVENTS_MOVE_STATUS;
    }
  };
  const hadNoEffect = (label: string) => {
    battleScriptPush(g.battlescriptCurrInstr + 1);
    g.battlescriptCurrInstr = bs(label);
    mc[K.MULTISTRING_CHOOSER] = K.B_MSG_STATUS_HAD_NO_EFFECT;
  };

  if (mc[E] <= K.PRIMARY_STATUS_MOVE_EFFECT) {
    switch (statusFlags[mc[E]]) {
      case K.STATUS1_SLEEP:
        // check active uproar
        if (em.ability !== K.ABILITY_SOUNDPROOF) {
          for (g.activeBattler = 0; g.activeBattler < g.battlersCount && !(g.battleMons[g.activeBattler].status2 & K.STATUS2_UPROAR); g.activeBattler++);
        } else {
          g.activeBattler = g.battlersCount;
        }
        if (em.status1) break;
        if (g.activeBattler !== g.battlersCount) break;
        if (em.ability === K.ABILITY_VITAL_SPIRIT) break;
        if (em.ability === K.ABILITY_INSOMNIA) break;
        cancelMultiTurnMoves(eb);
        statusChanged = true;
        break;
      case K.STATUS1_POISON:
        if (em.ability === K.ABILITY_IMMUNITY && isCertain) return preventedBy(K.ABILITY_IMMUNITY, 'BattleScript_PSNPrevention');
        if ((isBattlerOfType(eb, K.TYPE_POISON) || isBattlerOfType(eb, K.TYPE_STEEL)) && g.hitMarker & K.HITMARKER_STATUS_ABILITY_EFFECT && isCertain)
          return hadNoEffect('BattleScript_PSNPrevention');
        if (isBattlerOfType(eb, K.TYPE_POISON)) break;
        if (isBattlerOfType(eb, K.TYPE_STEEL)) break;
        if (em.status1) break;
        if (em.ability === K.ABILITY_IMMUNITY) break;
        statusChanged = true;
        break;
      case K.STATUS1_BURN:
        if (em.ability === K.ABILITY_WATER_VEIL && isCertain) return preventedBy(K.ABILITY_WATER_VEIL, 'BattleScript_BRNPrevention');
        if (isBattlerOfType(eb, K.TYPE_FIRE) && g.hitMarker & K.HITMARKER_STATUS_ABILITY_EFFECT && isCertain) return hadNoEffect('BattleScript_BRNPrevention');
        if (isBattlerOfType(eb, K.TYPE_FIRE)) break;
        if (em.ability === K.ABILITY_WATER_VEIL) break;
        if (em.status1) break;
        statusChanged = true;
        break;
      case K.STATUS1_FREEZE:
        if (weatherHasEffect() && g.battleWeather & K.B_WEATHER_SUN) noSunCanFreeze = false;
        if (isBattlerOfType(eb, K.TYPE_ICE)) break;
        if (em.status1) break;
        if (!noSunCanFreeze) break;
        if (em.ability === K.ABILITY_MAGMA_ARMOR) break;
        cancelMultiTurnMoves(eb);
        statusChanged = true;
        break;
      case K.STATUS1_PARALYSIS:
        if (em.ability === K.ABILITY_LIMBER) {
          if (isCertain) return preventedBy(K.ABILITY_LIMBER, 'BattleScript_PRLZPrevention');
          break;
        }
        if (em.status1) break;
        statusChanged = true;
        break;
      case K.STATUS1_TOXIC_POISON:
        if (em.ability === K.ABILITY_IMMUNITY && isCertain) return preventedBy(K.ABILITY_IMMUNITY, 'BattleScript_PSNPrevention');
        if ((isBattlerOfType(eb, K.TYPE_POISON) || isBattlerOfType(eb, K.TYPE_STEEL)) && g.hitMarker & K.HITMARKER_STATUS_ABILITY_EFFECT && isCertain)
          return hadNoEffect('BattleScript_PSNPrevention');
        if (em.status1) break;
        if (!isBattlerOfType(eb, K.TYPE_POISON) && !isBattlerOfType(eb, K.TYPE_STEEL)) {
          if (em.ability === K.ABILITY_IMMUNITY) break;
          // It's redundant, because at this point we know the status1 value is 0.
          em.status1 &= ~K.STATUS1_TOXIC_POISON;
          em.status1 &= ~K.STATUS1_POISON;
          statusChanged = true;
          break;
        } else {
          g.moveResultFlags |= K.MOVE_RESULT_DOESNT_AFFECT_FOE;
        }
        break;
    }
    if (statusChanged) {
      battleScriptPush(g.battlescriptCurrInstr + 1);
      if (statusFlags[mc[E]] === K.STATUS1_SLEEP) em.status1 |= (random() & 3) + 2; // 2-5 turns
      else em.status1 |= statusFlags[mc[E]];
      g.battlescriptCurrInstr = moveEffectScript(mc[E]);
      g.activeBattler = eb;
      emitSetMonData(K.BUFFER_A, K.REQUEST_STATUS_BATTLE, 0, u32(em.status1));
      markBattlerForControllerExec(g.activeBattler);
      if (g.hitMarker & K.HITMARKER_STATUS_ABILITY_EFFECT) {
        mc[K.MULTISTRING_CHOOSER] = K.B_MSG_STATUSED_BY_ABILITY;
        g.hitMarker &= ~K.HITMARKER_STATUS_ABILITY_EFFECT;
      } else {
        mc[K.MULTISTRING_CHOOSER] = K.B_MSG_STATUSED;
      }
      // for synchronize
      if (mc[E] === K.MOVE_EFFECT_POISON || mc[E] === K.MOVE_EFFECT_TOXIC || mc[E] === K.MOVE_EFFECT_PARALYSIS || mc[E] === K.MOVE_EFFECT_BURN) {
        g.battleStruct.synchronizeMoveEffect = mc[E];
        g.hitMarker |= K.HITMARKER_SYNCHRONISE_EFFECT;
      }
    } else {
      adv(1);
    }
    return;
  }

  if (em.status2 & (statusFlags[mc[E]] ?? 0)) {
    adv(1);
    return;
  }
  const statChange = (value: number, statOffset: number, label: string) => {
    if (changeStatBuffs(value, mc[E] - statOffset + 1, affectsUser, 0)) {
      adv(1);
    } else {
      g.battleScripting.animArg1 = mc[E] & ~(K.MOVE_EFFECT_AFFECTS_USER | K.MOVE_EFFECT_CERTAIN);
      g.battleScripting.animArg2 = 0;
      battleScriptPush(g.battlescriptCurrInstr + 1);
      g.battlescriptCurrInstr = bs(label);
    }
  };
  const SET_STAT_BUFF_VALUE = (n: number) => (n << 4) & 0xf0;
  const pushScript = (label: number) => {
    battleScriptPush(g.battlescriptCurrInstr + 1);
    g.battlescriptCurrInstr = label;
  };
  const eff = mc[E];
  switch (eff) {
    case K.MOVE_EFFECT_CONFUSION:
      if (em.ability === K.ABILITY_OWN_TEMPO || em.status2 & K.STATUS2_CONFUSION) {
        adv(1);
      } else {
        em.status2 |= (random() % 4) + 2; // STATUS2_CONFUSION_TURN: 2-5 turns
        pushScript(moveEffectScript(eff));
      }
      break;
    case K.MOVE_EFFECT_FLINCH:
      if (em.ability === K.ABILITY_INNER_FOCUS) {
        if (isCertain) {
          g.lastUsedAbility = K.ABILITY_INNER_FOCUS;
          recordAbilityBattle(eb, K.ABILITY_INNER_FOCUS);
          g.battlescriptCurrInstr = bs('BattleScript_FlinchPrevention');
        } else {
          adv(1);
        }
      } else {
        if (getBattlerTurnOrderNum(eb) > g.currentTurnActionNumber) em.status2 |= statusFlags[eff];
        adv(1);
      }
      break;
    case K.MOVE_EFFECT_UPROAR:
      if (!(em.status2 & K.STATUS2_UPROAR)) {
        em.status2 |= K.STATUS2_MULTIPLETURNS;
        g.lockedMoves[eb] = g.currentMove;
        em.status2 |= ((random() & 3) + 2) << 4; // STATUS2_UPROAR_TURN: 2-5 turns
        pushScript(moveEffectScript(eff));
      } else {
        adv(1);
      }
      break;
    case K.MOVE_EFFECT_PAYDAY:
      if (getBattlerSide(g.battlerAttacker) === K.B_SIDE_PLAYER) {
        const payday = g.paydayMoney;
        g.paydayMoney = (g.paydayMoney + g.battleMons[g.battlerAttacker].level * 5) & 0xffff;
        if (payday > g.paydayMoney) g.paydayMoney = 0xffff;
      }
      pushScript(moveEffectScript(eff));
      break;
    case K.MOVE_EFFECT_TRI_ATTACK:
      if (em.status1) {
        adv(1);
      } else {
        mc[E] = (random() % 3) + 3;
        setMoveEffect(false, 0);
      }
      break;
    case K.MOVE_EFFECT_CHARGING:
      em.status2 |= K.STATUS2_MULTIPLETURNS;
      g.lockedMoves[eb] = g.currentMove;
      g.protectStructs[eb].chargingTurn = 1;
      adv(1);
      break;
    case K.MOVE_EFFECT_WRAP:
      if (em.status2 & K.STATUS2_WRAPPED) {
        adv(1);
      } else {
        em.status2 |= ((random() & 3) + 3) << 13; // STATUS2_WRAPPED_TURN: 3-6 turns
        g.battleStruct.wrappedMove[eb * 2 + 0] = g.currentMove;
        g.battleStruct.wrappedMove[eb * 2 + 1] = g.currentMove >> 8;
        g.battleStruct.wrappedBy[eb] = g.battlerAttacker;
        pushScript(moveEffectScript(eff));
        const trapping = mech().gTrappingMoves;
        for (mc[K.MULTISTRING_CHOOSER] = 0; ; mc[K.MULTISTRING_CHOOSER]++) {
          if (mc[K.MULTISTRING_CHOOSER] >= K.NUM_TRAPPING_MOVES - 1) break;
          if (trapping[mc[K.MULTISTRING_CHOOSER]] === g.currentMove) break;
        }
      }
      break;
    case K.MOVE_EFFECT_RECOIL_25: // 25% recoil
      g.battleMoveDamage = Math.trunc(g.hpDealt / 4) || 1;
      pushScript(moveEffectScript(eff));
      break;
    case K.MOVE_EFFECT_ATK_PLUS_1:
    case K.MOVE_EFFECT_DEF_PLUS_1:
    case K.MOVE_EFFECT_SPD_PLUS_1:
    case K.MOVE_EFFECT_SP_ATK_PLUS_1:
    case K.MOVE_EFFECT_SP_DEF_PLUS_1:
    case K.MOVE_EFFECT_ACC_PLUS_1:
    case K.MOVE_EFFECT_EVS_PLUS_1:
      statChange(SET_STAT_BUFF_VALUE(1), K.MOVE_EFFECT_ATK_PLUS_1, 'BattleScript_StatUp');
      break;
    case K.MOVE_EFFECT_ATK_MINUS_1:
    case K.MOVE_EFFECT_DEF_MINUS_1:
    case K.MOVE_EFFECT_SPD_MINUS_1:
    case K.MOVE_EFFECT_SP_ATK_MINUS_1:
    case K.MOVE_EFFECT_SP_DEF_MINUS_1:
    case K.MOVE_EFFECT_ACC_MINUS_1:
    case K.MOVE_EFFECT_EVS_MINUS_1:
      statChange(SET_STAT_BUFF_VALUE(1) | K.STAT_BUFF_NEGATIVE, K.MOVE_EFFECT_ATK_MINUS_1, 'BattleScript_StatDown');
      break;
    case K.MOVE_EFFECT_ATK_PLUS_2:
    case K.MOVE_EFFECT_DEF_PLUS_2:
    case K.MOVE_EFFECT_SPD_PLUS_2:
    case K.MOVE_EFFECT_SP_ATK_PLUS_2:
    case K.MOVE_EFFECT_SP_DEF_PLUS_2:
    case K.MOVE_EFFECT_ACC_PLUS_2:
    case K.MOVE_EFFECT_EVS_PLUS_2:
      statChange(SET_STAT_BUFF_VALUE(2), K.MOVE_EFFECT_ATK_PLUS_2, 'BattleScript_StatUp');
      break;
    case K.MOVE_EFFECT_ATK_MINUS_2:
    case K.MOVE_EFFECT_DEF_MINUS_2:
    case K.MOVE_EFFECT_SPD_MINUS_2:
    case K.MOVE_EFFECT_SP_ATK_MINUS_2:
    case K.MOVE_EFFECT_SP_DEF_MINUS_2:
    case K.MOVE_EFFECT_ACC_MINUS_2:
    case K.MOVE_EFFECT_EVS_MINUS_2:
      statChange(SET_STAT_BUFF_VALUE(2) | K.STAT_BUFF_NEGATIVE, K.MOVE_EFFECT_ATK_MINUS_2, 'BattleScript_StatDown');
      break;
    case K.MOVE_EFFECT_RECHARGE:
      em.status2 |= K.STATUS2_RECHARGE;
      g.disableStructs[eb].rechargeTimer = 2;
      g.lockedMoves[eb] = g.currentMove;
      adv(1);
      break;
    case K.MOVE_EFFECT_RAGE:
      g.battleMons[g.battlerAttacker].status2 |= K.STATUS2_RAGE;
      adv(1);
      break;
    case K.MOVE_EFFECT_STEAL_ITEM: {
      if (g.battleTypeFlags & K.BATTLE_TYPE_TRAINER_TOWER) {
        adv(1);
        break;
      }
      const atk = g.battlerAttacker;
      const tgt = g.battlerTarget;
      const side = getBattlerSide(atk);
      const special = g.battleTypeFlags & (K.BATTLE_TYPE_EREADER_TRAINER | K.BATTLE_TYPE_BATTLE_TOWER | K.BATTLE_TYPE_LINK);
      if (side === K.B_SIDE_OPPONENT && !special && g.trainerBattleOpponent_A !== K.TRAINER_SECRET_BASE) {
        adv(1);
      } else if (!special && g.trainerBattleOpponent_A !== K.TRAINER_SECRET_BASE && g.wishFutureKnock.knockedOffMons[side] & bit(g.battlerPartyIndexes[atk])) {
        adv(1);
      } else if (g.battleMons[tgt].item && g.battleMons[tgt].ability === K.ABILITY_STICKY_HOLD) {
        g.battlescriptCurrInstr = bs('BattleScript_StickyHoldActivates');
        g.lastUsedAbility = g.battleMons[tgt].ability;
        recordAbilityBattle(tgt, g.lastUsedAbility);
      } else if (
        g.battleMons[atk].item !== K.ITEM_NONE ||
        g.battleMons[tgt].item === K.ITEM_ENIGMA_BERRY ||
        isItemMail(g.battleMons[tgt].item) ||
        g.battleMons[tgt].item === K.ITEM_NONE
      ) {
        adv(1);
      } else {
        g.lastUsedItem = g.battleStruct.changedItems[atk] = g.battleMons[tgt].item;
        g.battleMons[tgt].item = K.ITEM_NONE;
        g.activeBattler = atk;
        emitSetMonData(K.BUFFER_A, K.REQUEST_HELDITEM_BATTLE, 0, u16(g.lastUsedItem));
        markBattlerForControllerExec(atk);
        g.activeBattler = tgt;
        emitSetMonData(K.BUFFER_A, K.REQUEST_HELDITEM_BATTLE, 0, u16(g.battleMons[tgt].item));
        markBattlerForControllerExec(tgt);
        pushScript(bs('BattleScript_ItemSteal'));
        g.battleStruct.choicedMove[tgt] = 0;
      }
      break;
    }
    case K.MOVE_EFFECT_PREVENT_ESCAPE:
      g.battleMons[g.battlerTarget].status2 |= K.STATUS2_ESCAPE_PREVENTION;
      g.disableStructs[g.battlerTarget].battlerPreventingEscape = g.battlerAttacker;
      adv(1);
      break;
    case K.MOVE_EFFECT_NIGHTMARE:
      g.battleMons[g.battlerTarget].status2 |= K.STATUS2_NIGHTMARE;
      adv(1);
      break;
    case K.MOVE_EFFECT_ALL_STATS_UP:
      pushScript(bs('BattleScript_AllStatsUp'));
      break;
    case K.MOVE_EFFECT_RAPIDSPIN:
      pushScript(bs('BattleScript_RapidSpinAway'));
      break;
    case K.MOVE_EFFECT_REMOVE_PARALYSIS: // Smelling salts
      if (!(g.battleMons[g.battlerTarget].status1 & K.STATUS1_PARALYSIS)) {
        adv(1);
      } else {
        g.battleMons[g.battlerTarget].status1 &= ~K.STATUS1_PARALYSIS;
        g.activeBattler = g.battlerTarget;
        emitSetMonData(K.BUFFER_A, K.REQUEST_STATUS_BATTLE, 0, u32(g.battleMons[g.activeBattler].status1));
        markBattlerForControllerExec(g.activeBattler);
        pushScript(bs('BattleScript_TargetPRLZHeal'));
      }
      break;
    case K.MOVE_EFFECT_ATK_DEF_DOWN: // SuperPower
      pushScript(bs('BattleScript_AtkDefDown'));
      break;
    case K.MOVE_EFFECT_RECOIL_33: // Double Edge
      g.battleMoveDamage = Math.trunc(g.hpDealt / 3) || 1;
      pushScript(moveEffectScript(eff));
      break;
    case K.MOVE_EFFECT_THRASH:
      if (em.status2 & K.STATUS2_LOCK_CONFUSE) {
        adv(1);
      } else {
        em.status2 |= K.STATUS2_MULTIPLETURNS;
        g.lockedMoves[eb] = g.currentMove;
        em.status2 |= ((random() & 1) + 2) << 10; // STATUS2_LOCK_CONFUSE_TURN: thrash for 2-3 turns
      }
      break;
    case K.MOVE_EFFECT_KNOCK_OFF:
      if (em.ability === K.ABILITY_STICKY_HOLD) {
        if (em.item === K.ITEM_NONE) {
          adv(1);
        } else {
          g.lastUsedAbility = K.ABILITY_STICKY_HOLD;
          g.battlescriptCurrInstr = bs('BattleScript_StickyHoldActivates');
          recordAbilityBattle(eb, K.ABILITY_STICKY_HOLD);
        }
        break;
      }
      if (em.item) {
        const side = getBattlerSide(eb);
        g.lastUsedItem = em.item;
        em.item = K.ITEM_NONE;
        g.wishFutureKnock.knockedOffMons[side] |= bit(g.battlerPartyIndexes[eb]);
        pushScript(bs('BattleScript_KnockedOff'));
        g.battleStruct.choicedMove[eb] = 0;
      } else {
        adv(1);
      }
      break;
    case K.MOVE_EFFECT_SP_ATK_TWO_DOWN: // Overheat
      pushScript(bs('BattleScript_SAtkDown2'));
      break;
  }
}

/** IS_ITEM_MAIL */
export function isItemMail(item: number): boolean {
  return [
    'ITEM_ORANGE_MAIL', 'ITEM_HARBOR_MAIL', 'ITEM_GLITTER_MAIL', 'ITEM_MECH_MAIL', 'ITEM_WOOD_MAIL', 'ITEM_WAVE_MAIL',
    'ITEM_BEAD_MAIL', 'ITEM_SHADOW_MAIL', 'ITEM_TROPIC_MAIL', 'ITEM_DREAM_MAIL', 'ITEM_FAB_MAIL', 'ITEM_RETRO_MAIL',
  ].some((n) => K[n] === item);
}

export function Cmd_seteffectwithchance(): void {
  const mc = g.battleCommunication;
  const E = K.MOVE_EFFECT_BYTE;
  let percentChance = gBattleMoves[g.currentMove].secondaryEffectChance;
  if (g.battleMons[g.battlerAttacker].ability === K.ABILITY_SERENE_GRACE) percentChance *= 2;
  if (mc[E] & K.MOVE_EFFECT_CERTAIN && !(g.moveResultFlags & K.MOVE_RESULT_NO_EFFECT)) {
    mc[E] &= ~K.MOVE_EFFECT_CERTAIN;
    setMoveEffect(false, K.MOVE_EFFECT_CERTAIN);
  } else if (random() % 100 <= percentChance && mc[E] && !(g.moveResultFlags & K.MOVE_RESULT_NO_EFFECT)) {
    setMoveEffect(false, percentChance >= 100 ? K.MOVE_EFFECT_CERTAIN : 0);
  } else {
    adv(1);
  }
  mc[E] = 0;
  g.battleScripting.multihitMoveEffect = 0;
}

export function Cmd_seteffectprimary(): void {
  setMoveEffect(true, 0);
}

export function Cmd_seteffectsecondary(): void {
  setMoveEffect(false, 0);
}

export function Cmd_clearstatusfromeffect(): void {
  const mc = g.battleCommunication;
  const E = K.MOVE_EFFECT_BYTE;
  const ab = (g.activeBattler = getBattlerForBattleScript(b(1)));
  const flags = mech().sStatusFlagsForMoveEffects[mc[E]] ?? 0;
  if (mc[E] <= K.PRIMARY_STATUS_MOVE_EFFECT) g.battleMons[ab].status1 &= ~flags;
  else g.battleMons[ab].status2 &= ~flags;
  mc[E] = 0;
  adv(2);
  g.battleScripting.multihitMoveEffect = 0;
}

/** HITMARKER_FAINTED(battler) */
const hitmarkerFainted = (battler: number) => (bit(battler) << 28) >>> 0;

export function Cmd_tryfaintmon(): void {
  if (b(2) !== 0) {
    const ab = (g.activeBattler = getBattlerForBattleScript(b(1)));
    if (g.hitMarker & hitmarkerFainted(ab)) {
      const ptr = w(3);
      battleScriptPop();
      g.battlescriptCurrInstr = ptr;
      g.sideStatuses[getBattlerSide(ab)] &= ~K.SIDE_STATUS_SPIKES_DAMAGED;
    } else {
      adv(7);
    }
    return;
  }
  let battlerId: number;
  let ptr: number;
  if (b(1) === K.BS_ATTACKER) {
    g.activeBattler = g.battlerAttacker;
    battlerId = g.battlerTarget;
    ptr = bs('BattleScript_FaintAttacker');
  } else {
    g.activeBattler = g.battlerTarget;
    battlerId = g.battlerAttacker;
    ptr = bs('BattleScript_FaintTarget');
  }
  const ab = g.activeBattler;
  if (!(g.absentBattlerFlags & bit(ab)) && g.battleMons[ab].hp === 0) {
    g.hitMarker |= hitmarkerFainted(ab);
    battleScriptPush(g.battlescriptCurrInstr + 7);
    g.battlescriptCurrInstr = ptr;
    const res = g.battleResults;
    if (getBattlerSide(ab) === K.B_SIDE_PLAYER) {
      g.hitMarker |= K.HITMARKER_PLAYER_FAINTED;
      if (res.playerFaintCounter < 255) res.playerFaintCounter++;
      adjustFriendshipOnBattleFaint(ab);
    } else {
      if (res.opponentFaintCounter < 255) res.opponentFaintCounter++;
      res.lastOpponentSpecies = g.enemyParty[g.battlerPartyIndexes[ab]]?.species ?? 0;
      g.battleStruct.lastAttackerToFaintOpponent = g.battlerAttacker;
    }
    if (g.hitMarker & K.HITMARKER_DESTINYBOND && g.battleMons[g.battlerAttacker].hp !== 0) {
      g.hitMarker &= ~K.HITMARKER_DESTINYBOND;
      battleScriptPush(g.battlescriptCurrInstr);
      g.battleMoveDamage = g.battleMons[battlerId].hp;
      g.battlescriptCurrInstr = bs('BattleScript_DestinyBondTakesLife');
    }
    if (
      g.statuses3[g.battlerTarget] & K.STATUS3_GRUDGE &&
      !(g.hitMarker & K.HITMARKER_GRUDGE) &&
      getBattlerSide(g.battlerAttacker) !== getBattlerSide(g.battlerTarget) &&
      g.battleMons[g.battlerAttacker].hp !== 0 &&
      g.currentMove !== K.MOVE_STRUGGLE
    ) {
      const moveIndex = g.battleStruct.chosenMovePositions[g.battlerAttacker];
      g.battleMons[g.battlerAttacker].pp[moveIndex] = 0;
      battleScriptPush(g.battlescriptCurrInstr);
      g.battlescriptCurrInstr = bs('BattleScript_GrudgeTakesPp');
      g.activeBattler = g.battlerAttacker;
      emitSetMonData(K.BUFFER_A, moveIndex + K.REQUEST_PPMOVE1_BATTLE, 0, [g.battleMons[g.activeBattler].pp[moveIndex]]);
      markBattlerForControllerExec(g.activeBattler);
      prepareMoveBuffer(g.battleTextBuff1, g.battleMons[g.battlerAttacker].moves[moveIndex]);
    }
  } else {
    adv(7);
  }
}

/** AdjustFriendshipOnBattleFaint (battle_util2.c) */
function adjustFriendshipOnBattleFaint(battlerId: number): void {
  let opposing: number;
  if (g.battleTypeFlags & K.BATTLE_TYPE_DOUBLE) {
    opposing = getBattlerAtPosition(K.B_POSITION_OPPONENT_LEFT);
    const opposing2 = getBattlerAtPosition(K.B_POSITION_OPPONENT_RIGHT);
    if (g.battleMons[opposing2].level > g.battleMons[opposing].level) opposing = opposing2;
  } else {
    opposing = getBattlerAtPosition(K.B_POSITION_OPPONENT_LEFT);
  }
  const mon = g.playerParty[g.battlerPartyIndexes[battlerId]];
  if (!mon) return;
  if (g.battleMons[opposing].level > g.battleMons[battlerId].level && g.battleMons[opposing].level - g.battleMons[battlerId].level > 29)
    adjustFriendship(mon, K.FRIENDSHIP_EVENT_FAINT_LARGE);
  else adjustFriendship(mon, K.FRIENDSHIP_EVENT_FAINT_SMALL);
}

export function Cmd_dofaintanimation(): void {
  if (g.battleControllerExecFlags === 0) {
    g.activeBattler = getBattlerForBattleScript(b(1));
    emitFaintAnimation(K.BUFFER_A);
    markBattlerForControllerExec(g.activeBattler);
    adv(2);
  }
}

export function Cmd_cleareffectsonfaint(): void {
  if (g.battleControllerExecFlags === 0) {
    const ab = (g.activeBattler = getBattlerForBattleScript(b(1)));
    g.battleMons[ab].status1 = 0;
    emitSetMonData(K.BUFFER_A, K.REQUEST_STATUS_BATTLE, 0, u32(0));
    markBattlerForControllerExec(ab);
    faintClearSetData(); // Effects like attractions, trapping, etc.
    adv(2);
  }
}

export function Cmd_jumpifstatus(): void {
  const battlerId = getBattlerForBattleScript(b(1));
  const flags = w(2);
  const jumpPtr = w(6);
  if (g.battleMons[battlerId].status1 & flags && g.battleMons[battlerId].hp !== 0) g.battlescriptCurrInstr = jumpPtr;
  else adv(10);
}

export function Cmd_jumpifstatus2(): void {
  const battlerId = getBattlerForBattleScript(b(1));
  const flags = w(2);
  const jumpPtr = w(6);
  if (g.battleMons[battlerId].status2 & flags && g.battleMons[battlerId].hp !== 0) g.battlescriptCurrInstr = jumpPtr;
  else adv(10);
}

export function Cmd_jumpifability(): void {
  const ability = b(2);
  const jumpPtr = w(3);
  const which = b(1);
  let battlerId: number;
  if (which === K.BS_ATTACKER_SIDE || which === K.BS_NOT_ATTACKER_SIDE) {
    const caseId = which === K.BS_ATTACKER_SIDE ? K.ABILITYEFFECT_CHECK_BATTLER_SIDE : K.ABILITYEFFECT_CHECK_OTHER_SIDE;
    battlerId = abilityBattleEffects(caseId, g.battlerAttacker, ability, 0, 0);
    if (battlerId) {
      g.lastUsedAbility = ability;
      g.battlescriptCurrInstr = jumpPtr;
      recordAbilityBattle(battlerId - 1, g.lastUsedAbility);
      g.battleScripting.battlerWithAbility = battlerId - 1;
    } else adv(7);
  } else {
    battlerId = getBattlerForBattleScript(which);
    if (g.battleMons[battlerId].ability === ability) {
      g.lastUsedAbility = ability;
      g.battlescriptCurrInstr = jumpPtr;
      recordAbilityBattle(battlerId, g.lastUsedAbility);
      g.battleScripting.battlerWithAbility = battlerId;
    } else adv(7);
  }
}

export function Cmd_jumpifsideaffecting(): void {
  const side = b(1) === K.BS_ATTACKER ? getBattlerSide(g.battlerAttacker) : getBattlerSide(g.battlerTarget);
  const flags = h(2);
  const jumpPtr = w(4);
  if (g.sideStatuses[side] & flags) g.battlescriptCurrInstr = jumpPtr;
  else adv(8);
}

/** Compare with a CMP_* operator (jumpifstat / jumpifbyte / ...). */
export function compare(op: number, value: number, operand: number): boolean {
  switch (op) {
    case K.CMP_EQUAL:
      return value === operand;
    case K.CMP_NOT_EQUAL:
      return value !== operand;
    case K.CMP_GREATER_THAN:
      return value > operand;
    case K.CMP_LESS_THAN:
      return value < operand;
    case K.CMP_COMMON_BITS:
      return (value & operand) !== 0;
    case K.CMP_NO_COMMON_BITS:
      return (value & operand) === 0;
  }
  return false;
}

export function Cmd_jumpifstat(): void {
  const battlerId = getBattlerForBattleScript(b(1));
  const value = g.battleMons[battlerId].statStages[b(3)] & 0xff; // read into a u8
  if (compare(b(2), value, b(4))) g.battlescriptCurrInstr = w(5);
  else adv(9);
}

export function Cmd_jumpifstatus3condition(): void {
  g.activeBattler = getBattlerForBattleScript(b(1));
  const status = w(2);
  const jumpPtr = w(7);
  const has = (g.statuses3[g.activeBattler] & status) !== 0;
  if (b(6)) {
    if (has) adv(11);
    else g.battlescriptCurrInstr = jumpPtr;
  } else {
    if (has) g.battlescriptCurrInstr = jumpPtr;
    else adv(11);
  }
}

export function Cmd_jumpiftype(): void {
  const battlerId = getBattlerForBattleScript(b(1));
  const type = b(2);
  const jumpPtr = w(3);
  if (isBattlerOfType(battlerId, type)) g.battlescriptCurrInstr = jumpPtr;
  else adv(7);
}
