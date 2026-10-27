export const meta = {
  name: 'trim-carry',
  description: 'Cut the over-long bodies drafted to carry out accepted decisions down to the house 1 KB target',
  phases: [{ title: 'Trim', detail: 'one agent per batch of six bodies', model: 'claude-opus-5-5' }],
}

// Args are batch numbers. Each batch file lists body keys, and each key has its own file, so nothing is retyped.
const BATCHES = (args && args.batches) || []
const ROOT = (args && args.root) || '.'
const DIR = `${ROOT}/data/carry-trim`

const RULES = `
You are cutting drafted GitHub issue bodies down to size. Each was drafted to carry out a backlog
decision and came out too long. Eli reviews every body before anything is posted. You write no files.

READ: your batch file, then each key's file ${DIR}/<key>.json. It holds the drafted body, the op kind
(a new issue or a rewrite of an existing one), and one line on what the body is for.

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
    batch: { type: 'string' },
    items: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          key: { type: 'string', description: 'echo the key exactly as it appears in the batch file' },
          body: { type: 'string', description: 'the trimmed body, complete and ready to paste' },
          cut: { type: 'array', items: { type: 'string' }, description: 'the whole ideas you removed, one line each' },
          prose_chars: { type: 'number', description: 'your count of prose characters, excluding images, captions, links and any YakShaver header' },
        },
        required: ['key', 'body', 'cut', 'prose_chars'],
      },
    },
  },
  required: ['batch', 'items'],
}

phase('Trim')
log(`Trimming ${BATCHES.length} batches`)

const out = await parallel(BATCHES.map(b => () =>
  agent(
    `${RULES}\n\nYour batch file: ${DIR}/batch-${b}.json\nReturn batch "${b}" and one entry for every key in that file, with no extras.`,
    { model: 'claude-opus-5-5', label: `trim:${b}`, phase: 'Trim', schema: SCHEMA }
  )
))

const ok = out.filter(Boolean)
log(`${ok.length}/${BATCHES.length} batches trimmed, ${ok.reduce((n, r) => n + r.items.length, 0)} bodies`)
const still = ok.flatMap(r => r.items).filter(i => i.prose_chars > 1100).map(i => `${i.key}:${i.prose_chars}`)
if (still.length) log(`still over target: ${still.join(', ')}`)
const dashed = ok.flatMap(r => r.items).filter(i => /[\u2013\u2014]/.test(i.body)).map(i => i.key)
if (dashed.length) log(`WARNING: en or em dash in: ${dashed.join(', ')}`)
return ok
