// battle_ai_switch_items.c: whether a trainer's mon switches out or uses one of the trainer's
// items instead of attacking, and which party mon the AI sends in.

import type { Pokemon } from '../pokemon/Pokemon';
import { random } from '../util/random';
import { AI_CalcDmg, AI_TypeCalc, typeAtk, typeCalc, typeDef, typeMul } from './bsCommands1';
import { K } from './constants';
import { emitTwoReturnValues } from './controllers';
import { g, gBattleMoves, gSpeciesInfo } from './env';
import { bit } from './globals';
import { getItemEffectParamOffset, itemEffectTable } from './items';
import { speciesOrEgg } from './pokemonBattle';
import { abilityBattleEffects, getBattlerAtPosition, getBattlerPosition, getBattlerSide } from './util';

const ab = () => g.activeBattler;
const aiSlot = () => getBattlerPosition(g.activeBattler) >> 1;

function chooseSwitch(partyId: number): true {
  g.battleStruct.AI_monToSwitchIntoId[aiSlot()] = partyId;
  emitTwoReturnValues(K.BUFFER_B, K.B_ACTION_SWITCH, 0);
  return true;
}

/** GetMonData(MON_DATA_HP) != 0 && SPECIES_OR_EGG is neither NONE nor EGG */
function usable(mon: Pokemon | undefined): mon is Pokemon {
  const sp = speciesOrEgg(mon);
  return !!mon && mon.hp !== 0 && sp !== K.SPECIES_NONE && sp !== K.SPECIES_EGG;
}

/** The ability the party mon would have: abilities[abilityNum != 0]. */
function partyMonAbility(mon: Pokemon): number {
  return mon.abilityNum !== K.ABILITY_NONE ? gSpeciesInfo[mon.species].abilities[1] : gSpeciesInfo[mon.species].abilities[0];
}

/** battlerIn1/battlerIn2: the active battler and its partner (if present in doubles); BATTLE_PARTNER(pos) == pos ^ BIT_FLANK. */
function battlersIn(): [number, number] {
  if (g.battleTypeFlags & K.BATTLE_TYPE_DOUBLE) {
    const partner = getBattlerAtPosition(getBattlerPosition(ab()) ^ K.BIT_FLANK);
    return [ab(), g.absentBattlerFlags & bit(partner) ? ab() : partner];
  }
  return [ab(), ab()];
}

function excluded(i: number, in1: number, in2: number): boolean {
  const s = g.battleStruct.monToSwitchIntoId;
  return i === g.battlerPartyIndexes[in1] || i === g.battlerPartyIndexes[in2] || i === s[in1] || i === s[in2];
}

function shouldSwitchIfPerishSong(): boolean {
  if (g.statuses3[ab()] & K.STATUS3_PERISH_SONG && g.disableStructs[ab()].perishSongTimer === 0) return chooseSwitch(K.PARTY_SIZE);
  return false;
}

function shouldSwitchIfWonderGuard(): boolean {
  if (g.battleTypeFlags & K.BATTLE_TYPE_DOUBLE) return false;
  const opposingBattler = getBattlerAtPosition(K.B_POSITION_PLAYER_LEFT);
  const opp = g.battleMons[opposingBattler];
  if (opp.ability === K.ABILITY_WONDER_GUARD) {
    // Check if Pokemon has a super effective move.
    for (let i = 0; i < K.MAX_MON_MOVES; ++i) {
      const move = g.battleMons[ab()].moves[i];
      if (move === K.MOVE_NONE) continue;
      if (AI_TypeCalc(move, opp.species, opp.ability) & K.MOVE_RESULT_SUPER_EFFECTIVE) return false;
    }
    // Find a Pokemon in the party that has a super effective move.
    for (let i = 0; i < K.PARTY_SIZE; ++i) {
      const mon = g.enemyParty[i];
      if (!usable(mon) || i === g.battlerPartyIndexes[ab()]) continue;
      for (let j = 0; j < K.MAX_MON_MOVES; ++j) {
        const move = mon.moves[j];
        if (move === K.MOVE_NONE) continue;
        if (AI_TypeCalc(move, opp.species, opp.ability) & K.MOVE_RESULT_SUPER_EFFECTIVE && random() % 3 < 2) return chooseSwitch(i); // We found a mon.
      }
    }
  }
  return false; // There is not a single Pokemon in the party that has a super effective move against a mon with Wonder Guard.
}

function findMonThatAbsorbsOpponentsMove(): boolean {
  const last = g.lastLandedMoves[ab()];
  if ((hasSuperEffectiveMoveAgainstOpponents(true) && random() % 3) || last === K.MOVE_NONE) return false;
  if (last === 0xffff || gBattleMoves[last].power === 0) return false;
  const [in1, in2] = battlersIn();
  let absorbingTypeAbility: number;
  const type = gBattleMoves[last].type;
  if (type === K.TYPE_FIRE) absorbingTypeAbility = K.ABILITY_FLASH_FIRE;
  else if (type === K.TYPE_WATER) absorbingTypeAbility = K.ABILITY_WATER_ABSORB;
  else if (type === K.TYPE_ELECTRIC) absorbingTypeAbility = K.ABILITY_VOLT_ABSORB;
  else return false;
  if (g.battleMons[ab()].ability === absorbingTypeAbility) return false;
  for (let i = 0; i < K.PARTY_SIZE; ++i) {
    const mon = g.enemyParty[i];
    if (!usable(mon) || excluded(i, in1, in2)) continue;
    if (absorbingTypeAbility === partyMonAbility(mon) && random() & 1) return chooseSwitch(i); // we found a mon
  }
  return false;
}

function shouldSwitchIfNaturalCure(): boolean {
  const m = g.battleMons[ab()];
  if (!(m.status1 & K.STATUS1_SLEEP) || m.ability !== K.ABILITY_NATURAL_CURE || m.hp < Math.trunc(m.maxHP / 2)) return false;
  const last = g.lastLandedMoves[ab()];
  if ((last === K.MOVE_NONE || last === 0xffff) && random() & 1) return chooseSwitch(K.PARTY_SIZE);
  else if (gBattleMoves[last].power === 0 && random() & 1) return chooseSwitch(K.PARTY_SIZE);
  if (findMonWithFlagsAndSuperEffective(K.MOVE_RESULT_DOESNT_AFFECT_FOE, 1) || findMonWithFlagsAndSuperEffective(K.MOVE_RESULT_NOT_VERY_EFFECTIVE, 1)) return true;
  if (random() & 1) return chooseSwitch(K.PARTY_SIZE);
  return false;
}

function hasSuperEffectiveMoveAgainstOpponents(noRng: boolean): boolean {
  const check = (opposingBattler: number, rng: () => boolean): boolean => {
    if (g.absentBattlerFlags & bit(opposingBattler)) return false;
    const opp = g.battleMons[opposingBattler];
    for (let i = 0; i < K.MAX_MON_MOVES; ++i) {
      const move = g.battleMons[ab()].moves[i];
      if (move === K.MOVE_NONE) continue;
      if (AI_TypeCalc(move, opp.species, opp.ability) & K.MOVE_RESULT_SUPER_EFFECTIVE && (noRng || rng())) return true;
    }
    return false;
  };
  if (check(getBattlerAtPosition(K.B_POSITION_PLAYER_LEFT), () => random() % 10 !== 0)) return true;
  if (!(g.battleTypeFlags & K.BATTLE_TYPE_DOUBLE)) return false;
  return check(getBattlerAtPosition(K.B_POSITION_PLAYER_LEFT ^ K.BIT_FLANK), () => random() % 10 !== 0);
}

function areStatsRaised(): boolean {
  let buffedStatsValue = 0;
  const m = g.battleMons[ab()];
  for (let i = 0; i < K.NUM_BATTLE_STATS; ++i) if (m.statStages[i] > 6) buffedStatsValue += m.statStages[i] - 6;
  return (buffedStatsValue & 0xff) > 3;
}

function findMonWithFlagsAndSuperEffective(flags: number, moduloPercent: number): boolean {
  const last = g.lastLandedMoves[ab()];
  if (last === 0) return false;
  if (last === 0xffff || g.lastHitBy[ab()] === 0xff || gBattleMoves[last].power === 0) return false;
  const [in1, in2] = battlersIn();
  for (let i = 0; i < K.PARTY_SIZE; ++i) {
    const mon = g.enemyParty[i];
    if (!usable(mon) || excluded(i, in1, in2)) continue;
    if (AI_TypeCalc(last, mon.species, partyMonAbility(mon)) & flags) {
      const hitter = g.battleMons[g.lastHitBy[ab()]];
      for (let j = 0; j < K.MAX_MON_MOVES; ++j) {
        const move = mon.moves[j];
        if (move === K.MOVE_NONE) continue;
        if (AI_TypeCalc(move, hitter.species, hitter.ability) & K.MOVE_RESULT_SUPER_EFFECTIVE && random() % moduloPercent === 0) return chooseSwitch(i);
      }
    }
  }
  return false;
}

function shouldSwitch(): boolean {
  const m = g.battleMons[ab()];
  if (
    m.status2 & (K.STATUS2_WRAPPED | K.STATUS2_ESCAPE_PREVENTION) ||
    g.statuses3[ab()] & K.STATUS3_ROOTED ||
    abilityBattleEffects(K.ABILITYEFFECT_CHECK_OTHER_SIDE, ab(), K.ABILITY_SHADOW_TAG, 0, 0) ||
    abilityBattleEffects(K.ABILITYEFFECT_CHECK_OTHER_SIDE, ab(), K.ABILITY_ARENA_TRAP, 0, 0)
  )
    return false; // misses the flying or levitate check
  if (abilityBattleEffects(K.ABILITYEFFECT_FIELD_SPORT, 0, K.ABILITY_MAGNET_PULL, 0, 0))
    if (m.type1 === K.TYPE_STEEL || m.type2 === K.TYPE_STEEL) return false;
  const [in1, in2] = battlersIn();
  let availableToSwitch = 0;
  for (let i = 0; i < K.PARTY_SIZE; ++i) {
    if (!usable(g.enemyParty[i]) || excluded(i, in1, in2)) continue;
    ++availableToSwitch;
  }
  if (!availableToSwitch) return false;
  if (shouldSwitchIfPerishSong() || shouldSwitchIfWonderGuard() || findMonThatAbsorbsOpponentsMove() || shouldSwitchIfNaturalCure()) return true;
  if (hasSuperEffectiveMoveAgainstOpponents(false) || areStatsRaised()) return false;
  if (findMonWithFlagsAndSuperEffective(K.MOVE_RESULT_DOESNT_AFFECT_FOE, 2) || findMonWithFlagsAndSuperEffective(K.MOVE_RESULT_NOT_VERY_EFFECTIVE, 3)) return true;
  return false;
}

/** AI_TrySwitchOrUseItem */
export function AI_TrySwitchOrUseItem(): void {
  if (g.battleTypeFlags & K.BATTLE_TYPE_TRAINER) {
    if (shouldSwitch()) {
      const bst = g.battleStruct;
      if (bst.AI_monToSwitchIntoId[aiSlot()] === 6) {
        let monToSwitchId = getMostSuitableMonToSwitchInto();
        if (monToSwitchId === 6) {
          let in1: number, in2: number;
          if (!(g.battleTypeFlags & K.BATTLE_TYPE_DOUBLE)) {
            in1 = in2 = getBattlerAtPosition(K.B_POSITION_OPPONENT_LEFT);
          } else {
            in1 = getBattlerAtPosition(K.B_POSITION_OPPONENT_LEFT);
            in2 = getBattlerAtPosition(K.B_POSITION_OPPONENT_RIGHT);
          }
          for (monToSwitchId = 0; monToSwitchId < K.PARTY_SIZE; ++monToSwitchId) {
            // (!GetMonData(HP) == 0): the precedence bug makes this "HP is nonzero"
            if ((g.enemyParty[monToSwitchId]?.hp ?? 0) !== 0 && !excluded(monToSwitchId, in1, in2)) break;
          }
        }
        bst.AI_monToSwitchIntoId[aiSlot()] = monToSwitchId;
      }
      bst.monToSwitchIntoId[ab()] = bst.AI_monToSwitchIntoId[aiSlot()];
      return;
    } else if (shouldUseItem()) {
      return;
    }
  }
  emitTwoReturnValues(K.BUFFER_B, K.B_ACTION_USE_MOVE, (ab() ^ K.BIT_SIDE) << 8);
}

/** ModulateByTypeEffectiveness: var is a u8 */
function modulateByTypeEffectiveness(atkType: number, defType1: number, defType2: number, v: number): number {
  let i = 0;
  while (typeAtk(i) !== K.TYPE_ENDTABLE) {
    if (typeAtk(i) === K.TYPE_FORESIGHT) {
      i += 3;
      continue;
    } else if (typeAtk(i) === atkType) {
      if (typeDef(i) === defType1) v = Math.trunc(((v & 0xff) * typeMul(i)) / 10) & 0xff; // Check type1.
      if (typeDef(i) === defType2 && defType1 !== defType2) v = Math.trunc(((v & 0xff) * typeMul(i)) / 10) & 0xff; // Check type2.
    }
    i += 3;
  }
  return v;
}

/** GetMostSuitableMonToSwitchInto */
export function getMostSuitableMonToSwitchInto(): number {
  const bst = g.battleStruct;
  if (bst.monToSwitchIntoId[ab()] !== K.PARTY_SIZE) return bst.monToSwitchIntoId[ab()];
  let opposingBattler: number;
  let in1: number, in2: number;
  if (g.battleTypeFlags & K.BATTLE_TYPE_DOUBLE) {
    [in1, in2] = battlersIn();
    // UB: It considers the opponent only player's side even though it can battle alongside player.
    opposingBattler = random() & K.BIT_FLANK;
    if (g.absentBattlerFlags & bit(opposingBattler)) opposingBattler ^= K.BIT_FLANK;
  } else {
    opposingBattler = getBattlerAtPosition(K.B_POSITION_PLAYER_LEFT);
    in1 = in2 = ab();
  }
  const opp = g.battleMons[opposingBattler];
  let invalidMons = 0;
  let bestDmg: number; // u8 in the original ("should be changed to u32 for obvious reasons")
  let bestMonId: number;
  while (invalidMons !== 0x3f) {
    // All mons are invalid.
    bestDmg = 0;
    bestMonId = 6;
    // Find the mon whose type is the most suitable offensively.
    for (let i = 0; i < K.PARTY_SIZE; ++i) {
      const mon = g.enemyParty[i];
      const species = mon?.species ?? K.SPECIES_NONE;
      if (species !== K.SPECIES_NONE && mon!.hp !== 0 && !(bit(i) & invalidMons) && !excluded(i, in1, in2)) {
        const [type1, type2] = gSpeciesInfo[species].types;
        let typeDmg = 10;
        typeDmg = modulateByTypeEffectiveness(opp.type1, type1, type2, typeDmg);
        typeDmg = modulateByTypeEffectiveness(opp.type2, type1, type2, typeDmg);
        if (bestDmg < typeDmg) {
          bestDmg = typeDmg;
          bestMonId = i;
        }
      } else {
        invalidMons |= bit(i);
      }
    }
    // Ok, we know the mon has the right typing but does it have at least one super effective move?
    if (bestMonId !== K.PARTY_SIZE) {
      let i = 0;
      for (; i < K.MAX_MON_MOVES; ++i) {
        const move = g.enemyParty[bestMonId]!.moves[i];
        if (move !== K.MOVE_NONE && typeCalc(move, ab(), opposingBattler) & K.MOVE_RESULT_SUPER_EFFECTIVE) break;
      }
      if (i !== K.MAX_MON_MOVES) return bestMonId; // Has both the typing and at least one super effective move.
      invalidMons |= bit(bestMonId); // Sorry buddy, we want something better.
    } else {
      invalidMons = 0x3f; // No viable mon to switch.
    }
  }
  g.dynamicBasePower = 0;
  bst.dynamicMoveType = 0;
  g.battleScripting.dmgMultiplier = 1;
  g.moveResultFlags = 0;
  g.critMultiplier = 1;
  bestDmg = 0;
  bestMonId = 6;
  // If we couldn't find the best mon in terms of typing, find the one that deals most damage.
  for (let i = 0; i < K.PARTY_SIZE; ++i) {
    const mon = g.enemyParty[i];
    if ((mon?.species ?? K.SPECIES_NONE) === K.SPECIES_NONE || mon!.hp === 0 || excluded(i, in1, in2)) continue;
    for (let j = 0; j < K.MAX_MON_MOVES; ++j) {
      const move = mon!.moves[j];
      g.battleMoveDamage = 0;
      if (move !== K.MOVE_NONE && gBattleMoves[move].power !== 1) {
        // the original computes with gCurrentMove, not `move` (AI_CalcDmg reads gCurrentMove)
        AI_CalcDmg(ab(), opposingBattler);
        typeCalc(move, ab(), opposingBattler);
      }
      if (bestDmg < g.battleMoveDamage) {
        bestDmg = g.battleMoveDamage & 0xff;
        bestMonId = i;
      }
    }
  }
  return bestMonId;
}

/** GetAI_ItemType */
function getAI_ItemType(itemId: number, itemEffect: number[]): number {
  if ((itemId & 0xff) === K.ITEM_FULL_RESTORE) return K.AI_ITEM_FULL_RESTORE;
  else if (itemEffect[4] & K.ITEM4_HEAL_HP) return K.AI_ITEM_HEAL_HP;
  else if (itemEffect[3] & K.ITEM3_STATUS_ALL) return K.AI_ITEM_CURE_CONDITION;
  else if (itemEffect[0] & (K.ITEM0_DIRE_HIT | K.ITEM0_X_ATTACK) || itemEffect[1] !== 0 || itemEffect[2] !== 0) return K.AI_ITEM_X_STAT;
  else if (itemEffect[3] & K.ITEM3_GUARD_SPEC) return K.AI_ITEM_GUARD_SPECS;
  return K.AI_ITEM_NOT_RECOGNIZABLE;
}

function shouldUseItem(): boolean {
  let validMons = 0;
  let shouldUse = false;
  const hist = g.battleResources.battleHistory;
  const bst = g.battleStruct;
  const half = ab() >> 1;
  const m = g.battleMons[ab()];
  for (let i = 0; i < K.PARTY_SIZE; ++i) if (usable(g.enemyParty[i])) ++validMons;
  for (let i = 0; i < K.MAX_TRAINER_ITEMS; ++i) {
    if (i && validMons > hist.itemsNo - i + 1) continue;
    const item = hist.trainerItems[i];
    if (item === K.ITEM_NONE || !itemEffectTable(item)) continue;
    // ITEM_ENIGMA_BERRY reads gSaveBlock1Ptr->enigmaBerry; trainers don't carry it
    const itemEffects = itemEffectTable(item)!;
    bst.AI_itemType[half] = getAI_ItemType(item, itemEffects);
    switch (bst.AI_itemType[half]) {
      case K.AI_ITEM_FULL_RESTORE:
        if (m.hp >= Math.trunc(m.maxHP / 4)) break;
        if (m.hp === 0) break;
        shouldUse = true;
        break;
      case K.AI_ITEM_HEAL_HP: {
        const paramOffset = getItemEffectParamOffset(item, 4, 4);
        if (paramOffset === 0 || m.hp === 0) break;
        if (m.hp < Math.trunc(m.maxHP / 4) || m.maxHP - m.hp > itemEffects[paramOffset]) shouldUse = true;
        break;
      }
      case K.AI_ITEM_CURE_CONDITION:
        bst.AI_itemFlags[half] = 0;
        if (itemEffects[3] & K.ITEM3_SLEEP && m.status1 & K.STATUS1_SLEEP) {
          bst.AI_itemFlags[half] |= 0x20;
          shouldUse = true;
        }
        if (itemEffects[3] & K.ITEM3_POISON && (m.status1 & K.STATUS1_POISON || m.status1 & K.STATUS1_TOXIC_POISON)) {
          bst.AI_itemFlags[half] |= 0x10;
          shouldUse = true;
        }
        if (itemEffects[3] & K.ITEM3_BURN && m.status1 & K.STATUS1_BURN) {
          bst.AI_itemFlags[half] |= 0x8;
          shouldUse = true;
        }
        if (itemEffects[3] & K.ITEM3_FREEZE && m.status1 & K.STATUS1_FREEZE) {
          bst.AI_itemFlags[half] |= 0x4;
          shouldUse = true;
        }
        if (itemEffects[3] & K.ITEM3_PARALYSIS && m.status1 & K.STATUS1_PARALYSIS) {
          bst.AI_itemFlags[half] |= 0x2;
          shouldUse = true;
        }
        if (itemEffects[3] & K.ITEM3_CONFUSION && m.status2 & K.STATUS2_CONFUSION) {
          bst.AI_itemFlags[half] |= 0x1;
          shouldUse = true;
        }
        break;
      case K.AI_ITEM_X_STAT:
        bst.AI_itemFlags[half] = 0;
        if (!g.disableStructs[ab()].isFirstTurn) break;
        if (itemEffects[0] & K.ITEM0_X_ATTACK) bst.AI_itemFlags[half] |= 0x1;
        if (itemEffects[1] & K.ITEM1_X_DEFEND) bst.AI_itemFlags[half] |= 0x2;
        if (itemEffects[1] & K.ITEM1_X_SPEED) bst.AI_itemFlags[half] |= 0x4;
        if (itemEffects[2] & K.ITEM2_X_SPATK) bst.AI_itemFlags[half] |= 0x8;
        if (itemEffects[2] & K.ITEM2_X_ACCURACY) bst.AI_itemFlags[half] |= 0x20;
        if (itemEffects[0] & K.ITEM0_DIRE_HIT) bst.AI_itemFlags[half] |= 0x80;
        shouldUse = true;
        break;
      case K.AI_ITEM_GUARD_SPECS:
        if (g.disableStructs[ab()].isFirstTurn && g.sideTimers[getBattlerSide(ab())].mistTimer === 0) shouldUse = true;
        break;
      case K.AI_ITEM_NOT_RECOGNIZABLE:
        return false;
    }
    if (shouldUse) {
      emitTwoReturnValues(K.BUFFER_B, K.B_ACTION_USE_ITEM, 0);
      bst.chosenItem[half * 2] = item & 0xff;
      bst.chosenItem[half * 2 + 1] = item >> 8;
      hist.trainerItems[i] = 0;
      return shouldUse;
    }
  }
  return false;
}
