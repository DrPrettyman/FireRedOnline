// The opening of the game, played for real: bedroom → Pallet Town → Oak's trigger → the lab → choose a
// starter → the first rival battle → the rival leaves. Then the `?start=after-rival` preset is checked
// against the state this playthrough left behind.

import { expect, test } from 'vitest';
import type { TestApi } from '../../src/dev/testHooks';
import { useGame, type Game } from './harness';

const session = useGame();

/** Story state: set flags, persistent non-zero vars, position, money and party. */
function snapshot(t: TestApi) {
  const { flags, vars } = t.snapshot();
  const story = Object.entries(vars).filter(([name]) => !name.startsWith('VAR_TEMP_') && !name.endsWith('_STEP_COUNTER') && (t.state!.defines.get(name) ?? 0x8000) < 0x8000);
  return { flags, vars: Object.fromEntries(story), field: t.field(), money: t.money(), party: t.party() };
}

/** From the bedroom to Oak's lab, through the starter choice. */
async function playToStarterChoice(game: Game): Promise<void> {
  expect(await game.eval((t) => t.field())).toMatchObject({ map: 'PalletTown_PlayersHouse_2F', x: 6, y: 6 });

  await game.eval((t) => t.walkTo(10, 2));
  expect(await game.eval((t) => t.enterWarp())).toBe('PalletTown_PlayersHouse_1F');
  await game.eval((t) => t.walkTo(4, 8));
  expect(await game.eval((t) => t.enterWarp())).toBe('PalletTown');

  // Heading north out of town: Oak stops you and takes you to his lab.
  await game.eval((t) => t.walkTo(12, 2));
  const mark = await game.mark();
  await game.eval((t) => t.walk('up'));
  const trigger = await game.waitForEvent('script', { since: mark });
  expect(trigger.label).toBe('PalletTown_EventScript_OakTriggerLeft');

  await game.mashUntil((t) => t.idle(), { what: 'Oak’s speech in the lab to end' });
  expect(await game.eval((t) => t.field()?.map)).toBe('PalletTown_ProfessorOaksLab');
  expect(await game.eval((t) => t.var('VAR_MAP_SCENE_PALLET_TOWN_PROFESSOR_OAKS_LAB'))).toBe(2);
  expect(await game.eval((t) => t.party())).toEqual([]);
}

test('new game through the first rival battle', async () => {
  const game = await session.start();
  await playToStarterChoice(game);

  // Bulbasaur's ball is on the table at (8, 4).
  await game.eval((t) => t.walkTo(8, 5));
  await game.eval((t) => t.face('up'));
  await game.press('A');
  await game.mashUntil((t) => t.party().length === 1, { what: 'the starter to be received' });
  // Decline the nickname, then the rival picks his and the controls come back.
  await game.mashUntil((t) => t.idle(), { answers: [[/nickname/i, 'B']], what: 'the rival to take his starter' });

  const [starter] = await game.eval((t) => t.party());
  expect(starter).toMatchObject({ species: 'BULBASAUR', nickname: 'BULBASAUR', level: 5 });
  expect(await game.eval((t) => t.flag('FLAG_SYS_POKEMON_GET'))).toBe(true);
  expect(await game.eval((t) => t.var('VAR_MAP_SCENE_PALLET_TOWN_PROFESSOR_OAKS_LAB'))).toBe(3);

  // Trying to leave: the rival challenges you. Make sure the starter wins, so the run is repeatable.
  await game.eval((t) => {
    const mon = t.state!.party[0];
    mon.stats.attack = 200;
    mon.stats.speed = 200;
  });
  const mark = await game.mark();
  // Step onto the middle trigger (6, 8) from above, where the preset puts you afterwards.
  await game.eval((t) => t.walkTo(6, 7));
  await game.eval((t) => t.walk('down'));
  const battle = await game.mashUntil((t) => t.events().find((e) => e.type === 'battleStart'), { what: 'the rival battle' });
  expect(battle.seq).toBeGreaterThan(mark);
  expect(await game.eval((t, id) => t.nameOf('TRAINER_RIVAL_OAKS_LAB_', id), battle.trainer as number)).toBe('TRAINER_RIVAL_OAKS_LAB_CHARMANDER');

  // Oak's tutorial narration, FIGHT → TACKLE until it's over.
  const end = await game.mashUntil((t) => t.events().find((e) => e.type === 'battleEnd'), { what: 'the battle to end' });
  expect(await game.eval((t, o) => t.nameOf('B_OUTCOME_', o), end.outcome as number)).toBe('B_OUTCOME_WON');

  // The rival's parting words; he leaves and the field is ours again.
  await game.mashUntil((t) => t.idle(), { what: 'the rival to leave' });
  expect(await game.eval((t) => t.field())).toMatchObject({ map: 'PalletTown_ProfessorOaksLab' });
  expect(await game.eval((t) => t.var('VAR_MAP_SCENE_PALLET_TOWN_PROFESSOR_OAKS_LAB'))).toBe(4);
  const after = await game.eval((t) => t.party()[0]);
  expect(after.exp).toBeGreaterThan(starter.exp);

  // The after-rival preset should leave exactly this state behind, apart from scratch vars that depend on
  // the route taken: temps (cleared on the next map entry), specials (0x8000+) and step counters.
  const played = await game.eval(snapshot);
  const preset = await session.start({ start: 'after-rival', starter: 'bulbasaur' });
  const presetState = await preset.eval(snapshot);
  expect(presetState.flags).toEqual(played.flags);
  expect(presetState.vars).toEqual(played.vars);
  expect(presetState.money).toBe(played.money);
  expect(presetState.field).toMatchObject({ map: played.field!.map, x: played.field!.x, y: played.field!.y });
  expect(presetState.party.map((m) => [m.species, m.level, m.exp])).toEqual(played.party.map((m) => [m.species, m.level, m.exp]));
});
