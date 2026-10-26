// The touch pad's button state (src/input/touchButtons.ts): held while down, and a tap that ends before the next
// tick's sample still shows as held for that one tick.

import { afterEach, expect, test } from 'vitest';
import { pressTouchButton, releaseAllTouchButtons, releaseTouchButton, sampleTouchButtons } from '../../src/input/touchButtons';

afterEach(() => releaseAllTouchButtons());

test('a held button stays held until released', () => {
  pressTouchButton('A');
  expect(sampleTouchButtons()).toEqual(['A']);
  expect(sampleTouchButtons()).toEqual(['A']);
  releaseTouchButton('A');
  expect(sampleTouchButtons()).toEqual([]);
});

test('a tap between two samples is held for exactly one', () => {
  pressTouchButton('START');
  releaseTouchButton('START');
  expect(sampleTouchButtons()).toEqual(['START']);
  expect(sampleTouchButtons()).toEqual([]);
});

test('the D-pad sliding from one direction to another', () => {
  pressTouchButton('LEFT');
  expect(sampleTouchButtons()).toEqual(['LEFT']);
  releaseTouchButton('LEFT');
  pressTouchButton('UP');
  expect(sampleTouchButtons()).toEqual(['UP']);
});
