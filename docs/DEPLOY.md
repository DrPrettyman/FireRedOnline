# Deploying (Cloudflare Pages, password-gated)

The game is hosted as static files on Cloudflare Pages, with a Pages Function (`functions/_middleware.ts`) in front
of every request. The extracted assets (`public/gen/`) are copied into `dist/` by the build and uploaded from this
machine; they never go through GitHub.

## Why server side

The game fetches everything from `/gen/*`. A password check in the page would only hide the canvas: the assets
would still be downloadable by URL. The middleware runs before Pages serves any file, so without a valid session
cookie nothing is served: a page load redirects to `/login`, any other request gets a 401.

- Password: the `SITE_PASSWORD` secret. Unset, every request is refused (500).
- Session: an HttpOnly, Secure, SameSite=Lax cookie `fro_session` = `<expiry>.<HMAC-SHA256(SITE_PASSWORD,
  "session:<expiry>")>`, valid 30 days. No server-side state; changing the password logs everyone out.
- A wrong password waits 1 s before the answer. There is no lockout, so use a long password.
- `/logout` clears the cookie. Gated responses carry `Cache-Control: private, no-cache` and `X-Robots-Tag: noindex`.

## First deploy

```sh
npx wrangler login                                  # once, opens the browser
npx wrangler pages project create fireredonline --production-branch master
npx wrangler pages secret put SITE_PASSWORD --project-name fireredonline
npm run deploy                                      # checks public/gen exists, builds, uploads dist/ + functions/
```

The site is then at `https://fireredonline.pages.dev` (or the name Cloudflare gave the project). **Don't connect
the project to the GitHub repo** (Cloudflare's Git integration): its build has no decomp, so it would deploy a game
without assets. Deploy with `npm run deploy` only.

## Later deploys

`npm run deploy`. After re-extracting (`npm run extract`), deploy again to upload the new assets.

## Trying the gate locally

```sh
echo 'SITE_PASSWORD=something' > .dev.vars          # gitignored
npm run preview:gate                                 # builds, then serves dist/ + functions/ on http://localhost:8788
```

## Limits (free plan)

- Pages: 20,000 files per deploy and 25 MiB per file. The build is ~7,400 files and the largest is well under that.
- Functions: 100,000 requests a day. The middleware runs on every request, assets included, and the game loads
  assets lazily (a few hundred requests for a session's first minutes), which is plenty for personal use.
