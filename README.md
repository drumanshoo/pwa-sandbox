# PWA Sandbox

A standalone test bench for the three tiers of PWA capability — installable, offline, push notifications. Built to validate behavior (especially push, especially on iOS) before applying any of it to a client site.

No framework, no bundler. Pure HTML + CSS + JS + a single Vercel serverless function for the push trigger.

## What's here

| Tier | What it proves | Where it lives |
|---|---|---|
| 1. Installable | Manifest valid, icons load, SW registers, install prompt fires | `manifest.json`, `icons/`, `app.js` (phase1) |
| 2. Offline | App shell cached on first load; navigations fall back to `offline.html` when network is gone | `sw.js`, `offline.html` |
| 3. Push notifications | Browser subscribes against a VAPID public key; server-side function pushes a notification back | `app.js` (phase3), `api/send-push.js`, `api/vapid-public-key.js` |

## Setup (one-time)

### 1. Install dependencies

```bash
cd "C:/Users/dru/Documents/Projects/pwa-sandbox"
npm install
```

### 2. Generate VAPID keys

```bash
npm run vapid
```

You'll get something like:

```
=======================================
Public Key:
BL...long-base64...
Private Key:
mK...long-base64...
=======================================
```

Keep this output. You'll paste both keys into Vercel in step 4.

### 3. Push to GitHub

```bash
git init
git add .
git commit -m "Initial PWA sandbox"
gh repo create pwa-sandbox --public --source=. --remote=origin --push
```

### 4. Connect to Vercel

1. Go to <https://vercel.com/new> and import the `pwa-sandbox` GitHub repo.
2. Framework preset: **Other** (it's plain static + serverless).
3. Before the first deploy, click **Environment Variables** and add:
   - `VAPID_PUBLIC_KEY` — the public key from step 2
   - `VAPID_PRIVATE_KEY` — the private key from step 2
   - `VAPID_SUBJECT` — `mailto:drumanshoo@gmail.com`
4. Deploy.

Subsequent pushes to `main` redeploy automatically.

## Local development

```bash
npm install -g vercel   # one-time, if you don't already have it
vercel dev
```

`vercel dev` spins up the static site + the `api/*` serverless functions on `localhost:3000`. Push notifications **require a real HTTPS origin**, so the full Phase 3 flow won't work on localhost in every browser — use the Vercel preview URL for that.

## Testing the three tiers

### Phase 1 — Installable

- Open the deployed URL in **desktop Chrome**. Within ~2 seconds the "Install app" button should activate. Click it; Chrome shows the install prompt.
- After install, the app reopens in its own window and the page reflects "running as installed app."
- On iOS Safari there's no programmatic prompt — use Share → Add to Home Screen.

### Phase 2 — Offline

- Load the site once (this primes the cache).
- DevTools → Network tab → check **Offline**. Reload — the app shell still renders.
- Click **Try fetching /not-cached.html** while offline; it should fall back to `offline.html`.
- Re-enable network and reload to refresh the cache.

### Phase 3 — Push notifications

**Desktop Chrome:**
1. Click **Enable notifications** → grant permission.
2. Subscription is generated; "Send test push" activates.
3. Click **Send test push** → a system notification appears within ~1 second.

**iOS (16.4+):**
1. Open the deployed URL in **Safari** (not Chrome on iOS — Chrome on iOS is Safari under the hood but the install path differs).
2. Tap Share → **Add to Home Screen**.
3. Open the app from the **home-screen icon** (this is critical — subscribing from a Safari tab will silently fail).
4. Tap **Enable notifications** → grant permission.
5. Tap **Send test push**.

**Android Chrome:** Works like desktop Chrome. Notifications appear in the system shade.

## Debugging push failures

When a push doesn't arrive, check in this order:

1. **Service worker is active.** DevTools → Application → Service Workers. Status should be "activated and is running."
2. **Permission is granted.** `Notification.permission` should be `'granted'` in the console.
3. **Subscription exists.** `localStorage.getItem('pwa-sandbox-subscription')` should be a JSON object with an `endpoint`.
4. **Server has all three env vars.** Hit `/api/vapid-public-key` directly in the browser — should return the public key, not an error.
5. **Server response when sending.** The Phase 3 log panel shows the response body. A `410 Gone` means the subscription expired and you need to unsubscribe + resubscribe. A `500` means the server isn't configured.
6. **Device isn't blocking notifications.** macOS Focus mode / iOS Do Not Disturb / Windows Focus Assist will silently swallow notifications.

## File map

```
.claude/CLAUDE.md          ← Briefing for AI assistants working in this repo
README.md                  ← You are here
package.json               ← web-push dep + vapid key generator script
vercel.json                ← Cache-control headers for sw.js + manifest

index.html                 ← UI for all three tiers
app.js                     ← Client-side logic for all three tiers
styles.css
sw.js                      ← Service worker: caching + push handler
manifest.json
offline.html               ← Fallback when offline + uncached
icons/icon.svg             ← Standard icon
icons/icon-maskable.svg    ← Maskable icon for Android adaptive icons

api/vapid-public-key.js    ← Returns VAPID_PUBLIC_KEY to the client
api/send-push.js           ← Triggers a Web Push using web-push + VAPID keys
```

## Why no framework?

Because PWA features are quirky enough that you want every moving part visible. Frameworks add layers (build steps, hydration, opinionated SW handling) that hide exactly the surfaces you're trying to test. This is ~400 lines total of authored code — read it once and you understand the whole system.
