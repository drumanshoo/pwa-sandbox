// GET /api/vapid-public-key
// Returns the VAPID public key so the browser can subscribe.
export default function handler(req, res) {
  const publicKey = process.env.VAPID_PUBLIC_KEY;
  if (!publicKey) {
    res.status(500).json({ error: 'VAPID_PUBLIC_KEY not configured' });
    return;
  }
  res.setHeader('Cache-Control', 'no-store');
  res.status(200).json({ publicKey });
}
