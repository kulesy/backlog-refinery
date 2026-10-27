export const meta = {
  name: 'gather-evidence',
  description: 'Type each backlog card with its gitmoji and gather 30-day PostHog and CloudWatch usage and error evidence for its Priority check',
  phases: [
    { title: 'Catalog', detail: 'one agent maps PostHog, one maps CloudWatch', model: 'claude-opus-5-5' },
    { title: 'Cards', detail: 'one agent per batch of about 25 cards', model: 'claude-opus-5-5' },
    { title: 'Verify', detail: 'one skeptic per batch', model: 'claude-opus-5-5' },
  ],
}

// Args are batch numbers; each batch file in args.dir holds the cards, so no id is retyped.
const BATCHES = (args && args.batches) || []
const ROOT = (args && args.root) || '.'
const DIR = (args && args.dir) || `${ROOT}/data/evidence-input`
// Set in args: a read-only AWS profile, the PostHog project id, the API Gateway log groups and the Lambda name prefix to map.
const AWS_PROFILE = (args && args.awsProfile) || '<read-only profile>'
const POSTHOG_PROJECT = (args && args.posthogProject) || '<project id>'
const LOG_GROUPS = ((args && args.logGroups) || ['<api-gateway-access-log-group>']).join(', ')
const LAMBDA_PREFIX = (args && args.lambdaPrefix) || '<lambda-name-prefix>'
// The usage check in the orchestration skill picks the model per launch; Opus 5.5 unless it says otherwise.
const M = (args && args.model) || 'claude-opus-5-5'

const SAFE = `Read-only everywhere. Write no file. In PostHog create, save or edit nothing (no insights, dashboards, cohorts or notebooks); follow the PostHog tool's own instructions, including running its learn step before querying. In AWS run only read commands (logs start-query and get-query-results, cloudwatch get-metric-data, describe and list calls) with --profile ${AWS_PROFILE} --region us-east-1; if the SSO session has expired, say so and stop rather than guessing. Never use an em dash or an en dash.`

const TYPES = `TYPES AND GITMOJIS (Eli's set, 4 Oct 2026). Classify by the work the body describes, not by the current title.
✨ feature: a new capability or an extension of one.
🐛 bug: existing behaviour that is broken or wrong.
♻️ refactor: restructuring or tech debt with no behaviour change.
🧹 chore: tidy-up, maintenance, dependency or housekeeping work.
📝 docs: documentation.
🔒 security: a vulnerability, hardening or a security review.
🛂 auth: sign-in, sign-up, sessions, SSO, MFA, roles and permissions.
🔐 secrets: credentials, keys, tokens and secret storage only.
💄 ui: visual styling and layout.
🚸 ux: usability, flow friction and clarity for users.
⚡ perf: speed, latency, load or cost of running.
🧱 infra: deployment, CI, hosting, AWS resources and environments.
📊 analytics: tracking, metrics, dashboards and reporting.
🔭 spike: an investigation, research or a timeboxed exploration.
PRECEDENCE (Eli, 5 Oct 2026): broken behaviour is always 🐛 and any investigation is always 🔭, whatever area it touches; the area gitmojis (🛂 🔐 💄 🚸 ⚡) are for other work. A category word in the title (Bug, Feature, Spike, Refactor, Chore, Docs, Security) must agree with the gitmoji: correct it to the right word, or drop it with its separator when the type has no word.`

const CATALOG_PH = { type: 'object', properties: {
  events: { type: 'array', items: { type: 'object', properties: { name: { type: 'string' }, count_30d: { type: 'integer' }, users_30d: { type: 'integer' } }, required: ['name', 'count_30d', 'users_30d'] } },
  paths: { type: 'array', items: { type: 'object', properties: { path: { type: 'string' }, views_30d: { type: 'integer' }, users_30d: { type: 'integer' } }, required: ['path', 'views_30d', 'users_30d'] } },
  error_issues: { type: 'array', items: { type: 'object', properties: { name: { type: 'string' }, detail: { type: 'string' }, occurrences_30d: { type: 'integer' }, users_30d: { type: 'integer' }, status: { type: 'string' } }, required: ['name', 'detail', 'occurrences_30d', 'users_30d', 'status'] } },
  notes: { type: 'string' },
}, required: ['events', 'paths', 'error_issues', 'notes'] }

const CATALOG_CW = { type: 'object', properties: {
  routes: { type: 'array', items: { type: 'object', properties: { route: { type: 'string' }, requests_30d: { type: 'integer' }, errors_5xx_30d: { type: 'integer' }, errors_4xx_30d: { type: 'integer' } }, required: ['route', 'requests_30d', 'errors_5xx_30d', 'errors_4xx_30d'] } },
  lambdas: { type: 'array', items: { type: 'object', properties: { name: { type: 'string' }, invocations_30d: { type: 'integer' }, errors_30d: { type: 'integer' } }, required: ['name', 'invocations_30d', 'errors_30d'] } },
  notes: { type: 'string' },
}, required: ['routes', 'lambdas', 'notes'] }

const NUM = { type: ['integer', 'null'] }
const CARDS = { type: 'object', properties: { batch: { type: 'string' }, cards: { type: 'array', items: { type: 'object', properties: {
  id: { type: 'string', description: 'the id exactly as in the batch file' },
  type: { type: 'string', enum: ['feature', 'bug', 'refactor', 'chore', 'docs', 'security', 'auth', 'secrets', 'ui', 'ux', 'perf', 'infra', 'analytics', 'spike'] },
  new_title: { type: 'string', description: 'the corrected full title, or an empty string when the title already leads with the right gitmoji' },
  title_why: { type: 'string' },
  applies: { type: 'boolean', description: 'false when no usage or error signal can speak to this card' },
  no_signal_reason: { type: 'string' },
  usage_value: NUM, usage_users: NUM, usage_metric: { type: 'string' }, usage_source: { type: 'string', enum: ['posthog', 'cloudwatch', ''] },
  errors_value: NUM, errors_users: NUM, errors_metric: { type: 'string' }, errors_source: { type: 'string', enum: ['posthog', 'cloudwatch', ''] },
  summary: { type: 'string', description: 'one plain sentence naming the numbers' },
  suggested_priority: { type: 'string', enum: ['Urgent', 'High', 'Medium', 'Low', ''] },
  confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
}, required: ['id', 'type', 'new_title', 'title_why', 'applies', 'no_signal_reason', 'usage_value', 'usage_users', 'usage_metric', 'usage_source',
  'errors_value', 'errors_users', 'errors_metric', 'errors_source', 'summary', 'suggested_priority', 'confidence'] } } }, required: ['batch', 'cards'] }

const FIXES = { type: 'object', properties: { batch: { type: 'string' }, fixes: { type: 'array', items: { type: 'object', properties: {
  id: { type: 'string' }, field: { type: 'string' }, correct: { type: 'string', description: 'the corrected value as JSON text, for example "\\"bug\\"" or "412" or "null"' }, reason: { type: 'string' },
}, required: ['id', 'field', 'correct', 'reason'] } }, checked: { type: 'integer' } }, required: ['batch', 'fixes', 'checked'] }

phase('Catalog')
const [ph, cw] = await parallel([
  () => agent(`${SAFE}

Map the TinaCloud PostHog project (the active one, id ${POSTHOG_PROJECT}, which also receives TinaCMS admin events) for the last 30 days, so other agents can match backlog items to real usage. Return compactly:
1. events: the top 250 events by count, each with count and distinct users.
2. paths: the top 150 $pageview pathnames by views with distinct users, with ids and slugs in paths replaced by :id so routes group.
3. error_issues: the top 120 error tracking issues by occurrences in the window, with a one-line detail, occurrences, users and status.
4. notes: which events and paths belong to the TinaCloud dashboard, the TinaCMS admin or anything else, and any naming patterns that help match a feature to its events.`, { label: 'catalog:posthog', phase: 'Catalog', schema: CATALOG_PH, model: M }),
  () => agent(`${SAFE}

Map TinaCloud production traffic in CloudWatch for the last 30 days, so other agents can match backlog items to real usage and errors.
1. routes: across the three production API Gateway access log groups ${LOG_GROUPS}, run Logs Insights (first look at a few records to learn the field names), and return the top 150 routes by requests with requests, 5xx and 4xx counts. Group paths by replacing ids, branch names and project names with :id. Keep to one or two queries per log group.
2. lambdas: for Lambda functions whose names start ${LAMBDA_PREFIX}, return 30-day Invocations and Errors sums from CloudWatch metrics.
3. notes: which API (content, identity, assets, git, events and so on) each log group serves, and anything that helps match a feature to its routes.`, { label: 'catalog:cloudwatch', phase: 'Catalog', schema: CATALOG_CW, model: M }),
])
if (!ph || !cw) log(`catalog incomplete: posthog ${!!ph}, cloudwatch ${!!cw}`)
const CATALOG = JSON.stringify({ posthog: ph, cloudwatch: cw })

const results = await pipeline(BATCHES,
  b => agent(`${SAFE}

Read ${DIR}/batch-${b}.json. For EVERY card in it, in file order, decide the following and return one entry per card.

${TYPES}

TITLE. The title to check is pending_title_draft.title when that draft's state is undecided or approve, otherwise the card's title. If it already starts with the right gitmoji for the type, new_title is an empty string. Otherwise new_title is that same title with the right gitmoji as its first character followed by one space, replacing any wrong leading emoji. Change nothing else, except that an en dash or an em dash in the title becomes a plain hyphen and a trailing full stop is dropped. title_why is one short sentence saying what the work is.

EVIDENCE, for the card's Priority check, over the last 30 days. Work out which product area the card touches, then find its usage (how much the feature is used: event counts, page views or API requests, with distinct users where available) and its errors (5xx on its routes, Lambda errors, or PostHog error issues that come from that area, with users affected). Start from the CATALOG below and only run a targeted query when it lacks something you need, at most three per card. Report the single most telling number for each, with what it counts. When no signal can speak to the card (docs, internal tooling, tech debt with no runtime surface, a brand new feature with nothing to measure yet), set applies to false and say why in no_signal_reason; for a new feature, usage of the area it extends can still show demand, so prefer that over no signal. summary is one plain sentence naming the numbers, for a busy product owner. suggested_priority is the level the evidence supports (Urgent, High, Medium, Low), or an empty string when the evidence does not bear on priority; compare it with the card's current priority and agent_grade, and only move away from them for a reason the numbers show. confidence is high only when the numbers plainly back the call.

CATALOG:
${CATALOG}`, { label: `cards:${b}`, phase: 'Cards', schema: CARDS, model: M }),
  (res, b) => res ? agent(`${SAFE}

You are a skeptic. Another agent typed and evidenced the cards in ${DIR}/batch-${b}.json; its answers are below. Try to refute them.
1. For every card, check the type against the body and the type rules, and check new_title: it must equal the title it was built from with only the leading gitmoji changed, dashes made plain and a trailing full stop dropped, and it must be empty when the title already leads with the right gitmoji.
2. Re-check at least six evidence claims, chosen from the ones that move a priority or carry the biggest numbers, by re-running the query or reading the catalog. Check that each number counts what its metric says, over 30 days, for the right area.
Return only real corrections, one per field, with the corrected value as JSON text. Keep the original when you cannot show it is wrong. checked is how many cards you examined.

${TYPES}

ANSWERS:
${JSON.stringify(res)}

CATALOG:
${CATALOG}`, { label: `verify:${b}`, phase: 'Verify', schema: FIXES, model: M }).then(v => ({ batch: b, cards: res.cards, fixes: (v && v.fixes) || [], checked: v ? v.checked : 0 })) : null)

const done = results.filter(Boolean)
log(`${done.length} of ${BATCHES.length} batches returned`)
return { catalog: { posthog: ph, cloudwatch: cw }, batches: done }
