// POST /api/broadcast
// Body: { payload?: { title, body, url } }
// Loads every stored subscription from KV and pushes the payload to each.
// 410/404 responses (subscription expired) → removed from KV automatically.

import webpush from 'web-push';

async function kv(command, ...args) {
  const { KV_REST_API_URL, KV_REST_API_TOKEN } = process.env;
  const r = await fetch(KV_REST_API_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${KV_REST_API_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify([command, ...args]),
  });
  if (!r.ok) throw new Error(`KV ${command} ${r.status}: ${await r.text()}`);
  return (await r.json()).result;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const { VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT, KV_REST_API_URL, KV_REST_API_TOKEN } =
    process.env;
  if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY || !VAPID_SUBJECT) {
    res.status(500).json({ error: 'VAPID env vars missing' });
    return;
  }
  if (!KV_REST_API_URL || !KV_REST_API_TOKEN) {
    res.status(500).json({ error: 'KV env vars missing' });
    return;
  }

  webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);

  const { payload } = req.body || {};
  const messageBody = JSON.stringify(
    payload || { title: 'PWA Sandbox', body: `Broadcast — ${new Date().toLocaleTimeString()}` }
  );

  const members = (await kv('SMEMBERS', 'pwa-sandbox-subs')) || [];
  const results = [];

  for (const memberJson of members) {
    let sub;
    try {
      sub = JSON.parse(memberJson);
    } catch {
      await kv('SREM', 'pwa-sandbox-subs', memberJson);
      results.push({ status: 'removed-invalid' });
      continue;
    }
    const short = sub.endpoint.slice(0, 60) + '…';
    try {
      const r = await webpush.sendNotification(sub, messageBody);
      results.push({ endpoint: short, statusCode: r.statusCode });
    } catch (e) {
      if (e.statusCode === 404 || e.statusCode === 410) {
        await kv('SREM', 'pwa-sandbox-subs', memberJson);
        results.push({ endpoint: short, removed: true, reason: e.statusCode });
      } else {
        results.push({
          endpoint: short,
          error: e.message,
          statusCode: e.statusCode,
        });
      }
    }
  }

  res.status(200).json({ ok: true, total: members.length, results });
}
