// Loads a gather-evidence run into data/: types.json, evidence.json, and a retitle draft for every card whose title lacks
// its type's gitmoji. Prints the plan; writes only with --write, after backing up every file it touches.
// Usage: node scripts/load-evidence.mjs <workflow-result.json> [--write] [--api http://127.0.0.1:4380]
import fs from 'node:fs';
import path from 'node:path';
import { GITMOJI, titleType } from '../public/assets/dor.js';
import { cfg } from './board.mjs';

const ROOT = path.join(path.dirname(new URL(import.meta.url).pathname), '..');
const DATA = process.env.REFINERY_DATA || path.join(ROOT, 'data');
const [file, ...rest] = process.argv.slice(2);
const WRITE = rest.includes('--write');
const API = rest.includes('--api') ? rest[rest.indexOf('--api') + 1] : `http://127.0.0.1:${cfg.port || 4380}`;
const read = (f, d) => { try { return JSON.parse(fs.readFileSync(path.join(DATA, f), 'utf8')); } catch { return d; } };
const now = new Date().toISOString();
const NOTE = `Claude ${now.slice(0, 10)}: lead with the gitmoji for the issue type`;

const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
const run = raw.result || raw;
const expected = new Set(read('evidence-input/ids.json', []));
const cards = new Map();
for (const b of run.batches || []) {
  for (const c of b.cards || []) cards.set(c.id, { ...c, batch: b.batch });
  for (const f of b.fixes || []) {
    const c = cards.get(f.id);
    if (!c || !(f.field in c)) { console.warn(`fix skipped, unknown ${f.id}.${f.field}`); continue; }
    let v; try { v = JSON.parse(f.correct); } catch { v = f.correct; }
    console.log(`fix ${f.id}.${f.field}: ${JSON.stringify(c[f.field])} -> ${JSON.stringify(v)} (${f.reason})`);
    c[f.field] = v;
  }
}
const unknown = [...cards.keys()].filter(id => !expected.has(id));
const missing = [...expected].filter(id => !cards.has(id));
if (unknown.length) { console.error('ids not in the batch files, refusing:', unknown); process.exit(1); }
if (missing.length) console.warn(`${missing.length} batch ids have no result and stay unchecked:`, missing.join(' '));

const types = read('types.json', {}), evidence = read('evidence.json', {});
const drafts = read('carry-drafts.json', {}), picks = read('carry-decisions.json', {}), posted = read('carry-posted.json', {});
const decisions = read('decisions.json', {});
const board = new Map(((read('board-snapshot.json', {}).board) || []).filter(b => (b.content || {}).number)
  .map(b => [`${b.content.repository.split('/').pop()}#${b.content.number}`, b]));

const plan = { types: 0, evidence: 0, newDrafts: [], draftEdits: [], left: [] };
for (const [id, c] of cards) {
  if (!GITMOJI[c.type]) { plan.left.push([id, `unknown type ${c.type}`]); continue; }
  types[id] = { type: c.type, why: c.title_why, checked_at: now }; plan.types++;
  evidence[id] = {
    applies: c.applies, no_signal_reason: c.no_signal_reason,
    usage: { value: c.usage_value, users: c.usage_users, metric: c.usage_metric, source: c.usage_source },
    errors: { value: c.errors_value, users: c.errors_users, metric: c.errors_metric, source: c.errors_source },
    summary: c.summary, suggested: c.suggested_priority || '', confidence: c.confidence, checked_at: now,
  };
  plan.evidence++;

  const title = String(c.new_title || '').trim();
  if (!title) continue;
  if (titleType(title) !== c.type) { plan.left.push([id, `new title does not lead with ${GITMOJI[c.type][0]}: ${title}`]); continue; }
  const url = `https://github.com/${cfg.owner}/${id.split('#')[0]}/issues/${id.split('#')[1]}`;
  const ops = (drafts[id] || {}).ops || [];
  const n = ops.findIndex(o => o.kind === 'edit-title' && o.target === url);
  const pk = picks[id] || {};
  if (n >= 0 && String(n) in (((posted[id] || {}).ops) || {})) plan.left.push([id, 'its title draft is already posted; retitle on the next pass']);
  else if (n >= 0 && pk.decision === 'approve') plan.left.push([id, `you approved "${(((pk.edits || {})[String(n)] || {}).body ?? ops[n].body)}" before the gitmoji rule; Claude posts that as approved`]);
  else if (n >= 0 && pk.decision === 'skip') plan.left.push([id, 'its title draft was skipped']);
  else if (n >= 0) {
    const current = ((pk.edits || {})[String(n)] || {}).body ?? ops[n].body;
    if (current.trim() !== title) plan.draftEdits.push({ id, n, from: current, to: title });
  } else if (drafts[id]) plan.left.push([id, 'has a draft without a title op; add the retitle by hand']);
  else if (decisions[id] && decisions[id].decision == null && board.has(id)) plan.left.push([id, 'has an open decision; its rewrite carries the title']);
  else {
    const cur = (board.get(id) || {}).title || '';
    plan.newDrafts.push({ id, entry: {
      title: cur, url, summary: `Retitle so the title leads with ${GITMOJI[c.type][0]} for ${GITMOJI[c.type][1].toLowerCase()} work.`,
      ops: [{ kind: 'edit-title', target: url, ref: '', repo: '', title: '', body: title, state_reason: '', estimate: 0, why: c.title_why }],
      waiting_on: '', accepted_decision: '', skipped: '', drafted_by: NOTE,
    } });
  }
}

console.log(`\ntypes ${plan.types}, evidence ${plan.evidence}, new retitle drafts ${plan.newDrafts.length}, edits to waiting drafts ${plan.draftEdits.length}, left ${plan.left.length}`);
for (const e of plan.draftEdits) console.log(`edit ${e.id}: ${e.from}  ->  ${e.to}`);
for (const d of plan.newDrafts) console.log(`new  ${d.id}: ${d.entry.title}  ->  ${d.entry.ops[0].body}`);
for (const [id, why] of plan.left) console.log(`left ${id}: ${why}`);
if (!WRITE) { console.log('\nDry run. Add --write to apply.'); process.exit(0); }

const BK = path.join(DATA, 'backups', `pre-evidence-${now.slice(0, 19).replace(/[:T]/g, '-')}`);
fs.mkdirSync(BK, { recursive: true });
for (const f of ['types.json', 'evidence.json', 'carry-drafts.json', 'carry-decisions.json']) if (fs.existsSync(path.join(DATA, f))) fs.copyFileSync(path.join(DATA, f), path.join(BK, f));
fs.writeFileSync(path.join(DATA, 'types.json'), JSON.stringify(types, null, 1));
fs.writeFileSync(path.join(DATA, 'evidence.json'), JSON.stringify(evidence, null, 1));
// The server never writes carry-drafts.json, so new drafts go straight in; edits to existing ones go through its PUT route,
// which serialises them with any click Eli makes at the same moment.
for (const d of plan.newDrafts) drafts[d.id] = d.entry;
fs.writeFileSync(path.join(DATA, 'carry-drafts.json'), JSON.stringify(drafts, null, 1));
for (const e of plan.draftEdits) {
  const res = await fetch(`${API}/api/carry/${encodeURIComponent(e.id)}`, { method: 'PUT', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ edits: { [String(e.n)]: { body: e.to } }, edited_by: NOTE }) });
  if (!res.ok) console.error(`edit ${e.id} failed: HTTP ${res.status}`);
}
console.log(`written; backups in ${BK}`);
