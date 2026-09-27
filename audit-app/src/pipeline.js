// הצנרת המלאה: שלב 0 (מיפוי) ← שלב 1 (תתי-סוכנים) ← שלב 2 (מפקחים) ← שלב 3 (מתאם) ← שלב 4 (רשימת אימות).
import { DEPARTMENTS, ALL_AGENTS, CLIENT_FIELDS, CONCURRENCY, EFFORT_SUBAGENT, EFFORT_SUPERVISOR, EFFORT_COORDINATOR } from './config.js';
import { collectEvidence, evidenceToText, isAppStoreUrl, normalizeUrl } from './collect.js';
import * as P from './prompts.js';
import { effectiveWeights, overallScore, rankFindings, quickWins, verificationList } from './scoring.js';

async function pool(items, n, fn) {
  const out = new Array(items.length);
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (i < items.length) { const k = i++; out[k] = await fn(items[k], k); }
  }));
  return out;
}

function clientBlock(client) {
  const lines = CLIENT_FIELDS.map(f => `- ${f.label}: ${client[f.key]?.toString().trim() || '[לא סופק]'}`);
  return `# פרטי הלקוח\n${lines.join('\n')}`;
}

export function buildPack({ client, evidence, materials = {}, competitorResearch }) {
  const blocks = [{ type: 'text', text: clientBlock(client) }];
  blocks.push({ type: 'text', text: evidenceToText(evidence) });
  (materials.files || []).forEach((f, i) => {
    blocks.push({ type: 'text', text: `# קובץ F${i + 1}: ${f.name}\n\`\`\`\n${f.text}\n\`\`\`` });
  });
  if (materials.analytics?.trim()) blocks.push({ type: 'text', text: `# נתוני אנליטיקס שהלקוח סיפק\n${materials.analytics.trim()}` });
  if (competitorResearch) {
    blocks.push({ type: 'text', text: `# מחקר מתחרים (חיפוש ברשת, עם מקורות)\n${competitorResearch.text}\n\nמקורות:\n${competitorResearch.sources.join('\n')}` });
  }
  (materials.screenshots || []).forEach((s, i) => {
    blocks.push({ type: 'text', text: `צילום מסך S${i + 1}: ${s.name}${s.caption ? ` (${s.caption})` : ''}` });
    blocks.push({ type: 'image', source: { type: 'base64', media_type: s.mediaType, data: s.data } });
  });
  blocks.push({ type: 'text', text: '# סוף תיק החומרים', cache_control: { type: 'ephemeral' } });
  return blocks;
}

function withTask(pack, text) {
  return [...pack, { type: 'text', text }];
}

// ערכים חוקיים וברירת מחדל שמרנית למקרה של ערך לא צפוי
const VALID = {
  certainty: [['verified', 'likely', 'hypothesis'], 'hypothesis'],
  severity: [['critical', 'high', 'medium', 'low'], 'medium'],
  effort: [['S', 'M', 'L'], 'M'],
};
function cleanFinding(f) {
  const out = { ...f };
  for (const [k, [vals, def]] of Object.entries(VALID)) if (!vals.includes(out[k])) out[k] = def;
  for (const k of ['finding', 'evidence', 'impact', 'recommendation', 'verify_how']) out[k] = String(out[k] ?? '').trim();
  return out;
}

export async function runAudit(audit, deps) {
  const { callJSON, callResearch, collect = collectEvidence, emit = () => {} } = deps;
  const { client, materials = {} } = audit;
  const weights = effectiveWeights(audit.weights);
  const log = text => emit({ type: 'log', text });
  const usage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, calls: 0 };
  const track = u => {
    if (!u) return;
    usage.calls++;
    usage.input += u.input_tokens || 0;
    usage.output += u.output_tokens || 0;
    usage.cacheRead += u.cache_read_input_tokens || 0;
    usage.cacheWrite += u.cache_creation_input_tokens || 0;
  };
  const call = async args => { const r = await callJSON({ system: P.CORE_RULES, ...args }); track(r.usage); return r.data; };

  // ─── איסוף ───
  emit({ type: 'stage', stage: 'collect', label: 'איסוף ראיות פסיבי' });
  let evidence = null;
  const url = normalizeUrl(client.url);
  if (url && !isAppStoreUrl(url)) {
    evidence = await collect(url, log);
  } else {
    log(url ? 'קישור לחנות אפליקציות: לא מבוצע איסוף מהרשת, הביקורת נשענת על החומרים שצורפו.' : 'לא סופקה כתובת: הביקורת נשענת על החומרים שצורפו בלבד.');
  }

  let competitorResearch = null;
  if (client.competitors?.trim() && callResearch) {
    log('מחקר מתחרים ברשת (עבור BIZ-B)');
    try {
      const r = await callResearch({
        system: P.COMPETITOR_SYSTEM,
        prompt: `המוצר: ${client.name}. ${client.oneLiner || ''}\nקהל יעד: ${client.audience || 'לא צוין'}\nמתחרים: ${client.competitors}\n\nלכל מתחרה: הצעת ערך, מחירים וחבילות (אם פומביים), בידול מרכזי, וכתובות המקור.`,
      });
      track(r.usage);
      competitorResearch = r;
    } catch (e) {
      log(`מחקר המתחרים נכשל: ${e.message}`);
    }
  }

  const pack = buildPack({ client, evidence, materials, competitorResearch });

  // ─── שלב 0 ───
  emit({ type: 'stage', stage: 'stage0', label: 'שלב 0: מיפוי (סוכן מתאם)' });
  const mapping = await call({ content: withTask(pack, P.stage0Instructions()), schema: P.STAGE0_SCHEMA, effort: EFFORT_COORDINATOR });
  const coverage = Object.fromEntries(ALL_AGENTS.map(a => [a.id, { level: 'partial', note: 'לא הוחזר ממיפוי; הופעל כברירת מחדל' }]));
  for (const c of mapping.coverage || []) if (coverage[c.agent_id]) coverage[c.agent_id] = { level: c.level, note: c.note };
  mapping.coverage = ALL_AGENTS.map(a => ({ agent_id: a.id, agent_name: a.name, dept: a.dept, ...coverage[a.id] }));
  emit({ type: 'mapping', mapping });

  // ─── שלב 1 ───
  emit({ type: 'stage', stage: 'stage1', label: `שלב 1: ${ALL_AGENTS.length} תתי-סוכנים` });
  const raw = {};
  await pool(ALL_AGENTS, CONCURRENCY, async agent => {
    const cov = coverage[agent.id];
    if (cov.level === 'no') {
      raw[agent.id] = { status: 'not_checked', checked: '', missing: cov.note, findings: [] };
      emit({ type: 'agent', id: agent.id, status: 'not_checked' });
      return;
    }
    emit({ type: 'agent', id: agent.id, status: 'running' });
    try {
      const r = await call({ content: withTask(pack, P.subagentInstructions(agent, cov)), schema: P.SUBAGENT_SCHEMA, effort: EFFORT_SUBAGENT, maxTokens: 24000 });
      r.findings = (r.findings || []).map((f, i) => ({ ...cleanFinding(f), id: `${agent.id}-${i + 1}`, agent: agent.id, dept: agent.dept }));
      if (r.findings.length && r.status !== 'findings') r.status = 'findings';
      raw[agent.id] = r;
      emit({ type: 'agent', id: agent.id, status: r.status, count: r.findings.length });
    } catch (e) {
      raw[agent.id] = { status: 'not_checked', checked: '', missing: `הסוכן נכשל בזמן הריצה: ${e.message}`, findings: [], error: true };
      emit({ type: 'agent', id: agent.id, status: 'error', error: e.message });
    }
  });

  // ─── שלב 2 ───
  emit({ type: 'stage', stage: 'stage2', label: 'שלב 2: סוכני מפקח' });
  const departments = {};
  await pool(DEPARTMENTS, CONCURRENCY, async dept => {
    const agents = dept.agents.map(a => ({ id: a.id, name: a.name, ...raw[a.id] }));
    const rawFindings = agents.flatMap(a => a.findings);
    const allUnchecked = agents.every(a => a.status === 'not_checked');
    emit({ type: 'dept', id: dept.id, status: 'running' });
    if (allUnchecked) {
      departments[dept.id] = { rated: false, score: 0, score_rationale: 'אף תת-סוכן במחלקה לא קיבל חומר לבדיקה, ולכן המחלקה לא דורגה.', kept: [], removed: [], top3: [], agents };
      emit({ type: 'dept', id: dept.id, status: 'done', rated: false });
      return;
    }
    const input = JSON.stringify(agents.map(a => ({ agent: a.id, name: a.name, status: a.status, checked: a.checked, missing: a.missing, findings: a.findings.map(({ agent, dept: _d, ...f }) => f) })), null, 1);
    try {
      const r = await call({ content: withTask(pack, `${P.supervisorInstructions(dept)}\n\n# ממצאים גולמיים\n${input}`), schema: P.SUPERVISOR_SCHEMA, effort: EFFORT_SUPERVISOR });
      const known = new Set(rawFindings.map(f => f.id));
      r.kept = (r.kept || []).filter(f => known.has(f.id) || (f.merged_from || []).some(id => known.has(id))).map(f => ({ ...cleanFinding(f), dept: dept.id }));
      // ממצא שהמפקח לא שמר וגם לא מחק במפורש, נשמר כמו שהוא כדי שלא ילך לאיבוד
      const handled = new Set([...r.kept.flatMap(f => [f.id, ...(f.merged_from || [])]), ...(r.removed || []).map(x => x.id)]);
      for (const f of rawFindings) if (!handled.has(f.id)) r.kept.push({ ...f, merged_from: [], severity_change: '', note: 'לא טופל במפורש על ידי המפקח' });
      r.score = Math.max(0, Math.min(100, Math.round(r.score || 0)));
      r.top3 = (r.top3 || []).filter(id => r.kept.some(f => f.id === id)).slice(0, 3);
      departments[dept.id] = { ...r, agents };
      emit({ type: 'dept', id: dept.id, status: 'done', rated: r.rated, score: r.score });
    } catch (e) {
      departments[dept.id] = { rated: false, score: 0, score_rationale: `המפקח נכשל: ${e.message}. הממצאים הגולמיים הועברו כמו שהם.`, kept: rawFindings, removed: [], top3: [], agents, error: true };
      emit({ type: 'dept', id: dept.id, status: 'error', error: e.message });
    }
  });

  // ─── שלב 3 ───
  emit({ type: 'stage', stage: 'stage3', label: 'שלב 3: סוכן מתאם ראשי' });
  const approved = DEPARTMENTS.flatMap(d => departments[d.id].kept.map(f => ({ ...f, dept: d.id })));
  let merged = { findings: [], patterns: [] };
  if (approved.length) {
    const input = JSON.stringify(approved.map(({ agent, ...f }) => f), null, 1);
    merged = await call({ content: [{ type: 'text', text: `${P.mergeInstructions()}\n\n# ממצאים מאושרים מכל המחלקות\n${input}` }], schema: P.MERGE_SCHEMA, effort: EFFORT_COORDINATOR });
    const covered = new Set(merged.findings.flatMap(f => f.source_ids || []));
    for (const f of approved) {
      if (!covered.has(f.id)) merged.findings.push({ ...f, source_ids: [f.id], departments: [f.dept], cost_why: f.impact });
    }
  }
  const deptOf = Object.fromEntries(approved.map(f => [f.id, f.dept]));
  const findings = rankFindings(merged.findings.map(f => {
    const source_ids = f.source_ids || [];
    const departments = [...new Set([...(f.departments || []), ...source_ids.map(s => deptOf[s]).filter(Boolean)])];
    return { ...cleanFinding(f), source_ids, departments, cost_why: f.cost_why || '' };
  }));
  const sourceToF = {};
  for (const f of findings) for (const s of f.source_ids) sourceToF[s] ||= f.id;
  const patterns = (merged.patterns || []).map(p => ({ ...p, finding_ids: [...new Set((p.source_ids || []).map(s => sourceToF[s]).filter(Boolean))] }));

  for (const d of DEPARTMENTS) {
    const dep = departments[d.id];
    dep.findingIds = [...new Set(dep.kept.flatMap(f => [f.id, ...(f.merged_from || [])]).map(s => sourceToF[s]).filter(Boolean))];
    dep.top3Ids = [...new Set(dep.top3.map(s => sourceToF[s]).filter(Boolean))];
  }
  const overall = overallScore(departments, weights);

  const notChecked = ALL_AGENTS.filter(a => raw[a.id].status === 'not_checked').map(a => ({ agent: a.id, name: a.name, missing: raw[a.id].missing }));
  const reportInput = {
    client: clientBlock(client),
    overall_score: overall.score,
    departments: DEPARTMENTS.map(d => ({ id: d.id, name: d.name, weight: weights[d.id], rated: departments[d.id].rated, score: departments[d.id].score, rationale: departments[d.id].score_rationale })),
    findings: findings.map(({ source_ids, ...f }) => f),
    patterns,
    not_checked_agents: notChecked,
    mapping_missing: mapping.missing,
  };
  const narrative = await call({ content: [{ type: 'text', text: `${P.reportInstructions()}\n\n# נתונים\n${JSON.stringify(reportInput, null, 1)}` }], schema: P.REPORT_SCHEMA, effort: EFFORT_COORDINATOR });
  const validIds = new Set(findings.map(f => f.id));
  narrative.top5 = (narrative.top5 || []).filter(t => validIds.has(t.finding_id)).slice(0, 5);
  narrative.executive_summary.top3_costly = (narrative.executive_summary.top3_costly || []).filter(t => validIds.has(t.finding_id)).slice(0, 3);

  // ─── שלב 4 ───
  emit({ type: 'stage', stage: 'stage4', label: 'שלב 4: רשימת אימות לבודק האנושי' });
  const verification = verificationList(findings);

  const result = {
    mapping,
    evidenceSummary: evidence ? { url: evidence.url, finalUrl: evidence.site.finalUrl, pages: evidence.pages.map(p => ({ id: p.id, url: p.url, status: p.status })), errors: evidence.errors } : null,
    competitorResearch: competitorResearch ? { text: competitorResearch.text, sources: competitorResearch.sources } : null,
    raw,
    departments,
    weights,
    overall,
    findings,
    patterns,
    quickWins: quickWins(findings).map(f => f.id),
    narrative,
    notChecked,
    verification,
    usage,
  };
  emit({ type: 'stage', stage: 'done', label: 'הביקורת הושלמה' });
  return result;
}
