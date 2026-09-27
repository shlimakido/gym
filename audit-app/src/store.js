// שמירת ביקורות כקבצי JSON בתיקיית data/. צילומי המסך נשמרים בקובץ נפרד כדי שהרשימה תישאר קלה.
import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

const DIR = path.resolve(process.env.AUDIT_DATA_DIR || 'data');

async function ensure() { await fs.mkdir(DIR, { recursive: true }); }
const file = (id, suffix = '') => {
  if (!/^[a-f0-9-]{36}$/.test(id)) throw new Error('מזהה לא תקין');
  return path.join(DIR, `${id}${suffix}.json`);
};

export async function createAudit(input) {
  await ensure();
  const id = randomUUID();
  const { materials = {}, ...rest } = input;
  const audit = {
    id, ...rest, status: 'queued', createdAt: new Date().toISOString(), progress: [],
    materialsInfo: { screenshots: (materials.screenshots || []).map(s => s.name), files: (materials.files || []).map(f => f.name), analytics: Boolean(materials.analytics?.trim()) },
  };
  await fs.writeFile(file(id, '.materials'), JSON.stringify(materials));
  await saveAudit(audit);
  return audit;
}

export async function saveAudit(audit) {
  await ensure();
  const tmp = file(audit.id) + '.tmp';
  await fs.writeFile(tmp, JSON.stringify(audit, null, 1));
  await fs.rename(tmp, file(audit.id));
}

export async function loadAudit(id) {
  try { return JSON.parse(await fs.readFile(file(id), 'utf8')); } catch { return null; }
}

export async function loadMaterials(id) {
  try { return JSON.parse(await fs.readFile(file(id, '.materials'), 'utf8')); } catch { return {}; }
}

export async function listAudits() {
  await ensure();
  const names = (await fs.readdir(DIR)).filter(n => /^[a-f0-9-]{36}\.json$/.test(n));
  const all = await Promise.all(names.map(n => loadAudit(n.slice(0, -5))));
  return all.filter(Boolean)
    .map(a => ({ id: a.id, name: a.client?.name, url: a.client?.url, status: a.status, createdAt: a.createdAt, score: a.result?.overall?.score ?? null }))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}
