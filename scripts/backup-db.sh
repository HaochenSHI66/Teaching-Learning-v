#!/usr/bin/env bash
set -euo pipefail

BACKUP_DIR="${BACKUP_DIR:-./backups}"
KEEP_DAYS="${KEEP_DAYS:-14}"
CONTAINER="${POSTGRES_CONTAINER:-$(docker compose ps -q postgres 2>/dev/null || echo postgres)}"

mkdir -p "$BACKUP_DIR"

FILENAME="db_$(date +%Y%m%d_%H%M%S).sql.gz"
docker exec "$CONTAINER" pg_dump -U teaching teaching_learning | gzip > "$BACKUP_DIR/$FILENAME"
echo "Backup created: $BACKUP_DIR/$FILENAME ($(du -h "$BACKUP_DIR/$FILENAME" | cut -f1))"

DELETED=$(find "$BACKUP_DIR" -name "db_*.sql.gz" -mtime +"$KEEP_DAYS" -print -delete | wc -l)
echo "Cleaned up $DELETED old backups (keeping last $KEEP_DAYS days)"
