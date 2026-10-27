export const meta = {
  name: 'draft-carry',
  description: 'Turn each decision Eli accepted in the refinery into concrete GitHub operations with every text drafted for his approval',
  phases: [{ title: 'Draft', detail: 'one agent per batch of about 11 related items', model: 'claude-opus-5-5' }],
}

// Args are batch numbers. Each batch file lists ids, and each id has its own direction file, so no id is retyped.
const BATCHES = (args && args.batches) || []
const ROOT = (args && args.root) || '.'
const DIR = `${ROOT}/data/carry-input`

const RULES = `
Eli accepted a decision on each backlog item in your batch. Accepting means "carry it out". Your job is
to turn each decision into the exact GitHub operations that carry it out, with every piece of text fully
drafted. Eli reads and approves every text before Claude posts it. You post nothing and write no files.

READ FIRST
1. Your batch file, then each item's direction file: ${DIR}/<id with # replaced by ->.json. It holds the
   accepted decision (Eli's own words win where eli_note is set), the verification record and the
   suggestion. The board has already moved every item to Backlog - Not Ready; do not repeat that.
2. The live issue with its comments: gh issue view <n> -R tinacms/<repo> --comments. Read only.
3. Any other issue your ops would edit, close or link: read its current body and comments first.
4. The house rules in your house style guide, sections "Voice",
   "An issue body can be out of date", "Issue and PBI bodies" and "Links and references". Follow them.

OPERATION KINDS
- close: close an issue. target is its URL, state_reason is completed, not_planned or duplicate, body is
  the closing comment.
- comment: a comment on an issue. Only when the decision needs a comment and not a body change.
- edit-body: the COMPLETE replacement body for an existing issue (this item or another). When correcting
  an issue, edit its body rather than only commenting. For an issue that is not your item, keep every
  part the decision does not change verbatim, and change only what the decision asks.
- edit-title: target and the new full title in body. Keep the existing emoji or category prefix.
- new-issue: repo (owner/name), title, full body, and ref NEW_1, NEW_2 and so on. Other ops in the same
  item refer to its URL by that ref, for example a closing comment that says "Moved to NEW_1".
- estimate: the Estimate field on the board, 2, 4, 8 or 16. target is an issue URL or a NEW ref. Only
  when the decision settles the size of that item unconditionally.
- sub-issue: parent URL in target, child URL or NEW ref in body.
- ask: a question for a named colleague that Eli sends himself on Teams. target is the person, body is
  the message in his colleague voice: first-name greeting ("Hey Jack,"), ask rather than instruct, one
  or two short sentences. Nothing is posted to GitHub for an ask.

HOW TO CARRY A DECISION OUT
- Do what the decision says, no more. Where it gives a main path and a fallback ("if the team insists",
  "if someone wants it kept"), take the main path.
- Where the main path is gated on someone's answer ("get one line from Jack first", "confirm with the
  PO"), draft the ask, record the blocker in the item's body if it stays open, and say what is waiting
  in waiting_on. Do not draft the post-answer work.
- Code is never written here. If the decision says to change code or config, make sure an issue carries
  that work, by rewriting this item or raising a new one.
- An item that stays open must read true after its ops. Rewrite its body to the decision unless the
  decision says no rewrite is needed.
- Splits: one new-issue per child the decision names, each a real PBI body. Then either rewrite the
  parent as the tracker with sub-issue ops, or close it pointing at the children, whichever the
  decision says. Default to closing the parent when the children cover it all.
- Order the ops so each depends only on earlier ones: raise before you link, copy facts into the
  survivor before you close the duplicate.
- An issue with no decision text gets no ops. Say so in summary.

TEXT RULES
- Issue bodies: only Pain, Approach, Acceptance Criteria and optionally Related, with the emoji headings
  both repos use (### 🩸 Pain, ### 🛠️ Approach, ### ✅ Acceptance Criteria, ### 🔗 Related). Under about
  1000 characters of prose, measured. No code, commands, file paths, ids or tables. Keep every image,
  Figure caption, recording and related link from the body you replace. A body that opens "Requested
  by: ... via YakShaver.ai" keeps YakShaver's own format, as the skill describes.
- Comments: one to three short sentences in Eli's plain voice, as if typed to a teammate. Say where the
  work lives now with a full URL. Hard cap 1800 characters.
- Links: always full URLs, never a bare #1234.
- tinacms/tinacms and SSWConsulting repos are PUBLIC. There, never link tinacms/tinacloud issues or PRs,
  never name a customer, never quote production figures, and leave out images uploaded in the private
  repo because they will not render.
- Never an em dash or an en dash. No AI attribution of any kind.
`

const OP = {
  type: 'object',
  properties: {
    kind: { type: 'string', enum: ['close', 'comment', 'edit-body', 'edit-title', 'new-issue', 'estimate', 'sub-issue', 'ask'] },
    target: { type: 'string', description: 'issue URL, a NEW ref, "new" for new-issue, or the person for ask' },
    ref: { type: 'string', description: 'for new-issue: NEW_1, NEW_2 and so on, else empty' },
    repo: { type: 'string', description: 'for new-issue: owner/name, else empty' },
    title: { type: 'string', description: 'for new-issue, else empty' },
    body: { type: 'string', description: 'the full text: body, comment, closing comment, new title, child ref or message' },
    state_reason: { type: 'string', enum: ['completed', 'not_planned', 'duplicate', ''] },
    estimate: { type: 'number', description: 'for estimate, else 0' },
    why: { type: 'string', description: 'one short line: which part of the decision this op carries out' },
  },
  required: ['kind', 'target', 'ref', 'repo', 'title', 'body', 'state_reason', 'estimate', 'why'],
}

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
          summary: { type: 'string', description: 'one plain line for Eli: what carrying this out does' },
          ops: { type: 'array', items: OP },
          waiting_on: { type: 'string', description: 'what must be answered before the rest can happen, or empty' },
          skipped: { type: 'string', description: 'any part of the decision not turned into an op, and why, or empty' },
        },
        required: ['id', 'summary', 'ops', 'waiting_on', 'skipped'],
      },
    },
  },
  required: ['batch', 'items'],
}

phase('Draft')
log(`Drafting ${BATCHES.length} batches`)

const out = await parallel(BATCHES.map(b => () =>
  agent(
    `${RULES}\n\nYour batch file: ${DIR}/batch-${b}.json\nReturn batch "${b}" and one entry for every id in that file, with no extras.`,
    { model: 'claude-opus-5-5', label: `carry:${b}`, phase: 'Draft', schema: SCHEMA }
  )
))

const ok = out.filter(Boolean)
const missing = BATCHES.filter(b => !ok.some(r => r.batch === b))
log(`${ok.length}/${BATCHES.length} batches drafted, ${ok.reduce((n, r) => n + r.items.length, 0)} items`)
if (missing.length) log(`MISSING batches: ${missing.join(', ')}`)
const dashed = ok.flatMap(r => r.items).filter(i => i.ops.some(o => /[\u2013\u2014]/.test(o.body + o.title))).map(i => i.id)
if (dashed.length) log(`WARNING: en or em dash in: ${dashed.join(', ')}`)
return ok
