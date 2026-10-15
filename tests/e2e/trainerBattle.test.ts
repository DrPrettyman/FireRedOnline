// Trainer sight and trainer battles, on Bug Catcher Rick in Viridian Forest: he stands at (47, 45) facing
// left with a sight range of 5, so stepping right from (41, 45) to (42, 45) walks into his view.

import { expect, test } from 'vitest';
import { useGame, type Game } from './harness';

const session = useGame();

const RICK = { start: 'after-rival', map: 'ViridianForest', x: 41, y: 45 } as const;

/** Step into Rick's view and get through his approach and challenge, up to the battle starting. */
async function getSpotted(game: Game) {
  const mark = await game.mark();
  await game.walk('right');
  await game.waitForEvent('trainerApproach', { since: mark, what: 'Rick to spot the player' });
  const battle = await game.mashUntil((t) => t.events().find((e) => e.type === 'battleStart'), { what: 'Rick’s battle to start' });
  expect(battle.seq).toBeGreaterThan(mark);
  return battle;
}

const trainerName = (game: Game, id: number) => game.eval((t, n) => t.nameOf('TRAINER_', n), id);
const outcome = (game: Game, o: number) => game.eval((t, n) => t.nameOf('B_OUTCOME_', n), o);

test('walking into a trainer’s view starts his battle', async () => {
  const game = await session.start(RICK);
  const battle = await getSpotted(game);
  expect(await trainerName(game, battle.trainer as number)).toBe('TRAINER_BUG_CATCHER_RICK');
  // The battlers are filled in once the battle scene has loaded and sent them out.
  const mons = await game.waitFor((t) => t.battle()?.mons.length === 2 && t.battle()!.mons.every((m) => m.species !== 'NONE') && t.battle()!.mons.map((m) => m.species), { what: 'both battlers' });
  expect(mons).toEqual(['BULBASAUR', 'WEEDLE']);
});

test('winning a trainer battle pays out and he won’t battle again', async () => {
  const game = await session.start({ ...RICK, party: [{ species: 'MEWTWO', level: 100, moves: ['PSYCHIC'] }] });
  const money = await game.eval((t) => t.money());
  await getSpotted(game);

  const end = await game.mashUntil((t) => t.events().find((e) => e.type === 'battleEnd'), { what: 'the battle to end' });
  expect(await outcome(game, end.outcome as number)).toBe('B_OUTCOME_WON');
  await game.mashUntil((t) => t.idle(), { what: 'Rick’s post-battle line' });

  expect(await game.eval((t) => t.trainerDefeated('BUG_CATCHER_RICK'))).toBe(true);
  expect(await game.eval((t) => t.money())).toBeGreaterThan(money);
  const mewtwo = await game.eval((t) => t.party()[0]);
  expect(mewtwo.hp).toBeGreaterThan(0);

  // Walk away and back into his view: no second challenge.
  await game.eval((t) => t.walkTo(41, 46));
  const mark = await game.mark();
  await game.eval((t) => t.walkTo(42, 45));
  await game.eval((t) => t.waitFrames(60));
  expect((await game.events(mark)).filter((e) => e.type === 'trainerApproach' || e.type === 'battleStart')).toEqual([]);
  expect(await game.eval((t) => t.idle())).toBe(true);
});

test('losing a trainer battle whites out to the last heal point', async () => {
  const game = await session.start({ ...RICK, party: [{ species: 'MAGIKARP', level: 2, moves: ['SPLASH'] }] });
  const money = await game.eval((t) => t.money());
  await getSpotted(game);

  const end = await game.mashUntil((t) => t.events().find((e) => e.type === 'battleEnd'), { what: 'the battle to end' });
  expect(await outcome(game, end.outcome as number)).toBe('B_OUTCOME_LOST');
  await game.waitForEvent('whiteOut');
  // "PLAYER scurried home…", then Mom heals the party (the preset's last heal point is home).
  await game.mashUntil((t) => t.idle(), { what: 'Mom to heal the party' });

  expect(await game.eval((t) => t.field())).toMatchObject({ map: 'PalletTown_PlayersHouse_1F', x: 8, y: 5 });
  const [magikarp] = await game.eval((t) => t.party());
  expect(magikarp.hp).toBe(magikarp.maxHP);
  expect(await game.eval((t) => t.money())).toBeLessThan(money);
  // Rick is still undefeated.
  expect(await game.eval((t) => t.trainerDefeated('BUG_CATCHER_RICK'))).toBe(false);
});
