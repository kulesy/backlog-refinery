import { LEVELS, SCALE, SCORE_BANDS, levelForScore, readiness, acceptanceCriteria, isClose, GITMOJI, titleType } from './dor.js';

const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const STAGE = new URLSearchParams(location.search).has('stage');
const phone = () => matchMedia('(max-width:760px)').matches;
const RCOL = { Urgent: 'var(--legendary)', High: 'var(--epic)', Medium: 'var(--rare)', Low: 'var(--common)' };
const PILES = [['turn', 'Your turn'], ['claude', 'With Claude'], ['draft', 'Needs a draft'], ['ready', 'Ready']];
const PILE_NAME = { turn: 'Your turn', claude: 'With Claude', draft: 'Needs a draft', ready: 'Ready', progress: 'In progress', skipped: 'Skipped' };
const REWRITE = new Set(['rewrite-and-estimate', 'rewrite-body']);
const TEXT_KINDS = new Set(['close', 'comment', 'edit-body', 'new-issue', 'ask', 'edit-title']);
const POST_CAP = 1800;

document.body.classList.toggle('stage', STAGE);

// ---------- text helpers ----------
let stageCfg = { repos: [], hideLabels: ['security'], ids: [] };
// Set from /api/board (config.json) as soon as it loads.
let boardCfg = { name: '', owner: '', privateRepos: [], repoLabels: {} };
let privateMask = null;
function mask(s) {
  s = String(s ?? '');
  if (!STAGE) return s;
  const ok = stageCfg.repos.map(r => r.toLowerCase());
  return s.replace(/\/Users\/[^\s)'"`\]]+/g, 'a local file')
    .replace(/https?:\/\/github\.com\/([\w.-]+)\/([\w.-]+)(?:\/[^\s)'"`\]]*)?/g, (m, o, r) => ok.includes(r.toLowerCase()) ? m : 'a private issue')
    .replace(privateMask || /(?!)/, 'a private issue');
}
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const T = s => esc(mask(s));
const firstSentence = (s, max = 170) => {
  s = String(s || '').replace(/\s+/g, ' ').trim();
  const m = /^(.+?[.!?])(?:\s|$)/.exec(s);
  let out = m ? m[1] : s;
  if (out.length > max) out = out.slice(0, out.lastIndexOf(' ', max)) + '...';
  return out;
};
const list = a => a.length < 2 ? a.join('') : a.slice(0, -1).join(', ') + ' and ' + a[a.length - 1];
const days = d => d ? Math.max(0, Math.round((Date.now() - new Date(d + 'T00:00:00Z')) / 86400000)) : null;
const shortDate = iso => iso ? new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short' }) : '';
const colName = c => String(c || '').replace(/^[^A-Za-z]+/, '').trim();
const isPrivate = repo => boardCfg.privateRepos.includes(repo || '');
const issueLink = (url, label) => {
  const m = /github\.com\/[^/]+\/([^/]+)\/issues\/(\d+)/.exec(url || '');
  if (!m) return T(label || url);
  if (STAGE && mask(url) !== url) return 'a private issue';
  return `<a href="${esc(url)}" target="_blank" rel="noopener">${esc(m[1])}#${m[2]}</a>`;
};
const hash = s => { let h = 5381; for (let i = 0; i < s.length; i++) h = (h * 33 + s.charCodeAt(i)) | 0; return String(h >>> 0); };

// ---------- card types and art ----------
const TYPES = [
  ['bug', 'Bug', /^(🐛|🔴|🔥|🚨)/u, /^bug$/i, ['oklch(0.52 0.10 150)', 'oklch(0.28 0.07 160)']],
  ['security', 'Security', /^(🔐|🔑|🔒|🛡|🕵)/u, /^security$/i, ['oklch(0.48 0.12 20)', 'oklch(0.26 0.08 15)']],
  ['review', 'Review', /^(👀)/u, null, ['oklch(0.55 0.09 80)', 'oklch(0.30 0.06 70)']],
  ['design', 'Design', /^(🚸|💄|🎨)/u, /^(ux|design)$/i, ['oklch(0.52 0.13 340)', 'oklch(0.28 0.08 330)']],
  ['debt', 'Tech debt', /^(♻|🧹|🧱|⚙|🚚|🔧|🛠)/u, /^(technical-debt|refactor|chore)$/i, ['oklch(0.50 0.04 240)', 'oklch(0.28 0.03 245)']],
  ['docs', 'Docs', /^(📝|📃|📚|📖|📄)/u, /^documentation$/i, ['oklch(0.62 0.10 75)', 'oklch(0.34 0.07 65)']],
  ['spike', 'Spike', /^(🔭|🔍|🧪|🔬)/u, null, ['oklch(0.50 0.13 295)', 'oklch(0.27 0.09 290)']],
  ['feature', 'Feature', /^(✨|🚀|🌟|📊|📈|⚡|🎥|🤖|🔊|🗺)/u, /^enhancement$/i, ['oklch(0.52 0.10 230)', 'oklch(0.28 0.07 240)']],
];
const TYPE_ART = { feature: 'feature', bug: 'bug', refactor: 'debt', chore: 'debt', docs: 'docs', security: 'security', auth: 'security',
  secrets: 'security', ui: 'design', ux: 'design', perf: 'feature', infra: 'debt', analytics: 'review', spike: 'spike' };
function typeOf(it) {
  const t = String(it.title || '');
  const typed = (B && B.types && B.types[it.id] && B.types[it.id].type) || titleType(t);
  if (typed && GITMOJI[typed]) { const base = TYPES.find(ty => ty[0] === TYPE_ART[typed]); if (base) return [base[0], GITMOJI[typed][1], null, null, base[4]]; }
  if (/^\W*Spike\b/iu.test(t)) return TYPES.find(ty => ty[0] === 'spike');
  for (const ty of TYPES) if (ty[2].test(t)) return ty;
  for (const ty of TYPES) if (ty[3] && (it.labels || []).some(l => ty[3].test(l))) return ty;
  return ['crest', boardCfg.repoLabels[it.repo] || it.repo, null, null, ['oklch(0.46 0.07 210)', 'oklch(0.26 0.05 230)']];
}
const INK = 'oklch(0.27 0.03 50)', PAPER = 'oklch(0.94 0.03 85)', GOLD = 'oklch(0.80 0.11 84)';
const EMBLEM = {
  bug: `<ellipse cx="50" cy="60" rx="20" ry="26" fill="${PAPER}" stroke="${INK}" stroke-width="3"/><circle cx="50" cy="30" r="10" fill="${PAPER}" stroke="${INK}" stroke-width="3"/><path d="M50 36v48M30 50l-14-8M30 62H12M32 74l-14 10M70 50l14-8M70 62h18M68 74l14 10M44 22l-8-10M56 22l8-10" stroke="${INK}" stroke-width="3" stroke-linecap="round" fill="none"/>`,
  security: `<path d="M50 10l32 12v24c0 22-14 36-32 44C32 82 18 68 18 46V22z" fill="${PAPER}" stroke="${INK}" stroke-width="3" stroke-linejoin="round"/><circle cx="50" cy="46" r="8" fill="${INK}"/><path d="M47 50h6l3 18H44z" fill="${INK}"/>`,
  review: `<path d="M8 50c12-20 26-30 42-30s30 10 42 30c-12 20-26 30-42 30S20 70 8 50z" fill="${PAPER}" stroke="${INK}" stroke-width="3"/><circle cx="50" cy="50" r="15" fill="${GOLD}" stroke="${INK}" stroke-width="3"/><circle cx="50" cy="50" r="6" fill="${INK}"/>`,
  design: `<path d="M50 12C26 12 10 28 10 48c0 18 14 30 28 30 8 0 8-8 4-12-4-5 0-10 6-10h12c16 0 30-8 30-24 0-12-16-20-40-20z" fill="${PAPER}" stroke="${INK}" stroke-width="3"/><circle cx="32" cy="40" r="6" fill="oklch(0.58 0.19 305)"/><circle cx="50" cy="28" r="6" fill="oklch(0.64 0.15 245)"/><circle cx="68" cy="36" r="6" fill="oklch(0.77 0.16 62)"/>`,
  debt: `<path d="M44 8h12l2 10 8 4 9-6 8 8-6 9 4 8 10 2v12l-10 2-4 8 6 9-8 8-9-6-8 4-2 10H44l-2-10-8-4-9 6-8-8 6-9-4-8-10-2V44l10-2 4-8-6-9 8-8 9 6 8-4z" fill="${PAPER}" stroke="${INK}" stroke-width="3" stroke-linejoin="round"/><circle cx="50" cy="50" r="13" fill="${GOLD}" stroke="${INK}" stroke-width="3"/>`,
  docs: `<path d="M20 26h52q8 0 8 8v50q0 8-8 8H20z" fill="${PAPER}" stroke="${INK}" stroke-width="3"/><path d="M14 22q0-8 8-8h50q-6 4-6 12H22q-8 0-8-4z" fill="oklch(0.80 0.06 75)" stroke="${INK}" stroke-width="3"/><path d="M30 44h36M30 56h40M30 68h28M30 80h34" stroke="oklch(0.45 0.05 55)" stroke-width="3" stroke-linecap="round"/>`,
  spike: `<path d="M40 10h20M44 10v26L20 80q-4 10 8 10h44q12 0 8-10L56 36V10" fill="${PAPER}" stroke="${INK}" stroke-width="3" stroke-linejoin="round"/><path d="M28 68h44l8 14q2 6-6 6H26q-8 0-6-6z" fill="oklch(0.58 0.19 305)"/><circle cx="44" cy="58" r="3" fill="${INK}"/><circle cx="56" cy="50" r="2.5" fill="${INK}"/>`,
  feature: `<path d="M50 8l9 30 31 12-31 12-9 30-9-30-31-12 31-12z" fill="${GOLD}" stroke="${INK}" stroke-width="3" stroke-linejoin="round"/><path d="M80 14l3 9 9 3-9 3-3 9-3-9-9-3 9-3z" fill="${PAPER}" stroke="${INK}" stroke-width="2"/>`,
  crest: `<path d="M50 10l32 12v24c0 22-14 36-32 44C32 82 18 68 18 46V22z" fill="${PAPER}" stroke="${INK}" stroke-width="3" stroke-linejoin="round"/><path d="M36 34h28M50 34v36" stroke="${INK}" stroke-width="7" stroke-linecap="round"/>`,
};

// ---------- persistence ----------
// Draft edits merge per op, so a later edit to one op never drops a pending edit to another.
const mergePatch = (a, b) => {
  const out = Object.assign({}, a, b);
  if ((a && a.edits) || (b && b.edits)) out.edits = Object.assign({}, a && a.edits, b && b.edits);
  return out;
};
// A failed save stays on this device and retries with backoff; dropping one once lost 23 accepts on the phone.
// A save also stays in storage while in flight, and leaves only once the server confirms it.
function makeQueue(key, route, onSaved, onRefused) {
  let pending = {};
  try { pending = JSON.parse(localStorage.getItem(key) || '{}') || {}; } catch { pending = {}; }
  const q = { key, pending, inflight: {}, timer: null, retry: 5000, busy: false, failing: false };
  q.all = () => {
    const o = {};
    for (const k of new Set([...Object.keys(q.inflight), ...Object.keys(q.pending)])) o[k] = mergePatch(q.inflight[k], q.pending[k]);
    return o;
  };
  q.persist = () => { try { localStorage.setItem(key, JSON.stringify(q.all())); } catch {} };
  q.schedule = ms => { clearTimeout(q.timer); q.timer = setTimeout(q.flush, ms); };
  q.put = (id, patch, now) => { q.pending[id] = mergePatch(q.pending[id], patch); q.persist(); q.schedule(now ? 0 : 400); paintLedger(); };
  q.drop = id => { delete q.pending[id]; q.persist(); };
  q.count = () => Object.keys(q.all()).length;
  q.flush = async () => {
    if (q.busy) return q.schedule(300);
    const ids = Object.keys(q.pending);
    if (!ids.length) return paintLedger();
    q.busy = true;
    for (const id of ids) { q.inflight[id] = mergePatch(q.inflight[id], q.pending[id]); delete q.pending[id]; }
    q.persist(); paintLedger();
    let failed = 0;
    for (const id of ids) {
      const body = q.inflight[id];
      let res = null;
      try { res = await fetch(route + encodeURIComponent(id), { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }); } catch {}
      // A refusal is final (409: Claude already acted on it; 400: malformed), so it is dropped, not retried.
      if (res && (res.status === 409 || res.status === 400)) {
        delete q.inflight[id];
        let j = {};
        try { j = await res.json(); } catch {}
        try { onRefused(id, j, res.status); } catch {}
        continue;
      }
      if (!res || !res.ok) {
        // Put it back under anything newer the user did meanwhile, and try again later.
        q.pending[id] = mergePatch(q.inflight[id], q.pending[id]);
        delete q.inflight[id];
        failed++;
        continue;
      }
      delete q.inflight[id];
      // The server has the write, so a local bookkeeping error must never send it round again.
      try { onSaved(id, body); } catch {}
    }
    q.persist(); q.busy = false; q.failing = failed > 0;
    if (failed) { q.schedule(q.retry); q.retry = Math.min(q.retry * 2, 60000); }
    else { q.retry = 5000; if (Object.keys(q.pending).length) q.schedule(400); }
    paintLedger();
  };
  q.keepalive = () => {
    for (const [id, body] of Object.entries(q.all())) {
      try { fetch(route + encodeURIComponent(id), { method: 'PUT', keepalive: true, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }); } catch {}
    }
  };
  return q;
}

let B = null, ITEMS = [], BY = new Map();
const R = new Map();
const UI = new Map();
let OV = { d: {}, p: {}, c: {}, s: {} };

function refused(id, status) {
  if (B && BY.has(id)) { touch(id); render(); }
  toast(status === 409 ? `Claude already acted on ${mask(id)}, so that change was not recorded.` : `A save for ${mask(id)} was malformed and was dropped.`);
}
const QD = makeQueue('refinery-pending', 'api/decisions/', (id, body) => { if (B) B.decisions[id] = { ...(B.decisions[id] || {}), ...body }; },
  (id, j, st) => { if (B && j.record) B.decisions[id] = j.record; refused(id, st); });
const QP = makeQueue('refinery-prio-pending', 'api/priorities/', (id, body) => {
  if (!B) return;
  if (body.priority) B.prioPicks[id] = { priority: body.priority, at: new Date().toISOString() }; else delete B.prioPicks[id];
}, (id, j, st) => refused(id, st));
const QC = makeQueue('refinery-carry-pending', 'api/carry/', (id, body) => {
  if (!B) return;
  B.carry.picks[id] = mergePatch(B.carry.picks[id], body);
}, (id, j, st) => { if (B && j.record) B.carry.picks[id] = j.record; refused(id, st); });
const QS = makeQueue('refinery-score-pending', 'api/scores/', (id, body) => {
  if (!B) return;
  const p = B.scorePicks[id];
  if (body.score != null) B.scorePicks[id] = { score: body.score, at: new Date().toISOString(), ...(p && p.score === body.score && p.applied_at ? { applied_at: p.applied_at } : {}) };
  else delete B.scorePicks[id];
}, (id, j, st) => { if (B && j.record) B.scorePicks[id] = j.record; refused(id, st); });
const QUEUES = [QD, QP, QC, QS];

// A pending draft edit is keyed by op index, so it is only safe against the same set of ops it was written for.
const SIGKEY = 'refinery-carry-sig';
const opsSig = id => hash(JSON.stringify(((B.carry.drafts[id] || {}).ops || []).map(o => [o.kind, o.target, o.title, o.body])));
function readSigs() { try { return JSON.parse(localStorage.getItem(SIGKEY) || '{}') || {}; } catch { return {}; } }
function noteSig(id) { const s = readSigs(); s[id] = opsSig(id); try { localStorage.setItem(SIGKEY, JSON.stringify(s)); } catch {} }
function dropStaleCarry() {
  const s = readSigs(), dropped = [];
  for (const id of Object.keys(QC.pending)) if (s[id] && s[id] !== opsSig(id)) { QC.drop(id); dropped.push(id); }
  return dropped;
}

function overlay() { OV = { d: QD.all(), p: QP.all(), c: QC.all(), s: QS.all() }; }
function recsFor(id) {
  const d0 = B.decisions[id], dp = OV.d[id];
  const pp = OV.p[id];
  const c0 = B.carry.picks[id], cp = OV.c[id];
  return {
    d: dp ? Object.assign({}, d0, dp) : d0,
    g: B.prio[id],
    pk: pp ? (pp.priority ? { priority: pp.priority } : null) : B.prioPicks[id],
    cd: B.carry.drafts[id],
    ck: cp ? Object.assign({}, c0, cp, cp.edits ? { edits: Object.assign({}, c0 && c0.edits, cp.edits) } : {}) : c0,
    cp: B.carry.posted[id],
    ev: (B.evidence || {})[id],
    ty: (B.types || {})[id],
  };
}
// The pick with unsent saves laid over it. A different score drops applied_at, the way the server does.
function scorePick(id) {
  const q = OV.s[id], p = B.scorePicks[id] || null;
  if (!q) return p;
  return q.score == null ? null : { score: q.score, ...(p && p.score === q.score ? p : {}) };
}
// A card's score as every view shows it: the pick, else the board's, else the draft.
// draft: only drafted. claude: approved but not on the board yet, or the board differs. met: the board has it and agrees with any pick.
function scoreOf(it) {
  const pk = scorePick(it.id), draft = B.scores[it.id] || null, board = it.score;
  const n = pk ? pk.score : board != null ? board : draft ? draft.score : null;
  if (n == null) return null;
  return { n, pick: pk, draft, board, state: pk ? (board === pk.score ? 'met' : 'claude') : board != null ? 'met' : 'draft' };
}
const SCORE_TIP = { draft: 'Drafted score, not approved yet', claude: 'Approved. Claude sets it on the board when you say apply the scores', met: 'Score on the board' };
const scoreEl = (s, cls) => `<span class="${cls} ${s.state}" title="${esc(SCORE_TIP[s.state])}">${s.n}</span>`;
// What the number in the score input does to the board's Priority, or '' when its band already matches.
function scoreMoveText(it, s, raw) {
  const v = String(raw ?? '').trim(), n = Number(v);
  const to = v && Number.isInteger(n) ? levelForScore(n) : null;
  if (!to || to === it.prioLevel) return '';
  const change = it.prioLevel ? `moves Priority from ${it.prioLevel} to ${to}` : `sets Priority to ${to}`;
  if (s && s.pick && !s.pick.applied_at && s.pick.score === n) return `Your approved ${n} ${change} once Claude applies it.`;
  if (s && s.board === n) return `The board already has ${n}, so the next sync ${change}.`;
  return `Approving ${n} ${change}.`;
}
const bandText = level => SCORE_BANDS[level] ? `${level}, ${SCORE_BANDS[level][0]} to ${SCORE_BANDS[level][1]}` : '';
const intentOf = id => { const u = UI.get(id); return u ? { est: u.est, useBody: u.useBody, note: u.note, title: u.title } : null; };
const compute = id => { const r = readiness(BY.get(id), recsFor(id), intentOf(id), B.dor || {}); R.set(id, r); return r; };
function computeAll() { overlay(); for (const it of ITEMS) compute(it.id); }
function touch(id) { overlay(); compute(id); }

// ---------- per-card working state ----------
function uiFor(id) {
  if (UI.has(id)) return UI.get(id);
  const it = BY.get(id), r = R.get(id), rec = recsFor(id), sug = it.sug || {};
  const d = r.reopened ? {} : (rec.d || {});
  const hasDraft = (sug.body || '').length > 40;
  const ck = rec.ck || {};
  const edits = {};
  for (const [k, v] of Object.entries(ck.edits || {})) edits[k] = { ...v };
  const u = {
    useBody: true, showTitle: false, changeValue: false, noteOpen: !!(d.note && r.kind !== 'decide' && r.kind !== 'split'),
    body: d.body ?? (hasDraft ? sug.body : (it.body || '')),
    title: d.title ?? (sug.title || it.title),
    est: 'estimate' in d ? d.estimate : (Number(sug.estimate) > 0 ? Number(sug.estimate) : null),
    decide: (r.kind === 'decide' && d.note) || '',
    split: (r.kind === 'split' && d.note) || '',
    closeReason: d.close_reason ?? (sug.close_reason || ''),
    closeTarget: d.close_target ?? (sug.close_target || ''),
    note: (r.kind !== 'decide' && r.kind !== 'split' && d.note) || '',
    tab: {}, edits, off: new Set(ck.off || []), touched: new Set(),
  };
  UI.set(id, u);
  return u;
}
const touchedEdits = id => { const u = UI.get(id), out = {}; for (const n of u.touched) if (u.edits[n]) out[n] = u.edits[n]; return out; };
const locked = v => STAGE && mask(v) !== v;
function area(f, v, cls, label, extra = '') {
  return locked(v) ? `<div class="${cls} view">${T(v)}</div>` : `<textarea class="${cls}" data-f="${f}" ${extra} spellcheck="false" aria-label="${esc(label)}">${esc(v)}</textarea>`;
}
const agentText = s => String(s || '').replace(/\bthe deep verification\b/gi, 'the code check').replace(/\bdeep verification\b/gi, 'code check')
  .replace(/\bdeep[- ]verified\b/gi, 'checked against the code');

// An empty box goes with the agent's recommendation; with none to go with, the rationale stands in as before.
const ownCall = (v, sug) => {
  const own = String(v || '').trim(), rec = String(sug.recommended_decision || '').trim();
  if (own && own !== rec) return v;
  return own || rec ? null : sug.rationale || null;
};
const agentCall = (sug, label) => {
  const rec = sug.recommended_decision || sug.rationale || '';
  return rec ? `<div class="rec"><span class="lab">${sug.recommended_decision ? label : 'What the code check found'}</span><p>${T(agentText(rec))}</p></div>` : '';
};
// The action planFor() reads is derived here at the moment of approval; there is no picker for it.
function decisionPatch(it, r, u) {
  const sug = it.sug || {};
  if (r.kind === 'approve') {
    const d = recsFor(it.id).d || {};
    // set-estimate with no estimate is planFor's plain move to Backlog - Ready; via marks it so Skip can restore the old record.
    const p = { decision: 'accept', action: 'set-estimate', estimate: null, body: null, title: null, note: null, close_reason: null, close_target: null, edited: false, via: 'ready' };
    // The carried-out decision moves whole under prior, the way load-verify reopens one, so buildPlan plans the new accept.
    if (d.applied) { const { id: _id, ...old } = d; Object.assign(p, { applied: null, prior: old }); }
    return p;
  }
  const p = { decision: 'accept', estimate: null, body: null, title: null, note: null, close_reason: null, close_target: null };
  const note = (u.note || '').trim();
  if (note && !['decide', 'split'].includes(r.kind)) return { ...p, action: 'needs-decision', note, edited: true };
  const R0 = r.R;
  if (r.kind === 'close') {
    p.action = R0;
    p.close_reason = u.closeReason.trim() !== (sug.close_reason || '').trim() ? u.closeReason : null;
    // A prose close_target would be appended to the closing comment as "Superseded by", so not-planned sends none.
    p.close_target = R0 === 'close-superseded' ? u.closeTarget.trim() : '';
  } else if (r.kind === 'leave') {
    p.action = 'leave-as-is';
  } else if (r.kind === 'decide') {
    p.action = 'needs-decision';
    p.note = ownCall(u.decide, sug);
  } else if (r.kind === 'split') {
    p.action = 'split';
    p.note = ownCall(u.split, sug);
  } else if (r.kind === 'verify') {
    p.action = 'verify-first';
  } else {
    const useBody = REWRITE.has(R0) && u.useBody;
    const est = u.est || null;
    p.estimate = est;
    if (useBody) {
      p.action = est ? 'rewrite-and-estimate' : 'rewrite-body';
      if (u.body !== (sug.body || '')) p.body = u.body;
      if (u.title.trim() !== (sug.title || it.title).trim()) p.title = u.title.trim();
    } else if (est && it.ac) p.action = 'set-estimate';
    else if (est) {
      p.action = 'needs-decision';
      p.note = `Draft acceptance criteria and show me first, then set the estimate to ${est}.`;
    } else p.action = 'leave-as-is';
  }
  p.edited = p.action !== R0 || p.body != null || p.title != null || p.note != null || p.close_reason != null
    || (r.kind === 'refine' && (p.estimate || null) !== (Number(sug.estimate) > 0 ? Number(sug.estimate) : null));
  return p;
}

// ---------- navigation ----------
const nav = { view: 'table', pile: 'turn', deck: [], pos: 0, source: 'pile', label: '', lastDealt: null };
const curId = () => nav.deck[nav.pos] || null;
const PRANK = { Urgent: 0, High: 1, Medium: 2, Low: 3 };
function stageOk(it) {
  if (!STAGE) return true;
  if (stageCfg.ids && stageCfg.ids.length) return stageCfg.ids.includes(it.id);
  const hide = (stageCfg.hideLabels || []).map(l => l.toLowerCase());
  return stageCfg.repos.includes(it.repo) && !(it.labels || []).some(l => hide.includes(String(l).toLowerCase()));
}
function turnGroup(it, r) {
  if (r.decisionOpen) return r.reopened ? 2 : 3;
  if (r.kind === 'text') return /Backlog - Ready/.test(it.col || '') ? 0 : 1;
  return 4;
}
const scoreKey = it => { const s = scoreOf(it); return s ? s.n : -1; };
function byOrder(a, b) {
  return (b.deep ? 1 : 0) - (a.deep ? 1 : 0) || (PRANK[a.prioLevel] ?? 4) - (PRANK[b.prioLevel] ?? 4) || scoreKey(b) - scoreKey(a) || String(a.created || '9').localeCompare(String(b.created || '9'));
}
function pileItems(pile) {
  const its = ITEMS.filter(it => R.get(it.id).pile === pile && stageOk(it));
  if (STAGE && stageCfg.ids && stageCfg.ids.length) return its.sort((a, b) => stageCfg.ids.indexOf(a.id) - stageCfg.ids.indexOf(b.id));
  if (pile === 'turn') return its.sort((a, b) => turnGroup(a, R.get(a.id)) - turnGroup(b, R.get(b.id)) || byOrder(a, b));
  return its.sort(byOrder);
}
function openPile(pile, id) {
  nav.view = 'table'; nav.source = 'pile'; nav.pile = pile; nav.label = PILE_NAME[pile];
  nav.deck = pileItems(pile).map(i => i.id);
  nav.pos = Math.max(0, id ? nav.deck.indexOf(id) : 0);
  render();
}
function setHash() {
  const id = curId();
  const h = nav.view === 'coll' ? '#collection' : '#' + (nav.source === 'coll' ? 'collection' : nav.pile) + (id ? '/' + id.replace('#', '-') : '');
  history.replaceState(null, '', location.pathname + location.search + h);
}
function step(n) {
  const max = nav.deck.length;
  nav.pos = Math.min(Math.max(0, nav.pos + n), max);
  render();
  window.scrollTo({ top: 0, behavior: 'instant' });
}
function advance() {
  const start = nav.pos + 1;
  if (nav.source === 'pile' && nav.pile === 'turn') {
    let k = start;
    while (k < nav.deck.length && R.get(nav.deck[k]).pile !== 'turn') k++;
    nav.pos = k;
  } else nav.pos = Math.min(start, nav.deck.length);
  render();
  window.scrollTo({ top: 0, behavior: 'instant' });
}

// ---------- rendering: rail ----------
function counts() {
  const c = { turn: 0, claude: 0, draft: 0, ready: 0, progress: 0, skipped: 0 };
  for (const it of ITEMS) if (stageOk(it)) c[R.get(it.id).pile]++;
  return c;
}
function paintRail() {
  const c = counts();
  const backlog = c.turn + c.claude + c.draft + c.ready + c.skipped;
  $('#piles').innerHTML = PILES.map(([k, l]) => `<button class="pile ${k}" data-act="pile" data-pile="${k}" aria-pressed="${nav.view === 'table' && nav.source === 'pile' && nav.pile === k}"><b>${c[k]}</b><span>${l}</span></button>`).join('')
    + `<button class="pile coll" data-act="coll" aria-pressed="${nav.view === 'coll' || nav.source === 'coll'}">Collection</button>`
    + '<button class="pile scorechip" data-act="scores" aria-haspopup="dialog">Scores</button>';
  const seg = [['ready', 'var(--brass)'], ['claude', 'var(--quill)'], ['turn', 'var(--glow)'], ['skipped', 'var(--bronze)'], ['draft', 'var(--well)']];
  $('#readybar').innerHTML = seg.map(([k, col]) => `<i style="width:${backlog ? c[k] / backlog * 100 : 0}%;background:${col}"></i>`).join('');
  const n = readyNumbers();
  $('#readybar').title = `${n.met4} cards meet the Definition of Ready, and ${n.ready} of those have nothing left waiting`;
  const waiting = claudeWork();
  const w = waitCount(waiting);
  $('#endCnt').hidden = !w; $('#endCnt').textContent = w;
  $('#endTurn').classList.toggle('live', w > 0);
  document.documentElement.style.setProperty('--railh', $('.rail').offsetHeight + 'px');
  paintLedger();
}
let loadFailed = false;
function paintLedger() {
  const el = $('#ledger'); if (!el) return;
  if (!B && loadFailed) { el.className = 'ledger off'; $('#ledgerText').textContent = "Can't reach the server. Changes stay on this device."; return; }
  const n = QUEUES.reduce((a, q) => a + q.count(), 0);
  const failing = QUEUES.some(q => q.failing);
  el.className = 'ledger' + (n && failing ? ' off' : n ? ' busy' : '');
  $('#ledgerText').textContent = n && failing ? `${n} not saved yet. Retrying.` : n ? 'Saving' : 'Records only. All saved.';
}

// ---------- rendering: card face ----------
function face(it, r, now = false) {
  const c = r.checks, ty = typeOf(it), u = UI.get(it.id);
  const cls = now ? ['hs', nowChecks(r).met === 4 ? 'golden' : ''].join(' ')
    : ['hs', r.met === 4 ? 'golden' : '', r.pile === 'draft' ? 'grey' : '', r.pile === 'skipped' ? 'dim' : '', r.playable ? 'playable' : ''].join(' ');
  const e = c.effort;
  const manaVal = now ? it.est || '?' : e.split ? '?' : e.value || '?';
  const lvl = now ? it.prioLevel : c.value.level;
  const ch = !now && hasChanges(it, r, u);
  const sc = now ? (it.score != null ? { n: it.score, state: 'met' } : null) : scoreOf(it);
  return `<div class="${cls}" data-act="details" style="--art-a:${ty[4][0]};--art-b:${ty[4][1]}">
    <div class="frame">
      <div class="art"><svg viewBox="0 0 100 100" aria-hidden="true">${EMBLEM[ty[0]]}</svg></div>
      <div class="banner"><h2>${T(it.title)}</h2></div>
      <div class="fmeta">${STAGE && isPrivate(it.repo) ? '' : esc(it.id) + ' · '}${esc(colName(it.col))}${it.deep ? ' · code checked' : ''}</div>
      <div class="pips" aria-label="Ready now? ${r.closing && !now ? 'Closing' : `${r.met} of 4`}">${now ? pips(nowChecks(r)) : pips(r)}</div>
      <div class="rarity ${now ? (lvl ? 'met' : 'missing') : c.value.state}" style="--r:${RCOL[lvl] || 'var(--well)'}" title="Priority: ${esc(now ? lvl || 'none' : c.value.caption)}"></div>${sc ? scoreEl(sc, 'scn') : ''}
      <div class="textbox${ch ? ' rows' : ''}"><p${ch ? ' class="line"' : ''}><b>${esc(keyword(it, r))}.</b> ${T(cardLine(it, r))}</p>${ch ? `<div class="fc" id="chg">${changeCard(it, r, u)}</div>` : ''}</div>
      <div class="plate">${esc(ty[1])}</div>
      <button class="more-pill" data-act="details">Details</button>
      ${lvl === 'Urgent' && c.value.state === 'met' ? '<div class="crest">Urgent</div>' : ''}
    </div>
    <div class="gem mana-rim"></div>
    <div class="gem mana ${now ? (it.est ? 'met' : 'missing') : e.state}" title="Effort: ${esc(now ? it.est || 'none' : e.caption)}"><span class="n">${esc(manaVal)}</span></div>
  </div>`;
}
// Now shows only what the board already has: a drafted or waiting check is still missing until Claude acts.
const nowChecks = r => { const checks = {}; for (const [k, c] of Object.entries(r.checks)) checks[k] = { ...c, state: c.state === 'met' || c.state === 'none' ? c.state : 'missing' };
  return { checks, met: Object.values(checks).filter(c => c.state === 'met').length, closing: false }; };
const pips = r => ['detail', 'value', 'effort', 'approved'].map(k => `<span class="pip ${r.checks[k].state}">${CHECK_NAME[k]}</span>`).join('')
  + `<b>${r.closing ? 'Closing' : `${r.met}/4`}</b>`;
// The card is the main view. Details open the parchment: over the card on a phone, beside it on a wider screen.
const PHONE = matchMedia('(max-width:760px)');
const syncView = () => document.body.classList.toggle('cv', PHONE.matches || !document.body.classList.contains('details'));
PHONE.addEventListener('change', syncView);
function showDetails(on) {
  document.body.classList.toggle('details', on);
  syncView();
  const p = $('.parch');
  if (on && p) { p.scrollTop = 0; $$('textarea.now', p).forEach(autosize); }
  window.scrollTo({ top: 0, behavior: 'instant' });
}
function tile(it, r, cur) {
  const ty = typeOf(it), e = r.checks.effort, lvl = r.checks.value.level, sc = scoreOf(it);
  const n = e.value || '?';
  const tag = cur ? 'div' : 'button';
  return `<${tag} class="tile${cur ? ' cur' : ''}${r.met === 4 ? ' golden' : ''}${!cur && r.pile !== nav.pile && nav.source === 'pile' ? ' done' : ''}" ${cur ? '' : `data-act="goto" data-id="${esc(it.id)}"`} style="--art-a:${ty[4][0]};--art-b:${ty[4][1]}">
    <span class="g ${e.state === 'missing' ? 'missing' : ''}"><span class="n">${esc(n)}</span></span>
    <span class="t"><b>${T(it.title)}</b><small>${STAGE && isPrivate(it.repo) ? '' : esc(it.id) + ' · '}${esc(colName(it.col))}</small></span>
    ${sc ? scoreEl(sc, 'scn') : ''}<span class="r" style="--r:${RCOL[lvl] || 'var(--well)'}"></span>
  </${tag}>`;
}
function keyword(it, r) {
  switch (r.kind) {
    case 'refine': return r.R === 'set-estimate' ? 'Size it' : 'Rewrite';
    case 'decide': return 'Decide first';
    case 'split': return 'Split it';
    case 'close': return 'Close it';
    case 'leave': return 'Leave it';
    case 'verify': return 'Check the code';
    case 'text': return textLabel(it).word;
    case 'value': return 'Priority call';
    case 'approve': return 'Approve it';
    case 'claude': return r.closing ? 'Closing' : 'With Claude';
    case 'ready': return 'Ready';
    case 'progress': return 'In progress';
    case 'skipped': return 'Skipped';
    default: return 'Needs a draft';
  }
}
function cardLine(it, r) {
  const sug = it.sug || {}, cd = B.carry.drafts[it.id];
  if (cd && (r.carryOpen || r.carryWaiting) && !r.decisionOpen) return (cd.ops.find(o => o.why) || {}).why || cd.summary || '';
  if (r.kind === 'refine' && REWRITE.has(r.R)) return firstSentence(agentText(sug.body_summary || sug.rationale));
  if (r.closing) return firstSentence(agentText(sug.close_reason || sug.rationale));
  if (r.kind === 'value') return firstSentence((B.prio[it.id] || {}).reason);
  if (r.kind === 'approve') return 'Detail, Priority and Effort are met. One click from Ready.';
  if (r.pile === 'ready') return 'Meets all four checks of the Definition of Ready.';
  if (r.pile === 'draft') return (it.hasSug ? '' : 'No agent pass has run on this card yet. ') + gaps(it, r).join(' ');
  return firstSentence(agentText(sug.rationale));
}
function gaps(it, r) {
  const c = r.checks, out = [];
  if (c.detail.state === 'missing') out.push(c.detail.title && c.detail.title.state === 'missing' && c.detail.caption === c.detail.title.caption ? `The title needs its gitmoji.` : 'Detail has no draft yet.');
  if (c.value.state === 'missing') out.push(c.value.noEvidence ? 'Priority has no usage or error evidence checked yet.' : 'Priority needs a grade or your pick.');
  if (c.effort.state === 'missing') out.push('Effort has no estimate drafted yet.');
  if (c.approved.state === 'missing') out.push(c.approved.caption === 'Waiting on a code check' ? 'It is waiting on a code check.' : c.approved.caption === 'Held' ? 'It is held, so it stays out of Ready.' : 'It is not approved as ready.');
  return out;
}
function textLabel(it) {
  const ops = (B.carry.drafts[it.id] || {}).ops || [];
  const self = ops.filter(o => o.target === it.url);
  if (ops.length === 1 && self.length === 1 && ops[0].kind === 'edit-title') return { word: 'Retitle', approve: 'Approve title' };
  if (ops.length === 1 && self.length === 1 && ops[0].kind === 'edit-body') return { word: 'New body', approve: 'Approve body' };
  return { word: 'Carry it out', approve: `Approve ${ops.length} texts` };
}

// ---------- rendering: parchment ----------
function verdict(it, r, u) {
  const g = gaps(it, r).join(' ');
  if (r.pile === 'turn') {
    if (r.decisionOpen && u && (u.note || '').trim() && !['decide', 'split'].includes(r.kind)) return ["Your note replaces the agent's updates. Claude moves the card to Not Ready and carries out your note.", ''];
    if (r.kind === 'close') return ['Close it.', ''];
    if (r.kind === 'leave') return ['Leave it as it is.', ''];
    if (r.kind === 'approve') return ['Detail, Priority and Effort are met. Your click approves it as ready.', 'good'];
    if (r.kind === 'text') return r.met === 4 ? [`Ready. ${textLabel(it).word === 'Retitle' ? 'A new title' : 'A text'} waits for your click.`, 'good']
      : r.playable ? [`Ready once you approve the new title and Claude posts it.`, 'good']
      : [`Not ready yet. ${g} A text from your earlier decision waits for your click.`, ''];
    if (r.playable) return ['Every check is covered once you approve. Claude acts next.', 'good'];
    return [`Not ready yet. ${g}`.trim(), ''];
  }
  if (r.pile === 'claude') {
    if (r.closing) return ['Closing once Claude acts.', ''];
    if (r.carryFailed) return ['Claude could not post part of this. Rerun the poster to resume.', ''];
    return [g ? `Waiting for Claude. ${g}` : 'Waiting for Claude to act.', ''];
  }
  if (r.pile === 'ready') return ['Ready. All four checks met.', 'good'];
  if (r.pile === 'progress') return ['In progress. Refinement never moves it.', ''];
  if (r.pile === 'skipped') return [`Skipped${r.checks.approved.at ? ' on ' + shortDate(r.checks.approved.at) : ''}.`, ''];
  return [`Not ready. ${it.hasSug ? '' : 'No agent pass has run on this card yet. '}${g}`.trim(), ''];
}
const CHECK_NAME = { detail: 'Detail', value: 'Priority', effort: 'Effort', approved: 'Approved' };
const SUB = { detail: 'Enough detail to action', value: 'Business value and usage', effort: 'Story points', approved: 'Your click' };
const WORD = { missing: 'Missing', draft: 'Draft', claude: 'With Claude', met: 'Met', none: 'Not needed', skipped: 'Skipped' };
function row(key, name, check, body) {
  return `<div class="row" data-row="${key}"><div class="sock ${check.state}" data-sock="${key}" title="${esc(WORD[check.state])}"></div>
    <div><div class="rh"><h3>${name}</h3><span class="sub">${SUB[key]}</span><span class="st">${esc(WORD[check.state])}${(check.state === 'met' || check.state === 'claude') && check.caption && check.caption !== WORD[check.state] ? ': ' + esc(check.caption) : ''}</span></div>
    ${body ? `<div class="rb">${body}</div>` : ''}</div></div>`;
}
function bodyEditor(id, key, editable, draftText, currentText, label, op) {
  const u = UI.get(id);
  const tab = u.tab[key] || 'draft';
  const btn = (k, l) => `<button role="tab" data-act="tab" data-key="${key}" data-tab="${k}" aria-selected="${tab === k}">${l}</button>`;
  const field = op != null ? `data-f="opbody" data-op="${op}"` : `data-f="${key}"`;
  let pane;
  if (tab === 'current') pane = currentView(currentText);
  else if (tab === 'changes') pane = `<div class="diff" aria-label="Changes from the current body">${diffHtml(currentText, draftText)}</div>`;
  else if (editable && !locked(draftText)) pane = `<textarea class="editor" ${field} spellcheck="false" aria-label="${esc(label)}">${esc(draftText)}</textarea>`;
  else pane = `<pre class="editor view">${T(draftText)}</pre>`;
  return `<div class="tabs" role="tablist">${btn('draft', 'Draft')}${currentText != null ? btn('current', 'Current') + btn('changes', 'Changes') : ''}<span class="spacer"></span><span class="chars" data-len="${key}">${draftText.length} chars</span></div>${pane}`;
}
function cleanBody(body) {
  let text = String(body || '').replace(/&nbsp;/g, ' ');
  let chip = '';
  if (/^Requested by/i.test(text)) {
    const cut = text.search(/^#{1,6}\s/m);
    const head = cut > 0 ? text.slice(0, cut) : '';
    const video = /Watch the video \(([^)]*)\)\]\(([^)]+)\)/.exec(head);
    if (head) { chip = `From YakShaver${video ? `, video ${esc(video[1])}` : ''}`; text = text.slice(cut); }
  }
  return { chip, text: text.trim() };
}
function currentView(body) {
  const { chip, text } = cleanBody(body);
  return `<div class="editor view">${chip ? `<span class="yak">${chip}</span>\n` : ''}${T(text || '(empty)')}</div>`;
}
function diffHtml(a, b) {
  const x = String(a || '').split('\n'), y = String(b || '').split('\n');
  if (x.length * y.length > 400000) return '<div>Too long to compare here.</div>';
  const n = x.length, m = y.length, L = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) L[i][j] = x[i] === y[j] ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
  const out = [];
  let i = 0, j = 0;
  while (i < n && j < m) {
    if (x[i] === y[j]) { out.push(`<div>${T(x[i]) || ' '}</div>`); i++; j++; }
    else if (L[i + 1][j] >= L[i][j + 1]) out.push(`<div class="del">${T(x[i++]) || ' '}</div>`);
    else out.push(`<div class="add">${T(y[j++]) || ' '}</div>`);
  }
  while (i < n) out.push(`<div class="del">${T(x[i++]) || ' '}</div>`);
  while (j < m) out.push(`<div class="add">${T(y[j++]) || ' '}</div>`);
  return out.join('');
}
function crystals(u, sugEst) {
  return `<div class="crystals" role="group" aria-label="Effort">${SCALE.map(p => `<button class="crys${sugEst === p ? ' sug' : ''}" data-act="crys" data-v="${p}" aria-pressed="${u.est === p}" title="${p} points${sugEst === p ? ', suggested' : ''}"><span class="n">${p}</span></button>`).join('')}
    ${u.est && !SCALE.includes(u.est) ? `<button class="crys" data-act="crys" data-v="${u.est}" aria-pressed="true"><span class="n">${u.est}</span></button>` : ''}
    <button class="crys none" data-act="crys" data-v="none" aria-pressed="${!u.est}">none</button></div>`;
}
function gems(it, r) {
  const v = r.checks.value, picked = v.state === 'claude' ? v.level : null;
  return `<div class="gems" role="group" aria-label="Priority">${LEVELS.map((l, n) => `<button class="lvl${v.state === 'draft' && v.level === l ? ' sug' : ''}" data-act="lvl" data-lvl="${l}" aria-pressed="${picked === l}" style="--r:${RCOL[l]}"><i></i>${l}<span class="kbd">${n + 1}</span></button>`).join('')}</div>`;
}

function titleNote(it, r) {
  const t = r.checks.detail.title;
  if (!t || t.state === 'met') return '';
  const want = t.want && GITMOJI[t.want], have = titleType(it.title);
  const not = want && have && have !== t.want ? `, not ${GITMOJI[have][0]}` : '';
  const next = { draft: 'Approve the new title to fix it.', claude: 'Claude posts the new title next.' }[t.state] || 'The agent drafts the retitle on its next pass.';
  return `<p class="hint">${want ? `The title should lead with ${want[0]} for ${esc(want[1].toLowerCase())} work${not}.` : 'The title leads with no gitmoji from the set.'} ${next}</p>`;
}
function detailRow(it, r, u) {
  const html = detailRowInner(it, r, u);
  const note = titleNote(it, r);
  if (!note) return html;
  return html.includes('<details class="more"') ? html.replace('<details class="more"', `${note}<details class="more"`) : html.replace(/<\/div><\/div>$/, `${note}</div></div>`);
}
function detailRowInner(it, r, u) {
  const c = r.checks.detail, sug = it.sug || {};
  if (c.state === 'none' || c.state === 'claude') return row('detail', 'Detail', c, '');
  if (c.caption === 'Your note') return row('detail', 'Detail', c, `<p>Your note below replaces the agent's updates.</p>`);
  if (r.kind === 'refine' && REWRITE.has(r.R)) {
    const ac = acceptanceCriteria(u.body);
    const titleDiffers = (sug.title || '').trim() && sug.title.trim() !== it.title.trim();
    const showTitle = titleDiffers || u.showTitle || u.title.trim() !== it.title.trim();
    let b = `<p>${ac ? `The agent drafted a body with ${ac.items === 1 ? '1 acceptance criterion' : `${ac.items || 'its'} acceptance criteria`}.` : 'The agent drafted a new body.'}${sug.body_summary ? ' ' + T(firstSentence(agentText(sug.body_summary), 260)) : ''}</p>
      <div class="switch" role="group" aria-label="Body"><button data-act="usebody" data-v="1" aria-pressed="${u.useBody}">Use the draft</button><button data-act="usebody" data-v="0" aria-pressed="${!u.useBody}">Keep current body</button></div>`;
    if (u.useBody) {
      b += showTitle
        ? `<div class="titles"><span class="lab">Title</span>${u.title.trim() !== it.title.trim() ? `<div class="was">${T(it.title)}</div>` : ''}${area('title', u.title, 'now', 'New title', 'rows="1"')}</div>`
        : `<p><button class="linkbtn" data-act="showtitle">Change the title too</button></p>`;
      b += `<div>${bodyEditor(it.id, 'body', true, u.body, it.body, 'Draft body')}</div>`;
    } else if (it.ac) b += `<p class="hint">Keeps the current body.</p>`;
    else b += `<p class="hint">${u.est ? 'The current body has no acceptance criteria, so Claude drafts them and shows you first, then sets the estimate.' : 'Keeps the current body, which has no acceptance criteria.'}</p>`;
    return row('detail', 'Detail', c, b);
  }
  if (r.kind === 'decide') {
    const basis = sug.decision_basis && sug.decision_basis.trim() !== (sug.rationale || '').trim() && sug.decision_basis.trim() !== (sug.recommended_decision || '').trim() ? `<p class="hint">${T(agentText(sug.decision_basis))}</p>` : '';
    return row('detail', 'Detail', c, `<p>A decision is needed before this can be written up.</p>${agentCall(sug, 'The agent recommends')}${basis}
      <label class="yours"><span class="lab">Your decision</span>${area('decide', u.decide, 'box', 'Your decision', `placeholder="Leave empty to go with the agent's recommendation."`)}</label>
      <p class="hint">Approving tells Claude to carry out your decision, or the agent's if you leave it empty. It drafts any posts and shows you them first.</p>`);
  }
  if (r.kind === 'refine' && !it.ac) return row('detail', 'Detail', c, `<p>No acceptance criteria. With an estimate picked, approving asks Claude to draft them and show you first, then size it.</p>`);
  const read = `<details class="more" style="border:0;padding:0"><summary>Read the issue${it.body ? ` (${(it.body.length / 1000).toFixed(1)}k chars)` : ''}</summary><div class="in">${currentView(it.body)}</div></details>`;
  if (c.state === 'met') return row('detail', 'Detail', c, read);
  if (it.ac) return row('detail', 'Detail', c, `<p>Has ${it.ac.items ? `${it.ac.items} acceptance ${it.ac.items === 1 ? 'criterion' : 'criteria'}` : 'acceptance criteria in prose'}.</p>${read}`);
  return row('detail', 'Detail', c, `<p>No acceptance criteria.${r.pile === 'draft' ? ' The agent has not drafted any yet.' : ''}</p>`);
}
const fmt = n => n == null ? '' : Number(n).toLocaleString();
function evidenceBlock(it, r) {
  const ev = (B.evidence || {})[it.id];
  if (!(B.dor || {}).evidence && !ev) return '';
  if (!ev || !ev.checked_at) return `<p class="hint">No usage or error evidence checked yet. The agent checks PostHog and CloudWatch before this can be Ready.</p>`;
  const line = (label, v, users, metric, src) => v == null ? '' : `<li><b>${label}</b> ${fmt(v)} ${T(metric)}${users != null ? `, ${fmt(users)} users` : ''} <span class="hint">${esc(src === 'posthog' ? 'PostHog' : src === 'cloudwatch' ? 'CloudWatch' : src)}, 30 days</span></li>`;
  const rows = ev.applies === false ? `<li>${T(ev.no_signal_reason || 'No usage or error signal applies.')}</li>`
    : line('Usage', ev.usage && ev.usage.value, ev.usage && ev.usage.users, ev.usage && ev.usage.metric, ev.usage && ev.usage.source)
      + line('Errors', ev.errors && ev.errors.value, ev.errors && ev.errors.users, ev.errors && ev.errors.metric, ev.errors && ev.errors.source);
  return `<div class="ev"><ul>${rows}</ul>${ev.summary ? `<p>${T(ev.summary)}</p>` : ''}<p class="hint">Evidence checked ${esc(shortDate(ev.checked_at))}${ev.suggested ? `, suggests ${esc(ev.suggested)} (${esc(ev.confidence)} confidence)` : ''}.</p></div>`;
}
// The score under the Priority row: where it sits, why, and the one number Eli can approve or change.
function scoreBlock(it, r, u) {
  const s = scoreOf(it), d = s && s.draft, pk = s && s.pick, v = r.checks.value;
  const lc = d && d.level_change && d.level_change !== it.prioLevel ? d.level_change : null;
  const band = bandText(d ? d.level : it.prioLevel), rt = d && d.ratings;
  const picked = v.state === 'claude' && v.level === lc;
  const how = picked ? `You picked ${esc(lc)}, so it moves when Claude applies the priorities.`
    : `Approving the score moves Priority to ${esc(lc)}.`;
  let note;
  if (!s) note = 'No score yet. Type one, or wait for the agent to draft it.';
  else if (pk && pk.applied_at) note = s.board === pk.score ? `On the board as ${pk.score}.` : s.board == null ? `Claude set ${pk.score} on the board. Refresh from GitHub to see it.` : `Claude set ${pk.score}, but the board now shows ${s.board}.`;
  else if (pk) note = `You approved ${pk.score}. Claude sets it on the board when you say apply the scores.`;
  else if (s.state === 'met') note = `The board has ${s.board}. A new score replaces it once Claude applies it.${d && d.score !== s.board ? ` The agent's draft is ${d.score}.` : ''}`;
  else note = `Drafted by the agent. Approve it to record ${s.n}, or change the number first.`;
  return `<div class="sblock" id="sblock">
    <div class="sl"><span class="lab">Priority score</span>${s ? `<b class="sv ${s.state}">${s.n}</b><span class="hint">out of 100</span>` : ''}${band ? `<span class="sband">${esc(band)}</span>` : ''}</div>
    ${lc ? `<p class="lc"><b>Scores as ${esc(lc)}${it.prioLevel ? `, not ${esc(it.prioLevel)}` : ', and the board has no level'}.</b> ${T(d.reason)} ${how}</p>` : d && d.reason ? `<p>${T(d.reason)}</p>` : ''}
    ${rt ? `<p class="hint">Goal ${rt.goal}, evidence ${rt.evidence}, value ${rt.value}, size ${rt.size}</p>` : ''}
    <p class="hint">${esc(note)}</p>
    <div class="sctl"><input class="sin" type="number" min="0" max="100" step="1" inputmode="numeric" data-score-in value="${s ? s.n : ''}" aria-label="Priority score, 0 to 100">
      <button class="btn" data-act="approvescore">Approve score</button>${pk && !pk.applied_at ? '<button class="linkbtn" data-act="clearscore">Clear</button>' : ''}</div>
    <p class="smove" data-score-move>${esc(scoreMoveText(it, s, s ? s.n : ''))}</p>
  </div>`;
}
function valueRow(it, r, u) {
  const c = r.checks.value, g = B.prio[it.id], ev = (B.evidence || {})[it.id];
  if (c.state === 'none') return row('value', 'Priority', c, '');
  if (c.state === 'met' && !u.changeValue) return row('value', 'Priority', c, `${evidenceBlock(it, r)}<p><button class="linkbtn" data-act="changevalue">Change</button></p>${scoreBlock(it, r, u)}`);
  let lead = '';
  if (c.state === 'draft' && c.fromEvidence) lead = `<p>The evidence suggests <b>${esc(c.level)}</b>${it.prioLevel ? `, where the board says ${esc(it.prioLevel)}` : ''}.</p>${evidenceBlock(it, r)}<p class="hint">Approving records ${esc(c.level)}. Pick another level to change it.</p>`;
  else if (c.state === 'draft') lead = `<p>Suggested <b>${esc(c.level)}</b>${g.business_call ? ', a Product Owner call' : ''}${g.confidence && g.confidence !== 'high' ? `, ${esc(g.confidence)} confidence` : ''}. ${T(g.reason)}</p>${evidenceBlock(it, r)}<p class="hint">Approving records ${esc(c.level)}. Pick another level to change it.</p>`;
  else if (c.noEvidence) lead = `<p>The board says ${esc(c.level)}, but nothing has checked how much this is used or how many errors come from it.</p>${evidenceBlock(it, r)}`;
  else if (c.state === 'claude') lead = `<p>You picked <b>${esc(c.level)}</b>. Claude sets it on the board when you say apply the priorities.</p>`;
  else if (c.state === 'met') lead = `<p>The board says ${esc(c.level)}.${it.score != null ? '' : ' A new pick replaces it once Claude applies it.'}</p>`;
  else lead = `<p>No priority. ${g ? T(g.reason) : 'Your call as Product Owner. The agent has not graded this.'}</p>${evidenceBlock(it, r)}`;
  const follows = it.score != null ? '<p class="hint">Priority follows the score. Change the score to move it.</p>' : '';
  return row('value', 'Priority', c, lead + gems(it, r) + follows + scoreBlock(it, r, u));
}
function effortRow(it, r, u) {
  const c = r.checks.effort, sug = it.sug || {};
  const reason = agentText(sug.estimate_reason);
  if (c.state === 'none') return row('effort', 'Effort', c, '');
  if (r.decisionOpen && c.state === 'draft' && c.split) {
    return row('effort', 'Effort', c, `<p>Too big for one card${Number(sug.estimate) > 0 ? `, about ${Number(sug.estimate)} in total` : ''}.</p>${agentCall(sug, 'The agent would split it')}
      <label class="yours"><span class="lab">Your split</span>${area('split', u.split, 'box', 'How to split it', `placeholder="Leave empty to go with the agent's split."`)}</label>`);
  }
  if (r.decisionOpen && r.kind === 'refine') {
    const sugEst = Number(sug.estimate) || 0;
    return row('effort', 'Effort', c, `${crystals(u, sugEst)}${sugEst ? `<p class="hint">Suggested ${sugEst}.${reason ? ' ' + T(reason) : ''}</p>` : '<p class="hint">The agent did not suggest a size.</p>'}`);
  }
  if (r.kind === 'decide') return row('effort', 'Effort', c, `<p class="hint">Sized after the decision.${Number(sug.estimate) > 0 ? ` The agent's guess is ${Number(sug.estimate)}.` : ''}</p>`);
  if (c.state === 'met' && c.offScale) return row('effort', 'Effort', c, `<p class="hint">Off the 2, 4, 8, 16 scale.</p>`);
  if (c.state === 'missing') return row('effort', 'Effort', c, `<p>Not sized. No estimate drafted yet.</p>`);
  return row('effort', 'Effort', c, '');
}
function opHead(it, o) {
  const self = o.target === it.url;
  switch (o.kind) {
    case 'edit-title': return self ? 'New title' : `Retitle ${issueLink(o.target)}`;
    case 'edit-body': return self ? 'New body' : `Rewrite the body of ${issueLink(o.target)}`;
    case 'close': return `Close ${issueLink(o.target)} as ${esc(({ completed: 'completed', not_planned: 'not planned', duplicate: 'duplicate' })[o.state_reason] || 'completed')}`;
    case 'comment': return `Comment on ${issueLink(o.target)}`;
    case 'new-issue': return `New issue in ${T(o.repo)}`;
    case 'estimate': return `Estimate ${esc(o.estimate)} on ${issueLink(o.target)}`;
    case 'sub-issue': return `Make ${issueLink(o.body)} a sub-issue of ${issueLink(o.target)}`;
    case 'ask': return `Ask ${T(o.target)}`;
  }
  return esc(o.kind);
}
function textOps(it, r, u) {
  const cd = B.carry.drafts[it.id], ops = cd.ops || [];
  const ck = recsFor(it.id).ck || {};
  const live = r.carryOpen, skipped = ck.decision === 'skip';
  const out = ops.map((o, n) => {
    const e = u.edits[String(n)] || {};
    const body = e.body ?? o.body ?? '', title = e.title ?? o.title ?? '';
    const isText = TEXT_KINDS.has(o.kind);
    const cap = o.kind === 'ask' || o.kind === 'edit-title' ? 0 : POST_CAP;
    const status = ((B.carry.posted[it.id] || {}).ops || {})[String(n)];
    const ro = !live || locked(body) || locked(title);
    let field = '';
    if (o.kind === 'edit-title') field = `<div class="titles">${o.target === it.url ? `<div class="was">${T(it.title)}</div>` : ''}${ro ? `<div class="now view">${T(body)}</div>` : `<textarea class="now" rows="1" data-f="opbody" data-op="${n}" spellcheck="false" aria-label="New title">${esc(body)}</textarea>`}</div>`;
    else if (o.kind === 'edit-body' && o.target === it.url) field = bodyEditor(it.id, 'op' + n, live, body, it.body, 'New body', n);
    else if (isText) field = `${o.kind === 'new-issue' ? (ro ? `<div class="now view">${T(title)}</div>` : `<input class="now" data-f="optitle" data-op="${n}" value="${esc(title)}" spellcheck="false" aria-label="Issue title">`) : ''}
      ${ro ? `<div class="box view" style="margin-top:6px">${T(body)}</div>` : `<textarea class="box" data-f="opbody" data-op="${n}" spellcheck="false" aria-label="Text" style="margin-top:6px;min-height:${o.kind === 'new-issue' ? 200 : 96}px">${esc(body)}</textarea>`}
      ${cap ? `<div class="len${body.length > cap ? ' over' : ''}" data-oplen="${n}">${body.length} chars${body.length > cap ? ` over the ${cap} cap` : ''}</div>` : ''}`;
    return `<div class="op${u.off.has(n) ? ' off' : ''}" data-opbox="${n}">
      <div class="oh">${opHead(it, o)}${o.kind === 'ask' ? ' <span class="hint">You send this on Teams. It is never posted.</span>' : ''}
        ${ops.length > 1 && live ? `<label class="inc"><input type="checkbox" data-inc="${n}" ${u.off.has(n) ? '' : 'checked'}> include</label>` : ''}
        ${status ? `<span class="hint" style="margin-left:auto">${esc(status.status === 'ok' ? 'Posted' : status.status)}${status.note ? ': ' + T(status.note) : ''}${status.error ? ': ' + T(status.error) : ''}</span>` : ''}</div>
      ${o.why ? `<p class="why">${T(o.why)}</p>` : ''}${field}</div>`;
  }).join('');
  const sum = cd.summary && !ops.some(o => o.why && cd.summary.trim() === ('Retitle. ' + o.why).trim()) && !ops.some(o => o.why && o.why.trim() === cd.summary.trim()) ? `<p class="hint">${T(cd.summary)}</p>` : '';
  const acc = cd.accepted_decision && !/^Current title:/.test(cd.accepted_decision) ? `<details class="more"><summary>What you approved earlier</summary><div class="in">${T(cd.accepted_decision)}</div></details>` : '';
  const head = live ? 'Waiting for your click' : skipped ? 'Skipped text' : 'Texts for Claude';
  return `<div class="row" data-row="text"><div class="sock ${live ? 'draft' : skipped ? 'skipped' : r.carryWaiting ? 'claude' : 'met'}"></div><div>
    <div class="rh"><h3>${head}</h3><span class="sub">${skipped ? 'Not posted. Unskip to bring it back.' : 'From your earlier decision'}</span></div>
    <div class="rb">${sum}${cd.waiting_on ? `<div class="band"><p><b>Waiting on:</b> ${T(cd.waiting_on)}</p></div>` : ''}${cd.skipped ? `<p class="hint">Not drafted: ${T(cd.skipped)}</p>` : ''}
    <div class="ops">${out || '<p class="hint">Nothing to post for this one.</p>'}</div>${acc}</div></div></div>`;
}
function whyBlock(it, r) {
  const sug = it.sug || {};
  if (!it.hasSug) return '';
  const parts = [];
  if (sug.rationale && !['decide', 'split'].includes(r.kind)) parts.push(`<p>${T(agentText(sug.rationale))}</p>`);
  const info = sug.needs_info || [];
  const open = info.filter(x => !/^Evidence:/i.test(x)), ev = info.filter(x => /^Evidence:/i.test(x));
  if (open.length) parts.push(`<p class="lab" style="margin-top:10px">Still missing</p><ul>${open.map(x => `<li>${T(x)}</li>`).join('')}</ul>`);
  if (ev.length) parts.push(`<details style="margin-top:8px"><summary class="hint">Evidence (${ev.length})</summary><ul>${ev.map(x => `<li>${T(x.replace(/^Evidence:\s*/i, ''))}</li>`).join('')}</ul></details>`);
  if (!parts.length) return '';
  return `<details class="more" open><summary>Why the agent thinks so</summary><div class="in">${parts.join('')}</div></details>`;
}
function dupesBlock(it) {
  const ds = (it.dupes || []).filter(dp => !STAGE || stageCfg.repos.includes(dp.repo));
  if (!ds.length) return '';
  return `<details class="more"><summary>Possible duplicates (${ds.length})</summary><div class="in">${ds.map(dp => `<div class="dupe"><span class="hint">${esc(dp.score)}</span>${issueLink(`https://github.com/${boardCfg.owner}/${dp.repo}/issues/${dp.num}`)}<span>${T(dp.title)}</span></div>`).join('')}<p class="hint">Text similarity only. Some of these are deliberately separate.</p></div></details>`;
}
function noteBlock(it, r, u) {
  if (!r.decisionOpen || ['decide', 'split'].includes(r.kind)) return '';
  if (!u.noteOpen && !u.note) return `<p style="margin:14px 0 0"><button class="linkbtn" data-act="noteopen">Tell Claude something else</button></p>`;
  return `<div class="band"><label><span class="lab">Tell Claude something else</span>${area('note', u.note, 'box', 'Your note to Claude', `placeholder="Your own call. It replaces the agent's updates."`)}</label></div>`;
}
function reopenedBand(it, r) {
  if (!r.reopened) return '';
  const d = recsFor(it.id).d || {};
  const earlier = d.prior && d.prior.note ? `<p class="earlier">Your call on ${shortDate(d.prior.at)}: <q>${T(d.prior.note)}</q> <button class="linkbtn" data-act="useearlier">Use it instead</button></p>` : '';
  return `<div class="band"><p><b>You reopened this. The agent checked again.</b></p>${earlier}</div>`;
}
function closeBand(it, r, u) {
  const sug = it.sug || {};
  if (r.kind === 'close') return `<div class="band"><p><b>The agent recommends closing this, not making it ready.</b></p>
    ${r.R === 'close-superseded' ? `<label><span class="lab">Superseded by</span>${locked(u.closeTarget) ? `<div class="now view">${T(u.closeTarget)}</div>` : `<input class="now" data-f="closeTarget" value="${esc(u.closeTarget)}" spellcheck="false" placeholder="https://github.com/${esc(boardCfg.owner)}/...">`}</label>` : ''}
    <label><span class="lab">Closing comment</span>${area('closeReason', u.closeReason, 'box', 'Closing comment')}</label></div>`;
  if (r.kind === 'leave') return `<div class="band"><p>${T(firstSentence(agentText(sug.rationale), 300))}</p></div>`;
  return '';
}
function approveLabel(it, r, u) {
  if (r.pile !== 'turn') return null;
  if (r.decisionOpen) {
    if ((u.note || '').trim() && !['decide', 'split'].includes(r.kind)) return 'Approve your note';
    switch (r.kind) {
      case 'close': return 'Approve closing';
      case 'leave': return 'Agree, leave it';
      case 'decide': return 'Approve decision';
      case 'split': return 'Approve split';
      case 'verify': return 'Approve code check';
      case 'approve': return 'Approve as ready';
      default: {
        const n = [REWRITE.has(r.R) && u.useBody, !!u.est, r.checks.value.state === 'draft'].filter(Boolean).length;
        if (!n) return 'Agree, leave it';
        if (u.est && !it.ac && !(REWRITE.has(r.R) && u.useBody)) return 'Approve criteria and estimate';
        return n > 1 ? `Approve ${n} updates` : REWRITE.has(r.R) && u.useBody ? 'Approve body' : u.est ? 'Approve estimate' : 'Approve priority';
      }
    }
  }
  if (r.kind === 'approve') return 'Approve as ready';
  if (r.carryOpen) return textLabel(it).approve + (r.checks.value.state === 'draft' ? ` and ${r.checks.value.level}` : '');
  if (r.gradeOpen) return `Approve ${r.checks.value.level}`;
  return null;
}
// Skip on an approved card takes it back from Claude, as it always has, until Claude has acted on any of it.
function takeBack(it, r) {
  const d = recsFor(it.id).d || {};
  if (r.pendingAccept) return d.via === 'ready' && d.prior && d.prior.applied ? 'restore' : 'decision';
  if (r.carryWaiting && !Object.keys((B.carry.posted[it.id] || {}).ops || {}).length) return 'carry';
  return null;
}
function canApprove(it, r, u) {
  if (r.pile !== 'turn') return false;
  if (r.carryOpen && !r.decisionOpen) return ((B.carry.drafts[it.id] || {}).ops || []).some((o, n) => !u.off.has(n));
  return true;
}
function actBar(it, r, u) {
  const a = r.checks.approved;
  const lab = approveLabel(it, r, u);
  // Where the card marks its changes the list beside it names them; elsewhere on a phone the button keeps to one word.
  const marks = !!lab && showsPair(it, r, u), text = lab;
  const short = !marks && lab && /^Approve ./.test(lab) && hasChanges(it, r, u);
  const ok = canApprove(it, r, u);
  const d = recsFor(it.id).d || {}, ck = recsFor(it.id).ck || {};
  const skipped = (r.decisionOpen && d.decision === 'skip') || ck.decision === 'skip' || d.decision === 'skip';
  const total = nav.deck.length;
  const skipLabel = skipped ? 'Unskip' : 'Skip';
  const canSkip = (r.pile === 'turn' && r.kind !== 'approve') || skipped;
  const canUndo = r.pile === 'claude' && reopenPatches(it.id).length > 0;
  const why = r.pile !== 'turn' ? (r.pile === 'claude' ? 'Waiting for Claude' : r.pile === 'ready' ? 'Already ready' : r.pile === 'progress' ? 'In progress' : r.pile === 'skipped' ? 'Skipped' : 'Nothing to approve yet') : (ok ? '' : 'Nothing ticked. Skip instead.');
  return `<div class="act">
    <div class="sock ${a.state}" data-sock="approved"></div>
    <div class="rh"><h3>Approved</h3><span class="sub">${esc(a.state === 'met' ? `${a.caption}${a.at ? ', ' + shortDate(a.at) : ''}` : a.state === 'skipped' ? 'Skipped' : 'Your click')}</span></div>
    <div class="btns">
      <button class="nav mnav" data-act="prev" aria-label="Back" ${nav.pos ? '' : 'disabled'}>&larr;</button>
      <span class="mpos">${Math.min(nav.pos + 1, total)}/${total}</span>
      <button class="nav mnav" data-act="next" aria-label="Next" ${nav.pos < total - 1 ? '' : 'disabled'}>&rarr;</button>
      ${canSkip ? `<button class="btn" data-act="skip" aria-pressed="${skipped}">${skipLabel}<span class="kbd">s</span></button>` : ''}
      ${canUndo ? `<button class="btn" data-act="undo" data-id="${esc(it.id)}">Undo approval<span class="kbd">u</span></button>` : ''}
      <button class="approve${r.pile === 'ready' ? ' done' : ''}${short ? ' sh' : ''}" data-act="approve" ${lab && ok ? '' : 'disabled'} title="${esc(marks && ok ? lab : why)}"><span class="long">${esc(text || (r.pile === 'ready' ? 'Ready' : why))}</span>${short ? '<span class="short">Approve</span>' : ''}<span class="kbd">a</span><small>Records only</small></button>
    </div></div>`;
}
function planLine(p) {
  if (!p) return '';
  const out = [];
  for (const s of p.steps || []) {
    if (s.kind === 'estimate') out.push(`set the estimate to ${s.value}`);
    else if (s.kind === 'status') out.push(s.value === 'ready' ? 'move it to Backlog - Ready' : s.value === 'notReady' ? 'move it to Backlog - Not Ready' : `set its status to ${s.value}`);
    else if (s.kind === 'close') out.push(`close it as ${s.reason || 'not planned'}`);
  }
  const t = p.text || {};
  if (t.title) out.push('retitle it');
  if (t.body) out.push('post the new body');
  if (t.comment) out.push('post the closing comment');
  if (t.decision) out.push('carry out your decision');
  if (t.split) out.push('split it as written');
  if (!out.length) return 'Claude will change nothing on the board.';
  return `Claude will ${list(out)}${t.title || t.body || t.comment || t.decision || t.split ? ', showing you any text in chat before it posts' : ''}.`;
}
const previewCache = new Map();
let previewTimer = null;
function willLine(it, r, u) {
  if (r.pile === 'claude' && B.planned[it.id]) return planLine(B.planned[it.id]);
  if (r.pile !== 'turn') return '';
  if (r.decisionOpen || r.kind === 'approve') {
    const key = it.id + JSON.stringify(decisionPatch(it, r, u));
    if (previewCache.has(key)) return previewCache.get(key);
    clearTimeout(previewTimer);
    previewTimer = setTimeout(() => fetchPreview(it.id), nav.lastDealt === it.id ? 400 : 0);
    return 'Working out what Claude will do.';
  }
  if (r.carryOpen) return `Claude will post ${textLabel(it).word === 'Retitle' ? 'the new title' : 'the ticked texts'} exactly as approved, when you say post the approved drafts.`;
  if (r.gradeOpen) return `Claude will set the priority on the board when you say apply the priorities.`;
  return '';
}
async function fetchPreview(id) {
  const it = BY.get(id), r = R.get(id), u = UI.get(id);
  if (!it || !r || !(r.decisionOpen || r.kind === 'approve')) return;
  const patch = decisionPatch(it, r, u);
  const key = id + JSON.stringify(patch);
  if (previewCache.has(key)) return paintWill();
  try {
    const res = await fetch('api/plan/preview', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id, patch }) });
    if (!res.ok) throw new Error();
    const plan = await res.json();
    previewCache.set(key, planLine(plan));
    previewPlans.set(key, plan);
  } catch { previewCache.set(key, 'Claude will act on this when you end your turn.'); previewPlans.set(key, null); }
  paintWill();
}
let marksStale = false;
function paintWill() {
  const id = curId(), el = $('#will');
  if (!id || !el) return;
  const it = BY.get(id), r = R.get(id), u = UI.get(id);
  el.textContent = mask(willLine(it, r, u));
  paintApprove(it, r, u);
  if ($('#marks')) {
    // The marked card is left alone under a held finger or key, and repainted when it is let go.
    if (peeking.size) marksStale = true;
    else { marksStale = false; $('#marks').outerHTML = marksBlock(it, r, u); }
  } else { const chg = $('#chg'); if (chg) chg.innerHTML = changeCard(it, r, u); }
}
function measureAct() { const act = $('.act'); if (act) document.documentElement.style.setProperty('--acth', act.offsetHeight + 'px'); }
function paintApprove(it, r, u) {
  const btn = $('.act .approve'), lab = approveLabel(it, r, u);
  if (!btn || !lab) return;
  btn.querySelector('.long').textContent = lab;
  if (showsPair(it, r, u) && canApprove(it, r, u)) btn.title = lab;
  measureAct();
}

// ---------- rendering: what approving changes ----------
const previewPlans = new Map();
const LEAD_EMOJI = /^\s*(?:\p{Extended_Pictographic}[\p{Extended_Pictographic}\u200d\ufe0f]*\s*)+/u;
const leadEmoji = t => (String(t).match(LEAD_EMOJI) || [''])[0].trim();
const sansEmoji = t => String(t).replace(LEAD_EMOJI, '').trim();
const OP_NAME = { comment: 'Comment', 'new-issue': 'New issue', close: 'Close', estimate: 'Effort', 'sub-issue': 'Sub-issue', ask: 'Ask', 'edit-title': 'Title', 'edit-body': 'Body' };
const STATUS_NAME = { ready: 'Ready', notReady: 'Not Ready' };
const shortCol = c => colName(c).replace(/^Backlog - /, '');
// The card as it will be once Claude carries out this approval: the one source the change rows and the marked card read.
function projected(it, r, u) {
  const key = r.decisionOpen || r.kind === 'approve' ? it.id + JSON.stringify(decisionPatch(it, r, u)) : null;
  const plan = key ? previewPlans.get(key) || null : null, t = (plan && plan.text) || {};
  const cd = B.carry.drafts[it.id] || {};
  const live = r.carryOpen ? (cd.ops || []).map((o, n) => [o, n]).filter(([, n]) => !u.off.has(n)) : [];
  const edited = ([o, n], f) => (u.edits[String(n)] || {})[f] ?? o[f] ?? '';
  const self = kind => live.find(([o]) => o.kind === kind && o.target === it.url);
  const selfTitle = self('edit-title'), selfBody = self('edit-body'), v = r.checks.value;
  const p = { t, live, edited, selfTitle, selfBody, pending: !!key && !previewPlans.has(key),
    title: (t.title || (selfTitle ? edited(selfTitle, 'body') : '')).trim() || it.title,
    body: t.body || (selfBody ? edited(selfBody, 'body') : '') || null,
    level: v.level && (v.state === 'draft' || v.state === 'claude') ? v.level : it.prioLevel,
    est: it.est, col: it.col, close: null };
  for (const st of (plan && plan.steps) || []) {
    if (st.kind === 'estimate') p.est = st.value;
    else if (st.kind === 'status') p.col = STATUS_NAME[st.value] ? 'Backlog - ' + STATUS_NAME[st.value] : st.value;
    else if (st.kind === 'close') p.close = st.reason || 'not planned';
  }
  return p;
}
const OP_BADGE = { close: 'closes', estimate: 'changed', 'edit-title': 'changed' };
const BADGE = { new: ['+', 'new'], changed: ['~', 'changed'], moved: ['→', 'moved'], closes: ['×', 'closes'], posts: ['+', 'posts'] };
// One row per change. `key` marks the rows that have a spot on the card face; a row with no badge is a note, not a change.
function changes(it, r, u, p = projected(it, r, u)) {
  const out = [], add = (label, badge, html, more) => out.push({ label, badge, html, ...more });
  const step = (from, to, cls = '') => `<s class="from${cls}">${T(from)}</s><span class="arw" aria-label="to">→</span><b>${T(to)}</b>`;
  const crit = body => { const ac = acceptanceCriteria(body); return !ac ? 'no acceptance criteria' : ac.items ? `${ac.items} acceptance ${ac.items === 1 ? 'criterion' : 'criteria'}` : 'acceptance criteria in prose'; };
  const { t, live, edited, selfTitle, selfBody } = p;
  if (p.title !== it.title.trim()) {
    const same = sansEmoji(p.title) === sansEmoji(it.title);
    add('Title', 'changed', same ? `${step(leadEmoji(it.title) || 'No gitmoji', leadEmoji(p.title), leadEmoji(it.title) ? ' ew' : '')} <span class="hint">same words</span>`
      : `<b>${T(p.title)}</b><div class="was">${T(it.title)}</div>`, { key: 'title', same });
  }
  if (p.body) add('Body', 'posts', `<b>New body</b>, ${crit(p.body)}`);
  if (p.level !== it.prioLevel) add('Priority', it.prioLevel ? 'changed' : 'new', step(it.prioLevel || 'None', p.level), { key: 'level' });
  if (p.est !== it.est) add('Effort', it.est ? 'changed' : 'new', step(it.est || 'None', p.est), { key: 'est' });
  if (shortCol(p.col) !== shortCol(it.col)) add('Status', 'moved', step(shortCol(it.col) || 'None', shortCol(p.col)), { key: 'col' });
  if (p.close) add('Close', 'closes', `<b>Close it as ${T(p.close)}</b>${t.superseded_by ? `, superseded by ${issueLink(t.superseded_by)}` : ''}, with a closing comment`);
  if (r.kind === 'verify' && !noteWins(r, u)) add('Next', null, 'A code check before anything changes on the board');
  if (t.decision) add('Decision', 'posts', `Claude carries out: ${T(firstSentence(t.decision, 160))}`);
  if (t.split) add('Split', 'posts', T(firstSentence(t.split, 160)));
  for (const x of live) if (x !== selfTitle && x !== selfBody) add(OP_NAME[x[0].kind] || 'Post', OP_BADGE[x[0].kind] || 'posts', opHead(it, x[0])
    + (x[0].kind === 'new-issue' ? `: ${T(edited(x, 'title'))}` : x[0].kind === 'comment' ? `: <q>${T(firstSentence(edited(x, 'body'), 90))}</q>` : ''));
  if (p.pending) add('Board', null, '<span class="hint">Working out what Claude will do.</span>');
  if (!out.length) add('Board', null, 'Nothing changes.');
  return out;
}
const changeRows = rows => rows.map(x => `<dt>${esc(x.label)}</dt><dd>${x.html}</dd>`).join('');
// The marked card's checks come from readiness() on the projected item, so it can only go golden when the Definition of Ready says so.
function afterChecks(it, p) {
  const next = { ...it, title: p.title, est: p.est, prioLevel: p.level, col: p.col, ac: p.body ? acceptanceCriteria(p.body) : it.ac, hasSug: false };
  const rec = recsFor(it.id);
  return readiness(next, { ty: rec.ty, ev: rec.ev, pk: p.level ? { priority: p.level, applied_at: 'after', at: '9999' } : null }, null, B.dor || {});
}
// Marks only where the card itself changes; leaving it or checking the code first changes nothing on the board yet.
const showsPair = (it, r, u) => hasChanges(it, r, u) && !['leave', 'verify'].includes(r.kind);
const chip = (cls, row, html) => `<span class="mchip ${cls}" title="${esc(row.label)} ${BADGE[row.badge][1]}"><i>${BADGE[row.badge][0]}</i>${html}</span>`;
// The card as it will be after approving, each change marked where it sits on the face.
function markedFace(it, r, u, p, rows) {
  const row = k => rows.find(x => x.key === k), tRow = row('title'), eRow = row('est'), lRow = row('level'), cRow = row('col');
  const a = afterChecks(it, p), next = { ...it, title: p.title }, ty = typeOf(next), tyNow = typeOf(it);
  const emo = leadEmoji(p.title), colNow = colName(it.col), sc = scoreOf(it);
  const cls = ['hs', 'marked', !p.close && a.met === 4 ? 'golden' : '', p.close ? 'dim' : '', r.playable ? 'playable' : '', tRow ? '' : 'keep-title', ty[0] === tyNow[0] && ty[1] === tyNow[1] ? 'keep-type' : ''].join(' ');
  const title = tRow && tRow.same && emo ? `<span class="emo">${T(emo)}</span> ${T(sansEmoji(p.title))}` : T(p.title);
  const tmark = !tRow ? '' : `<div class="tmark">${tRow.same ? `${leadEmoji(it.title) ? `<s class="ew">${T(leadEmoji(it.title))}</s>` : '<s>no gitmoji</s>'} → <b>${T(emo || 'none')}</b> <span>same words</span>` : `<s>${T(it.title)}</s>`}</div>`;
  const status = p.close ? `<s>${esc(colNow)}</s> → <b>Closed as ${T(p.close)}</b>` : cRow ? `<s>${esc(shortCol(it.col))}</s> → <b>${esc(shortCol(p.col))}</b>` : esc(colNow);
  const extra = rows.filter(x => !x.key);
  const line = `<p class="line"><b>${esc(keyword(it, r))}.</b> ${T(cardLine(it, r))}</p>`;
  return `<div class="${cls}" data-act="details" style="--art-a:${ty[4][0]};--art-b:${ty[4][1]}">
    <div class="frame">
      <div class="art"><svg viewBox="0 0 100 100" aria-hidden="true">${EMBLEM[ty[0]]}</svg></div>
      <div class="banner"><h2>${title}</h2></div>${tmark}
      <div class="fmeta">${STAGE && isPrivate(it.repo) ? '' : esc(it.id) + ' · '}${status}${it.deep ? ' · code checked' : ''}</div>
      <div class="pips" aria-label="Ready after approving? ${p.close ? 'Closing' : `${a.met} of 4`}">${p.close ? '<b>Closing</b>' : pips(a)}</div>
      <div class="rarity ${p.level ? 'met' : 'missing'}${lRow ? ' changed' : ''}" style="--r:${RCOL[p.level] || 'var(--well)'}" title="Priority: ${esc(p.level || 'none')}"></div>${sc ? scoreEl(sc, 'scn') : ''}
      <div class="textbox${extra.length ? ' rows' : ''}">${line}${extra.length ? `<div class="fc"><b>${esc(noteWins(r, u) ? 'Your note' : keyword(it, r))}</b><dl>${changeRows(extra)}</dl></div>` : ''}</div>
      <div class="plate">${esc(ty[1])}</div>
      <button class="more-pill" data-act="details">Details</button>
      ${p.level === 'Urgent' ? '<div class="crest">Urgent</div>' : ''}
    </div>
    <div class="gw${eRow ? ' changed' : ''}"><div class="gem mana-rim"></div>
      <div class="gem mana ${p.est ? 'met' : 'missing'}" title="Effort: ${esc(p.est || 'none')}"><span class="n">${esc(p.est || '?')}</span></div></div>
    ${eRow ? chip('c-est', eRow, `Effort <s>${esc(it.est || 'none')}</s> → <b>${esc(p.est || 'none')}</b>`) : ''}
    ${lRow ? chip('c-lvl', lRow, `<s>${esc(it.prioLevel || 'none')}</s> → <b>${esc(p.level || 'none')}</b>`) : ''}
  </div>`;
}
// Everything the card view shows for a change set: the strip, the marked card, the Now card for peeking, and the phone's rows.
function marksBlock(it, r, u) {
  const p = projected(it, r, u), rows = changes(it, r, u, p), real = rows.filter(x => x.badge), n = real.length;
  const count = n ? `${n} ${n === 1 ? 'change' : 'changes'}` : p.pending ? 'Working out what changes' : 'Nothing changes';
  const badge = x => x.badge ? `<dd class="bd"><span class="badge"><i>${BADGE[x.badge][0]}</i> ${BADGE[x.badge][1]}</span></dd>` : '';
  return `<div class="marks" id="marks">
    <div class="strip"><b class="tn">Now, before you approve</b></div>
    <div class="vw-a">${markedFace(it, r, u, p, rows)}</div><div class="vw-n">${face(it, r, true)}</div>
    <button class="peekbtn" type="button">Hold to see Now <span class="kbd">shift</span></button>
    <div class="mrows"><div class="mh"><b class="ta">${count}</b><b class="tn">Now, before you approve</b><span>Hold the card to see Now</span></div>
      <dl>${rows.map(x => `<div class="mr${!x.key || (x.key === 'title' && !x.same) ? ' long' : ''}"><dt>${esc(x.label)}</dt><dd>${x.html}</dd>${badge(x)}</div>`).join('')}</dl>
      <button class="mdet" data-act="details">Details <span aria-hidden="true">\u203a</span></button></div>
  </div>`;
}
const hasChanges = (it, r, u) => r.pile === 'turn' && !!u && !!approveLabel(it, r, u);
const noteWins = (r, u) => r.decisionOpen && !!(u.note || '').trim() && !['decide', 'split'].includes(r.kind);
const changeCard = (it, r, u) => `<b>${esc(noteWins(r, u) ? 'Your note' : keyword(it, r))}</b><dl>${changeRows(changes(it, r, u))}</dl>`;

function parchment(it, r, u) {
  const [vtext, vcls] = verdict(it, r, u);
  const sug = it.sug || {};
  const age = days(it.created);
  const meta = [
    STAGE && isPrivate(it.repo) ? 'a private issue' : `<a href="${esc(it.url)}" target="_blank" rel="noopener">${esc(it.id)}</a>`,
    isPrivate(it.repo) ? '<span class="lock">private</span>' : '',
    esc(colName(it.col)),
    age != null ? `open ${age} days` : '',
    it.hasSug && sug.confidence && sug.confidence !== 'high' ? `${esc(sug.confidence)} confidence` : '',
    it.deep ? '' : '<span class="texttag">Text only</span>',
  ].filter(Boolean).join(' <span aria-hidden="true">·</span> ');
  const rows = r.kind === 'text'
    ? detailRow(it, r, u) + valueRow(it, r, u) + effortRow(it, r, u) + textOps(it, r, u)
    : detailRow(it, r, u) + valueRow(it, r, u) + effortRow(it, r, u) + (B.carry.drafts[it.id] && (r.carryWaiting || r.carryOpen || (recsFor(it.id).ck || {}).decision === 'skip') ? textOps(it, r, u) : '');
  const deal = nav.lastDealt !== it.id ? ' deal' : '';
  return `<section class="parch${deal}${it.deep ? ' sealed' : ''}" aria-label="Card ${esc(it.id)}">
    <button class="mback" data-act="card">Back to the card<span class="kbd">esc</span></button>
    ${it.deep ? '<div class="seal" title="Checked against the code"><span>Checked against the code</span></div>' : ''}
    <div class="ph"><div style="min-width:0"><div class="meta">${meta}</div><h1>${T(it.title)}</h1></div>
      <div class="score" aria-label="Ready? ${r.closing ? 'Closing' : `${r.met} of 4`}"><b>${r.closing ? '&times;' : `${r.met}/4`}</b><span>${r.closing ? 'Closing' : 'Ready?'}</span></div></div>
    <p class="verdict ${vcls}" id="verdict">${T(vtext)}</p>
    ${reopenedBand(it, r)}${closeBand(it, r, u)}
    <div class="rows">${rows}</div>
    ${noteBlock(it, r, u)}${whyBlock(it, r)}${dupesBlock(it)}
    <p class="will" id="will">${T(willLine(it, r, u))}</p>
    ${actBar(it, r, u)}
  </section>`;
}

// ---------- rendering: table ----------
function emptyState() {
  const c = counts(), w = claudeWork();
  const waiting = waitCount(w);
  const done = nav.deck.length > 0;
  const left = done && nav.source === 'pile' ? nav.deck.filter(x => R.get(x).pile === nav.pile).length : 0;
  let h = '', p = '', btn = '';
  if (nav.source === 'coll') { h = done ? 'End of this list.' : 'No cards match.'; btn = '<button class="btn" data-act="coll">Back to the Collection</button>'; }
  else if (left) { h = 'End of the pile.'; p = `${left} ${left === 1 ? 'card you passed still waits' : 'cards you passed still wait'} here.`; btn = '<button class="btn" data-act="top">Start from the top</button>'; }
  else if (nav.pile === 'turn') {
    h = 'Nothing needs you.';
    if (waiting) { p = `${waiting} ${waiting === 1 ? 'thing waits' : 'things wait'} for Claude.`; btn = '<button class="btn" data-act="endturn">Open End turn</button>'; }
    else {
      const valueOnly = ITEMS.filter(it => stageOk(it) && R.get(it.id).pile === 'draft' && ['detail', 'effort'].every(k => R.get(it.id).checks[k].state === 'met') && R.get(it.id).checks.value.state === 'missing').length;
      p = `${c.draft} cards are missing a check the agent has not drafted yet.${valueOnly ? ` ${valueOnly} of them only need your priority pick.` : ''}`;
      btn = '<button class="btn" data-act="pile" data-pile="draft">See what needs a draft</button>';
    }
  } else if (nav.pile === 'claude') h = 'Nothing waits for Claude.';
  else if (nav.pile === 'draft') h = 'Every card has a draft.';
  else h = 'No card meets the Definition of Ready yet.';
  return `<section class="parch empty" style="grid-column:1/-1"><h2>${h}</h2>${p ? `<p>${p}</p>` : ''}${btn}${done ? `<p><button class="linkbtn" data-act="prev">Back to the last card</button></p>` : ''}</section>`;
}
let notice = '';
function render() {
  if (!B) return;
  $('#tableView').hidden = nav.view !== 'table';
  $('#collView').hidden = nav.view !== 'coll';
  paintRail();
  if (nav.view === 'coll') { renderColl(); setHash(); return; }
  const id = curId();
  if (id !== nav.lastDealt) document.body.classList.remove('details');
  syncView();
  // The phone's details sheet is its own scroller and is rebuilt here, so a tap inside it keeps its place.
  const keep = id === nav.lastDealt && $('.parch') ? $('.parch').scrollTop : 0;
  const host = $('#tableView');
  const top = notice ? `<div class="notice">${notice}</div>` : '';
  if (!id) { host.innerHTML = top + emptyState(); setHash(); return; }
  const it = BY.get(id), u = uiFor(id), r = compute(id);
  const next = nav.deck.slice(nav.pos + 1, nav.pos + 4).map(x => tile(BY.get(x), R.get(x), false)).join('');
  const posText = `${nav.pos + 1} of ${nav.deck.length} in ${nav.source === 'coll' ? nav.label : PILE_NAME[nav.pile]}`;
  host.innerHTML = `${top}<aside class="side" aria-label="Card in play">
      ${tile(it, r, true)}${showsPair(it, r, u) ? marksBlock(it, r, u) : face(it, r)}
      <div class="pos"><button class="nav" data-act="prev" ${nav.pos ? '' : 'disabled'}>Back<span class="kbd">k</span></button><span>${esc(posText)}</span><button class="nav" data-act="next" ${nav.pos < nav.deck.length - 1 ? '' : 'disabled'}>Next<span class="kbd">j</span></button></div>
      ${next ? `<div class="upnext"><h3>Up next</h3>${next}</div>` : ''}
    </aside>${parchment(it, r, u)}`;
  if (id !== nav.lastDealt) $$('.hs', host).forEach(h => h.classList.add('deal'));
  nav.lastDealt = id;
  if (keep) $('.parch', host).scrollTop = keep;
  // The next card's preview is fetched now, so its marks are ready when it is dealt.
  const nx = nav.deck[nav.pos + 1];
  if (nx && BY.has(nx)) { uiFor(nx); fetchPreview(nx); }
  measureAct();
  $$('textarea.now', host).forEach(autosize);
  setHash();
}
// Updates the sockets, score and verdict in place, so typing never loses focus to a re-render.
function patchChecks(id) {
  const it = BY.get(id), r = R.get(id), u = UI.get(id);
  for (const k of ['detail', 'value', 'effort']) {
    const sock = $(`[data-sock="${k}"]`), c = r.checks[k];
    if (sock) sock.className = 'sock ' + c.state;
    const st = sock && sock.parentElement.querySelector('.st');
    if (st) st.textContent = WORD[c.state] + ((c.state === 'met' || c.state === 'claude') && c.caption && c.caption !== WORD[c.state] ? ': ' + c.caption : '');
  }
  const [vt, vc] = verdict(it, r, u), v = $('#verdict');
  if (v) { v.textContent = mask(vt); v.className = 'verdict ' + vc; }
  const sc = $('.score b');
  if (sc && !r.closing) sc.textContent = `${r.met}/4`;
  const hs = $('.marks .hs.marked') || $('.side > .hs');
  if (hs) hs.classList.toggle('playable', r.playable);
  const pp = $('.side > .hs .pips');
  if (pp) pp.innerHTML = pips(r);
}
function autosize(el) { el.style.height = 'auto'; el.style.height = el.scrollHeight + 2 + 'px'; }

// ---------- collection ----------
const cf = { pile: 'all', miss: new Set(), repo: 'all', q: '', raw: '', limit: 150 };
function collList() {
  return ITEMS.filter(it => {
    if (!stageOk(it)) return false;
    const r = R.get(it.id);
    if (cf.pile !== 'all' && r.pile !== cf.pile) return false;
    for (const m of cf.miss) if (r.checks[m].state !== 'missing') return false;
    if (cf.repo !== 'all' && it.repo !== cf.repo) return false;
    if (cf.q) { const h = `${it.id} ${it.title} ${(it.sug || {}).rationale || ''}`.toLowerCase(); if (!h.includes(cf.q)) return false; }
    return true;
  }).sort(byOrder);
}
function readyNumbers() {
  const all = ITEMS.filter(stageOk);
  return { met4: all.filter(it => R.get(it.id).met === 4).length, ready: all.filter(it => R.get(it.id).pile === 'ready').length };
}
function renderColl() {
  const all = ITEMS.filter(stageOk), c = { all: all.length };
  for (const it of all) { const p = R.get(it.id).pile; c[p] = (c[p] || 0) + 1; }
  const miss = {};
  for (const k of ['detail', 'value', 'effort', 'approved']) miss[k] = all.filter(it => R.get(it.id).checks[k].state === 'missing').length;
  const repos = [...new Set(ITEMS.map(i => i.repo))].sort();
  $('#collView').innerHTML = `
    <div class="bar">${[['all', 'All'], ...Object.entries(PILE_NAME)].map(([k, l]) => `<button class="chip" data-act="cpile" data-v="${k}" aria-pressed="${cf.pile === k}">${l}<b>${c[k] || 0}</b></button>`).join('')}</div>
    <div class="bar"><span class="lab">Missing</span>${['detail', 'value', 'effort', 'approved'].map(k => `<button class="chip" data-act="cmiss" data-v="${k}" aria-pressed="${cf.miss.has(k)}">${CHECK_NAME[k]}<b>${miss[k]}</b></button>`).join('')}
      <select data-act="crepo" aria-label="Repository"><option value="all">All repos</option>${repos.map(r => `<option value="${esc(r)}" ${cf.repo === r ? 'selected' : ''}>${esc(r)}</option>`).join('')}</select>
      <input class="search" type="search" placeholder="Search id, title or the agent's reasoning" value="${esc(cf.raw)}" aria-label="Search the collection"></div>
    <div id="collRows"></div>`;
  paintCollRows();
}
function paintCollRows() {
  const rows = collList(), n = readyNumbers();
  $('#collRows').innerHTML = `<p class="summary">${n.met4} cards meet the Definition of Ready, and ${n.ready} of those have nothing left waiting. Showing ${Math.min(rows.length, cf.limit)} of ${rows.length}.</p>
    <div>${rows.slice(0, cf.limit).map(it => crow(it, R.get(it.id))).join('') || '<p class="summary">No cards match. Clear the filters.</p>'}</div>
    ${rows.length > cf.limit ? '<button class="btn more-rows" data-act="cmore">Show 150 more</button>' : ''}`;
}
function crow(it, r) {
  const e = r.checks.effort, age = days(it.created), sc = scoreOf(it);
  return `<button class="crow" data-act="copen" data-id="${esc(it.id)}">
    <span class="socks">${['detail', 'value', 'effort', 'approved'].map(k => `<i class="${r.checks[k].state}" title="${CHECK_NAME[k]}: ${esc(WORD[r.checks[k].state])}"></i>`).join('')}</span>
    <span class="g ${e.state === 'met' ? '' : 'missing'}"><span class="n">${esc(e.state === 'met' ? e.value : '?')}</span></span>
    <span class="id">${STAGE && isPrivate(it.repo) ? '' : esc(it.id)}</span>
    <span class="tt">${T(it.title)}</span>
    <span class="cs">${sc ? scoreEl(sc, 'scn') : ''}</span><span class="r" style="--r:${RCOL[r.checks.value.level] || 'var(--well)'}"></span>
    <span class="pl">${esc(PILE_NAME[r.pile])}</span><span class="co">${esc(colName(it.col))}</span><span class="age">${age != null ? age + 'd' : ''}</span></button>`;
}

// ---------- end turn ----------
function claudeWork() {
  const plan = [], texts = [], prios = [], scores = [];
  for (const it of ITEMS) {
    const rec = recsFor(it.id);
    if (rec.d && rec.d.decision === 'accept' && !rec.d.applied) plan.push(it);
    const r = R.get(it.id);
    if (r && r.carryWaiting) texts.push(it);
    if (rec.pk && rec.pk.priority && !rec.pk.applied_at) prios.push(it);
    const sp = scorePick(it.id);
    if (sp && !sp.applied_at) scores.push(it);
  }
  return { plan: plan.filter(stageOk), texts: texts.filter(stageOk), prios: prios.filter(stageOk), scores: scores.filter(stageOk) };
}
const waitCount = w => w.plan.length + w.texts.length + w.prios.length + w.scores.length;
let sheetKind = null;
function openSheet(kind) {
  sheetKind = kind;
  $('#scrim').hidden = false; $('#sheet').hidden = false;
  paintSheet();
  $('#sheet .x').focus();
}
function closeSheet() { sheetKind = null; $('#scrim').hidden = true; $('#sheet').hidden = true; }
let planMsg = '';
// Every card with a drafted score or a pick, grouped by the level its score sits in and ranked by score.
function scoreGroups() {
  const level = x => (x.s.draft ? x.s.draft.level : x.it.prioLevel) || null;
  const rows = ITEMS.filter(stageOk).map(it => ({ it, s: scoreOf(it) })).filter(x => x.s && (x.s.draft || x.s.pick));
  const rank = (a, b) => b.s.n - a.s.n || String(a.it.created || '9').localeCompare(String(b.it.created || '9')) || a.it.id.localeCompare(b.it.id);
  return [...LEVELS, null].map(l => ({ l, rows: rows.filter(x => level(x) === l).sort(rank) })).filter(g => g.rows.length);
}
const SCORE_STATE = { draft: 'Draft', claude: 'Approved', met: 'On board' };
function scoreRow({ it, s }) {
  const d = s.draft, lc = d && d.level_change;
  return `<li class="srow"><div class="sn ${s.state}" title="${esc(SCORE_TIP[s.state])}"><b>${s.n}</b><small>${SCORE_STATE[s.state]}</small></div>
    <div class="sm"><button class="slink" data-act="sopen" data-id="${esc(it.id)}"><span class="sid">${STAGE && isPrivate(it.repo) ? '' : esc(it.id)}</span> ${T(it.title)}</button>
      ${d && d.reason ? `<small class="srs">${T(d.reason)}</small>` : ''}${lc ? `<small class="slc">Level change: ${esc(d.board_level || 'none')} \u2192 ${esc(lc)}</small>` : ''}</div>
    ${s.state === 'draft' ? `<button class="btn" data-act="sapprove" data-id="${esc(it.id)}" aria-label="Approve ${s.n} for ${esc(it.id)}">Approve</button>` : ''}</li>`;
}
function paintScores(el) {
  const groups = scoreGroups(), all = groups.flatMap(g => g.rows);
  const drafted = all.filter(x => x.s.state === 'draft').length, approved = all.filter(x => x.s.pick).length;
  const grp = g => {
    const n = g.rows.filter(x => x.s.state === 'draft').length;
    return `<div class="grp sgrp"><h3><b>${g.rows.length}</b>${g.l || 'No level'}${g.l ? `<span class="hint">${SCORE_BANDS[g.l][0]} to ${SCORE_BANDS[g.l][1]}</span>` : ''}</h3>
      ${n ? `<button class="btn" data-act="sapprovegrp" data-g="${g.l || ''}">Approve all ${n} drafted</button>` : ''}
      <ul class="slist">${g.rows.map(scoreRow).join('')}</ul></div>`;
  };
  const top = el.scrollTop;
  el.innerHTML = `<button class="x" data-act="close" aria-label="Close">&times;</button>
    <h2 id="sheetTitle">Scores</h2>
    <p class="lede">${all.length ? `${all.length} cards, ranked inside their level. ${drafted} drafted and waiting for you, ${approved} approved. Nothing here has been posted.` : 'No scores yet. Claude loads the agent\'s drafts with scripts/load-scores.mjs.'}</p>
    ${groups.map(grp).join('')}`;
  el.scrollTop = top;
}
// One request records the group's drafts, so a long group is not 200 separate saves.
async function approveDrafted(level) {
  const g = scoreGroups().find(x => (x.l || '') === level);
  const ids = g ? g.rows.filter(x => x.s.state === 'draft').map(x => x.it.id) : [];
  if (!ids.length) return;
  try {
    const res = await fetch('api/scores/accept', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ids }) });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const made = (await res.json()).picks || {}, k = Object.keys(made).length;
    Object.assign(B.scorePicks, made);
    toast(`${k} ${k === 1 ? 'score' : 'scores'} recorded. Nothing posted.`);
  } catch { toast('Could not record the scores. Nothing was saved.'); }
  overlay(); render(); paintSheet();
}
// Records the number in the Details input, or says what it needs.
function approveScoreInput() {
  const el = $('[data-score-in]'), id = curId(), v = el ? el.value.trim() : '', n = Number(v);
  if (!id || !v || !Number.isInteger(n) || n < 0 || n > 100) { toast('Enter a whole number from 0 to 100.'); return; }
  record(id, [[QS, { score: n }]]);
  overlay();
  toast(`${n} recorded. Nothing posted.`, true);
  render();
}
function paintSheet() {
  const el = $('#sheet');
  el.classList.toggle('wide', sheetKind === 'scores');
  if (sheetKind === 'scores') return paintScores(el);
  if (sheetKind === 'keys') {
    el.innerHTML = `<button class="x" data-act="close" aria-label="Close">&times;</button><h2 id="sheetTitle">Keys</h2><div class="keys"><dl>
      <dt>j or Right</dt><dd>Next card</dd><dt>k or Left</dt><dd>Previous card</dd><dt>a</dt><dd>Approve</dd><dt>s</dt><dd>Skip, or unskip</dd>
      <dt>1 to 4</dt><dd>Priority: Urgent, High, Medium, Low</dd><dt>[ and ]</dt><dd>Effort down or up</dd><dt>d</dt><dd>Details, or back to the card</dd><dt>shift</dt><dd>Hold to see the card as it is now</dd><dt>p</dt><dd>End turn</dd><dt>/</dt><dd>Search the collection</dd>
      <dt>u</dt><dd>Undo your last change, or the approval on a card waiting for Claude</dd><dt>o</dt><dd>Open the issue on GitHub</dd><dt>Cmd+Enter</dt><dd>Approve from inside a field</dd><dt>Esc</dt><dd>Leave a field or close this</dd></dl></div>`;
    return;
  }
  const w = claudeWork();
  const li = (it, extra) => `<li>${STAGE && isPrivate(it.repo) ? '' : issueLink(it.url) + ' '}${T(it.title)}${extra ? ` <span class="hint">${T(extra)}</span>` : ''}</li>`;
  const say = phrase => `<div class="say"><q>${esc(phrase)}</q><button class="btn" data-act="copy" data-text="${esc(phrase)}">Copy</button></div>`;
  const grp = (title, items, phrase, extra) => items.length ? `<div class="grp"><h3><b>${items.length}</b>${title}</h3><ul>${items.slice(0, 40).map(it => li(it, extra && extra(it))).join('')}${items.length > 40 ? `<li class="hint">and ${items.length - 40} more</li>` : ''}</ul>${say(phrase)}</div>` : '';
  const n = waitCount(w);
  const lp = B.lastPlan && B.lastPlan.generatedAt ? `Last plan written ${new Date(B.lastPlan.generatedAt).toLocaleString()}, ${B.lastPlan.count} ${B.lastPlan.count === 1 ? 'card' : 'cards'}.` : 'No plan written yet.';
  const posted = Object.values(B.carry.posted || {}).reduce((a, p) => a + Object.values(p.ops || {}).filter(o => o.status === 'ok').length, 0);
  el.innerHTML = `<button class="x" data-act="close" aria-label="Close">&times;</button>
    <h2 id="sheetTitle">End turn</h2>
    <p class="lede">Hand the table to Claude. Nothing here has been posted.</p>
    ${n ? '' : `<div class="grp"><p>Nothing waits for Claude. ${counts().turn} cards are still your turn.</p></div>`}
    ${grp('Decisions for the plan', w.plan, 'Action the refinery plan', it => planLine(B.planned[it.id]).replace(/^Claude will /, ''))}
    ${grp('Texts Claude will post', w.texts, 'Post the approved drafts')}
    ${grp('Priorities to set', w.prios, 'Apply the priorities', it => (recsFor(it.id).pk || {}).priority)}
    ${grp('Scores to set', w.scores, 'Apply the scores', it => String(scorePick(it.id).score))}
    <button class="approve write" data-act="writeplan" ${w.plan.length ? '' : 'disabled'}>Write the plan<small>Records only</small></button>
    ${planMsg ? `<p class="foot" role="status"><b>${esc(planMsg)}</b></p>` : ''}
    <p class="foot">Claude takes its turn in chat. It shows you any plan text before posting it, and posts approved drafts exactly as you approved them.</p>
    <p class="quiet">${esc(lp)}${posted ? ` Claude has posted ${posted} approved texts so far.` : ''}</p>
    <p class="quiet">Board as of ${esc(new Date(B.fetchedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }))}. <a href="#" data-act="refresh">Refresh from GitHub</a></p>`;
}
async function writePlan() {
  try {
    const r = await fetch('api/plan', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const j = await r.json();
    B.lastPlan = { generatedAt: j.generatedAt, count: (j.items || []).length };
    const k = (j.items || []).length;
    planMsg = `Plan written: ${k} ${k === 1 ? 'card' : 'cards'} in data/PLAN.md. Nothing was posted.`;
  } catch (e) { planMsg = `Could not write the plan: ${e.message}. Nothing was posted.`; }
  paintSheet();
}
async function copyText(t) {
  try { await navigator.clipboard.writeText(t); return true; } catch {}
  const ta = document.createElement('textarea'); ta.value = t; ta.style.position = 'fixed'; ta.style.opacity = '0';
  document.body.appendChild(ta); ta.select();
  let ok = false; try { ok = document.execCommand('copy'); } catch {}
  ta.remove(); return ok;
}

// ---------- actions ----------
let toastTimer = null;
function toast(msg, undoable) {
  const t = $('#toast');
  t.innerHTML = esc(msg) + (undoable ? ' <button class="tbtn" data-act="undo">Undo<span class="kbd">u</span></button>' : '');
  t.hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => { t.hidden = true; }, undoable ? 8000 : 3500);
}

// Each change this session keeps the exact patch that puts its records back, newest last.
const undoStack = [];
const restorePatch = (prev, patch) => { const out = { undo: true }; for (const k of Object.keys(patch)) out[k] = prev && k in prev ? prev[k] : null; return out; };
function record(id, writes) {
  const rec = recsFor(id), done = [];
  for (const [q, patch] of writes) {
    const prev = q === QD ? rec.d : q === QC ? rec.ck : q === QS ? scorePick(id) : rec.pk;
    done.push([q, q === QP ? { undo: true, priority: (prev && prev.priority) || null } : q === QS ? { undo: true, score: prev ? prev.score : null } : restorePatch(prev, patch)]);
    q.put(id, patch, true);
  }
  undoStack.push({ id, writes: done });
}
// Without a session record, a card Claude has not acted on yet can still be reopened from what is on disk.
function reopenPatches(id) {
  const it = BY.get(id), r = R.get(id), rec = recsFor(id), d = rec.d || {}, out = [];
  const how = takeBack(it, r);
  if (how === 'restore') {
    const P = d.prior, patch = { undo: true, prior: P.prior ?? null };
    for (const k of ['decision', 'applied', 'action', 'estimate', 'body', 'title', 'note', 'close_reason', 'close_target', 'edited', 'via']) patch[k] = P[k] ?? null;
    out.push([QD, patch]);
  } else if (how === 'decision') out.push([QD, { undo: true, decision: null }]);
  else if (how === 'carry') out.push([QC, { undo: true, decision: null }]);
  if (r.checks.value.state === 'claude' && rec.pk && !rec.pk.applied_at) out.push([QP, { undo: true, priority: null }]);
  return out;
}
function undo(target) {
  const i = target ? undoStack.map(e => e.id).lastIndexOf(target) : undoStack.length - 1;
  const entry = i >= 0 ? undoStack.splice(i, 1)[0] : null;
  const id = entry ? entry.id : target || curId();
  const writes = entry ? entry.writes : id ? reopenPatches(id) : [];
  if (!writes.length) { toast('Nothing to undo here.'); return; }
  for (const [q, patch] of writes) q.put(id, patch, true);
  touch(id);
  let k = nav.deck.indexOf(id);
  if (k < 0) { nav.deck.splice(nav.pos, 0, id); k = nav.pos; }
  nav.pos = k; nav.view = 'table';
  render(); window.scrollTo({ top: 0, behavior: 'instant' });
  toast('Undone. Nothing posted.');
}
function approve() {
  const id = curId(); if (!id) return;
  const it = BY.get(id), r = R.get(id), u = uiFor(id);
  if (!approveLabel(it, r, u) || !canApprove(it, r, u)) return;
  const writes = [];
  if (r.decisionOpen || r.kind === 'approve') writes.push([QD, decisionPatch(it, r, u)]);
  if (r.carryOpen) { noteSig(id); writes.push([QC, { decision: 'approve', off: [...u.off].sort((a, b) => a - b), ...(u.touched.size ? { edits: touchedEdits(id) } : {}) }]); }
  if (r.checks.value.state === 'draft') writes.push([QP, { priority: r.checks.value.level }]);
  record(id, writes);
  touch(id);
  toast(STAGE ? `Recorded at ${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}. Nothing posted.` : 'Recorded. Nothing posted.', true);
  advance();
}
function skip() {
  const id = curId(); if (!id) return;
  const r = R.get(id), rec = recsFor(id), d = rec.d || {}, ck = rec.ck || {};
  let writes = [];
  if (r.decisionOpen || d.decision === 'skip' || d.decision === 'defer') writes = [[QD, { decision: d.decision === 'skip' || d.decision === 'defer' ? null : 'skip' }]];
  else if (r.carryOpen || ck.decision === 'skip') writes = [[QC, { decision: ck.decision === 'skip' ? null : 'skip' }]];
  if (writes.length) record(id, writes);
  touch(id);
  if (writes.length) toast('Recorded. Nothing posted.', true);
  advance();
}
function pickValue(level) {
  const id = curId(); if (!id) return;
  const r = R.get(id), u = uiFor(id), rec = recsFor(id), v = r.checks.value;
  if (v.state === 'none') return;
  if (v.state === 'met' && !u.changeValue) { toast('The board already has a priority. Press Change to pick again.'); return; }
  // Picking the level already picked clears it, unless Claude already applied that pick.
  const clear = rec.pk && rec.pk.priority === level && !rec.pk.applied_at && v.state === 'claude';
  record(id, [[QP, { priority: clear ? null : level }]]);
  if (!clear) toast(`${level} recorded. Nothing posted.`, true);
  touch(id);
  const onlyValue = r.kind === 'value';
  if (onlyValue && !clear) advance(); else render();
}
function stepEffort(dir) {
  const id = curId(); if (!id) return;
  const r = R.get(id), u = uiFor(id);
  if (!(r.decisionOpen && r.kind === 'refine')) return;
  const seq = [null, ...SCALE];
  const i = Math.max(0, seq.indexOf(u.est));
  u.est = seq[Math.min(seq.length - 1, Math.max(0, i + dir))];
  QD.put(id, { estimate: u.est });
  touch(id); render();
}

// Peeking at Now is a body class, so a re-render while Shift, the button or a finger is held keeps it.
const peeking = new Set();
function peek(src, on) {
  if (peeking.has(src) === on) return;
  on ? peeking.add(src) : peeking.delete(src);
  document.body.classList.toggle('peek', peeking.size > 0);
  if (!peeking.size && marksStale) paintWill();
}
let holdTimer = 0, swallowClick = false;
function endHold(cancelled) {
  clearTimeout(holdTimer);
  if (!peeking.has('hold')) return;
  peek('hold', false);
  if (cancelled) return;
  swallowClick = true;
  setTimeout(() => { swallowClick = false; }, 500);
}
document.addEventListener('pointerdown', e => {
  if (e.target.closest('.peekbtn') && e.button === 0) peek('btn', true);
  if (e.pointerType === 'touch' && e.target.closest('.marks .hs')) { clearTimeout(holdTimer); holdTimer = setTimeout(() => peek('hold', true), 350); }
});
document.addEventListener('pointerup', () => { peek('btn', false); endHold(false); });
document.addEventListener('pointercancel', () => { peek('btn', false); endHold(true); });
document.addEventListener('contextmenu', e => { if (peeking.has('hold')) e.preventDefault(); });
document.addEventListener('keyup', e => {
  if (e.key === 'Shift') peek('shift', false);
  else if (e.key === ' ' || e.key === 'Enter') peek('btn', false);
});
window.addEventListener('blur', () => { clearTimeout(holdTimer); [...peeking].forEach(k => peek(k, false)); });

document.addEventListener('click', async e => {
  if (swallowClick && e.target.closest('.marks .hs')) { swallowClick = false; return; }
  const b = e.target.closest('[data-act]');
  if (!b || b.tagName === 'SELECT') return;
  const act = b.dataset.act, id = curId(), u = id ? uiFor(id) : null;
  switch (act) {
    case 'pile': closeSheet(); openPile(b.dataset.pile); break;
    case 'next': step(1); break;
    case 'details': if (!e.target.closest('a')) showDetails(PHONE.matches || !document.body.classList.contains('details')); break;
    case 'card': showDetails(false); break;
    case 'prev': step(-1); break;
    case 'approve': approve(); break;
    case 'skip': skip(); break;
    case 'undo': undo(b.dataset.id || null); break;
    case 'goto': { const k = nav.deck.indexOf(b.dataset.id); if (k >= 0) { nav.pos = k; render(); window.scrollTo({ top: 0, behavior: 'instant' }); } break; }
    case 'crys': u.est = b.dataset.v === 'none' ? null : Number(b.dataset.v); QD.put(id, { estimate: u.est }); touch(id); render(); break;
    case 'top': openPile(nav.pile); break;
    case 'refresh': e.preventDefault(); refreshBoard(); break;
    case 'lvl': pickValue(b.dataset.lvl); break;
    case 'changevalue': u.changeValue = true; render(); break;
    case 'usebody': u.useBody = b.dataset.v === '1'; render(); break;
    case 'showtitle': u.showTitle = true; render(); break;
    case 'noteopen': u.noteOpen = true; render(); { const t = $('[data-f="note"]'); if (t) t.focus(); } break;
    case 'useearlier': {
      const d = recsFor(id).d || {}, prior = (d.prior && d.prior.note) || '', r = R.get(id);
      if (r.kind === 'decide') u.decide = prior; else if (r.kind === 'split') u.split = prior; else { u.noteOpen = true; u.note = prior; }
      QD.put(id, { note: prior }); touch(id); render(); break;
    }
    case 'tab': u.tab[b.dataset.key] = b.dataset.tab; render(); break;
    case 'endturn': openSheet('end'); break;
    case 'scores': openSheet('scores'); break;
    case 'approvescore': approveScoreInput(); break;
    case 'clearscore': record(id, [[QS, { score: null }]]); overlay(); toast('Score cleared. Nothing posted.', true); render(); break;
    case 'sapprove': {
      const s = scoreOf(BY.get(b.dataset.id));
      if (s && s.state === 'draft') { QS.put(b.dataset.id, { score: s.n }, true); overlay(); paintRail(); paintSheet(); }
      break;
    }
    case 'sapprovegrp': await approveDrafted(b.dataset.g); break;
    case 'sopen': {
      const ids = scoreGroups().flatMap(g => g.rows.map(x => x.it.id));
      nav.view = 'table'; nav.source = 'coll'; nav.deck = ids; nav.pos = Math.max(0, ids.indexOf(b.dataset.id)); nav.label = 'the Scores list';
      closeSheet(); render(); window.scrollTo({ top: 0, behavior: 'instant' }); break;
    }
    case 'close': closeSheet(); break;
    case 'writeplan': await writePlan(); break;
    case 'copy': toast(await copyText(b.dataset.text) ? 'Copied. Paste it to Claude.' : 'Copy failed. Select the text and copy it.'); break;
    case 'coll': nav.view = 'coll'; closeSheet(); render(); break;
    case 'cpile': cf.pile = b.dataset.v; cf.limit = 150; renderColl(); break;
    case 'cmiss': cf.miss.has(b.dataset.v) ? cf.miss.delete(b.dataset.v) : cf.miss.add(b.dataset.v); cf.limit = 150; renderColl(); break;
    case 'cmore': cf.limit += 150; paintCollRows(); break;
    case 'copen': {
      const ids = collList().map(i => i.id);
      nav.view = 'table'; nav.source = 'coll'; nav.deck = ids; nav.pos = Math.max(0, ids.indexOf(b.dataset.id));
      nav.label = 'the Collection';
      render(); window.scrollTo({ top: 0, behavior: 'instant' }); break;
    }
  }
});
$('#endTurn').addEventListener('click', () => openSheet('end'));
$('#scrim').addEventListener('click', closeSheet);
document.addEventListener('change', e => {
  const t = e.target;
  if (t.matches('[data-act="crepo"]')) { cf.repo = t.value; cf.limit = 150; renderColl(); return; }
  if (t.matches('[data-inc]')) {
    const id = curId(), u = uiFor(id), n = Number(t.dataset.inc);
    t.checked ? u.off.delete(n) : u.off.add(n);
    noteSig(id); QC.put(id, { off: [...u.off].sort((a, b) => a - b) });
    t.closest('.op').classList.toggle('off', !t.checked);
    touch(id);
    const btn = $('.act .approve'); if (btn) btn.disabled = !canApprove(BY.get(id), R.get(id), u);
  }
});
document.addEventListener('input', e => {
  const t = e.target;
  if (t.matches('#collView .search')) { cf.raw = t.value; cf.q = t.value.trim().toLowerCase(); cf.limit = 150; paintCollRows(); return; }
  if (t.matches('[data-score-in]')) {
    const it = BY.get(curId()), el = $('[data-score-move]');
    if (it && el) el.textContent = scoreMoveText(it, scoreOf(it), t.value);
    return;
  }
  const f = t.dataset.f; if (!f) return;
  const id = curId(), u = uiFor(id), v = t.value;
  if (t.classList.contains('now')) autosize(t);
  switch (f) {
    case 'body': u.body = v; QD.put(id, { body: v }); break;
    case 'title': u.title = v; QD.put(id, { title: v }); break;
    case 'decide': u.decide = v; QD.put(id, { note: v }); break;
    case 'split': u.split = v; QD.put(id, { note: v }); break;
    case 'closeReason': u.closeReason = v; QD.put(id, { close_reason: v }); break;
    case 'closeTarget': u.closeTarget = v; QD.put(id, { close_target: v }); break;
    case 'note': u.note = v; QD.put(id, { note: v }); touch(id); patchChecks(id); break;
    case 'opbody': case 'optitle': {
      const n = String(t.dataset.op), key = f === 'opbody' ? 'body' : 'title';
      u.edits[n] = { ...(u.edits[n] || {}), [key]: v };
      u.touched.add(n);
      noteSig(id); QC.put(id, { edits: { [n]: u.edits[n] } });
      const len = $(`[data-oplen="${n}"]`);
      if (len && key === 'body') { len.textContent = `${v.length} chars${v.length > POST_CAP ? ` over the ${POST_CAP} cap` : ''}`; len.classList.toggle('over', v.length > POST_CAP); }
      break;
    }
  }
  const lenEl = $(`[data-len="${f === 'opbody' ? 'op' + t.dataset.op : f}"]`);
  if (lenEl) lenEl.textContent = `${v.length} chars`;
  paintWill();
});
document.addEventListener('focusin', e => { if (/^(INPUT|TEXTAREA)$/.test(e.target.tagName) && !e.target.readOnly && e.target.type !== 'checkbox') document.body.classList.add('typing'); });
document.addEventListener('focusout', () => setTimeout(() => { if (!/^(INPUT|TEXTAREA)$/.test((document.activeElement || {}).tagName || '')) document.body.classList.remove('typing'); }, 60));

document.addEventListener('keydown', e => {
  const t = e.target, inField = /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName) || t.isContentEditable;
  if (e.key === 'Shift') { if (!inField && !e.repeat) peek('shift', true); return; }
  peek('shift', false);
  if ((e.key === ' ' || e.key === 'Enter') && t.closest && t.closest('.peekbtn')) { e.preventDefault(); peek('btn', true); return; }
  if (e.key === 'Escape') { if (sheetKind) closeSheet(); else if (inField) t.blur(); else showDetails(false); return; }
  if (inField) {
    if (e.key === 'Enter' && t.matches('[data-score-in]')) { e.preventDefault(); approveScoreInput(); return; }
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter' && nav.view === 'table') { e.preventDefault(); t.blur(); approve(); }
    return;
  }
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  if (sheetKind) { if (e.key === 'Enter' && sheetKind === 'end' && !e.target.closest('button')) { e.preventDefault(); writePlan(); } return; }
  if (e.key === '?') { e.preventDefault(); openSheet('keys'); return; }
  if (e.key === 'p') { e.preventDefault(); openSheet('end'); return; }
  if (e.key === '/') { e.preventDefault(); nav.view = 'coll'; render(); $('#collView .search').focus(); return; }
  if (nav.view !== 'table') return;
  const lv = /^[1-4]$/.test(e.key) && LEVELS[Number(e.key) - 1];
  if (lv) { e.preventDefault(); pickValue(lv); return; }
  const map = { j: () => step(1), ArrowRight: () => step(1), k: () => step(-1), ArrowLeft: () => step(-1), a: approve, s: skip,
    d: () => showDetails(!document.body.classList.contains('details')), '[': () => stepEffort(-1), ']': () => stepEffort(1), u: () => undo(curId() && R.get(curId()).pile === 'claude' ? curId() : null), o: () => { const id = curId(); if (id && !(STAGE && isPrivate(BY.get(id).repo))) window.open(BY.get(id).url, '_blank', 'noopener'); } };
  const fn = map[e.key];
  if (fn) { e.preventDefault(); fn(); }
});

// ---------- load ----------
let loadedAt = 0;
async function load(refresh) {
  if (refresh) { $('#asof').textContent = 'Refreshing from GitHub, about 15 seconds'; UI.clear(); previewCache.clear(); }
  try {
    const r = await fetch('api/board' + (refresh ? '?refresh=1' : ''));
    if (!r.ok) throw new Error('HTTP ' + r.status);
    B = await r.json();
    B.prio = B.prio || {}; B.prioPicks = B.prioPicks || {}; B.planned = B.planned || {}; B.scores = B.scores || {}; B.scorePicks = B.scorePicks || {};
    B.carry = B.carry || { drafts: {}, picks: {}, posted: {} };
    stageCfg = { ...stageCfg, ...(B.stage || {}) };
    boardCfg = { ...boardCfg, ...(B.board || {}) };
    const esc_ = x => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    privateMask = boardCfg.privateRepos.length ? new RegExp(`\\b(?:[\\w.-]+\\/)?(?:${boardCfg.privateRepos.map(esc_).join('|')})#\\d+`, 'g') : null;
    $('#asof').title = boardCfg.name;
    ITEMS = B.items || []; BY = new Map(ITEMS.map(i => [i.id, i]));
    loadedAt = Date.now(); loadFailed = false;
    const dropped = dropStaleCarry();
    notice = dropped.length ? `A saved edit for ${dropped.map(T).join(', ')} was for an older set of drafts, so it was dropped. The new draft is shown.` : '';
    if (B.stale) notice = (notice ? notice + ' ' : '') + `GitHub is rate limited. Showing the board from ${new Date(B.fetchedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}.`;
    computeAll();
    const asof = new Date(B.fetchedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    $('#asof').innerHTML = `${STAGE ? '<span class="stagetag">Stage</span> ' : ''}Board as of ${esc(asof)} · <a href="#" data-act="refresh">refresh</a>`;
    return true;
  } catch (e) {
    loadFailed = true;
    $('#ledger').className = 'ledger off';
    $('#ledgerText').textContent = "Can't reach the server. Changes stay on this device.";
    if (!B) $('#tableView').innerHTML = `<div class="loading">Can't reach the refinery server. Your changes are kept on this device and save when it is back.</div>`;
    return false;
  }
}
function restore() {
  const m = /^#([\w-]+)(?:\/(.+))?$/.exec(location.hash || '');
  const id = m && m[2] ? m[2].replace(/-(\d+)$/, '#$1') : null;
  if (m && m[1] === 'collection') {
    const ids = collList().map(i => i.id);
    if (id && ids.includes(id)) { nav.view = 'table'; nav.source = 'coll'; nav.label = 'the Collection'; nav.deck = ids; nav.pos = ids.indexOf(id); render(); }
    else { nav.view = 'coll'; render(); }
    return;
  }
  const pile = m && PILE_NAME[m[1]] ? m[1] : 'turn';
  openPile(pile, id && BY.has(id) && R.get(id).pile === pile ? id : null);
  if (!m && !nav.deck.length) openPile(counts().claude ? 'claude' : 'turn');
}
function refreshBoard() {
  load(true).then(ok => {
    if (!ok) return;
    const id = curId();
    if (nav.source === 'pile') { nav.deck = pileItems(nav.pile).map(i => i.id); nav.pos = Math.max(0, nav.deck.indexOf(id)); }
    render();
    if (sheetKind) paintSheet();
  });
}
async function recover() { if (!B && await load(false)) restore(); }
window.addEventListener('online', () => { recover(); QUEUES.forEach(q => { q.retry = 5000; q.flush(); }); });
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') QUEUES.forEach(q => q.keepalive());
  else { recover(); QUEUES.forEach(q => { q.retry = 5000; q.flush(); }); }
});
window.addEventListener('pagehide', () => QUEUES.forEach(q => q.keepalive()));
window.addEventListener('resize', () => $$('textarea.now').forEach(autosize));

(async () => {
  if (await load(false)) { restore(); QUEUES.forEach(q => { if (q.count()) q.flush(); }); }
  paintLedger();
})();
