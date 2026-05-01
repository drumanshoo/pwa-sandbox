// ─── Helpers ────────────────────────────────────────────────────
const $ = (id) => document.getElementById(id);
const setCheck = (id, state) => {
  const el = $(id);
  if (!el) return;
  el.classList.remove('ok', 'warn', 'err');
  if (state) el.classList.add(state);
};
const setStatus = (id, label, state) => {
  const el = $(id);
  if (!el) return;
  el.textContent = label;
  el.classList.remove('ok', 'warn', 'err');
  if (state) el.classList.add(state);
};
const log = (id, msg) => {
  const el = $(id);
  el.hidden = false;
  const stamp = new Date().toLocaleTimeString();
  el.textContent += `[${stamp}] ${msg}\n`;
  el.scrollTop = el.scrollHeight;
};

// urlBase64ToUint8Array — needed to pass VAPID public key to subscribe()
const urlB64ToUint8 = (base64) => {
  const pad = '='.repeat((4 - (base64.length % 4)) % 4);
  const b64 = (base64 + pad).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(b64);
  const arr = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) arr[i] = raw.charCodeAt(i);
  return arr;
};

// ─── Environment banner ─────────────────────────────────────────
(function envBanner() {
  const banner = $('env-banner');
  const isSecure = window.isSecureContext;
  const isStandalone =
    window.matchMedia('(display-mode: standalone)').matches ||
    window.navigator.standalone === true;
  const isLocalhost = ['localhost', '127.0.0.1'].includes(location.hostname);

  const bits = [];
  bits.push(isSecure ? '🔒 secure context' : '⚠ insecure context');
  bits.push(isStandalone ? '📱 standalone' : '🌐 browser tab');
  if (isLocalhost) bits.push('localhost');
  banner.textContent = bits.join(' · ');
  banner.hidden = false;
  if (!isSecure) banner.classList.add('warn');
})();

// ─── PHASE 1: Installable ───────────────────────────────────────
(async function phase1() {
  const isSecure = window.isSecureContext;
  setCheck('chk-https', isSecure ? 'ok' : 'err');

  // Manifest reachable?
  try {
    const res = await fetch('/manifest.json');
    setCheck('chk-manifest', res.ok ? 'ok' : 'err');
  } catch {
    setCheck('chk-manifest', 'err');
  }

  // Service worker registration
  if ('serviceWorker' in navigator) {
    try {
      const reg = await navigator.serviceWorker.register('/sw.js');
      await navigator.serviceWorker.ready;
      setCheck('chk-sw', 'ok');

      // Ask SW for its version
      navigator.serviceWorker.addEventListener('message', (e) => {
        if (e.data && e.data.type === 'VERSION') {
          $('sw-version').textContent = e.data.version;
        }
      });
      if (reg.active) reg.active.postMessage('GET_VERSION');
    } catch (e) {
      setCheck('chk-sw', 'err');
      console.error('SW registration failed', e);
    }
  } else {
    setCheck('chk-sw', 'err');
  }

  // Installed mode?
  const isStandalone =
    window.matchMedia('(display-mode: standalone)').matches ||
    window.navigator.standalone === true;
  setCheck('chk-installed', isStandalone ? 'ok' : 'warn');

  // beforeinstallprompt — desktop Chrome / Android
  let deferredPrompt = null;
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPrompt = e;
    setCheck('chk-installable', 'ok');
    $('btn-install').disabled = false;
    setStatus('status-install', 'ready', 'ok');
  });

  $('btn-install').addEventListener('click', async () => {
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    if (outcome === 'accepted') setStatus('status-install', 'installed', 'ok');
    deferredPrompt = null;
    $('btn-install').disabled = true;
  });

  window.addEventListener('appinstalled', () => {
    setStatus('status-install', 'installed', 'ok');
    setCheck('chk-installed', 'ok');
  });

  // Final phase-1 status if no prompt arrived
  setTimeout(() => {
    if (isStandalone) {
      setStatus('status-install', 'installed', 'ok');
    } else if (deferredPrompt) {
      setStatus('status-install', 'ready', 'ok');
    } else {
      setStatus('status-install', 'no prompt', 'warn');
      setCheck('chk-installable', 'warn');
    }
  }, 1500);
})();

// ─── PHASE 2: Offline ───────────────────────────────────────────
(function phase2() {
  const updateOnline = () => {
    setCheck('chk-online', navigator.onLine ? 'ok' : 'warn');
    setStatus(
      'status-offline',
      navigator.onLine ? 'online' : 'offline',
      navigator.onLine ? 'ok' : 'warn'
    );
  };
  updateOnline();
  window.addEventListener('online', updateOnline);
  window.addEventListener('offline', updateOnline);

  // Verify shell is in cache
  caches.has('pwa-sandbox-v1').then((has) => {
    setCheck('chk-cache', has ? 'ok' : 'warn');
  });

  $('btn-test-offline').addEventListener('click', async () => {
    log('offline-output', `fetching /not-cached.html …`);
    try {
      const res = await fetch('/not-cached.html');
      log('offline-output', `→ ${res.status} ${res.statusText} (${res.redirected ? 'redirected' : 'direct'})`);
      const text = await res.text();
      log('offline-output', `   body length: ${text.length}`);
    } catch (e) {
      log('offline-output', `→ error: ${e.message}`);
    }
  });

  $('btn-clear-cache').addEventListener('click', async () => {
    const keys = await caches.keys();
    await Promise.all(keys.map((k) => caches.delete(k)));
    log('offline-output', `cleared caches: ${keys.join(', ') || '(none)'}`);
    setCheck('chk-cache', 'warn');
  });
})();

// ─── PHASE 3: Push notifications ────────────────────────────────
(async function phase3() {
  const supported =
    'serviceWorker' in navigator &&
    'PushManager' in window &&
    'Notification' in window;
  setCheck('chk-push-supported', supported ? 'ok' : 'err');
  if (!supported) {
    setStatus('status-push', 'unsupported', 'err');
    return;
  }

  const reflectPermission = () => {
    const p = Notification.permission;
    if (p === 'granted') setCheck('chk-permission', 'ok');
    else if (p === 'denied') setCheck('chk-permission', 'err');
    else setCheck('chk-permission', 'warn');
    return p;
  };
  reflectPermission();

  // Fetch VAPID public key from the server
  let vapidPublicKey = null;
  try {
    const res = await fetch('/api/vapid-public-key');
    if (res.ok) {
      const { publicKey } = await res.json();
      if (publicKey) {
        vapidPublicKey = publicKey;
        setCheck('chk-vapid', 'ok');
      } else {
        setCheck('chk-vapid', 'err');
      }
    } else {
      setCheck('chk-vapid', 'err');
    }
  } catch {
    setCheck('chk-vapid', 'err');
  }

  // Get existing subscription
  const reg = await navigator.serviceWorker.ready;
  let sub = await reg.pushManager.getSubscription();

  // Make sure any pre-existing local sub is also in the server registry,
  // so broadcasts from this device or another will reach it.
  const registerOnServer = async (s) => {
    try {
      const r = await fetch('/api/subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ subscription: s }),
      });
      const txt = await r.text();
      log('push-log', `registry: ${r.status} ${txt}`);
    } catch (e) {
      log('push-log', `registry error: ${e.message}`);
    }
  };
  if (sub) registerOnServer(sub);

  const reflectSub = () => {
    if (sub) {
      setCheck('chk-subscription', 'ok');
      $('btn-subscribe').disabled = true;
      $('btn-send-push').disabled = false;
      $('btn-unsubscribe').disabled = false;
      setStatus('status-push', 'subscribed', 'ok');
    } else {
      setCheck('chk-subscription', 'warn');
      $('btn-subscribe').disabled = !vapidPublicKey;
      $('btn-send-push').disabled = true;
      $('btn-unsubscribe').disabled = true;
      setStatus('status-push', vapidPublicKey ? 'ready' : 'no VAPID', vapidPublicKey ? 'warn' : 'err');
    }
  };
  reflectSub();

  $('btn-subscribe').addEventListener('click', async () => {
    log('push-log', 'requesting permission…');
    const perm = await Notification.requestPermission();
    reflectPermission();
    if (perm !== 'granted') {
      log('push-log', `permission ${perm} — aborting`);
      return;
    }
    log('push-log', 'subscribing…');
    try {
      sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlB64ToUint8(vapidPublicKey),
      });
      localStorage.setItem('pwa-sandbox-subscription', JSON.stringify(sub));
      log('push-log', `subscribed: endpoint=${sub.endpoint.slice(0, 60)}…`);
      await registerOnServer(sub);
      reflectSub();
    } catch (e) {
      log('push-log', `subscribe failed: ${e.message}`);
    }
  });

  $('btn-send-push').addEventListener('click', async () => {
    if (!sub) return;
    log('push-log', 'POST /api/send-push …');
    try {
      const res = await fetch('/api/send-push', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          subscription: sub,
          payload: {
            title: 'PWA Sandbox',
            body: `Hello from the server — ${new Date().toLocaleTimeString()}`,
            url: '/',
          },
        }),
      });
      const txt = await res.text();
      log('push-log', `→ ${res.status} ${txt}`);
    } catch (e) {
      log('push-log', `→ error: ${e.message}`);
    }
  });

  $('btn-unsubscribe').addEventListener('click', async () => {
    if (!sub) return;
    await sub.unsubscribe();
    localStorage.removeItem('pwa-sandbox-subscription');
    log('push-log', 'unsubscribed (local — server registry cleans up on next broadcast)');
    sub = null;
    reflectSub();
  });

  $('btn-broadcast').addEventListener('click', async () => {
    log('push-log', 'POST /api/broadcast …');
    try {
      const res = await fetch('/api/broadcast', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          payload: {
            title: 'PWA Sandbox — broadcast',
            body: `Hello to all devices — ${new Date().toLocaleTimeString()}`,
            url: '/',
          },
        }),
      });
      const json = await res.json();
      log('push-log', `→ ${res.status} total=${json.total} results=${JSON.stringify(json.results)}`);
    } catch (e) {
      log('push-log', `→ error: ${e.message}`);
    }
  });
})();
