// FireRed Online's QOL features (docs/DEVIATIONS.md "Deliberate QOL changes"): fast-forward (input/fastForward.ts:
// F toggles, Tab held) runs FAST_FORWARD_SPEED logic ticks per frame, and the touch pad (input/touchPad.ts) drives
// the game's buttons: a held D-pad direction walks, a tap shorter than a tick still counts.

import { expect, test } from 'vitest';
import { useGame, type Game } from './harness';

const session = useGame();

/** Logic ticks run in `ms` of real time. */
async function ticksIn(game: Game, ms: number): Promise<number> {
  const before = await game.eval((t) => t.frame());
  await new Promise((r) => setTimeout(r, ms));
  return (await game.eval((t) => t.frame())) - before;
}

const badgeShown = (game: Game) => game.eval(() => document.getElementById('fast-forward-badge')?.style.display === 'block');

test('fast-forward: F toggles it, Tab fast-forwards while held', async () => {
  const game = await session.start({ start: 'after-rival', map: 'PalletTown', x: 12, y: 14, speed: 1 });
  await game.waitIdle();
  const normal = await ticksIn(game, 1000);
  expect(await badgeShown(game)).toBe(false);

  await game.realKey('KeyF');
  expect(await badgeShown(game)).toBe(true);
  const fast = await ticksIn(game, 1000);
  expect(fast / normal).toBeGreaterThan(2.2);

  await game.realKey('KeyF');
  expect(await badgeShown(game)).toBe(false);
  expect((await ticksIn(game, 1000)) / normal).toBeLessThan(1.4);

  // Tab: on while down, off on keyup (the page's own listener; a dispatched event is enough for it).
  await game.eval(() => window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Tab', key: 'Tab' })));
  expect(await badgeShown(game)).toBe(true);
  await game.eval(() => window.dispatchEvent(new KeyboardEvent('keyup', { code: 'Tab', key: 'Tab' })));
  expect(await badgeShown(game)).toBe(false);
});

/** A pointer event on the touch pad element `selector`, at its share (fx, fy) of its box. */
function touch(game: Game, selector: string, fx: number, fy: number, type: 'pointerdown' | 'pointerup') {
  return game.eval(
    (_t, sel, x, y, ty) => {
      const el = document.querySelector(sel) as HTMLElement;
      const r = el.getBoundingClientRect();
      el.dispatchEvent(new PointerEvent(ty, { pointerId: 7, bubbles: true, clientX: r.left + r.width * x, clientY: r.top + r.height * y }));
    },
    selector,
    fx,
    fy,
    type,
  );
}

test('touch pad: shown with ?touch=1, the D-pad walks, a quick START tap opens the menu', async () => {
  const game = await session.start({ start: 'after-rival', map: 'PalletTown', x: 12, y: 14, query: { touch: '1' } });
  await game.waitIdle();
  expect(await game.eval(() => document.body.classList.contains('touch') && !!document.querySelector('#touch-pad .tp-dpad'))).toBe(true);

  // Hold the D-pad's left arm until the player has walked two tiles.
  await touch(game, '.tp-dpad', 0.1, 0.5, 'pointerdown');
  await game.waitFor((t) => (t.field()?.x ?? 12) <= 10, { what: 'the player to walk left' });
  await touch(game, '.tp-dpad', 0.1, 0.5, 'pointerup');
  await game.waitIdle();
  expect(await game.eval((t) => t.field()?.facing)).toBe('left');

  // Down and up within one JS task, so no tick sees START down: the tap is latched for the next tick.
  await game.eval(() => {
    const el = document.querySelector('.tp-start') as HTMLElement;
    el.dispatchEvent(new PointerEvent('pointerdown', { pointerId: 8, bubbles: true }));
    el.dispatchEvent(new PointerEvent('pointerup', { pointerId: 8, bubbles: true }));
  });
  await game.waitFor((t) => t.startMenu(), { what: 'the start menu' });
});
