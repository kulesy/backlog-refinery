// Puts the board's Priority in line with each card's Priority Score band, run by hand. A scheduled workflow in
// your own repo may do the same, see docs/priority-sync.md.
// Usage: node scripts/sync-priority.mjs [--dry-run]
// It sets only the Priority field, only on cards that have a valid score, and writes no file, so it is safe beside the running app.
import { readBoard, priorityConfigError, setPriority } from './board.mjs';
import { levelForScore } from '../public/assets/dor.js';

const DRY = process.argv.includes('--dry-run');
const now = () => new Date().toISOString();
const why = e => String(e.stderr || e.message).trim().split('\n')[0];

if (priorityConfigError()) { console.error(`${now()} ${priorityConfigError()}`); process.exit(1); }

let board;
try { board = await readBoard(); } catch (e) { console.error(`${now()} could not read the board: ${why(e)}`); process.exit(1); }

let checked = 0, fixed = 0, failed = 0, streak = 0;
for (const [id, item] of board) {
  const want = levelForScore(item.score);
  if (!want) continue;
  checked++;
  if (item.priority === want) continue;
  const change = `${id} score ${item.score}: ${item.priority ?? 'none'} to ${want}`;
  if (DRY) { fixed++; console.log(`${now()} ${change} (dry run)`); continue; }
  try {
    await setPriority(item.itemId, want);
  } catch (e) {
    failed++;
    console.error(`${now()} ${change} failed: ${why(e)}`);
    if (++streak >= 3) { console.error(`${now()} three failures in a row, stopping until the next run`); break; }
    continue;
  }
  streak = 0;
  fixed++;
  console.log(`${now()} ${change}`);
}

console.log(`${now()} priority sync${DRY ? ' dry run' : ''}: checked ${checked}, ${DRY ? 'would fix' : 'fixed'} ${fixed}, failed ${failed} (${board.size} cards read)`);
process.exit(failed ? 1 : 0);
