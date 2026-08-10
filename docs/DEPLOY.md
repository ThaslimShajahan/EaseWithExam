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

# 4. Extract — --no-overwrite-dir is REQUIRED, see gotcha 1
ssh easewithexam 'tar xzf ~/ewe-dist.tar.gz -C ~/htdocs/www.easewithexam.com --no-overwrite-dir'

# 5. Fix permissions — REQUIRED, see gotcha 2
ssh easewithexam 'find ~/htdocs/www.easewithexam.com -type f -exec chmod 644 {} +'

# 6. Verify over real HTTP, not by trusting the copy
curl -s https://www.easewithexam.com/ | grep -o 'assets/index-[A-Za-z0-9_-]*\.js'
#   must equal the hash from step 1
curl -s -o /dev/null -w '%{http_code}\n' https://www.easewithexam.com/assets/<hash>.js

# 7. Clean up
ssh easewithexam 'rm -f ~/ewe-dist.tar.gz'
```

Old hashed assets are deliberately **left in place** rather than deleted, so a
client that already loaded the previous `index.html` can still fetch its chunks
mid-session. They accumulate slowly; prune occasionally, not per deploy.

## Gotcha 1 — `tar` exits 2 on a normal deploy

`assets/` and `landing/` are owned by the `easewithexam` *user*, while the
deploy runs as `easewithexamdeploy`. Plain `tar xzf` tries to restore those
directories' mode and mtime, cannot, and **exits 2 after extracting the files
correctly**:

```
tar: ./assets: Cannot utime: Operation not permitted
tar: ./assets: Cannot change mode to rwxr-x---: Operation not permitted
```

`--no-overwrite-dir` preserves existing directory metadata and avoids this.
Without it the exit code says "failed" while the deploy actually succeeded —
which is the worst kind of signal, because it invites either a false rollback or
an ignored error.

## Gotcha 2 — extracted files are 640 and the site 403s

The tarball carries the build machine's permissions, so files land `-rw-r-----`
while the previous deploy's were `-rw-r--r--`. Directories are `770`, owned by
another user, so a web server outside the `easewithexam` group cannot read the
new files. On 2026-08-11, **199 files** landed unreadable.

Step 5 is not optional. Verify with:

```bash
ssh easewithexam 'find ~/htdocs/www.easewithexam.com -type f ! -perm -o=r | wc -l'   # must be 0
```

## Rollback

```bash
ssh easewithexam 'tar xzf ~/deploy-backups/webroot-<TIMESTAMP>.tar.gz \
  -C ~/htdocs/www.easewithexam.com --no-overwrite-dir'
ssh easewithexam 'find ~/htdocs/www.easewithexam.com -type f -exec chmod 644 {} +'
```

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
