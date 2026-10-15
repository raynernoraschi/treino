'use strict';

/* =====================================================================
   Meu Treino — app de uma página (sem dependências)
   ===================================================================== */

/* ---------- utilidades ---------- */
const $ = (s, r = document) => r.querySelector(s);

// cria elementos sem innerHTML (evita problemas com textos digitados)
function h(tag, props, ...kids) {
  const e = document.createElement(tag);
  let val;
  for (const [k, v] of Object.entries(props || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') e.className = v;
    else if (k === 'text') e.textContent = v;
    else if (k === 'value') val = v;
    else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else if (v === true) e.setAttribute(k, '');
    else e.setAttribute(k, v);
  }
  for (const kid of kids.flat(Infinity)) {
    if (kid == null || kid === false) continue;
    e.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
  }
  if (val !== undefined) e.value = val;
  return e;
}

const nf = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 2 });
const fmt = n => (n == null || Number.isNaN(n) ? '–' : nf.format(n));
const toStr = n => (n == null ? '' : String(n).replace('.', ','));
const pad = n => String(n).padStart(2, '0');
const isoOf = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const todayISO = () => isoOf(new Date());
const parseISO = s => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
const fmtDate = (s, year) => { const [y, m, d] = s.split('-'); return year ? `${d}/${m}/${y}` : `${d}/${m}`; };
const WEEKDAYS = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
const sum = a => a.reduce((x, y) => x + y, 0);
function parseNum(s) {
  if (s == null) return null;
  s = String(s).trim().replace(',', '.');
  if (s === '') return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}
function mondayOf(d) {
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  x.setDate(x.getDate() - ((x.getDay() + 6) % 7));
  return x;
}

let toastTimer;
function toast(msg, bad) {
  const t = $('#toast');
  t.textContent = msg;
  t.className = 'toast' + (bad ? ' bad' : '');
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, bad ? 4500 : 2200);
}

/* ---------- estado ---------- */
let S = { workouts: null, sessions: [] };
let draft = null;                 // treino em andamento
let tab = 'treino';
const DRAFT_KEY = 'meutreino_draft_v1';

function sortedSessions() {
  return [...S.sessions].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : (a.created || 0) - (b.created || 0)));
}
function workoutName(k) { return (S.workouts[k] && S.workouts[k].name) || ('Treino ' + k); }
function sessionVolume(s) {
  let v = 0;
  for (const e of s.entries) {
    if (e.mode === 'tempo') continue;
    for (const st of e.sets) if (st.w != null && st.r != null) v += st.w * st.r;
  }
  return v;
}
function lastEntry(exId, excludeId) {
  const ss = sortedSessions();
  for (let i = ss.length - 1; i >= 0; i--) {
    if (ss[i].id === excludeId) continue;
    const e = ss[i].entries.find(x => x.exId === exId);
    if (e && e.sets.length) return { entry: e, date: ss[i].date };
  }
  return null;
}

/* ---------- API ---------- */
async function api(action, body) {
  const opt = body === undefined ? {} : {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'fetch' },
    body: JSON.stringify(body),
  };
  let r;
  try { r = await fetch('api.php?action=' + action, opt); }
  catch (e) { throw new Error('Sem conexão com o servidor'); }
  let j = {};
  try { j = await r.json(); } catch (e) { /* resposta não era JSON */ }
  if (r.status === 401 && action !== 'login') { showLogin(); throw new Error('auth'); }
  if (!r.ok) throw new Error(j.error || ('Erro ' + r.status + ' — o PHP está rodando?'));
  return j;
}

/* ---------- login / boot ---------- */
function showLogin(msg) {
  $('#app').hidden = true;
  $('#login').hidden = false;
  $('#loginErr').textContent = msg || '';
}
function showApp() { $('#login').hidden = true; $('#app').hidden = false; }

async function boot() {
  try {
    const j = await api('state');
    S.workouts = j.workouts;
    S.sessions = j.sessions;
    $('#warn').hidden = !j.warnDefaultPassword;
    loadDraft();
    showApp();
    renderTab();
  } catch (e) {
    if (e.message !== 'auth') showLogin(e.message);
  }
}

$('#loginForm').addEventListener('submit', async ev => {
  ev.preventDefault();
  $('#loginErr').textContent = '';
  try {
    await api('login', { password: $('#pw').value });
    $('#pw').value = '';
    await boot();
  } catch (e) { $('#loginErr').textContent = e.message; }
});
$('#logout').addEventListener('click', async () => {
  try { await api('logout', {}); } catch (e) { /* ignora */ }
  editW = null;
  showLogin();
});
document.querySelectorAll('#nav button').forEach(b => b.addEventListener('click', () => {
  tab = b.dataset.tab;
  renderTab();
  window.scrollTo(0, 0);
}));

function renderTab() {
  document.querySelectorAll('#nav button').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
  const root = $('#view');
  root.replaceChildren();
  ({ treino: renderTreino, editar: renderEditar, stats: renderStats, hist: renderHist })[tab](root);
}

/* =====================================================================
   ABA: TREINO
   ===================================================================== */
function saveDraft() {
  try {
    if (draft) localStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
    else localStorage.removeItem(DRAFT_KEY);
  } catch (e) { /* armazenamento indisponível */ }
}
function loadDraft() {
  try {
    const d = JSON.parse(localStorage.getItem(DRAFT_KEY) || 'null');
    draft = d && d.workout && Array.isArray(d.entries) && S.workouts[d.workout] ? d : null;
  } catch (e) { draft = null; }
}

function renderTreino(root) {
  if (draft) renderDraft(root); else renderPicker(root);
}

function renderPicker(root) {
  const ss = sortedSessions();
  const last = ss[ss.length - 1];
  const next = last ? { A: 'B', B: 'C', C: 'A' }[last.workout] : 'A';
  const dateIn = h('input', { type: 'date', value: todayISO() });
  root.append(
    h('h2', { text: 'Qual treino hoje?' }),
    h('label', { class: 'field' }, h('span', { text: 'Data' }), dateIn),
  );
  for (const k of ['A', 'B', 'C']) {
    const w = S.workouts[k];
    const lastOf = [...ss].reverse().find(s => s.workout === k);
    root.append(h('button', { class: 'workout-btn' + (k === next ? ' suggested' : ''), type: 'button',
      onclick: () => startDraft(k, dateIn.value || todayISO()) },
      h('span', { class: 'letter', text: k }),
      h('span', { class: 'wb-info' },
        h('strong', { text: workoutName(k) }),
        h('small', { text: `${w.exercises.length} exercícios · ${lastOf ? 'último em ' + fmtDate(lastOf.date, true) : 'sem registros ainda'}` })),
      k === next ? h('span', { class: 'badge', text: 'sugerido' }) : null));
  }
}

function newEntry(ex) {
  return {
    exId: ex.id, name: ex.name, mode: ex.mode || 'carga', target: ex.reps || '', nSets: ex.sets,
    hint: ex.hint || '', ref: ex.ref == null ? null : ex.ref,
    sets: Array.from({ length: ex.sets }, () => ({ w: '', r: '', auto: true })), note: '',
  };
}
function startDraft(k, date) {
  draft = { workout: k, date, editingId: null, created: Date.now(),
    entries: S.workouts[k].exercises.map(newEntry) };
  saveDraft();
  renderTab();
  window.scrollTo(0, 0);
}
function editSession(id) {
  const s = S.sessions.find(x => x.id === id);
  if (!s) return;
  if (draft && !confirm('Há um treino em andamento. Descartar e abrir este para edição?')) return;
  const plan = S.workouts[s.workout].exercises;
  const entries = [];
  const used = new Set();
  for (const ex of plan) {
    const e = s.entries.find(x => x.exId === ex.id);
    const base = newEntry(ex);
    if (e) {
      used.add(ex.id);
      base.sets = e.sets.map(st => ({ w: toStr(st.w), r: toStr(st.r), auto: false }));
      base.note = e.note || '';
    }
    entries.push(base);
  }
  for (const e of s.entries) {   // exercícios que saíram do plano
    if (used.has(e.exId) || plan.some(p => p.id === e.exId)) continue;
    entries.push({ exId: e.exId, name: e.name, mode: e.mode || 'carga', target: '', nSets: e.sets.length, hint: '', ref: null,
      sets: e.sets.map(st => ({ w: toStr(st.w), r: toStr(st.r), auto: false })), note: e.note || '' });
  }
  draft = { workout: s.workout, date: s.date, editingId: s.id, created: s.created, entries };
  saveDraft();
  tab = 'treino';
  renderTab();
  window.scrollTo(0, 0);
}

const isFilled = en => en.sets.some(s => s.w !== '' || s.r !== '');

function renderDraft(root) {
  const k = draft.workout;
  const progEl = h('small');
  const cards = [];
  function refresh() {
    saveDraft();
    let n = 0;
    draft.entries.forEach((en, i) => {
      const f = isFilled(en);
      if (f) n++;
      cards[i].classList.toggle('filled', f);
    });
    progEl.textContent = `${n}/${draft.entries.length} exercícios com dados`;
  }

  root.append(
    h('div', { class: 'draft-head' },
      h('span', { class: 'letter', text: k }),
      h('div', null, h('strong', { text: workoutName(k) }), progEl),
      h('input', { type: 'date', value: draft.date, style: 'width:auto', 'aria-label': 'Data do treino',
        onchange: e => { draft.date = e.target.value || todayISO(); saveDraft(); } })));
  if (draft.editingId) root.append(h('div', { class: 'warn', text: 'Editando um treino já salvo — ao finalizar, ele será atualizado.' }));
  draft.entries.forEach(en => {
    const c = renderEntryCard(en, refresh);
    cards.push(c);
    root.append(c);
  });

  const finishBtn = h('button', { class: 'btn primary', type: 'button', text: draft.editingId ? 'Salvar alterações' : 'Finalizar treino' });
  finishBtn.addEventListener('click', () => finishDraft(finishBtn));
  root.append(h('div', { class: 'sticky-actions' },
    h('button', { class: 'btn danger', type: 'button', text: 'Descartar',
      onclick: () => { if (confirm('Descartar este treino? Os dados digitados serão perdidos.')) { draft = null; saveDraft(); renderTab(); } } }),
    finishBtn));
  refresh();
}

function placeholders(en, prev, i) {
  const ps = prev ? prev.entry.sets : [];
  const p = ps[i] || ps[ps.length - 1];
  const firstNum = String(en.target || '').match(/\d+/);
  return {
    w: p && p.w != null ? fmt(p.w) : (en.ref != null ? fmt(en.ref) : 'kg'),
    r: p && p.r != null ? fmt(p.r) : (firstNum ? firstNum[0] : (en.mode === 'tempo' ? 'seg' : 'reps')),
  };
}

function renderEntryCard(en, onChange) {
  const prev = lastEntry(en.exId, draft.editingId);
  const isTime = en.mode === 'tempo';
  const wInputs = [];
  const setsBox = h('div', { class: 'sets' });

  function prevText() {
    if (prev) {
      const parts = prev.entry.sets.map(s => isTime ? `${fmt(s.r)}s` : (s.w != null && s.r != null ? `${fmt(s.w)}×${fmt(s.r)}` : s.w != null ? `${fmt(s.w)} kg` : `${fmt(s.r)} reps`));
      return `Última vez (${fmtDate(prev.date)}): ${parts.join(' · ')}`;
    }
    return en.ref != null ? `Referência: ${fmt(en.ref)} kg` : 'Sem registros anteriores';
  }

  function renderSets() {
    setsBox.replaceChildren();
    wInputs.length = 0;
    setsBox.append(h('div', { class: 'set-row head' + (isTime ? ' time' : '') },
      h('span'), isTime ? null : h('span', { text: 'Carga' }), h('span', { text: isTime ? 'Tempo' : 'Repetições' })));
    en.sets.forEach((st, i) => {
      const p = placeholders(en, prev, i);
      const rIn = h('input', { type: 'text', inputmode: 'decimal', placeholder: p.r, value: st.r, 'aria-label': `Série ${i + 1}: ${isTime ? 'segundos' : 'repetições'}` });
      rIn.addEventListener('input', () => { st.r = rIn.value; onChange(); });
      let wIn = null;
      if (!isTime) {
        wIn = h('input', { type: 'text', inputmode: 'decimal', placeholder: p.w, value: st.w, 'aria-label': `Série ${i + 1}: carga em kg` });
        wIn.addEventListener('input', () => {
          st.w = wIn.value;
          st.auto = false;
          for (let j = i + 1; j < en.sets.length; j++) {   // repete a carga nas séries seguintes ainda não editadas
            if (en.sets[j].auto) { en.sets[j].w = wIn.value; wInputs[j].value = wIn.value; }
          }
          onChange();
        });
      }
      wInputs[i] = wIn;
      setsBox.append(h('div', { class: 'set-row' + (isTime ? ' time' : '') },
        h('span', { class: 'set-n', text: i + 1 }),
        wIn ? h('label', { class: 'inp' }, wIn, h('em', { text: 'kg' })) : null,
        h('label', { class: 'inp' }, rIn, h('em', { text: isTime ? 's' : 'reps' }))));
    });
  }

  function useLast() {
    en.sets.forEach((st, i) => {
      const ps = prev ? prev.entry.sets : [];
      const p = ps[i] || ps[ps.length - 1];
      st.w = isTime ? '' : toStr(p && p.w != null ? p.w : en.ref);
      st.r = p ? toStr(p.r) : '';
      st.auto = false;
    });
    renderSets();
    onChange();
  }

  const ctrl = h('div', { class: 'ctrl' },
    h('button', { class: 'btn ghost sm', type: 'button', text: '+ série', onclick: () => {
      const lastSet = en.sets[en.sets.length - 1];
      en.sets.push({ w: lastSet ? lastSet.w : '', r: '', auto: true });
      renderSets(); onChange();
    } }),
    h('button', { class: 'btn ghost sm', type: 'button', text: '− série', onclick: () => {
      if (en.sets.length > 1) { en.sets.pop(); renderSets(); onChange(); }
    } }),
    (prev || en.ref != null) ? h('button', { class: 'btn ghost sm', type: 'button', text: 'Repetir anterior', onclick: useLast }) : null);

  const card = h('div', { class: 'card ex' },
    h('div', { class: 'ex-head' },
      h('strong', { text: en.name }),
      h('span', { class: 'target', text: en.target ? `${en.nSets}×${en.target}` : '' })),
    h('div', { class: 'prev', text: prevText() }),
    en.hint ? h('div', { class: 'hint', text: en.hint }) : null,
    setsBox, ctrl,
    h('input', { type: 'text', class: 'note', placeholder: 'Observação (opcional)', value: en.note,
      oninput: e => { en.note = e.target.value; onChange(); } }));
  renderSets();
  return card;
}

async function finishDraft(btn) {
  const entries = [];
  let missing = 0;
  for (const en of draft.entries) {
    const sets = en.sets
      .map(s => ({ w: en.mode === 'tempo' ? null : parseNum(s.w), r: parseNum(s.r) }))
      .filter(s => s.w != null || s.r != null);
    if (sets.length) entries.push({ exId: en.exId, name: en.name, mode: en.mode, sets, note: en.note.trim() });
    else missing++;
  }
  if (!entries.length) { toast('Preencha ao menos uma série.', true); return; }
  if (missing && !confirm(`${missing} exercício(s) sem dados serão ignorados. Finalizar mesmo assim?`)) return;
  const session = { id: draft.editingId || uid(), date: draft.date || todayISO(), workout: draft.workout,
    created: draft.created || Date.now(), entries };
  btn.disabled = true;
  try {
    const j = await api('saveSession', { session });
    const i = S.sessions.findIndex(x => x.id === j.session.id);
    if (i >= 0) S.sessions[i] = j.session; else S.sessions.push(j.session);
    draft = null;
    saveDraft();
    toast('Treino salvo ✔');
    renderTab();
    window.scrollTo(0, 0);
  } catch (e) {
    btn.disabled = false;
    if (e.message !== 'auth') toast('Não salvou: ' + e.message + ' (seus dados continuam aqui)', true);
  }
}

/* =====================================================================
   ABA: EXERCÍCIOS (editar os treinos A, B e C)
   ===================================================================== */
let editW = null;
let editKey = 'A';

function renderEditar(root) {
  if (!editW) editW = JSON.parse(JSON.stringify(S.workouts));
  const w = editW[editKey];
  root.append(
    h('h2', { text: 'Editar exercícios' }),
    h('p', { class: 'muted', text: 'As mudanças valem para os próximos treinos. O histórico já registrado não é alterado.' }),
    h('div', { class: 'seg' }, ['A', 'B', 'C'].map(k =>
      h('button', { type: 'button', class: k === editKey ? 'on' : '', text: 'Treino ' + k,
        onclick: () => { editKey = k; renderTab(); } }))),
    h('label', { class: 'field' }, h('span', { text: 'Nome do treino ' + editKey }),
      h('input', { type: 'text', value: w.name, oninput: e => { w.name = e.target.value; } })));

  const list = h('div');
  root.append(list);
  const rerender = () => renderTab();

  w.exercises.forEach((ex, i) => {
    list.append(h('div', { class: 'card' },
      h('div', { class: 'ed-grid' },
        h('label', { class: 'field wide' }, h('span', { text: `Exercício ${i + 1}` }),
          h('input', { type: 'text', value: ex.name, placeholder: 'Nome do exercício', oninput: e => { ex.name = e.target.value; } })),
        h('label', { class: 'field' }, h('span', { text: 'Séries' }),
          h('input', { type: 'text', inputmode: 'numeric', value: String(ex.sets), oninput: e => { ex.sets = parseInt(e.target.value, 10) || 1; } })),
        h('label', { class: 'field' }, h('span', { text: 'Repetições' }),
          h('input', { type: 'text', value: ex.reps || '', placeholder: 'ex.: 8–10', oninput: e => { ex.reps = e.target.value; } })),
        h('label', { class: 'field' }, h('span', { text: 'Tipo' }),
          h('select', { value: ex.mode || 'carga', onchange: e => { ex.mode = e.target.value; } },
            h('option', { value: 'carga', text: 'Carga × reps' }),
            h('option', { value: 'tempo', text: 'Tempo (s)' }))),
        h('label', { class: 'field' }, h('span', { text: 'Carga de referência (kg)' }),
          h('input', { type: 'text', inputmode: 'decimal', value: toStr(ex.ref), placeholder: '—', oninput: e => { ex.ref = parseNum(e.target.value); } })),
        h('label', { class: 'field wide' }, h('span', { text: 'Observação fixa (opcional)' }),
          h('input', { type: 'text', value: ex.hint || '', placeholder: 'ex.: carga por lado', oninput: e => { ex.hint = e.target.value; } }))),
      h('div', { class: 'ed-actions' },
        h('button', { class: 'btn ghost sm', type: 'button', text: '↑', disabled: i === 0, 'aria-label': 'Subir',
          onclick: () => { [w.exercises[i - 1], w.exercises[i]] = [w.exercises[i], w.exercises[i - 1]]; rerender(); } }),
        h('button', { class: 'btn ghost sm', type: 'button', text: '↓', disabled: i === w.exercises.length - 1, 'aria-label': 'Descer',
          onclick: () => { [w.exercises[i + 1], w.exercises[i]] = [w.exercises[i], w.exercises[i + 1]]; rerender(); } }),
        h('button', { class: 'btn danger sm', type: 'button', text: 'Remover',
          onclick: () => { if (confirm(`Remover "${ex.name || 'este exercício'}" do treino ${editKey}? O histórico dele continua salvo.`)) { w.exercises.splice(i, 1); rerender(); } } }))));
  });

  root.append(
    h('button', { class: 'btn block', type: 'button', text: '+ Adicionar exercício', onclick: () => {
      w.exercises.push({ id: 'x' + uid(), name: '', sets: 3, reps: '10', mode: 'carga', ref: null, hint: '' });
      rerender();
      const inputs = document.querySelectorAll('#view .card input[placeholder="Nome do exercício"]');
      if (inputs.length) inputs[inputs.length - 1].focus();
    } }),
    h('div', { class: 'sticky-actions' },
      h('button', { class: 'btn ghost', type: 'button', text: 'Desfazer', onclick: () => { editW = null; renderTab(); toast('Alterações desfeitas'); } }),
      h('button', { class: 'btn primary', type: 'button', text: 'Salvar treinos', onclick: async ev => {
        const btn = ev.currentTarget;
        const clean = JSON.parse(JSON.stringify(editW));
        for (const k of ['A', 'B', 'C']) {
          clean[k].exercises = clean[k].exercises.filter(e => (e.name || '').trim() !== '');
          clean[k].exercises.forEach(e => { e.name = e.name.trim(); e.sets = Math.max(1, Math.min(10, e.sets || 1)); });
        }
        btn.disabled = true;
        try {
          const j = await api('saveWorkouts', { workouts: clean });
          S.workouts = j.workouts;
          editW = null;
          toast('Treinos salvos ✔');
          renderTab();
        } catch (e) { btn.disabled = false; if (e.message !== 'auth') toast('Não salvou: ' + e.message, true); }
      } })));
}

/* =====================================================================
   ABA: ESTATÍSTICAS
   ===================================================================== */
const stFilter = { period: '90', workout: 'all', ex: null, metric: null };

const METRICS = {
  carga: [['max', 'Carga máxima (kg)'], ['vol', 'Volume (kg × reps)'], ['e1rm', '1RM estimado (kg)']],
  tempo: [['best', 'Melhor tempo (s)'], ['total', 'Tempo total (s)']],
};
function metricValue(mode, metric, sets) {
  if (mode === 'tempo') {
    const rs = sets.map(s => s.r).filter(x => x != null);
    if (!rs.length) return null;
    return metric === 'total' ? sum(rs) : Math.max(...rs);
  }
  const ws = sets.filter(s => s.w != null);
  if (metric === 'vol') { const v = ws.filter(s => s.r != null); return v.length ? sum(v.map(s => s.w * s.r)) : null; }
  if (metric === 'e1rm') { const v = ws.filter(s => s.r > 0); return v.length ? Math.max(...v.map(s => s.w * (1 + s.r / 30))) : null; }
  return ws.length ? Math.max(...ws.map(s => s.w)) : null;
}

function cssVar(n) { return getComputedStyle(document.documentElement).getPropertyValue(n).trim(); }
function prepCanvas(c, height) {
  const dpr = window.devicePixelRatio || 1;
  const w = c.parentElement.clientWidth || 300;
  c.style.height = height + 'px';
  c.width = Math.round(w * dpr);
  c.height = Math.round(height * dpr);
  const ctx = c.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return { ctx, w, h: height };
}

function drawLine(canvas, tip, pts, unit) {
  const { ctx, w, h: H } = prepCanvas(canvas, 220);
  const L = 46, R = 14, T = 14, B = 26;
  const accent = cssVar('--accent'), muted = cssVar('--muted'), line = cssVar('--line'), text = cssVar('--text');
  const ys = pts.map(p => p.y);
  let ymin = Math.min(...ys), ymax = Math.max(...ys);
  if (ymin === ymax) { ymin -= 1; ymax += 1; }
  const padY = (ymax - ymin) * 0.12;
  ymin = ymin - padY; ymax = ymax + padY;
  if (ymin < 0 && Math.min(...ys) >= 0) ymin = 0;
  const tmin = pts[0].t, tmax = pts[pts.length - 1].t;
  const X = t => (tmax === tmin ? (L + w - R) / 2 : L + (t - tmin) / (tmax - tmin) * (w - L - R));
  const Y = y => T + (1 - (y - ymin) / (ymax - ymin)) * (H - T - B);

  function render(hi) {
    ctx.clearRect(0, 0, w, H);
    ctx.font = '11px system-ui, sans-serif';
    ctx.textBaseline = 'middle';
    ctx.lineWidth = 1;
    for (let i = 0; i <= 4; i++) {
      const v = ymin + (ymax - ymin) * i / 4, y = Y(v);
      ctx.strokeStyle = line; ctx.beginPath(); ctx.moveTo(L, y); ctx.lineTo(w - R, y); ctx.stroke();
      ctx.fillStyle = muted; ctx.textAlign = 'right'; ctx.fillText(fmt(Math.round(v * 10) / 10), L - 6, y);
    }
    ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = muted;
    ctx.textAlign = 'left'; ctx.fillText(fmtDate(pts[0].date), L, H - 8);
    if (pts.length > 1) { ctx.textAlign = 'right'; ctx.fillText(fmtDate(pts[pts.length - 1].date), w - R, H - 8); }
    ctx.strokeStyle = accent; ctx.lineWidth = 2.5; ctx.lineJoin = 'round';
    ctx.beginPath();
    pts.forEach((p, i) => { const x = X(p.t), y = Y(p.y); i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); });
    ctx.stroke();
    pts.forEach((p, i) => {
      ctx.beginPath(); ctx.arc(X(p.t), Y(p.y), i === hi ? 6 : 3.5, 0, Math.PI * 2);
      ctx.fillStyle = i === hi ? text : accent; ctx.fill();
    });
  }
  function pick(ev) {
    const rect = canvas.getBoundingClientRect();
    const x = ev.clientX - rect.left;
    let best = 0, bd = Infinity;
    pts.forEach((p, i) => { const d = Math.abs(X(p.t) - x); if (d < bd) { bd = d; best = i; } });
    render(best);
    tip.textContent = `${fmtDate(pts[best].date, true)} — ${fmt(Math.round(pts[best].y * 10) / 10)} ${unit}`;
  }
  canvas.onpointerdown = pick;
  canvas.onpointermove = ev => { if (ev.pointerType === 'mouse' || ev.buttons) pick(ev); };
  render(pts.length - 1);
  tip.textContent = `${fmtDate(pts[pts.length - 1].date, true)} — ${fmt(Math.round(pts[pts.length - 1].y * 10) / 10)} ${unit}`;
}

function drawBars(canvas, data) {
  const { ctx, w, h: H } = prepCanvas(canvas, 160);
  const L = 26, R = 6, T = 18, B = 24;
  const accent = cssVar('--accent'), muted = cssVar('--muted'), line = cssVar('--line');
  const max = Math.max(3, ...data.map(d => d.count));
  const slot = (w - L - R) / data.length;
  ctx.font = '11px system-ui, sans-serif';
  for (let v = 0; v <= max; v += max > 6 ? 2 : 1) {
    const y = T + (1 - v / max) * (H - T - B);
    ctx.strokeStyle = line; ctx.beginPath(); ctx.moveTo(L, y); ctx.lineTo(w - R, y); ctx.stroke();
    ctx.fillStyle = muted; ctx.textAlign = 'right'; ctx.textBaseline = 'middle'; ctx.fillText(String(v), L - 6, y);
  }
  data.forEach((d, i) => {
    const bh = (d.count / max) * (H - T - B);
    const x = L + i * slot + slot * 0.18, bw = slot * 0.64;
    ctx.fillStyle = d.count ? accent : line;
    ctx.fillRect(x, H - B - Math.max(bh, d.count ? 0 : 2), bw, Math.max(bh, d.count ? 0 : 2));
    ctx.fillStyle = muted; ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
    if (d.count) ctx.fillText(String(d.count), x + bw / 2, H - B - bh - 4);
    if (i % 2 === (data.length - 1) % 2) ctx.fillText(d.label, x + bw / 2, H - 8);
  });
}

function renderStats(root) {
  const all = sortedSessions();
  if (!all.length) {
    root.append(h('h2', { text: 'Estatísticas' }),
      h('div', { class: 'empty', text: 'Ainda não há treinos salvos. Finalize um treino e as estatísticas aparecem aqui.' }));
    return;
  }
  const rerender = () => renderTab();
  root.append(
    h('h2', { text: 'Estatísticas' }),
    h('div', { class: 'row' },
      h('label', { class: 'field' }, h('span', { text: 'Período' }),
        h('select', { value: stFilter.period, onchange: e => { stFilter.period = e.target.value; rerender(); } },
          h('option', { value: '30', text: 'Últimos 30 dias' }), h('option', { value: '90', text: 'Últimos 90 dias' }),
          h('option', { value: '180', text: 'Últimos 6 meses' }), h('option', { value: '365', text: 'Último ano' }),
          h('option', { value: 'all', text: 'Tudo' }))),
      h('label', { class: 'field' }, h('span', { text: 'Treino' }),
        h('select', { value: stFilter.workout, onchange: e => { stFilter.workout = e.target.value; rerender(); } },
          h('option', { value: 'all', text: 'Todos' }),
          ['A', 'B', 'C'].map(k => h('option', { value: k, text: `${k} – ${workoutName(k)}` }))))));

  const today = new Date();
  const byWorkout = all.filter(s => stFilter.workout === 'all' || s.workout === stFilter.workout);
  let cutoff = null;
  if (stFilter.period !== 'all') { cutoff = new Date(today.getFullYear(), today.getMonth(), today.getDate() - Number(stFilter.period)); }
  const ss = byWorkout.filter(s => !cutoff || parseISO(s.date) >= cutoff);

  // --- cartões de resumo
  const spanDays = stFilter.period === 'all'
    ? Math.max(7, (today - parseISO((ss[0] || all[0]).date)) / 864e5 + 1) : Number(stFilter.period);
  const perWeek = ss.length / (spanDays / 7);
  const counts = ['A', 'B', 'C'].map(k => `${k}: ${ss.filter(s => s.workout === k).length}`).join(' · ');
  const lastS = all[all.length - 1];
  const daysAgo = Math.round((new Date(today.getFullYear(), today.getMonth(), today.getDate()) - parseISO(lastS.date)) / 864e5);
  root.append(h('div', { class: 'stat-cards' },
    h('div', { class: 'stat' }, h('b', { text: String(ss.length) }), h('small', { text: 'treinos no período' }), h('small', { text: counts })),
    h('div', { class: 'stat' }, h('b', { text: fmt(Math.round(perWeek * 10) / 10) }), h('small', { text: 'treinos por semana (média)' })),
    h('div', { class: 'stat' }, h('b', { text: fmt(Math.round(sum(ss.map(sessionVolume)))) + ' kg' }), h('small', { text: 'volume total levantado' })),
    h('div', { class: 'stat' }, h('b', { text: daysAgo === 0 ? 'hoje' : daysAgo === 1 ? 'ontem' : `${daysAgo} dias` }),
      h('small', { text: `último treino (${workoutName(lastS.workout)})` }))));

  // --- treinos por semana
  const weeks = [];
  const thisMon = mondayOf(today);
  for (let i = 11; i >= 0; i--) {
    const d = new Date(thisMon.getFullYear(), thisMon.getMonth(), thisMon.getDate() - 7 * i);
    weeks.push({ key: isoOf(d), label: fmtDate(isoOf(d)), count: 0 });
  }
  for (const s of byWorkout) {
    const k = isoOf(mondayOf(parseISO(s.date)));
    const wk = weeks.find(x => x.key === k);
    if (wk) wk.count++;
  }
  const barCanvas = h('canvas');
  root.append(h('h3', { text: 'Treinos por semana (últimas 12 semanas)' }),
    h('div', { class: 'card' }, h('div', { class: 'chart-box' }, barCanvas)));

  // --- exercícios
  const exMap = new Map();
  for (const s of ss) for (const en of s.entries) {
    let o = exMap.get(en.exId);
    if (!o) { o = { id: en.exId, rows: [] }; exMap.set(en.exId, o); }
    o.name = en.name; o.workout = s.workout; o.mode = en.mode || 'carga';
    o.rows.push({ date: s.date, sets: en.sets });
  }
  const order = id => {
    for (const k of ['A', 'B', 'C']) { const i = S.workouts[k].exercises.findIndex(e => e.id === id); if (i >= 0) return k.charCodeAt(0) * 100 + i; }
    return 99999;
  };
  const exList = [...exMap.values()].sort((a, b) => (order(a.id) - order(b.id)) || a.name.localeCompare(b.name));
  root.append(h('h3', { text: 'Evolução por exercício' }));
  if (!exList.length) {
    root.append(h('div', { class: 'empty', text: 'Nenhum treino nesse filtro.' }));
    requestAnimationFrame(() => drawBars(barCanvas, weeks));
    return;
  }
  if (!exMap.has(stFilter.ex)) stFilter.ex = exList[0].id;
  const cur = exMap.get(stFilter.ex);
  const metrics = METRICS[cur.mode];
  if (!metrics.some(m => m[0] === stFilter.metric)) stFilter.metric = metrics[0][0];
  const mLabel = metrics.find(m => m[0] === stFilter.metric)[1];
  const unit = stFilter.metric === 'vol' ? 'kg×reps' : cur.mode === 'tempo' ? 's' : 'kg';

  const selEx = h('select', { onchange: e => { stFilter.ex = e.target.value; rerender(); } },
    ['A', 'B', 'C'].map(k => {
      const items = exList.filter(e => e.workout === k);
      return items.length ? h('optgroup', { label: `Treino ${k}` }, items.map(e => h('option', { value: e.id, text: e.name }))) : null;
    }));
  selEx.value = stFilter.ex;
  const selMetric = h('select', { onchange: e => { stFilter.metric = e.target.value; rerender(); } },
    metrics.map(m => h('option', { value: m[0], text: m[1] })));
  selMetric.value = stFilter.metric;

  const pts = cur.rows
    .map(r => ({ date: r.date, t: parseISO(r.date).getTime(), y: metricValue(cur.mode, stFilter.metric, r.sets) }))
    .filter(p => p.y != null);
  const lineCanvas = h('canvas');
  const tip = h('div', { class: 'tip' });
  const summary = h('div', { class: 'summary' });
  if (pts.length) {
    const first = pts[0], last = pts[pts.length - 1];
    const best = pts.reduce((a, b) => (b.y >= a.y ? b : a));
    const diff = last.y - first.y;
    const pct = first.y ? (diff / first.y) * 100 : 0;
    const rnd = v => Math.round(v * 10) / 10;
    summary.append(
      h('div', null, h('small', { text: 'Primeiro registro' }), h('b', { text: `${fmt(rnd(first.y))} ${unit}` }), h('small', { text: fmtDate(first.date, true) })),
      h('div', null, h('small', { text: 'Último registro' }), h('b', { text: `${fmt(rnd(last.y))} ${unit}` }), h('small', { text: fmtDate(last.date, true) })),
      h('div', null, h('small', { text: 'Melhor marca' }), h('b', { text: `${fmt(rnd(best.y))} ${unit}` }), h('small', { text: fmtDate(best.date, true) })),
      h('div', null, h('small', { text: 'Variação' }),
        h('b', { class: diff > 0 ? 'pos' : diff < 0 ? 'neg' : '', text: `${diff > 0 ? '+' : ''}${fmt(rnd(diff))} ${unit}` }),
        h('small', { text: pts.length > 1 ? `${pct > 0 ? '+' : ''}${fmt(rnd(pct))}% · ${pts.length} sessões` : '1 sessão' })));
  }
  root.append(h('div', { class: 'card' },
    h('div', { class: 'row' },
      h('label', { class: 'field' }, h('span', { text: 'Exercício' }), selEx),
      h('label', { class: 'field' }, h('span', { text: 'Métrica' }), selMetric)),
    pts.length ? h('div', { class: 'chart-box' }, lineCanvas) : h('div', { class: 'empty', text: 'Sem dados para essa métrica.' }),
    pts.length ? tip : null, summary));

  // --- tabela geral
  const rows = exList.map(e => {
    const m = e.mode === 'tempo' ? 'best' : 'max';
    const vals = e.rows.map(r => metricValue(e.mode, m, r.sets)).filter(v => v != null);
    return { e, n: e.rows.length, last: vals[vals.length - 1], max: vals.length ? Math.max(...vals) : null, diff: vals.length > 1 ? vals[vals.length - 1] - vals[0] : null };
  });
  root.append(h('h3', { text: 'Todos os exercícios (carga máxima / melhor tempo)' }),
    h('div', { class: 'card table-wrap' }, h('table', null,
      h('thead', null, h('tr', null, ['Exercício', 'Sess.', 'Última', 'Máx.', 'Δ'].map(t => h('th', { text: t })))),
      h('tbody', null, rows.map(r => h('tr', { class: r.e.id === stFilter.ex ? 'sel' : '', onclick: () => { stFilter.ex = r.e.id; rerender(); window.scrollTo(0, 0); } },
        h('td', { text: r.e.name }), h('td', { text: String(r.n) }),
        h('td', { text: fmt(r.last) }), h('td', { text: fmt(r.max) }),
        h('td', { class: r.diff > 0 ? 'pos' : r.diff < 0 ? 'neg' : '', text: r.diff == null ? '–' : (r.diff > 0 ? '+' : '') + fmt(Math.round(r.diff * 10) / 10) })))))),
    h('p', { class: 'muted', text: 'Toque em uma linha para ver a evolução do exercício no gráfico. Δ = última marca menos a primeira do período.' }));

  requestAnimationFrame(() => {
    drawBars(barCanvas, weeks);
    if (pts.length) drawLine(lineCanvas, tip, pts, unit);
  });
}

let lastWidth = window.innerWidth;
window.addEventListener('resize', () => {
  if (window.innerWidth === lastWidth) return;   // ignora mudanças só de altura (barra do navegador no celular)
  lastWidth = window.innerWidth;
  if (tab === 'stats' && !$('#app').hidden) renderTab();
});

/* =====================================================================
   ABA: HISTÓRICO
   ===================================================================== */
function renderHist(root) {
  const ss = sortedSessions().reverse();
  root.append(h('h2', { text: 'Histórico' }));
  if (!ss.length) { root.append(h('div', { class: 'empty', text: 'Nenhum treino salvo ainda.' })); return; }
  for (const s of ss) {
    const d = parseISO(s.date);
    const vol = sessionVolume(s);
    root.append(h('details', { class: 'card' },
      h('summary', null,
        h('span', { class: 'letter', text: s.workout }),
        h('div', null,
          h('strong', { text: `${WEEKDAYS[d.getDay()]}, ${fmtDate(s.date, true)}` }),
          h('small', { text: `${workoutName(s.workout)} · ${s.entries.length} exercícios${vol ? ' · ' + fmt(Math.round(vol)) + ' kg' : ''}` }))),
      s.entries.map(e => h('div', { class: 'hist-ex' },
        h('strong', { text: e.name }),
        h('div', { class: 'sets-line', text: e.sets.map(st => e.mode === 'tempo' ? `${fmt(st.r)}s` : (st.w != null && st.r != null ? `${fmt(st.w)}×${fmt(st.r)}` : st.w != null ? `${fmt(st.w)} kg` : `${fmt(st.r)} reps`)).join(' · ') }),
        e.note ? h('small', { text: '📝 ' + e.note }) : null)),
      h('div', { class: 'ctrl', style: 'margin-top:10px' },
        h('button', { class: 'btn ghost sm', type: 'button', text: 'Editar', onclick: () => editSession(s.id) }),
        h('button', { class: 'btn danger sm', type: 'button', text: 'Excluir', onclick: async () => {
          if (!confirm(`Excluir o treino de ${fmtDate(s.date, true)}?`)) return;
          try {
            await api('deleteSession', { id: s.id });
            S.sessions = S.sessions.filter(x => x.id !== s.id);
            toast('Treino excluído');
            renderTab();
          } catch (e) { if (e.message !== 'auth') toast('Erro: ' + e.message, true); }
        } }))));
  }
}

boot();
