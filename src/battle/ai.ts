// battle_ai_script_commands.c: the trainer AI interpreter. It walks data/battle_ai_scripts.s
// (assembled into the battle ROM image) once per known move, adjusting each move's score.

import { random } from '../util/random';
import { AI_CalcDmg, typeCalc } from './bsCommands1';
import { K } from './constants';
import { bdata, g, gBattleMoves, gSpeciesInfo, itemHoldEffect, mem } from './env';
import { bit } from './globals';
import { getWhoStrikesFirst } from './main';
import { getGenderFromSpeciesAndPersonality, speciesOrEgg } from './pokemonBattle';
import { checkMoveLimitations, getBattlerAtPosition, getBattlerPosition, getBattlerSide } from './util';

const AI_ACTION_DONE = 0x0001;
const AI_ACTION_FLEE = 0x0002;
const AI_ACTION_WATCH = 0x0004;
const AI_ACTION_DO_NOT_ATTACK = 0x0008;
const AI_ACTION_UNK5 = 0x0010;
const AI_ACTION_UNK6 = 0x0020;
const AI_ACTION_UNK7 = 0x0040;
const AI_ACTION_UNK8 = 0x0080;

// AI states
const AIState_SettingUp = 0;
const AIState_Processing = 1;
const AIState_FinishedProcessing = 2;
const AIState_DoNotProcess = 3;

/** sAIScriptPtr: ROM address of the next AI command. */
let p = 0;

const ai = () => g.battleResources.ai;
const history = () => g.battleResources.battleHistory;
const b = (o: number) => mem.u8(p + o);
const h = (o: number) => mem.u16(p + o);
const w = (o: number) => mem.u32(p + o);
const jump = (o: number) => (p = mem.u32(p + o));

function userOrTarget(): number {
  return b(1) === K.AI_USER ? g.battlerAttacker : g.battlerTarget;
}

const sDiscouragedPowerfulMoveEffects = (): number[] => [
  K.EFFECT_EXPLOSION,
  K.EFFECT_DREAM_EATER,
  K.EFFECT_RAZOR_WIND,
  K.EFFECT_SKY_ATTACK,
  K.EFFECT_RECHARGE,
  K.EFFECT_SKULL_BASH,
  K.EFFECT_SOLAR_BEAM,
  K.EFFECT_SPIT_UP,
  K.EFFECT_FOCUS_PUNCH,
  K.EFFECT_SUPERPOWER,
  K.EFFECT_ERUPTION,
  K.EFFECT_OVERHEAT,
];

/** BattleAI_HandleItemUseBeforeAISetup */
export function battleAI_HandleItemUseBeforeAISetup(): void {
  const hist = history();
  hist.usedMoves.forEach((a) => a.fill(0));
  hist.abilities.fill(0);
  hist.itemEffects.fill(0);
  hist.trainerItems.fill(0);
  hist.itemsNo = 0;
  // Items are allowed to use in ONLY trainer battles.
  if (
    g.battleTypeFlags & K.BATTLE_TYPE_TRAINER &&
    g.trainerBattleOpponent_A !== K.TRAINER_SECRET_BASE &&
    !(g.battleTypeFlags & (K.BATTLE_TYPE_TRAINER_TOWER | K.BATTLE_TYPE_EREADER_TRAINER | K.BATTLE_TYPE_BATTLE_TOWER | K.BATTLE_TYPE_SAFARI | K.BATTLE_TYPE_LINK))
  ) {
    const items = bdata.tables.trainers[g.trainerBattleOpponent_A]?.items ?? [];
    for (let i = 0; i < K.MAX_TRAINER_ITEMS; i++) {
      if (items[i]) {
        hist.trainerItems[hist.itemsNo] = items[i];
        hist.itemsNo++;
      }
    }
  }
  battleAI_SetupAIData();
}

/** BattleAI_SetupAIData */
export function battleAI_SetupAIData(): void {
  const t = ai();
  t.aiState = t.movesetIndex = t.moveConsidered = t.funcResult = t.aiFlags = t.aiAction = t.aiLogicId = 0;
  t.simulatedRNG.fill(0);
  for (let i = 0; i < K.MAX_MON_MOVES; i++) t.score[i] = 100;
  const moveLimitations = checkMoveLimitations(g.activeBattler, 0, 0xff);
  // Ignore moves that aren't possible to use.
  for (let i = 0; i < K.MAX_MON_MOVES; i++) {
    if (bit(i) & moveLimitations) t.score[i] = 0;
    t.simulatedRNG[i] = 100 - (random() % 16);
  }
  g.battleResources.AI_ScriptsStack.size = 0;
  g.battlerAttacker = g.activeBattler;
  // Decide a random target battlerId in doubles.
  if (g.battleTypeFlags & K.BATTLE_TYPE_DOUBLE) {
    g.battlerTarget = random() & K.BIT_FLANK;
    if (g.absentBattlerFlags & bit(g.battlerTarget)) g.battlerTarget ^= K.BIT_FLANK;
  } else {
    // There's only one choice in single battles.
    g.battlerTarget = g.battlerAttacker ^ K.BIT_SIDE;
  }
  // Choose proper trainer ai scripts.
  const f = g.battleTypeFlags;
  if (f & K.BATTLE_TYPE_SAFARI) {
    t.aiFlags = K.AI_SCRIPT_SAFARI;
    return;
  } else if (f & K.BATTLE_TYPE_ROAMER) {
    t.aiFlags = K.AI_SCRIPT_ROAMING;
    return;
  } else if (!(f & (K.BATTLE_TYPE_TRAINER_TOWER | K.BATTLE_TYPE_EREADER_TRAINER | K.BATTLE_TYPE_BATTLE_TOWER)) && g.trainerBattleOpponent_A !== K.TRAINER_SECRET_BASE) {
    if (f & K.BATTLE_TYPE_WILD_SCRIPTED) {
      t.aiFlags = K.AI_SCRIPT_CHECK_BAD_MOVE;
      return;
    } else if (f & K.BATTLE_TYPE_LEGENDARY_FRLG) {
      t.aiFlags = K.AI_SCRIPT_CHECK_BAD_MOVE | K.AI_SCRIPT_TRY_TO_FAINT | K.AI_SCRIPT_CHECK_VIABILITY;
      return;
    }
  } else {
    t.aiFlags = K.AI_SCRIPT_CHECK_BAD_MOVE | K.AI_SCRIPT_TRY_TO_FAINT | K.AI_SCRIPT_CHECK_VIABILITY;
    return;
  }
  t.aiFlags = bdata.tables.trainers[g.trainerBattleOpponent_A]?.aiFlags ?? 0;
}

/** BattleAI_ChooseMoveOrAction */
export function battleAI_ChooseMoveOrAction(): number {
  const t = ai();
  recordLastUsedMoveByTarget();
  while (t.aiFlags !== 0) {
    if (t.aiFlags & 1) {
      t.aiState = AIState_SettingUp;
      battleAI_DoAIProcessing();
    }
    t.aiFlags >>>= 1;
    t.aiLogicId++;
    t.movesetIndex = 0;
  }
  // special flee or watch cases for safari.
  if (t.aiAction & AI_ACTION_FLEE) return K.AI_CHOICE_FLEE;
  if (t.aiAction & AI_ACTION_WATCH) return K.AI_CHOICE_WATCH;
  let numOfBestMoves = 1;
  const currentMoveArray = new Uint8Array(4);
  const consideredMoveArray = new Uint8Array(4);
  currentMoveArray[0] = t.score[0];
  consideredMoveArray[0] = 0;
  for (let i = 1; i < K.MAX_MON_MOVES; i++) {
    // currentMoveArray is u8 while score is s8, as in the original
    if (currentMoveArray[0] < t.score[i]) {
      numOfBestMoves = 1;
      currentMoveArray[0] = t.score[i];
      consideredMoveArray[0] = i;
    }
    if (currentMoveArray[0] === t.score[i]) {
      currentMoveArray[numOfBestMoves] = t.score[i];
      consideredMoveArray[numOfBestMoves++] = i;
    }
  }
  return consideredMoveArray[random() % numOfBestMoves]; // break any ties that exist.
}

function battleAI_DoAIProcessing(): void {
  const t = ai();
  while (t.aiState !== AIState_FinishedProcessing) {
    switch (t.aiState) {
      case AIState_DoNotProcess: // Needed to match.
        break;
      case AIState_SettingUp:
        p = mem.u32(mem.label('gBattleAI_ScriptsTable') + t.aiLogicId * 4);
        if (g.battleMons[g.battlerAttacker].pp[t.movesetIndex] === 0) t.moveConsidered = 0; // Don't consider moves with no PP
        else t.moveConsidered = g.battleMons[g.battlerAttacker].moves[t.movesetIndex];
        t.aiState++;
        break;
      case AIState_Processing:
        if (t.moveConsidered !== 0) {
          sBattleAICmdTable[b(0)](); // Run AI command.
        } else {
          t.score[t.movesetIndex] = 0;
          t.aiAction |= AI_ACTION_DONE;
        }
        if (t.aiAction & AI_ACTION_DONE) {
          t.movesetIndex++;
          if (t.movesetIndex < K.MAX_MON_MOVES && (t.aiAction & AI_ACTION_DO_NOT_ATTACK) === 0) t.aiState = AIState_SettingUp;
          else t.aiState++; // done processing.
          t.aiAction &= AI_ACTION_FLEE | AI_ACTION_WATCH | AI_ACTION_DO_NOT_ATTACK | AI_ACTION_UNK5 | AI_ACTION_UNK6 | AI_ACTION_UNK7 | AI_ACTION_UNK8;
        }
        break;
    }
  }
}

function recordLastUsedMoveByTarget(): void {
  const used = history().usedMoves[g.battlerTarget >> 1];
  for (let i = 0; i < 8; i++) {
    if (used[i] === 0) {
      used[i] = g.lastMoves[g.battlerTarget];
      return;
    }
  }
}

/** RecordAbilityBattle */
export function recordAbilityBattle(battlerId: number, abilityId: number): void {
  if (getBattlerSide(battlerId) === 0) history().abilities[battlerId & K.BIT_SIDE] = abilityId;
}

/** RecordItemEffectBattle */
export function recordItemEffectBattle(battlerId: number, itemEffect: number): void {
  if (getBattlerSide(battlerId) === 0) history().itemEffects[battlerId & K.BIT_SIDE] = itemEffect;
}

// ------------------------------------------------------------------ commands

function ifRandom(cmp: (r: number, v: number) => boolean) {
  return () => {
    if (cmp(random() % 256, b(1))) jump(2);
    else p += 6;
  };
}

function Cmd_score(): void {
  const t = ai();
  t.score[t.movesetIndex] += b(1); // add the result to the array of the move consider's score (s8 wrap).
  if (t.score[t.movesetIndex] < 0) t.score[t.movesetIndex] = 0; // if the score is negative, flatten it to 0.
  p += 2;
}

function ifHp(cmp: (a: number, v: number) => boolean) {
  return () => {
    const m = g.battleMons[userOrTarget()];
    if (cmp(Math.trunc((100 * m.hp) / m.maxHP) >>> 0, b(2))) jump(3);
    else p += 7;
  };
}

function ifStatusField(get: (battler: number) => number, negate: boolean) {
  return () => {
    const battler = userOrTarget();
    const hit = (get(battler) & w(2)) !== 0;
    if (hit !== negate) jump(6);
    else p += 10;
  };
}

function ifResult(cmp: (a: number, v: number) => boolean) {
  return () => {
    if (cmp(ai().funcResult, b(1))) jump(2);
    else p += 6;
  };
}

function ifResultPtr(cmp: (a: number, v: number) => boolean) {
  return () => {
    if (cmp(ai().funcResult, mem.u8(w(1)))) jump(5);
    else p += 9;
  };
}

function Cmd_if_move(): void {
  if (ai().moveConsidered === h(1)) jump(3);
  else p += 7;
}

function Cmd_if_not_move(): void {
  if (ai().moveConsidered !== h(1)) jump(3);
  else p += 7;
}

function inList(size: 1 | 2): boolean {
  let ptr = w(1);
  const end = size === 1 ? 0xff : 0xffff;
  for (;;) {
    const v = size === 1 ? mem.u8(ptr) : mem.u16(ptr);
    if (v === end) return false;
    if (ai().funcResult === v) return true;
    ptr += size;
  }
}

function Cmd_if_in_bytes(): void {
  if (inList(1)) jump(5);
  else p += 9;
}

function Cmd_if_not_in_bytes(): void {
  if (inList(1)) p += 9;
  else jump(5);
}

function Cmd_if_in_hwords(): void {
  if (inList(2)) jump(5);
  else p += 9;
}

function Cmd_if_not_in_hwords(): void {
  if (inList(2)) p += 9;
  else jump(5);
}

function userHasAttackingMove(): boolean {
  const m = g.battleMons[g.battlerAttacker];
  for (let i = 0; i < K.MAX_MON_MOVES; i++) if (m.moves[i] !== 0 && gBattleMoves[m.moves[i]].power !== 0) return true;
  return false;
}

function Cmd_if_user_has_attacking_move(): void {
  if (!userHasAttackingMove()) p += 5;
  else jump(1);
}

function Cmd_if_user_has_no_attacking_moves(): void {
  if (userHasAttackingMove()) p += 5;
  else jump(1);
}

function Cmd_get_turn_count(): void {
  ai().funcResult = g.battleResults.battleTurnCounter;
  p += 1;
}

function Cmd_get_type(): void {
  const t = ai();
  switch (b(1)) {
    case K.AI_TYPE1_USER:
      t.funcResult = g.battleMons[g.battlerAttacker].type1;
      break;
    case K.AI_TYPE1_TARGET:
      t.funcResult = g.battleMons[g.battlerTarget].type1;
      break;
    case K.AI_TYPE2_USER:
      t.funcResult = g.battleMons[g.battlerAttacker].type2;
      break;
    case K.AI_TYPE2_TARGET:
      t.funcResult = g.battleMons[g.battlerTarget].type2;
      break;
    case K.AI_TYPE_MOVE:
      t.funcResult = gBattleMoves[t.moveConsidered].type;
      break;
  }
  p += 2;
}

function Cmd_get_considered_move_power(): void {
  ai().funcResult = gBattleMoves[ai().moveConsidered].power;
  p += 1;
}

function resetDamageVars(): void {
  g.dynamicBasePower = 0;
  g.battleStruct.dynamicMoveType = 0;
  g.battleScripting.dmgMultiplier = 1;
  g.moveResultFlags = 0;
  g.critMultiplier = 1;
}

function Cmd_get_how_powerful_move_is(): void {
  const t = ai();
  const discouraged = sDiscouragedPowerfulMoveEffects();
  if (gBattleMoves[t.moveConsidered].power > 1 && !discouraged.includes(gBattleMoves[t.moveConsidered].effect)) {
    resetDamageVars();
    const moveDmgs = new Int32Array(4);
    const m = g.battleMons[g.battlerAttacker];
    for (let checkedMove = 0; checkedMove < K.MAX_MON_MOVES; checkedMove++) {
      const mv = m.moves[checkedMove];
      if (mv !== K.MOVE_NONE && !discouraged.includes(gBattleMoves[mv].effect) && gBattleMoves[mv].power > 1) {
        g.currentMove = mv;
        AI_CalcDmg(g.battlerAttacker, g.battlerTarget);
        typeCalc(g.currentMove, g.battlerAttacker, g.battlerTarget);
        moveDmgs[checkedMove] = Math.trunc((g.battleMoveDamage * t.simulatedRNG[checkedMove]) / 100);
        if (moveDmgs[checkedMove] === 0) moveDmgs[checkedMove] = 1;
      } else {
        moveDmgs[checkedMove] = 0;
      }
    }
    let checkedMove = 0;
    for (; checkedMove < K.MAX_MON_MOVES; checkedMove++) if (moveDmgs[checkedMove] > moveDmgs[t.movesetIndex]) break;
    t.funcResult = checkedMove === K.MAX_MON_MOVES ? K.MOVE_MOST_POWERFUL : K.MOVE_NOT_MOST_POWERFUL;
  } else {
    t.funcResult = K.MOVE_POWER_DISCOURAGED; // Highly discouraged in terms of power.
  }
  p++;
}

function Cmd_get_last_used_battler_move(): void {
  ai().funcResult = b(1) === K.AI_USER ? g.lastMoves[g.battlerAttacker] : g.lastMoves[g.battlerTarget];
  p += 2;
}

function Cmd_if_would_go_first(): void {
  if (getWhoStrikesFirst(g.battlerAttacker, g.battlerTarget, true) === b(1)) jump(2);
  else p += 6;
}

function Cmd_if_would_not_go_first(): void {
  if (getWhoStrikesFirst(g.battlerAttacker, g.battlerTarget, true) !== b(1)) jump(2);
  else p += 6;
}

function nullsub(): void {}

function Cmd_count_alive_pokemon(): void {
  const t = ai();
  t.funcResult = 0;
  const battlerId = userOrTarget();
  const party = getBattlerSide(battlerId) === K.B_SIDE_PLAYER ? g.playerParty : g.enemyParty;
  let onField1: number, onField2: number;
  if (g.battleTypeFlags & K.BATTLE_TYPE_DOUBLE) {
    onField1 = g.battlerPartyIndexes[battlerId];
    onField2 = g.battlerPartyIndexes[getBattlerAtPosition(getBattlerPosition(battlerId) ^ K.BIT_FLANK)];
  } else {
    // In singles there's only one battlerId by side.
    onField1 = onField2 = g.battlerPartyIndexes[battlerId];
  }
  for (let i = 0; i < K.PARTY_SIZE; i++) {
    const mon = party[i];
    const sp = speciesOrEgg(mon);
    if (i !== onField1 && i !== onField2 && mon && mon.hp !== 0 && sp !== K.SPECIES_NONE && sp !== K.SPECIES_EGG) t.funcResult++;
  }
  p += 2;
}

function Cmd_get_considered_move(): void {
  ai().funcResult = ai().moveConsidered;
  p += 1;
}

function Cmd_get_considered_move_effect(): void {
  ai().funcResult = gBattleMoves[ai().moveConsidered].effect;
  p += 1;
}

function Cmd_get_ability(): void {
  const t = ai();
  const battlerId = userOrTarget();
  const m = g.battleMons[battlerId];
  if (getBattlerSide(battlerId) === K.AI_TARGET) {
    const side = battlerId & K.BIT_SIDE;
    if (history().abilities[side] !== 0) {
      t.funcResult = history().abilities[side];
      p += 2;
      return;
    }
    // abilities that prevent fleeing.
    if (m.ability === K.ABILITY_SHADOW_TAG || m.ability === K.ABILITY_MAGNET_PULL || m.ability === K.ABILITY_ARENA_TRAP) {
      t.funcResult = m.ability;
      p += 2;
      return;
    }
    const abilities = gSpeciesInfo[m.species].abilities;
    if (abilities[0] !== K.ABILITY_NONE) {
      if (abilities[1] !== K.ABILITY_NONE) {
        // AI has no knowledge of opponent, so it guesses which ability.
        t.funcResult = random() % 2 ? abilities[0] : abilities[1];
      } else {
        t.funcResult = abilities[0];
      }
    } else {
      t.funcResult = abilities[1]; // AI can't actually reach this part since no pokemon has ability 2 and no ability 1.
    }
  } else {
    t.funcResult = m.ability; // The AI knows its own ability.
  }
  p += 2;
}

function normalizeEffectiveness(): void {
  if (g.battleMoveDamage === 120) g.battleMoveDamage = K.AI_EFFECTIVENESS_x2; // Super effective STAB.
  if (g.battleMoveDamage === 240) g.battleMoveDamage = K.AI_EFFECTIVENESS_x4;
  if (g.battleMoveDamage === 30) g.battleMoveDamage = K.AI_EFFECTIVENESS_x0_5; // Not very effective STAB.
  if (g.battleMoveDamage === 15) g.battleMoveDamage = K.AI_EFFECTIVENESS_x0_25;
  if (g.moveResultFlags & K.MOVE_RESULT_DOESNT_AFFECT_FOE) g.battleMoveDamage = K.AI_EFFECTIVENESS_x0;
}

function Cmd_get_highest_type_effectiveness(): void {
  const t = ai();
  resetDamageVars();
  t.funcResult = 0;
  for (let i = 0; i < K.MAX_MON_MOVES; i++) {
    g.battleMoveDamage = 40;
    g.currentMove = g.battleMons[g.battlerAttacker].moves[i];
    if (g.currentMove !== K.MOVE_NONE) {
      typeCalc(g.currentMove, g.battlerAttacker, g.battlerTarget);
      normalizeEffectiveness();
      if (t.funcResult < g.battleMoveDamage) t.funcResult = g.battleMoveDamage;
    }
  }
  p += 1;
}

function Cmd_if_type_effectiveness(): void {
  resetDamageVars();
  g.battleMoveDamage = K.AI_EFFECTIVENESS_x1;
  g.currentMove = ai().moveConsidered;
  typeCalc(g.currentMove, g.battlerAttacker, g.battlerTarget);
  normalizeEffectiveness();
  // Store gBattleMoveDamage in a u8 variable because sAIScriptPtr[1] is a u8.
  const damageVar = g.battleMoveDamage & 0xff;
  if (damageVar === b(1)) jump(2);
  else p += 6;
}

function statusInParty(): boolean {
  const party = b(1) === 1 ? g.enemyParty : g.playerParty;
  const statusToCompareTo = w(2);
  for (let i = 0; i < K.PARTY_SIZE; i++) {
    const mon = party[i];
    if (mon && mon.species !== K.SPECIES_NONE && mon.hp !== 0 && mon.status >>> 0 === statusToCompareTo) return true;
  }
  return false;
}

function Cmd_if_status_in_party(): void {
  if (statusInParty()) jump(6);
  else p += 10;
}

/** Bugged and unused: every match advances the pointer again before the final jump. */
function Cmd_if_status_not_in_party(): void {
  const party = b(1) === 1 ? g.enemyParty : g.playerParty;
  const statusToCompareTo = w(2);
  for (let i = 0; i < K.PARTY_SIZE; i++) {
    const mon = party[i];
    if (mon && mon.species !== K.SPECIES_NONE && mon.hp !== 0 && mon.status >>> 0 === statusToCompareTo) p += 10; // doesnt return?
  }
  jump(6);
}

function Cmd_get_weather(): void {
  const t = ai();
  if (g.battleWeather & K.B_WEATHER_RAIN) t.funcResult = 1; // WEATHER_TYPE_RAIN
  if (g.battleWeather & K.B_WEATHER_SANDSTORM) t.funcResult = 2; // WEATHER_TYPE_SANDSTORM
  if (g.battleWeather & K.B_WEATHER_SUN) t.funcResult = 0; // WEATHER_TYPE_SUNNY
  if (g.battleWeather & K.B_WEATHER_HAIL_TEMPORARY) t.funcResult = 3; // WEATHER_TYPE_HAIL
  p += 1;
}

function Cmd_if_effect(): void {
  if (gBattleMoves[ai().moveConsidered].effect === b(1)) jump(2);
  else p += 6;
}

function Cmd_if_not_effect(): void {
  if (gBattleMoves[ai().moveConsidered].effect !== b(1)) jump(2);
  else p += 6;
}

function ifStatLevel(cmp: (a: number, v: number) => boolean) {
  return () => {
    if (cmp(g.battleMons[userOrTarget()].statStages[b(2)], b(3))) jump(4);
    else p += 8;
  };
}

/** The damage estimate shared by if_can_faint / if_cant_faint (false if the move is too weak to try). */
function estimateDamage(): boolean {
  const t = ai();
  if (gBattleMoves[t.moveConsidered].power < 2) return false;
  resetDamageVars();
  g.currentMove = t.moveConsidered;
  AI_CalcDmg(g.battlerAttacker, g.battlerTarget);
  typeCalc(g.currentMove, g.battlerAttacker, g.battlerTarget);
  g.battleMoveDamage = Math.trunc((g.battleMoveDamage * t.simulatedRNG[t.movesetIndex]) / 100);
  return true;
}

function Cmd_if_can_faint(): void {
  if (!estimateDamage()) {
    p += 5;
    return;
  }
  // Moves always do at least 1 damage.
  if (g.battleMoveDamage === 0) g.battleMoveDamage = 1;
  if (g.battleMons[g.battlerTarget].hp <= g.battleMoveDamage) jump(1);
  else p += 5;
}

function Cmd_if_cant_faint(): void {
  if (!estimateDamage()) {
    p += 5;
    return;
  }
  // This macro is missing the damage 0 = 1 assumption.
  if (g.battleMons[g.battlerTarget].hp > g.battleMoveDamage) jump(1);
  else p += 5;
}

function hasMove(): boolean | undefined {
  const move = h(2);
  switch (b(1)) {
    case K.AI_USER:
    case K.AI_USER_PARTNER:
      return g.battleMons[g.battlerAttacker].moves.includes(move);
    case K.AI_TARGET:
    case K.AI_TARGET_PARTNER:
      return history().usedMoves[g.battlerTarget >> 1].includes(move);
  }
  return undefined;
}

function Cmd_if_has_move(): void {
  const r = hasMove();
  if (r === undefined) return;
  if (!r) p += 8;
  else jump(4);
}

function Cmd_if_doesnt_have_move(): void {
  const r = hasMove();
  if (r === undefined) return;
  if (r) p += 8;
  else jump(4);
}

function userHasMoveWithEffect(): boolean {
  const m = g.battleMons[g.battlerAttacker];
  for (let i = 0; i < K.MAX_MON_MOVES; i++) if (m.moves[i] !== 0 && gBattleMoves[m.moves[i]].effect === b(2)) return true;
  return false;
}

function Cmd_if_has_move_with_effect(): void {
  switch (b(1)) {
    case K.AI_USER:
    case K.AI_USER_PARTNER:
      if (userHasMoveWithEffect()) jump(3);
      else p += 7;
      break;
    case K.AI_TARGET:
    case K.AI_TARGET_PARTNER:
      jump(3); // the loop's result is never used: always jumps
      break;
  }
}

function Cmd_if_doesnt_have_move_with_effect(): void {
  switch (b(1)) {
    case K.AI_USER:
    case K.AI_USER_PARTNER:
      if (userHasMoveWithEffect()) p += 7;
      else jump(3);
      break;
    case K.AI_TARGET:
    case K.AI_TARGET_PARTNER:
      p += 7; // the loop's result is never used: never jumps
      break;
  }
}

function Cmd_if_any_move_disabled_or_encored(): void {
  const d = g.disableStructs[userOrTarget()];
  if (b(2) === 0) {
    if (d.disabledMove === K.MOVE_NONE) p += 7;
    else jump(3);
  } else if (b(2) !== 1) {
    p += 7;
  } else if (d.encoredMove !== K.MOVE_NONE) jump(3);
  else p += 7;
}

function Cmd_if_curr_move_disabled_or_encored(): void {
  const d = g.disableStructs[g.activeBattler];
  switch (b(1)) {
    case 0:
      if (d.disabledMove === ai().moveConsidered) jump(2);
      else p += 6;
      break;
    case 1:
      if (d.encoredMove === ai().moveConsidered) jump(2);
      else p += 6;
      break;
    default:
      p += 6;
      break;
  }
}

function Cmd_flee(): void {
  ai().aiAction |= AI_ACTION_DONE | AI_ACTION_FLEE | AI_ACTION_DO_NOT_ATTACK; // what matters is AI_ACTION_FLEE being enabled.
}

function Cmd_if_random_safari_flee(): void {
  const bst = g.battleStruct;
  let safariFleeRate: number;
  if (bst.safariRockThrowCounter) {
    safariFleeRate = (bst.safariEscapeFactor * 2) & 0xff;
    if (safariFleeRate > 20) safariFleeRate = 20;
  } else if (bst.safariBaitThrowCounter !== 0) {
    safariFleeRate = Math.trunc(bst.safariEscapeFactor / 4);
    if (safariFleeRate === 0) safariFleeRate = 1;
  } else safariFleeRate = bst.safariEscapeFactor;
  safariFleeRate = (safariFleeRate * 5) & 0xff;
  if ((random() % 100 & 0xff) < safariFleeRate) jump(1);
  else p += 5;
}

function Cmd_watch(): void {
  ai().aiAction |= AI_ACTION_DONE | AI_ACTION_WATCH | AI_ACTION_DO_NOT_ATTACK; // what matters is AI_ACTION_WATCH being enabled.
}

function Cmd_get_hold_effect(): void {
  const battlerId = userOrTarget();
  if (getBattlerSide(battlerId) === K.B_SIDE_PLAYER) ai().funcResult = history().itemEffects[battlerId & K.BIT_SIDE];
  else ai().funcResult = itemHoldEffect(g.battleMons[battlerId].item);
  p += 2;
}

function Cmd_get_gender(): void {
  const m = g.battleMons[userOrTarget()];
  ai().funcResult = getGenderFromSpeciesAndPersonality(m.species, m.personality);
  p += 2;
}

function Cmd_is_first_turn_for(): void {
  ai().funcResult = g.disableStructs[userOrTarget()].isFirstTurn;
  p += 2;
}

function Cmd_get_stockpile_count(): void {
  ai().funcResult = g.disableStructs[userOrTarget()].stockpileCounter;
  p += 2;
}

function Cmd_is_double_battle(): void {
  ai().funcResult = g.battleTypeFlags & K.BATTLE_TYPE_DOUBLE;
  p += 1;
}

function Cmd_get_used_held_item(): void {
  // ((u8 *)gBattleStruct->usedHeldItems)[battlerId * 2]: the low byte of the u16 entry
  ai().funcResult = g.battleStruct.usedHeldItems[userOrTarget()] & 0xff;
  p += 2;
}

function Cmd_get_move_type_from_result(): void {
  ai().funcResult = gBattleMoves[ai().funcResult].type;
  p += 1;
}

function Cmd_get_move_power_from_result(): void {
  ai().funcResult = gBattleMoves[ai().funcResult].power;
  p += 1;
}

function Cmd_get_move_effect_from_result(): void {
  ai().funcResult = gBattleMoves[ai().funcResult].effect;
  p += 1;
}

function Cmd_get_protect_count(): void {
  ai().funcResult = g.disableStructs[userOrTarget()].protectUses;
  p += 2;
}

function Cmd_call(): void {
  aiStackPushVar(p + 5);
  jump(1);
}

function Cmd_goto(): void {
  jump(1);
}

function Cmd_end(): void {
  if (!aiStackPop()) ai().aiAction |= AI_ACTION_DONE;
}

function Cmd_if_level_compare(): void {
  const atk = g.battleMons[g.battlerAttacker].level;
  const def = g.battleMons[g.battlerTarget].level;
  switch (b(1)) {
    case 0: // greater than
      if (atk > def) jump(2);
      else p += 6;
      return;
    case 1: // less than
      if (atk < def) jump(2);
      else p += 6;
      return;
    case 2: // equal
      if (atk === def) jump(2);
      else p += 6;
      return;
  }
}

function Cmd_if_target_taunted(): void {
  if (g.disableStructs[g.battlerTarget].tauntTimer !== 0) jump(1);
  else p += 5;
}

function Cmd_if_target_not_taunted(): void {
  if (g.disableStructs[g.battlerTarget].tauntTimer === 0) jump(1);
  else p += 5;
}

function aiStackPushVar(ptr: number): void {
  const s = g.battleResources.AI_ScriptsStack;
  s.ptr[s.size++] = ptr;
}

function aiStackPop(): boolean {
  const s = g.battleResources.AI_ScriptsStack;
  if (s.size !== 0) {
    --s.size;
    p = s.ptr[s.size];
    return true;
  }
  return false;
}

const lt = (a: number, v: number) => a < v;
const gt = (a: number, v: number) => a > v;
const eq = (a: number, v: number) => a === v;
const ne = (a: number, v: number) => a !== v;
const status1 = (x: number) => g.battleMons[x].status1;
const status2 = (x: number) => g.battleMons[x].status2;
const status3 = (x: number) => g.statuses3[x];
const sideStatus = (x: number) => g.sideStatuses[x & K.BIT_SIDE];

/** sBattleAICmdTable */
const sBattleAICmdTable: (() => void)[] = [
  ifRandom(lt), // 0x0 if_random_less_than
  ifRandom(gt), // 0x1 if_random_greater_than
  ifRandom(eq), // 0x2 if_random_equal
  ifRandom(ne), // 0x3 if_random_not_equal
  Cmd_score, // 0x4
  ifHp(lt), // 0x5 if_hp_less_than
  ifHp(gt), // 0x6 if_hp_more_than
  ifHp(eq), // 0x7 if_hp_equal
  ifHp(ne), // 0x8 if_hp_not_equal
  ifStatusField(status1, false), // 0x9 if_status
  ifStatusField(status1, true), // 0xA if_not_status
  ifStatusField(status2, false), // 0xB if_status2
  ifStatusField(status2, true), // 0xC if_not_status2
  ifStatusField(status3, false), // 0xD if_status3
  ifStatusField(status3, true), // 0xE if_not_status3
  ifStatusField(sideStatus, false), // 0xF if_side_affecting
  ifStatusField(sideStatus, true), // 0x10 if_not_side_affecting
  ifResult(lt), // 0x11 if_less_than
  ifResult(gt), // 0x12 if_more_than
  ifResult(eq), // 0x13 if_equal
  ifResult(ne), // 0x14 if_not_equal
  ifResultPtr(lt), // 0x15 if_less_than_ptr
  ifResultPtr(gt), // 0x16 if_more_than_ptr
  ifResultPtr(eq), // 0x17 if_equal_ptr
  ifResultPtr(ne), // 0x18 if_not_equal_ptr
  Cmd_if_move, // 0x19
  Cmd_if_not_move, // 0x1A
  Cmd_if_in_bytes, // 0x1B
  Cmd_if_not_in_bytes, // 0x1C
  Cmd_if_in_hwords, // 0x1D
  Cmd_if_not_in_hwords, // 0x1E
  Cmd_if_user_has_attacking_move, // 0x1F
  Cmd_if_user_has_no_attacking_moves, // 0x20
  Cmd_get_turn_count, // 0x21
  Cmd_get_type, // 0x22
  Cmd_get_considered_move_power, // 0x23
  Cmd_get_how_powerful_move_is, // 0x24
  Cmd_get_last_used_battler_move, // 0x25
  ifResult((a, v) => v === a), // 0x26 if_equal_
  ifResult((a, v) => v !== a), // 0x27 if_not_equal_
  Cmd_if_would_go_first, // 0x28
  Cmd_if_would_not_go_first, // 0x29
  nullsub, // 0x2A
  nullsub, // 0x2B
  Cmd_count_alive_pokemon, // 0x2C
  Cmd_get_considered_move, // 0x2D
  Cmd_get_considered_move_effect, // 0x2E
  Cmd_get_ability, // 0x2F
  Cmd_get_highest_type_effectiveness, // 0x30
  Cmd_if_type_effectiveness, // 0x31
  nullsub, // 0x32
  nullsub, // 0x33
  Cmd_if_status_in_party, // 0x34
  Cmd_if_status_not_in_party, // 0x35
  Cmd_get_weather, // 0x36
  Cmd_if_effect, // 0x37
  Cmd_if_not_effect, // 0x38
  ifStatLevel(lt), // 0x39 if_stat_level_less_than
  ifStatLevel(gt), // 0x3A if_stat_level_more_than
  ifStatLevel(eq), // 0x3B if_stat_level_equal
  ifStatLevel(ne), // 0x3C if_stat_level_not_equal
  Cmd_if_can_faint, // 0x3D
  Cmd_if_cant_faint, // 0x3E
  Cmd_if_has_move, // 0x3F
  Cmd_if_doesnt_have_move, // 0x40
  Cmd_if_has_move_with_effect, // 0x41
  Cmd_if_doesnt_have_move_with_effect, // 0x42
  Cmd_if_any_move_disabled_or_encored, // 0x43
  Cmd_if_curr_move_disabled_or_encored, // 0x44
  Cmd_flee, // 0x45
  Cmd_if_random_safari_flee, // 0x46
  Cmd_watch, // 0x47
  Cmd_get_hold_effect, // 0x48
  Cmd_get_gender, // 0x49
  Cmd_is_first_turn_for, // 0x4A
  Cmd_get_stockpile_count, // 0x4B
  Cmd_is_double_battle, // 0x4C
  Cmd_get_used_held_item, // 0x4D
  Cmd_get_move_type_from_result, // 0x4E
  Cmd_get_move_power_from_result, // 0x4F
  Cmd_get_move_effect_from_result, // 0x50
  Cmd_get_protect_count, // 0x51
  nullsub, // 0x52
  nullsub, // 0x53
  nullsub, // 0x54
  nullsub, // 0x55
  nullsub, // 0x56
  nullsub, // 0x57
  Cmd_call, // 0x58
  Cmd_goto, // 0x59
  Cmd_end, // 0x5A
  Cmd_if_level_compare, // 0x5B
  Cmd_if_target_taunted, // 0x5C
  Cmd_if_target_not_taunted, // 0x5D
];
