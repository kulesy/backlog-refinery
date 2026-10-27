// Load a verify-ids workflow result into the app's data files.
// usage: node scripts/load-verify.mjs <results.json> <id,id,...> <tag>
//
// Lives in the repo rather than a scratch dir: the first copy was written to the session
// scratchpad and was cleaned out mid-sweep, taking the only record of the mapping with it.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const [resultsPath, idsArg, tag] = process.argv.slice(2);
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const cfg = JSON.parse(fs.readFileSync(path.join(ROOT, 'config.json'), 'utf8'));
const DATA = process.env.REFINERY_DATA || path.join(ROOT, 'data');
const expected = idsArg.split(',');
const results = JSON.parse(fs.readFileSync(resultsPath, 'utf8'));

// Set-diff before trusting anything. A previous run verified 59 wrong items because the ids
// were hand-retyped, and nothing compared what came back against what went out.
const returned = new Set(results.map(r => r.id));
const missing = expected.filter(i => !returned.has(i));
const extra = [...returned].filter(i => !expected.includes(i));
if (missing.length || extra.length) {
  console.error('ID MISMATCH. missing:', missing, 'extra:', extra);
  process.exit(1);
}

const rj = f => JSON.parse(fs.readFileSync(path.join(DATA, f), 'utf8'));
const wj = (f, o) => fs.writeFileSync(path.join(DATA, f), JSON.stringify(o));
const backup = f => fs.copyFileSync(path.join(DATA, f), path.join(DATA, 'backups', f.replace('.json', `-pre${tag}.json`)));
for (const f of ['decisions.json', 'suggestions.json', 'deep.json', 'scope.json']) backup(f);
fs.writeFileSync(path.join(DATA, `verify-${tag}.json`), JSON.stringify(results, null, 1));

const sug = rj('suggestions.json');
const deep = rj('deep.json');
const dec = rj('decisions.json');
const scope = rj('scope.json');
for (const id of expected) if (!scope.includes(id)) scope.push(id);

const ACTION = {
  'rewrite-body-first': 'rewrite-and-estimate',
  'size-and-promote': 'set-estimate',
  'close-not-planned': 'close-not-planned',
  'needs-decision': 'needs-decision',
  'split': 'split',
  'leave': 'leave-as-is',
};

const summary = [];
for (const v of results) {
  const overturned = !!(v.skeptic && v.skeptic.refuted);
  // An already-fixed claim is only ever a close once a skeptic has tried to refute it and failed.
  // Across this sweep the skeptic overturned 8 of the first 9 such claims, so a first pass alone is
  // not evidence. If the skeptic never ran (it can die on a usage limit), the item goes to Eli as a
  // decision carrying the unchecked claim, never as a close.
  const skepticRan = !!(v.skeptic && typeof v.skeptic.refuted === 'boolean');
  const unchecked = v.already_fixed && !skepticRan;
  let action;
  if (unchecked) action = 'needs-decision';
  else if (v.recommended === 'close-already-fixed') action = overturned ? 'rewrite-and-estimate' : 'close-not-planned';
  else if (overturned) action = 'rewrite-and-estimate';
  else action = ACTION[v.recommended] || 'needs-decision';

  const sized = ['set-estimate', 'rewrite-and-estimate', 'needs-decision', 'split'].includes(action) && v.suggested_estimate > 0;
  const isClose = action === 'close-not-planned';
  const entry = {
    action,
    estimate: sized ? v.suggested_estimate : 0,
    estimate_reason: sized ? 'From the deep verification.' : '',
    body: '',
    body_summary: '',
    close_target: isClose ? (v.fixed_by || '') : '',
    close_reason: isClose ? v.why : '',
    needs_info: [...(v.blocked_on ? [v.blocked_on] : []), ...(v.evidence || []).slice(0, 4).map(e => 'Evidence: ' + e)],
    confidence: 'high',
    rationale: overturned ? 'Skeptic overturned the close. ' + v.skeptic.what_the_first_pass_missed : v.why,
    recommended_decision: unchecked
      ? `An agent says this is already fixed, but the adversarial re-check never ran (it died on a usage limit). Do not close it on this alone: the skeptic overturned 8 of the first 9 already-fixed calls in this sweep. Re-run the skeptic before deciding. The unchecked claim was: ${v.why}`
      : (action === 'needs-decision' ? (v.recommended_decision || '') : ''),
    decision_basis: action === 'needs-decision' ? v.why : '',
  };
  const prev = sug[v.id] || {};
  sug[v.id] = entry;
  deep[v.id] = 'verified';

  // A re-verified item whose suggestion did not move keeps Eli's decision: sending it back to the
  // queue would only ask him to click accept on the call he already made. Anything else goes back,
  // with the old call preserved under prior so nothing he decided is lost.
  // A rewrite is never "unchanged": its body is redrafted from the verified facts, so Eli has to see it again.
  const unchanged = prev.action === entry.action && (prev.estimate || 0) === (entry.estimate || 0)
    && entry.action !== 'verify-first' && !/^rewrite/.test(entry.action);
  if (unchanged) console.error(`${v.id}: suggestion unchanged (${entry.action} ${entry.estimate}), decision kept`);
  else if (dec[v.id] && (dec[v.id].decision || dec[v.id].applied)) {
    dec[v.id].prior = { decision: dec[v.id].decision || null, at: dec[v.id].at, applied: dec[v.id].applied || null };
    delete dec[v.id].decision; delete dec[v.id].applied;
  }

  if (action === 'rewrite-and-estimate') {
    const [repo, num] = v.id.split('#');
    // REST, not `gh issue view` (GraphQL): a big sweep can drain the GraphQL budget right before
    // this runs. The app's own board cache is the fallback, since it already holds every body.
    let issue;
    try {
      const r = JSON.parse(execFileSync('gh', ['api', `repos/${cfg.owner}/${repo}/issues/${num}`], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }));
      issue = { title: r.title, body: r.body || '' };
    } catch (e) {
      const board = JSON.parse(execFileSync('curl', ['-s', '-m', '90', `http://127.0.0.1:${cfg.port || 4380}/api/board`], { encoding: 'utf8' }));
      const row = (board.items || board).find(x => x.id === v.id);
      if (!row) throw new Error(`no body source for ${v.id}: ${e.message}`);
      issue = { title: row.title, body: row.body || '' };
      console.error(`body for ${v.id} taken from the board cache`);
    }
    const ev = {
      id: v.id, title: issue.title, current_body: issue.body,
      verdict: v.recommended, why: v.why, body_accuracy: v.body_accuracy, reproduction: v.reproduction,
      evidence: v.evidence || [], blocked_on: v.blocked_on || '',
      skeptic_overturned: overturned,
      skeptic_missed: overturned ? v.skeptic.what_the_first_pass_missed : '',
      skeptic_evidence: overturned ? (v.skeptic.evidence || []) : [],
      is_yakshaver: /YakShaver/i.test(issue.body || ''),
    };
    fs.mkdirSync(path.join(DATA, 'evidence'), { recursive: true });
    fs.writeFileSync(path.join(DATA, 'evidence', `${repo}-${num}.json`), JSON.stringify(ev, null, 1));
  }
  summary.push({ id: v.id, recommended: v.recommended, overturned, action, estimate: entry.estimate, reproduction: v.reproduction, body_accuracy: v.body_accuracy, cleanup_ok: v.cleanup_ok, is_pr: v.is_pull_request });
}

wj('suggestions.json', sug);
wj('deep.json', deep);
wj('decisions.json', dec);
wj('scope.json', scope);
console.table(summary);
