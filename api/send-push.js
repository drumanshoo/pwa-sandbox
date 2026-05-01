// POST /api/send-push
// Body: { subscription: PushSubscription, payload: { title, body, url } }
// Sends a Web Push using the configured VAPID keys.
import webpush from 'web-push';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const { VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT } = process.env;
  if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY || !VAPID_SUBJECT) {
    res.status(500).json({
      error: 'VAPID env vars missing',
      need: ['VAPID_PUBLIC_KEY', 'VAPID_PRIVATE_KEY', 'VAPID_SUBJECT'],
    });
    return;
  }

  webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);

  const { subscription, payload } = req.body || {};
  if (!subscription || !subscription.endpoint) {
    res.status(400).json({ error: 'Missing or invalid subscription' });
    return;
  }

  try {
    const result = await webpush.sendNotification(
      subscription,
      JSON.stringify(payload || { title: 'PWA Sandbox', body: 'Test push' })
    );
    res.status(200).json({ ok: true, statusCode: result.statusCode });
  } catch (e) {
    // 410 Gone / 404 = subscription expired or unsubscribed
    res.status(e.statusCode || 500).json({
      ok: false,
      error: e.body || e.message,
      statusCode: e.statusCode,
    });
  }
}
