// Vercel serverless function (free). No npm packages needed.
// Speech -> text for GoMandi voice assistant. The Groq key stays HERE (never in index.html).
// Env var (Vercel -> Project -> Settings -> Environment Variables):
//   GROQ_API_KEY = gsk_...   (free key from console.groq.com)
// Optional: GROQ_STT_MODEL (default whisper-large-v3-turbo)

const MODEL = process.env.GROQ_STT_MODEL || 'whisper-large-v3-turbo';
const MAX_BYTES = 1500000; // ~45s of 16k mono wav, far above what we send
const hits = new Map();    // tiny per-instance rate limit (ip -> [timestamps])

function cors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = []; let n = 0;
    req.on('data', c => { n += c.length; if (n > MAX_BYTES) { reject(new Error('too_big')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function limited(ip) {
  const now = Date.now();
  const a = (hits.get(ip) || []).filter(t => now - t < 60000);
  a.push(now); hits.set(ip, a);
  if (hits.size > 500) { for (const [k, v] of hits) if (!v.length || now - v[v.length - 1] > 60000) hits.delete(k); }
  return a.length > 30; // max 30 requests / minute / user
}

module.exports = async (req, res) => {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'POST only' });
  const key = process.env.GROQ_API_KEY;
  if (!key) return res.status(200).json({ ok: false, error: 'no_key' });
  const ip = String(req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim();
  if (limited(ip)) return res.status(200).json({ ok: false, error: 'slow_down' });
  try {
    const buf = await readBody(req);
    // JSON body = AI "brain" request (text understanding), otherwise audio = speech-to-text
    if (/json/i.test(String(req.headers['content-type'] || ''))) {
      let o = {}; try { o = JSON.parse(buf.toString('utf8')); } catch (e) {}
      const b = o && o.body;
      if (!o.ai || !b || !Array.isArray(b.messages)) return res.status(200).json({ ok: false, error: 'bad_request' });
      const r2 = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: { Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: 'llama-3.1-8b-instant', messages: b.messages.slice(0, 4), temperature: 0.1, max_tokens: 220, response_format: { type: 'json_object' } })
      });
      if (r2.status === 429) return res.status(200).json({ ok: false, error: 'quota' });
      if (!r2.ok) return res.status(200).json({ ok: false, error: 'ai_' + r2.status });
      const j2 = await r2.json();
      const content = j2 && j2.choices && j2.choices[0] && j2.choices[0].message && j2.choices[0].message.content;
      return res.status(200).json({ ok: true, content: content || '' });
    }
    if (buf.length < 2000) return res.status(200).json({ ok: true, text: '', empty: true });
    const ct = String(req.headers['content-type'] || 'audio/wav');
    const ext = /webm/.test(ct) ? 'webm' : /ogg/.test(ct) ? 'ogg' : /mp4|m4a|aac/.test(ct) ? 'm4a' : 'wav';
    const fd = new FormData();
    fd.append('file', new Blob([buf], { type: ct.split(';')[0] }), 'voice.' + ext);
    fd.append('model', MODEL);
    fd.append('response_format', 'verbose_json');
    fd.append('temperature', '0');
    const lm = String(req.url || '').match(/[?&]lang=(en|hi|bn|ur)\b/);
    if (lm) fd.append('language', lm[1]);
    // Vocabulary hint: helps Whisper spell our brand + grocery words correctly
    fd.append('prompt', 'GoMandi grocery app. Aalu, pyaz, tamatar, doodh, atta, chawal, cart, checkout, cash on delivery, online payment, search karo, dikhao.');
    const r = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', {
      method: 'POST', headers: { Authorization: 'Bearer ' + key }, body: fd
    });
    if (r.status === 429) return res.status(200).json({ ok: false, error: 'quota' });
    if (!r.ok) {
      const t = await r.text();
      return res.status(200).json({ ok: false, error: 'stt_' + r.status, detail: t.slice(0, 160) });
    }
    const j = await r.json();
    // Whisper "hallucinates" text on pure noise; drop segments that look like silence/noise.
    const segs = Array.isArray(j.segments) ? j.segments : [];
    let text = String(j.text || '').trim();
    if (segs.length) {
      const good = segs.filter(s => !(s.no_speech_prob > 0.6 || s.avg_logprob < -1.2));
      text = good.map(s => s.text).join(' ').trim();
    }
    return res.status(200).json({ ok: true, text, lang: j.language || '' });
  } catch (e) {
    return res.status(200).json({ ok: false, error: String(e && e.message || e).slice(0, 120) });
  }
};
