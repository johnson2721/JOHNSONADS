#!/usr/bin/env bash
set -euo pipefail
umask 077
: "${DATABASE_URL:?Set DATABASE_URL in the worker environment}"
: "${BACKUP_AGE_RECIPIENT:?Set an age public key for backup encryption}"
: "${BACKUP_DIR:?Set BACKUP_DIR to an encrypted/off-site backup destination}"
mkdir -p -- "$BACKUP_DIR"
target="$BACKUP_DIR/jde-$(date -u +%Y%m%dT%H%M%SZ).dump.age"
tmp=$(mktemp "$BACKUP_DIR/.jde-XXXXXX")
passfile=$(mktemp)
trap 'rm -f -- "$tmp" "$passfile"' EXIT
# Use a private libpq passfile instead of placing a password in a process argument.
connection=$(node -e '
  const url = new URL(process.env.DATABASE_URL);
  if (!/^postgres(?:ql)?:$/.test(url.protocol)) process.exit(1);
  const password = url.searchParams.get("password") ?? decodeURIComponent(url.password);
  if (/[\r\n]/.test(password)) process.exit(1);
  if (password) require("node:fs").writeFileSync(process.argv[1], "*:*:*:*:" + password.replace(/[\\:]/g, "\\$&") + "\n", { mode: 0o600 });
  url.password = "";
  url.searchParams.delete("password");
  url.searchParams.delete("passfile");
  process.stdout.write(url.href);
' "$passfile")
PGPASSFILE="$passfile" pg_dump --dbname="$connection" --format=custom --no-owner --no-acl | age -r "$BACKUP_AGE_RECIPIENT" -o "$tmp"
mv -- "$tmp" "$target"
printf 'Encrypted backup written: %s\n' "$target"
