// Turns agent ratings into drafted priority scores in data/scores.json. Only this script writes that file.
// Usage: node scripts/load-scores.mjs [inputDir]
// With a folder of out-*.json and batch-*.json it scores those cards; with none it re-scores scores.json from its stored ratings.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { LEVELS, SCORE_BANDS, sizeRating, weightedRating, scoreFromRatings } from '../public/assets/dor.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const DATA = process.env.REFINERY_DATA || path.join(ROOT, 'data');
const FILE = path.join(DATA, 'scores.json');
const read = (f, d) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return d; } };
const rating = v => Number.isInteger(v) && v >= 0 && v <= 5;
const CONFIDENCE = ['high', 'medium', 'low'];
const now = new Date().toISOString();

const dir = process.argv[2];
const old = read(FILE, null);
const scores = { ...(old || {}) };
const touched = [];
let skipped = 0;
const skip = (where, why) => { skipped++; console.warn(`skipped ${where}: ${why}`); };

if (dir) {
  const files = fs.readdirSync(dir).sort();
  const cards = new Map();
  for (const f of files.filter(f => /^batch-.*\.json$/.test(f))) {
    for (const c of read(path.join(dir, f), {}).cards || []) cards.set(c.id, c);
  }
  const outs = files.filter(f => /^out-.*\.json$/.test(f));
  if (!outs.length) { console.error(`No out-*.json in ${dir}`); process.exit(1); }
  for (const f of outs) {
    const out = read(path.join(dir, f), null);
    if (!out || !Array.isArray(out.items)) { skip(f, 'not an out file with an items list'); continue; }
    for (const it of out.items) {
      if (!it || typeof it !== 'object') { skip(f, 'an item is not an object'); continue; }
      const where = `${f} ${it.id}`;
      const card = cards.get(it.id);
      if (!card) { skip(where, 'id is not in any batch file'); continue; }
      if (![it.goal, it.evidence, it.value].every(rating)) { skip(where, 'ratings must be whole numbers from 0 to 5'); continue; }
      if (!LEVELS.includes(it.level)) { skip(where, `level ${JSON.stringify(it.level)} is not Urgent, High, Medium or Low`); continue; }
      if (!CONFIDENCE.includes(it.level_confidence)) { skip(where, `level_confidence ${JSON.stringify(it.level_confidence)} is not high, medium or low`); continue; }
      if (card.level != null && !LEVELS.includes(card.level)) { skip(where, `board level ${JSON.stringify(card.level)} is not valid`); continue; }
      const board = card.level || null;
      const level = !board || (it.level !== board && it.level_confidence !== 'low') ? it.level : board;
      const ratings = { goal: it.goal, evidence: it.evidence, value: it.value, size: sizeRating(card.estimate) };
      scores[it.id] = {
        score: null, level, board_level: board, level_change: level !== board ? level : null,
        agent_level: it.level, level_confidence: it.level_confidence, ratings, reason: String(it.reason || '').trim(), drafted_at: now,
      };
      touched.push(it.id);
    }
  }
} else if (!old) { console.error(`No ${FILE} to re-score`); process.exit(1); }

if (dir && !touched.length) { console.error('Nothing scored, scores.json left as it was.'); process.exit(1); }

// Every card is placed again, because one new card can move its level's span and so every score in that band.
const valid = Object.entries(scores).filter(([id, s]) => {
  const r = s.ratings || {};
  if (SCORE_BANDS[s.level] && [r.goal, r.evidence, r.value, r.size].every(rating)) return true;
  skip(id, 'stored level or ratings are not valid');
  return false;
});
const spans = {};
for (const [, s] of valid) {
  const w = weightedRating(s.ratings), sp = spans[s.level] || (spans[s.level] = [w, w]);
  sp[0] = Math.min(sp[0], w); sp[1] = Math.max(sp[1], w);
}
for (const [id, s] of valid) scores[id] = { ...s, score: scoreFromRatings(s.level, s.ratings, spans[s.level]) };
if (!dir) touched.push(...valid.map(([id]) => id));
if (!touched.length) { console.error('Nothing scored, scores.json left as it was.'); process.exit(1); }

if (old) {
  fs.mkdirSync(path.join(DATA, 'backups'), { recursive: true });
  const stamp = now.replace(/[-:]/g, '').replace(/\..*/, '').replace('T', '-');
  fs.copyFileSync(FILE, path.join(DATA, 'backups', `scores-${stamp}.json`));
}
fs.writeFileSync(FILE + '.tmp', JSON.stringify(scores, null, 1));
fs.renameSync(FILE + '.tmp', FILE);

const bands = Object.fromEntries(LEVELS.map(l => [l, 0]));
for (const id of touched) bands[scores[id].level]++;
console.log(`${dir ? 'Scored' : 'Re-scored'} ${touched.length}, skipped ${skipped}. ${Object.keys(scores).length} cards now in ${FILE}`);
console.log('per band', bands);
console.log(`${touched.filter(id => scores[id].level_change).length} carry a level change`);
