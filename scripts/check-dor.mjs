// Prints how the board splits into piles under the Definition of Ready, from a data folder (default ./data).
// Usage: node scripts/check-dor.mjs [dataDir]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { acceptanceCriteria, prioLevel, readiness } from '../public/assets/dor.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const DATA = process.argv[2] || path.join(ROOT, 'data');
const read = (f, d) => { try { return JSON.parse(fs.readFileSync(path.join(DATA, f), 'utf8')); } catch { return d; } };
const snap = read('board-snapshot.json', null);
if (!snap) { console.error('No board-snapshot.json in', DATA); process.exit(1); }
const sugg = read('suggestions.json', {}), deep = read('deep.json', {}), dec = read('decisions.json', {});
const prio = read('priorities.json', {}), picks = read('priority-decisions.json', {});
const drafts = read('carry-drafts.json', {}), cpicks = read('carry-decisions.json', {}), posted = read('carry-posted.json', {});
const evidence = read('evidence.json', {}), types = read('types.json', {});
const cfg = JSON.parse(fs.readFileSync(path.join(ROOT, 'config.json'), 'utf8'));
const dor = cfg.dor || {};
const opts = process.env.DOR ? Object.fromEntries(process.env.DOR.split(',').map(k => [k, true])) : dor;

const piles = {}, kinds = {}, turn = [];
for (const b of snap.board) {
  const c = b.content || {};
  if (!c.number) continue;
  const repo = (c.repository || '').split('/').pop();
  const id = `${repo}#${c.number}`;
  const it = { id, url: `https://github.com/${cfg.owner}/${repo}/issues/${c.number}`, col: b.boardStatus, est: b.estimate ?? null, labels: b.labels || [],
    prioLevel: prioLevel(b.priority), hasSug: !!sugg[id], sug: sugg[id] || {}, ac: acceptanceCriteria(c.body), deep: deep[id] || null };
  it.title = b.title || c.title || '';
  const r = readiness(it, { d: dec[id], g: prio[id], pk: picks[id], cd: drafts[id], ck: cpicks[id], cp: posted[id], ev: evidence[id], ty: types[id] }, null, opts);
  piles[r.pile] = (piles[r.pile] || 0) + 1;
  if (r.pile === 'turn') { kinds[r.kind] = (kinds[r.kind] || 0) + 1; turn.push(`${id} ${r.kind} ${r.met}/4`); }
}
console.log('options', opts);
console.log('piles', piles);
console.log('your turn by kind', kinds);
console.log(turn.slice(0, 60).join('\n'));
