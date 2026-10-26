// The keyboard controls bar above the game (FireRed Online; docs/DEVIATIONS.md "Deliberate QOL changes"): one line
// of keys built from the bindings themselves (KEY_BINDINGS, the fast-forward and mute keys), so it can't drift from
// them. index.html lays the page out as this bar over `#game`; Phaser's FIT scaling sizes the game to what's left.
// Hidden while the touch pad shows (`body.touch`, input/touchPad.ts), which is how phones and tablets get it.

import { FAST_FORWARD_HOLD_KEY, FAST_FORWARD_TOGGLE_KEY } from './fastForward';
import { KEY_BINDINGS, MUTE_KEY_CODE, type Button } from './Input';

const CSS = `
#keyboard-help {
  flex: none; display: flex; flex-wrap: wrap; justify-content: center; gap: 4px 16px; padding: 6px 12px;
  background: #141418; color: #b8b8c0; font: 12px/18px system-ui, sans-serif; user-select: none;
}
#keyboard-help span { white-space: nowrap; }
#keyboard-help kbd {
  display: inline-block; min-width: 10px; margin-right: 3px; padding: 0 5px; border: 1px solid #3a3a44;
  border-bottom-width: 2px; border-radius: 4px; background: #202028; color: #e8e8ee; font: 600 11px/16px system-ui, sans-serif;
  text-align: center;
}
body.touch #keyboard-help { display: none; }
`;

/** Phaser key codes (KEY_BINDINGS) that aren't their own character. */
const KEY_NAMES: Record<number, string> = { 8: 'Backspace', 13: 'Enter', 32: 'Space', 37: '←', 38: '↑', 39: '→', 40: '↓' };

function keyName(code: number): string {
  return KEY_NAMES[code] ?? String.fromCharCode(code);
}

/** A KeyboardEvent.code ('KeyQ') as it's printed on the key. */
function codeName(code: string): string {
  return code.replace(/^Key/, '');
}

function keys(...buttons: Button[]): string[] {
  return buttons.flatMap((b) => KEY_BINDINGS[b].map(keyName));
}

/** What each group of keys does, in the order shown. */
const ITEMS: [string[], string][] = [
  [keys('UP', 'DOWN', 'LEFT', 'RIGHT'), 'Move'],
  [keys('A'), 'A'],
  [keys('B'), 'B'],
  [keys('START'), 'Start'],
  [keys('SELECT'), 'Select'],
  [keys('L', 'R'), 'L / R'],
  [[codeName(FAST_FORWARD_HOLD_KEY)], 'Hold to fast-forward'],
  [[codeName(FAST_FORWARD_TOGGLE_KEY)], 'Fast-forward on / off'],
  [[codeName(MUTE_KEY_CODE)], 'Mute'],
];

/** Build the bar at the top of the page. Call before the Phaser game is created (main.ts), so it sizes to the rest. */
export function installKeyboardHelp(): void {
  const style = document.createElement('style');
  style.textContent = CSS;
  document.head.appendChild(style);

  const bar = document.createElement('div');
  bar.id = 'keyboard-help';
  bar.setAttribute('aria-label', 'Keyboard controls');
  for (const [names, action] of ITEMS) {
    const item = document.createElement('span');
    for (const name of names) {
      const kbd = document.createElement('kbd');
      kbd.textContent = name;
      item.appendChild(kbd);
    }
    item.append(` ${action}`);
    bar.appendChild(item);
  }
  document.body.prepend(bar);
}
