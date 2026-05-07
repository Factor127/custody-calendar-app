# Off-Railway encrypted DB backups

Spontany's only live copy of `calendar.db` lives on Railway's persistent volume. If Railway loses the volume — billing dispute, account takeover, region outage, fat-fingered `railway down` — there is nothing to restore from. This system mirrors the database to Backblaze B2, encrypted with `age`, on a nightly schedule, run from GitHub's infra so it doesn't share fate with Railway.

The encryption key never sits in any place Anthropic, GitHub, or Railway can read. Even a full GitHub compromise can't decrypt the backups.

## Architecture

```
Railway (live SQLite, WAL mode)
  └── /api/admin/backup           ← VACUUM INTO snapshot, ADMIN_TOKEN-gated
        ↑
        │  curl + age -e (encrypt with public key)
        │
GitHub Actions runner (nightly cron)
        │
        ↓  aws s3 cp (B2 S3-compatible API)
Backblaze B2 bucket
  └── daily/spontany-YYYY-MM-DD.db.age
        ↑ retention pruner runs after each upload
```

The age private key lives only in your password manager + a paper copy in a sealed envelope. It is never in this repo, in GitHub secrets, on Railway, or in any chat with an LLM.

## One-time setup

### 1. Generate the age keypair

On a machine you trust (your laptop, offline if you're paranoid):

```bash
brew install age          # or: apt install age
age-keygen -o spontany-age.key
```

The file looks like:

```
# created: 2026-05-06T...
# public key: age1qz...
AGE-SECRET-KEY-1...
```

- The **public key** (`age1...` line) goes into GitHub secrets as `AGE_PUBLIC_KEY`. This is the only key the workflow ever sees.
- The **private key** (`AGE-SECRET-KEY-1...` line) does NOT go anywhere online. Stash it in:
  - Your password manager (1Password / Bitwarden) under "Spontany age backup key", AND
  - A printed copy in a sealed envelope, taped inside a book on your shelf or in a safe deposit box. This is your "GitHub also got hacked" insurance.

Verify you can decrypt before trusting the backups: encrypt a throwaway file with the public key, decrypt with the private key, confirm bytes match.

### 2. Create the Backblaze B2 bucket

1. Sign up at backblaze.com (free tier: 10 GB storage, 1 GB/day download — easily covers Spontany at current scale for years).
2. Create a private bucket: `spontany-backups`. Region pick: somewhere different from Railway's region. If Railway is `us-west`, put B2 in `us-east-005` for blast-radius separation.
3. Disable bucket-level lifecycle rules. The pruner script is the source of truth for retention; bucket lifecycle would race with it.
4. Create an Application Key scoped to that one bucket with read + write + delete permissions. Save the keyID and applicationKey.

### 3. Configure GitHub repo secrets

Repo → Settings → Secrets and variables → Actions → Repository secrets. Add:

| Secret | Value |
|---|---|
| `PROD_BASE_URL` | `https://spontany.io` |
| `ADMIN_TOKEN` | the same value Railway has set for `ADMIN_TOKEN` |
| `AGE_PUBLIC_KEY` | the `age1...` line from step 1 (public key only) |
| `B2_ACCESS_KEY_ID` | B2 keyID |
| `B2_SECRET_ACCESS_KEY` | B2 applicationKey |
| `B2_REGION` | e.g. `us-east-005` |
| `B2_ENDPOINT` | e.g. `https://s3.us-east-005.backblazeb2.com` |
| `B2_BUCKET` | `spontany-backups` |

The workflow's first step sanity-checks all of these are set and that `AGE_PUBLIC_KEY` is not accidentally a private key.

### 4. Smoke test

In the Actions tab → "Off-Railway DB backup" → "Run workflow" with reason "smoke test". Watch the logs:

- Snapshot size should be roughly the size of `data/calendar.db` on Railway.
- "SQLite format 3" header check should pass.
- Encrypted size will be ~the same as plaintext (age has minimal overhead).
- An object should appear at `daily/spontany-YYYY-MM-DD.db.age` in B2.

Then run a restore drill (next section) to prove the round-trip works before relying on it.

## Restore drill

Run this every quarter, and any time you change the encryption key, the workflow, or the schema in a way that affects the most-watched tables.

```bash
# One-time: install tools locally.
brew install age awscli sqlite

# Each drill: set up env (consider a direnv or .envrc, NEVER committed).
export B2_ENDPOINT="https://s3.us-east-005.backblazeb2.com"
export B2_BUCKET="spontany-backups"
export AWS_ACCESS_KEY_ID="..."
export AWS_SECRET_ACCESS_KEY="..."
export AWS_DEFAULT_REGION="us-east-005"
export AGE_KEY_FILE="$HOME/keys/spontany-age.key"   # private key file

# Pull + decrypt + integrity-check the latest backup.
./scripts/restore-backup.sh

# Or pull a specific date:
./scripts/restore-backup.sh 2026-04-15
```

Expected output: `ok` from `PRAGMA integrity_check`, plus row counts that look reasonable (users count matches what you'd expect from production, `calendar_days` is non-zero, etc.).

The script writes the verified DB to `restored-<date>.db` in the current directory. Delete it when done with the drill — it contains real PII.

## Real disaster recovery

If Railway has actually lost the data:

1. Run `./scripts/restore-backup.sh` to retrieve the most recent verified snapshot.
2. Stop the Spontany service in Railway (so nothing can write to a partially-restored DB).
3. Upload the restored `.db` file to the Railway volume as `/data/calendar.db` (use Railway's CLI `railway run` + `cat`, or attach a one-off shell to the volume).
4. Restart the service.
5. Smoke-test: log in as yourself, check that calendars/connections/opportunities are present.
6. Communicate with the affected users about what was lost (anything between the last successful backup and the outage).

## Operational notes

- **Schedule.** 09:00 UTC nightly. Adjust the cron in `.github/workflows/db-backup.yml` if you'd rather run during a quieter window for your traffic.
- **Failure notification.** GitHub emails the repo owner on workflow failure by default. If you want pager-style alerting, add a final step that posts to Slack/Discord on `if: failure()`.
- **Cost estimate.** B2 charges $0.005/GB-month for storage and $0.01/GB egress. At today's database size, you're paying single-digit cents per year.
- **Rotating the encryption key.** Generate a new keypair, update `AGE_PUBLIC_KEY` in GH secrets, keep the OLD private key around forever — it's the only thing that can decrypt historical backups. Never delete a retired private key until you've also deleted every object encrypted to it.
- **Rotating `ADMIN_TOKEN`.** Per the standard rotation order in `CLAUDE.md`: generate new value → update Railway → redeploy → update GH secret `ADMIN_TOKEN` → run a manual workflow dispatch to verify → revoke old.
- **Don't `curl` `/api/admin/backup` from anywhere else.** Any other source of pulls will pollute the access log and create extra DB load. The endpoint is meant for the cron only.
