// שרת HTTP קטן: מגיש את הממשק, מריץ ביקורות ברקע ומשדר התקדמות ב-SSE.
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runAudit } from './src/pipeline.js';
import { callJSON, callResearch } from './src/llm.js';
import { renderReport } from './src/report.js';
import { createAudit, saveAudit, loadAudit, loadMaterials, listAudits } from './src/store.js';
import { DEPARTMENTS, ALL_AGENTS, CLIENT_FIELDS, MODEL } from './src/config.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 3360);
const HOST = process.env.HOST || '127.0.0.1';
const MAX_BODY = 60 * 1024 * 1024;
const IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'];

const listeners = new Map(); // auditId -> Set(res)

function send(res, status, body, type = 'application/json; charset=utf-8', extra = {}) {
  res.writeHead(status, { 'content-type': type, 'cache-control': 'no-store', ...extra });
  res.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body));
}

async function readJson(req) {
  let size = 0;
  const chunks = [];
  for await (const c of req) {
    size += c.length;
    if (size > MAX_BODY) throw Object.assign(new Error('הבקשה גדולה מדי'), { status: 413 });
    chunks.push(c);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'); }
  catch { throw Object.assign(new Error('JSON לא תקין'), { status: 400 }); }
}

function validate(body) {
  const client = {};
  for (const f of CLIENT_FIELDS) client[f.key] = String(body.client?.[f.key] ?? '').slice(0, 2000).trim();
  if (!client.name) return { error: 'חסר שם העסק / המוצר' };
  if (!client.oneLiner) return { error: 'חסר תיאור המוצר במשפט' };

  const weights = {};
  for (const d of DEPARTMENTS) {
    const w = body.weights?.[d.id];
    if (w !== undefined && w !== null && w !== '') {
      const n = Number(w);
      if (!Number.isFinite(n) || n < 0 || n > 100) return { error: `משקל לא תקין למחלקה ${d.id}` };
      weights[d.id] = n;
    }
  }

  const m = body.materials || {};
  const screenshots = (m.screenshots || []).slice(0, 12);
  for (const s of screenshots) {
    if (!IMAGE_TYPES.includes(s.mediaType)) return { error: `סוג תמונה לא נתמך: ${s.name}` };
    if (typeof s.data !== 'string' || s.data.length > 7_000_000) return { error: `תמונה גדולה מדי (עד 5MB): ${s.name}` };
  }
  const files = (m.files || []).slice(0, 15);
  for (const f of files) if (typeof f.text !== 'string' || f.text.length > 300_000) return { error: `קובץ גדול מדי (עד 300KB): ${f.name}` };

  return {
    value: {
      client, weights,
      materials: {
        screenshots: screenshots.map(s => ({ name: String(s.name).slice(0, 200), caption: String(s.caption || '').slice(0, 300), mediaType: s.mediaType, data: s.data })),
        files: files.map(f => ({ name: String(f.name).slice(0, 200), text: f.text })),
        analytics: String(m.analytics || '').slice(0, 50_000),
      },
    },
  };
}

function broadcast(id, event) {
  for (const res of listeners.get(id) || []) res.write(`data: ${JSON.stringify(event)}\n\n`);
}

async function startAudit(audit) {
  const materials = await loadMaterials(audit.id);
  audit.status = 'running';
  audit.startedAt = new Date().toISOString();
  await saveAudit(audit);
  let saving = Promise.resolve();
  const emit = event => {
    audit.progress.push({ at: new Date().toISOString(), ...event });
    broadcast(audit.id, event);
    saving = saving.then(() => saveAudit(audit)).catch(() => {});
  };
  try {
    audit.result = await runAudit({ ...audit, materials }, { callJSON, callResearch, emit });
    audit.status = 'done';
  } catch (e) {
    audit.status = 'failed';
    audit.error = e.message;
    broadcast(audit.id, { type: 'error', text: e.message });
  }
  audit.finishedAt = new Date().toISOString();
  await saving;
  await saveAudit(audit);
  broadcast(audit.id, { type: 'status', status: audit.status });
}

async function serveStatic(res, rel) {
  const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml' };
  const p = path.normalize(path.join(here, 'public', rel === '/' ? 'index.html' : rel));
  if (!p.startsWith(path.join(here, 'public'))) return send(res, 403, { error: 'forbidden' });
  try { send(res, 200, await fs.readFile(p), types[path.extname(p)] || 'application/octet-stream'); }
  catch { send(res, 404, { error: 'not found' }); }
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const parts = url.pathname.split('/').filter(Boolean);
  try {
    if (parts[0] !== 'api') return await serveStatic(res, url.pathname);

    if (req.method === 'GET' && parts[1] === 'config') {
      return send(res, 200, { departments: DEPARTMENTS, agents: ALL_AGENTS, clientFields: CLIENT_FIELDS, model: MODEL });
    }
    if (parts[1] !== 'audits') return send(res, 404, { error: 'not found' });

    if (parts.length === 2 && req.method === 'GET') return send(res, 200, await listAudits());
    if (parts.length === 2 && req.method === 'POST') {
      const { error, value } = validate(await readJson(req));
      if (error) return send(res, 400, { error });
      const audit = await createAudit(value);
      startAudit(audit);
      return send(res, 201, { id: audit.id });
    }

    const audit = await loadAudit(parts[2]).catch(() => null);
    if (!audit) return send(res, 404, { error: 'הביקורת לא נמצאה' });

    if (parts.length === 3 && req.method === 'GET') return send(res, 200, audit);

    if (parts[3] === 'events' && req.method === 'GET') {
      res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store', connection: 'keep-alive' });
      for (const e of audit.progress) res.write(`data: ${JSON.stringify(e)}\n\n`);
      res.write(`data: ${JSON.stringify({ type: 'status', status: audit.status })}\n\n`);
      if (!listeners.has(audit.id)) listeners.set(audit.id, new Set());
      listeners.get(audit.id).add(res);
      req.on('close', () => listeners.get(audit.id)?.delete(res));
      return;
    }

    if (parts[3] === 'verify' && req.method === 'POST') {
      if (!audit.result) return send(res, 409, { error: 'הביקורת עוד לא הסתיימה' });
      const body = await readJson(req);
      const item = audit.result.verification.find(v => v.id === body.id);
      if (!item) return send(res, 404, { error: 'פריט לא נמצא' });
      if (typeof body.done === 'boolean') item.done = body.done;
      if (typeof body.note === 'string') item.note = body.note.slice(0, 1000);
      await saveAudit(audit);
      return send(res, 200, item);
    }

    if (parts[3] === 'report' && req.method === 'GET') {
      if (!audit.result) return send(res, 409, { error: 'הביקורת עוד לא הסתיימה' });
      const variant = url.searchParams.get('variant') === 'client' ? 'client' : 'internal';
      const open = audit.result.verification.filter(v => !v.done);
      if (variant === 'client' && open.length) {
        return send(res, 409, { error: `הדו"ח לא יוצא ללקוח לפני שרשימת האימות טופלה. נותרו ${open.length} פריטים פתוחים.` });
      }
      const html = renderReport(audit, variant);
      const extra = url.searchParams.get('download')
        ? { 'content-disposition': `attachment; filename*=UTF-8''${encodeURIComponent(`ביקורת-360-${audit.client.name}-${variant === 'client' ? 'לקוח' : 'פנימי'}.html`)}` }
        : {};
      return send(res, 200, html, 'text/html; charset=utf-8', extra);
    }

    return send(res, 404, { error: 'not found' });
  } catch (e) {
    send(res, e.status || 500, { error: e.message });
  }
});

// ביקורות שנקטעו בגלל הפעלה מחדש של השרת מסומנות ככאלה
for (const a of await listAudits()) {
  if (a.status === 'running' || a.status === 'queued') {
    const full = await loadAudit(a.id);
    full.status = 'failed';
    full.error = 'השרת הופעל מחדש באמצע הריצה. יש להריץ את הביקורת שוב.';
    await saveAudit(full);
  }
}

server.listen(PORT, HOST, () => {
  console.log(`ביקורת 360° רצה בכתובת http://${HOST}:${PORT} (מודל: ${MODEL})`);
});
