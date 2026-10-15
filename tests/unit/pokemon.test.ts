import { beforeAll, describe, expect, test } from 'vitest';
import { STATS, type Pokemon } from '../../src/pokemon/Pokemon';
import { seedRng } from '../../src/util/random';
import { newGame, type TestGame } from './gameData';

let t: TestGame;
const opts = { otId: 1, otName: 'RED', otGender: 'male' as const, metLocation: 'MAPSEC_PALLET_TOWN' };
const species = (name: string) => t.d(`SPECIES_${name}`);

beforeAll(() => {
  t = newGame();
  seedRng(1);
});

/** The Gen III stat formula, written independently of CalculateMonStats (pokemon.c). */
function expectedStats(mon: Pokemon) {
  const info = t.pokemon.species[mon.species];
  const base = [info.baseHP, info.baseAttack, info.baseDefense, info.baseSpeed, info.baseSpAttack, info.baseSpDefense];
  const nature = mon.personality % 25;
  // sNatureStatTable rows: +10% to stat (nature / 5), -10% to stat (nature % 5), over attack..spDefense
  const up = Math.floor(nature / 5) + 1;
  const down = (nature % 5) + 1;
  return STATS.map((s, i) => {
    const core = Math.floor(((2 * base[i] + mon.ivs[s] + Math.floor(mon.evs[s] / 4)) * mon.level) / 100);
    if (i === 0) return core + mon.level + 10;
    const v = core + 5;
    if (up === down) return v;
    if (i === up) return Math.floor((v * 110) / 100);
    if (i === down) return Math.floor((v * 90) / 100);
    return v;
  });
}

describe('CreateMon / CalculateMonStats', () => {
  test('level-100 Mewtwo with max IVs and a neutral nature has its well-known stats', () => {
    const mon = t.pokemon.createMon(species('MEWTWO'), 100, { ...opts, fixedIV: 31, personality: 0 }); // Hardy
    expect(mon.level).toBe(100);
    expect(mon.stats).toEqual({ hp: 353, attack: 256, defense: 216, speed: 296, spAttack: 344, spDefense: 216 });
    expect(mon.hp).toBe(353);
  });

  test.each(['BULBASAUR', 'PIKACHU', 'GEODUDE', 'DRAGONITE', 'CHANSEY', 'MAGIKARP'])('%s at several levels and natures matches the formula', (name) => {
    for (const level of [1, 5, 37, 100]) {
      for (const personality of [0, 1, 6, 12, 24, 0xdeadbeef]) {
        const mon = t.pokemon.createMon(species(name), level, { ...opts, personality });
        const exp = expectedStats(mon);
        expect(STATS.map((s) => mon.stats[s])).toEqual(exp);
        expect(mon.maxHP).toBe(exp[0]);
      }
    }
  });

  test('EVs count a quarter, rounded down', () => {
    const mon = t.pokemon.createMon(species('MACHOP'), 50, { ...opts, fixedIV: 0, personality: 0 });
    const before = mon.stats.attack;
    mon.evs.attack = 255;
    t.pokemon.calculateStats(mon);
    expect(mon.stats.attack).toBe(before + Math.floor(Math.floor(255 / 4) * 50 / 100));
  });

  test('Shedinja always has 1 max HP', () => {
    const mon = t.pokemon.createMon(species('SHEDINJA'), 50, { ...opts, fixedIV: 31 });
    expect(mon.maxHP).toBe(1);
    expect(mon.hp).toBe(1);
  });

  test('levelling up keeps the HP already lost', () => {
    const mon = t.pokemon.createMon(species('RATTATA'), 10, opts);
    mon.hp -= 5;
    const lost = mon.maxHP - mon.hp;
    mon.exp = t.pokemon.tables.experience[t.pokemon.species[mon.species].growthRate][11];
    t.pokemon.calculateStats(mon);
    expect(mon.level).toBe(11);
    expect(mon.maxHP - mon.hp).toBe(lost);
  });

  test('a fainted mon stays at 0 HP through a stat recalculation', () => {
    const mon = t.pokemon.createMon(species('RATTATA'), 10, opts);
    mon.hp = 0;
    t.pokemon.calculateStats(mon);
    expect(mon.hp).toBe(0);
  });
});

describe('experience and levels', () => {
  test('a new mon has exactly the experience for its level', () => {
    for (const name of ['BULBASAUR', 'MEWTWO', 'MAGIKARP']) {
      const mon = t.pokemon.createMon(species(name), 30, opts);
      expect(mon.exp).toBe(t.pokemon.tables.experience[t.pokemon.species[mon.species].growthRate][30]);
      expect(t.pokemon.levelFromExp(mon)).toBe(30);
    }
  });

  test('one experience point short of the next level is still the current level', () => {
    const mon = t.pokemon.createMon(species('PIDGEY'), 20, opts);
    const table = t.pokemon.tables.experience[t.pokemon.species[mon.species].growthRate];
    mon.exp = table[21] - 1;
    expect(t.pokemon.levelFromExp(mon)).toBe(20);
    mon.exp = table[21];
    expect(t.pokemon.levelFromExp(mon)).toBe(21);
  });

  test('levels cap at 100', () => {
    const mon = t.pokemon.createMon(species('PIDGEY'), 100, opts);
    mon.exp += 1_000_000;
    expect(t.pokemon.levelFromExp(mon)).toBe(100);
  });
});

describe('GiveBoxMonInitialMoveset', () => {
  test('knows the last four level-up moves at or below its level', () => {
    for (const [name, level] of [['MEWTWO', 100], ['BULBASAUR', 5], ['CHARMANDER', 30], ['MAGIKARP', 30]] as const) {
      const mon = t.pokemon.createMon(species(name), level, opts);
      const learned: number[] = [];
      for (const [lv, move] of t.pokemon.species[mon.species].learnset) if (lv <= level && !learned.includes(move)) learned.push(move);
      const want = learned.slice(-4);
      expect(mon.moves.filter((m) => m)).toEqual(want);
      mon.moves.forEach((m, i) => expect(mon.pp[i]).toBe(m ? t.pokemon.moves[m].pp : 0));
    }
  });
});

describe('natures, gender, PP', () => {
  test('nature is personality mod 25', () => {
    const mon = t.pokemon.createMon(species('EEVEE'), 5, { ...opts, personality: 25 * 7 + 13 });
    expect(t.pokemon.nature(mon)).toBe(13);
  });

  test('CreateMonWithNature rerolls until the nature matches', () => {
    for (let nature = 0; nature < 25; nature++) {
      const mon = t.pokemon.createMonWithNature(species('ABRA'), 10, 32, nature, opts);
      expect(t.pokemon.nature(mon)).toBe(nature);
    }
  });

  test('gender compares the personality low byte with the species ratio', () => {
    const nidoranF = species('NIDORAN_F');
    const nidoranM = species('NIDORAN_M');
    const magnemite = species('MAGNEMITE');
    expect(t.pokemon.genderFromPersonality(nidoranF, 0xff)).toBe(t.d('MON_FEMALE'));
    expect(t.pokemon.genderFromPersonality(nidoranM, 0x00)).toBe(t.d('MON_MALE'));
    expect(t.pokemon.genderFromPersonality(magnemite, 0x42)).toBe(t.d('MON_GENDERLESS'));
    // Charmander is 1/8 female (ratio 31): low byte 30 is female, 31 is male
    const charmander = species('CHARMANDER');
    const ratio = t.pokemon.species[charmander].genderRatio;
    expect(t.pokemon.genderFromPersonality(charmander, ratio - 1)).toBe(t.d('MON_FEMALE'));
    expect(t.pokemon.genderFromPersonality(charmander, ratio)).toBe(t.d('MON_MALE'));
  });

  test('PP Ups add 20% of base PP each', () => {
    const tackle = t.d('MOVE_TACKLE'); // 35 PP
    expect(t.pokemon.ppWithBonus(tackle, 0, 0)).toBe(35);
    expect(t.pokemon.ppWithBonus(tackle, 0b11 << 2, 1)).toBe(35 + Math.floor((35 * 60) / 100));
    expect(t.pokemon.ppWithBonus(tackle, 0b11 << 2, 0)).toBe(35);
  });
});
