// Vercel serverless function (free). No npm packages needed.
// Env vars (Vercel -> Project -> Settings -> Environment Variables):
//   FIREBASE_SERVICE_ACCOUNT = full JSON of Firebase service-account key
//   FIREBASE_DB_URL          = https://mandigomart-default-rtdb.firebaseio.com   (optional, default below)
const crypto = require('crypto');
const DB = (process.env.FIREBASE_DB_URL || 'https://mandigomart-default-rtdb.firebaseio.com').replace(/\/+$/, '');
let cached = { t: 0, exp: 0 };

function b64u(x) { return Buffer.from(x).toString('base64').replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_'); }

async function accessToken(sa) {
  const now = Math.floor(Date.now() / 1000);
  if (cached.t && cached.exp - 60 > now) return cached.t;
  const head = b64u(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claim = b64u(JSON.stringify({
    iss: sa.client_email,
    scope: 'https://www.googleapis.com/auth/firebase.messaging https://www.googleapis.com/auth/firebase.database https://www.googleapis.com/auth/userinfo.email',
    aud: 'https://oauth2.googleapis.com/token', iat: now, exp: now + 3600
  }));
  const sig = crypto.createSign('RSA-SHA256').update(head + '.' + claim).sign(sa.private_key);
  const jwt = head + '.' + claim + '.' + b64u(sig);
  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'grant_type=' + encodeURIComponent('urn:ietf:params:oauth:grant-type:jwt-bearer') + '&assertion=' + encodeURIComponent(jwt)
  });
  const j = await r.json();
  if (!j.access_token) throw new Error('token: ' + JSON.stringify(j).slice(0, 200));
  cached = { t: j.access_token, exp: now + (j.expires_in || 3600) };
  return cached.t;
}

async function rtdb(tok, method, path, body) {
  const r = await fetch(DB + '/' + path + '.json', {
    method, headers: { Authorization: 'Bearer ' + tok, 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  return r.status === 200 ? r.json() : null;
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ ok: false });
  try {
    const sa = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT || '{}');
    if (!sa.private_key) return res.status(500).json({ ok: false, error: 'FIREBASE_SERVICE_ACCOUNT missing' });
    let body = req.body; if (typeof body === 'string') { try { body = JSON.parse(body); } catch (e) { body = {}; } }
    body = body || {};
    const tok = await accessToken(sa);
    let id, title, text, data = {};

    if (body.test) {
      const last = await rtdb(tok, 'GET', 'push_log/_test');
      if (last && Date.now() - last < 15000) return res.status(200).json({ ok: true, skipped: 'wait' });
      await rtdb(tok, 'PUT', 'push_log/_test', Date.now());
      id = 'TEST'; title = '🔔 Test alert'; text = 'GoMandi order alert chal raha hai ✓'; data = { total: '0', name: 'Test', n: '0' };
    } else {
      id = String(body.orderId || '');
      if (!/^[A-Za-z0-9_-]{3,40}$/.test(id)) return res.status(400).json({ ok: false, error: 'bad id' });
      const order = await rtdb(tok, 'GET', 'orders/' + id);
      if (!order) return res.status(404).json({ ok: false, error: 'no order' });
      const ts = Number(order.timestamp || order.createdAt || 0);
      if (ts && Date.now() - ts > 15 * 60000) return res.status(200).json({ ok: true, skipped: 'old' });
      if (String(order.orderStatus || '') === 'Cancelled') return res.status(200).json({ ok: true, skipped: 'cancelled' });
      if (await rtdb(tok, 'GET', 'push_log/' + id)) return res.status(200).json({ ok: true, skipped: 'dup' });
      await rtdb(tok, 'PUT', 'push_log/' + id, Date.now());
      const b = order.billBreakdown || {};
      const total = Number(b.grandTotal != null ? b.grandTotal : (order.totalAmount || order.total || 0));
      const items = Array.isArray(order.items) ? order.items : Object.values(order.items || {});
      title = '🛒 NAYA ORDER #' + id;
      text = (order.receiverName || order.customerName || 'Customer') + ' • ₹' + Math.round(total) + ' • ' + items.length + ' items';
      data = { total: String(total), name: String(order.receiverName || order.customerName || 'Customer'), n: String(items.length) };
    }

    const tokens = (await rtdb(tok, 'GET', 'admin_ui/pushTokens')) || {};
    let sent = 0, dead = 0;
    await Promise.all(Object.keys(tokens).map(async (k) => {
      const t = tokens[k] || {}; if (!t.token) return;
      const r = await fetch('https://fcm.googleapis.com/v1/projects/' + sa.project_id + '/messages:send', {
        method: 'POST', headers: { Authorization: 'Bearer ' + tok, 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: {
          token: t.token,
          data: Object.assign({ type: 'order', orderId: id, title, body: text, url: t.url || '' }, data),
          android: { priority: 'HIGH', ttl: '120s' },
          webpush: { headers: { Urgency: 'high', TTL: '120' } }
        } })
      });
      if (r.ok) sent++;
      else { const j = await r.json().catch(() => ({})); const s = JSON.stringify(j); if (/UNREGISTERED|NOT_FOUND|INVALID_ARGUMENT/.test(s)) { dead++; await rtdb(tok, 'DELETE', 'admin_ui/pushTokens/' + k); } }
    }));
    return res.status(200).json({ ok: true, sent, dead, devices: Object.keys(tokens).length });
  } catch (e) {
    return res.status(500).json({ ok: false, error: String(e && e.message || e).slice(0, 200) });
  }
};
