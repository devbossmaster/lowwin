#!/usr/bin/env bash
set -euo pipefail
umask 077
# PGSERVICEFILE/PGPASSFILE are protected external files, never command-line URLs.
: "${PGSERVICEFILE:?Set protected PostgreSQL service file}"
: "${PGPASSFILE:?Set protected PostgreSQL password file}"
: "${LOWWIN_BACKUP_RECIPIENT:?Set the age public encryption recipient}"
target="/srv/lowwin/shared/backups/lowwin-$(date -u +%Y%m%dT%H%M%SZ).dump.age"
mkdir -p /srv/lowwin/shared/backups
pg_dump --dbname='service=lowwin_backup' --format=custom --no-owner --no-acl | age -r "$LOWWIN_BACKUP_RECIPIENT" -o "$target"
test -s "$target"
printf 'Encrypted Lowwin backup completed. Replicate and restore-test before deleting older backups.\n'
