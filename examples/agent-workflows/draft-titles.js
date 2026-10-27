export const meta = {
  name: 'draft-titles',
  description: 'Propose a corrected title for each rewritten backlog item, or keep the current one',
  phases: [{ title: 'Title', detail: 'one agent per item, reading its finished body', model: 'claude-opus-5-5' }],
}

// Runs after draft and trim, so each title is written against the body that will actually be posted.
const IDS = (args && args.ids) || []
const ROOT = (args && args.root) || '.'
const DIR = `${ROOT}/data/title-input`

const RULES = `
You are deciding whether one backlog issue in tinacms/tinacloud or tinacms/tinacms needs a new title.
Its body has just been rewritten from a code-level verification, and the old title may now be wrong.
Eli reviews every title before anything is posted. You write nothing anywhere except your answer.

READ: ${DIR}/<id with # replaced by ->.json
It holds the current title, the new body, the verdict and a summary of what the rewrite changed.

THE DEFAULT IS TO KEEP THE TITLE. Return an empty title when the current one is still accurate, even
if you would have worded it differently. Churning accurate titles makes the board harder to scan.

CHANGE IT ONLY WHEN IT IS NOW WRONG. For example it:
- names something that does not exist, such as an error string, file or feature the body says is not real
- describes a symptom the body says has changed or was never the real one
- calls work a spike or a design when the body says that part is done
- prescribes a fix or mechanism the body now rejects
- misnames the thing (the body will say so)
- claims more or less scope than the new body covers

WHEN YOU CHANGE IT:
- Lead with the gitmoji for the issue's type, then one space. The set (Eli, 4 Oct 2026): ✨ feature, 🐛 bug,
  ♻️ refactor or tech debt, 🧹 chore, 📝 docs, 🔒 security, 🛂 auth and permissions, 🔐 secrets, 💄 UI, 🚸 UX,
  ⚡ performance, 🧱 infrastructure, 📊 analytics, 🔭 spike. Replace a missing or wrong leading emoji with the right
  one; the card's Detail check fails without it. Keep any category word after it, such as "Bug -" or "PBI:", and
  write a plain hyphen where it used an en dash or an em dash. Broken behaviour is always 🐛 and any investigation
  is always 🔭, whatever area it touches; the area gitmojis are for other work. A category word must agree with the
  gitmoji: correct it, or drop it with its separator when the type has no word.
- Say the problem or the outcome, not the solution.
- Claim nothing the new body does not claim.
- Keep what follows the prefix under 80 characters. No full stop at the end.
- Never use an em dash or an en dash anywhere.
`

const SCHEMA = {
  type: 'object',
  properties: {
    id: { type: 'string', description: 'echo the id exactly as given' },
    title: { type: 'string', description: 'the new full title including its prefix, or an empty string to keep the current title' },
    reason: { type: 'string', description: 'one short sentence: what was wrong with the old title, or why it stands' },
  },
  required: ['id', 'title', 'reason'],
}

phase('Title')
log(`Checking titles for ${IDS.length} rewritten items`)

const out = await parallel(IDS.map(id => () =>
  agent(
    `${RULES}\n\nYour item: ${id}\nFile: ${DIR}/${id.replace('#', '-')}.json\n` +
    `Return the id exactly as "${id}".`,
    { model: 'claude-opus-5-5', label: `title:${id}`, phase: 'Title', schema: SCHEMA }
  )
))

const ok = out.filter(Boolean)
const returned = new Set(ok.map(r => r.id))
const missing = IDS.filter(i => !returned.has(i))
log(`${ok.length}/${IDS.length} answered, ${ok.filter(r => r.title).length} retitled`)
if (missing.length) log(`MISSING: ${missing.join(', ')}`)
const dashed = ok.filter(r => /[\u2013\u2014]/.test(r.title)).map(r => r.id)
if (dashed.length) log(`WARNING: en or em dash in a proposed title: ${dashed.join(', ')}`)
return ok
