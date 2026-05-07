#!/usr/bin/env bash
# scripts/prune-backups.sh
#
# Apply GFS-lite retention to the encrypted SQLite backups in Backblaze B2.
# Called from .github/workflows/db-backup.yml right after a successful upload.
#
# Retention policy (defaults — override via env if you ever want to change):
#   - KEEP_DAILY=14   :: the 14 most recent dated backups
#   - KEEP_WEEKLY=8   :: one per ISO week, last 8 weeks (latest in each week)
#   - KEEP_MONTHLY=12 :: one per calendar month, last 12 months (latest in each)
#
# A single backup can satisfy multiple buckets; the keep-set is a union, so
# at steady state you'll have ~14 + a few extra older anchors, not 34.
# Anything not in the keep-set is deleted.
#
# Set DRY_RUN=1 to log decisions without deleting.
#
# Required env (passed through from the workflow):
#   AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, AWS_DEFAULT_REGION
#   B2_ENDPOINT, B2_BUCKET

set -euo pipefail

KEEP_DAILY="${KEEP_DAILY:-14}"
KEEP_WEEKLY="${KEEP_WEEKLY:-8}"
KEEP_MONTHLY="${KEEP_MONTHLY:-12}"
PREFIX="${PREFIX:-daily/}"
DRY_RUN="${DRY_RUN:-0}"

: "${B2_BUCKET:?B2_BUCKET required}"
: "${B2_ENDPOINT:?B2_ENDPOINT required}"

# ── 1. List every backup key under the prefix ───────────────────────────────
# `--output text` returns tab-separated keys; pipe through tr to one-per-line.
all_keys_raw=$(aws s3api list-objects-v2 \
  --endpoint-url "$B2_ENDPOINT" \
  --bucket "$B2_BUCKET" \
  --prefix "$PREFIX" \
  --query 'Contents[].Key' \
  --output text 2>/dev/null || true)

if [ -z "$all_keys_raw" ] || [ "$all_keys_raw" = "None" ]; then
  echo "No backups found under s3://$B2_BUCKET/$PREFIX — nothing to prune."
  exit 0
fi

# ── 2. Build "YYYY-MM-DD<TAB>key" entries, sorted oldest-first ──────────────
# Filenames look like `daily/spontany-2026-05-06.db.age`. Anything that
# doesn't parse cleanly is skipped (defensive — avoid deleting something
# that wasn't meant to follow the convention).
mapfile -t entries < <(
  printf '%s\n' "$all_keys_raw" | tr '\t' '\n' | while read -r key; do
    [ -z "$key" ] && continue
    base=${key##*/}
    date=${base#spontany-}
    date=${date%.db.age}
    if [[ "$date" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}$ ]]; then
      printf '%s\t%s\n' "$date" "$key"
    fi
  done | sort
)

if [ "${#entries[@]}" -eq 0 ]; then
  echo "No parseable backups under $PREFIX — nothing to prune."
  exit 0
fi

# ── 3. Compute the keep-set ─────────────────────────────────────────────────
# Bash associative arrays act as sets keyed on object key.
declare -A keep_keys

# 3a) Last KEEP_DAILY entries (most recent dates).
n=${#entries[@]}
start=$(( n > KEEP_DAILY ? n - KEEP_DAILY : 0 ))
for ((i=start; i<n; i++)); do
  k=${entries[i]##*$'\t'}
  keep_keys["$k"]=1
done

# 3b) Latest entry per ISO year-week, capped at KEEP_WEEKLY most recent weeks.
# Iterating oldest-first means later assignments win — i.e. we end up with
# the latest backup in each week, even when multiple ran in the same week.
declare -A latest_per_week
for entry in "${entries[@]}"; do
  date=${entry%%$'\t'*}
  key=${entry##*$'\t'}
  iso_week=$(date -u -d "$date" +%G-%V)
  latest_per_week["$iso_week"]="$key"
done
mapfile -t recent_weeks < <(printf '%s\n' "${!latest_per_week[@]}" | sort -r | head -n "$KEEP_WEEKLY")
for w in "${recent_weeks[@]}"; do
  keep_keys["${latest_per_week[$w]}"]=1
done

# 3c) Latest entry per calendar month, capped at KEEP_MONTHLY most recent.
declare -A latest_per_month
for entry in "${entries[@]}"; do
  date=${entry%%$'\t'*}
  key=${entry##*$'\t'}
  ym=$(date -u -d "$date" +%Y-%m)
  latest_per_month["$ym"]="$key"
done
mapfile -t recent_months < <(printf '%s\n' "${!latest_per_month[@]}" | sort -r | head -n "$KEEP_MONTHLY")
for m in "${recent_months[@]}"; do
  keep_keys["${latest_per_month[$m]}"]=1
done

# ── 4. Identify deletions ───────────────────────────────────────────────────
to_delete=()
for entry in "${entries[@]}"; do
  key=${entry##*$'\t'}
  if [ -z "${keep_keys[$key]:-}" ]; then
    to_delete+=("$key")
  fi
done

echo "Total backups : ${#entries[@]}"
echo "Keeping       : ${#keep_keys[@]}"
echo "Deleting      : ${#to_delete[@]}"

if [ "${#to_delete[@]}" -eq 0 ]; then
  echo "Nothing to prune. Retention healthy."
  exit 0
fi

# ── 5. Delete (or pretend to, if DRY_RUN=1) ─────────────────────────────────
for key in "${to_delete[@]}"; do
  if [ "$DRY_RUN" = "1" ]; then
    echo "DRY-RUN delete: $key"
  else
    echo "Deleting: $key"
    aws s3 rm \
      --endpoint-url "$B2_ENDPOINT" \
      "s3://$B2_BUCKET/$key"
  fi
done

echo "Prune complete."
