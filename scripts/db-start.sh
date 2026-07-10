#!/usr/bin/env bash
# Starts a local pgvector Postgres for development & tests (Supabase-like).
set -euo pipefail

NAME="${HR_PG_CONTAINER:-hr_pg}"
PORT="${HR_PG_PORT:-54329}"

if docker ps --format '{{.Names}}' | grep -q "^${NAME}$"; then
  echo "Postgres container '${NAME}' already running on port ${PORT}."
  exit 0
fi

docker rm -f "${NAME}" >/dev/null 2>&1 || true
docker run -d --name "${NAME}" \
  -e POSTGRES_PASSWORD=postgres \
  -e POSTGRES_DB=hr \
  -p "${PORT}:5432" \
  pgvector/pgvector:pg16 >/dev/null

echo -n "Waiting for Postgres"
for _ in $(seq 1 30); do
  if docker exec "${NAME}" pg_isready -U postgres >/dev/null 2>&1; then
    echo " — ready on port ${PORT}."
    exit 0
  fi
  echo -n "."
  sleep 1
done
echo " — timed out." >&2
exit 1
