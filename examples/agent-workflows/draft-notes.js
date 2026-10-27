export const meta = {
  name: 'draft-notes',
  description: 'Draft the issue text Eli asked for in his refinery notes: rewrites, new PBIs and public copies of misplaced items',
  phases: [{ title: 'Draft', detail: 'one agent per item, reading its own direction file', model: 'claude-opus-5-5' }],
}

// Each item's direction, Eli's note and its verified facts are staged in a file, so nothing long is retyped through args.
const IDS = (args && args.ids) || []
const ROOT = (args && args.root) || '.'
const DIR = `${ROOT}/data/note-input`

const RULES = `
You are drafting GitHub issue text that Eli will review before anything is posted. You post nothing.

READ FIRST:
1. Your direction file: ${DIR}/<id with # replaced by ->.json. It holds the mode, Eli's own words, the
   verified facts (verdict, evidence, skeptic) and sometimes a placement check or extra facts.
2. The live issue: gh issue view <n> -R tinacms/<repo> --comments (read only).
3. The house rules for issue bodies: the section "Issue and PBI bodies" in
   your house style guide. Follow it exactly: only Pain, Approach, Acceptance
   Criteria and optionally Related; the emoji headings used in tinacms/tinacms and tinacms/tinacloud;
   under 1000 characters of prose; no code, commands, ids or file paths; keep every image, Figure
   caption and source link that still applies; a YakShaver-raised issue keeps YakShaver's format.

MODES.
- rewrite: a replacement body for the same issue, built from Eli's direction and the verified facts.
  Eli's direction wins over the verdict wherever they differ. Only give a new title if the direction
  asks for one or the old title is now plainly wrong; otherwise return an empty title.
- new-pbi: a brand new issue. Give a title in the repo's style and a full body.
- recreate-public: the text for a PUBLIC repo, plus a short closing comment for the original.

PUBLIC TARGETS (tinacms/tinacms, SSWConsulting/SSW.ContentHawk). The text will be read by anyone.
- Never link tinacms/tinacloud issues or PRs, SharePoint, Teams, or internal recordings. They are
  private and 404 publicly. Keep the fact, drop the link.
- Never name a customer or quote production figures.
- An image hosted as a github.com/user-attachments URL uploaded in the private repo will not render
  publicly. Keep the image line out of the public body and list it in needs_recapture.
- Keep the original title unless it is plainly wrong. You may drop a redundant "TinaCMS - " prefix.

VOICE. Plain and short, one idea per sentence. The closing comment is one or two sentences in Eli's
voice, and it links the new issue with the placeholder NEW_ISSUE_URL when the URL does not exist yet.
Never use an em dash or an en dash. No AI attribution.
`

const SCHEMA = {
  type: 'object',
  properties: {
    id: { type: 'string', description: 'echo the id exactly as given' },
    target: { type: 'string', description: 'where the text goes, e.g. "repo#12 in place", "new issue in repo", "reopen repo#34"' },
    title: { type: 'string', description: 'the title for the target, or empty to keep the current one' },
    body: { type: 'string', description: 'the complete body, ready to paste' },
    closing_comment: { type: 'string', description: 'for recreate-public and new-pbi sources: the comment that closes the original, else empty' },
    estimate: { type: 'number', description: 'estimate on the 2, 4, 8, 16 scale if the direction or evidence settles one, else 0' },
    private_items_removed: { type: 'array', items: { type: 'string' }, description: 'links or details left out because the target is public' },
    needs_recapture: { type: 'array', items: { type: 'string' }, description: 'images that will not render in the public target' },
    change_summary: { type: 'string', description: 'one line for Eli: what this text does' },
  },
  required: ['id', 'target', 'title', 'body', 'closing_comment', 'estimate', 'private_items_removed', 'needs_recapture', 'change_summary'],
}

phase('Draft')
log(`Drafting text for ${IDS.length} noted items`)

const out = await parallel(IDS.map(id => () =>
  agent(
    `${RULES}\n\nYour item: ${id}\nDirection file: ${DIR}/${id.replace('#', '-')}.json\n` +
    `Return the id exactly as "${id}".`,
    { model: 'claude-opus-5-5', label: `note:${id}`, phase: 'Draft', schema: SCHEMA }
  )
))

const ok = out.filter(Boolean)
const returned = new Set(ok.map(r => r.id))
const missing = IDS.filter(i => !returned.has(i))
log(`${ok.length}/${IDS.length} drafted`)
if (missing.length) log(`MISSING: ${missing.join(', ')}`)
const dashed = ok.filter(r => /[\u2013\u2014]/.test(r.body + r.title + r.closing_comment)).map(r => r.id)
if (dashed.length) log(`WARNING: en or em dash in: ${dashed.join(', ')}`)
return ok
