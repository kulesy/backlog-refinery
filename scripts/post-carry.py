#!/usr/bin/env python3
"""Post the drafts Eli approved in the Drafts tab, exactly as recorded, in order.

Resumable: every finished op is logged in data/carry-posted.json and skipped on a rerun. An edit to an
issue whose body someone else changed after drafting is skipped and reported rather than overwritten.
Asks are never posted; Eli sends those himself.
"""
import json, os, re, subprocess, sys, time

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.path.join(ROOT, 'data')
OUT = os.path.join(DATA, 'carry-post')
LOG = os.path.join(DATA, 'carry-posted.json')
DRAFTED_AT = '2026-09-29T04:20:00Z'
cfg = json.load(open(os.path.join(ROOT, 'config.json')))
PROJECT, FIELDS, STATUS = cfg['projectId'], cfg['fields'], cfg['statusOptions']
# Repos whose new issues are added to the board; set "repos" in config.json (an empty list adds nothing).
BOARD_REPOS = {f"{cfg['owner']}/{r}" for r in cfg.get('repos', [])}
PAUSE = 4  # 1.5s tripped GitHub's short-term limit after about 60 writes on 29 Sep

drafts = json.load(open(os.path.join(DATA, 'carry-drafts.json')))
picks = json.load(open(os.path.join(DATA, 'carry-decisions.json')))
log = json.load(open(LOG)) if os.path.exists(LOG) else {}
os.makedirs(OUT, exist_ok=True)
ME = json.loads(subprocess.run(['gh', 'api', 'user'], capture_output=True, text=True).stdout)['login']
mine = set()  # issues this run has already edited, so a later op on them is not mistaken for someone else's edit


def save():
    json.dump(log, open(LOG, 'w'), indent=1)


# Errors where the request never reached GitHub, so retrying cannot double-post. A lost response
# ("unexpected EOF") is deliberately not here: that write may have landed.
UNSENT = ('error connecting to', 'TLS handshake timeout', 'no such host', 'connection refused')
HALT = ('rate limit', 'error connecting to', 'TLS handshake timeout', 'unexpected EOF', 'no such host',
        'connection refused', 'timeout', 'secondary')


class Halt(RuntimeError):
    """Stops the whole run: the network or GitHub's limits, not this op, are the problem."""


def gh(*args, write=False):
    for attempt in range(3):
        r = subprocess.run(['gh', *args], capture_output=True, text=True)
        err = (r.stderr or r.stdout).strip()[:400] if r.returncode else ''
        if not err or not any(u in err for u in UNSENT):
            break
        time.sleep(15 * (attempt + 1))
    if write:
        time.sleep(PAUSE)
    if err:
        raise (Halt if any(h.lower() in err.lower() for h in HALT) else RuntimeError)(err)
    return r.stdout


def gql(query, write=False):
    out = json.loads(gh('api', 'graphql', '-f', f'query={query}', write=write))
    if out.get('errors'):
        raise RuntimeError(json.dumps(out['errors'])[:400])
    return out['data']


def parse(url):
    m = re.match(r'https://github\.com/([^/]+)/([^/]+)/issues/(\d+)', url or '')
    if not m:
        raise RuntimeError(f'not an issue URL: {url}')
    return m.group(1) + '/' + m.group(2), int(m.group(3))


def issue(url):
    repo, num = parse(url)
    o, r = repo.split('/')
    q = f'{{repository(owner:"{o}",name:"{r}"){{issue(number:{num}){{id state lastEditedAt editor{{login}} parent{{id}} projectItems(first:10){{nodes{{id project{{id}}}}}}}}}}}}'
    return gql(q)['repository']['issue']


def board_item(url, add=False):
    i = issue(url)
    for n in i['projectItems']['nodes']:
        if n['project']['id'] == PROJECT:
            return n['id']
    if not add:
        return None
    d = gql(f'mutation{{addProjectV2ItemById(input:{{projectId:"{PROJECT}",contentId:"{i["id"]}"}}){{item{{id}}}}}}', write=True)
    return d['addProjectV2ItemById']['item']['id']


def set_field(item, field, value):
    v = f'{{singleSelectOptionId:"{value}"}}' if isinstance(value, str) else f'{{number:{value}}}'
    gql(f'mutation{{updateProjectV2ItemFieldValue(input:{{projectId:"{PROJECT}",itemId:"{item}",fieldId:"{field}",value:{v}}}){{projectV2Item{{id}}}}}}', write=True)


def fill(text, refs):
    for ref in sorted(refs, key=len, reverse=True):
        text = text.replace(ref, refs[ref])
    return text


def body_file(key, text):
    p = os.path.join(OUT, key + '.md')
    open(p, 'w').write(text if text.endswith('\n') else text + '\n')
    return p


def fresh(url):
    """False when someone other than this run edited the body after the drafts were written."""
    if url in mine:
        return True
    i = issue(url)
    # An edit under Eli's own login is this poster's, from a run whose response was lost to the network.
    # CARRY_ALLOW_EDITORS names people whose later edit was checked and is already folded into the draft.
    allow = {ME, *filter(None, os.environ.get('CARRY_ALLOW_EDITORS', '').split(','))}
    return not i['lastEditedAt'] or i['lastEditedAt'] < DRAFTED_AT or (i['editor'] or {}).get('login') in allow


def run(iid, n, o, refs):
    k, key = o['kind'], f"{iid.replace('#', '-')}-op{n}"
    body, target = fill(o['body'], refs), fill(o['target'], refs)
    if k == 'ask':
        return {'status': 'for Eli', 'note': 'Teams message, not posted'}
    if k == 'new-issue':
        # A create whose response was lost has already made the issue, so reuse it rather than make a twin.
        title = fill(o['title'], refs)
        found = json.loads(gh('issue', 'list', '-R', o['repo'], '--author', '@me', '--state', 'all', '--search', f'created:>={DRAFTED_AT[:10]} in:title "{title.replace(chr(34), "")}"', '--json', 'url,title'))
        url = next((f['url'] for f in found if f['title'] == title), None)
        if url:
            refs[o['ref']] = url
            mine.add(url)
            if o['repo'] in BOARD_REPOS:
                set_field(board_item(url, add=True), FIELDS['status'], STATUS['notReady'])
            return {'status': 'ok', 'url': url, 'note': 'already created, reused'}
        labels = [a for l in o.get('labels', []) for a in ('--label', l)]
        url = gh('issue', 'create', '-R', o['repo'], '--title', fill(o['title'], refs), '--body-file', body_file(key, body), *labels, write=True).strip().splitlines()[-1]
        refs[o['ref']] = url
        mine.add(url)
        if o['repo'] in BOARD_REPOS:
            set_field(board_item(url, add=True), FIELDS['status'], STATUS['notReady'])
        return {'status': 'ok', 'url': url}
    if k == 'edit-body':
        if not fresh(target):
            return {'status': 'skipped', 'note': 'body edited by someone else after drafting'}
        repo, num = parse(target)
        gh('issue', 'edit', str(num), '-R', repo, '--body-file', body_file(key, body), write=True)
        mine.add(target)
        return {'status': 'ok', 'url': target}
    if k == 'edit-title':
        repo, num = parse(target)
        gh('issue', 'edit', str(num), '-R', repo, '--title', body.strip(), write=True)
        return {'status': 'ok', 'url': target}
    if k == 'comment':
        repo, num = parse(target)
        gh('issue', 'comment', str(num), '-R', repo, '--body-file', body_file(key, body), write=True)
        return {'status': 'ok', 'url': target}
    if k == 'close':
        repo, num = parse(target)
        if issue(target)['state'] == 'CLOSED':
            return {'status': 'skipped', 'note': 'already closed'}
        args = ['issue', 'close', str(num), '-R', repo, '--comment', body]
        reason = o['state_reason'] or 'completed'
        if reason == 'duplicate':
            dup = next((u for u in re.findall(r'https://github\.com/[^/\s)\]]+/[^/\s)\]]+/issues/\d+', body) if u != target), None)
            args += ['--duplicate-of', dup] if dup and parse(dup)[0] == repo else ['--reason', 'duplicate']
        else:
            args += ['--reason', 'not planned' if reason == 'not_planned' else 'completed']
        gh(*args, write=True)
        item = board_item(target)
        if item:
            set_field(item, FIELDS['status'], STATUS['done'] if reason == 'completed' else STATUS['wontDo'])
        return {'status': 'ok', 'url': target}
    if k == 'estimate':
        set_field(board_item(target, add=True), FIELDS['estimate'], o['estimate'])
        return {'status': 'ok', 'url': target}
    if k == 'sub-issue':
        parent, kid = issue(target)['id'], issue(body.strip())
        child = kid['id']
        if (kid['parent'] or {}).get('id') == parent:
            return {'status': 'ok', 'url': target, 'note': 'already linked'}
        try:
            gql(f'mutation{{addSubIssue(input:{{issueId:"{parent}",subIssueId:"{child}"}}){{issue{{id}}}}}}', write=True)
        except RuntimeError as ex:
            if 'already' not in str(ex).lower() or isinstance(ex, Halt):
                raise
        return {'status': 'ok', 'url': target}
    raise RuntimeError(f'unknown op kind {k}')


def order(ids):
    done, out = set(), []
    def visit(i):
        if i in done:
            return
        done.add(i)
        for dep in drafts[i].get('after', []):
            if dep in drafts:
                visit(dep)
        out.append(i)
    for i in ids:
        visit(i)
    return out


approved = [i for i in drafts if (picks.get(i) or {}).get('decision') == 'approve']
# Posting everything must be asked for by name. On 5 Oct 2026 a broken shell substitution passed no ids,
# and the run posted every approved card instead of the 41 it was meant to.
only = set(a for a in sys.argv[1:] if a != '--all')
if not only and '--all' not in sys.argv[1:]:
    sys.exit('Pass the card ids to post, or --all to post every approved card.')
for iid in order(approved):
    if only and iid not in only:
        continue
    pk, rec = picks[iid], log.setdefault(iid, {'ops': {}, 'refs': {}})
    refs, off, edits = rec['refs'], set(pk.get('off') or []), pk.get('edits') or {}
    for n, o in enumerate(drafts[iid]['ops']):
        if str(n) in rec['ops'] and rec['ops'][str(n)]['status'] in ('ok', 'for Eli', 'skipped'):
            continue
        if n in off:
            rec['ops'][str(n)] = {'status': 'unticked'}
            continue
        e = edits.get(str(n)) or {}
        o = {**o, 'body': e.get('body', o['body']), 'title': e.get('title', o['title'])}
        try:
            res = run(iid, n, o, refs)
        except Halt as ex:
            rec['ops'][str(n)] = {'status': 'failed', 'error': str(ex), 'at': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime())}
            save()
            print(f"{iid} op{n} {o['kind']}: failed {ex}\nstopping the run; rerun to resume", flush=True)
            sys.exit(2)
        except Exception as ex:
            res = {'status': 'failed', 'error': str(ex)}
        res['at'] = time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime())
        rec['ops'][str(n)] = res
        save()
        print(f"{iid} op{n} {o['kind']}: {res['status']} {res.get('url', '')} {res.get('error', res.get('note', ''))}", flush=True)
        if res['status'] == 'failed':
            # Later ops can depend on this one (a duplicate is closed only after the survivor is edited).
            print(f'{iid}: stopping this item at op{n}', flush=True)
            break
save()
