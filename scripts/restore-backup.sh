#!/usr/bin/env bash
# scripts/restore-backup.sh
#
# Pull an encrypted backup from Backblaze B2, decrypt it locally with the age
# private key, and run an integrity check + row-count smoke test. Use this for:
#
#   1. Periodic restore drills (you should do one at least every quarter — a
#      backup you've never restored is a hope, not a backup).
#   2. Actual disaster recovery, in which case after this script verifies the
#      file, copy it onto Railway's volume as `calendar.db` and bounce the app.
#
# Usage:
#   B2_ENDPOINT=...  B2_BUCKET=...  AGE_KEY_FILE=~/keys/spontany-age.key  \
#   AWS_ACCESS_KEY_ID=...  AWS_SECRET_ACCESS_KEY=...  AWS_DEFAULT_REGION=... \
#     scripts/restore-backup.sh                    # latest daily
#     scripts/restore-backup.sh 2026-04-15         # specific date
#
# AGE_KEY_FILE points at a file containing the line `AGE-SECRET-KEY-1...`.
# That file must NEVER be committed to git or pasted into chat.

set -euo pipefail

: "${B2_ENDPOINT:?B2_ENDPOINT required}"
: "${B2_BUCKET:?B2_BUCKET required}"
: "${AGE_KEY_FILE:?AGE_KEY_FILE required (path to age private key)}"

if [ ! -r "$AGE_KEY_FILE" ]; then
  echo "Cannot read AGE_KEY_FILE=$AGE_KEY_FILE" >&2
  exit 1
fi

DATE_ARG="${1:-}"
PREFIX="daily/"

# Pick the object: explicit date if given, else the most recent.
if [ -n "$DATE_ARG" ]; then
  KEY="${PREFIX}spontany-${DATE_ARG}.db.age"
else
  KEY=$(aws s3api list-objects-v2 \
    --endpoint-url "$B2_ENDPOINT" \
    --bucket "$B2_BUCKET" \
    --prefix "$PREFIX" \
    --query 'sort_by(Contents, &LastModified)[-1].Key' \
    --output text)
  if [ -z "$KEY" ] || [ "$KEY" = "None" ]; then
    echo "No backups found under s3://$B2_BUCKET/$PREFIX" >&2
    exit 1
  fi
fi

WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT

echo "→ Downloading s3://$B2_BUCKET/$KEY"
aws s3 cp --no-progress \
  --endpoint-url "$B2_ENDPOINT" \
  "s3://$B2_BUCKET/$KEY" \
  "$WORK/backup.db.age"

echo "→ Decrypting with $AGE_KEY_FILE"
age -d -i "$AGE_KEY_FILE" -o "$WORK/backup.db" "$WORK/backup.db.age"

# SQLite header check before anything that might lock or modify the file.
head -c 15 "$WORK/backup.db" | grep -q 'SQLite format 3' || {
  echo "Decrypted file is not a SQLite database. Wrong key, corrupted upload, or someone tampered with the bucket." >&2
  exit 1
}

echo "→ Running PRAGMA integrity_check"
result=$(sqlite3 "$WORK/backup.db" 'PRAGMA integrity_check;')
echo "$result"
if [ "$result" != "ok" ]; then
  echo "Integrity check FAILED. Do not deploy this snapshot." >&2
  exit 2
fi

# Row counts on tables we know exist. Useful as a smoke test that the schema
# survived encryption + decryption round-trip and that the snapshot wasn't
# truncated mid-write.
echo
echo "→ Row counts:"
for table in users calendar_days connections opportunities plans outings; do
  if sqlite3 "$WORK/backup.db" \
       "SELECT name FROM sqlite_master WHERE type='table' AND name='$table';" \
       | grep -q "$table"; then
    count=$(sqlite3 "$WORK/backup.db" "SELECT COUNT(*) FROM $table;")
    printf '  %-20s %s\n' "$table" "$count"
  fi
done

# Move the decrypted DB out of the temp dir so the caller can do something
# with it, but only after all checks passed. Final location is the caller's
# CWD; print explicitly so it's visible in CI / terminal scrollback.
OUT="$(pwd)/restored-${DATE_ARG:-latest}.db"
mv "$WORK/backup.db" "$OUT"
trap - EXIT
rm -rf "$WORK"

echo
echo "Verified backup written to: $OUT"
echo "If this is a real restore: stop the Railway service, replace /data/calendar.db with this file, restart."
