#!/usr/bin/env bash
# Concurrent submissions against a real Postgres: a transaction holds the match row lock
# while duplicate and competing submissions queue behind it.
set -euo pipefail
psql_in() { docker exec -i "$CONTAINER" psql -X -v ON_ERROR_STOP=1 -U postgres -qtA "$@"; }

MATCH=3a000000-0000-4000-8000-000000000001
SUN=20000000-0000-4000-8000-000000000001
psql_in <<SQL
insert into public.matches (id, mode, map_id, current_player, turn_number, state, created_by)
values ('$MATCH', 'online', 'meadow-line', 'sun', 1, '{"turnNumber": 1}', '$SUN');
insert into public.match_players (match_id, user_id, side) values ('$MATCH', '$SUN', 'sun');
SQL

commit_sql() {
  echo "set role service_role; select outcome from public.commit_match_turn_v2('$MATCH', '$SUN', '$1', 1, '[{\"type\": \"end_turn\"}]', '{\"turnNumber\": 2}', 'moon', 2, null);"
}

# Holder: commits submission A but keeps the transaction (and row lock) open for 2s.
{ echo "begin;"; commit_sql 5a000000-0000-4000-8000-000000000001; echo "select pg_sleep(2); commit;"; } \
  | psql_in > "$TMPDIR_DB/holder.out" &
HOLDER=$!
sleep 0.5
commit_sql 5a000000-0000-4000-8000-000000000001 | psql_in > "$TMPDIR_DB/duplicate.out" &
DUP=$!
commit_sql 5b000000-0000-4000-8000-000000000001 | psql_in > "$TMPDIR_DB/competing.out" &
COMPETING=$!
wait $HOLDER $DUP $COMPETING

check() {
  local label=$1 actual=$2 expected=$3
  if [ "$actual" != "$expected" ]; then
    echo "FAIL $label: expected '$expected', got '$actual'" >&2
    exit 1
  fi
  echo "ok - $label"
}
check "lock holder commits" "$(grep -v '^$' "$TMPDIR_DB/holder.out" | head -1)" "committed"
check "concurrent duplicate waits and is deduplicated" "$(cat "$TMPDIR_DB/duplicate.out")" "duplicate"
check "concurrent competing submission is stale" "$(cat "$TMPDIR_DB/competing.out")" "stale"
check "one turn row written" "$(echo "select count(*) from public.turns where match_id = '$MATCH';" | psql_in)" "1"
check "match advanced once" "$(echo "select turn_number from public.matches where id = '$MATCH';" | psql_in)" "2"
