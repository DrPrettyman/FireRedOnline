// The touch pad's button state (input/touchPad.ts draws the pad and calls press / release). Input.sample merges
// it into the keyboard's once per logic tick. A tap that starts and ends between two ticks still counts as held
// for the next tick, so it isn't lost: a touch can be shorter than a tick, a key press hardly ever is.

import type { Button } from './Input';

const down = new Set<Button>();
/** Pressed since the last sample, whether or not still down. */
const tapped = new Set<Button>();

export function pressTouchButton(b: Button): void {
  down.add(b);
  tapped.add(b);
}

export function releaseTouchButton(b: Button): void {
  down.delete(b);
}

export function releaseAllTouchButtons(): void {
  down.clear();
  tapped.clear();
}

/** The buttons held this tick (Input.sample). */
export function sampleTouchButtons(): Button[] {
  const held = new Set([...down, ...tapped]);
  tapped.clear();
  return [...held];
}
