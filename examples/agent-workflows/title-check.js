export const meta = {
  name: 'title-check',
  description: 'Check the titles of backlog items rewritten before title checks existed, and propose a fix only where the title is now wrong',
  phases: [{ title: 'Title', detail: 'one agent per batch of twelve items', model: 'claude-opus-5-5' }],
}

// Args are batch numbers. Each batch file lists ids, and each id has its own file, so no id is retyped.
const BATCHES = (args && args.batches) || []
const ROOT = (args && args.root) || '.'
const DIR = `${ROOT}/data/title-input`

const RULES = `
You are deciding whether backlog issues in tinacms/tinacloud or tinacms/tinacms need a new title. Each
body was rewritten from a code-level verification between 14 and 20 Sep 2026, before titles were being
checked, so the old title may now be wrong. Eli reviews every title before anything is posted. You write
nothing anywhere except your answer.

READ: your batch file, then each item's file ${DIR}/<id with # replaced by ->.json. It holds the current
title, the body now live on the issue, what the rewrite changed, and the verdict.

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
    batch: { type: 'string' },
    items: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'echo the id exactly as it appears in the batch file' },
          title: { type: 'string', description: 'the new full title including its prefix, or an empty string to keep the current title' },
          reason: { type: 'string', description: 'one short sentence: what was wrong with the old title, or why it stands' },
        },
        required: ['id', 'title', 'reason'],
      },
    },
  },
  required: ['batch', 'items'],
}

phase('Title')
log(`Checking titles in ${BATCHES.length} batches`)

const out = await parallel(BATCHES.map(b => () =>
  agent(
    `${RULES}\n\nYour batch file: ${DIR}/batch-${b}.json\nReturn batch "${b}" and one entry for every id in that file, with no extras.`,
    { model: 'claude-opus-5-5', label: `title:${b}`, phase: 'Title', schema: SCHEMA }
  )
))

const ok = out.filter(Boolean)
const all = ok.flatMap(r => r.items)
log(`${ok.length}/${BATCHES.length} batches answered, ${all.length} items, ${all.filter(i => i.title).length} retitled`)
const dashed = all.filter(i => /[\u2013\u2014]/.test(i.title)).map(i => i.id)
if (dashed.length) log(`WARNING: en or em dash in a proposed title: ${dashed.join(', ')}`)
return ok
