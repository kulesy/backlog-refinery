// Writes config.json for a GitHub Projects v2 board by asking gh for its fields and options.
// Usage: node scripts/init.mjs <owner> <projectNumber> [--force]
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

const STATUS_MATCHERS = {
  needsTriage: n => /triage/i.test(n),
  notReady: n => /not ready/i.test(n),
  ready: n => /(^|[^a-z])ready$/i.test(n.trim()) && !/not ready/i.test(n),
  done: n => /done/i.test(n),
  wontDo: n => /won['\u2019]?t|not planned/i.test(n),
};
const LEVELS = ['Urgent', 'High', 'Medium', 'Low'];
const find = (fields, test) => fields.find(f => test(String(f.name || '')));
const options = f => (f && Array.isArray(f.options) ? f.options : []).filter(o => o && o.id && o.name);

// view: `gh project view --format json`. list: `gh project field-list --format json`. Returns { config, problems }.
export function buildConfig({ owner, projectNumber, view, list }) {
  const problems = [];
  const fields = Array.isArray(list && list.fields) ? list.fields.filter(f => f && f.id && f.name) : [];
  const byName = name => find(fields, n => n.toLowerCase() === name);
  const status = byName('status'), priority = byName('priority');
  const estimate = byName('estimate') || find(fields, n => /^(estimate|effort|size|story points?)$/i.test(n));
  const score = find(fields, n => /priority score/i.test(n));
  if (!view || !view.id) problems.push('The project id was not in the gh project view output, so projectId is empty.');
  if (!status) problems.push('No field called Status was found, so fields.status and statusOptions are empty.');
  if (!estimate) problems.push('No Estimate field was found, so fields.estimate is empty.');
  if (!priority) problems.push('No Priority single-select field was found, so fields.priority and priorityOptions are empty.');

  const statusOptions = {}, statusNames = {};
  for (const [key, test] of Object.entries(STATUS_MATCHERS)) {
    const opt = options(status).find(o => test(o.name));
    if (opt) { statusOptions[key] = opt.id; statusNames[key] = opt.name; }
    else if (status) problems.push(`No Status option matched ${key}. Add its id to statusOptions by hand.`);
  }
  const priorityOptions = {};
  for (const level of LEVELS) {
    const opt = options(priority).find(o => o.name.toLowerCase() === level.toLowerCase());
    if (opt) priorityOptions[level] = opt.id;
    else if (priority) problems.push(`No Priority option named ${level}. Add its id to priorityOptions by hand.`);
  }
  if (!score) problems.push('No "Priority Score" number field was found. fields.score is left out, so the score features stay off.');

  const inProgress = options(status).find(o => /in progress/i.test(o.name));
  const statuses = [statusNames.needsTriage, statusNames.notReady, statusNames.ready, inProgress && inProgress.name].filter(Boolean);
  const config = {
    owner, projectNumber: Number(projectNumber), projectId: (view && view.id) || '',
    boardName: (view && view.title) || `${owner} project ${projectNumber}`,
    triageStatus: statusNames.needsTriage || '',
    fields: { status: status && status.id || '', estimate: estimate && estimate.id || '', ...(score ? { score: score.id } : {}), priority: priority && priority.id || '' },
    statusOptions, priorityOptions,
    port: 4380, boardCacheMinutes: 10,
    notReadyStatus: statusNames.notReady || '',
    statuses,
    repos: [], privateRepos: [],
    dor: { gitmoji: false, evidence: false },
  };
  return { config, problems };
}

const ghJson = args => JSON.parse(execFileSync('gh', args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }));

function main(argv) {
  const force = argv.includes('--force');
  const [owner, projectNumber] = argv.filter(a => !a.startsWith('--'));
  if (!owner || !/^\d+$/.test(projectNumber || '')) { console.error('Usage: node scripts/init.mjs <owner> <projectNumber> [--force]'); return 1; }
  const out = path.join(ROOT, 'config.json');
  if (fs.existsSync(out) && !force) { console.error('config.json already exists. Run with --force to overwrite it.'); return 1; }
  let view, list;
  try {
    view = ghJson(['project', 'view', projectNumber, '--owner', owner, '--format', 'json']);
    list = ghJson(['project', 'field-list', projectNumber, '--owner', owner, '--limit', '100', '--format', 'json']);
  } catch (e) {
    console.error(`gh could not read the project: ${String(e.stderr || e.message).trim().split('\n')[0]}\nCheck that gh is signed in (gh auth status) and has the project scope (gh auth refresh -s project).`);
    return 1;
  }
  const { config, problems } = buildConfig({ owner, projectNumber, view, list });
  fs.writeFileSync(out, JSON.stringify(config, null, 2) + '\n');
  console.log(`Wrote ${out}`);
  if (problems.length) console.log('\nFix by hand in config.json:\n' + problems.map(p => `- ${p}`).join('\n'));
  console.log('\nOptional: list repos, privateRepos and repoLabels (see config.example.json). repos is read from the board when left empty.');
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) process.exit(main(process.argv.slice(2)));
