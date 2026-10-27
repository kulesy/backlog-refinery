// Board access shared by the scripts that write to GitHub (apply-scores.mjs, sync-priority.mjs). Writes no file.
import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { LEVELS, prioLevel } from '../public/assets/dor.js';

const run = promisify(execFile);
export const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
export const cfg = JSON.parse(fs.readFileSync(path.join(ROOT, 'config.json'), 'utf8'));
export const gh = async args => (await run('gh', args, { maxBuffer: 64 * 1024 * 1024 })).stdout;

// gh lowercases field names, so a field is found by name, ignoring case.
const field = (b, name) => { const key = Object.keys(b).find(k => k.toLowerCase() === name); return key ? b[key] : undefined; };

// Same query as loadBoard() in server.mjs. Returns id -> { itemId, score, priority }, with priority as a level or null.
export async function readBoard() {
  const byId = new Map();
  for (const status of (cfg.statuses || [cfg.triageStatus]).filter(Boolean)) {
    const got = JSON.parse(await gh(['project', 'item-list', String(cfg.projectNumber), '--owner', cfg.owner,
      '--limit', '600', '--format', 'json', '--query', `status:"${status}"`])).items || [];
    if (got.length >= 600) console.warn(`WARNING: "${status}" hit the 600 limit, results may be truncated`);
    if (!got.length) console.warn(`WARNING: "${status}" returned nothing, check the emoji in the query string`);
    for (const b of got) {
      const c = b.content || {};
      if (!c.number) continue;
      const raw = field(b, 'priority score');
      const n = raw != null && raw !== '' ? Number(raw) : NaN;
      byId.set(`${(c.repository || '').split('/').pop()}#${c.number}`, { itemId: b.id, score: Number.isFinite(n) ? n : null, priority: prioLevel(field(b, 'priority')) });
    }
  }
  return byId;
}

// A reason the Priority field cannot be written, or null when config.json has its ids.
export function priorityConfigError() {
  if (!(cfg.fields || {}).priority) return 'config.json has no fields.priority';
  const missing = LEVELS.filter(l => !(cfg.priorityOptions || {})[l]);
  return missing.length ? `config.json priorityOptions has no id for ${missing.join(', ')}` : null;
}

export const setPriority = (itemId, level) => gh(['project', 'item-edit', '--id', itemId, '--project-id', cfg.projectId,
  '--field-id', cfg.fields.priority, '--single-select-option-id', cfg.priorityOptions[level]]);
