// Poké Mart: talk to the Pewter City clerk, BUY two Poké Balls, leave.

import { expect, test } from 'vitest';
import { useGame, type Game } from './harness';

const session = useGame();

/** Press, then let the buy menu's text finish printing (it prompts on its own once it has). */
async function step(game: Game, button: 'A' | 'B' | 'UP' | 'DOWN', frames = 90) {
  await game.press(button);
  await game.eval((t, n) => t.waitFrames(n), frames);
}

test('buying Poké Balls takes the money and fills the bag', async () => {
  const game = await session.start({ start: 'after-rival', map: 'PewterCity_Mart', x: 4, y: 3 });
  const money = await game.eval((t) => t.money());
  expect(await game.eval((t) => t.itemCount('POKE_BALL'))).toBe(0);

  // The clerk is across the counter to the left: "May I help you?" → BUY (the default choice).
  await game.eval((t) => t.face('left'));
  await game.press('A');
  await game.mashUntil((t) => t.gbaScreen() === 'CB2_BuyMenu', { what: 'the buy menu' });
  await game.eval((t) => t.waitFrames(30));

  await step(game, 'A'); // POKé BALL (top of the list): "POKé BALL? Certainly. How many would you like?" ×01
  await step(game, 'UP', 10); // ×02
  await step(game, 'A'); // "POKé BALL, and you want 2? That will be ¥400. Okay?"
  // YES (the default) once the prompt takes input: "Here you are! Thank you!"
  await game.mashUntil((t) => t.itemCount('POKE_BALL') > 0, { what: 'the purchase', maxFrames: 600 });

  expect(await game.eval((t) => t.itemCount('POKE_BALL'))).toBe(2);
  // shop.c takes the money once "Here you are!" has printed (BuyMenuSubtractMoney is its callback).
  await game.eval((t, before) => t.until(() => t.money() < before, 300), money);
  expect(await game.eval((t) => t.money())).toBe(money - 400);

  // B out of the list, out of BUY/SELL/SEE YA, through "Please come again!".
  await game.mashUntil((t) => t.idle(), { button: 'B', what: 'the shop to close' });
  expect(await game.eval((t) => t.field())).toMatchObject({ map: 'PewterCity_Mart', x: 4, y: 3 });
});
