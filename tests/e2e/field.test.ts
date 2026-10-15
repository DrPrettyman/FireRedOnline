// Field basics: walking, warps, talking.

import { expect, test } from 'vitest';
import { useGame } from './harness';

const session = useGame();

test('walking moves the player tile by tile', async () => {
  const game = await session.start({ start: 'after-rival', map: 'PalletTown', x: 12, y: 14 });
  await game.waitIdle();
  expect(await game.walk('left', 2)).toMatchObject({ arrived: true, x: 10, y: 14 });
  expect(await game.walk('up', 3)).toMatchObject({ arrived: true, x: 10, y: 11 });
  expect(await game.eval((t) => t.field()?.facing)).toBe('up');
});

test('a held direction on stairs warps once', async () => {
  // Regression: takeWarp only locked the controls once the destination map had loaded, so a held push
  // direction set up the same warp again on every frame until then, rerunning the map entry each time.
  const game = await session.start();
  await game.eval((t) => t.walkTo(10, 2));
  const mark = await game.mark();
  expect(await game.eval((t) => t.enterWarp())).toBe('PalletTown_PlayersHouse_1F');
  const maps = (await game.events(mark)).filter((e) => e.type === 'map');
  expect(maps.map((e) => e.map)).toEqual(['PalletTown_PlayersHouse_1F']);
});

test('walking through a door enters the building', async () => {
  const game = await session.start({ start: 'after-rival', map: 'PalletTown', x: 16, y: 15 });
  // Oak's lab door is at (16, 13).
  const r = await game.eval((t) => t.walkTo(16, 13));
  expect(r.interrupted).toBe(true); // the warp takes the controls
  await game.waitIdle();
  expect(await game.eval((t) => t.field()?.map)).toBe('PalletTown_ProfessorOaksLab');
});

test('talking to an NPC shows their text', async () => {
  // Mom, at (8, 4) in the 1F kitchen.
  const game = await session.start({ start: 'after-rival', map: 'PalletTown_PlayersHouse_1F', x: 8, y: 5 });
  await game.eval((t) => t.face('up'));
  await game.press('A');
  const text = await game.waitFor((t) => t.message(), { what: 'a message' });
  expect(text).toMatch(/MOM/);
  await game.mashUntil((t) => t.idle(), { what: 'the conversation to end' });
});

test('choosing EXIT on the start menu does not also interact', async () => {
  // Regression: the start menu closed mid-tick and the field then took the same A press, so EXIT in
  // front of the bedroom NES also played its message. On the GBA the controls are still locked for the
  // rest of that frame (CB1_Overworld checks them before the menu's task unlocks them).
  const game = await session.start();
  await game.waitIdle();
  // The new game starts facing the NES; A on its own interacts with it.
  await game.press('A');
  expect(await game.waitFor((t) => t.message(), { what: 'the NES message' })).toMatch(/NES/);
  await game.mashUntil((t) => t.idle(), { what: 'the NES message to close' });

  await game.press('START');
  await game.waitFor((t) => t.field()?.overlay, { what: 'the start menu' });
  await game.press('UP'); // the cursor wraps from the top to EXIT
  await game.press('A');
  await game.waitIdle();
  await game.eval((t) => t.waitFrames(10));
  expect(await game.eval((t) => t.field()?.script)).toBeFalsy();
  expect(await game.eval((t) => t.message())).toBeFalsy();
});
