export const meta = {
  name: 'trim-bodies',
  description: 'Cut each over-long drafted PBI body down to the house 1 KB target by removing whole ideas',
  phases: [{ title: 'Trim', detail: 'one agent per over-long draft', model: 'claude-opus-5-5' }],
}

const IDS = (args && args.ids) || []
const ROOT = (args && args.root) || '.'
const DIR = `${ROOT}/data/drafts`

const RULES = `
You are cutting one PBI body down to size. It was drafted from a deep verification and came out far
too long, because the author wrote in everything the investigation found.

READ: ${DIR}/<id with # replaced by ->.json
It holds the drafted body, a summary of what changed, and the claims that were deliberately removed
from the original.

THE TARGET. Under 1000 characters of PROSE. Images, "Figure:" captions, links, and any YakShaver header
do not count toward that, so leave them alone.

HOW TO CUT. Delete whole ideas, never compress sentences. A body that has been squeezed word by word
reads as telegraphic and is worse than a longer one. In order, the first things to go are:
1. The verification recital. Anything of the shape "I ran X and observed Y", "a test confirms", "as of
   commit Z". The reader does not need your working, only the conclusion.
2. The mechanism explanation that the Approach items already imply.
3. The justification for why the item matters at all.
4. Any second example once the first has made the point.

WHAT MUST SURVIVE.
- The Pain must still say who hurts and how, in concrete terms.
- Any claim that the original body was WRONG must survive, because the whole reason for the rewrite is
  that the next reader would otherwise act on the false version. If the draft says a previously assumed
  fix does not cover some case, keep that.
- Every acceptance criterion stays checkable. Cut a criterion entirely rather than making it vague.
- Every image, Figure caption and source link stays.
- The format stays exactly as it is. If the body starts "Requested by ... via YakShaver.ai", keep that
  header, the plain "###" headings and the NUMBERED acceptance criteria. Otherwise keep the emoji
  headings and checkbox lists.

Do not add anything. Do not restore anything the drafter removed. Never use an em dash or an en dash.
`

const SCHEMA = {
  type: 'object',
  properties: {
    id: { type: 'string', description: 'echo the id exactly as given, character for character' },
    body: { type: 'string', description: 'the trimmed body, complete and ready to paste' },
    cut: { type: 'array', items: { type: 'string' }, description: 'the whole ideas you removed, one line each' },
    prose_chars: { type: 'number', description: 'your count of prose characters, excluding images, captions, links and any YakShaver header' },
  },
  required: ['id', 'body', 'cut', 'prose_chars'],
}

phase('Trim')
log(`Trimming ${IDS.length} over-long bodies`)

const out = await parallel(IDS.map(id => () =>
  agent(
    `${RULES}\n\nYour item: ${id}\nFile: ${DIR}/${id.replace('#', '-')}.json\n` +
    `Return the id exactly as "${id}". Do not change the repo part of the id.`,
    { model: 'claude-opus-5-5', label: `trim:${id}`, phase: 'Trim', schema: SCHEMA }
  )
))

const ok = out.filter(Boolean)
const returned = new Set(ok.map(r => r.id))
const missing = IDS.filter(i => !returned.has(i))
log(`${ok.length}/${IDS.length} trimmed`)
if (missing.length) log(`MISSING or id mismatch: ${missing.join(', ')}`)
const still = ok.filter(r => r.prose_chars > 1100).map(r => `${r.id}:${r.prose_chars}`)
if (still.length) log(`still over target: ${still.join(', ')}`)
return ok
