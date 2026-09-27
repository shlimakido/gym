// חישובים דטרמיניסטיים: ציון משוקלל, דירוג עדיפות, ניצחונות מהירים ורשימת אימות.
// המודל לא מחשב אותם, כדי שיהיו עקביים וניתנים לבדיקה.
import { DEPARTMENTS, SEVERITY, EFFORT } from './config.js';

export function effectiveWeights(userWeights = {}) {
  return Object.fromEntries(DEPARTMENTS.map(d => {
    const w = userWeights[d.id];
    return [d.id, Number.isFinite(Number(w)) && w !== '' && w !== null ? Math.max(0, Number(w)) : d.weight];
  }));
}

// ציון כולל = ממוצע משוקלל של המחלקות שקיבלו ציון. מחלקה בלי ציון (או במשקל 0)
// יוצאת מהחישוב, והמשקל שלה מתחלק יחסית בין השאר. זה מדווח בדו"ח.
export function overallScore(deptResults, weights) {
  let sum = 0, wsum = 0;
  const excluded = [];
  for (const d of DEPARTMENTS) {
    const r = deptResults[d.id];
    const w = weights[d.id];
    if (!r || !r.rated || w <= 0) { excluded.push(d.id); continue; }
    sum += r.score * w;
    wsum += w;
  }
  return { score: wsum ? Math.round(sum / wsum) : null, weightUsed: wsum, excluded };
}

const CERT_RANK = { verified: 0, likely: 1, hypothesis: 2 };

export function priorityCompare(a, b) {
  return (SEVERITY[a.severity].rank - SEVERITY[b.severity].rank)
    || (EFFORT[a.effort].rank - EFFORT[b.effort].rank)
    || (CERT_RANK[a.certainty] - CERT_RANK[b.certainty])
    || ((b.departments?.length || 0) - (a.departments?.length || 0));
}

export function rankFindings(findings) {
  return [...findings].sort(priorityCompare).map((f, i) => ({ ...f, id: `F-${String(i + 1).padStart(2, '0')}`, priority: i + 1 }));
}

export function quickWins(findings) {
  return findings.filter(f => ['critical', 'high', 'medium'].includes(f.severity) && f.effort === 'S');
}

export function verificationList(findings) {
  return findings
    .filter(f => f.certainty !== 'verified')
    .map(f => ({ id: `V-${f.id}`, finding_id: f.id, certainty: f.certainty, finding: f.finding, how: f.verify_how || 'לא צוינה דרך אימות. יש לפתוח את העמוד שבראיה ולבדוק ידנית.', done: false, note: '' }));
}
