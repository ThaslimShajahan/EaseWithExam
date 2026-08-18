# Deploying EaseWithExam

The frontend is deployed **manually**, by copying a build artifact to a VPS over
SSH. Pushing to `origin/main` does **not** deploy anything — CI only builds,
tests, and checks migration drift.

This file exists because on 2026-08-11 the procedure lived only in the owner's
head. Nothing in the repo could check, reproduce, or roll it back, and two
non-obvious failure modes bit during that deploy (both documented below).

## Target

| | |
|---|---|
| SSH alias | `easewithexam` (defined in `~/.ssh/config`) |
| Host / user | `easewithexamdeploy@31.97.67.30` |
| Key | `~/.ssh/easewithexam_deploy` |
| Web root | `~/htdocs/www.easewithexam.com/` |
| Live URL | https://www.easewithexam.com/ |

The `~/.ssh/config` entry sets `IdentitiesOnly yes`, so `ssh easewithexam`
works while `ssh easewithexamdeploy@31.97.67.30` **fails with
`Permission denied (publickey,password)`** — the default identity is offered
instead of the deploy key. Always use the alias.

## Procedure

```bash
# 1. Pre-flight — never deploy an unverified tree
#    build:seo, NOT build. Plain `vite build` emits the SPA shell whose body is
#    `<div id="root"></div>` and whose canonical points at the homepage on every
#    route — deploying that silently reverts the prerender fix and re-declares
#    /about and /privacy as duplicates of /. build:seo runs vite build and then
#    scripts/prerender.mjs, which refuses to write a file with a wrong canonical.
npm test && npm run build:seo
grep -o 'assets/index-[A-Za-z0-9_-]*\.js' dist/index.html   # note this hash

# Prerender sanity — the body must NOT be an empty root div
sed -n '/<body/,$p' dist/index.html | head -3
grep -o '<link rel="canonical" href="[^"]*"' dist/about/index.html   # must end /about

# 2. Back up the current web root (fast to restore; seconds)
ssh easewithexam 'R=~/htdocs/www.easewithexam.com; B=~/deploy-backups; mkdir -p $B; \
  tar czf $B/webroot-$(date +%F-%H%M%S).tar.gz -C $R . && ls -lh $B | tail -2'

# 3. Clear any old tarball FIRST — see gotcha 3. Do this before transferring,
#    never after, so a failed scp cannot be masked by a stale archive.
ssh easewithexam 'rm -f ~/ewe-dist.tar.gz'

# 3b. Package. RUN THIS IN GIT BASH, NOT POWERSHELL — PowerShell does not
#     resolve /tmp, and the tarball silently lands somewhere else (or nowhere).
tar czf /tmp/ewe-dist.tar.gz -C dist .
ls -la /tmp/ewe-dist.tar.gz            # must exist and be seconds old
md5sum /tmp/ewe-dist.tar.gz            # note this

# 3c. Transfer. Do NOT chain with && — you need to see this exit code alone.
scp /tmp/ewe-dist.tar.gz easewithexam:~/ewe-dist.tar.gz
echo "scp exit: $?"                    # must be 0

# 3d. Prove the right bytes arrived, and that they are the build you just made
ssh easewithexam 'md5sum ~/ewe-dist.tar.gz'    # must equal the md5 from 3b
ssh easewithexam 'tar tzf ~/ewe-dist.tar.gz | grep -oE "assets/index-[A-Za-z0-9_-]+\.js"'
#   must equal the hash from step 1. `tar tzf` only LISTS — it extracts nothing.
#   If this shows the OLD hash you are about to redeploy the build already live.

# 4. Extract. EXPECT EXIT 2 — it does not mean failure, see gotcha 1.
#    --no-overwrite-dir reduces the noise but does NOT prevent it.
ssh easewithexam 'tar xzf ~/ewe-dist.tar.gz -C ~/htdocs/www.easewithexam.com --no-overwrite-dir'

# 5. Confirm the extract on disk — this, not tar's exit code, is the signal
ssh easewithexam 'R=~/htdocs/www.easewithexam.com; grep -o "assets/index-[A-Za-z0-9_-]*\.js" $R/index.html'
#   must equal the hash from step 1; if it still shows the OLD hash, roll back

# 6. Fix permissions — REQUIRED, see gotcha 2
ssh easewithexam 'find ~/htdocs/www.easewithexam.com -type f -exec chmod 644 {} +'
ssh easewithexam 'find ~/htdocs/www.easewithexam.com -type f ! -perm -o=r | wc -l'   # must be 0

# 7. Verify over real HTTP, not by trusting the copy
curl -s https://www.easewithexam.com/ | grep -o 'assets/index-[A-Za-z0-9_-]*\.js'
#   must equal the hash from step 1
curl -s -o /dev/null -w '%{http_code}\n' https://www.easewithexam.com/assets/<hash>.js

# 7b. Content check for every PRERENDERED route (currently /about, /contact,
#     /privacy, /terms, /refund — the keys of PAGE_SEO minus '/' and '/404',
#     same set scripts/gen-nginx-routes.mjs's prerenderedRoutes() derives).
#     A 200 status code is NOT sufficient evidence the right page was served —
#     see gotcha 4. Each one must show its OWN title and its OWN canonical,
#     not the homepage's.
for p in about contact privacy terms refund; do
  echo "=== /$p/ ==="
  curl -s "https://www.easewithexam.com/$p/" | grep -o '<title>[^<]*'
  curl -s "https://www.easewithexam.com/$p/" | grep -o '<link rel="canonical" href="[^"]*"'
done
#   every title must be that page's own (never the homepage's), every
#   canonical must end in /$p/ (never bare "/")

# 8. Clean up — belt and braces; step 3 is the one that actually protects you
ssh easewithexam 'rm -f ~/ewe-dist.tar.gz'
```

Old hashed assets are deliberately **left in place** rather than deleted, so a
client that already loaded the previous `index.html` can still fetch its chunks
mid-session. They accumulate slowly; prune occasionally, not per deploy.

## Gotcha 1 — `tar` exits 2 on a normal deploy, even with `--no-overwrite-dir`

`assets/` and `landing/` are owned by the `easewithexam` *user*, while the
deploy runs as `easewithexamdeploy`. `tar` tries to restore those directories'
mode and mtime, cannot, and **exits 2 after extracting every file correctly**.

**An earlier version of this file claimed `--no-overwrite-dir` avoids that. It
does not.** Corrected 2026-08-11 after a deploy run with the flag still exited
2:

```
tar: .: Cannot change mode to rwxrwx---: Operation not permitted
tar: ./assets: Cannot change mode to rwxrwx---: Operation not permitted
tar: ./landing: Cannot change mode to rwxrwx---: Operation not permitted
tar: Exiting with failure status due to previous errors
```

What the flag actually does is narrower than advertised: it suppresses the
`Cannot utime` errors, but **not** the `Cannot change mode` ones — and it adds
the extraction root `.` to the list. Keep using it, because fewer spurious
errors is still better, but do not treat it as a fix.

**The real safeguard is checking the files on disk.** `tar`'s exit code cannot
distinguish "nothing was written" from "everything was written and three
`chmod`s on pre-existing directories were refused", so it must not be the
signal you act on. Never roll back on exit 2 alone; look first:

```bash
ssh easewithexam 'R=~/htdocs/www.easewithexam.com; \
  grep -o "assets/index-[A-Za-z0-9_-]*\.js" $R/index.html; \
  ls -la $R/assets/index-<HASH>.js'
```

`index.html` must name the hash from step 1, and that file must exist. If both
hold, the extract succeeded regardless of the exit code. If `index.html` still
names the *old* hash, the extract genuinely failed — that is the case to roll
back on.

## Gotcha 2 — extracted files are 640 and the site 403s

The tarball carries the build machine's permissions, so files land `-rw-r-----`
while the previous deploy's were `-rw-r--r--`. Directories are `770`, owned by
another user, so a web server outside the `easewithexam` group cannot read the
new files. On 2026-08-11 this happened twice: **199 files** on the first deploy
that day, **201** on the second. It recurs on every deploy — it is the normal
case, not an anomaly.

Step 6 is not optional. Verify with:

```bash
ssh easewithexam 'find ~/htdocs/www.easewithexam.com -type f ! -perm -o=r | wc -l'   # must be 0
```

## Gotcha 3 — a failed `scp` produces a deploy that looks completely normal

**Two consecutive deploys on 2026-08-11 changed nothing on the server, and
nothing in the output said so.** The site served a build ~4 hours older than
the commits that were supposedly deployed, including a live student-facing
bug that was believed fixed.

What happened, in order:

1. `tar czf /tmp/ewe-dist.tar.gz` was run in **PowerShell**, which does not
   resolve `/tmp` — no tarball was produced at that path.
2. `scp` therefore failed. Its error scrolled past in a multi-command run.
3. `tar xzf ~/ewe-dist.tar.gz` had nothing to extract and failed.
4. **Gotcha 1 says exit 2 is normal.** The genuine failure was indistinguishable
   from the documented-benign one, so it was read as success.

The runbook itself hid the failure — step 8 was the only thing that would have
revealed it, and it only ran on the happy path.

**Three cheap checks, any one of which catches it. All three are now steps 3–3d.**

| check | catches |
|---|---|
| `rm -f ~/ewe-dist.tar.gz` **before** transfer | a stale archive being silently re-extracted |
| `md5sum` both sides | a truncated or wrong-build transfer |
| `tar tzf … \| grep index-` | an archive that does not contain the build you think |

Diagnosing it after the fact — worth knowing, because the symptom is "the site
did not change":

```bash
# Which build is actually being served? Compare against dist/index.html.
curl -s https://www.easewithexam.com/ | grep -o 'assets/index-[A-Za-z0-9_-]*\.js'

# nginx's ETag is "<mtime-hex>-<size-hex>", so the served file's mtime is
# readable without shell access — decode the first half as a unix timestamp.
curl -sI https://www.easewithexam.com/index.html | grep -i etag
```

Two traps when reading timestamps during this: the **server terminal reports
UTC** while the **CloudPanel file manager reports IST** (+5:30), so the same
file looks like two different times; and `tar` restores mtimes *from the
archive*, so an extracted file carries its build time, not its deploy time.

Finally: `~` is the **deploy user's** home. Run any of these as `root` and
`~/htdocs/...` becomes `/root/htdocs/...`. Use absolute paths when logged in as
root. (`/home/easewithexam/htdocs/...` and
`/home/easewithexamdeploy/htdocs/...` are the same directory — verified by
inode, `2049:3146753` — so either path is fine; they are not two copies.)

## Gotcha 4 — a 200 status code does not mean the right page was served

**Every one of `/about`, `/contact`, `/privacy`, `/terms`, `/refund` served
the HOMEPAGE's title and canonical for 4 days (2026-08-15 to 2026-08-19)
while returning a clean HTTP 200 the entire time.** The nginx conf's
app-route block tried `$uri` only; a prerendered route is a real
*directory* (`dist/about/index.html`), not a file, so that check always
failed and fell straight through to the root `index.html` — same status
code, completely different content. Both the fix's own "RESOLVED" check
and this project's own deploy step 7 checked status codes
(`200/200/200/404`) and the served bundle hash, neither of which can
distinguish "the right page" from "a different page that happens to also
return 200."

**Status code proves the server answered. It does not prove it answered
with the page you asked for.** This applies beyond nginx changes — any
change touching routing, `try_files`, redirects, or prerendering needs
the content check in step 7b above, not just the status/hash checks
above it. A wrong canonical or duplicate title is invisible to `curl -o
/dev/null -w '%{http_code}'` and to a bundle-hash diff, and is exactly
the kind of signal that gets a page quietly dropped from search results
rather than erroring loudly enough to notice.

## Rollback

```bash
ssh easewithexam 'tar xzf ~/deploy-backups/webroot-<TIMESTAMP>.tar.gz \
  -C ~/htdocs/www.easewithexam.com --no-overwrite-dir'
ssh easewithexam 'find ~/htdocs/www.easewithexam.com -type f -exec chmod 644 {} +'
```

## One-time — the nginx change that makes 404s real

**Applied 2026-08-15, via CloudPanel's Vhost editor — not the SSH procedure
below.** Kept as a maintenance-window fix for the record, and because
`deploy/nginx-easewithexam.conf` stays the source of truth for the block
itself whenever a route changes — only the *application mechanism* differs
from what's documented below.

**The SSH steps in this section do not work with the current deploy
credentials, for any nginx vhost change, not just this one.** Confirmed live:
`easewithexamdeploy` has no passwordless sudo (`sudo: a password is
required`) and can't even read the vhost file directly (`ls`:
`Permission denied`). This is a structural constraint, not specific to this
fix — anyone following the SSH steps below as written will hit the same wall.

**What actually works**: CloudPanel's Vhost tab for the site edits and applies
the raw nginx config through its own privileged process, fully decoupled from
the SSH user's permissions. It validates and reloads nginx on Save — no `ssh`,
no `sudo`, no manual `nginx -t`. Regenerate `deploy/nginx-easewithexam.conf`
the same way (`npm run nginx:routes` if a route was added), then paste its
`location` blocks into the CloudPanel editor in place of the existing
`location /` block — everything else in the vhost (the `{{ssl_certificate}}`,
`{{root}}`, `{{settings}}` placeholders, the existing extension-based caching
`location ~* ^.+\.(css|js|...)$` block) stays untouched. That extension block
predates this fix and is a **regex** location like the new app-route block —
nginx checks regex locations in file order and stops at the first match, so
the existing one keeps winning for `/assets/*.js` etc.; harmless, since it
already does equivalent caching (`expires max`).

The SSH procedure below is kept only in case sudo is ever granted to the
deploy user later — do not follow it as a first attempt.

The site previously answered **HTTP 200 to every path**, including ones that
do not exist. Nothing served a 404, so a stale backlink or a typo returned
homepage content under a bogus URL, and Google read an unbounded set of
duplicate homepages.

The React half of the fix ships in the bundle (`src/pages/NotFoundPage.jsx`)
and took effect on the next normal deploy. It renders a proper 404 page — but
under a 200, because nginx has already answered by the time React runs.
**Only the server can send the status code.**

`deploy/nginx-easewithexam.conf` holds the replacement block. It is **generated**
from the routes in `src/App.jsx` by `npm run nginx:routes`, and the test suite
fails if the two drift — otherwise adding a route to the app would silently make
that route 404 in production.

### Applying it (SSH path — currently non-functional, see above)

```bash
# 1. Confirm the conf matches the app's routes
npm run nginx:check

# 2. Back up the live vhost FIRST — a bad try_files 404s the whole site
ssh easewithexam 'sudo cp /etc/nginx/sites-available/www.easewithexam.com \
  ~/deploy-backups/nginx-$(date +%Y%m%d%H%M%S).conf'

# 3. Replace the catch-all `location / { try_files $uri $uri/ /index.html; }`
#    with the contents of deploy/nginx-easewithexam.conf

# 4. Validate BEFORE reloading. `nginx -t` is the entire safety net here.
ssh easewithexam 'sudo nginx -t'

# 5. Reload only if step 4 passed
ssh easewithexam 'sudo systemctl reload nginx'
```

### Verify

```bash
curl -o /dev/null -w '%{http_code}\n' https://www.easewithexam.com/            # 200
curl -o /dev/null -w '%{http_code}\n' https://www.easewithexam.com/about       # 200
curl -o /dev/null -w '%{http_code}\n' https://www.easewithexam.com/dashboard   # 200
curl -o /dev/null -w '%{http_code}\n' https://www.easewithexam.com/no-such-page # 404
curl -s https://www.easewithexam.com/no-such-page | grep -o '<title>[^<]*'      # 404 page
```

All four must match. A 404 on `/dashboard` means the route alternation is
missing a prefix — regenerate and reapply rather than hand-patching the server.

**This is not sufficient on its own — see Gotcha 4.** `/about` returning 200
does not mean it served *its own* page; run step 7b's content check
(title + canonical for every prerendered route) after any nginx change,
not just the status codes above. That exact gap is what let 4 days of
every prerendered route silently serving the homepage's content go
unnoticed the first time this section's procedure was followed.

### Why both a static and a React 404

`public/404.html` is what nginx returns for a direct hit on a bad URL — a
crawler, a stale link. It is standalone HTML because nginx serves it without the
bundle. `NotFoundPage.jsx` handles a bad route reached by *client-side*
navigation, where no request is made and nginx is never consulted. Returning
users with the service worker active also take that path, since the worker
serves `index.html` from cache. Keep the two visually in step.

## When a deploy is paired with a migration

Some migrations are **breaking** — a changed RPC signature means the old bundle
and the new schema cannot both work. `20260810070000` was one: it changed
`match_knowledge_base`'s `filter_exam_type` from `text` to `text[]`, dropping the
old signature.

For those, the live site is **degraded between the migration and the deploy**,
so the two go in one window, in this order:

1. Set any launch-time feature flags first (a missing flag row reads as `false`)
2. `supabase db push`
3. Verify the RPC immediately — including that the *old* call shape now fails,
   which confirms the cutover is real and the deploy is urgent
4. Build, transfer, extract, chmod, verify
5. Post-deploy checks against production

Reverting runs the same order backwards: **bundle first, then the SQL rollback**
(`supabase/rollback/`), because the restored bundle needs the old signature back.

CI's `migration-drift` job fails on push to `main` if a local migration was never
applied, so pushing before applying gives a red build rather than silent drift.
