// בדיקות מקצה לקצה עם אתר מקומי ומודל מדומה (בלי קריאות API אמיתיות).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { collectEvidence, evidenceToText } from '../src/collect.js';
import { runAudit } from '../src/pipeline.js';
import { renderReport } from '../src/report.js';
import * as P from '../src/prompts.js';
import { ALL_AGENTS, DEPARTMENTS } from '../src/config.js';
import { overallScore, rankFindings } from '../src/scoring.js';

const HOME = `<!doctype html><html lang="he" dir="rtl"><head><title>חנות בדיקה</title>
<meta name="viewport" content="width=device-width"></head><body>
<!-- TODO: remove before launch -->
<h1>החנות שלנו</h1><a href="/pricing">מחירים</a><a href="/missing">קישור שבור</a><a href="/contact">צור קשר</a>
<img src="/a.jpg"><form><input type="email" name="email"><button>שלח</button></form>
<script>var k="AIzaSyA1234567890abcdefghijklmnopqrstuv";</script></body></html>`;

let server, base;
before(async () => {
  server = http.createServer((req, res) => {
    if (req.url === '/') return res.writeHead(200, { 'content-type': 'text/html' }).end(HOME);
    if (req.url === '/pricing' || req.url === '/contact') return res.writeHead(200, { 'content-type': 'text/html' }).end(`<html><head><title>${req.url}</title></head><body><h1>עמוד</h1><p>99 ₪ לחודש</p></body></html>`);
    res.writeHead(404, { 'content-type': 'text/html' }).end('<title>404</title>');
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}/`;
});
after(() => server.close());

test('איסוף ראיות פסיבי מזהה קישורים שבורים, סודות מוסתרים ושאריות פיתוח', async () => {
  const ev = await collectEvidence(base);
  assert.equal(ev.pages[0].id, 'P1');
  assert.ok(ev.pages.length >= 2, 'נטענו עמודים פנימיים');
  const a = ev.pages[0].analysis;
  assert.equal(a.lang, 'he');
  assert.equal(a.images.missingAlt, 1);
  assert.equal(a.forms[0].fields[0].hasLabel, false);
  assert.ok(a.htmlComments.some(c => c.includes('TODO')));
  assert.ok(a.possibleSecrets.some(s => s.type === 'Google API key' && !s.masked.includes('1234567890abcdef')), 'המפתח מוסתר');
  assert.ok(ev.site.linkCheck.broken.some(b => b.url.endsWith('/missing')));
  assert.equal(ev.site.notFound.status, 404);
  const text = evidenceToText(ev);
  assert.match(text, /עמוד P1/);
});

function fakeModel() {
  const calls = [];
  const callJSON = async ({ schema, content }) => {
    const task = content.at(-1).text;
    calls.push(schema);
    if (schema === P.STAGE0_SCHEMA) {
      return { data: {
        product_summary: 'חנות בדיקה', checked: ['P1'], missing: ['צילומי מסך'],
        coverage: ALL_AGENTS.map(a => ({ agent_id: a.id, level: a.id === 'PERF-A' ? 'no' : 'partial', note: 'בדיקה' })),
        prompt_injection_detected: '',
      } };
    }
    if (schema === P.SUBAGENT_SCHEMA) {
      const id = task.match(/תת-סוכן (\S+)/)[1];
      if (id.endsWith('-D')) return { data: { status: 'none', checked: 'P1', missing: '', findings: [] } };
      return { data: { status: 'findings', checked: 'P1', missing: '', findings: [{
        finding: `ממצא של ${id}`, evidence: 'P1 ' + base, certainty: id.startsWith('SEC') ? 'verified' : 'likely',
        severity: id.startsWith('TECH') ? 'critical' : 'medium', impact: 'השפעה', recommendation: 'המלצה ספציפית', effort: 'S', verify_how: 'לפתוח את P1',
      }] } };
    }
    if (schema === P.SUPERVISOR_SCHEMA) {
      const raw = JSON.parse(task.split('# ממצאים גולמיים\n')[1]);
      const all = raw.flatMap(a => a.findings);
      return { data: { rated: true, score: 70, score_rationale: 'שני משפטים. בדיוק.', kept: all.map(f => ({ ...f, merged_from: [], severity_change: '' })), removed: [], top3: all.slice(0, 3).map(f => f.id) } };
    }
    if (schema === P.MERGE_SCHEMA) {
      const approved = JSON.parse(task.split('# ממצאים מאושרים מכל המחלקות\n')[1]);
      // משמיטים ממצא אחד בכוונה כדי לבדוק שרשת הביטחון מחזירה אותו
      return { data: { findings: approved.slice(1).map(f => ({ ...f, source_ids: [f.id], departments: [f.dept], cost_why: 'עולה כסף' })), patterns: [{ title: 'דפוס', description: 'תיאור', departments: ['TECH', 'UX'], source_ids: [approved[1].id] }] } };
    }
    if (schema === P.REPORT_SCHEMA) {
      return { data: {
        executive_summary: { overall_state: 'מצב', top3_costly: [{ finding_id: 'F-01', why: 'כי' }, { finding_id: 'F-99', why: 'לא קיים' }], first_move: 'לתקן' },
        top5: ['F-01', 'F-02', 'F-03', 'F-04', 'F-05'].map(id => ({ finding_id: id, what_happens: 'א', why_costs_money: 'ב', what_to_do: 'ג' })),
        action_plan: { d30: [{ action: 'פעולה', finding_ids: ['F-01'] }], d60: [], d90: [] },
        not_checked: [{ area: 'מהירות', why: 'אין נתונים', what_enables: 'Lighthouse' }],
        client_questions: ['מה המטרה?'],
      } };
    }
    throw new Error('סכמה לא צפויה');
  };
  return { callJSON, calls };
}

test('הצנרת המלאה: מיפוי, תתי-סוכנים, מפקחים, מתאם ורשימת אימות', async () => {
  const { callJSON, calls } = fakeModel();
  const events = [];
  const audit = { id: 'x', createdAt: new Date().toISOString(), client: { name: 'חנות בדיקה', oneLiner: 'חנות', url: base }, weights: { BIZ: 0 } };
  const result = await runAudit(audit, { callJSON, emit: e => events.push(e) });

  // PERF-A סומן "no" ולא הופעל
  assert.equal(result.raw['PERF-A'].status, 'not_checked');
  assert.equal(calls.filter(s => s === P.SUBAGENT_SCHEMA).length, ALL_AGENTS.length - 1);
  assert.equal(calls.filter(s => s === P.SUPERVISOR_SCHEMA).length, DEPARTMENTS.length);

  // כל ממצא מאושר נשמר, כולל זה שהמתאם השמיט
  const approvedCount = DEPARTMENTS.reduce((n, d) => n + result.departments[d.id].kept.length, 0);
  assert.equal(result.findings.length, approvedCount);

  // דירוג: קריטי קודם
  assert.equal(result.findings[0].severity, 'critical');
  assert.deepEqual(result.findings.map(f => f.id).slice(0, 2), ['F-01', 'F-02']);

  // מזהה שלא קיים סונן מהתקציר
  assert.equal(result.narrative.executive_summary.top3_costly.length, 1);

  // BIZ במשקל 0 לא נכנס לציון
  assert.ok(result.overall.excluded.includes('BIZ'));
  assert.equal(result.overall.score, 70);

  // רשימת אימות = כל מה שלא מאומת
  assert.equal(result.verification.length, result.findings.filter(f => f.certainty !== 'verified').length);
  assert.ok(result.quickWins.length > 0);
  assert.ok(result.patterns[0].finding_ids.length === 1);
  assert.ok(events.some(e => e.type === 'stage' && e.stage === 'done'));

  const internal = renderReport({ ...audit, result }, 'internal');
  const client = renderReport({ ...audit, result }, 'client');
  for (let i = 1; i <= 9; i++) assert.match(client, new RegExp(`<h2>${i}\\. `));
  assert.match(internal, /<h2>10\. /);
  assert.doesNotMatch(client, /<h2>10\. /);
});

test('ציון כולל מחלק מחדש משקל של מחלקה שלא דורגה', () => {
  const r = { TECH: { rated: true, score: 80 }, UX: { rated: true, score: 60 }, PERF: { rated: false }, SEC: { rated: true, score: 50 }, CONV: { rated: true, score: 40 }, BIZ: { rated: true, score: 90 } };
  const o = overallScore(r, { TECH: 20, UX: 20, PERF: 10, SEC: 15, CONV: 20, BIZ: 15 });
  assert.equal(o.score, Math.round((80 * 20 + 60 * 20 + 50 * 15 + 40 * 20 + 90 * 15) / 90));
  assert.deepEqual(o.excluded, ['PERF']);
});

test('עדיפות: חומרה גבוהה ומאמץ נמוך קודם', () => {
  const base = { certainty: 'verified', departments: [] };
  const ranked = rankFindings([
    { ...base, severity: 'high', effort: 'L', t: 'a' },
    { ...base, severity: 'critical', effort: 'L', t: 'b' },
    { ...base, severity: 'high', effort: 'S', t: 'c' },
  ]);
  assert.deepEqual(ranked.map(f => f.t), ['b', 'c', 'a']);
});
