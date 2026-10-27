export const meta = {
  name: 'grade-priority',
  description: 'Grade each Ready backlog item Urgent, High, Medium or Low, and flag the calls Eli should make himself',
  phases: [{ title: 'Grade', detail: 'one agent per batch of about 20 items', model: 'claude-opus-5-5' }],
}

// Args are batch numbers; each batch file holds the items and their verified facts, so no id is retyped.
const BATCHES = (args && args.batches) || []
const ROOT = (args && args.root) || '.'
const DIR = `${ROOT}/data/prio-input`

const RUBRIC = `
You are setting the Priority field on backlog items for the TinaCloud and TinaCMS team. Each item has
already been verified against the code, and your batch file carries that evidence. Do not re-verify.
Read only your batch file. Write nothing anywhere. Never use an em dash or an en dash.

THE FOUR LEVELS.
- Urgent: harm is happening now and should jump the queue. Customer data lost or corrupted, a security
  hole that is exploitable or an exposure that is live, customers blocked from a core flow, or money lost.
- High: a confirmed bug with real customer or operational impact that has a workaround or limited
  reach, a concrete security gap that is not being exploited, or work with a near deadline (the October
  WorkOS cutover, a release) or that blocks other High work.
- Medium: clear-value improvements, user-facing friction, observability, docs people actually hit.
- Low: nice-to-have, cosmetic, internal tidy-up, tech debt with no current pain, undated marketing.

How the team has used it so far: production dead-letter bugs with a measured blast radius were High,
an improvement spike and a marketing video were Medium.

DECIDE FOR EACH ITEM.
1. priority: one of Urgent, High, Medium, Low.
2. confidence: high when the evidence plainly puts it in that level, medium when one neighbouring level
   is also defensible, low when you are guessing.
3. needs_eli: true when ANY of these hold, else false.
   - you chose Urgent
   - confidence is not high
   - the level really turns on a business or product call (pricing, marketing, partnerships, roadmap
     order, a customer relationship) rather than on the evidence
   - the item already has a current_priority and yours differs
4. reason: one plain sentence a busy lead can act on. Name the impact, not the mechanism.

Grade each item on its own merits. Do not spread items evenly across the levels.
`

const SCHEMA = {
  type: 'object',
  properties: {
    batch: { type: 'string' },
    items: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'the id exactly as it appears in the batch file' },
          priority: { type: 'string', enum: ['Urgent', 'High', 'Medium', 'Low'] },
          confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
          needs_eli: { type: 'boolean' },
          business_call: { type: 'boolean' },
          reason: { type: 'string' },
        },
        required: ['id', 'priority', 'confidence', 'needs_eli', 'business_call', 'reason'],
      },
    },
  },
  required: ['batch', 'items'],
}

phase('Grade')
log(`Grading ${BATCHES.length} batches`)

const out = await parallel(BATCHES.map(b => () =>
  agent(
    `${RUBRIC}\n\nYour batch file: ${DIR}/batch-${b}.json\nReturn batch "${b}" and one entry for every item in the file, with no extras.`,
    { model: 'claude-opus-5-5', label: `grade:${b}`, phase: 'Grade', schema: SCHEMA }
  )
))

const ok = out.filter(Boolean)
const missing = BATCHES.filter(b => !ok.some(r => r.batch === b))
log(`${ok.length}/${BATCHES.length} batches graded, ${ok.reduce((n, r) => n + r.items.length, 0)} items`)
if (missing.length) log(`MISSING batches: ${missing.join(', ')}`)
return ok
