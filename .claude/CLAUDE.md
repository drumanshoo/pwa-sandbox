# CLAUDE.md — pwa-sandbox

## What this project is

A standalone PWA test bench. The point is to validate the three PWA capability tiers in a clean environment before applying any of it to the **2800 LDS** client site (`C:\Users\dru\Documents\Clients\2800 LDS`). This project is **not** a deliverable for that client — it's a sandbox.

Three tiers, in order of difficulty:
1. **Installable** — valid manifest, icons, registered service worker, "Add to Home Screen" works.
2. **Offline** — service worker caches the app shell; the page loads with the network disabled.
3. **Push notifications** — VAPID-keyed Web Push, subscribe flow in the browser, serverless endpoint that sends the push. **This is the real reason the sandbox exists.** Notifications are the feature that's most likely to fail silently or behave differently on iOS, so prove it here first.

## Stack & deploy model

- Vanilla HTML / CSS / JS. No framework, no bundler, no build step. Edit a file → refresh.
- Hosted on **Vercel**, deployed by pushing to **GitHub**. Push notifications require HTTPS, so local `file://` and plain `http://localhost` won't fully exercise tier 3 — production URL or Vercel preview URL is the test surface for push.
- One Vercel **serverless function** (`api/send-push.js`) holds the `web-push` private VAPID key and triggers a push to a subscription the client posts back to it. No database — the browser stores its own subscription in `localStorage` and sends it with the trigger request.

## Repo layout

```
pwa-sandbox/
├── .claude/CLAUDE.md         ← this file
├── api/
│   ├── send-push.js          ← serverless: triggers a push using stored VAPID key
│   └── vapid-public-key.js   ← serverless: returns public key to the client
├── icons/                    ← PWA icons (SVG; PNG can be added later)
├── index.html                ← UI for all 3 tiers
├── app.js                    ← client logic for all 3 tiers
├── sw.js                     ← service worker (cache + push handler)
├── manifest.json
├── offline.html              ← fallback shown when offline + uncached
├── styles.css
├── package.json              ← only dependency: web-push
├── vercel.json
└── README.md                 ← human-facing setup steps
```

## How to initiate the project (first session in this repo)

This is a fresh sandbox. To bring it from "files on disk" to "deployed and testable":

1. **Initialize git, push to GitHub.**
   ```bash
   cd "C:/Users/dru/Documents/Projects/pwa-sandbox"
   git init
   git add .
   git commit -m "Initial PWA sandbox"
   gh repo create pwa-sandbox --public --source=. --remote=origin --push
   ```

2. **Generate VAPID keys** (once, locally):
   ```bash
   npx web-push generate-vapid-keys
   ```
   Copy the public + private keys.

3. **Connect repo to Vercel** (`vercel.com/new` → import the GitHub repo) and add three env vars in the Vercel project settings:
   - `VAPID_PUBLIC_KEY` — the public key from step 2
   - `VAPID_PRIVATE_KEY` — the private key from step 2
   - `VAPID_SUBJECT` — `mailto:drumanshoo@gmail.com`

4. **Deploy.** Vercel builds on push. Open the Vercel URL on a phone (iOS 16.4+ for push) and on desktop Chrome.

5. **Walk the three tiers in order** — each section of the page guides through it. Phase 3 has an "install to home screen first" step on iOS; the page calls that out.

## What to do, what not to do, in this repo

- **Don't introduce a build step or a framework.** The whole point is that the moving parts are visible. If something needs a library, evaluate whether vanilla can do it first.
- **Don't add icon PNGs by guessing pixel content.** The SVG is functional; if PNGs are needed for App Store-style installability on a particular OS, generate them with a real tool (ImageMagick, Squoosh, or an online PWA icon generator) — don't fabricate binary content.
- **Bump the `CACHE_VERSION` constant in `sw.js`** any time `index.html` / `app.js` / `styles.css` change in a way the cache shouldn't serve stale. The active SW will pick up the new version on next reload.
- **Push notifications fail silently in lots of ways.** When debugging, always check (in this order): (1) is the service worker active? (2) is `Notification.permission === 'granted'`? (3) is there a `PushSubscription` in `localStorage`? (4) does the serverless function have all three env vars? (5) is the device locked / DND on?
- **iOS specifics:** Web Push only works on iOS 16.4+, and **only after the user adds the PWA to their home screen** and opens it from that icon. Subscribing from a regular Safari tab will not work. The UI in `index.html` reflects this.

## Relationship to 2800 LDS

When a tier is proven here, the next step is porting the relevant pattern into the 2800 LDS WordPress site. Likely path:
- Manifest + service worker can be enqueued from the active theme (`hello-elementor-2800lsd`) or from the existing `building-hvac-status` plugin.
- Push subscription + VAPID send can become a small companion plugin or extend `building-hvac-status`.
- Don't port until tier 3 is observed working end-to-end **on a phone, not just desktop**.
