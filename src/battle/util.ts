// battle_util.c (plus GetBattlerSide/Position/AtPosition from battle_anim_mons.c).

import { random } from '../util/random';
import { recordAbilityBattle, recordItemEffectBattle } from './ai';
import { K } from './constants';
import { emitSetMonData, markBattlerForControllerExec, emitPrintString, u32 } from './controllers';
import { bdata, g, gBattleMoves, itemHoldEffect, itemHoldEffectParam, mem, state } from './env';
import { bit } from './globals';
import {
  battleTurnPassed,
  getWhoStrikesFirst,
  runBattleScriptCommands,
  runBattleScriptCommands_PopCallbacksStack,
  swapTurnOrder,
} from './main';
import {
  calculateBaseDamage,
  calculatePPWithBonus,
  getFlavorRelationByPersonality,
  getGenderFromSpeciesAndPersonality,
  isOtherTrainer,
  partyOf,
  speciesOrEgg,
} from './pokemonBattle';
import { setMoveEffect, uproarWakeUpCheck } from './scriptCommands';
import {
  prepareAbilityBuffer,
  prepareByteNumberBuffer,
  prepareFlavorBuffer,
  prepareMonNickWithPrefixBuffer,
  prepareMoveBuffer,
  prepareStatBuffer,
  prepareStringBuffer,
  prepareTypeBuffer,
  stringCopy,
} from './textBuffers';

const mech = () => bdata.tables.mech as Record<string, number[]>;

/** ROM address of a battle script label. */
export function bs(label: string): number {
  return mem.label(label);
}

// ------------------------------------------------------------------ positions (battle_anim_mons.c)

/** GetBattlerSide */
export function getBattlerSide(battler: number): number {
  return g.battlerPositions[battler] & K.BIT_SIDE;
}

/** GetBattlerPosition */
export function getBattlerPosition(battler: number): number {
  return g.battlerPositions[battler];
}

/** GetBattlerAtPosition */
export function getBattlerAtPosition(position: number): number {
  let i = 0;
  for (; i < g.battlersCount; i++) if (g.battlerPositions[i] === position) break;
  return i;
}

/** IS_BATTLER_OF_TYPE */
export function isBattlerOfType(battler: number, type: number): boolean {
  return g.battleMons[battler].type1 === type || g.battleMons[battler].type2 === type;
}

/** SET_BATTLER_TYPE */
export function setBattlerType(battler: number, type: number): void {
  g.battleMons[battler].type1 = type;
  g.battleMons[battler].type2 = type;
}

/** MOVE_IS_PERMANENT: excludes moves learned temporarily by Transform or Mimic */
export function moveIsPermanent(battler: number, moveSlot: number): boolean {
  return !(g.battleMons[battler].status2 & K.STATUS2_TRANSFORMED) && !(g.disableStructs[battler].mimickedMoves & bit(moveSlot));
}

/** GET_MOVE_TYPE */
export function getMoveType(move: number): number {
  return g.battleStruct.dynamicMoveType ? g.battleStruct.dynamicMoveType & K.DYNAMIC_TYPE_MASK : gBattleMoves[move].type;
}

/** TARGET_TURN_DAMAGED */
export function targetTurnDamaged(): boolean {
  const s = g.specialStatuses[g.battlerTarget];
  return s.physicalDmg !== 0 || s.specialDmg !== 0;
}

/** WEATHER_HAS_EFFECT */
export function weatherHasEffect(): boolean {
  return (
    !abilityBattleEffects(K.ABILITYEFFECT_CHECK_ON_FIELD, 0, K.ABILITY_CLOUD_NINE, 0, 0) &&
    !abilityBattleEffects(K.ABILITYEFFECT_CHECK_ON_FIELD, 0, K.ABILITY_AIR_LOCK, 0, 0)
  );
}

/** WEATHER_HAS_EFFECT2 */
export function weatherHasEffect2(): boolean {
  return (
    !abilityBattleEffects(K.ABILITYEFFECT_FIELD_SPORT, 0, K.ABILITY_CLOUD_NINE, 0, 0) &&
    !abilityBattleEffects(K.ABILITYEFFECT_FIELD_SPORT, 0, K.ABILITY_AIR_LOCK, 0, 0)
  );
}

/** IS_BATTLE_TYPE_GHOST_WITHOUT_SCOPE */
export function isGhostWithoutScope(flags: number): boolean {
  return !!(flags & K.BATTLE_TYPE_GHOST) && !(flags & K.BATTLE_TYPE_GHOST_UNVEILED);
}

/** IS_BATTLE_TYPE_GHOST_WITH_SCOPE */
export function isGhostWithScope(flags: number): boolean {
  return !!(flags & K.BATTLE_TYPE_GHOST) && !!(flags & K.BATTLE_TYPE_GHOST_UNVEILED);
}

/** The battler's held-item hold effect, honouring the Enigma Berry slot. */
export function battlerHoldEffect(battler: number): number {
  const item = g.battleMons[battler].item;
  return item === K.ITEM_ENIGMA_BERRY ? g.enigmaBerries[battler].holdEffect : itemHoldEffect(item);
}

export function battlerHoldEffectParam(battler: number): number {
  const item = g.battleMons[battler].item;
  return item === K.ITEM_ENIGMA_BERRY ? g.enigmaBerries[battler].holdEffectParam : itemHoldEffectParam(item);
}

/** EmitSetMonData(REQUEST_STATUS_BATTLE) for gActiveBattler + MarkBattlerForControllerExec. */
export function sendStatus1(battler = g.activeBattler): void {
  g.activeBattler = battler;
  emitSetMonData(K.BUFFER_A, K.REQUEST_STATUS_BATTLE, 0, u32(g.battleMons[battler].status1));
  markBattlerForControllerExec(battler);
}

// ------------------------------------------------------------------ battle_util.c

/** GetBattlerForBattleScript */
export function getBattlerForBattleScript(caseId: number): number {
  switch (caseId) {
    case K.BS_TARGET:
      return g.battlerTarget;
    case K.BS_ATTACKER:
      return g.battlerAttacker;
    case K.BS_EFFECT_BATTLER:
      return g.effectBattler;
    case K.BS_BATTLER_0:
      return 0;
    case K.BS_SCRIPTING:
      return g.battleScripting.battler;
    case K.BS_FAINTED:
    case K.BS_FAINTED_LINK_MULTIPLE_1:
      return g.battlerFainted;
    case K.BS_PLAYER1:
      return getBattlerAtPosition(K.B_POSITION_PLAYER_LEFT);
    case K.BS_OPPONENT1:
      return getBattlerAtPosition(K.B_POSITION_OPPONENT_LEFT);
    default:
      return 0;
  }
}

function ppLoseAndSend(attacker: number, pos: number): void {
  if (pos !== K.MAX_MON_MOVES && moveIsPermanent(attacker, pos)) {
    g.activeBattler = attacker;
    emitSetMonData(K.BUFFER_A, K.REQUEST_PPMOVE1_BATTLE + pos, 0, [g.battleMons[attacker].pp[pos]]);
    markBattlerForControllerExec(g.activeBattler);
  }
}

/** PressurePPLose */
export function pressurePPLose(target: number, attacker: number, move: number): void {
  if (g.battleMons[target].ability !== K.ABILITY_PRESSURE) return;
  let moveIndex = 0;
  for (; moveIndex < K.MAX_MON_MOVES; moveIndex++) if (g.battleMons[attacker].moves[moveIndex] === move) break;
  if (moveIndex === K.MAX_MON_MOVES) return;
  if (g.battleMons[attacker].pp[moveIndex] !== 0) g.battleMons[attacker].pp[moveIndex]--;
  ppLoseAndSend(attacker, moveIndex);
}

function pressureOnMove(attacker: number, move: number, applies: (i: number) => boolean): void {
  let pos = K.MAX_MON_MOVES;
  for (let i = 0; i < g.battlersCount; i++) {
    if (!applies(i)) continue;
    let j = 0;
    for (; j < K.MAX_MON_MOVES; j++) if (g.battleMons[attacker].moves[j] === move) break;
    if (j !== K.MAX_MON_MOVES) {
      pos = j;
      if (g.battleMons[attacker].pp[j] !== 0) g.battleMons[attacker].pp[j]--;
    }
  }
  ppLoseAndSend(attacker, pos);
}

/** PressurePPLoseOnUsingImprison */
export function pressurePPLoseOnUsingImprison(attacker: number): void {
  const atkSide = getBattlerSide(attacker);
  pressureOnMove(attacker, K.MOVE_IMPRISON, (i) => atkSide !== getBattlerSide(i) && g.battleMons[i].ability === K.ABILITY_PRESSURE);
}

/** PressurePPLoseOnUsingPerishSong */
export function pressurePPLoseOnUsingPerishSong(attacker: number): void {
  pressureOnMove(attacker, K.MOVE_PERISH_SONG, (i) => g.battleMons[i].ability === K.ABILITY_PRESSURE && i !== attacker);
}

/** CancelMultiTurnMoves */
export function cancelMultiTurnMoves(battler: number): void {
  const m = g.battleMons[battler];
  m.status2 &= ~K.STATUS2_MULTIPLETURNS;
  m.status2 &= ~K.STATUS2_LOCK_CONFUSE;
  m.status2 &= ~K.STATUS2_UPROAR;
  m.status2 &= ~K.STATUS2_BIDE;
  g.statuses3[battler] &= ~K.STATUS3_SEMI_INVULNERABLE;
  g.disableStructs[battler].rolloutTimer = 0;
  g.disableStructs[battler].furyCutterCounter = 0;
}

/** WasUnableToUseMove */
export function wasUnableToUseMove(battler: number): boolean {
  const p = g.protectStructs[battler];
  return !!(
    p.prlzImmobility ||
    p.targetNotAffected ||
    p.usedImprisonedMove ||
    p.loveImmobility ||
    p.usedDisabledMove ||
    p.usedTauntedMove ||
    p.flag2Unknown ||
    p.flinchImmobility ||
    p.confusionSelfDmg
  );
}

/** PrepareStringBattle */
export function prepareStringBattle(stringId: number, battler: number): void {
  g.activeBattler = battler;
  emitPrintString(K.BUFFER_A, stringId);
  markBattlerForControllerExec(g.activeBattler);
}

/** ResetSentPokesToOpponentValue */
export function resetSentPokesToOpponentValue(): void {
  let bits = 0;
  g.sentPokesToOpponent[0] = 0;
  g.sentPokesToOpponent[1] = 0;
  for (let i = 0; i < g.battlersCount; i += 2) bits |= bit(g.battlerPartyIndexes[i]);
  for (let i = 1; i < g.battlersCount; i += 2) g.sentPokesToOpponent[(i & K.BIT_FLANK) >> 1] = bits;
}

/** OpponentSwitchInResetSentPokesToOpponentValue */
export function opponentSwitchInResetSentPokesToOpponentValue(battler: number): void {
  let bits = 0;
  if (getBattlerSide(battler) === K.B_SIDE_OPPONENT) {
    const flank = (battler & K.BIT_FLANK) >> 1;
    g.sentPokesToOpponent[flank] = 0;
    for (let i = 0; i < g.battlersCount; i += 2) if (!(g.absentBattlerFlags & bit(i))) bits |= bit(g.battlerPartyIndexes[i]);
    g.sentPokesToOpponent[flank] = bits;
  }
}

/** UpdateSentPokesToOpponentValue */
export function updateSentPokesToOpponentValue(battler: number): void {
  if (getBattlerSide(battler) === K.B_SIDE_OPPONENT) {
    opponentSwitchInResetSentPokesToOpponentValue(battler);
  } else {
    for (let i = 1; i < g.battlersCount; i++) g.sentPokesToOpponent[(i & K.BIT_FLANK) >> 1] |= bit(g.battlerPartyIndexes[battler]);
  }
}

/** BattleScriptPush */
export function battleScriptPush(ptr: number): void {
  const s = g.battleResources.battleScriptsStack;
  s.ptr[s.size++] = ptr;
}

/** BattleScriptPushCursor */
export function battleScriptPushCursor(): void {
  battleScriptPush(g.battlescriptCurrInstr);
}

/** BattleScriptPop */
export function battleScriptPop(): void {
  const s = g.battleResources.battleScriptsStack;
  g.battlescriptCurrInstr = s.ptr[--s.size];
}

/** TrySetCantSelectMoveBattleScript */
export function trySetCantSelectMoveBattleScript(): number {
  const ab = g.activeBattler;
  let limitations = 0;
  const slot = g.battleBufferB[ab][2];
  const move = g.battleMons[ab].moves[slot];
  const choicedMove = g.battleStruct.choicedMove[ab];

  if (g.disableStructs[ab].disabledMove === move && move !== K.MOVE_NONE) {
    g.battleScripting.battler = ab;
    g.currentMove = move;
    g.selectionBattleScripts[ab] = bs('BattleScript_SelectingDisabledMove');
    limitations = 1;
  }
  if (move === g.lastMoves[ab] && move !== K.MOVE_STRUGGLE && g.battleMons[ab].status2 & K.STATUS2_TORMENT) {
    cancelMultiTurnMoves(ab);
    g.selectionBattleScripts[ab] = bs('BattleScript_SelectingTormentedMove');
    limitations++;
  }
  if (g.disableStructs[ab].tauntTimer !== 0 && gBattleMoves[move].power === 0) {
    g.currentMove = move;
    g.selectionBattleScripts[ab] = bs('BattleScript_SelectingNotAllowedMoveTaunt');
    limitations++;
  }
  if (getImprisonedMovesCount(ab, move)) {
    g.currentMove = move;
    g.selectionBattleScripts[ab] = bs('BattleScript_SelectingImprisonedMove');
    limitations++;
  }
  const holdEffect = battlerHoldEffect(ab);
  g.potentialItemEffectBattler = ab;
  if (holdEffect === K.HOLD_EFFECT_CHOICE_BAND && choicedMove !== K.MOVE_NONE && choicedMove !== K.MOVE_UNAVAILABLE && choicedMove !== move) {
    g.currentMove = choicedMove;
    g.lastUsedItem = g.battleMons[ab].item;
    g.selectionBattleScripts[ab] = bs('BattleScript_SelectingNotAllowedMoveChoiceItem');
    limitations++;
  }
  if (g.battleMons[ab].pp[slot] === 0) {
    g.selectionBattleScripts[ab] = bs('BattleScript_SelectingMoveWithNoPP');
    limitations++;
  }
  return limitations;
}

/** CheckMoveLimitations */
export function checkMoveLimitations(battlerId: number, unusableMoves: number, check: number): number {
  const holdEffect = battlerHoldEffect(battlerId);
  const choicedMove = g.battleStruct.choicedMove[battlerId];
  const m = g.battleMons[battlerId];
  const d = g.disableStructs[battlerId];
  g.potentialItemEffectBattler = battlerId;
  for (let i = 0; i < K.MAX_MON_MOVES; i++) {
    if (m.moves[i] === K.MOVE_NONE && check & K.MOVE_LIMITATION_ZEROMOVE) unusableMoves |= bit(i);
    if (m.pp[i] === 0 && check & K.MOVE_LIMITATION_PP) unusableMoves |= bit(i);
    if (m.moves[i] === d.disabledMove && check & K.MOVE_LIMITATION_DISABLED) unusableMoves |= bit(i);
    if (m.moves[i] === g.lastMoves[battlerId] && check & K.MOVE_LIMITATION_TORMENTED && m.status2 & K.STATUS2_TORMENT) unusableMoves |= bit(i);
    if (d.tauntTimer && check & K.MOVE_LIMITATION_TAUNT && gBattleMoves[m.moves[i]].power === 0) unusableMoves |= bit(i);
    if (getImprisonedMovesCount(battlerId, m.moves[i]) && check & K.MOVE_LIMITATION_IMPRISON) unusableMoves |= bit(i);
    if (d.encoreTimer && d.encoredMove !== m.moves[i]) unusableMoves |= bit(i);
    if (holdEffect === K.HOLD_EFFECT_CHOICE_BAND && choicedMove !== K.MOVE_NONE && choicedMove !== K.MOVE_UNAVAILABLE && choicedMove !== m.moves[i])
      unusableMoves |= bit(i);
  }
  return unusableMoves & 0xff;
}

/** AreAllMovesUnusable */
export function areAllMovesUnusable(): boolean {
  const ALL_MOVES_MASK = (1 << K.MAX_MON_MOVES) - 1;
  const ab = g.activeBattler;
  const unusable = checkMoveLimitations(ab, 0, K.MOVE_LIMITATIONS_ALL);
  if (unusable === ALL_MOVES_MASK) {
    g.protectStructs[ab].noValidMoves = 1;
    g.selectionBattleScripts[ab] = bs('BattleScript_NoMovesLeft');
    if (g.battleTypeFlags & K.BATTLE_TYPE_DOUBLE) g.battleBufferB[ab][3] = getBattlerAtPosition((getBattlerPosition(ab) ^ 1) | (random() & 2));
    else g.battleBufferB[ab][3] = getBattlerAtPosition(getBattlerPosition(ab) ^ 1);
  } else {
    g.protectStructs[ab].noValidMoves = 0;
  }
  return unusable === ALL_MOVES_MASK;
}

/** GetImprisonedMovesCount */
export function getImprisonedMovesCount(battlerId: number, move: number): number {
  let imprisonedMoves = 0;
  const battlerSide = getBattlerSide(battlerId);
  for (let i = 0; i < g.battlersCount; i++) {
    if (battlerSide !== getBattlerSide(i) && g.statuses3[i] & K.STATUS3_IMPRISONED_OTHERS) {
      let j = 0;
      for (; j < K.MAX_MON_MOVES; j++) if (move === g.battleMons[i].moves[j]) break;
      if (j < K.MAX_MON_MOVES) imprisonedMoves++;
    }
  }
  return imprisonedMoves;
}

const ENDTURN_ORDER = 0,
  ENDTURN_REFLECT = 1,
  ENDTURN_LIGHT_SCREEN = 2,
  ENDTURN_MIST = 3,
  ENDTURN_SAFEGUARD = 4,
  ENDTURN_WISH = 5,
  ENDTURN_RAIN = 6,
  ENDTURN_SANDSTORM = 7,
  ENDTURN_SUN = 8,
  ENDTURN_HAIL = 9,
  ENDTURN_FIELD_COUNT = 10;

/** DoFieldEndTurnEffects */
export function doFieldEndTurnEffects(): boolean {
  let effect = 0;
  const bst = g.battleStruct;
  g.battlerAttacker = 0;
  while (g.battlerAttacker < g.battlersCount && g.absentBattlerFlags & bit(g.battlerAttacker)) g.battlerAttacker++;
  g.battlerTarget = 0;
  while (g.battlerTarget < g.battlersCount && g.absentBattlerFlags & bit(g.battlerTarget)) g.battlerTarget++;

  const sideTimerCase = (
    has: (side: number) => boolean,
    battlerOf: (side: number) => number,
    tick: (side: number) => boolean,
    onEnd: (side: number) => void,
  ) => {
    while (bst.turnSideTracker < 2) {
      const side = bst.turnSideTracker;
      g.activeBattler = g.battlerAttacker = battlerOf(side);
      if (has(side) && tick(side)) {
        onEnd(side);
        effect++;
      }
      bst.turnSideTracker++;
      if (effect !== 0) break;
    }
    if (effect === 0) {
      bst.turnCountersTracker++;
      bst.turnSideTracker = 0;
    }
  };

  do {
    switch (bst.turnCountersTracker) {
      case ENDTURN_ORDER:
        for (let i = 0; i < g.battlersCount; i++) g.battlerByTurnOrder[i] = i;
        for (let i = 0; i < g.battlersCount - 1; i++)
          for (let j = i + 1; j < g.battlersCount; j++) if (getWhoStrikesFirst(g.battlerByTurnOrder[i], g.battlerByTurnOrder[j], false)) swapTurnOrder(i, j);
        bst.turnCountersTracker++;
        bst.turnSideTracker = 0;
      // fall through
      case ENDTURN_REFLECT:
        if (bst.turnCountersTracker !== ENDTURN_REFLECT) break;
        sideTimerCase(
          (s) => !!(g.sideStatuses[s] & K.SIDE_STATUS_REFLECT),
          (s) => g.sideTimers[s].reflectBattlerId,
          (s) => (g.sideTimers[s].reflectTimer = (g.sideTimers[s].reflectTimer - 1) & 0xff) === 0,
          (s) => {
            g.sideStatuses[s] &= ~K.SIDE_STATUS_REFLECT;
            battleScriptExecute(bs('BattleScript_SideStatusWoreOff'));
            prepareMoveBuffer(g.battleTextBuff1, K.MOVE_REFLECT);
          },
        );
        break;
      case ENDTURN_LIGHT_SCREEN:
        sideTimerCase(
          (s) => !!(g.sideStatuses[s] & K.SIDE_STATUS_LIGHTSCREEN),
          (s) => g.sideTimers[s].lightscreenBattlerId,
          (s) => (g.sideTimers[s].lightscreenTimer = (g.sideTimers[s].lightscreenTimer - 1) & 0xff) === 0,
          (s) => {
            g.sideStatuses[s] &= ~K.SIDE_STATUS_LIGHTSCREEN;
            battleScriptExecute(bs('BattleScript_SideStatusWoreOff'));
            g.battleCommunication[K.MULTISTRING_CHOOSER] = s;
            prepareMoveBuffer(g.battleTextBuff1, K.MOVE_LIGHT_SCREEN);
          },
        );
        break;
      case ENDTURN_MIST:
        sideTimerCase(
          (s) => g.sideTimers[s].mistTimer !== 0,
          (s) => g.sideTimers[s].mistBattlerId,
          (s) => (g.sideTimers[s].mistTimer = (g.sideTimers[s].mistTimer - 1) & 0xff) === 0,
          (s) => {
            g.sideStatuses[s] &= ~K.SIDE_STATUS_MIST;
            battleScriptExecute(bs('BattleScript_SideStatusWoreOff'));
            g.battleCommunication[K.MULTISTRING_CHOOSER] = s;
            prepareMoveBuffer(g.battleTextBuff1, K.MOVE_MIST);
          },
        );
        break;
      case ENDTURN_SAFEGUARD:
        sideTimerCase(
          (s) => !!(g.sideStatuses[s] & K.SIDE_STATUS_SAFEGUARD),
          (s) => g.sideTimers[s].safeguardBattlerId,
          (s) => (g.sideTimers[s].safeguardTimer = (g.sideTimers[s].safeguardTimer - 1) & 0xff) === 0,
          (s) => {
            g.sideStatuses[s] &= ~K.SIDE_STATUS_SAFEGUARD;
            battleScriptExecute(bs('BattleScript_SafeguardEnds'));
          },
        );
        break;
      case ENDTURN_WISH:
        while (bst.turnSideTracker < g.battlersCount) {
          g.activeBattler = g.battlerByTurnOrder[bst.turnSideTracker];
          const wf = g.wishFutureKnock;
          if (wf.wishCounter[g.activeBattler] !== 0 && --wf.wishCounter[g.activeBattler] === 0 && g.battleMons[g.activeBattler].hp !== 0) {
            g.battlerTarget = g.activeBattler;
            battleScriptExecute(bs('BattleScript_WishComesTrue'));
            effect++;
          }
          bst.turnSideTracker++;
          if (effect !== 0) break;
        }
        if (effect === 0) bst.turnCountersTracker++;
        break;
      case ENDTURN_RAIN:
        if (g.battleWeather & K.B_WEATHER_RAIN) {
          const mc = g.battleCommunication;
          if (!(g.battleWeather & K.B_WEATHER_RAIN_PERMANENT)) {
            g.wishFutureKnock.weatherDuration = (g.wishFutureKnock.weatherDuration - 1) & 0xff;
            if (g.wishFutureKnock.weatherDuration === 0) {
              g.battleWeather &= ~K.B_WEATHER_RAIN_TEMPORARY;
              g.battleWeather &= ~K.B_WEATHER_RAIN_DOWNPOUR;
              mc[K.MULTISTRING_CHOOSER] = K.B_MSG_RAIN_STOPPED;
            } else if (g.battleWeather & K.B_WEATHER_RAIN_DOWNPOUR) mc[K.MULTISTRING_CHOOSER] = K.B_MSG_DOWNPOUR_CONTINUES;
            else mc[K.MULTISTRING_CHOOSER] = K.B_MSG_RAIN_CONTINUES;
          } else if (g.battleWeather & K.B_WEATHER_RAIN_DOWNPOUR) {
            mc[K.MULTISTRING_CHOOSER] = K.B_MSG_DOWNPOUR_CONTINUES;
          } else {
            mc[K.MULTISTRING_CHOOSER] = K.B_MSG_RAIN_CONTINUES;
          }
          battleScriptExecute(bs('BattleScript_RainContinuesOrEnds'));
          effect++;
        }
        bst.turnCountersTracker++;
        break;
      case ENDTURN_SANDSTORM:
        if (g.battleWeather & K.B_WEATHER_SANDSTORM) {
          if (!(g.battleWeather & K.B_WEATHER_SANDSTORM_PERMANENT) && (g.wishFutureKnock.weatherDuration = (g.wishFutureKnock.weatherDuration - 1) & 0xff) === 0) {
            g.battleWeather &= ~K.B_WEATHER_SANDSTORM_TEMPORARY;
            g.battlescriptCurrInstr = bs('BattleScript_SandStormHailEnds');
          } else {
            g.battlescriptCurrInstr = bs('BattleScript_DamagingWeatherContinues');
          }
          g.battleScripting.animArg1 = K.B_ANIM_SANDSTORM_CONTINUES;
          g.battleCommunication[K.MULTISTRING_CHOOSER] = K.B_MSG_SANDSTORM;
          battleScriptExecute(g.battlescriptCurrInstr);
          effect++;
        }
        bst.turnCountersTracker++;
        break;
      case ENDTURN_SUN:
        if (g.battleWeather & K.B_WEATHER_SUN) {
          if (!(g.battleWeather & K.B_WEATHER_SUN_PERMANENT) && (g.wishFutureKnock.weatherDuration = (g.wishFutureKnock.weatherDuration - 1) & 0xff) === 0) {
            g.battleWeather &= ~K.B_WEATHER_SUN_TEMPORARY;
            g.battlescriptCurrInstr = bs('BattleScript_SunlightFaded');
          } else {
            g.battlescriptCurrInstr = bs('BattleScript_SunlightContinues');
          }
          battleScriptExecute(g.battlescriptCurrInstr);
          effect++;
        }
        bst.turnCountersTracker++;
        break;
      case ENDTURN_HAIL:
        if (g.battleWeather & K.B_WEATHER_HAIL) {
          if ((g.wishFutureKnock.weatherDuration = (g.wishFutureKnock.weatherDuration - 1) & 0xff) === 0) {
            g.battleWeather &= ~K.B_WEATHER_HAIL_TEMPORARY;
            g.battlescriptCurrInstr = bs('BattleScript_SandStormHailEnds');
          } else {
            g.battlescriptCurrInstr = bs('BattleScript_DamagingWeatherContinues');
          }
          g.battleScripting.animArg1 = K.B_ANIM_HAIL_CONTINUES;
          g.battleCommunication[K.MULTISTRING_CHOOSER] = K.B_MSG_HAIL;
          battleScriptExecute(g.battlescriptCurrInstr);
          effect++;
        }
        bst.turnCountersTracker++;
        break;
      case ENDTURN_FIELD_COUNT:
        effect++;
        break;
    }
  } while (effect === 0);
  return g.battleMainFunc !== battleTurnPassed;
}

const ENDTURN_INGRAIN = 0,
  ENDTURN_ABILITIES = 1,
  ENDTURN_ITEMS1 = 2,
  ENDTURN_LEECH_SEED = 3,
  ENDTURN_POISON = 4,
  ENDTURN_BAD_POISON = 5,
  ENDTURN_BURN = 6,
  ENDTURN_NIGHTMARES = 7,
  ENDTURN_CURSE = 8,
  ENDTURN_WRAP = 9,
  ENDTURN_UPROAR = 10,
  ENDTURN_THRASH = 11,
  ENDTURN_DISABLE = 12,
  ENDTURN_ENCORE = 13,
  ENDTURN_LOCK_ON = 14,
  ENDTURN_CHARGE = 15,
  ENDTURN_TAUNT = 16,
  ENDTURN_YAWN = 17,
  ENDTURN_ITEMS2 = 18,
  ENDTURN_BATTLER_COUNT = 19;

/** DoBattlerEndTurnEffects */
export function doBattlerEndTurnEffects(): number {
  let effect = 0;
  const bst = g.battleStruct;
  g.hitMarker |= K.HITMARKER_GRUDGE | K.HITMARKER_SKIP_DMG_TRACK;
  while (bst.turnEffectsBattlerId < g.battlersCount && bst.turnEffectsTracker <= ENDTURN_BATTLER_COUNT) {
    const ab = (g.activeBattler = g.battlerAttacker = g.battlerByTurnOrder[bst.turnEffectsBattlerId]);
    const m = g.battleMons[ab];
    const d = g.disableStructs[ab];
    if (g.absentBattlerFlags & bit(ab)) {
      bst.turnEffectsBattlerId++;
      continue;
    }
    const minDmg = (v: number) => (g.battleMoveDamage = v === 0 ? 1 : v);
    switch (bst.turnEffectsTracker) {
      case ENDTURN_INGRAIN:
        if (g.statuses3[ab] & K.STATUS3_ROOTED && m.hp !== m.maxHP && m.hp !== 0) {
          minDmg(Math.trunc(m.maxHP / 16));
          g.battleMoveDamage *= -1;
          battleScriptExecute(bs('BattleScript_IngrainTurnHeal'));
          effect++;
        }
        bst.turnEffectsTracker++;
        break;
      case ENDTURN_ABILITIES:
        if (abilityBattleEffects(K.ABILITYEFFECT_ENDTURN, ab, 0, 0, 0)) effect++;
        bst.turnEffectsTracker++;
        break;
      case ENDTURN_ITEMS1:
        if (itemBattleEffects(K.ITEMEFFECT_NORMAL, ab, false)) effect++;
        bst.turnEffectsTracker++;
        break;
      case ENDTURN_ITEMS2:
        if (itemBattleEffects(K.ITEMEFFECT_NORMAL, ab, true)) effect++;
        bst.turnEffectsTracker++;
        break;
      case ENDTURN_LEECH_SEED:
        if (g.statuses3[ab] & K.STATUS3_LEECHSEED && g.battleMons[g.statuses3[ab] & K.STATUS3_LEECHSEED_BATTLER].hp !== 0 && m.hp !== 0) {
          g.battlerTarget = g.statuses3[ab] & K.STATUS3_LEECHSEED_BATTLER; // Notice gBattlerTarget is actually the HP receiver.
          minDmg(Math.trunc(m.maxHP / 8));
          g.battleScripting.animArg1 = g.battlerTarget;
          g.battleScripting.animArg2 = g.battlerAttacker;
          battleScriptExecute(bs('BattleScript_LeechSeedTurnDrain'));
          effect++;
        }
        bst.turnEffectsTracker++;
        break;
      case ENDTURN_POISON:
        if (m.status1 & K.STATUS1_POISON && m.hp !== 0) {
          minDmg(Math.trunc(m.maxHP / 8));
          battleScriptExecute(bs('BattleScript_PoisonTurnDmg'));
          effect++;
        }
        bst.turnEffectsTracker++;
        break;
      case ENDTURN_BAD_POISON:
        if (m.status1 & K.STATUS1_TOXIC_POISON && m.hp !== 0) {
          minDmg(Math.trunc(m.maxHP / 16));
          if ((m.status1 & K.STATUS1_TOXIC_COUNTER) !== 15 << 8) m.status1 += 1 << 8; // STATUS1_TOXIC_TURN(1)
          g.battleMoveDamage *= (m.status1 & K.STATUS1_TOXIC_COUNTER) >> 8;
          battleScriptExecute(bs('BattleScript_PoisonTurnDmg'));
          effect++;
        }
        bst.turnEffectsTracker++;
        break;
      case ENDTURN_BURN:
        if (m.status1 & K.STATUS1_BURN && m.hp !== 0) {
          minDmg(Math.trunc(m.maxHP / 8));
          battleScriptExecute(bs('BattleScript_BurnTurnDmg'));
          effect++;
        }
        bst.turnEffectsTracker++;
        break;
      case ENDTURN_NIGHTMARES:
        if (m.status2 & K.STATUS2_NIGHTMARE && m.hp !== 0) {
          // R/S does not perform this sleep check (see the decomp comment).
          if (m.status1 & K.STATUS1_SLEEP) {
            minDmg(Math.trunc(m.maxHP / 4));
            battleScriptExecute(bs('BattleScript_NightmareTurnDmg'));
            effect++;
          } else {
            m.status2 &= ~K.STATUS2_NIGHTMARE;
          }
        }
        bst.turnEffectsTracker++;
        break;
      case ENDTURN_CURSE:
        if (m.status2 & K.STATUS2_CURSED && m.hp !== 0) {
          minDmg(Math.trunc(m.maxHP / 4));
          battleScriptExecute(bs('BattleScript_CurseTurnDmg'));
          effect++;
        }
        bst.turnEffectsTracker++;
        break;
      case ENDTURN_WRAP:
        if (m.status2 & K.STATUS2_WRAPPED && m.hp !== 0) {
          m.status2 -= 1 << 13; // STATUS2_WRAPPED_TURN(1)
          const t = g.battleTextBuff1;
          t[0] = K.B_BUFF_PLACEHOLDER_BEGIN;
          t[1] = K.B_BUFF_MOVE;
          t[2] = bst.wrappedMove[ab * 2 + 0];
          t[3] = bst.wrappedMove[ab * 2 + 1];
          t[4] = 0xff;
          if (m.status2 & K.STATUS2_WRAPPED) {
            // damaged by wrap
            g.battleScripting.animArg1 = bst.wrappedMove[ab * 2 + 0];
            g.battleScripting.animArg2 = bst.wrappedMove[ab * 2 + 1];
            g.battlescriptCurrInstr = bs('BattleScript_WrapTurnDmg');
            minDmg(Math.trunc(m.maxHP / 16));
          } else {
            g.battlescriptCurrInstr = bs('BattleScript_WrapEnds');
          }
          battleScriptExecute(g.battlescriptCurrInstr);
          effect++;
        }
        bst.turnEffectsTracker++;
        break;
      case ENDTURN_UPROAR:
        if (m.status2 & K.STATUS2_UPROAR) {
          for (g.battlerAttacker = 0; g.battlerAttacker < g.battlersCount; g.battlerAttacker++) {
            const a = g.battleMons[g.battlerAttacker];
            if (a.status1 & K.STATUS1_SLEEP && a.ability !== K.ABILITY_SOUNDPROOF) {
              a.status1 &= ~K.STATUS1_SLEEP;
              a.status2 &= ~K.STATUS2_NIGHTMARE;
              g.battleCommunication[K.MULTISTRING_CHOOSER] = 1;
              battleScriptExecute(bs('BattleScript_MonWokeUpInUproar'));
              sendStatus1(g.battlerAttacker);
              break;
            }
          }
          if (g.battlerAttacker !== g.battlersCount) {
            effect = 2; // a pokemon was awaken
            break;
          } else {
            g.battlerAttacker = g.activeBattler;
            m.status2 -= 1 << 4; // STATUS2_UPROAR_TURN(1)
            if (wasUnableToUseMove(g.activeBattler)) {
              cancelMultiTurnMoves(g.activeBattler);
              g.battleCommunication[K.MULTISTRING_CHOOSER] = K.B_MSG_UPROAR_ENDS;
            } else if (m.status2 & K.STATUS2_UPROAR) {
              g.battleCommunication[K.MULTISTRING_CHOOSER] = K.B_MSG_UPROAR_CONTINUES;
              m.status2 |= K.STATUS2_MULTIPLETURNS;
            } else {
              g.battleCommunication[K.MULTISTRING_CHOOSER] = K.B_MSG_UPROAR_ENDS;
              cancelMultiTurnMoves(g.activeBattler);
            }
            battleScriptExecute(bs('BattleScript_PrintUproarOverTurns'));
            effect = 1;
          }
        }
        if (effect !== 2) bst.turnEffectsTracker++;
        break;
      case ENDTURN_THRASH:
        if (m.status2 & K.STATUS2_LOCK_CONFUSE) {
          m.status2 -= 1 << 10; // STATUS2_LOCK_CONFUSE_TURN(1)
          if (wasUnableToUseMove(ab)) cancelMultiTurnMoves(ab);
          else if (!(m.status2 & K.STATUS2_LOCK_CONFUSE) && m.status2 & K.STATUS2_MULTIPLETURNS) {
            m.status2 &= ~K.STATUS2_MULTIPLETURNS;
            if (!(m.status2 & K.STATUS2_CONFUSION)) {
              g.battleCommunication[K.MOVE_EFFECT_BYTE] = K.MOVE_EFFECT_CONFUSION | K.MOVE_EFFECT_AFFECTS_USER;
              setMoveEffect(true, 0);
              if (m.status2 & K.STATUS2_CONFUSION) battleScriptExecute(bs('BattleScript_ThrashConfuses'));
              effect++;
            }
          }
        }
        bst.turnEffectsTracker++;
        break;
      case ENDTURN_DISABLE:
        if (d.disableTimer !== 0) {
          let i = 0;
          for (; i < K.MAX_MON_MOVES; i++) if (d.disabledMove === m.moves[i]) break;
          if (i === K.MAX_MON_MOVES) {
            // pokemon does not have the disabled move anymore
            d.disabledMove = K.MOVE_NONE;
            d.disableTimer = 0;
          } else if (--d.disableTimer === 0) {
            d.disabledMove = K.MOVE_NONE;
            battleScriptExecute(bs('BattleScript_DisabledNoMore'));
            effect++;
          }
        }
        bst.turnEffectsTracker++;
        break;
      case ENDTURN_ENCORE:
        if (d.encoreTimer !== 0) {
          if (m.moves[d.encoredMovePos] !== d.encoredMove) {
            d.encoredMove = K.MOVE_NONE;
            d.encoreTimer = 0;
          } else if (--d.encoreTimer === 0 || m.pp[d.encoredMovePos] === 0) {
            d.encoredMove = K.MOVE_NONE;
            d.encoreTimer = 0;
            battleScriptExecute(bs('BattleScript_EncoredNoMore'));
            effect++;
          }
        }
        bst.turnEffectsTracker++;
        break;
      case ENDTURN_LOCK_ON:
        if (g.statuses3[ab] & K.STATUS3_ALWAYS_HITS) g.statuses3[ab] -= (1 << 3) & K.STATUS3_ALWAYS_HITS;
        bst.turnEffectsTracker++;
        break;
      case ENDTURN_CHARGE:
        if (d.chargeTimer && --d.chargeTimer === 0) g.statuses3[ab] &= ~K.STATUS3_CHARGED_UP;
        bst.turnEffectsTracker++;
        break;
      case ENDTURN_TAUNT:
        if (d.tauntTimer) d.tauntTimer--;
        bst.turnEffectsTracker++;
        break;
      case ENDTURN_YAWN:
        if (g.statuses3[ab] & K.STATUS3_YAWN) {
          g.statuses3[ab] -= (1 << 11) & K.STATUS3_YAWN;
          if (
            !(g.statuses3[ab] & K.STATUS3_YAWN) &&
            !(m.status1 & K.STATUS1_ANY) &&
            m.ability !== K.ABILITY_VITAL_SPIRIT &&
            m.ability !== K.ABILITY_INSOMNIA &&
            !uproarWakeUpCheck(ab)
          ) {
            cancelMultiTurnMoves(ab);
            m.status1 |= (random() & 3) + 2; // STATUS1_SLEEP_TURN: 2-5 turns of sleep
            sendStatus1(ab);
            g.effectBattler = ab;
            battleScriptExecute(bs('BattleScript_YawnMakesAsleep'));
            effect++;
          }
        }
        bst.turnEffectsTracker++;
        break;
      case ENDTURN_BATTLER_COUNT:
        bst.turnEffectsTracker = 0;
        bst.turnEffectsBattlerId++;
        break;
    }
    if (effect !== 0) return effect;
  }
  g.hitMarker &= ~(K.HITMARKER_GRUDGE | K.HITMARKER_SKIP_DMG_TRACK);
  return 0;
}

/** HandleWishPerishSongOnTurnEnd */
export function handleWishPerishSongOnTurnEnd(): boolean {
  const bst = g.battleStruct;
  g.hitMarker |= K.HITMARKER_GRUDGE | K.HITMARKER_SKIP_DMG_TRACK;
  switch (bst.wishPerishSongState) {
    case 0:
      while (bst.wishPerishSongBattlerId < g.battlersCount) {
        const ab = (g.activeBattler = bst.wishPerishSongBattlerId);
        if (g.absentBattlerFlags & bit(ab)) {
          bst.wishPerishSongBattlerId++;
          continue;
        }
        bst.wishPerishSongBattlerId++;
        const wf = g.wishFutureKnock;
        if (wf.futureSightCounter[ab] !== 0 && --wf.futureSightCounter[ab] === 0 && g.battleMons[ab].hp !== 0) {
          g.battleCommunication[K.MULTISTRING_CHOOSER] = wf.futureSightMove[ab] === K.MOVE_FUTURE_SIGHT ? K.B_MSG_FUTURE_SIGHT : K.B_MSG_DOOM_DESIRE;
          prepareMoveBuffer(g.battleTextBuff1, wf.futureSightMove[ab]);
          g.battlerTarget = ab;
          g.battlerAttacker = wf.futureSightAttacker[ab];
          g.battleMoveDamage = wf.futureSightDmg[ab];
          g.specialStatuses[g.battlerTarget].dmg = 0xffff;
          battleScriptExecute(bs('BattleScript_MonTookFutureAttack'));
          return true;
        }
      }
      bst.wishPerishSongState = 1;
      bst.wishPerishSongBattlerId = 0;
    // fall through
    case 1:
      while (bst.wishPerishSongBattlerId < g.battlersCount) {
        const ab = (g.activeBattler = g.battlerAttacker = g.battlerByTurnOrder[bst.wishPerishSongBattlerId]);
        if (g.absentBattlerFlags & bit(ab)) {
          bst.wishPerishSongBattlerId++;
          continue;
        }
        bst.wishPerishSongBattlerId++;
        if (g.statuses3[ab] & K.STATUS3_PERISH_SONG) {
          prepareByteNumberBuffer(g.battleTextBuff1, 1, g.disableStructs[ab].perishSongTimer);
          if (g.disableStructs[ab].perishSongTimer === 0) {
            g.statuses3[ab] &= ~K.STATUS3_PERISH_SONG;
            g.battleMoveDamage = g.battleMons[ab].hp;
            g.battlescriptCurrInstr = bs('BattleScript_PerishSongTakesLife');
          } else {
            g.disableStructs[ab].perishSongTimer--;
            g.battlescriptCurrInstr = bs('BattleScript_PerishSongCountGoesDown');
          }
          battleScriptExecute(g.battlescriptCurrInstr);
          return true;
        }
      }
      break;
  }
  g.hitMarker &= ~(K.HITMARKER_GRUDGE | K.HITMARKER_SKIP_DMG_TRACK);
  return false;
}

const FAINTED_ACTIONS_MAX_CASE = 7;

/** HandleFaintedMonActions */
export function handleFaintedMonActions(): boolean {
  const bst = g.battleStruct;
  if (g.battleTypeFlags & K.BATTLE_TYPE_SAFARI) return false;
  do {
    switch (bst.faintedActionsState) {
      case 0:
        bst.faintedActionsBattlerId = 0;
        bst.faintedActionsState++;
        for (let i = 0; i < g.battlersCount; i++)
          if (g.absentBattlerFlags & bit(i) && !hasNoMonsToSwitch(i, K.PARTY_SIZE, K.PARTY_SIZE)) g.absentBattlerFlags &= ~bit(i);
      // fall through
      case 1:
        if (bst.faintedActionsState === 1) {
          do {
            g.battlerFainted = g.battlerTarget = bst.faintedActionsBattlerId;
            const id = bst.faintedActionsBattlerId;
            if (g.battleMons[id].hp === 0 && !(bst.givenExpMons & bit(g.battlerPartyIndexes[id])) && !(g.absentBattlerFlags & bit(id))) {
              battleScriptExecute(bs('BattleScript_GiveExp'));
              bst.faintedActionsState = 2;
              return true;
            }
          } while (++bst.faintedActionsBattlerId !== g.battlersCount);
          bst.faintedActionsState = 3;
        }
        break;
      case 2:
        opponentSwitchInResetSentPokesToOpponentValue(g.battlerFainted);
        if (++bst.faintedActionsBattlerId === g.battlersCount) bst.faintedActionsState = 3;
        else bst.faintedActionsState = 1;
        break;
      case 3:
        bst.faintedActionsBattlerId = 0;
        bst.faintedActionsState++;
      // fall through
      case 4:
        do {
          g.battlerFainted = g.battlerTarget = bst.faintedActionsBattlerId;
          const id = bst.faintedActionsBattlerId;
          if (g.battleMons[id].hp === 0 && !(g.absentBattlerFlags & bit(id))) {
            battleScriptExecute(bs('BattleScript_HandleFaintedMon'));
            bst.faintedActionsState = 5;
            return true;
          }
        } while (++bst.faintedActionsBattlerId !== g.battlersCount);
        bst.faintedActionsState = 6;
        break;
      case 5:
        if (++bst.faintedActionsBattlerId === g.battlersCount) bst.faintedActionsState = 6;
        else bst.faintedActionsState = 4;
        break;
      case 6:
        if (
          abilityBattleEffects(K.ABILITYEFFECT_INTIMIDATE1, 0, 0, 0, 0) ||
          abilityBattleEffects(K.ABILITYEFFECT_TRACE, 0, 0, 0, 0) ||
          itemBattleEffects(K.ITEMEFFECT_NORMAL, 0, true) ||
          abilityBattleEffects(K.ABILITYEFFECT_FORECAST, 0, 0, 0, 0)
        )
          return true;
        bst.faintedActionsState++;
        break;
      case FAINTED_ACTIONS_MAX_CASE:
        break;
    }
  } while (bst.faintedActionsState !== FAINTED_ACTIONS_MAX_CASE);
  return false;
}

/** TryClearRageStatuses */
export function tryClearRageStatuses(): void {
  for (let i = 0; i < g.battlersCount; i++)
    if (g.battleMons[i].status2 & K.STATUS2_RAGE && g.chosenMoveByBattler[i] !== K.MOVE_RAGE) g.battleMons[i].status2 &= ~K.STATUS2_RAGE;
}

const CANCELLER_FLAGS = 0,
  CANCELLER_ASLEEP = 1,
  CANCELLER_FROZEN = 2,
  CANCELLER_TRUANT = 3,
  CANCELLER_RECHARGE = 4,
  CANCELLER_FLINCH = 5,
  CANCELLER_DISABLED = 6,
  CANCELLER_TAUNTED = 7,
  CANCELLER_IMPRISONED = 8,
  CANCELLER_CONFUSED = 9,
  CANCELLER_PARALYSED = 10,
  CANCELLER_GHOST = 11,
  CANCELLER_IN_LOVE = 12,
  CANCELLER_BIDE = 13,
  CANCELLER_THAW = 14,
  CANCELLER_END = 15;

/** AtkCanceller_UnableToUseMove */
export function atkCanceller_UnableToUseMove(): number {
  let effect = 0;
  const bst = g.battleStruct;
  const atk = g.battlerAttacker;
  const m = g.battleMons[atk];
  do {
    switch (bst.atkCancellerTracker) {
      case CANCELLER_FLAGS:
        m.status2 &= ~K.STATUS2_DESTINY_BOND;
        g.statuses3[atk] &= ~K.STATUS3_GRUDGE;
        bst.atkCancellerTracker++;
        break;
      case CANCELLER_ASLEEP:
        if (m.status1 & K.STATUS1_SLEEP) {
          if (uproarWakeUpCheck(atk)) {
            m.status1 &= ~K.STATUS1_SLEEP;
            m.status2 &= ~K.STATUS2_NIGHTMARE;
            battleScriptPushCursor();
            g.battleCommunication[K.MULTISTRING_CHOOSER] = K.B_MSG_WOKE_UP_UPROAR;
            g.battlescriptCurrInstr = bs('BattleScript_MoveUsedWokeUp');
            effect = 2;
          } else {
            const toSub = m.ability === K.ABILITY_EARLY_BIRD ? 2 : 1;
            if ((m.status1 & K.STATUS1_SLEEP) < toSub) m.status1 &= ~K.STATUS1_SLEEP;
            else m.status1 -= toSub;
            if (m.status1 & K.STATUS1_SLEEP) {
              if (g.currentMove !== K.MOVE_SNORE && g.currentMove !== K.MOVE_SLEEP_TALK) {
                g.battlescriptCurrInstr = bs('BattleScript_MoveUsedIsAsleep');
                g.hitMarker |= K.HITMARKER_UNABLE_TO_USE_MOVE;
                effect = 2;
              }
            } else {
              m.status2 &= ~K.STATUS2_NIGHTMARE;
              battleScriptPushCursor();
              g.battleCommunication[K.MULTISTRING_CHOOSER] = K.B_MSG_WOKE_UP;
              g.battlescriptCurrInstr = bs('BattleScript_MoveUsedWokeUp');
              effect = 2;
            }
          }
        }
        bst.atkCancellerTracker++;
        break;
      case CANCELLER_FROZEN:
        if (m.status1 & K.STATUS1_FREEZE) {
          if (random() % 5) {
            if (gBattleMoves[g.currentMove].effect !== K.EFFECT_THAW_HIT) {
              // unfreezing via a move effect happens in case 13
              g.battlescriptCurrInstr = bs('BattleScript_MoveUsedIsFrozen');
              g.hitMarker |= K.HITMARKER_NO_ATTACKSTRING;
            } else {
              bst.atkCancellerTracker++;
              break;
            }
          } else {
            m.status1 &= ~K.STATUS1_FREEZE;
            battleScriptPushCursor();
            g.battlescriptCurrInstr = bs('BattleScript_MoveUsedUnfroze');
            g.battleCommunication[K.MULTISTRING_CHOOSER] = K.B_MSG_DEFROSTED;
          }
          effect = 2;
        }
        bst.atkCancellerTracker++;
        break;
      case CANCELLER_TRUANT:
        if (m.ability === K.ABILITY_TRUANT && g.disableStructs[atk].truantCounter) {
          cancelMultiTurnMoves(atk);
          g.hitMarker |= K.HITMARKER_UNABLE_TO_USE_MOVE;
          g.battleCommunication[K.MULTISTRING_CHOOSER] = K.B_MSG_LOAFING;
          g.battlescriptCurrInstr = bs('BattleScript_MoveUsedLoafingAround');
          g.moveResultFlags |= K.MOVE_RESULT_MISSED;
          effect = 1;
        }
        bst.atkCancellerTracker++;
        break;
      case CANCELLER_RECHARGE:
        if (m.status2 & K.STATUS2_RECHARGE) {
          m.status2 &= ~K.STATUS2_RECHARGE;
          g.disableStructs[atk].rechargeTimer = 0;
          cancelMultiTurnMoves(atk);
          g.battlescriptCurrInstr = bs('BattleScript_MoveUsedMustRecharge');
          g.hitMarker |= K.HITMARKER_UNABLE_TO_USE_MOVE;
          effect = 1;
        }
        bst.atkCancellerTracker++;
        break;
      case CANCELLER_FLINCH:
        if (m.status2 & K.STATUS2_FLINCHED) {
          m.status2 &= ~K.STATUS2_FLINCHED;
          g.protectStructs[atk].flinchImmobility = 1;
          cancelMultiTurnMoves(atk);
          g.battlescriptCurrInstr = bs('BattleScript_MoveUsedFlinched');
          g.hitMarker |= K.HITMARKER_UNABLE_TO_USE_MOVE;
          effect = 1;
        }
        bst.atkCancellerTracker++;
        break;
      case CANCELLER_DISABLED:
        if (g.disableStructs[atk].disabledMove === g.currentMove && g.disableStructs[atk].disabledMove !== K.MOVE_NONE) {
          g.protectStructs[atk].usedDisabledMove = 1;
          g.battleScripting.battler = atk;
          cancelMultiTurnMoves(atk);
          g.battlescriptCurrInstr = bs('BattleScript_MoveUsedIsDisabled');
          g.hitMarker |= K.HITMARKER_UNABLE_TO_USE_MOVE;
          effect = 1;
        }
        bst.atkCancellerTracker++;
        break;
      case CANCELLER_TAUNTED:
        if (g.disableStructs[atk].tauntTimer && gBattleMoves[g.currentMove].power === 0) {
          g.protectStructs[atk].usedTauntedMove = 1;
          cancelMultiTurnMoves(atk);
          g.battlescriptCurrInstr = bs('BattleScript_MoveUsedIsTaunted');
          g.hitMarker |= K.HITMARKER_UNABLE_TO_USE_MOVE;
          effect = 1;
        }
        bst.atkCancellerTracker++;
        break;
      case CANCELLER_IMPRISONED:
        if (getImprisonedMovesCount(atk, g.currentMove)) {
          g.protectStructs[atk].usedImprisonedMove = 1;
          cancelMultiTurnMoves(atk);
          g.battlescriptCurrInstr = bs('BattleScript_MoveUsedIsImprisoned');
          g.hitMarker |= K.HITMARKER_UNABLE_TO_USE_MOVE;
          effect = 1;
        }
        bst.atkCancellerTracker++;
        break;
      case CANCELLER_CONFUSED:
        if (m.status2 & K.STATUS2_CONFUSION) {
          m.status2 -= 1; // STATUS2_CONFUSION_TURN(1)
          if (m.status2 & K.STATUS2_CONFUSION) {
            if (random() & 1) {
              // MULTISTRING_CHOOSER signals whether damage was taken
              g.battleCommunication[K.MULTISTRING_CHOOSER] = 0;
              battleScriptPushCursor();
            } else {
              g.battleCommunication[K.MULTISTRING_CHOOSER] = 1;
              g.battlerTarget = atk;
              g.battleMoveDamage = calculateBaseDamage(m, m, K.MOVE_POUND, 0, 40, 0, atk, atk);
              g.protectStructs[atk].confusionSelfDmg = 1;
              g.hitMarker |= K.HITMARKER_UNABLE_TO_USE_MOVE;
            }
            g.battlescriptCurrInstr = bs('BattleScript_MoveUsedIsConfused');
          } else {
            battleScriptPushCursor();
            g.battlescriptCurrInstr = bs('BattleScript_MoveUsedIsConfusedNoMore');
          }
          effect = 1;
        }
        bst.atkCancellerTracker++;
        break;
      case CANCELLER_PARALYSED:
        if (m.status1 & K.STATUS1_PARALYSIS && random() % 4 === 0) {
          g.protectStructs[atk].prlzImmobility = 1;
          g.battlescriptCurrInstr = bs('BattleScript_MoveUsedIsParalyzed');
          g.hitMarker |= K.HITMARKER_UNABLE_TO_USE_MOVE;
          effect = 1;
        }
        bst.atkCancellerTracker++;
        break;
      case CANCELLER_GHOST:
        if (isGhostWithoutScope(g.battleTypeFlags)) {
          g.battlescriptCurrInstr = bs(getBattlerSide(atk) === K.B_SIDE_PLAYER ? 'BattleScript_TooScaredToMove' : 'BattleScript_GhostGetOutGetOut');
          g.battleCommunication[K.MULTISTRING_CHOOSER] = 0;
          effect = 1;
        }
        bst.atkCancellerTracker++;
        break;
      case CANCELLER_IN_LOVE:
        if (m.status2 & K.STATUS2_INFATUATION) {
          g.battleScripting.battler = countTrailingZeroBits((m.status2 & K.STATUS2_INFATUATION) >>> 16);
          if (random() & 1) {
            battleScriptPushCursor();
          } else {
            battleScriptPush(bs('BattleScript_MoveUsedIsInLoveCantAttack'));
            g.hitMarker |= K.HITMARKER_UNABLE_TO_USE_MOVE;
            g.protectStructs[atk].loveImmobility = 1;
            cancelMultiTurnMoves(atk);
          }
          g.battlescriptCurrInstr = bs('BattleScript_MoveUsedIsInLove');
          effect = 1;
        }
        bst.atkCancellerTracker++;
        break;
      case CANCELLER_BIDE:
        if (m.status2 & K.STATUS2_BIDE) {
          m.status2 -= (1 << 8) & K.STATUS2_BIDE; // STATUS2_BIDE_TURN(1)
          if (m.status2 & K.STATUS2_BIDE) {
            g.battlescriptCurrInstr = bs('BattleScript_BideStoringEnergy');
          } else if (g.takenDmg[atk]) {
            g.currentMove = K.MOVE_BIDE;
            g.battleScripting.bideDmg = g.takenDmg[atk] * 2;
            g.battlerTarget = g.takenDmgByBattler[atk];
            if (g.absentBattlerFlags & bit(g.battlerTarget)) g.battlerTarget = getMoveTarget(K.MOVE_BIDE, K.MOVE_TARGET_SELECTED + 1);
            g.battlescriptCurrInstr = bs('BattleScript_BideAttack');
          } else {
            g.battlescriptCurrInstr = bs('BattleScript_BideNoEnergyToAttack');
          }
          effect = 1;
        }
        bst.atkCancellerTracker++;
        break;
      case CANCELLER_THAW:
        if (m.status1 & K.STATUS1_FREEZE) {
          if (gBattleMoves[g.currentMove].effect === K.EFFECT_THAW_HIT) {
            m.status1 &= ~K.STATUS1_FREEZE;
            battleScriptPushCursor();
            g.battlescriptCurrInstr = bs('BattleScript_MoveUsedUnfroze');
            g.battleCommunication[K.MULTISTRING_CHOOSER] = K.B_MSG_DEFROSTED_BY_MOVE;
          }
          effect = 2;
        }
        bst.atkCancellerTracker++;
        break;
      case CANCELLER_END:
        break;
    }
  } while (bst.atkCancellerTracker !== CANCELLER_END && effect === 0);

  if (effect === 2) sendStatus1(atk);
  return effect;
}

function countTrailingZeroBits(v: number): number {
  for (let i = 0; i < 32; i++) if (v & (1 << i)) return i;
  return 32;
}

function aliveSwitchable(party: (import('../pokemon/Pokemon').Pokemon | undefined)[], i: number): boolean {
  const mon = party[i];
  return (mon?.hp ?? 0) !== 0 && speciesOrEgg(mon) !== K.SPECIES_NONE && speciesOrEgg(mon) !== K.SPECIES_EGG;
}

/** HasNoMonsToSwitch (multi battles aren't supported) */
export function hasNoMonsToSwitch(battler: number, partyIdBattlerOn1: number, partyIdBattlerOn2: number): boolean {
  if (!(g.battleTypeFlags & K.BATTLE_TYPE_DOUBLE)) return false;
  let flankId: number, playerId: number;
  if (getBattlerSide(battler) === K.B_SIDE_OPPONENT) {
    flankId = getBattlerAtPosition(K.B_POSITION_OPPONENT_LEFT);
    playerId = getBattlerAtPosition(K.B_POSITION_OPPONENT_RIGHT);
  } else {
    flankId = getBattlerAtPosition(K.B_POSITION_PLAYER_LEFT);
    playerId = getBattlerAtPosition(K.B_POSITION_PLAYER_RIGHT);
  }
  const party = partyOf(battler);
  if (partyIdBattlerOn1 === K.PARTY_SIZE) partyIdBattlerOn1 = g.battlerPartyIndexes[flankId];
  if (partyIdBattlerOn2 === K.PARTY_SIZE) partyIdBattlerOn2 = g.battlerPartyIndexes[playerId];
  let i = 0;
  for (; i < K.PARTY_SIZE; i++) {
    if (
      aliveSwitchable(party, i) &&
      i !== partyIdBattlerOn1 &&
      i !== partyIdBattlerOn2 &&
      i !== g.battleStruct.monToSwitchIntoId[flankId] &&
      i !== g.battleStruct.monToSwitchIntoId[playerId]
    )
      break;
  }
  return i === K.PARTY_SIZE;
}

/** CastformDataTypeChange */
export function castformDataTypeChange(battler: number): number {
  const CASTFORM_NO_CHANGE = 0,
    CASTFORM_TO_NORMAL = 1,
    CASTFORM_TO_FIRE = 2,
    CASTFORM_TO_WATER = 3,
    CASTFORM_TO_ICE = 4;
  let formChange = 0;
  const m = g.battleMons[battler];
  if (m.species !== K.SPECIES_CASTFORM || m.ability !== K.ABILITY_FORECAST || m.hp === 0) return CASTFORM_NO_CHANGE;
  if (!weatherHasEffect() && !isBattlerOfType(battler, K.TYPE_NORMAL)) {
    setBattlerType(battler, K.TYPE_NORMAL);
    return CASTFORM_TO_NORMAL;
  }
  if (!weatherHasEffect()) return CASTFORM_NO_CHANGE;
  if (!(g.battleWeather & (K.B_WEATHER_RAIN | K.B_WEATHER_SUN | K.B_WEATHER_HAIL)) && !isBattlerOfType(battler, K.TYPE_NORMAL)) {
    setBattlerType(battler, K.TYPE_NORMAL);
    formChange = CASTFORM_TO_NORMAL;
  }
  if (g.battleWeather & K.B_WEATHER_SUN && !isBattlerOfType(battler, K.TYPE_FIRE)) {
    setBattlerType(battler, K.TYPE_FIRE);
    formChange = CASTFORM_TO_FIRE;
  }
  if (g.battleWeather & K.B_WEATHER_RAIN && !isBattlerOfType(battler, K.TYPE_WATER)) {
    setBattlerType(battler, K.TYPE_WATER);
    formChange = CASTFORM_TO_WATER;
  }
  if (g.battleWeather & K.B_WEATHER_HAIL && !isBattlerOfType(battler, K.TYPE_ICE)) {
    setBattlerType(battler, K.TYPE_ICE);
    formChange = CASTFORM_TO_ICE;
  }
  return formChange;
}

/** gStatusConditionString_*Jpn (battle_main.c): Japanese status names copied into gBattleTextBuff1. */
function statusJpn(name: 'Poison' | 'Sleep' | 'Paralysis' | 'Burn' | 'Ice' | 'Confusion' | 'Love'): number[] {
  return encodeBattleString(bdata.strings.strings[`gStatusConditionString_${name}Jpn`] ?? '$');
}

let encodeBattleString: (raw: string) => number[] = () => [0xff];
/** Set by the message module once the charmap is available. */
export function setBattleStringEncoder(fn: (raw: string) => number[]): void {
  encodeBattleString = fn;
}

/** AbilityBattleEffects */
export function abilityBattleEffects(caseID: number, battler: number, ability: number, special: number, moveArg: number): number {
  let effect = 0;
  if (g.battlerAttacker >= g.battlersCount) g.battlerAttacker = battler;
  const pokeAtk = partyOf(g.battlerAttacker)[g.battlerPartyIndexes[g.battlerAttacker]];
  if (g.battlerTarget >= g.battlersCount) g.battlerTarget = battler;
  const pokeDef = partyOf(g.battlerTarget)[g.battlerPartyIndexes[g.battlerTarget]];
  const speciesAtk = pokeAtk?.species ?? 0;
  const pidAtk = pokeAtk?.personality ?? 0;
  const speciesDef = pokeDef?.species ?? 0;
  const pidDef = pokeDef?.personality ?? 0;

  if (g.battleTypeFlags & K.BATTLE_TYPE_SAFARI) return effect; // Why isn't that check done at the beginning?

  g.lastUsedAbility = special ? special : g.battleMons[battler].ability;
  const move = moveArg ? moveArg : g.currentMove;
  const moveType = getMoveType(move);

  if (isGhostWithoutScope(g.battleTypeFlags) && (g.lastUsedAbility === K.ABILITY_INTIMIDATE || g.lastUsedAbility === K.ABILITY_TRACE)) return effect;

  const atk = () => g.battleMons[g.battlerAttacker];
  const contactStatus = (chance: () => boolean, moveEffect: number) => {
    if (
      !(g.moveResultFlags & K.MOVE_RESULT_NO_EFFECT) &&
      atk().hp !== 0 &&
      !g.protectStructs[g.battlerAttacker].confusionSelfDmg &&
      targetTurnDamaged() &&
      gBattleMoves[move].flags & K.FLAG_MAKES_CONTACT &&
      chance()
    ) {
      g.battleCommunication[K.MOVE_EFFECT_BYTE] = K.MOVE_EFFECT_AFFECTS_USER | moveEffect;
      battleScriptPushCursor();
      g.battlescriptCurrInstr = bs('BattleScript_ApplySecondaryEffect');
      g.hitMarker |= K.HITMARKER_STATUS_ABILITY_EFFECT;
      effect++;
    }
  };

  switch (caseID) {
    case K.ABILITYEFFECT_ON_SWITCHIN:
      if (g.battlerAttacker >= g.battlersCount) g.battlerAttacker = battler;
      switch (g.lastUsedAbility) {
        case K.ABILITYEFFECT_SWITCH_IN_WEATHER: {
          const weather = getCurrentWeather();
          if (weather === K.WEATHER_RAIN || weather === K.WEATHER_RAIN_THUNDERSTORM || weather === K.WEATHER_DOWNPOUR) {
            if (!(g.battleWeather & K.B_WEATHER_RAIN)) {
              g.battleWeather = K.B_WEATHER_RAIN_TEMPORARY | K.B_WEATHER_RAIN_PERMANENT;
              g.battleScripting.animArg1 = K.B_ANIM_RAIN_CONTINUES;
              g.battleScripting.battler = battler;
              effect++;
            }
          } else if (weather === K.WEATHER_SANDSTORM) {
            if (!(g.battleWeather & K.B_WEATHER_SANDSTORM)) {
              g.battleWeather = K.B_WEATHER_SANDSTORM;
              g.battleScripting.animArg1 = K.B_ANIM_SANDSTORM_CONTINUES;
              g.battleScripting.battler = battler;
              effect++;
            }
          } else if (weather === K.WEATHER_DROUGHT) {
            if (!(g.battleWeather & K.B_WEATHER_SUN)) {
              g.battleWeather = K.B_WEATHER_SUN;
              g.battleScripting.animArg1 = K.B_ANIM_SUN_CONTINUES;
              g.battleScripting.battler = battler;
              effect++;
            }
          }
          if (effect !== 0) {
            g.battleCommunication[K.MULTISTRING_CHOOSER] = weather;
            battleScriptPushCursorAndCallback(bs('BattleScript_OverworldWeatherStarts'));
          }
          break;
        }
        case K.ABILITY_DRIZZLE:
          if (!(g.battleWeather & K.B_WEATHER_RAIN_PERMANENT)) {
            g.battleWeather = K.B_WEATHER_RAIN_PERMANENT | K.B_WEATHER_RAIN_TEMPORARY;
            battleScriptPushCursorAndCallback(bs('BattleScript_DrizzleActivates'));
            g.battleScripting.battler = battler;
            effect++;
          }
          break;
        case K.ABILITY_SAND_STREAM:
          if (!(g.battleWeather & K.B_WEATHER_SANDSTORM_PERMANENT)) {
            g.battleWeather = K.B_WEATHER_SANDSTORM;
            battleScriptPushCursorAndCallback(bs('BattleScript_SandstreamActivates'));
            g.battleScripting.battler = battler;
            effect++;
          }
          break;
        case K.ABILITY_DROUGHT:
          if (!(g.battleWeather & K.B_WEATHER_SUN_PERMANENT)) {
            g.battleWeather = K.B_WEATHER_SUN;
            battleScriptPushCursorAndCallback(bs('BattleScript_DroughtActivates'));
            g.battleScripting.battler = battler;
            effect++;
          }
          break;
        case K.ABILITY_INTIMIDATE:
          if (!g.specialStatuses[battler].intimidatedMon) {
            g.statuses3[battler] |= K.STATUS3_INTIMIDATE_POKES;
            g.specialStatuses[battler].intimidatedMon = 1;
          }
          break;
        case K.ABILITY_FORECAST:
          effect = castformDataTypeChange(battler);
          if (effect !== 0) {
            battleScriptPushCursorAndCallback(bs('BattleScript_CastformChange'));
            g.battleScripting.battler = battler;
            g.battleStruct.formToChangeInto = effect - 1;
          }
          break;
        case K.ABILITY_TRACE:
          if (!g.specialStatuses[battler].traced) {
            g.statuses3[battler] |= K.STATUS3_TRACE;
            g.specialStatuses[battler].traced = 1;
          }
          break;
        case K.ABILITY_CLOUD_NINE:
        case K.ABILITY_AIR_LOCK:
          for (let target1 = 0; target1 < g.battlersCount; target1++) {
            effect = castformDataTypeChange(target1);
            if (effect !== 0) {
              battleScriptPushCursorAndCallback(bs('BattleScript_CastformChange'));
              g.battleScripting.battler = target1;
              g.battleStruct.formToChangeInto = effect - 1;
              break;
            }
          }
          break;
      }
      break;
    case K.ABILITYEFFECT_ENDTURN:
      if (g.battleMons[battler].hp !== 0) {
        const m = g.battleMons[battler];
        g.battlerAttacker = battler;
        switch (g.lastUsedAbility) {
          case K.ABILITY_RAIN_DISH:
            if (weatherHasEffect() && g.battleWeather & K.B_WEATHER_RAIN && m.maxHP > m.hp) {
              g.lastUsedAbility = K.ABILITY_RAIN_DISH; // why
              battleScriptPushCursorAndCallback(bs('BattleScript_RainDishActivates'));
              g.battleMoveDamage = Math.trunc(m.maxHP / 16) || 1;
              g.battleMoveDamage *= -1;
              effect++;
            }
            break;
          case K.ABILITY_SHED_SKIN:
            if (m.status1 & K.STATUS1_ANY && random() % 3 === 0) {
              if (m.status1 & (K.STATUS1_POISON | K.STATUS1_TOXIC_POISON)) stringCopy(g.battleTextBuff1, statusJpn('Poison'));
              if (m.status1 & K.STATUS1_SLEEP) stringCopy(g.battleTextBuff1, statusJpn('Sleep'));
              if (m.status1 & K.STATUS1_PARALYSIS) stringCopy(g.battleTextBuff1, statusJpn('Paralysis'));
              if (m.status1 & K.STATUS1_BURN) stringCopy(g.battleTextBuff1, statusJpn('Burn'));
              if (m.status1 & K.STATUS1_FREEZE) stringCopy(g.battleTextBuff1, statusJpn('Ice'));
              m.status1 = 0;
              m.status2 &= ~K.STATUS2_NIGHTMARE; // fix nightmare glitch
              g.battleScripting.battler = g.activeBattler = battler;
              battleScriptPushCursorAndCallback(bs('BattleScript_ShedSkinActivates'));
              sendStatus1(battler);
              effect++;
            }
            break;
          case K.ABILITY_SPEED_BOOST:
            if (m.statStages[K.STAT_SPEED] < K.MAX_STAT_STAGE && g.disableStructs[battler].isFirstTurn !== 2) {
              m.statStages[K.STAT_SPEED]++;
              g.battleScripting.animArg1 = 14 + K.STAT_SPEED;
              g.battleScripting.animArg2 = 0;
              battleScriptPushCursorAndCallback(bs('BattleScript_SpeedBoostActivates'));
              g.battleScripting.battler = battler;
              effect++;
            }
            break;
          case K.ABILITY_TRUANT:
            g.disableStructs[g.battlerAttacker].truantCounter ^= 1;
            break;
        }
      }
      break;
    case K.ABILITYEFFECT_MOVES_BLOCK:
      if (g.lastUsedAbility === K.ABILITY_SOUNDPROOF) {
        const table = mech().sSoundMovesTable;
        let i = 0;
        for (; table[i] !== 0xffff; i++) if (table[i] === move) break;
        if (table[i] !== 0xffff) {
          if (atk().status2 & K.STATUS2_MULTIPLETURNS) g.hitMarker |= K.HITMARKER_NO_PPDEDUCT;
          g.battlescriptCurrInstr = bs('BattleScript_SoundproofProtected');
          effect = 1;
        }
      }
      break;
    case K.ABILITYEFFECT_ABSORBING:
      if (move) {
        const notFirst = g.protectStructs[g.battlerAttacker].notFirstStrike;
        switch (g.lastUsedAbility) {
          case K.ABILITY_VOLT_ABSORB:
            if (moveType === K.TYPE_ELECTRIC && gBattleMoves[move].power !== 0) {
              g.battlescriptCurrInstr = bs(notFirst ? 'BattleScript_MoveHPDrain' : 'BattleScript_MoveHPDrain_PPLoss');
              effect = 1;
            }
            break;
          case K.ABILITY_WATER_ABSORB:
            if (moveType === K.TYPE_WATER && gBattleMoves[move].power !== 0) {
              g.battlescriptCurrInstr = bs(notFirst ? 'BattleScript_MoveHPDrain' : 'BattleScript_MoveHPDrain_PPLoss');
              effect = 1;
            }
            break;
          case K.ABILITY_FLASH_FIRE:
            if (moveType === K.TYPE_FIRE && !(g.battleMons[battler].status1 & K.STATUS1_FREEZE)) {
              if (!(g.battleResources.flags[battler] & K.RESOURCE_FLAG_FLASH_FIRE)) {
                g.battleCommunication[K.MULTISTRING_CHOOSER] = K.B_MSG_FLASH_FIRE_BOOST;
                g.battleResources.flags[battler] |= K.RESOURCE_FLAG_FLASH_FIRE;
              } else {
                g.battleCommunication[K.MULTISTRING_CHOOSER] = K.B_MSG_FLASH_FIRE_NO_BOOST;
              }
              g.battlescriptCurrInstr = bs(notFirst ? 'BattleScript_FlashFireBoost' : 'BattleScript_FlashFireBoost_PPLoss');
              effect = 2;
            }
            break;
        }
        if (effect === 1) {
          const m = g.battleMons[battler];
          if (m.maxHP === m.hp) {
            g.battlescriptCurrInstr = bs(notFirst ? 'BattleScript_MonMadeMoveUseless' : 'BattleScript_MonMadeMoveUseless_PPLoss');
          } else {
            g.battleMoveDamage = Math.trunc(m.maxHP / 4) || 1;
            g.battleMoveDamage *= -1;
          }
        }
      }
      break;
    case K.ABILITYEFFECT_ON_DAMAGE: // Think contact abilities.
      switch (g.lastUsedAbility) {
        case K.ABILITY_COLOR_CHANGE:
          if (
            !(g.moveResultFlags & K.MOVE_RESULT_NO_EFFECT) &&
            move !== K.MOVE_STRUGGLE &&
            gBattleMoves[move].power !== 0 &&
            targetTurnDamaged() &&
            !isBattlerOfType(battler, moveType) &&
            g.battleMons[battler].hp !== 0
          ) {
            setBattlerType(battler, moveType);
            prepareTypeBuffer(g.battleTextBuff1, moveType);
            battleScriptPushCursor();
            g.battlescriptCurrInstr = bs('BattleScript_ColorChangeActivates');
            effect++;
          }
          break;
        case K.ABILITY_ROUGH_SKIN:
          if (
            !(g.moveResultFlags & K.MOVE_RESULT_NO_EFFECT) &&
            atk().hp !== 0 &&
            !g.protectStructs[g.battlerAttacker].confusionSelfDmg &&
            targetTurnDamaged() &&
            gBattleMoves[move].flags & K.FLAG_MAKES_CONTACT
          ) {
            g.battleMoveDamage = Math.trunc(atk().maxHP / 16) || 1;
            battleScriptPushCursor();
            g.battlescriptCurrInstr = bs('BattleScript_RoughSkinActivates');
            effect++;
          }
          break;
        case K.ABILITY_EFFECT_SPORE:
          if (
            !(g.moveResultFlags & K.MOVE_RESULT_NO_EFFECT) &&
            atk().hp !== 0 &&
            !g.protectStructs[g.battlerAttacker].confusionSelfDmg &&
            targetTurnDamaged() &&
            gBattleMoves[move].flags & K.FLAG_MAKES_CONTACT &&
            random() % 10 === 0
          ) {
            const mc = g.battleCommunication;
            do {
              mc[K.MOVE_EFFECT_BYTE] = random() & 3;
            } while (mc[K.MOVE_EFFECT_BYTE] === 0);
            if (mc[K.MOVE_EFFECT_BYTE] === K.MOVE_EFFECT_BURN) mc[K.MOVE_EFFECT_BYTE] += 2; // 5 MOVE_EFFECT_PARALYSIS
            mc[K.MOVE_EFFECT_BYTE] += K.MOVE_EFFECT_AFFECTS_USER;
            battleScriptPushCursor();
            g.battlescriptCurrInstr = bs('BattleScript_ApplySecondaryEffect');
            g.hitMarker |= K.HITMARKER_STATUS_ABILITY_EFFECT;
            effect++;
          }
          break;
        case K.ABILITY_POISON_POINT:
          contactStatus(() => random() % 3 === 0, K.MOVE_EFFECT_POISON);
          break;
        case K.ABILITY_STATIC:
          contactStatus(() => random() % 3 === 0, K.MOVE_EFFECT_PARALYSIS);
          break;
        case K.ABILITY_FLAME_BODY:
          contactStatus(() => random() % 3 === 0, K.MOVE_EFFECT_BURN);
          break;
        case K.ABILITY_CUTE_CHARM: {
          const genderAtk = getGenderFromSpeciesAndPersonality(speciesAtk, pidAtk);
          const genderDef = getGenderFromSpeciesAndPersonality(speciesDef, pidDef);
          if (
            !(g.moveResultFlags & K.MOVE_RESULT_NO_EFFECT) &&
            atk().hp !== 0 &&
            !g.protectStructs[g.battlerAttacker].confusionSelfDmg &&
            gBattleMoves[move].flags & K.FLAG_MAKES_CONTACT &&
            targetTurnDamaged() &&
            g.battleMons[g.battlerTarget].hp !== 0 &&
            random() % 3 === 0 &&
            atk().ability !== K.ABILITY_OBLIVIOUS &&
            genderAtk !== genderDef &&
            !(atk().status2 & K.STATUS2_INFATUATION) &&
            genderAtk !== K.MON_GENDERLESS &&
            genderDef !== K.MON_GENDERLESS
          ) {
            atk().status2 |= bit(g.battlerTarget) << 16; // STATUS2_INFATUATED_WITH
            battleScriptPushCursor();
            g.battlescriptCurrInstr = bs('BattleScript_CuteCharmActivates');
            effect++;
          }
          break;
        }
      }
      break;
    case K.ABILITYEFFECT_IMMUNITY:
      for (battler = 0; battler < g.battlersCount; battler++) {
        const m = g.battleMons[battler];
        switch (m.ability) {
          case K.ABILITY_IMMUNITY:
            if (m.status1 & (K.STATUS1_POISON | K.STATUS1_TOXIC_POISON | K.STATUS1_TOXIC_COUNTER)) {
              stringCopy(g.battleTextBuff1, statusJpn('Poison'));
              effect = 1;
            }
            break;
          case K.ABILITY_OWN_TEMPO:
            if (m.status2 & K.STATUS2_CONFUSION) {
              stringCopy(g.battleTextBuff1, statusJpn('Confusion'));
              effect = 2;
            }
            break;
          case K.ABILITY_LIMBER:
            if (m.status1 & K.STATUS1_PARALYSIS) {
              stringCopy(g.battleTextBuff1, statusJpn('Paralysis'));
              effect = 1;
            }
            break;
          case K.ABILITY_INSOMNIA:
          case K.ABILITY_VITAL_SPIRIT:
            if (m.status1 & K.STATUS1_SLEEP) {
              m.status2 &= ~K.STATUS2_NIGHTMARE;
              stringCopy(g.battleTextBuff1, statusJpn('Sleep'));
              effect = 1;
            }
            break;
          case K.ABILITY_WATER_VEIL:
            if (m.status1 & K.STATUS1_BURN) {
              stringCopy(g.battleTextBuff1, statusJpn('Burn'));
              effect = 1;
            }
            break;
          case K.ABILITY_MAGMA_ARMOR:
            if (m.status1 & K.STATUS1_FREEZE) {
              stringCopy(g.battleTextBuff1, statusJpn('Ice'));
              effect = 1;
            }
            break;
          case K.ABILITY_OBLIVIOUS:
            if (m.status2 & K.STATUS2_INFATUATION) {
              stringCopy(g.battleTextBuff1, statusJpn('Love'));
              effect = 3;
            }
            break;
        }
        if (effect !== 0) {
          if (effect === 1) m.status1 = 0;
          else if (effect === 2) m.status2 &= ~K.STATUS2_CONFUSION;
          else if (effect === 3) m.status2 &= ~K.STATUS2_INFATUATION;
          battleScriptPushCursor();
          g.battlescriptCurrInstr = bs('BattleScript_AbilityCuredStatus');
          g.battleScripting.battler = battler;
          sendStatus1(battler);
          return effect;
        }
      }
      break;
    case K.ABILITYEFFECT_FORECAST:
      for (battler = 0; battler < g.battlersCount; battler++) {
        if (g.battleMons[battler].ability === K.ABILITY_FORECAST) {
          effect = castformDataTypeChange(battler);
          if (effect !== 0) {
            battleScriptPushCursorAndCallback(bs('BattleScript_CastformChange'));
            g.battleScripting.battler = battler;
            g.battleStruct.formToChangeInto = effect - 1;
            return effect;
          }
        }
      }
      break;
    case K.ABILITYEFFECT_SYNCHRONIZE:
    case K.ABILITYEFFECT_ATK_SYNCHRONIZE:
      if (g.lastUsedAbility === K.ABILITY_SYNCHRONIZE && g.hitMarker & K.HITMARKER_SYNCHRONISE_EFFECT) {
        const bst = g.battleStruct;
        g.hitMarker &= ~K.HITMARKER_SYNCHRONISE_EFFECT;
        bst.synchronizeMoveEffect &= ~(K.MOVE_EFFECT_AFFECTS_USER | K.MOVE_EFFECT_CERTAIN);
        if (bst.synchronizeMoveEffect === K.MOVE_EFFECT_TOXIC) bst.synchronizeMoveEffect = K.MOVE_EFFECT_POISON;
        if (caseID === K.ABILITYEFFECT_SYNCHRONIZE) {
          g.battleCommunication[K.MOVE_EFFECT_BYTE] = bst.synchronizeMoveEffect + K.MOVE_EFFECT_AFFECTS_USER;
          g.battleScripting.battler = g.battlerTarget;
        } else {
          g.battleCommunication[K.MOVE_EFFECT_BYTE] = bst.synchronizeMoveEffect;
          g.battleScripting.battler = g.battlerAttacker;
        }
        battleScriptPushCursor();
        g.battlescriptCurrInstr = bs('BattleScript_SynchronizeActivates');
        g.hitMarker |= K.HITMARKER_STATUS_ABILITY_EFFECT;
        effect++;
      }
      break;
    case K.ABILITYEFFECT_INTIMIDATE1:
    case K.ABILITYEFFECT_INTIMIDATE2:
      for (let i = 0; i < g.battlersCount; i++) {
        if (g.battleMons[i].ability === K.ABILITY_INTIMIDATE && g.statuses3[i] & K.STATUS3_INTIMIDATE_POKES) {
          g.lastUsedAbility = K.ABILITY_INTIMIDATE;
          g.statuses3[i] &= ~K.STATUS3_INTIMIDATE_POKES;
          if (caseID === K.ABILITYEFFECT_INTIMIDATE1) {
            battleScriptPushCursorAndCallback(bs('BattleScript_IntimidateActivatesEnd3'));
          } else {
            battleScriptPushCursor();
            g.battlescriptCurrInstr = bs('BattleScript_IntimidateActivates');
          }
          g.battleStruct.intimidateBattler = i;
          effect++;
          break;
        }
      }
      break;
    case K.ABILITYEFFECT_TRACE:
      for (let i = 0; i < g.battlersCount; i++) {
        if (g.battleMons[i].ability === K.ABILITY_TRACE && g.statuses3[i] & K.STATUS3_TRACE) {
          const side = (getBattlerPosition(i) ^ K.BIT_SIDE) & K.BIT_SIDE; // side of the opposing pokemon
          const target1 = getBattlerAtPosition(side);
          const target2 = getBattlerAtPosition(side + K.BIT_FLANK);
          const t1 = g.battleMons[target1];
          const t2 = g.battleMons[target2];
          if (g.battleTypeFlags & K.BATTLE_TYPE_DOUBLE) {
            if (t1.ability !== K.ABILITY_NONE && t1.hp !== 0 && t2.ability !== K.ABILITY_NONE && t2.hp !== 0) {
              g.activeBattler = getBattlerAtPosition(((random() & 1) * 2) | side);
              effect++;
            } else if (t1.ability !== K.ABILITY_NONE && t1.hp !== 0) {
              g.activeBattler = target1;
              effect++;
            } else if (t2.ability !== K.ABILITY_NONE && t2.hp !== 0) {
              g.activeBattler = target2;
              effect++;
            }
            if (effect) {
              g.battleMons[i].ability = g.battleMons[g.activeBattler].ability;
              g.lastUsedAbility = g.battleMons[g.activeBattler].ability;
            }
          } else {
            g.activeBattler = target1;
            if (t1.ability && t1.hp) {
              g.battleMons[i].ability = t1.ability;
              g.lastUsedAbility = t1.ability;
              effect++;
            }
          }
          if (effect !== 0) {
            battleScriptPushCursorAndCallback(bs('BattleScript_TraceActivates'));
            g.statuses3[i] &= ~K.STATUS3_TRACE;
            g.battleScripting.battler = i;
            prepareMonNickWithPrefixBuffer(g.battleTextBuff1, g.activeBattler, g.battlerPartyIndexes[g.activeBattler]);
            prepareAbilityBuffer(g.battleTextBuff2, g.lastUsedAbility);
            break;
          }
        }
      }
      break;
    case K.ABILITYEFFECT_CHECK_OTHER_SIDE: {
      const side = getBattlerSide(battler);
      for (let i = 0; i < g.battlersCount; i++)
        if (getBattlerSide(i) !== side && g.battleMons[i].ability === ability) {
          g.lastUsedAbility = ability;
          effect = i + 1;
        }
      break;
    }
    case K.ABILITYEFFECT_CHECK_BATTLER_SIDE: {
      const side = getBattlerSide(battler);
      for (let i = 0; i < g.battlersCount; i++)
        if (getBattlerSide(i) === side && g.battleMons[i].ability === ability) {
          g.lastUsedAbility = ability;
          effect = i + 1;
        }
      break;
    }
    case K.ABILITYEFFECT_FIELD_SPORT:
      switch (g.lastUsedAbility) {
        case K.ABILITYEFFECT_MUD_SPORT:
          for (let i = 0; i < g.battlersCount; i++) if (g.statuses3[i] & K.STATUS3_MUDSPORT) effect = i + 1;
          break;
        case K.ABILITYEFFECT_WATER_SPORT:
          for (let i = 0; i < g.battlersCount; i++) if (g.statuses3[i] & K.STATUS3_WATERSPORT) effect = i + 1;
          break;
        default:
          for (let i = 0; i < g.battlersCount; i++)
            if (g.battleMons[i].ability === ability) {
              g.lastUsedAbility = ability;
              effect = i + 1;
            }
          break;
      }
      break;
    case K.ABILITYEFFECT_CHECK_ON_FIELD:
      for (let i = 0; i < g.battlersCount; i++)
        if (g.battleMons[i].ability === ability && g.battleMons[i].hp !== 0) {
          g.lastUsedAbility = ability;
          effect = i + 1;
        }
      break;
    case K.ABILITYEFFECT_CHECK_FIELD_EXCEPT_BATTLER: {
      const side = getBattlerSide(battler);
      for (let i = 0; i < g.battlersCount; i++)
        if (getBattlerSide(i) !== side && g.battleMons[i].ability === ability) {
          g.lastUsedAbility = ability;
          effect = i + 1;
          break;
        }
      if (effect === 0)
        for (let i = 0; i < g.battlersCount; i++)
          if (g.battleMons[i].ability === ability && getBattlerSide(i) === side && i !== battler) {
            g.lastUsedAbility = ability;
            effect = i + 1;
          }
      break;
    }
    case K.ABILITYEFFECT_COUNT_OTHER_SIDE: {
      const side = getBattlerSide(battler);
      for (let i = 0; i < g.battlersCount; i++)
        if (getBattlerSide(i) !== side && g.battleMons[i].ability === ability) {
          g.lastUsedAbility = ability;
          effect++;
        }
      break;
    }
    case K.ABILITYEFFECT_COUNT_BATTLER_SIDE: {
      const side = getBattlerSide(battler);
      for (let i = 0; i < g.battlersCount; i++)
        if (getBattlerSide(i) === side && g.battleMons[i].ability === ability) {
          g.lastUsedAbility = ability;
          effect++;
        }
      break;
    }
    case K.ABILITYEFFECT_COUNT_ON_FIELD:
      for (let i = 0; i < g.battlersCount; i++)
        if (g.battleMons[i].ability === ability && i !== battler) {
          g.lastUsedAbility = ability;
          effect++;
        }
      break;
  }

  if (effect && caseID < K.ABILITYEFFECT_CHECK_OTHER_SIDE && g.lastUsedAbility !== 0xff) recordAbilityBattle(battler, g.lastUsedAbility);
  return effect;
}

/** GetCurrentWeather: the overworld weather the battle started in. */
export function getCurrentWeather(): number {
  return g.overworldWeather;
}

/** BattleScriptExecute */
export function battleScriptExecute(ptr: number): void {
  g.battlescriptCurrInstr = ptr;
  const cb = g.battleResources.battleCallbackStack;
  cb.function[cb.size++] = g.battleMainFunc;
  g.battleMainFunc = runBattleScriptCommands_PopCallbacksStack;
  g.currentActionFuncId = 0;
}

/** BattleScriptPushCursorAndCallback */
export function battleScriptPushCursorAndCallback(ptr: number): void {
  battleScriptPushCursor();
  g.battlescriptCurrInstr = ptr;
  const cb = g.battleResources.battleCallbackStack;
  cb.function[cb.size++] = g.battleMainFunc;
  g.battleMainFunc = runBattleScriptCommands;
}

const ITEM_NO_EFFECT = 0,
  ITEM_STATUS_CHANGE = 1,
  ITEM_EFFECT_OTHER = 2,
  ITEM_PP_CHANGE = 3,
  ITEM_HP_CHANGE = 4,
  ITEM_STATS_CHANGE = 5;

/** ItemBattleEffects */
export function itemBattleEffects(caseID: number, battlerId: number, moveTurn: boolean): number {
  let i = 0;
  let effect = ITEM_NO_EFFECT;
  let changedPP = 0;
  g.lastUsedItem = g.battleMons[battlerId].item;
  let holdEffect = battlerHoldEffect(battlerId);
  let holdEffectParam = battlerHoldEffectParam(battlerId);
  const atkItem = g.battleMons[g.battlerAttacker].item;
  const atkHoldEffect = battlerHoldEffect(g.battlerAttacker);
  const atkHoldEffectParam = battlerHoldEffectParam(g.battlerAttacker);
  const m = () => g.battleMons[battlerId];

  const tryEatConfuseBerry = (flavor: number) => {
    if (m().hp <= Math.trunc(m().maxHP / 2) && !moveTurn) {
      prepareFlavorBuffer(g.battleTextBuff1, flavor);
      g.battleMoveDamage = Math.trunc(m().maxHP / holdEffectParam) || 1;
      if (m().hp + g.battleMoveDamage > m().maxHP) g.battleMoveDamage = m().maxHP - m().hp;
      g.battleMoveDamage *= -1;
      if (getFlavorRelationByPersonality(m().personality, flavor) < 0) battleScriptExecute(bs('BattleScript_BerryConfuseHealEnd2'));
      else battleScriptExecute(bs('BattleScript_ItemHealHP_RemoveItem'));
      effect = ITEM_HP_CHANGE;
    }
  };
  const tryEatStatUpBerry = (stat: number) => {
    if (m().hp <= Math.trunc(m().maxHP / holdEffectParam) && !moveTurn && m().statStages[stat] < K.MAX_STAT_STAGE) {
      prepareStatBuffer(g.battleTextBuff1, stat);
      g.effectBattler = battlerId;
      g.battleScripting.statChanger = stat + (1 << 4); // SET_STATCHANGER(stat, 1, FALSE)
      g.battleScripting.animArg1 = 14 + stat;
      g.battleScripting.animArg2 = 0;
      battleScriptExecute(bs('BattleScript_BerryStatRaiseEnd2'));
      effect = ITEM_STATS_CHANGE;
    }
  };
  const restoreStats = () => {
    for (let s = 0; s < K.NUM_BATTLE_STATS; s++) {
      if (m().statStages[s] < K.DEFAULT_STAT_STAGE) {
        m().statStages[s] = K.DEFAULT_STAT_STAGE;
        effect = ITEM_STATS_CHANGE;
      }
    }
  };
  const statusName = (): void => {
    const s1 = m().status1;
    if (s1 & K.STATUS1_PSN_ANY) stringCopy(g.battleTextBuff1, statusJpn('Poison'));
    if (s1 & K.STATUS1_SLEEP) {
      m().status2 &= ~K.STATUS2_NIGHTMARE;
      stringCopy(g.battleTextBuff1, statusJpn('Sleep'));
    }
    if (s1 & K.STATUS1_PARALYSIS) stringCopy(g.battleTextBuff1, statusJpn('Paralysis'));
    if (s1 & K.STATUS1_BURN) stringCopy(g.battleTextBuff1, statusJpn('Burn'));
    if (s1 & K.STATUS1_FREEZE) stringCopy(g.battleTextBuff1, statusJpn('Ice'));
    if (m().status2 & K.STATUS2_CONFUSION) stringCopy(g.battleTextBuff1, statusJpn('Confusion'));
  };

  switch (caseID) {
    case K.ITEMEFFECT_ON_SWITCH_IN:
      switch (holdEffect) {
        case K.HOLD_EFFECT_DOUBLE_PRIZE:
          g.battleStruct.moneyMultiplier = 2;
          break;
        case K.HOLD_EFFECT_RESTORE_STATS:
          restoreStats();
          if (effect !== 0) {
            g.battleScripting.battler = battlerId;
            g.potentialItemEffectBattler = battlerId;
            g.activeBattler = g.battlerAttacker = battlerId;
            battleScriptExecute(bs('BattleScript_WhiteHerbEnd2'));
          }
          break;
      }
      break;
    case K.ITEMEFFECT_NORMAL:
      if (m().hp) {
        switch (holdEffect) {
          case K.HOLD_EFFECT_RESTORE_HP:
            if (m().hp <= Math.trunc(m().maxHP / 2) && !moveTurn) {
              g.battleMoveDamage = holdEffectParam;
              if (m().hp + holdEffectParam > m().maxHP) g.battleMoveDamage = m().maxHP - m().hp;
              g.battleMoveDamage *= -1;
              battleScriptExecute(bs('BattleScript_ItemHealHP_RemoveItem'));
              effect = ITEM_HP_CHANGE;
            }
            break;
          case K.HOLD_EFFECT_RESTORE_PP:
            if (!moveTurn) {
              const mon = partyOf(battlerId)[g.battlerPartyIndexes[battlerId]]!;
              let move = 0;
              let ppBonuses = 0;
              for (i = 0; i < K.MAX_MON_MOVES; i++) {
                move = mon.moves[i];
                changedPP = mon.pp[i];
                ppBonuses = mon.ppBonuses;
                if (move && changedPP === 0) break;
              }
              if (i !== K.MAX_MON_MOVES) {
                const maxPP = calculatePPWithBonus(move, ppBonuses, i);
                changedPP = changedPP + holdEffectParam > maxPP ? maxPP : changedPP + holdEffectParam;
                prepareMoveBuffer(g.battleTextBuff1, move);
                battleScriptExecute(bs('BattleScript_BerryPPHealEnd2'));
                emitSetMonData(K.BUFFER_A, i + K.REQUEST_PPMOVE1_BATTLE, 0, [changedPP]);
                markBattlerForControllerExec(g.activeBattler);
                effect = ITEM_PP_CHANGE;
              }
            }
            break;
          case K.HOLD_EFFECT_RESTORE_STATS:
            restoreStats();
            if (effect !== 0) {
              g.battleScripting.battler = battlerId;
              g.potentialItemEffectBattler = battlerId;
              g.activeBattler = g.battlerAttacker = battlerId;
              battleScriptExecute(bs('BattleScript_WhiteHerbEnd2'));
            }
            break;
          case K.HOLD_EFFECT_LEFTOVERS:
            if (m().hp < m().maxHP && !moveTurn) {
              g.battleMoveDamage = Math.trunc(m().maxHP / 16) || 1;
              if (m().hp + g.battleMoveDamage > m().maxHP) g.battleMoveDamage = m().maxHP - m().hp;
              g.battleMoveDamage *= -1;
              battleScriptExecute(bs('BattleScript_ItemHealHP_End2'));
              effect = ITEM_HP_CHANGE;
              recordItemEffectBattle(battlerId, holdEffect);
            }
            break;
          case K.HOLD_EFFECT_CONFUSE_SPICY:
            tryEatConfuseBerry(K.FLAVOR_SPICY);
            break;
          case K.HOLD_EFFECT_CONFUSE_DRY:
            tryEatConfuseBerry(K.FLAVOR_DRY);
            break;
          case K.HOLD_EFFECT_CONFUSE_SWEET:
            tryEatConfuseBerry(K.FLAVOR_SWEET);
            break;
          case K.HOLD_EFFECT_CONFUSE_BITTER:
            tryEatConfuseBerry(K.FLAVOR_BITTER);
            break;
          case K.HOLD_EFFECT_CONFUSE_SOUR:
            tryEatConfuseBerry(K.FLAVOR_SOUR);
            break;
          case K.HOLD_EFFECT_ATTACK_UP:
            if (m().hp <= Math.trunc(m().maxHP / holdEffectParam) && !moveTurn && m().statStages[K.STAT_ATK] < K.MAX_STAT_STAGE) {
              prepareStatBuffer(g.battleTextBuff1, K.STAT_ATK);
              prepareStringBuffer(g.battleTextBuff2, K.STRINGID_STATROSE); // Only the Attack stat-up berry has this
              g.effectBattler = battlerId;
              g.battleScripting.statChanger = K.STAT_ATK + (1 << 4);
              g.battleScripting.animArg1 = 14 + K.STAT_ATK;
              g.battleScripting.animArg2 = 0;
              battleScriptExecute(bs('BattleScript_BerryStatRaiseEnd2'));
              effect = ITEM_STATS_CHANGE;
            }
            break;
          case K.HOLD_EFFECT_DEFENSE_UP:
            tryEatStatUpBerry(K.STAT_DEF);
            break;
          case K.HOLD_EFFECT_SPEED_UP:
            tryEatStatUpBerry(K.STAT_SPEED);
            break;
          case K.HOLD_EFFECT_SP_ATTACK_UP:
            tryEatStatUpBerry(K.STAT_SPATK);
            break;
          case K.HOLD_EFFECT_SP_DEFENSE_UP:
            tryEatStatUpBerry(K.STAT_SPDEF);
            break;
          case K.HOLD_EFFECT_CRITICAL_UP:
            if (m().hp <= Math.trunc(m().maxHP / holdEffectParam) && !moveTurn && !(m().status2 & K.STATUS2_FOCUS_ENERGY)) {
              m().status2 |= K.STATUS2_FOCUS_ENERGY;
              battleScriptExecute(bs('BattleScript_BerryFocusEnergyEnd2'));
              effect = ITEM_EFFECT_OTHER;
            }
            break;
          case K.HOLD_EFFECT_RANDOM_STAT_UP:
            if (!moveTurn && m().hp <= Math.trunc(m().maxHP / holdEffectParam)) {
              for (i = 0; i < K.NUM_STATS - 1; i++) if (m().statStages[K.STAT_ATK + i] < K.MAX_STAT_STAGE) break;
              if (i !== K.NUM_STATS - 1) {
                do {
                  i = random() % (K.NUM_STATS - 1);
                } while (m().statStages[K.STAT_ATK + i] === K.MAX_STAT_STAGE);
                prepareStatBuffer(g.battleTextBuff1, i + 1);
                const t = g.battleTextBuff2;
                t[0] = K.B_BUFF_PLACEHOLDER_BEGIN;
                t[1] = K.B_BUFF_STRING;
                t[2] = K.STRINGID_STATSHARPLY;
                t[3] = K.STRINGID_STATSHARPLY >> 8;
                t[4] = K.B_BUFF_STRING;
                t[5] = K.STRINGID_STATROSE;
                t[6] = K.STRINGID_STATROSE >> 8;
                t[7] = 0xff;
                g.effectBattler = battlerId;
                g.battleScripting.statChanger = i + 1 + (2 << 4);
                g.battleScripting.animArg1 = 0x21 + i + 6;
                g.battleScripting.animArg2 = 0;
                battleScriptExecute(bs('BattleScript_BerryStatRaiseEnd2'));
                effect = ITEM_STATS_CHANGE;
              }
            }
            break;
          case K.HOLD_EFFECT_CURE_PAR:
            if (m().status1 & K.STATUS1_PARALYSIS) {
              m().status1 &= ~K.STATUS1_PARALYSIS;
              battleScriptExecute(bs('BattleScript_BerryCurePrlzEnd2'));
              effect = ITEM_STATUS_CHANGE;
            }
            break;
          case K.HOLD_EFFECT_CURE_PSN:
            if (m().status1 & K.STATUS1_PSN_ANY) {
              m().status1 &= ~(K.STATUS1_PSN_ANY | K.STATUS1_TOXIC_COUNTER);
              battleScriptExecute(bs('BattleScript_BerryCurePsnEnd2'));
              effect = ITEM_STATUS_CHANGE;
            }
            break;
          case K.HOLD_EFFECT_CURE_BRN:
            if (m().status1 & K.STATUS1_BURN) {
              m().status1 &= ~K.STATUS1_BURN;
              battleScriptExecute(bs('BattleScript_BerryCureBrnEnd2'));
              effect = ITEM_STATUS_CHANGE;
            }
            break;
          case K.HOLD_EFFECT_CURE_FRZ:
            if (m().status1 & K.STATUS1_FREEZE) {
              m().status1 &= ~K.STATUS1_FREEZE;
              battleScriptExecute(bs('BattleScript_BerryCureFrzEnd2'));
              effect = ITEM_STATUS_CHANGE;
            }
            break;
          case K.HOLD_EFFECT_CURE_SLP:
            if (m().status1 & K.STATUS1_SLEEP) {
              m().status1 &= ~K.STATUS1_SLEEP;
              m().status2 &= ~K.STATUS2_NIGHTMARE;
              battleScriptExecute(bs('BattleScript_BerryCureSlpEnd2'));
              effect = ITEM_STATUS_CHANGE;
            }
            break;
          case K.HOLD_EFFECT_CURE_CONFUSION:
            if (m().status2 & K.STATUS2_CONFUSION) {
              m().status2 &= ~K.STATUS2_CONFUSION;
              battleScriptExecute(bs('BattleScript_BerryCureConfusionEnd2'));
              effect = ITEM_EFFECT_OTHER;
            }
            break;
          case K.HOLD_EFFECT_CURE_STATUS:
            if (m().status1 & K.STATUS1_ANY || m().status2 & K.STATUS2_CONFUSION) {
              const s1 = m().status1;
              const count =
                (s1 & K.STATUS1_PSN_ANY ? 1 : 0) +
                (s1 & K.STATUS1_SLEEP ? 1 : 0) +
                (s1 & K.STATUS1_PARALYSIS ? 1 : 0) +
                (s1 & K.STATUS1_BURN ? 1 : 0) +
                (s1 & K.STATUS1_FREEZE ? 1 : 0) +
                (m().status2 & K.STATUS2_CONFUSION ? 1 : 0);
              statusName();
              g.battleCommunication[K.MULTISTRING_CHOOSER] = count <= 1 ? K.B_MSG_CURED_PROBLEM : K.B_MSG_NORMALIZED_STATUS;
              m().status1 = 0;
              m().status2 &= ~K.STATUS2_CONFUSION;
              battleScriptExecute(bs('BattleScript_BerryCureChosenStatusEnd2'));
              effect = ITEM_STATUS_CHANGE;
            }
            break;
          case K.HOLD_EFFECT_CURE_ATTRACT:
            if (m().status2 & K.STATUS2_INFATUATION) {
              m().status2 &= ~K.STATUS2_INFATUATION;
              stringCopy(g.battleTextBuff1, statusJpn('Love'));
              battleScriptExecute(bs('BattleScript_BerryCureChosenStatusEnd2'));
              g.battleCommunication[K.MULTISTRING_CHOOSER] = K.B_MSG_CURED_PROBLEM;
              effect = ITEM_EFFECT_OTHER;
            }
            break;
        }
        if (effect !== 0) {
          g.battleScripting.battler = battlerId;
          g.potentialItemEffectBattler = battlerId;
          g.activeBattler = g.battlerAttacker = battlerId;
          if (effect === ITEM_STATUS_CHANGE) {
            emitSetMonData(K.BUFFER_A, K.REQUEST_STATUS_BATTLE, 0, u32(m().status1));
            markBattlerForControllerExec(g.activeBattler);
          } else if (effect === ITEM_PP_CHANGE) {
            if (moveIsPermanent(battlerId, i)) m().pp[i] = changedPP;
          }
        }
      }
      break;
    case K.ITEMEFFECT_DUMMY:
      break;
    case K.ITEMEFFECT_MOVE_END:
      for (battlerId = 0; battlerId < g.battlersCount; battlerId++) {
        g.lastUsedItem = g.battleMons[battlerId].item;
        holdEffect = battlerHoldEffect(battlerId);
        holdEffectParam = battlerHoldEffectParam(battlerId);
        const ret = (label: string, eff: number) => {
          battleScriptPushCursor();
          g.battlescriptCurrInstr = bs(label);
          effect = eff;
        };
        switch (holdEffect) {
          case K.HOLD_EFFECT_CURE_PAR:
            if (m().status1 & K.STATUS1_PARALYSIS) {
              m().status1 &= ~K.STATUS1_PARALYSIS;
              ret('BattleScript_BerryCureParRet', ITEM_STATUS_CHANGE);
            }
            break;
          case K.HOLD_EFFECT_CURE_PSN:
            if (m().status1 & K.STATUS1_PSN_ANY) {
              m().status1 &= ~(K.STATUS1_PSN_ANY | K.STATUS1_TOXIC_COUNTER);
              ret('BattleScript_BerryCurePsnRet', ITEM_STATUS_CHANGE);
            }
            break;
          case K.HOLD_EFFECT_CURE_BRN:
            if (m().status1 & K.STATUS1_BURN) {
              m().status1 &= ~K.STATUS1_BURN;
              ret('BattleScript_BerryCureBrnRet', ITEM_STATUS_CHANGE);
            }
            break;
          case K.HOLD_EFFECT_CURE_FRZ:
            if (m().status1 & K.STATUS1_FREEZE) {
              m().status1 &= ~K.STATUS1_FREEZE;
              ret('BattleScript_BerryCureFrzRet', ITEM_STATUS_CHANGE);
            }
            break;
          case K.HOLD_EFFECT_CURE_SLP:
            if (m().status1 & K.STATUS1_SLEEP) {
              m().status1 &= ~K.STATUS1_SLEEP;
              m().status2 &= ~K.STATUS2_NIGHTMARE;
              ret('BattleScript_BerryCureSlpRet', ITEM_STATUS_CHANGE);
            }
            break;
          case K.HOLD_EFFECT_CURE_CONFUSION:
            if (m().status2 & K.STATUS2_CONFUSION) {
              m().status2 &= ~K.STATUS2_CONFUSION;
              ret('BattleScript_BerryCureConfusionRet', ITEM_EFFECT_OTHER);
            }
            break;
          case K.HOLD_EFFECT_CURE_ATTRACT:
            if (m().status2 & K.STATUS2_INFATUATION) {
              m().status2 &= ~K.STATUS2_INFATUATION;
              stringCopy(g.battleTextBuff1, statusJpn('Love'));
              battleScriptPushCursor();
              g.battleCommunication[K.MULTISTRING_CHOOSER] = K.B_MSG_CURED_PROBLEM;
              g.battlescriptCurrInstr = bs('BattleScript_BerryCureChosenStatusRet');
              effect = ITEM_EFFECT_OTHER;
            }
            break;
          case K.HOLD_EFFECT_CURE_STATUS:
            if (m().status1 & K.STATUS1_ANY || m().status2 & K.STATUS2_CONFUSION) {
              statusName();
              m().status1 = 0;
              m().status2 &= ~K.STATUS2_CONFUSION;
              battleScriptPushCursor();
              g.battleCommunication[K.MULTISTRING_CHOOSER] = K.B_MSG_CURED_PROBLEM;
              g.battlescriptCurrInstr = bs('BattleScript_BerryCureChosenStatusRet');
              effect = ITEM_STATUS_CHANGE;
            }
            break;
          case K.HOLD_EFFECT_RESTORE_STATS:
            restoreStats();
            if (effect !== 0) {
              g.battleScripting.battler = battlerId;
              g.potentialItemEffectBattler = battlerId;
              battleScriptPushCursor();
              g.battlescriptCurrInstr = bs('BattleScript_WhiteHerbRet');
              return effect;
            }
            break;
        }
        if (effect !== 0) {
          g.battleScripting.battler = battlerId;
          g.potentialItemEffectBattler = battlerId;
          sendStatus1(battlerId);
          break;
        }
      }
      break;
    case K.ITEMEFFECT_KINGSROCK_SHELLBELL:
      if (g.battleMoveDamage) {
        switch (atkHoldEffect) {
          case K.HOLD_EFFECT_FLINCH:
            // Note: compares against battlerHoldEffectParam like the original.
            if (
              !(g.moveResultFlags & K.MOVE_RESULT_NO_EFFECT) &&
              targetTurnDamaged() &&
              random() % 100 < holdEffectParam &&
              gBattleMoves[g.currentMove].flags & K.FLAG_KINGS_ROCK_AFFECTED &&
              g.battleMons[g.battlerTarget].hp
            ) {
              g.battleCommunication[K.MOVE_EFFECT_BYTE] = K.MOVE_EFFECT_FLINCH;
              battleScriptPushCursor();
              setMoveEffect(false, 0);
              battleScriptPop();
            }
            break;
          case K.HOLD_EFFECT_SHELL_BELL: {
            const a = g.battleMons[g.battlerAttacker];
            const dmg = g.specialStatuses[g.battlerTarget].dmg;
            if (!(g.moveResultFlags & K.MOVE_RESULT_NO_EFFECT) && dmg !== 0 && dmg !== 0xffff && g.battlerAttacker !== g.battlerTarget && a.hp !== a.maxHP && a.hp !== 0) {
              g.lastUsedItem = atkItem;
              g.potentialItemEffectBattler = g.battlerAttacker;
              g.battleScripting.battler = g.battlerAttacker;
              g.battleMoveDamage = Math.trunc(dmg / atkHoldEffectParam) * -1;
              if (g.battleMoveDamage === 0) g.battleMoveDamage = -1;
              g.specialStatuses[g.battlerTarget].dmg = 0;
              battleScriptPushCursor();
              g.battlescriptCurrInstr = bs('BattleScript_ItemHealHP_Ret');
              effect++;
            }
            break;
          }
        }
      }
      break;
  }
  return effect;
}

/** ClearFuryCutterDestinyBondGrudge */
export function clearFuryCutterDestinyBondGrudge(battlerId: number): void {
  g.disableStructs[battlerId].furyCutterCounter = 0;
  g.battleMons[battlerId].status2 &= ~K.STATUS2_DESTINY_BOND;
  g.statuses3[battlerId] &= ~K.STATUS3_GRUDGE;
}

/** GetMoveTarget */
export function getMoveTarget(move: number, setTarget: number): number {
  let targetBattler = 0;
  const moveTarget = setTarget !== K.NO_TARGET_OVERRIDE ? setTarget - 1 : gBattleMoves[move].target;
  switch (moveTarget) {
    case K.MOVE_TARGET_SELECTED: {
      let side = getBattlerSide(g.battlerAttacker) ^ K.BIT_SIDE;
      if (g.sideTimers[side].followmeTimer && g.battleMons[g.sideTimers[side].followmeTarget].hp) {
        targetBattler = g.sideTimers[side].followmeTarget;
      } else {
        side = getBattlerSide(g.battlerAttacker);
        do {
          targetBattler = random() % g.battlersCount;
        } while (targetBattler === g.battlerAttacker || side === getBattlerSide(targetBattler) || g.absentBattlerFlags & bit(targetBattler));
        if (
          gBattleMoves[move].type === K.TYPE_ELECTRIC &&
          abilityBattleEffects(K.ABILITYEFFECT_COUNT_OTHER_SIDE, g.battlerAttacker, K.ABILITY_LIGHTNING_ROD, 0, 0) &&
          g.battleMons[targetBattler].ability !== K.ABILITY_LIGHTNING_ROD
        ) {
          targetBattler ^= K.BIT_FLANK;
          recordAbilityBattle(targetBattler, g.battleMons[targetBattler].ability);
          g.specialStatuses[targetBattler].lightningRodRedirected = 1;
        }
      }
      break;
    }
    case K.MOVE_TARGET_DEPENDS:
    case K.MOVE_TARGET_BOTH:
    case K.MOVE_TARGET_FOES_AND_ALLY:
    case K.MOVE_TARGET_OPPONENTS_FIELD:
      targetBattler = getBattlerAtPosition((getBattlerPosition(g.battlerAttacker) & K.BIT_SIDE) ^ K.BIT_SIDE);
      if (g.absentBattlerFlags & bit(targetBattler)) targetBattler ^= K.BIT_FLANK;
      break;
    case K.MOVE_TARGET_RANDOM: {
      const side = getBattlerSide(g.battlerAttacker) ^ K.BIT_SIDE;
      if (g.sideTimers[side].followmeTimer && g.battleMons[g.sideTimers[side].followmeTarget].hp) {
        targetBattler = g.sideTimers[side].followmeTarget;
      } else if (g.battleTypeFlags & K.BATTLE_TYPE_DOUBLE && moveTarget & K.MOVE_TARGET_RANDOM) {
        if (getBattlerSide(g.battlerAttacker) === K.B_SIDE_PLAYER)
          targetBattler = getBattlerAtPosition(random() & 1 ? K.B_POSITION_OPPONENT_LEFT : K.B_POSITION_OPPONENT_RIGHT);
        else targetBattler = getBattlerAtPosition(random() & 1 ? K.B_POSITION_PLAYER_LEFT : K.B_POSITION_PLAYER_RIGHT);
        if (g.absentBattlerFlags & bit(targetBattler)) targetBattler ^= K.BIT_FLANK;
      } else {
        targetBattler = getBattlerAtPosition((getBattlerPosition(g.battlerAttacker) & K.BIT_SIDE) ^ K.BIT_SIDE);
      }
      break;
    }
    case K.MOVE_TARGET_USER_OR_SELECTED:
    case K.MOVE_TARGET_USER:
      targetBattler = g.battlerAttacker;
      break;
  }
  g.battleStruct.moveTarget[g.battlerAttacker] = targetBattler;
  return targetBattler;
}

/** IsBattlerModernFatefulEncounter: only false for an illegal Mew/Deoxys (no such mons here). */
function isBattlerModernFatefulEncounter(_battlerId: number): boolean {
  return true;
}

/** IsMonDisobedient */
export function isMonDisobedient(): number {
  let obedienceLevel = 0;
  const atk = g.battlerAttacker;
  const m = g.battleMons[atk];
  if (g.battleTypeFlags & (K.BATTLE_TYPE_LINK | K.BATTLE_TYPE_POKEDUDE)) return 0;
  if (getBattlerSide(atk) === K.B_SIDE_OPPONENT) return 0;
  if (isBattlerModernFatefulEncounter(atk)) {
    if (!isOtherTrainer(m.otId, m.otName)) return 0;
    if (state.getFlag('FLAG_BADGE08_GET')) return 0;
    obedienceLevel = 10;
    if (state.getFlag('FLAG_BADGE02_GET')) obedienceLevel = 30;
    if (state.getFlag('FLAG_BADGE04_GET')) obedienceLevel = 50;
    if (state.getFlag('FLAG_BADGE06_GET')) obedienceLevel = 70;
  }
  if (m.level <= obedienceLevel) return 0;
  let rnd = random() & 255;
  let calc = ((m.level + obedienceLevel) * rnd) >> 8;
  if (calc < obedienceLevel) return 0;

  // is not obedient
  if (g.currentMove === K.MOVE_RAGE) m.status2 &= ~K.STATUS2_RAGE;
  if (m.status1 & K.STATUS1_SLEEP && (g.currentMove === K.MOVE_SNORE || g.currentMove === K.MOVE_SLEEP_TALK)) {
    g.battlescriptCurrInstr = bs('BattleScript_IgnoresWhileAsleep');
    return 1;
  }
  rnd = random() & 255;
  calc = ((m.level + obedienceLevel) * rnd) >> 8;
  if (calc < obedienceLevel && g.currentMove !== K.MOVE_FOCUS_PUNCH) {
    calc = checkMoveLimitations(atk, bit(g.currMovePos), K.MOVE_LIMITATIONS_ALL);
    if (calc === 0xf) {
      g.battleCommunication[K.MULTISTRING_CHOOSER] = random() & (K.NUM_LOAF_STRINGS - 1);
      g.battlescriptCurrInstr = bs('BattleScript_MoveUsedLoafingAround');
      return 1;
    }
    do {
      g.currMovePos = g.chosenMovePos = random() & (K.MAX_MON_MOVES - 1);
    } while (bit(g.currMovePos) & calc);
    g.calledMove = m.moves[g.currMovePos];
    g.battlescriptCurrInstr = bs('BattleScript_IgnoresAndUsesRandomMove');
    g.battlerTarget = getMoveTarget(g.calledMove, K.NO_TARGET_OVERRIDE);
    g.hitMarker |= K.HITMARKER_DISOBEDIENT_MOVE;
    return 2;
  }
  obedienceLevel = (m.level - obedienceLevel) & 0xff;
  calc = random() & 255;
  if (calc < obedienceLevel && !(m.status1 & K.STATUS1_ANY) && m.ability !== K.ABILITY_VITAL_SPIRIT && m.ability !== K.ABILITY_INSOMNIA) {
    // try putting asleep
    let i = 0;
    for (; i < g.battlersCount; i++) if (g.battleMons[i].status2 & K.STATUS2_UPROAR) break;
    if (i === g.battlersCount) {
      g.battlescriptCurrInstr = bs('BattleScript_IgnoresAndFallsAsleep');
      return 1;
    }
  }
  calc -= obedienceLevel;
  if (calc < obedienceLevel) {
    g.battleMoveDamage = calculateBaseDamage(m, m, K.MOVE_POUND, 0, 40, 0, atk, atk);
    g.battlerTarget = atk;
    g.battlescriptCurrInstr = bs('BattleScript_IgnoresAndHitsItself');
    g.hitMarker |= K.HITMARKER_UNABLE_TO_USE_MOVE;
    return 2;
  }
  g.battleCommunication[K.MULTISTRING_CHOOSER] = random() & (K.NUM_LOAF_STRINGS - 1);
  g.battlescriptCurrInstr = bs('BattleScript_MoveUsedLoafingAround');
  return 1;
}
