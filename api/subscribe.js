// POST /api/subscribe
// Body: { subscription: PushSubscription }
// Stores the subscription in Vercel KV (Upstash Redis) so /api/broadcast can fan out to it.

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const { KV_REST_API_URL, KV_REST_API_TOKEN } = process.env;
  if (!KV_REST_API_URL || !KV_REST_API_TOKEN) {
    res.status(500).json({
      error: 'KV env vars missing',
      need: ['KV_REST_API_URL', 'KV_REST_API_TOKEN'],
    });
    return;
  }

  const { subscription } = req.body || {};
  if (!subscription || !subscription.endpoint) {
    res.status(400).json({ error: 'Missing or invalid subscription' });
    return;
  }

  const member = JSON.stringify(subscription);
  const kvRes = await fetch(KV_REST_API_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${KV_REST_API_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(['SADD', 'pwa-sandbox-subs', member]),
  });

  if (!kvRes.ok) {
    const text = await kvRes.text();
    res.status(502).json({ error: 'KV write failed', status: kvRes.status, body: text });
    return;
  }

  const { result } = await kvRes.json();
  res.status(200).json({ ok: true, added: result === 1, endpoint: subscription.endpoint });
}
