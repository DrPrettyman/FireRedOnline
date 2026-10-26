// The password gate for the Cloudflare Pages deploy (docs/DEPLOY.md). Pages runs this before every request,
// the static files included, so the page, the bundle and the extracted assets in gen/ are only served with a
// valid session cookie. Anything else gets the login page (a navigation) or a 401 (a fetch).
//
// - SITE_PASSWORD (a Pages secret) is the password. Without it every request is refused.
// - The session cookie is `<expiry>.<HMAC-SHA256(SITE_PASSWORD, "session:<expiry>")>`: nothing stored server side,
//   and changing the password logs everyone out.

interface Env {
  SITE_PASSWORD?: string;
}

const COOKIE = 'fro_session';
const SESSION_DAYS = 30;
/** A wrong password waits this long before the answer, to slow down guessing. */
const FAIL_DELAY_MS = 1000;

const encoder = new TextEncoder();

async function hmacHex(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', key, encoder.encode(message)));
  return Array.from(sig, (b) => b.toString(16).padStart(2, '0')).join('');
}

/** Compares in time independent of where the strings differ. */
function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function readCookie(request: Request, name: string): string | undefined {
  for (const part of (request.headers.get('Cookie') ?? '').split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) return v.join('=');
  }
  return undefined;
}

async function validSession(request: Request, password: string): Promise<boolean> {
  const value = readCookie(request, COOKIE);
  if (!value) return false;
  const [exp, sig] = value.split('.');
  if (!exp || !sig || !(Number(exp) > Date.now())) return false;
  return safeEqual(sig, await hmacHex(password, `session:${exp}`));
}

/** Only same-site paths: no `//host` or `/\host` redirects. */
function safeNext(next: string | null): string {
  return next && next.startsWith('/') && !next.startsWith('//') && !next.startsWith('/\\') ? next : '/';
}

function redirect(location: string, extra: HeadersInit = {}): Response {
  return new Response(null, { status: 303, headers: { Location: location, 'Cache-Control': 'no-store', ...extra } });
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

function loginPage(next: string, failed: boolean, status = 200): Response {
  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>FireRed Online</title>
<style>
  :root { color-scheme: dark; }
  * { box-sizing: border-box; }
  html, body { margin: 0; height: 100%; background: #101014; color: #eee; font: 16px/1.4 system-ui, sans-serif; }
  body { display: grid; place-items: center; padding: 16px; }
  form { width: 100%; max-width: 320px; display: grid; gap: 12px; }
  h1 { margin: 0 0 8px; font-size: 22px; font-weight: 600; text-align: center; color: #f06040; }
  input, button { font: inherit; padding: 12px; border-radius: 8px; border: 1px solid #333; }
  input { background: #1b1b22; color: inherit; }
  input:focus { outline: 2px solid #f06040; outline-offset: 1px; }
  button { background: #d8402a; border-color: #d8402a; color: #fff; font-weight: 600; cursor: pointer; }
  p { margin: 0; color: #f88; font-size: 14px; text-align: center; }
</style>
</head>
<body>
<form method="post" action="/login">
  <h1>FireRed Online</h1>
  <input type="hidden" name="next" value="${escapeHtml(next)}">
  <input type="password" name="password" placeholder="Password" aria-label="Password" autocomplete="current-password" autofocus required>
  <button type="submit">Enter</button>
  ${failed ? '<p role="alert">Wrong password.</p>' : ''}
</form>
</body>
</html>`;
  return new Response(html, {
    status,
    headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex' },
  });
}

export const onRequest: PagesFunction<Env> = async ({ request, env, next }) => {
  const password = env.SITE_PASSWORD;
  if (!password) return new Response('SITE_PASSWORD is not set.', { status: 500 });
  const url = new URL(request.url);

  if (url.pathname === '/login') {
    if (request.method === 'POST') {
      const form = await request.formData();
      const nextPath = safeNext(form.get('next') as string | null);
      const given = (form.get('password') as string | null) ?? '';
      // Compare MACs rather than the strings, so the length of the password doesn't leak either.
      const ok = safeEqual(await hmacHex(password, `login:${given}`), await hmacHex(password, `login:${password}`));
      if (!ok) {
        await new Promise((r) => setTimeout(r, FAIL_DELAY_MS));
        return loginPage(nextPath, true, 401);
      }
      const exp = Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000;
      const cookie = `${COOKIE}=${exp}.${await hmacHex(password, `session:${exp}`)}; Path=/; Max-Age=${SESSION_DAYS * 24 * 60 * 60}; HttpOnly; Secure; SameSite=Lax`;
      return redirect(nextPath, { 'Set-Cookie': cookie });
    }
    return loginPage(safeNext(url.searchParams.get('next')), false);
  }

  if (url.pathname === '/logout') {
    return redirect('/login', { 'Set-Cookie': `${COOKIE}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax` });
  }

  if (!(await validSession(request, password))) {
    const isPage = request.method === 'GET' && (request.headers.get('Accept') ?? '').includes('text/html');
    if (isPage) return redirect(`/login?next=${encodeURIComponent(url.pathname + url.search)}`);
    return new Response('Unauthorized', { status: 401, headers: { 'Cache-Control': 'no-store' } });
  }

  const response = await next();
  const headers = new Headers(response.headers);
  // Never let a shared cache keep a copy of something behind the gate.
  headers.set('Cache-Control', 'private, no-cache');
  headers.set('X-Robots-Tag', 'noindex');
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
};
