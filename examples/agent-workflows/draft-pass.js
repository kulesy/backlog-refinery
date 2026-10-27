export const meta = {
  name: 'draft-pass',
  description: 'Draft the missing priority, gitmoji title, estimate and acceptance criteria on every Needs a draft card, with a skeptic on the refined batches',
  phases: [
    { title: 'Draft', detail: 'one agent per batch of cards', model: 'claude-opus-5-5' },
    { title: 'Review', detail: 'a skeptic re-checks batches that carry estimates or criteria', model: 'claude-opus-5-5' },
  ],
}

// Args: { model, batches: ['b01', ...] }. Each batch file lists ids; each id has its own file with what it needs.
const MODEL = (args && args.model) || 'claude-opus-5-5'
const BATCHES = (args && args.batches) || []
const ROOT = (args && args.root) || '.'
const CLONES = (args && args.clones) || '..'
const DIR = `${ROOT}/data/draft-pass`

const RULES = `
You are drafting backlog refinement suggestions for the TinaCloud team (GitHub project board #38; repos
tinacms/tinacloud and tinacms/tinacloud-cli are private, tinacms/tinacms is public). Eli, the Product
Owner, approves every suggestion in his app before anything happens. You post nothing and write nothing
anywhere except your answer.

READ your batch file, then each card's file ${DIR}/<id with # replaced by ->.json. It holds the title,
body, labels, column, board estimate and priority, whether the card has been refined, its code
verification label, the refinery suggestion, 30-day usage and error evidence from PostHog and CloudWatch
where gathered, the issue type where an agent typed it, and "needs": the only pieces to draft for it.
For refined cards that need an estimate or criteria, read the issue's comments
(gh issue view <n> -R tinacms/<repo> --comments) and, where it settles the size, the code at
${CLONES}/tinacloud, ${CLONES}/tinacms or ${CLONES}/tinacloud-cli,
origin/main only. Read only; never edit and never run destructive git.

DRAFT ONLY WHAT "needs" LISTS:
- priority: Urgent, High, Medium or Low. Urgent means live harm now (data loss, exploitable security,
  a blocked core flow, money lost). High means a confirmed impactful bug with a workaround, a concrete
  security gap, a near deadline, or blocking other High work. Medium means clear-value improvements and
  user friction. Low means nice-to-have, cosmetic, tidy-up, tech debt with no current pain, or undated
  marketing. Weigh the usage and error evidence when present.
- title: lead with the gitmoji for the card's type: ✨ feature, 🐛 bug, ♻️ refactor, 🧹 chore, 📝 docs,
  🔒 security, 🛂 auth, 🔐 secrets, 💄 ui, 🚸 ux, ⚡ performance, 🧱 infrastructure, 📊 analytics, 🔭 spike.
  Use the typed type when the file has one; bugs and spikes win over area gitmojis. Replace any leading
  emoji that is not in this set, never stack two. Keep the rest of the wording unless it is wrong, keep
  any category word in agreement with the gitmoji, and never use an en or em dash in a title.
- estimate: 2, 4, 8 or 16 story points from the work the body and code imply. 16 is the ceiling; if it is
  bigger, say 16 and say it should be split.
- criteria: a complete replacement body with only ### 🩸 Pain, ### 🛠️ Approach (checkbox list),
  ### ✅ Acceptance Criteria (checkbox list you could tick from the issue alone) and optionally
  ### 🔗 Related. Under 1000 characters of prose, no code, commands or file paths, and keep every image,
  caption and link from the current body. A body that opens "Requested by: ... via YakShaver.ai" keeps
  YakShaver's format: plain ### headings and numbered acceptance criteria.
Each suggestion gets one plain reason sentence a busy lead can act on. Never use an em dash or an en dash
anywhere. No AI attribution.
`

const ITEM = {
  type: 'object',
  properties: {
    id: { type: 'string' },
    priority: { type: 'string', enum: ['Urgent', 'High', 'Medium', 'Low', ''] },
    priority_reason: { type: 'string' },
    title: { type: 'string', description: 'new full title, or empty' },
    title_reason: { type: 'string' },
    estimate: { type: 'number', description: '2, 4, 8 or 16, or 0 when not asked' },
    estimate_reason: { type: 'string' },
    body: { type: 'string', description: 'full replacement body, or empty' },
    body_summary: { type: 'string' },
    confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
  },
  required: ['id', 'priority', 'priority_reason', 'title', 'title_reason', 'estimate', 'estimate_reason', 'body', 'body_summary', 'confidence'],
}
const OUT = { type: 'object', properties: { batch: { type: 'string' }, items: { type: 'array', items: ITEM } }, required: ['batch', 'items'] }
const REV = {
  type: 'object',
  properties: {
    batch: { type: 'string' },
    items: { type: 'array', items: { type: 'object', properties: { id: { type: 'string' }, holds: { type: 'boolean' }, problems: { type: 'string' }, fixed: ITEM }, required: ['id', 'holds', 'problems', 'fixed'] } },
  },
  required: ['batch', 'items'],
}

log(`Drafting ${BATCHES.length} batches on ${MODEL}`)
const results = await pipeline(BATCHES,
  b => agent(`${RULES}\n\nYour batch file: ${DIR}/batch-${b}.json\nReturn batch "${b}" and one item per id in that file, ids exactly as given.`,
    { model: MODEL, label: `draft:${b}`, phase: 'Draft', schema: OUT }),
  (draft, b) => {
    if (!draft) return null
    // Priority and title only batches (never-refined cards) skip the skeptic; estimates and bodies get one.
    if (!b.startsWith('b')) return { batch: b, items: draft.items.map(x => ({ id: x.id, holds: true, problems: '', fixed: x })) }
    return agent(`${RULES}\n\nYou are a skeptic. Re-read each card file, the issue and, where it matters, the code, and try to REFUTE each drafted suggestion: an estimate that ignores work the body or code implies, a priority the evidence does not support, a title that breaks the gitmoji rule, a body that claims something unchecked or drops an image or link. Return every card with holds, problems, and a fixed version identical to the draft when it holds.\n\nBatch "${b}", file ${DIR}/batch-${b}.json\n\nDRAFTS:\n${JSON.stringify(draft.items, null, 1)}`,
      { model: MODEL, label: `review:${b}`, phase: 'Review', schema: REV })
  },
)
const ok = results.filter(Boolean)
const missing = BATCHES.filter(b => !ok.some(r => r.batch === b))
log(`${ok.length}/${BATCHES.length} batches done, ${ok.reduce((n, r) => n + r.items.length, 0)} cards`)
if (missing.length) log(`MISSING batches: ${missing.join(', ')}`)
return ok
