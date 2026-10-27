export const meta = {
  name: 'verify-by-id',
  description: 'Deep-verify backlog items given only their ids: is each problem still real, already fixed, or misdescribed',
  phases: [
    { title: 'Verify', detail: 'one agent per id, reproduce before believing', model: 'claude-opus-5-5' },
    { title: 'Skeptic', detail: 'adversarial second look at every already-fixed claim', model: 'claude-opus-5-5' },
  ],
}

// Args are bare ids like "tinacloud#3418". Keeping them bare is deliberate: a previous run passed a
// hand-retyped list of full item objects and 59 of 68 were the wrong issues. Each agent looks the
// issue up itself, so the only thing that can be mistyped is the number.
const IDS = (args && args.ids) || []
const CLONES = (args && args.clones) || '..'

const GUARDRAILS = `
GUARDRAILS. Firm. A previous run broke two of these.

1. NEVER write to GitHub. No comments, no labels, no closing, no body edits, no reactions.
   Read only: gh issue view, gh pr view, gh search, gh api GET.
2. NEVER leave a file in either repo working tree. Both clones are real checkouts Eli works in daily.
   A throwaway reproduction test goes under /tmp/verify-scratch/ and runs from there. If it must sit
   inside the package to resolve imports, move it out the moment you are done and run
   git -C <clone> status --porcelain to prove the tree is clean. Report that in cleanup_ok.
3. NEVER touch production AWS. No aws commands against a production profile, none at all. If you believe a
   production log query is the only way to settle it, do not run it: say so in blocked_on.
4. No destructive git. No checkout, no reset, no stash, no branch switching, no clean.
   Read history with git log, git show, git grep and git diff only.

Clones:
  ${CLONES}/tinacloud
  ${CLONES}/tinacms
Check the branch with git -C <path> status -sb before trusting the working tree, and prefer reading
origin/main explicitly: git -C <path> grep -n "pattern" origin/main -- <dir>
`

const METHOD = `
METHOD. Do both steps. This decides whether an item is fit to plan off, so the standard is evidence.

STEP 0. Read the issue first: gh issue view <number> -R tinacms/<repo> --comments. Everything you need
about what it claims comes from there, not from this prompt. If the number resolves to a pull request
rather than an issue, say so plainly, because several board rows have turned out to be Dependabot PRs.

STEP 1, REDUNDANCY. Search the codebase for an existing implementation of the behaviour by DOMAIN
CONCEPT, not by the wording of the issue, because the issue may describe the problem in language the
code no longer uses. Say where you looked. If the fix is already there, name the file and line and,
where you can find it, the PR that landed it.

STEP 2, VERIFY THE CLAIM. Do not believe the report. Trace the actual code path. Where it is cheap and
safe, write a throwaway test that injects the described condition and observe what happens. Report what
you actually saw: confirmed with the code path, confirmed by a test you ran, refuted, or not enough
detail to reproduce, which is itself a finding.

Read the COMMENTS and the TIMELINE, not just the body. Deliberate human decisions live there and bodies
go stale. An OPEN pull request is not a fix. A merged PR mentioning the issue is not automatically a fix
for the whole of it either: check it covers the WHOLE reported case.

Never use an em dash or an en dash.
`

const VERDICT = {
  type: 'object',
  properties: {
    id: { type: 'string', description: 'echo the id exactly as given to you' },
    actual_title: { type: 'string', description: 'the real title of the issue you read, so a mismatch is visible' },
    is_pull_request: { type: 'boolean' },
    still_real: { type: 'boolean' },
    already_fixed: { type: 'boolean' },
    fixed_by: { type: 'string' },
    reproduction: { type: 'string', enum: ['confirmed-code-path', 'confirmed-by-test', 'refuted', 'insufficient-detail', 'not-attempted'] },
    body_accuracy: { type: 'string', enum: ['accurate', 'stale-symptom', 'false-premise', 'unclear'] },
    evidence: { type: 'array', items: { type: 'string' } },
    ready_to_size: { type: 'boolean' },
    suggested_estimate: { type: 'number', description: 'on the scale 2, 4, 8, 16. Use 0 if you cannot honestly size it.' },
    recommended: { type: 'string', enum: ['size-and-promote', 'rewrite-body-first', 'close-already-fixed', 'close-not-planned', 'needs-decision', 'split', 'leave'] },
    recommended_decision: { type: 'string', description: 'when recommended is needs-decision, the call you would make and would defend. Empty otherwise.' },
    why: { type: 'string', description: 'two sentences max, plain language' },
    blocked_on: { type: 'string' },
    cleanup_ok: { type: 'boolean' },
  },
  required: ['id', 'actual_title', 'is_pull_request', 'still_real', 'already_fixed', 'reproduction', 'body_accuracy', 'evidence', 'ready_to_size', 'suggested_estimate', 'recommended', 'why', 'cleanup_ok'],
}

const SKEPTIC = {
  type: 'object',
  properties: {
    id: { type: 'string' },
    refuted: { type: 'boolean' },
    what_the_first_pass_missed: { type: 'string' },
    evidence: { type: 'array', items: { type: 'string' } },
    final: { type: 'string', enum: ['close-already-fixed', 'stays-open'] },
  },
  required: ['id', 'refuted', 'what_the_first_pass_missed', 'evidence', 'final'],
}

phase('Verify')
log(`Deep-verifying ${IDS.length} items by id`)

const results = await pipeline(
  IDS,
  id => {
    const [repo, num] = id.split('#')
    return agent(
      `${GUARDRAILS}\n${METHOD}\n\n` +
      `Your item: https://github.com/tinacms/${repo}/issues/${num}\n` +
      `Read it yourself and settle it with evidence. A text-only pass declined to judge this one, ` +
      `which is why it reached you.\n` +
      `Return the id exactly as "${id}", and put the issue's real title in actual_title.`,
      { model: 'claude-opus-5-5', label: `verify:${id}`, phase: 'Verify', schema: VERDICT }
    )
  },
  (res, id) => {
    if (!res) return null
    if (!res.already_fixed) return res
    const [repo, num] = id.split('#')
    return agent(
      `${GUARDRAILS}\n\nAn agent claims https://github.com/tinacms/${repo}/issues/${num} is ALREADY FIXED ` +
      `and should be closed. Closing a live bug is the expensive error: an earlier pass on this board got ` +
      `18 of 26 such calls wrong, and a later one nearly closed an issue whose symptom was still firing in ` +
      `production. Your job is to REFUTE. Default to refuted unless the evidence is airtight.\n\n` +
      `Their reasoning: ${res.why}\nFixed by: ${res.fixed_by || '(none named)'}\n` +
      `Their evidence:\n${(res.evidence || []).map(e => '  - ' + e).join('\n')}\n\n` +
      `Check: is the named PR actually MERGED and an ancestor of origin/main. Does the fix cover the WHOLE ` +
      `reported case. Is there a second code path with the same bug the fix missed. Did anyone re-report it ` +
      `after the fix landed. Does the reported SYMPTOM still occur, which is a different question from ` +
      `whether the named cause was fixed. Return the id exactly as "${id}".`,
      { model: 'claude-opus-5-5', label: `skeptic:${id}`, phase: 'Skeptic', schema: SKEPTIC }
    ).then(v => ({ ...res, skeptic: v }))
  }
)

const ok = results.filter(Boolean)
const returned = new Set(ok.map(r => r.id))
const missing = IDS.filter(i => !returned.has(i))
log(`${ok.length}/${IDS.length} verified`)
if (missing.length) log(`MISSING, no result returned: ${missing.join(', ')}`)
const prs = ok.filter(r => r.is_pull_request).map(r => r.id)
if (prs.length) log(`Not issues at all, these are pull requests: ${prs.join(', ')}`)
log(`ready_to_size held for ${ok.filter(r => r.ready_to_size).length}`)
const claimed = ok.filter(r => r.already_fixed)
log(`already-fixed claimed ${claimed.length}, overturned ${ok.filter(r => r.skeptic && r.skeptic.refuted).length}`)
const dirty = ok.filter(r => r.cleanup_ok === false).map(r => r.id)
if (dirty.length) log(`WARNING: unclean working tree reported by: ${dirty.join(', ')}`)
return ok
