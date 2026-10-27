export const meta = {
  name: 'draft-bodies',
  description: 'Draft a replacement PBI body for each verified item, from its verification evidence',
  phases: [{ title: 'Draft', detail: 'one agent per item, reading its own evidence file', model: 'claude-opus-5-5' }],
}

// Bare ids again. Each agent reads its own evidence file, so nothing large is retyped through args.
const IDS = (args && args.ids) || []
const ROOT = (args && args.root) || '.'
const DIR = `${ROOT}/data/evidence`

const RULES = `
You are drafting a replacement body for one backlog item in tinacms/tinacloud or tinacms/tinacms.
Eli reviews and edits every draft before anything is posted, so give him a good first draft, not a
final answer. Nothing you write is published by you.

READ FIRST: ${DIR}/<id with # replaced by ->.json
It carries the current body, the verified verdict, the evidence behind it, and where a skeptic
overturned the first pass. That evidence is the whole reason this rewrite exists, so the new body must
describe what the evidence actually found, not what the issue was originally filed with.

WRITE NOTHING ANYWHERE except your returned draft. No GitHub writes, no files in either repo.

THE RULE THAT MATTERS MOST. Do not invent. Everything in the body must come from the evidence file or
the existing body. If a section cannot be written from those, leave it thinner rather than padding it.
A fabricated acceptance criterion looks authoritative and someone will build to it.

WHAT THE REWRITE IS FOR. These bodies were wrong in a specific way, recorded in body_accuracy:
- "stale-symptom" means the bug is real but the described symptom changed. Fix the description, keep
  the bug.
- "false-premise" means the body asserts something about the code that is not true. Remove the false
  claim outright, do not soften it.
Where skeptic_overturned is true, the first pass wanted to CLOSE this and was wrong. The body must make
clear what survives, because the next reader will otherwise close it too.

FORMAT. If is_yakshaver is true, keep YakShaver's shape exactly: the "Requested by ... via YakShaver.ai"
header, the cc line, the greeting, the video link and screen-share URL all verbatim; plain "###"
headings, not emoji ones; "### Pain" then an optional "### Approach" then "### Acceptance Criteria" as a
NUMBERED list; and keep "### Reproduce Steps" and "### Screenshot" verbatim from the current body.
Otherwise use the house shape: "### 🩸 Pain", "### 🛠️ Approach" as a flat checkbox list, "### ✅
Acceptance Criteria" as a flat checkbox list, optional "### Related".

Either way: preserve every image, every "Figure:" caption and every source link from the current body.
The 1 KB target governs your prose, not attachments. Target under 1000 characters of actual writing.
No code, no shell commands, no file paths, no ids, no tables. Name a thing only where the reader would
not otherwise know what to search for.

Never use an em dash or an en dash.
`

const SCHEMA = {
  type: 'object',
  properties: {
    id: { type: 'string', description: 'echo the id exactly as given' },
    body: { type: 'string', description: 'the complete replacement body, ready to paste' },
    change_summary: { type: 'string', description: 'one line saying what changed and why, so Eli can judge without diffing' },
    removed_claims: { type: 'array', items: { type: 'string' }, description: 'false or stale claims you deleted from the old body, so the deletion is visible' },
    kept_evidence: { type: 'boolean', description: 'true if every image, Figure caption and source link from the current body survives in your draft' },
    format: { type: 'string', enum: ['yakshaver', 'house'] },
  },
  required: ['id', 'body', 'change_summary', 'removed_claims', 'kept_evidence', 'format'],
}

phase('Draft')
log(`Drafting ${IDS.length} replacement bodies from verification evidence`)

const out = await parallel(IDS.map(id => () =>
  agent(
    `${RULES}\n\nYour item: ${id}\nEvidence file: ${DIR}/${id.replace('#', '-')}.json\n` +
    `Read it, then draft the replacement body. Return the id exactly as "${id}".`,
    { model: 'claude-opus-5-5', label: `draft:${id}`, phase: 'Draft', schema: SCHEMA }
  )
))

const ok = out.filter(Boolean)
const returned = new Set(ok.map(r => r.id))
const missing = IDS.filter(i => !returned.has(i))
log(`${ok.length}/${IDS.length} drafted`)
if (missing.length) log(`MISSING: ${missing.join(', ')}`)
const lost = ok.filter(r => r.kept_evidence === false).map(r => r.id)
if (lost.length) log(`WARNING: dropped an image or link: ${lost.join(', ')}`)
log(`formats: yakshaver ${ok.filter(r => r.format === 'yakshaver').length}, house ${ok.filter(r => r.format === 'house').length}`)
return ok
