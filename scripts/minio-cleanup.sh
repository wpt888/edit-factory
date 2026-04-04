#!/bin/bash
# MinIO Buffer Video Cleanup
# Deletes videos from MinIO conservatively, after Buffer had ample time to
# ingest them even when processing is delayed.
# Runs as cron job every 20 minutes, independent of the Edit Factory app.

DB_CONTAINER="supabase-db-h0ccogg8ks008gks8gk40ksk"
MINIO_CONTAINER="supabase-minio-h0ccogg8ks008gks8gk40ksk"
LOG="/var/log/minio-cleanup.log"

echo "[$(date -Iseconds)] Cleanup started" >> "$LOG"

# Query publications where video should be cleaned up:
# - Has storage_path (video still in MinIO)
# - scheduled_at + 24h has passed, OR
# - published_at + 24h has passed (immediate posts), OR
# - No dates but created > 1 day ago (orphans)
ROWS=$(docker exec "$DB_CONTAINER" psql -U postgres -d postgres -t -A -F'|' -c "
  SELECT id, storage_path
  FROM public.editai_postiz_publications
  WHERE storage_path IS NOT NULL
    AND (
      (scheduled_at IS NOT NULL AND scheduled_at < NOW() - INTERVAL '24 hours')
      OR
      (published_at IS NOT NULL AND published_at < NOW() - INTERVAL '24 hours')
      OR
      (scheduled_at IS NULL AND published_at IS NULL AND created_at < NOW() - INTERVAL '1 day')
    );
")

if [ -z "$ROWS" ]; then
  echo "[$(date -Iseconds)] No expired videos to clean up" >> "$LOG"
  exit 0
fi

DELETED=0
while IFS='|' read -r PUB_ID STORAGE_PATH; do
  [ -z "$STORAGE_PATH" ] && continue

  # Delete from MinIO
  docker exec "$MINIO_CONTAINER" mc rm "local/buffer-videos/${STORAGE_PATH}" 2>/dev/null

  if [ $? -eq 0 ]; then
    # Clear storage_path in DB so we don't retry
    docker exec "$DB_CONTAINER" psql -U postgres -d postgres -q -c \
      "UPDATE public.editai_postiz_publications SET storage_path = NULL WHERE id = '${PUB_ID}';"
    echo "[$(date -Iseconds)] Deleted: ${STORAGE_PATH} (pub: ${PUB_ID})" >> "$LOG"
    DELETED=$((DELETED + 1))
  else
    echo "[$(date -Iseconds)] Failed to delete: ${STORAGE_PATH} (pub: ${PUB_ID})" >> "$LOG"
  fi
done <<< "$ROWS"

echo "[$(date -Iseconds)] Cleanup done: ${DELETED} videos deleted" >> "$LOG"
