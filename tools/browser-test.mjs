// Headless-Chrome driver for checking the game in a real browser (uses the DevTools protocol, no deps).
// Requires: Google Chrome at the path below, and `npm run dev` (or `npx vite --port 5179`) running.
//
// Usage: node tools/browser-test.mjs <url> <outPrefix> [steps...]
//   wait:<ms>              sleep
//   key:<Code>:<ms>        press and hold a key for ms (Code: ArrowUp, KeyZ, KeyX, Enter, Backspace, KeyA, KeyS, Backquote)
//   down:<Code> / up:<Code> hold / release a key across other steps
//   eval:<js>              evaluate JS in the page and print the JSON result (dev builds expose window.game)
//   mash:<js>              press A (Z, held 300ms) until <js> is truthy, up to 300 presses; prints how many it took
//   shot:<name>            save a screenshot to <outPrefix>-<name>.png
// Console warnings/errors from the page are printed as [console] lines.
//
// Example: walk into the Oak trigger holding Up and print the player's position:
//   node tools/browser-test.mjs "http://localhost:5179/?map=PalletTown&x=12&y=4" /tmp/t \
//     wait:3000 down:ArrowUp wait:1500 up:ArrowUp \
//     'eval:(()=>{const s=game.scene.getScene("Overworld");return [s.player.tileX,s.player.tileY]})()' shot:after
import { spawn } from 'node:child_process';
const [url, out, ...steps] = process.argv.slice(2);
const CH = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const proc = spawn(CH, ['--headless=new', '--enable-unsafe-swiftshader', '--remote-debugging-port=9333', '--window-size=720,480', `--user-data-dir=${out}-profile`, 'about:blank'], { stdio: 'ignore' });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let ws;
for (let i = 0; i < 50 && !ws; i++) {
  await sleep(200);
  try { const t = await (await fetch('http://127.0.0.1:9333/json')).json(); const p = t.find((x) => x.type === 'page'); if (p) ws = p.webSocketDebuggerUrl; } catch {}
}
const sock = new WebSocket(ws); await new Promise((r) => (sock.onopen = r));
let id = 0; const pending = new Map();
sock.onmessage = (m) => { const d = JSON.parse(m.data); if (d.id && pending.has(d.id)) { pending.get(d.id)(d.result); pending.delete(d.id); } if (d.method === 'Runtime.consoleAPICalled') console.log('[console]', d.params.type, d.params.args.map((a) => a.value ?? a.description).join(' ')); if (d.method === 'Runtime.exceptionThrown') console.log('[exception]', (d.params.exceptionDetails.exception?.description ?? JSON.stringify(d.params.exceptionDetails)).slice(0, 1200)); };
const send = (method, params = {}) => new Promise((r) => { const i = ++id; pending.set(i, r); sock.send(JSON.stringify({ id: i, method, params })); });
await send('Runtime.enable'); await send('Page.enable');
await send('Page.navigate', { url });
const fs = await import('node:fs');
const keyInfo = { Enter: 13, Backspace: 8, KeyA: 65, KeyS: 83, ArrowUp: 38, ArrowDown: 40, ArrowLeft: 37, ArrowRight: 39, KeyZ: 90, KeyX: 88, Backquote: 192 };
for (const s of steps) {
  const [cmd, a, b] = s.split(':');
  if (cmd === 'wait') await sleep(+a);
  else if (cmd === 'key') {
    const k = { code: a, key: a.replace('Key', '').toLowerCase(), windowsVirtualKeyCode: keyInfo[a], nativeVirtualKeyCode: keyInfo[a] };
    if (a === 'Backquote') k.key = '`'; if (a === 'Enter' || a === 'Backspace') k.key = a;
    if (a.startsWith('Arrow')) k.key = a;
    await send('Input.dispatchKeyEvent', { type: 'rawKeyDown', ...k }); await sleep(+(b ?? 100)); await send('Input.dispatchKeyEvent', { type: 'keyUp', ...k });
  } else if (cmd === 'mash') {
    const expr = s.slice(5);
    const k = { code: 'KeyZ', key: 'z', windowsVirtualKeyCode: 90, nativeVirtualKeyCode: 90 };
    let n = 0;
    for (; n < 300; n++) {
      const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true });
      if (r.result?.value) break;
      await send('Input.dispatchKeyEvent', { type: 'rawKeyDown', ...k }); await sleep(300); await send('Input.dispatchKeyEvent', { type: 'keyUp', ...k }); await sleep(60);
    }
    console.log('[mash]', n === 300 ? 'gave up' : `${n} presses`);
  } else if (cmd === 'eval') { const r = await send('Runtime.evaluate', { expression: s.slice(5), returnByValue: true }); console.log('[eval]', JSON.stringify(r.result?.value ?? r.exceptionDetails?.text)); 
  } else if (cmd === 'down' || cmd === 'up') { const k = { code: a, key: a, windowsVirtualKeyCode: keyInfo[a], nativeVirtualKeyCode: keyInfo[a] }; await send('Input.dispatchKeyEvent', { type: cmd === 'down' ? 'rawKeyDown' : 'keyUp', ...k });
  } else if (cmd === 'shot') { const r = await send('Page.captureScreenshot', { format: 'png' }); fs.writeFileSync(`${out}-${a}.png`, Buffer.from(r.data, 'base64')); console.log('shot', a); }
}
sock.close(); proc.kill();
