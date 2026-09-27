// בניית הדו"ח הסופי כ-HTML עצמאי (RTL), בשתי גרסאות:
// internal – כולל סעיף 10 (רשימת אימות), client – בלעדיו, ויוצא רק אחרי שהרשימה טופלה.
import { DEPARTMENTS, SEVERITY, CERTAINTY, COVERAGE } from './config.js';

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const sev = k => `<span class="sev sev-${k}">${SEVERITY[k].icon} ${SEVERITY[k].label}</span>`;
const cert = k => `<span class="cert">${CERTAINTY[k].icon} ${CERTAINTY[k].label}</span>`;
const deptName = id => DEPARTMENTS.find(d => d.id === id)?.name || id;

function findingRef(findings, id) {
  const f = findings.find(x => x.id === id);
  return f ? `<a href="#${esc(f.id)}">${esc(f.id)}</a>` : esc(id);
}

export function renderReport(audit, variant = 'internal') {
  const r = audit.result;
  const c = audit.client;
  const n = r.narrative;
  const F = r.findings;
  const byId = Object.fromEntries(F.map(f => [f.id, f]));
  const date = new Date(audit.finishedAt || audit.createdAt).toLocaleDateString('he-IL');
  const s = [];

  s.push(`<header class="cover"><div class="eyebrow">דו"ח ביקורת 360°</div><h1>${esc(c.name)}</h1>
    <p>${esc(c.oneLiner || '')}</p><p class="muted">${esc(c.url || '')} · ${esc(date)}${variant === 'internal' ? ' · <strong>גרסה פנימית</strong>' : ''}</p></header>`);

  // 1. תקציר מנהלים
  s.push(`<section><h2>1. תקציר מנהלים</h2>
    <p>${esc(n.executive_summary.overall_state)}</p>
    <p><strong>3 הבעיות הכי יקרות:</strong></p><ol>${n.executive_summary.top3_costly.map(t => `<li>${findingRef(F, t.finding_id)} ${esc(byId[t.finding_id]?.finding || '')}. ${esc(t.why)}</li>`).join('')}</ol>
    <p class="callout"><strong>המהלך הראשון:</strong> ${esc(n.executive_summary.first_move)}</p></section>`);

  // 2. טבלת ציונים
  const ov = r.overall;
  s.push(`<section><h2>2. טבלת ציונים</h2><div class="table-wrap"><table><thead><tr><th>מחלקה</th><th>ציון</th><th>משקל</th><th>משפט מסכם</th></tr></thead><tbody>
    ${DEPARTMENTS.map(d => { const x = r.departments[d.id]; return `<tr><td>${esc(d.name)} (${d.id})</td><td class="num">${x.rated ? x.score : 'לא דורג'}</td><td class="num">${r.weights[d.id]}%</td><td>${esc(x.score_rationale)}</td></tr>`; }).join('')}
    </tbody><tfoot><tr><td>ציון כולל</td><td class="num big">${ov.score ?? 'לא חושב'}</td><td colspan="2">${ov.excluded.length ? `ממוצע משוקלל של המחלקות שדורגו. לא נכללו: ${ov.excluded.map(deptName).map(esc).join(', ')}; המשקל שלהן חולק יחסית בין השאר.` : 'ממוצע משוקלל של כל המחלקות.'}</td></tr></tfoot></table></div></section>`);

  // 3. 5 הממצאים המובילים
  s.push(`<section><h2>3. 5 הממצאים המובילים</h2>${n.top5.map(t => { const f = byId[t.finding_id]; return `<article class="top"><h3>${findingRef(F, t.finding_id)} ${f ? sev(f.severity) : ''} ${esc(f?.finding || '')}</h3>
    <p><strong>מה קורה:</strong> ${esc(t.what_happens)}</p><p><strong>למה זה עולה כסף:</strong> ${esc(t.why_costs_money)}</p><p><strong>מה עושים:</strong> ${esc(t.what_to_do)}</p></article>`; }).join('') || '<p>אין ממצאים.</p>'}</section>`);

  // 4. ניצחונות מהירים
  const qw = r.quickWins.map(id => byId[id]).filter(Boolean);
  s.push(`<section><h2>4. ניצחונות מהירים</h2><p class="muted">ממצאים בחומרה בינונית ומעלה שאפשר לתקן בעד שעה (S).</p>
    ${qw.length ? `<ul>${qw.map(f => `<li>${findingRef(F, f.id)} ${sev(f.severity)} ${esc(f.recommendation)}</li>`).join('')}</ul>` : '<p>לא נמצאו ניצחונות מהירים.</p>'}</section>`);

  // 5. טבלת כל הממצאים
  s.push(`<section><h2>5. טבלת כל הממצאים</h2><div class="table-wrap"><table class="findings"><thead><tr><th>מזהה</th><th>מחלקה</th><th>ממצא</th><th>ראיה</th><th>ודאות</th><th>חומרה</th><th>המלצה</th><th>מאמץ</th></tr></thead><tbody>
    ${F.map(f => `<tr id="${esc(f.id)}"><td>${esc(f.id)}</td><td>${f.departments.map(esc).join(', ')}</td><td>${esc(f.finding)}</td><td class="ev">${esc(f.evidence)}</td><td>${cert(f.certainty)}</td><td>${sev(f.severity)}</td><td>${esc(f.recommendation)}</td><td>${esc(f.effort)}</td></tr>`).join('')}
    </tbody></table></div>
    ${r.patterns.length ? `<h3>דפוסים רוחביים</h3><ul>${r.patterns.map(p => `<li><strong>${esc(p.title)}</strong> (${p.departments.map(esc).join(', ')}): ${esc(p.description)} ${p.finding_ids.map(id => findingRef(F, id)).join(' ')}</li>`).join('')}</ul>` : ''}</section>`);

  // 6. פירוט לפי מחלקה
  s.push(`<section><h2>6. פירוט לפי מחלקה</h2>${DEPARTMENTS.map(d => { const x = r.departments[d.id]; return `<article class="dept"><h3>${esc(d.name)} (${d.id}) · ${x.rated ? `ציון ${x.score}` : 'לא דורג'} · משקל ${r.weights[d.id]}%</h3>
    <p>${esc(x.score_rationale)}</p>
    ${x.top3Ids?.length ? `<p><strong>3 החשובים:</strong> ${x.top3Ids.map(id => findingRef(F, id)).join(' ')}</p>` : ''}
    <ul class="agents">${d.agents.map(a => { const ra = r.raw[a.id]; const ids = F.filter(f => f.source_ids.some(sid => sid.startsWith(a.id + '-'))).map(f => f.id); return `<li><strong>${a.id} ${esc(a.name)}:</strong> ${ra.status === 'not_checked' ? `לא נבדק. ${esc(ra.missing)}` : ra.status === 'none' ? `לא נמצאו ממצאים. נבדק: ${esc(ra.checked)}` : `${ids.map(id => findingRef(F, id)).join(' ') || 'הממצאים נמחקו או אוחדו בשלב הפיקוח'}`}</li>`; }).join('')}</ul></article>`; }).join('')}</section>`);

  // 7. תוכנית פעולה
  const plan = (title, items) => `<div class="plan"><h3>${title}</h3><ul>${items.map(i => `<li>${esc(i.action)} ${i.finding_ids.map(id => findingRef(F, id)).join(' ')}</li>`).join('') || '<li>אין פעולות.</li>'}</ul></div>`;
  s.push(`<section><h2>7. תוכנית פעולה</h2><div class="plans">${plan('30 יום', n.action_plan.d30)}${plan('60 יום', n.action_plan.d60)}${plan('90 יום', n.action_plan.d90)}</div></section>`);

  // 8. מה לא נבדק
  s.push(`<section><h2>8. מה לא נבדק ולמה</h2><ul>${n.not_checked.map(x => `<li><strong>${esc(x.area)}:</strong> ${esc(x.why)} <em>מה יאפשר לבדוק: ${esc(x.what_enables)}</em></li>`).join('')}</ul>
    ${r.notChecked.length ? `<p class="muted">תתי-סוכנים שלא הופעלו: ${r.notChecked.map(x => esc(`${x.agent} ${x.name}`)).join(', ')}</p>` : ''}</section>`);

  // 9. שאלות ללקוח
  s.push(`<section><h2>9. שאלות ללקוח</h2><ol>${n.client_questions.map(q => `<li>${esc(q)}</li>`).join('')}</ol></section>`);

  // 10. רשימת אימות (פנימי)
  if (variant === 'internal') {
    s.push(`<section class="internal"><h2>10. רשימת אימות לבודק האנושי (פנימי, לא נשלח ללקוח)</h2>
      <p>הדו"ח לא יוצא ללקוח לפני שכל הפריטים סומנו כמטופלים.</p>
      <div class="table-wrap"><table><thead><tr><th>✓</th><th>ממצא</th><th>ודאות</th><th>איך לאמת תוך דקה</th><th>הערה</th></tr></thead><tbody>
      ${r.verification.map(v => `<tr><td>${v.done ? '✅' : '☐'}</td><td>${findingRef(F, v.finding_id)} ${esc(v.finding)}</td><td>${cert(v.certainty)}</td><td>${esc(v.how)}</td><td>${esc(v.note)}</td></tr>`).join('') || '<tr><td colspan="5">כל הממצאים מאומתים, אין פריטים לאימות.</td></tr>'}
      </tbody></table></div>
      <h3>נספח: שלב 0 (מיפוי)</h3><p>${esc(r.mapping.product_summary)}</p>
      <p><strong>נבדק בפועל:</strong> ${r.mapping.checked.map(esc).join(' · ')}</p>
      <p><strong>חסר:</strong> ${r.mapping.missing.map(esc).join(' · ')}</p>
      <div class="table-wrap"><table><thead><tr><th>תת-סוכן</th><th>חומר</th><th>הערה</th></tr></thead><tbody>${r.mapping.coverage.map(x => `<tr><td>${esc(x.agent_id)} ${esc(x.agent_name)}</td><td>${COVERAGE[x.level]}</td><td>${esc(x.note)}</td></tr>`).join('')}</tbody></table></div>
      ${r.mapping.prompt_injection_detected ? `<p class="callout">⚠️ זוהה בחומר טקסט שמנסה לתת הוראות לסוכנים: ${esc(r.mapping.prompt_injection_detected)}</p>` : ''}
      <p class="muted">שימוש במודל: ${r.usage.calls} קריאות · ${r.usage.input.toLocaleString()} טוקני קלט · ${r.usage.cacheRead.toLocaleString()} מהמטמון · ${r.usage.output.toLocaleString()} טוקני פלט</p>
      </section>`);
  }

  return `<!doctype html><html lang="he" dir="rtl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>ביקורת 360° · ${esc(c.name)}</title><style>${REPORT_CSS}</style></head><body><main class="report">${s.join('\n')}</main></body></html>`;
}

export const REPORT_CSS = `
:root{--bg:#f7f7f5;--card:#fff;--ink:#1b1b1f;--muted:#6b6b76;--line:#e4e4e0;--accent:#2f5bea;--crit:#c62828;--high:#e46a00;--med:#b88a00;--low:#7a7a85}
@media (prefers-color-scheme:dark){:root{--bg:#141417;--card:#1d1d22;--ink:#ececf1;--muted:#a0a0ab;--line:#2e2e36;--accent:#7c9cff}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:15px/1.65 system-ui,"Segoe UI",Arial,sans-serif}
.report{max-width:1100px;margin:0 auto;padding:24px 16px 64px}
.cover{padding:24px 0 8px;border-bottom:2px solid var(--ink);margin-bottom:24px}.cover h1{margin:4px 0;font-size:32px}.eyebrow{color:var(--accent);font-weight:700;letter-spacing:.04em}
section{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:18px 20px;margin:16px 0}
h2{margin:0 0 12px;font-size:21px}h3{font-size:16px;margin:14px 0 6px}.muted{color:var(--muted)}
.callout{border-inline-start:4px solid var(--accent);padding:8px 12px;background:color-mix(in srgb,var(--accent) 8%,transparent);border-radius:6px}
.table-wrap{overflow-x:auto}table{border-collapse:collapse;width:100%;font-size:14px}th,td{border-bottom:1px solid var(--line);padding:8px;text-align:start;vertical-align:top}
th{background:color-mix(in srgb,var(--ink) 5%,transparent)}tfoot td{font-weight:700}.num{text-align:center;white-space:nowrap}.big{font-size:22px}
.findings td.ev{font-family:ui-monospace,Menlo,monospace;font-size:12.5px;max-width:260px;word-break:break-word}
.sev{white-space:nowrap;font-weight:600}.sev-critical{color:var(--crit)}.sev-high{color:var(--high)}.sev-medium{color:var(--med)}.sev-low{color:var(--low)}.cert{white-space:nowrap}
article.top,article.dept{border-top:1px solid var(--line);padding-top:6px}.plans{display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:12px}
.plan{border:1px solid var(--line);border-radius:10px;padding:4px 14px}.internal{border:2px dashed var(--high)}a{color:var(--accent)}
@media print{body{background:#fff}section{break-inside:avoid-page;border:none;padding:0}}
`;
