export const meta = {
  name: 'check-repo',
  description: 'Decide whether each backlog item sits in the right repo, tinacms (public) or tinacloud (private)',
  phases: [{ title: 'Placement', detail: 'one agent per item, read-only', model: 'claude-opus-5-5' }],
}

const IDS = (args && args.ids) || []
const CLONES = (args && args.clones) || '..'

const BRIEF = `
You are checking whether one backlog issue lives in the right repository.

THE TWO REPOS.
- tinacms/tinacms is PUBLIC. It is the open-source CMS: the tinacms and @tinacms/* packages, the CLI,
  GraphQL, MDX, the editor, media manager, create-tina-app, v4. Community contributors read it.
- tinacms/tinacloud is PRIVATE. It is the hosted service and the team's own backlog: content-api,
  identity, assets-api, the dashboard at app.tina.io, infrastructure, billing, accounts, and anything
  internal to the business.
Clones: ${CLONES}/tinacms and ${CLONES}/tinacloud. Read origin/main only.

GITHUB CANNOT TRANSFER AN ISSUE FROM A PRIVATE REPO TO A PUBLIC ONE. Moving a tinacloud issue to tinacms
means writing a fresh public issue and closing the private one, losing its comment history. Only
recommend that when the item genuinely belongs in public, and weigh the cost.

DECIDE, WITH EVIDENCE.
1. Read the issue and its comments: gh issue view <n> -R tinacms/<repo> --comments.
2. Where would the fix actually be made? Name the files or packages. Answer tinacms, tinacloud, both,
   or neither (docs site, marketing, video, process).
3. Must it stay private? Yes if it describes an undisclosed security issue, names a customer or their
   data, quotes production figures or internal infrastructure, or covers internal business such as
   pricing or staffing. Say which. A private item stays in tinacloud whatever its code home.
4. Was it placed deliberately? Look for a comment, an epic or a board decision that explains why it
   sits where it does, such as the team tracking some CMS work on its private board on purpose.
5. Does tinacms already have an issue for the same thing? Search: gh search issues -R tinacms/tinacms
   "<key words>". If so, give the URL; the right move is then usually to close this one as a duplicate.

GUARDRAILS. Read only. No GitHub writes of any kind. No files in either repo tree. No AWS. No
destructive git. Never use an em dash or an en dash.
`

const SCHEMA = {
  type: 'object',
  properties: {
    id: { type: 'string', description: 'echo the id exactly as given' },
    actual_title: { type: 'string' },
    code_home: { type: 'string', enum: ['tinacms', 'tinacloud', 'both', 'neither'] },
    code_evidence: { type: 'string', description: 'the files or packages the fix would touch, one line' },
    must_stay_private: { type: 'boolean' },
    private_reason: { type: 'string', description: 'why it must stay private, or empty' },
    deliberate_placement: { type: 'string', description: 'any recorded reason it sits where it does, with a link, or empty' },
    tinacms_duplicate: { type: 'string', description: 'full URL of an existing tinacms issue covering the same thing, or empty' },
    recommendation: { type: 'string', enum: ['stay', 'recreate-in-tinacms', 'transfer-to-tinacloud', 'close-as-duplicate', 'split'] },
    why: { type: 'string', description: 'two sentences at most, plain language' },
    cleanup_ok: { type: 'boolean' },
  },
  required: ['id', 'actual_title', 'code_home', 'code_evidence', 'must_stay_private', 'private_reason', 'deliberate_placement', 'tinacms_duplicate', 'recommendation', 'why', 'cleanup_ok'],
}

phase('Placement')
log(`Checking repo placement for ${IDS.length} items`)

const out = await parallel(IDS.map(id => () => {
  const [repo, num] = id.split('#')
  return agent(
    `${BRIEF}\n\nYour item: https://github.com/tinacms/${repo}/issues/${num}\n` +
    `It currently lives in tinacms/${repo}. Return the id exactly as "${id}".`,
    { model: 'claude-opus-5-5', label: `repo:${id}`, phase: 'Placement', schema: SCHEMA }
  )
}))

const ok = out.filter(Boolean)
const returned = new Set(ok.map(r => r.id))
const missing = IDS.filter(i => !returned.has(i))
log(`${ok.length}/${IDS.length} checked`)
if (missing.length) log(`MISSING: ${missing.join(', ')}`)
const moves = ok.filter(r => r.recommendation !== 'stay').map(r => `${r.id}:${r.recommendation}`)
log(`not staying: ${moves.length ? moves.join(', ') : 'none'}`)
return ok
