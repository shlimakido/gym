const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const STAGES = [
  ['collect', 'איסוף ראיות'], ['stage0', 'שלב 0: מיפוי'], ['stage1', 'שלב 1: תתי-סוכנים'],
  ['stage2', 'שלב 2: מפקחים'], ['stage3', 'שלב 3: מתאם ראשי'], ['stage4', 'שלב 4: רשימת אימות'], ['done', 'סיום'],
];
const STATUS_LABEL = { queued: 'בתור', running: 'רץ', done: 'הושלם', failed: 'נכשל' };
const AGENT_LABEL = { running: 'רץ…', findings: 'ממצאים', none: 'אין ממצאים', not_checked: 'לא נבדק', error: 'שגיאה' };

let config;
let shots = [];
let files = [];
let source;

async function api(path, opts = {}) {
  const res = await fetch(path, { ...opts, headers: { 'content-type': 'application/json', ...(opts.headers || {}) } });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || `שגיאה ${res.status}`);
  return body;
}

// ─── טופס ───
function renderForm() {
  $('#client-fields').innerHTML = config.clientFields.map(f => {
    const req = f.required ? ' <span class="req" aria-hidden="true">*</span>' : '';
    const attrs = `id="c-${f.key}" name="${f.key}"${f.required ? ' required aria-required="true"' : ''}`;
    const control = f.options
      ? `<select ${attrs}><option value="">לא צוין</option>${f.options.map(o => `<option>${esc(o)}</option>`).join('')}</select>`
      : ['flows', 'knownIssues', 'competitors'].includes(f.key)
        ? `<textarea ${attrs} rows="2"></textarea>`
        : `<input ${attrs} ${f.key === 'url' ? 'type="url" inputmode="url" dir="ltr" placeholder="https://"' : 'type="text"'}>`;
    return `<label class="field" for="c-${f.key}">${esc(f.label)}${req}${control}</label>`;
  }).join('');
  $('#weights').innerHTML = config.departments.map(d =>
    `<label>${esc(d.name)} (${d.id})<input type="number" min="0" max="100" step="1" id="w-${d.id}" value="${d.weight}" inputmode="numeric"></label>`).join('');
}

function readFile(file, asText) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = () => reject(r.error);
    asText ? r.readAsText(file) : r.readAsDataURL(file);
  });
}

function renderFileLists() {
  $('#shots-list').innerHTML = shots.map((s, i) =>
    `<li>S${i + 1}: ${esc(s.name)} <input type="text" placeholder="תיאור קצר (למשל: דף הבית במובייל)" data-shot="${i}" value="${esc(s.caption)}"></li>`).join('');
  $('#files-list').innerHTML = files.map((f, i) => `<li>F${i + 1}: ${esc(f.name)} (${Math.round(f.text.length / 1024)}KB)</li>`).join('');
}

$('#shots').addEventListener('change', async e => {
  for (const file of e.target.files) {
    if (file.size > 5 * 1024 * 1024) { $('#form-error').textContent = `התמונה ${file.name} גדולה מ-5MB`; continue; }
    const dataUrl = await readFile(file);
    shots.push({ name: file.name, caption: '', mediaType: file.type, data: dataUrl.split(',')[1] });
  }
  e.target.value = '';
  renderFileLists();
});
$('#files').addEventListener('change', async e => {
  for (const file of e.target.files) {
    if (file.size > 300 * 1024) { $('#form-error').textContent = `הקובץ ${file.name} גדול מ-300KB`; continue; }
    files.push({ name: file.name, text: await readFile(file, true) });
  }
  e.target.value = '';
  renderFileLists();
});
$('#shots-list').addEventListener('input', e => {
  if (e.target.dataset.shot !== undefined) shots[Number(e.target.dataset.shot)].caption = e.target.value;
});

$('#form').addEventListener('submit', async e => {
  e.preventDefault();
  $('#form-error').textContent = '';
  const client = Object.fromEntries(config.clientFields.map(f => [f.key, $(`#c-${f.key}`).value]));
  const missing = config.clientFields.filter(f => f.required && !client[f.key].trim());
  if (missing.length) {
    $('#form-error').textContent = `חסר: ${missing.map(f => f.label).join(', ')}`;
    $(`#c-${missing[0].key}`).focus();
    return;
  }
  const weights = Object.fromEntries(config.departments.map(d => [d.id, $(`#w-${d.id}`).value]));
  $('#submit').disabled = true;
  try {
    const { id } = await api('/api/audits', { method: 'POST', body: JSON.stringify({ client, weights, materials: { screenshots: shots, files, analytics: $('#analytics').value } }) });
    shots = []; files = [];
    $('#form').reset(); renderForm(); renderFileLists();
    location.hash = `#/audit/${id}`;
  } catch (err) {
    $('#form-error').textContent = err.message;
  } finally {
    $('#submit').disabled = false;
  }
});

async function renderHistory() {
  const list = await api('/api/audits');
  $('#history').innerHTML = list.length
    ? list.map(a => `<li><a href="#/audit/${a.id}">${esc(a.name)}</a><div class="muted small">${new Date(a.createdAt).toLocaleString('he-IL')} · ${STATUS_LABEL[a.status] || a.status}${a.score !== null ? ` · ציון ${a.score}` : ''}</div></li>`).join('')
    : '<li class="muted">עדיין אין ביקורות.</li>';
}

// ─── מסך ביקורת ───
function renderAgentsGrid(agentStates = {}, deptStates = {}) {
  $('#agents').innerHTML = config.departments.map(d => {
    const ds = deptStates[d.id];
    const dLabel = ds ? (ds.status === 'done' ? (ds.rated === false ? 'לא דורג' : `ציון ${ds.score}`) : ds.status === 'error' ? 'שגיאה' : 'מפקח…') : '';
    return `<div class="dept"><h3><span>${esc(d.name)}</span><span class="muted">${esc(dLabel)}</span></h3>${d.agents.map(a => {
      const st = agentStates[a.id] || {};
      return `<div class="chip" data-s="${st.status || ''}" title="${esc(a.checklist)}"><span>${a.id} ${esc(a.name)}</span><span>${st.status ? esc(AGENT_LABEL[st.status] + (st.count ? ` (${st.count})` : '')) : ''}</span></div>`;
    }).join('')}</div>`;
  }).join('');
}

function setStage(stage) {
  const idx = STAGES.findIndex(s => s[0] === stage);
  $('#stages').innerHTML = STAGES.map(([, label], i) => `<li class="${i < idx ? 'past' : i === idx ? 'active' : ''}">${esc(label)}</li>`).join('');
}

function setStatus(status) {
  const el = $('#a-status');
  el.textContent = STATUS_LABEL[status] || status;
  el.className = `pill ${status}`;
}

async function showAudit(id) {
  source?.close();
  const audit = await api(`/api/audits/${id}`);
  $('#a-title').textContent = audit.client.name;
  $('#a-sub').textContent = [audit.client.url, new Date(audit.createdAt).toLocaleString('he-IL')].filter(Boolean).join(' · ');
  $('#a-error').textContent = audit.error || '';
  $('#log').innerHTML = '';
  $('#result').hidden = true;
  setStatus(audit.status);
  setStage('collect');
  const agentStates = {}, deptStates = {};
  renderAgentsGrid();

  source = new EventSource(`/api/audits/${id}/events`);
  source.onmessage = async msg => {
    const e = JSON.parse(msg.data);
    if (e.type === 'stage') setStage(e.stage);
    if (e.type === 'log' || e.type === 'error') $('#log').insertAdjacentHTML('beforeend', `<li>${esc(e.text)}</li>`);
    if (e.type === 'agent') { agentStates[e.id] = e; renderAgentsGrid(agentStates, deptStates); }
    if (e.type === 'dept') { deptStates[e.id] = e; renderAgentsGrid(agentStates, deptStates); }
    if (e.type === 'mapping') for (const c of e.mapping.coverage) if (c.level === 'no') agentStates[c.agent_id] = { status: 'not_checked' };
    if (e.type === 'error') $('#a-error').textContent = e.text;
    if (e.type === 'status') {
      setStatus(e.status);
      if (e.status === 'done' || e.status === 'failed') {
        source.close();
        if (e.status === 'done') await showResult(id);
      }
    }
  };
}

async function showResult(id) {
  const audit = await api(`/api/audits/${id}`);
  $('#result').hidden = false;
  $('#report').src = `/api/audits/${id}/report?variant=internal&t=${Date.now()}`;
  $('#dl-internal').href = `/api/audits/${id}/report?variant=internal&download=1`;
  renderVerify(id, audit.result.verification);
}

function updateVerifyState(id, items) {
  const open = items.filter(v => !v.done).length;
  $('#v-count').textContent = items.length ? `${items.length - open}/${items.length} טופלו` : 'אין פריטים';
  $('#v-count').className = `pill ${open ? 'running' : 'done'}`;
  const dl = $('#dl-client');
  if (open) { dl.setAttribute('aria-disabled', 'true'); dl.removeAttribute('href'); dl.title = 'יש לטפל בכל פריטי האימות קודם'; }
  else { dl.setAttribute('aria-disabled', 'false'); dl.href = `/api/audits/${id}/report?variant=client&download=1`; dl.title = ''; }
}

function renderVerify(id, items) {
  updateVerifyState(id, items);
  $('#verify').innerHTML = items.length ? items.map(v => `<li>
      <input type="checkbox" id="${v.id}" ${v.done ? 'checked' : ''} data-v="${v.id}">
      <label for="${v.id}"><strong>${esc(v.finding_id)}</strong> ${v.certainty === 'likely' ? '🟡' : '⚪'} ${esc(v.finding)}<div class="how">איך לאמת: ${esc(v.how)}</div></label>
      <input type="text" data-note="${v.id}" value="${esc(v.note)}" placeholder="תוצאת האימות (אושר / נדחה / תוקן בדו״ח)" aria-label="תוצאת האימות של ${esc(v.finding_id)}">
    </li>`).join('') : '<li class="muted">כל הממצאים מאומתים. אפשר להוציא את הדו"ח ללקוח.</li>';
  // עדכון במקום, בלי לבנות את הרשימה מחדש, כדי לא לאבד פוקוס מקלדת
  $('#verify').onchange = async e => {
    const vid = e.target.dataset.v || e.target.dataset.note;
    if (!vid) return;
    const body = e.target.dataset.v ? { id: vid, done: e.target.checked } : { id: vid, note: e.target.value };
    try {
      const item = await api(`/api/audits/${id}/verify`, { method: 'POST', body: JSON.stringify(body) });
      Object.assign(items.find(v => v.id === vid), item);
      updateVerifyState(id, items);
      $('#report').src = `/api/audits/${id}/report?variant=internal&t=${Date.now()}`;
    } catch (err) {
      $('#a-error').textContent = err.message;
      if (e.target.dataset.v) e.target.checked = !e.target.checked;
    }
  };
}

// ─── ניתוב ───
async function route() {
  const m = location.hash.match(/^#\/audit\/([a-f0-9-]{36})/);
  $('#view-home').hidden = Boolean(m);
  $('#view-audit').hidden = !m;
  if (m) await showAudit(m[1]).catch(err => { $('#a-error').textContent = err.message; });
  else { source?.close(); await renderHistory(); }
}

config = await api('/api/config');
$('#model').textContent = `מודל: ${config.model}`;
renderForm();
window.addEventListener('hashchange', route);
route();
