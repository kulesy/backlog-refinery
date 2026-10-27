// Sets Eli's approved priority scores on the board. Claude runs this when he says "Apply the scores"; the app never does.
// Usage: node scripts/apply-scores.mjs [--dry-run]
// It touches two fields: Priority Score (a number) and Priority (a single select), which follows the score's band.
// It records applied_at in score-decisions.json once both are right for a pick, so a partial run keeps its progress.
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, cfg, gh, readBoard, priorityConfigError, setPriority } from './board.mjs';
import { levelForScore } from '../public/assets/dor.js';

const DATA = process.env.REFINERY_DATA || path.join(ROOT, 'data');
const DRY = process.argv.includes('--dry-run');
const FILE = path.join(DATA, 'score-decisions.json');
const read = () => { try { return JSON.parse(fs.readFileSync(FILE, 'utf8')); } catch { return {}; } };

// Re-read just before writing, so a pick Eli changed while this ran is never marked applied.
function markApplied(id, score) {
  const all = read();
  if (!all[id] || all[id].score !== score) return false;
  all[id].applied_at = new Date().toISOString();
  fs.writeFileSync(FILE + '.tmp', JSON.stringify(all, null, 1));
  fs.renameSync(FILE + '.tmp', FILE);
  return true;
}

const fieldId = (cfg.fields || {}).score;
if (!fieldId) { console.error('config.json has no fields.score'); process.exit(1); }
if (priorityConfigError()) { console.error(priorityConfigError()); process.exit(1); }
const valid = s => Number.isInteger(s) && s >= 0 && s <= 100;
const todo = Object.entries(read()).filter(([, p]) => !p.applied_at);
if (!todo.length) { console.log('Nothing to apply. Every approved score is already on the board.'); process.exit(0); }

const board = await readBoard();
const done = new Map(), failed = [];
let streak = 0, scoresToSet = 0, levelsToSet = 0;
for (const [id, pick] of todo) {
  const item = board.get(id);
  if (!item) { console.warn(`${id}: not on the board, left alone`); failed.push(id); continue; }
  if (!valid(pick.score)) { console.warn(`${id}: ${JSON.stringify(pick.score)} is not a whole number from 0 to 100, left alone`); failed.push(id); continue; }
  const level = levelForScore(pick.score);
  const scoreOk = item.score === pick.score, levelOk = item.priority === level;
  if (scoreOk) console.log(`${id}: board already has ${pick.score}`);
  if (DRY) {
    if (!scoreOk) { scoresToSet++; console.log(`would set ${id} to ${pick.score} (board has ${item.score ?? 'nothing'}, item ${item.itemId})`); }
    if (!levelOk) { levelsToSet++; console.log(`would set ${id} Priority to ${level} (board has ${item.priority ?? 'nothing'})`); }
    done.set(id, pick.score);
    continue;
  }
  try {
    if (!scoreOk) {
      await gh(['project', 'item-edit', '--id', item.itemId, '--project-id', cfg.projectId, '--field-id', fieldId, '--number', String(pick.score)]);
      console.log(`${id}: set ${pick.score}`);
    }
    if (!levelOk) {
      await setPriority(item.itemId, level);
      console.log(`${id}: set Priority ${level}`);
    }
  } catch (e) {
    console.warn(`${id}: gh failed: ${String(e.message).split('\n')[0]}`);
    failed.push(id);
    if (++streak >= 3) { console.error('Three failures in a row, stopping. Run it again to carry on.'); break; }
    continue;
  }
  streak = 0;
  markApplied(id, pick.score);
  done.set(id, pick.score);
}

if (DRY) { console.log(`Dry run: ${scoresToSet} scores and ${levelsToSet} priorities would be set, ${failed.length} left alone. Nothing written.`); process.exit(0); }

const after = done.size ? await readBoard() : new Map();
const off = [...done].filter(([id, score]) => { const a = after.get(id) || {}; return a.score !== score || a.priority !== levelForScore(score); });
console.log(`Applied ${done.size}, ${failed.length} left alone.`);
if (off.length) {
  console.error(`${off.length} on the board do not match the approved score and its Priority:`);
  for (const [id, score] of off) { const a = after.get(id) || {}; console.error(`${id}: approved ${score} and ${levelForScore(score)}, board shows ${a.score ?? 'nothing'} and ${a.priority ?? 'no priority'}`); }
} else if (done.size) console.log('Re-read the board: every applied score and Priority matches.');
process.exit(off.length || failed.length ? 1 : 0);
