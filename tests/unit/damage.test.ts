import { beforeAll, beforeEach, describe, expect, test } from 'vitest';
import { K } from '../../src/battle/constants';
import { g } from '../../src/battle/env';
import { calculateBaseDamage } from '../../src/battle/pokemonBattle';
import { BattlePokemon } from '../../src/battle/structs';
import { newBattleEnv, type TestGame } from './gameData';

let t: TestGame;

beforeAll(async () => {
  t = await newBattleEnv();
});

beforeEach(() => {
  g.battleTypeFlags = 0;
  g.battlersCount = 0;
  g.critMultiplier = 1;
  g.battleWeather = 0;
});

function battler(stats: Partial<BattlePokemon> = {}): BattlePokemon {
  const mon = Object.assign(new BattlePokemon(), { level: 50, attack: 100, defense: 100, spAttack: 100, spDefense: 100, hp: 100, maxHP: 100 }, stats);
  mon.statStages.fill(K.DEFAULT_STAT_STAGE);
  return mon;
}

/** CalculateBaseDamage for `move` (gCurrentMove set too, as the battle script would have). */
function damage(attacker: BattlePokemon, defender: BattlePokemon, moveName: string, sideStatus = 0): number {
  const move = t.d(`MOVE_${moveName}`);
  g.currentMove = move;
  return calculateBaseDamage(attacker, defender, move, sideStatus, 0, 0, 0, 1);
}

/** The Gen III formula before modifiers: ((2L/5 + 2) * power * A / D) / 50 + 2, each step truncated. */
const formula = (level: number, power: number, a: number, d: number) => Math.floor(Math.floor((a * power * (Math.floor((2 * level) / 5) + 2)) / d) / 50) + 2;

describe('CalculateBaseDamage (pokemon.c)', () => {
  test('physical move: plain formula', () => {
    // Tackle: 35 power, Normal (physical in Gen III)
    expect(damage(battler(), battler(), 'TACKLE')).toBe(formula(50, 35, 100, 100));
    expect(damage(battler({ level: 100, attack: 300 }), battler({ defense: 150 }), 'TACKLE')).toBe(formula(100, 35, 300, 150));
  });

  test('special moves use special attack and special defense (by type)', () => {
    // Thunderbolt: 95 power, Electric (special)
    const atk = battler({ attack: 1, spAttack: 200 });
    const def = battler({ defense: 1, spDefense: 80 });
    expect(damage(atk, def, 'THUNDERBOLT')).toBe(formula(50, 95, 200, 80));
  });

  test('stat stages scale attack and defense', () => {
    const atk = battler();
    atk.statStages[K.STAT_ATK] = K.DEFAULT_STAT_STAGE + 2; // x2
    expect(damage(atk, battler(), 'TACKLE')).toBe(formula(50, 35, 200, 100));
    const def = battler();
    def.statStages[K.STAT_DEF] = K.DEFAULT_STAT_STAGE - 1; // x2/3
    expect(damage(battler(), def, 'TACKLE')).toBe(formula(50, 35, 100, 66));
  });

  test('a critical hit ignores the attacker’s drops and the defender’s boosts', () => {
    const atk = battler();
    atk.statStages[K.STAT_ATK] = K.DEFAULT_STAT_STAGE - 2;
    const def = battler();
    def.statStages[K.STAT_DEF] = K.DEFAULT_STAT_STAGE + 2;
    g.critMultiplier = 2; // the x2 itself is applied later, by the battle script
    expect(damage(atk, def, 'TACKLE')).toBe(formula(50, 35, 100, 100));
  });

  test('burn halves physical damage (not with Guts)', () => {
    const base = Math.floor(Math.floor((100 * 80 * 22) / 100) / 50);
    const burned = battler({ status1: K.STATUS1_BURN });
    expect(damage(burned, battler(), 'SLAM')).toBe(Math.floor(base / 2) + 2); // Slam: 80 power
    const guts = battler({ status1: K.STATUS1_BURN, ability: K.ABILITY_GUTS });
    expect(damage(guts, battler(), 'SLAM')).toBe(formula(50, 80, 150, 100));
  });

  test('Reflect halves physical and Light Screen special, except on a crit', () => {
    const base = Math.floor(Math.floor((100 * 80 * 22) / 100) / 50);
    expect(damage(battler(), battler(), 'SLAM', K.SIDE_STATUS_REFLECT)).toBe(Math.floor(base / 2) + 2);
    expect(damage(battler(), battler(), 'SLAM', K.SIDE_STATUS_LIGHTSCREEN)).toBe(base + 2);
    g.critMultiplier = 2;
    expect(damage(battler(), battler(), 'SLAM', K.SIDE_STATUS_REFLECT)).toBe(base + 2);
  });

  test('Huge Power doubles attack; Thick Fat halves fire/ice special attack', () => {
    expect(damage(battler({ ability: K.ABILITY_HUGE_POWER }), battler(), 'TACKLE')).toBe(formula(50, 35, 200, 100));
    expect(damage(battler(), battler({ ability: K.ABILITY_THICK_FAT }), 'FLAMETHROWER')).toBe(formula(50, 95, 50, 100));
  });

  test('Overgrow/Blaze/Torrent boost power 1.5x at a third of max HP or less', () => {
    const pinch = battler({ ability: K.ABILITY_BLAZE, hp: 33, maxHP: 100 });
    expect(damage(pinch, battler(), 'EMBER')).toBe(formula(50, 60, 100, 100)); // Ember: 40 → 60
    const healthy = battler({ ability: K.ABILITY_BLAZE, hp: 34, maxHP: 100 });
    expect(damage(healthy, battler(), 'EMBER')).toBe(formula(50, 40, 100, 100));
  });

  test('the first gym badge boosts the player side’s attack by 10%', () => {
    t.state.setFlag('FLAG_BADGE01_GET');
    try {
      // battler 0 is on the player side; the defender (1) is not
      expect(damage(battler(), battler(), 'TACKLE')).toBe(formula(50, 35, 110, 100));
    } finally {
      t.state.setFlag('FLAG_BADGE01_GET', false);
    }
  });

  test('always at least 1 before the +2', () => {
    expect(damage(battler({ level: 1, attack: 5 }), battler({ defense: 500 }), 'TACKLE')).toBe(3);
  });
});
