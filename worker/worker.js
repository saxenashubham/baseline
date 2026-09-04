/**
 * Cloudflare Worker — the only place the Anthropic key exists.
 *
 * Same shape as the Receipt360 proxy: a thin pass-through with an allowlisted
 * origin, no logging of image bytes, and a hard cap on request size.
 *
 * Deploy:
 *   wrangler secret put ANTHROPIC_API_KEY
 *   wrangler deploy
 *
 * wrangler.toml:
 *   name = "baseline-proxy"
 *   main = "worker.js"
 *   compatibility_date = "2026-01-01"
 *   [vars]
 *   ALLOWED_ORIGIN = "https://<you>.github.io"
 *   MODEL = "claude-sonnet-5"
 */

const MAX_BODY = 8 * 1024 * 1024; // 8 MB — a downscaled JPEG is well under this

export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin') || '';
    const allowed = env.ALLOWED_ORIGIN || '*';
    const cors = {
      'Access-Control-Allow-Origin': allowed === '*' ? '*' : (origin === allowed ? origin : allowed),
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Access-Control-Max-Age': '86400'
    };

    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    if (request.method !== 'POST') return json({ error: 'POST only' }, 405, cors);
    if (allowed !== '*' && origin && origin !== allowed) return json({ error: 'Origin not allowed' }, 403, cors);

    const length = Number(request.headers.get('Content-Length') || 0);
    if (length > MAX_BODY) return json({ error: 'Payload too large' }, 413, cors);

    const path = new URL(request.url).pathname.replace(/\/$/, '');
    let body;
    try {
      body = await request.json();
    } catch {
      return json({ error: 'Invalid JSON' }, 400, cors);
    }

    let messages;
    let maxTokens = 1200;

    if (path.endsWith('/vision')) {
      const image = body.image || {};
      if (!image.base64) return json({ error: 'No image supplied' }, 400, cors);
      messages = [{
        role: 'user',
        content: [
          {
            type: 'image',
            source: { type: 'base64', media_type: image.mediaType || 'image/jpeg', data: image.base64 }
          },
          { type: 'text', text: body.hints ? `Context: ${body.hints}` : 'Estimate this meal.' }
        ]
      }];
    } else if (path.endsWith('/refine')) {
      messages = [{
        role: 'user',
        content: JSON.stringify({ items: body.items || [], answers: body.answers || {} })
      }];
    } else if (path.endsWith('/coach')) {
      maxTokens = 900;
      messages = [{ role: 'user', content: JSON.stringify(body.payload || {}) }];
    } else {
      return json({ error: 'Unknown route' }, 404, cors);
    }

    const upstream = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: env.MODEL || 'claude-sonnet-5',
        max_tokens: maxTokens,
        system: body.system || '',
        messages
      })
    });

    if (!upstream.ok) {
      const detail = await upstream.text().catch(() => '');
      return json({ error: 'Upstream error', status: upstream.status, detail: detail.slice(0, 300) }, 502, cors);
    }

    const data = await upstream.json();
    const text = (data.content || [])
      .filter((block) => block.type === 'text')
      .map((block) => block.text)
      .join('\n');

    return json({ text, usage: data.usage || null }, 200, cors);
  }
};

function json(payload, status, cors) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json', ...cors }
  });
}
