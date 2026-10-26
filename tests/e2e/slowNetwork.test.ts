// The hosted game (FireRed Online) fetches maps, tilesets and sprites over a real network, where every request
// takes a while. With DevTools' network latency on every request: crossing into a connected map doesn't stop the
// player while the maps beyond it load (OverworldScene.prefetchBeyondConnections fetched them already), and a new
// game shows nothing of the field until its map and player are in place (the camera is hidden until the first
// enterMap: no player sprite at (0, 0) in the boy's graphics while the boot loads).

import { expect, test } from 'vitest';
import { useGame } from './harness';

const session = useGame();

const LATENCY = 150;

test('crossing from Route 1 into Viridian City does not wait for the network', async () => {
  const game = await session.start({ start: 'after-rival', map: 'Route1', x: 11, y: 3, speed: 1, latency: LATENCY });
  await game.waitIdle();
  // The prefetch's head start. Walking up to a border from anywhere takes longer than this.
  await new Promise((r) => setTimeout(r, 4000));
  // Hold UP across the border at (11, 0) → Viridian City (23, 39); count the ticks the field is busy after it.
  const busyTicks = await game.eval(async (t) => {
    t.hold('UP');
    await t.until(() => t.field()?.map === 'ViridianCity');
    let busy = 0;
    await t.until(() => {
      if (!t.field()!.busy) return true;
      busy++;
      return false;
    });
    t.release('UP');
    return busy;
  });
  // Without the prefetch it waits one round trip (Route 2 and 22's headers and atlases, fetched in parallel, and
  // Viridian's old man lying down, a VAR_OBJ_GFX_ID_0 sprite its map script picks): 9 ticks at 150 ms, 23 at
  // 400 ms. With it: 0.
  expect(busyTicks).toBeLessThan(3);
  expect(await game.eval((t) => t.field()!.map)).toBe('ViridianCity');
});

test("a new game shows the field only once the player's room and the player are in place", async () => {
  const game = await session.start({ latency: LATENCY });
  const shown = await game.eval((t) => t.events().filter((e) => e.type === 'fieldShown'));
  expect(shown).toHaveLength(1);
  expect(shown[0]).toMatchObject({ map: 'PalletTown_PlayersHouse_2F', avatar: 'OBJ_EVENT_GFX_RED_NORMAL' });
  // It came after the map's load, and before the field was ready.
  const order = await game.eval((t) => t.events().filter((e) => ['map', 'fieldShown', 'ready'].includes(e.type)).map((e) => e.type));
  expect(order.indexOf('fieldShown')).toBeGreaterThan(order.indexOf('map'));
  expect(order.indexOf('fieldShown')).toBeLessThan(order.indexOf('ready'));
});
