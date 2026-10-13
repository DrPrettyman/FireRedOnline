// Item effects from pokemon.c as used in battle: gItemEffectTable, GetItemEffectParamOffset and
// PokemonUseItemEffects (with gMain.inBattle set). Evolution stones and the ITEM5 effects (Def/Spe/
// SpA/SpD EV items, PP Max, friendship) only come up from the bag, which battles can't open yet.

import type { Pokemon, Stat } from '../pokemon/Pokemon';
import { K } from './constants';
import { emitGetMonData, markBattlerForControllerExec } from './controllers';
import { bdata, g, gSpeciesInfo, pokemon } from './env';
import { bit } from './globals';
import { getPartyIdFromBattlePartyId } from './partyOrder';
import { calculateMonStats, calculatePPWithBonus, copyPlayerPartyMonToBattleData } from './pokemonBattle';
import { getBattlerSide, moveIsPermanent } from './util';

/** gItemEffectTable[item - ITEM_POTION] (undefined = NULL) */
export function itemEffectTable(item: number): number[] | undefined {
  const t = (bdata.tables.mech as { itemEffects: Record<string, number[]> }).itemEffects;
  return t[item];
}

function effectFor(item: number): number[] | undefined {
  if (item === K.ITEM_ENIGMA_BERRY) return Array.from(g.enigmaBerries[g.activeBattler].itemEffect);
  return itemEffectTable(item);
}

/** GetItemEffectParamOffset */
export function getItemEffectParamOffset(itemId: number, effectByte: number, effectBit: number): number {
  let offset = K.ITEM_EFFECT_ARG_START;
  const itemEffect = effectFor(itemId);
  if (!itemEffect) return 0;
  for (let i = 0; i < K.ITEM_EFFECT_ARG_START; i++) {
    switch (i) {
      case 0:
      case 1:
      case 2:
      case 3:
        if (i === effectByte) return 0;
        break;
      case 4: {
        let val = itemEffect[4];
        if (val & K.ITEM4_PP_UP) val &= ~K.ITEM4_PP_UP;
        let j = 0;
        while (val) {
          if (val & 1) {
            switch (j) {
              case 2: // ITEM4_HEAL_HP
                if (val & (K.ITEM4_REVIVE >> 2)) val &= ~(K.ITEM4_REVIVE >> 2);
              // fallthrough
              case 0: // ITEM4_EV_HP
              case 1: // ITEM4_EV_ATK
              case 3: // ITEM4_HEAL_PP
                if (i === effectByte && val & effectBit) return offset;
                offset++;
                break;
              case 7: // ITEM4_EVO_STONE
                if (i === effectByte) return 0;
                break;
            }
          }
          j++;
          val >>= 1;
          if (i === effectByte) effectBit >>= 1;
        }
        break;
      }
      case 5: {
        let val = itemEffect[5];
        let j = 0;
        while (val) {
          if (val & 1) {
            if (j <= 6) {
              // EV_DEF, EV_SPEED, EV_SPDEF, EV_SPATK, PP_MAX, FRIENDSHIP_LOW, FRIENDSHIP_MID
              if (i === effectByte && val & effectBit) return offset;
              offset++;
            } else if (i === effectByte) {
              return 0; // ITEM5_FRIENDSHIP_HIGH
            }
          }
          j++;
          val >>= 1;
          if (i === effectByte) effectBit >>= 1;
        }
        break;
      }
    }
  }
  return offset;
}

/** HealStatusConditions: false if something was healed. */
function healStatusConditions(mon: Pokemon, healMask: number, battleId: number): boolean {
  const status = mon.status >>> 0;
  if (status & healMask) {
    mon.status = (status & ~healMask) >>> 0;
    if (battleId !== K.MAX_BATTLERS_COUNT) g.battleMons[battleId].status1 &= ~healMask;
    return false;
  }
  return true;
}

/** sGetMonDataEVConstants */
const EV_STATS: Stat[] = ['hp', 'attack', 'defense', 'speed', 'spDefense', 'spAttack'];

function evCount(mon: Pokemon): number {
  return EV_STATS.reduce((n, s) => n + mon.evs[s], 0);
}

/** PokemonUseItemEffects (gMain.inBattle): true = the item had no effect. */
export function pokemonUseItemEffects(mon: Pokemon, item: number, partyIndex: number, moveIndex: number, usedByAI: boolean): boolean {
  let retVal = true;
  let idx = K.ITEM_EFFECT_ARG_START;
  let battleMonId = K.MAX_BATTLERS_COUNT;
  // Get battler id (if relevant)
  g.potentialItemEffectBattler = g.battlerInMenuId;
  g.activeBattler = g.battlerInMenuId;
  for (let cmdIndex = getBattlerSide(g.activeBattler) !== K.B_SIDE_PLAYER ? 1 : 0; cmdIndex < g.battlersCount; cmdIndex += 2) {
    if (g.battlerPartyIndexes[cmdIndex] === partyIndex) {
      battleMonId = cmdIndex;
      break;
    }
  }
  // Skip using the item if it won't do anything
  if (!(item >= K.ITEM_POTION && item <= K.MAX_BERRY_INDEX)) return true;
  const itemEffect = effectFor(item);
  if (!itemEffect) return true;
  const ab = g.battleMons[g.activeBattler];
  const raise = (stat: number, by: number) => {
    ab.statStages[stat] += by;
    if (ab.statStages[stat] > K.MAX_STAT_STAGE) ab.statStages[stat] = K.MAX_STAT_STAGE;
    retVal = false;
  };
  for (let cmdIndex = 0; cmdIndex < K.ITEM_EFFECT_ARG_START; cmdIndex++) {
    const e = itemEffect[cmdIndex] ?? 0;
    switch (cmdIndex) {
      // Handle ITEM0 effects (infatuation, Dire Hit, X Attack). ITEM0_SACRED_ASH is handled in party_menu.c
      case 0:
        if (e & K.ITEM0_INFATUATION && battleMonId !== K.MAX_BATTLERS_COUNT && g.battleMons[battleMonId].status2 & K.STATUS2_INFATUATION) {
          g.battleMons[battleMonId].status2 &= ~K.STATUS2_INFATUATION;
          retVal = false;
        }
        if (e & K.ITEM0_DIRE_HIT && !(ab.status2 & K.STATUS2_FOCUS_ENERGY)) {
          ab.status2 |= K.STATUS2_FOCUS_ENERGY;
          retVal = false;
        }
        if (e & K.ITEM0_X_ATTACK && ab.statStages[K.STAT_ATK] < K.MAX_STAT_STAGE) raise(K.STAT_ATK, e & K.ITEM0_X_ATTACK);
        break;
      // Handle ITEM1 effects (in-battle stat boosting effects)
      case 1:
        if (e & K.ITEM1_X_DEFEND && ab.statStages[K.STAT_DEF] < K.MAX_STAT_STAGE) raise(K.STAT_DEF, (e & K.ITEM1_X_DEFEND) >> 4);
        if (e & K.ITEM1_X_SPEED && ab.statStages[K.STAT_SPEED] < K.MAX_STAT_STAGE) raise(K.STAT_SPEED, e & K.ITEM1_X_SPEED);
        break;
      // Handle ITEM2 effects (more stat boosting effects)
      case 2:
        if (e & K.ITEM2_X_ACCURACY && ab.statStages[K.STAT_ACC] < K.MAX_STAT_STAGE) raise(K.STAT_ACC, (e & K.ITEM2_X_ACCURACY) >> 4);
        if (e & K.ITEM2_X_SPATK && ab.statStages[K.STAT_SPATK] < K.MAX_STAT_STAGE) raise(K.STAT_SPATK, e & K.ITEM2_X_SPATK);
        break;
      // Handle ITEM3 effects (Guard Spec, Rare Candy, cure status)
      case 3: {
        const st = g.sideTimers[getBattlerSide(g.activeBattler)];
        if (e & K.ITEM3_GUARD_SPEC && st.mistTimer === 0) {
          st.mistTimer = 5;
          retVal = false;
        }
        if (e & K.ITEM3_LEVEL_UP && mon.level !== K.MAX_LEVEL) {
          mon.exp = pokemon.tables.experience[gSpeciesInfo[mon.species].growthRate][mon.level + 1];
          calculateMonStats(mon);
          retVal = false;
        }
        if (e & K.ITEM3_SLEEP && !healStatusConditions(mon, K.STATUS1_SLEEP, battleMonId)) {
          if (battleMonId !== K.MAX_BATTLERS_COUNT) g.battleMons[battleMonId].status2 &= ~K.STATUS2_NIGHTMARE;
          retVal = false;
        }
        if (e & K.ITEM3_POISON && !healStatusConditions(mon, K.STATUS1_PSN_ANY | K.STATUS1_TOXIC_COUNTER, battleMonId)) retVal = false;
        if (e & K.ITEM3_BURN && !healStatusConditions(mon, K.STATUS1_BURN, battleMonId)) retVal = false;
        if (e & K.ITEM3_FREEZE && !healStatusConditions(mon, K.STATUS1_FREEZE, battleMonId)) retVal = false;
        if (e & K.ITEM3_PARALYSIS && !healStatusConditions(mon, K.STATUS1_PARALYSIS, battleMonId)) retVal = false;
        if (e & K.ITEM3_CONFUSION && battleMonId !== K.MAX_BATTLERS_COUNT && g.battleMons[battleMonId].status2 & K.STATUS2_CONFUSION) {
          g.battleMons[battleMonId].status2 &= ~K.STATUS2_CONFUSION;
          retVal = false;
        }
        break;
      }
      // Handle ITEM4 effects (Change HP/Atk EVs, HP heal, PP heal, PP up, Revive, and evolution stones)
      case 4: {
        let val = e;
        if (val & K.ITEM4_PP_UP) {
          val &= ~K.ITEM4_PP_UP;
          const mech = bdata.tables.mech as { gPPUpGetMask: number[] };
          const ups = (mon.ppBonuses & mech.gPPUpGetMask[moveIndex]) >> (moveIndex * 2);
          const before = calculatePPWithBonus(mon.moves[moveIndex], mon.ppBonuses, moveIndex);
          if (ups < 3 && before > 4) {
            mon.ppBonuses += 1 << (moveIndex * 2); // gPPUpAddValues
            mon.pp[moveIndex] += calculatePPWithBonus(mon.moves[moveIndex], mon.ppBonuses, moveIndex) - before;
            retVal = false;
          }
        }
        let i = 0;
        // Loop through and try each of the remaining ITEM4 effects
        while (val !== 0) {
          if (val & 1) {
            switch (i) {
              case 0: // ITEM4_EV_HP
              case 1: {
                // ITEM4_EV_ATK
                const count = evCount(mon);
                // Has EV increase limit already been reached?
                if (count >= K.MAX_TOTAL_EVS) return true;
                let data = mon.evs[EV_STATS[i]];
                if (data < K.EV_ITEM_RAISE_LIMIT) {
                  // Limit the increase
                  let evDelta = data + itemEffect[idx] > K.EV_ITEM_RAISE_LIMIT ? K.EV_ITEM_RAISE_LIMIT - data : itemEffect[idx];
                  if (count + evDelta > K.MAX_TOTAL_EVS) evDelta += K.MAX_TOTAL_EVS - (count + evDelta);
                  data += evDelta;
                  mon.evs[EV_STATS[i]] = data;
                  calculateMonStats(mon);
                  idx++;
                  retVal = false;
                }
                break;
              }
              case 2: {
                // ITEM4_HEAL_HP
                // If Revive, update number of times revive has been used
                if (val & (K.ITEM4_REVIVE >> 2)) {
                  if (mon.hp !== 0) {
                    idx++;
                    break;
                  }
                  if (battleMonId !== K.MAX_BATTLERS_COUNT) {
                    g.absentBattlerFlags &= ~bit(battleMonId);
                    copyPlayerPartyMonToBattleData(battleMonId, getPartyIdFromBattlePartyId(g.battlerPartyIndexes[battleMonId]));
                  } else {
                    g.absentBattlerFlags &= ~bit(g.activeBattler ^ 2);
                  }
                  if (getBattlerSide(g.activeBattler) === K.B_SIDE_PLAYER && g.battleResults.numRevivesUsed < 255) g.battleResults.numRevivesUsed++;
                } else if (mon.hp === 0) {
                  idx++;
                  break;
                }
                // Get amount of HP to restore
                let data = itemEffect[idx++];
                switch (data) {
                  case 0xff: // ITEM6_HEAL_HP_FULL
                    data = mon.maxHP - mon.hp;
                    break;
                  case 0xfe: // ITEM6_HEAL_HP_HALF
                    data = Math.trunc(mon.maxHP / 2);
                    if (data === 0) data = 1;
                    break;
                  case 0xfd: // ITEM6_HEAL_HP_LVL_UP
                    data = g.battleScripting.levelUpHP;
                    break;
                }
                // Only restore HP if not at max health
                if (mon.maxHP !== mon.hp) {
                  if (!usedByAI) {
                    data = Math.min(mon.hp + data, mon.maxHP);
                    mon.hp = data;
                    if (battleMonId !== K.MAX_BATTLERS_COUNT) {
                      g.battleMons[battleMonId].hp = data;
                      if (!(val & (K.ITEM4_REVIVE >> 2)) && getBattlerSide(g.activeBattler) === K.B_SIDE_PLAYER) {
                        if (g.battleResults.numHealingItemsUsed < 255) g.battleResults.numHealingItemsUsed++;
                        const r5 = g.activeBattler;
                        g.activeBattler = battleMonId;
                        emitGetMonData(K.BUFFER_A, K.REQUEST_ALL_BATTLE, 0);
                        markBattlerForControllerExec(g.activeBattler);
                        g.activeBattler = r5;
                      }
                    }
                  } else {
                    g.battleMoveDamage = -data;
                  }
                  retVal = false;
                }
                val &= ~(K.ITEM4_REVIVE >> 2);
                break;
              }
              case 3: // ITEM4_HEAL_PP
                if (!(val & (K.ITEM4_HEAL_PP_ONE >> 3))) {
                  // Heal PP for all moves
                  for (let r5 = 0; r5 < K.MAX_MON_MOVES; r5++) {
                    const max = calculatePPWithBonus(mon.moves[r5], mon.ppBonuses, r5);
                    if (mon.pp[r5] !== max) {
                      mon.pp[r5] = Math.min(mon.pp[r5] + itemEffect[idx], max);
                      if (battleMonId !== K.MAX_BATTLERS_COUNT && moveIsPermanent(battleMonId, r5)) g.battleMons[battleMonId].pp[r5] = mon.pp[r5];
                      retVal = false;
                    }
                  }
                  idx++;
                } else {
                  // Heal PP for one move
                  const max = calculatePPWithBonus(mon.moves[moveIndex], mon.ppBonuses, moveIndex);
                  if (mon.pp[moveIndex] !== max) {
                    mon.pp[moveIndex] = Math.min(mon.pp[moveIndex] + itemEffect[idx++], max);
                    if (battleMonId !== K.MAX_BATTLERS_COUNT && moveIsPermanent(battleMonId, moveIndex)) g.battleMons[battleMonId].pp[moveIndex] = mon.pp[moveIndex];
                    retVal = false;
                  }
                }
                break;
              case 7: // ITEM4_EVO_STONE
                console.warn('[battle] evolution stones not supported in PokemonUseItemEffects');
                break;
            }
          }
          i++;
          val >>= 1;
        }
        break;
      }
      case 5:
        if (e) console.warn(`[battle] ITEM5 effects of item ${item} not implemented`);
        break;
    }
  }
  return retVal;
}
