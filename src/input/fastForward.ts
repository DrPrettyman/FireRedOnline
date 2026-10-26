// Fast-forward (docs/DEVIATIONS.md "Deliberate QOL changes"): an emulator-style speed-up. While it's on, the scene
// hosts (OverworldScene, GbaHostScene) run FAST_FORWARD_SPEED logic ticks per 60 Hz frame instead of one, so
// everything (walking, text, battles, music) runs that much faster; nothing times differently in GBA frames.
//
// - Keys: Q held fast-forwards while it's down, F toggles it on and off (both outside the GBA's buttons, so
//   they never reach the game's logic). The touch pad's ⏩ button toggles it too (input/touchPad.ts).
// - Not saved: every load starts at normal speed.
// - The sound output plays one of every FAST_FORWARD_SPEED frames (audio/output.ts pushFrame), so the music keeps
//   its pitch and the worklet's buffer doesn't overflow; the m4a engine itself still runs every tick.

/** Logic ticks per 60 Hz frame while fast-forwarding. */
export const FAST_FORWARD_SPEED = 3;
export const FAST_FORWARD_HOLD_KEY = 'KeyQ';
export const FAST_FORWARD_TOGGLE_KEY = 'KeyF';

let held = false;
let toggled = false;
const listeners: ((on: boolean) => void)[] = [];

export function fastForwarding(): boolean {
  return held || toggled;
}

/** The fast-forward's factor on the logic ticks per 60 Hz frame (the scenes also multiply by the dev `?speed=`). */
export function fastForwardSpeed(): number {
  return fastForwarding() ? FAST_FORWARD_SPEED : 1;
}

/** Called with the new state whenever fast-forward turns on or off. */
export function onFastForwardChange(listener: (on: boolean) => void): void {
  listeners.push(listener);
}

function update(change: () => void): void {
  const was = fastForwarding();
  change();
  if (fastForwarding() !== was) for (const l of listeners) l(fastForwarding());
}

export function toggleFastForward(): void {
  update(() => (toggled = !toggled));
}

function setHeld(on: boolean): void {
  update(() => (held = on));
}

function isTextField(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement;
}

/**
 * The fast-forward keys, on window in the capture phase like the mute key (input/Input.ts listenForOutputKeys).
 * Losing the window's focus releases a held Q, since its keyup would go elsewhere. Also shows the ⏩ badge in the
 * game's top right corner (inside `#game`, below the keyboard controls bar) while fast-forward is on.
 */
export function listenForFastForwardKeys(): void {
  window.addEventListener(
    'keydown',
    (e) => {
      if (e.ctrlKey || e.metaKey || e.altKey || isTextField(e.target)) return;
      if (e.code === FAST_FORWARD_HOLD_KEY) setHeld(true);
      else if (e.code === FAST_FORWARD_TOGGLE_KEY && !e.repeat) toggleFastForward();
    },
    true,
  );
  window.addEventListener('keyup', (e) => e.code === FAST_FORWARD_HOLD_KEY && setHeld(false), true);
  window.addEventListener('blur', () => setHeld(false));

  const badge = document.createElement('div');
  badge.id = 'fast-forward-badge';
  badge.textContent = `⏩ ×${FAST_FORWARD_SPEED}`;
  badge.style.cssText =
    'position:absolute;top:8px;right:8px;z-index:20;padding:2px 8px;border-radius:6px;background:rgba(0,0,0,.6);' +
    'color:#fff;font:600 14px system-ui,sans-serif;pointer-events:none;display:none';
  (document.getElementById('game') ?? document.body).appendChild(badge);
  onFastForwardChange((on) => (badge.style.display = on ? 'block' : 'none'));
}
