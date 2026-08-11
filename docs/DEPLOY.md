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
npm test && npm run build
grep -o 'assets/index-[A-Za-z0-9_-]*\.js' dist/index.html   # note this hash

# 2. Back up the current web root (fast to restore; seconds)
ssh easewithexam 'R=~/htdocs/www.easewithexam.com; B=~/deploy-backups; mkdir -p $B; \
  tar czf $B/webroot-$(date +%F-%H%M%S).tar.gz -C $R . && ls -lh $B | tail -2'

# 3. Package and transfer
tar czf /tmp/ewe-dist.tar.gz -C dist .
scp /tmp/ewe-dist.tar.gz easewithexam:~/ewe-dist.tar.gz

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

# 8. Clean up
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

## Rollback

```bash
ssh easewithexam 'tar xzf ~/deploy-backups/webroot-<TIMESTAMP>.tar.gz \
  -C ~/htdocs/www.easewithexam.com --no-overwrite-dir'
ssh easewithexam 'find ~/htdocs/www.easewithexam.com -type f -exec chmod 644 {} +'
```

## One-time — the nginx change that makes 404s real

**Not yet applied. Prepared 2026-08-11, needs a maintenance window.**

The site currently answers **HTTP 200 to every path**, including ones that do
not exist. Nothing serves a 404, so a stale backlink or a typo returns homepage
content under a bogus URL, and Google reads an unbounded set of duplicate
homepages.

The React half of the fix ships in the bundle (`src/pages/NotFoundPage.jsx`) and
takes effect on the next normal deploy. It renders a proper 404 page — but under
a 200, because nginx has already answered by the time React runs. **Only the
server can send the status code.**

`deploy/nginx-easewithexam.conf` holds the replacement block. It is **generated**
from the routes in `src/App.jsx` by `npm run nginx:routes`, and the test suite
fails if the two drift — otherwise adding a route to the app would silently make
that route 404 in production.

### Applying it

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
