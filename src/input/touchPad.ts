// The on-screen gamepad for phones and tablets (docs/DEVIATIONS.md "Deliberate QOL changes"): a D-pad, A, B, L, R,
// START and SELECT, plus fast-forward (input/fastForward.ts) and mute (audio/output.ts) buttons. It feeds
// input/touchButtons.ts, which Input.sample merges with the keyboard, so the game sees GBA buttons either way.
//
// - Shown on a touch-first device (`(pointer: coarse)`), or from the first touch anywhere; `?touch=1` / `?touch=0`
//   force it on or off (e.g. to try it on a desktop with the devtools' device mode).
// - Portrait: the game across the top, the pad below it. Landscape: the game full height, the pad over the sides.
// - The D-pad is 4-way: the direction is the dominant axis from its centre, and sliding a finger changes it.
//   Every control captures its pointer, so a finger that slides off still releases the right button.

import { toggleMute, audioMuted } from '../audio/output';
import type { Button } from './Input';
import { fastForwarding, onFastForwardChange, toggleFastForward } from './fastForward';
import { pressTouchButton, releaseAllTouchButtons, releaseTouchButton } from './touchButtons';

/** A touch this close to the D-pad's centre (share of its width) picks no direction. */
const DPAD_DEAD_ZONE = 0.12;

const CSS = `
body.touch { touch-action: none; user-select: none; -webkit-user-select: none; -webkit-touch-callout: none; }
#touch-pad { display: none; }
body.touch #touch-pad {
  display: block; position: fixed; inset: 0; pointer-events: none; z-index: 10;
  --gap: 12px; --edge: calc(16px + env(safe-area-inset-left)); --edge-r: calc(16px + env(safe-area-inset-right));
  --pad: min(42vw, 34vh, 200px); --btn: min(18vw, 12vh, 80px); --base: calc(64px + env(safe-area-inset-bottom));
  --top: calc(100vw * 2 / 3 + var(--gap));
}
body.touch #touch-pad * { pointer-events: auto; touch-action: none; box-sizing: border-box; }
#touch-pad button {
  position: absolute; margin: 0; padding: 0; border: 2px solid rgba(255,255,255,.35); border-radius: 999px;
  background: rgba(255,255,255,.12); color: rgba(255,255,255,.85); font: 600 15px system-ui, sans-serif;
  -webkit-tap-highlight-color: transparent;
}
#touch-pad button.held, #touch-pad button.on { background: rgba(255,255,255,.4); }
#touch-pad .tp-a, #touch-pad .tp-b { width: var(--btn); height: var(--btn); font-size: 22px; }
#touch-pad .tp-a { right: var(--edge-r); bottom: calc(var(--base) + var(--pad) * .45); }
#touch-pad .tp-b { right: calc(var(--edge-r) + var(--btn) * 1.1); bottom: calc(var(--base) + var(--pad) * .1); }
#touch-pad .tp-l, #touch-pad .tp-r { top: var(--top); width: 72px; height: 34px; border-radius: 10px; }
#touch-pad .tp-l { left: var(--edge); }
#touch-pad .tp-r { right: var(--edge-r); }
#touch-pad .tp-select, #touch-pad .tp-start { bottom: calc(16px + env(safe-area-inset-bottom)); width: 84px; height: 30px; font-size: 12px; }
#touch-pad .tp-select { left: calc(50% - 92px); }
#touch-pad .tp-start { left: calc(50% + 8px); }
#touch-pad .tp-ff, #touch-pad .tp-mute { top: var(--top); width: 48px; height: 34px; border-radius: 10px; font-size: 16px; }
#touch-pad .tp-ff { left: calc(50% - 54px); }
#touch-pad .tp-mute { left: calc(50% + 6px); }
#touch-pad .tp-dpad { position: absolute; left: var(--edge); bottom: var(--base); width: var(--pad); height: var(--pad); }
#touch-pad .tp-dpad::before, #touch-pad .tp-dpad::after {
  content: ''; position: absolute; background: rgba(255,255,255,.12); border: 2px solid rgba(255,255,255,.35); border-radius: 10px;
}
#touch-pad .tp-dpad::before { left: 33%; right: 33%; top: 0; bottom: 0; }
#touch-pad .tp-dpad::after { top: 33%; bottom: 33%; left: 0; right: 0; }
#touch-pad .tp-dpad span { position: absolute; width: 34%; height: 34%; z-index: 1; border-radius: 8px; pointer-events: none; }
#touch-pad .tp-dpad span.held { background: rgba(255,255,255,.35); }
#touch-pad .tp-up { left: 33%; top: 0; } #touch-pad .tp-down { left: 33%; bottom: 0; }
#touch-pad .tp-left { top: 33%; left: 0; } #touch-pad .tp-right { top: 33%; right: 0; }
@media (orientation: portrait) {
  body.touch #game { position: fixed; top: env(safe-area-inset-top); left: 0; width: 100vw; height: calc(100vw * 2 / 3); }
}
@media (orientation: landscape) {
  body.touch #touch-pad { --pad: min(40vh, 26vw, 200px); --btn: min(18vh, 11vw, 80px); --base: 16px; --top: 12px; }
  #touch-pad .tp-select, #touch-pad .tp-start { top: 56px; bottom: auto; width: 72px; }
  #touch-pad .tp-select { left: var(--edge); }
  #touch-pad .tp-start { left: auto; right: var(--edge-r); }
  #touch-pad .tp-ff { top: 100px; left: var(--edge); }
  #touch-pad .tp-mute { top: 100px; left: auto; right: var(--edge-r); }
}
`;

const BUTTONS: { button: Button; cls: string; label: string }[] = [
  { button: 'A', cls: 'tp-a', label: 'A' },
  { button: 'B', cls: 'tp-b', label: 'B' },
  { button: 'L', cls: 'tp-l', label: 'L' },
  { button: 'R', cls: 'tp-r', label: 'R' },
  { button: 'SELECT', cls: 'tp-select', label: 'SELECT' },
  { button: 'START', cls: 'tp-start', label: 'START' },
];

const DIRECTIONS: { button: Button; cls: string }[] = [
  { button: 'UP', cls: 'tp-up' },
  { button: 'DOWN', cls: 'tp-down' },
  { button: 'LEFT', cls: 'tp-left' },
  { button: 'RIGHT', cls: 'tp-right' },
];

function buzz(): void {
  navigator.vibrate?.(8);
}

/** Capture the pointer so its up / cancel comes back here even off the element (synthetic events can't be captured). */
function capture(el: HTMLElement, e: PointerEvent): void {
  try {
    el.setPointerCapture(e.pointerId);
  } catch {
    // Not an active pointer (a synthetic event): its up still bubbles from where it ends.
  }
}

function makeButton(pad: HTMLElement, cls: string, label: string, onDown: () => void, onUp?: () => void): HTMLButtonElement {
  const el = document.createElement('button');
  el.type = 'button';
  el.className = cls;
  el.textContent = label;
  el.tabIndex = -1;
  const pointers = new Set<number>();
  el.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    capture(el, e);
    pointers.add(e.pointerId);
    buzz();
    onDown();
  });
  const up = (e: PointerEvent): void => {
    if (!pointers.delete(e.pointerId)) return;
    onUp?.();
  };
  el.addEventListener('pointerup', up);
  el.addEventListener('pointercancel', up);
  el.addEventListener('lostpointercapture', up);
  pad.appendChild(el);
  return el;
}

function makeDpad(pad: HTMLElement): HTMLElement {
  const el = document.createElement('div');
  el.className = 'tp-dpad';
  const arms = new Map<Button, HTMLElement>();
  for (const d of DIRECTIONS) {
    const arm = document.createElement('span');
    arm.className = d.cls;
    el.appendChild(arm);
    arms.set(d.button, arm);
  }
  let pointer: number | undefined;
  let current: Button | undefined;
  const set = (dir: Button | undefined): void => {
    if (dir === current) return;
    if (current) {
      releaseTouchButton(current);
      arms.get(current)!.classList.remove('held');
    }
    current = dir;
    if (dir) {
      pressTouchButton(dir);
      arms.get(dir)!.classList.add('held');
      buzz();
    }
  };
  const direction = (e: PointerEvent): Button | undefined => {
    const r = el.getBoundingClientRect();
    const dx = e.clientX - (r.left + r.width / 2);
    const dy = e.clientY - (r.top + r.height / 2);
    if (Math.hypot(dx, dy) < r.width * DPAD_DEAD_ZONE) return undefined;
    return Math.abs(dx) > Math.abs(dy) ? (dx < 0 ? 'LEFT' : 'RIGHT') : dy < 0 ? 'UP' : 'DOWN';
  };
  el.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    if (pointer !== undefined) return;
    pointer = e.pointerId;
    capture(el, e);
    set(direction(e));
  });
  el.addEventListener('pointermove', (e) => {
    if (e.pointerId === pointer) set(direction(e));
  });
  const up = (e: PointerEvent): void => {
    if (e.pointerId !== pointer) return;
    pointer = undefined;
    set(undefined);
  };
  el.addEventListener('pointerup', up);
  el.addEventListener('pointercancel', up);
  el.addEventListener('lostpointercapture', up);
  pad.appendChild(el);
  return el;
}

function wantTouchPad(): boolean | undefined {
  const forced = new URLSearchParams(location.search).get('touch');
  if (forced === '1') return true;
  if (forced === '0') return false;
  return window.matchMedia?.('(pointer: coarse)').matches ? true : undefined;
}

function show(): void {
  if (document.body.classList.contains('touch')) return;
  document.body.classList.add('touch');
  // The game's parent changed size: let Phaser's FIT scaling see it now rather than on its next poll.
  window.dispatchEvent(new Event('resize'));
}

/** Build the pad (hidden) and decide when to show it. Call before the Phaser game is created (main.ts). */
export function installTouchPad(): void {
  const want = wantTouchPad();
  if (want === false) return;

  const style = document.createElement('style');
  style.textContent = CSS;
  document.head.appendChild(style);

  const pad = document.createElement('div');
  pad.id = 'touch-pad';
  pad.addEventListener('contextmenu', (e) => e.preventDefault());
  makeDpad(pad);
  for (const b of BUTTONS) {
    const el = makeButton(
      pad,
      b.cls,
      b.label,
      () => {
        pressTouchButton(b.button);
        el.classList.add('held');
      },
      () => {
        releaseTouchButton(b.button);
        el.classList.remove('held');
      },
    );
  }
  const ff = makeButton(pad, 'tp-ff', '⏩', toggleFastForward);
  ff.setAttribute('aria-label', 'Fast-forward');
  onFastForwardChange((on) => ff.classList.toggle('on', on));
  ff.classList.toggle('on', fastForwarding());
  const mute = makeButton(pad, 'tp-mute', '', () => {
    toggleMute();
    mute.textContent = audioMuted() ? '🔇' : '🔊';
  });
  mute.setAttribute('aria-label', 'Mute');
  mute.textContent = audioMuted() ? '🔇' : '🔊';
  document.body.appendChild(pad);

  // A hidden tab or a lost focus drops every touch (their pointerups may never come).
  window.addEventListener('blur', releaseAllTouchButtons);
  document.addEventListener('visibilitychange', () => document.hidden && releaseAllTouchButtons());

  if (want) show();
  else window.addEventListener('touchstart', show, { once: true, capture: true, passive: true });
}
