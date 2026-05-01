# PWA Sandbox — Findings & WordPress Port Plan

This sandbox proved the three PWA tiers end-to-end on production infrastructure (Vercel + Upstash KV), including cross-device push fanout. The point now is to lift the proven pattern into the **2800 LDS** WordPress site (`C:\Users\dru\Documents\Clients\2800 LDS`) so staff can broadcast notifications to the community.

Live deployment: `https://pwa-sandbox-eta.vercel.app`

## What was proven

| Tier | Capability | Desktop Chrome | iOS 16.4+ Safari (installed) |
|---|---|---|---|
| 1 | Manifest, icons, SW registered, install prompt | ✅ | ✅ via Share → Add to Home Screen |
| 2 | App shell cached on first load; navigations fall back to `offline.html` | ✅ | ✅ |
| 3a | 1:1 push (this device pushes itself via stored localStorage subscription) | ✅ | ✅ |
| 3b | 1:N broadcast (server-side KV registry, fanout via `/api/broadcast`) | ✅ | ✅ |

Confirmed via end-to-end run: a single click of **Broadcast to all subscribed devices** on desktop fires a notification on both desktop *and* iPhone. Stale subscriptions are pruned automatically when the push service returns 410.

## Architecture (as deployed)

```
Browser                Vercel (Node serverless)        Upstash Redis
─────────              ────────────────────────        ─────────────
app.js                 GET  /api/vapid-public-key      Set "pwa-sandbox-subs"
  subscribe()  ─POST→  POST /api/subscribe       ─SADD→  member = JSON(sub)
  click bcast  ─POST→  POST /api/broadcast       ─SMEMBERS→
                          for each member:               (returns all subs)
                            web-push.send(...)
                            on 410/404           ─SREM→  remove dead sub
sw.js
  push event handler → showNotification(...)
```

**Key files:**
- `index.html` — three-tier UI
- `app.js` — client logic (subscribe → register on server → broadcast button)
- `sw.js` — service worker (cache, push handler, notification click)
- `api/vapid-public-key.js` — exposes `VAPID_PUBLIC_KEY` to the client
- `api/send-push.js` — 1:1 send (legacy from tier 3a; still useful for diagnostics)
- `api/subscribe.js` — adds a `PushSubscription` to the KV set
- `api/broadcast.js` — fans out to all stored subs, removes dead ones on 410/404

**Required env vars (Vercel project):**
- `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` (manual)
- `KV_REST_API_URL`, `KV_REST_API_TOKEN` (auto-injected by Upstash marketplace integration)

## Gotchas worth carrying forward

**iOS-specific:**
- Web Push requires **iOS 16.4+** and the PWA must be **installed to the home screen**. Subscribing from a Safari tab silently fails — no error, no prompt, just doesn't work.
- The home-screen PWA gets its *own* notification permission state, separate from Safari's. Granting permission in a tab doesn't carry over.
- After bumping `CACHE_VERSION`, the new SW activates only after the PWA is force-quit and reopened. App Switcher → swipe up the tile → reopen. May take two cycles.

**Notification UX:**
- The SW sets `tag: 'pwa-sandbox'` on every notification. Same tag = new notification *replaces* the previous one in the OS. Useful in production (no banner spam), confusing in a sandbox where you click 5 times and see one banner. For demo purposes, set a unique tag per send (`Date.now()`-suffix).
- On Windows, banners are short-lived. If you blink, check Notification Center (`Win+N`) — the timestamp will tick up even if you didn't see the banner.

**Vercel deployment:**
- Env var changes do **not** trigger a redeploy. After adding/changing env vars, manually redeploy via Deployments → ⋯ → Redeploy.
- File-based routing in `/api/*` — every `.js` file becomes a route. Files starting with `_` are excluded; we kept all helpers inline to avoid that complexity.

**Subscription lifecycle:**
- A `PushSubscription` can become invalid for many reasons: user clears site data, browser unsubscribes a stale endpoint, OS-level uninstall. The push service returns **410 Gone** or **404 Not Found** in those cases. The broadcast function handles this by `SREM`ing the dead member from KV. Any production implementation needs the same cleanup or the registry will fill with garbage.
- A device that subscribes and later opens the app gets `pushManager.getSubscription()` returning the existing sub. We re-register on every page load (idempotent — `SADD` to a set is a no-op for duplicates). This handles the case where a user subscribed pre-feature and the registry never knew about them.

## Port plan: 2800 LDS WordPress

### Mapping

| Sandbox piece | WordPress equivalent |
|---|---|
| `manifest.json` (static file) | Theme/plugin: `wp_head` action that outputs `<link rel="manifest">` pointing to a static or `admin-ajax`-served manifest |
| `sw.js` (static file at site root) | **Must be served from site root**, not from a plugin or theme path. Either drop the file at the WP root or use a top-level rewrite rule. SW scope = serving directory; you cannot register `/wp-content/.../sw.js` to control `/`. |
| `app.js` client logic | Enqueued via `wp_enqueue_script` from the theme or plugin |
| Service worker registration | Inline `<script>` in footer or part of `app.js` |
| `/api/vapid-public-key` | REST API endpoint via `register_rest_route( 'pwa/v1', '/vapid-key', ... )` |
| `/api/subscribe` | REST endpoint `POST /pwa/v1/subscribe`, public (anyone can subscribe themselves) |
| `/api/broadcast` | REST endpoint `POST /pwa/v1/broadcast`, **gated by capability check** (`current_user_can('publish_posts')` or a new `pwa_broadcast` capability) |
| `/api/send-push` (1:1) | Optional admin tool — `POST /pwa/v1/send` to a specific subscription, useful for debugging |
| Upstash KV (Redis set) | Custom DB table `wp_pwa_subscriptions` with columns `id`, `endpoint` (unique), `subscription_json`, `user_id` (nullable), `created_at`, `last_seen_at` |
| `web-push` (Node lib) | `web-push-php` (Composer: `minishlink/web-push`) — same protocol, mature, drop-in conceptually |
| Broadcast UI | WP admin page (sub-menu under Tools or its own top-level), gated by capability — staff click "Send notification" |
| VAPID keys | `wp-config.php` defines, or **better** `update_option` with autoload off + accessor wrapper so they're not in version control |

### Recommended structure

A small companion plugin (call it `pwa-push` or fold into the existing `building-hvac-status` plugin):

```
pwa-push/
├── pwa-push.php                ← plugin bootstrap
├── includes/
│   ├── class-pwa-routes.php    ← registers REST routes
│   ├── class-pwa-broadcast.php ← uses minishlink/web-push to fanout
│   ├── class-pwa-subscriptions.php  ← DB CRUD
│   └── class-pwa-admin.php     ← admin page + AJAX for staff send
├── public/
│   ├── manifest.json
│   └── app.js                  ← enqueued via wp_enqueue_script
├── vendor/                     ← composer install minishlink/web-push
└── sw.js                       ← copied to site root via activation hook OR served via rewrite
```

The trickiest piece is **getting `sw.js` served from `/` with the right scope**. Options:
1. Have the plugin write `sw.js` to the WP root on activation (and remove on deactivation). Simple but brittle if the WP root isn't writable.
2. Rewrite rule: `RewriteRule ^sw\.js$ /wp-content/plugins/pwa-push/sw.js [L]` plus a `Service-Worker-Allowed: /` header. More portable.
3. PHP-served route at `/sw.js` via `template_redirect` — works but adds PHP overhead to every SW fetch.

Option 2 is the standard.

### Auth model

- **Subscribe** is open: any visitor (logged in or not) can register their own browser. Capture `user_id` if logged in (lets staff later target by member).
- **Broadcast** requires `current_user_can('pwa_broadcast')`. Map this capability to existing roles via a one-liner on plugin activation (e.g., grant to `administrator` and a new `community_staff` role, or to anyone with `edit_others_posts` if you don't want a new capability).
- The subscribe endpoint should also rate-limit per IP to avoid registry pollution.

### Don't port until you've added these

The sandbox is intentionally minimal. These are needed for production but were left out to keep the test surface clean. **Address them in the WP port, not by extending the sandbox.**

- **Topic / channel subscriptions.** Right now everyone gets every broadcast. Real use likely wants categories ("services", "emergencies", "events") with per-user opt-in. Add a `topic` column to the subs table and a `topics` array per subscription.
- **Audit log.** Every staff broadcast should write a row: who sent, when, payload, delivery counts (success / removed / failed). Without this, "did the Sunday alert go out?" has no answer.
- **Delivery analytics.** `web-push` returns `statusCode` per send. Aggregate per broadcast: how many delivered, how many pruned, error rate. Surface in the admin page.
- **Notification click telemetry.** The SW's `notificationclick` handler can ping a server endpoint before opening the URL. Useful but not critical.
- **Icon PNGs.** SVG icons work for everything we tested but some platforms / app store flows want PNGs at standard sizes (192, 512, plus maskable). Generate via Squoosh or an online PWA icon generator — **do not fabricate**.
- **Payload encryption review.** `web-push` handles this for you, but confirm payloads don't contain PII you wouldn't want in transit through Apple/Google push services. Push payloads are encrypted to the subscriber's keys, but treat them as semi-public.

### Migration sequence (suggested)

1. Stand up the WP plugin skeleton with the manifest, SW, and subscribe endpoint only — prove tier 1 + tier 2 on the WP site.
2. Add the broadcast endpoint and admin UI, gated to a single staff account.
3. Test cross-device the same way as the sandbox: install on iPhone, subscribe in Chrome, broadcast from admin.
4. Add topics, audit log, analytics.
5. Roll out to community.

The sandbox in this repo can stay as a reference implementation — when something behaves oddly in the WP version, diff against the working sandbox to isolate WP-specific issues.

## Open experiments worth running before WP port

- **Subscription expiry under load.** What happens to a subscription after 30 days of inactivity? After a phone OS update? Useful to know for the audit log design.
- **Notification action buttons.** `actions` array on `showNotification` — does it work on iOS yet (as of this writing, mostly no)? Determines whether staff broadcasts can include "RSVP" / "Mark read" buttons.
- **Background sync.** If a broadcast fires while the device is offline, does the push queue and arrive when the device comes online? (Typically yes, but worth confirming for time-sensitive alerts.)
- **Multiple subscriptions per user.** A user installs on phone *and* desktop — the registry will have two endpoints under the same `user_id`. Confirm the broadcast hits both as expected.

None of these block the port; they're just the questions that'll come up the moment the WP plugin is in front of staff.
