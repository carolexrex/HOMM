#!/usr/bin/env bash
# SQL integration tests: applies supabase/schema.sql to a throwaway Postgres (Docker) over a
# legacy installation, re-applies it to check it is re-runnable, then exercises
# commit_match_turn_v2 including concurrent submissions. Usage: npm run test:db
set -euo pipefail
cd "$(dirname "$0")/../.."

IMAGE=${BANNERFRONT_TEST_PG_IMAGE:-postgres:15-alpine}
export CONTAINER="bannerfront-db-test-$$"
export TMPDIR_DB
TMPDIR_DB=$(mktemp -d)
cleanup() { docker rm -f "$CONTAINER" >/dev/null 2>&1 || true; rm -rf "$TMPDIR_DB"; }
trap cleanup EXIT

docker run -d --rm --name "$CONTAINER" -e POSTGRES_PASSWORD=postgres "$IMAGE" >/dev/null
for _ in $(seq 1 60); do
  if docker exec "$CONTAINER" pg_isready -U postgres -q 2>/dev/null \
    && docker exec "$CONTAINER" psql -U postgres -qtAc "select 1" >/dev/null 2>&1; then
    break
  fi
  sleep 0.5
done

psql_file() { docker exec -i -e PGOPTIONS="${PGOPTIONS:-}" "$CONTAINER" psql -X -v ON_ERROR_STOP=1 -U postgres -q "$@"; }

echo "# bootstrap + legacy install"
export PGOPTIONS="-c client_min_messages=warning"
psql_file < tests/db/bootstrap.sql
psql_file < tests/db/legacy.sql
echo "# apply schema.sql (migration), then again (re-run)"
psql_file < supabase/schema.sql
psql_file < supabase/schema.sql
echo "# commit_match_turn_v2"
PGOPTIONS="-c client_min_messages=notice" psql_file < tests/db/commit_match_turn.sql 2>&1 | sed -E 's/^(psql:[^ ]* )?NOTICE:  //'
echo "# concurrency"
bash tests/db/concurrency.sh
echo "# all SQL checks passed"
