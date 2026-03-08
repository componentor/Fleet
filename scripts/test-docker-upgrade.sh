#!/usr/bin/env bash
# =============================================================================
# FULL DOCKER UPGRADE SIMULATION — A → B → C
# =============================================================================
#
# Simulates a REAL upgrade path using Docker:
#
#   State A (main branch):   Build image → deploy → verify health → seed data
#   State B (current branch): Build image → upgrade running container → verify
#                             health + data survives the upgrade
#   State C (post-upgrade):  Verify all data from A persists, API stable,
#                            registration works, tables complete
#
# This catches runtime errors that unit-level migration tests can't:
# - Broken Dockerfiles / missing files in image
# - tsup/esbuild bundling issues
# - Node.js import resolution failures at runtime
# - Migration/seeder SQL errors that only surface in the real entrypoint
# - Health check failures after upgrade
# - API boot crashes on schema changes
# - Data loss during migration
#
# Usage:
#   ./scripts/test-docker-upgrade.sh            # all 3 dialects
#   ./scripts/test-docker-upgrade.sh sqlite      # SQLite only
#   ./scripts/test-docker-upgrade.sh pg           # PostgreSQL only
#   ./scripts/test-docker-upgrade.sh mysql        # MySQL only
#
# Requirements: Docker with BuildKit support, git
# =============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
CYAN='\033[0;36m'
BOLD='\033[1m'
RESET='\033[0m'

# Unique prefix to avoid collisions
RUN_ID="fleet-upgrade-$(date +%s)-$$"
REGISTRY_CONTAINER="${RUN_ID}-registry"
REGISTRY_PORT=$((5100 + RANDOM % 100))
REGISTRY="127.0.0.1:${REGISTRY_PORT}"

# Image tags for A and B
TAG_A="state-a-${RUN_ID}"
TAG_B="state-b-${RUN_ID}"

PG_CONTAINER="${RUN_ID}-pg"
PG_PORT=$((54320 + RANDOM % 100))
PG_PASSWORD="testpass"

MYSQL_CONTAINER="${RUN_ID}-mysql"
MYSQL_PORT=$((33060 + RANDOM % 100))
MYSQL_PASSWORD="testpass"

VALKEY_CONTAINER="${RUN_ID}-valkey"
VALKEY_PORT=$((6380 + RANDOM % 100))
VALKEY_PASSWORD="testpass"

API_CONTAINER="${RUN_ID}-api"
API_PORT=$((3100 + RANDOM % 100))

MAIN_BRANCH="main"
WORKTREE_DIR="/tmp/${RUN_ID}-worktree"

PASSED=0
FAILED=0
TOTAL_PASSED=0
TOTAL_FAILED=0

# ── Logging ──────────────────────────────────────────────────────────────────

pass() { ((PASSED++)) || true; ((TOTAL_PASSED++)) || true; echo -e "  ${GREEN}✓${RESET} $1"; }
fail() { ((FAILED++)) || true; ((TOTAL_FAILED++)) || true; echo -e "  ${RED}✗${RESET} $1"; if [ -n "${2:-}" ]; then echo "    $2"; fi; }
section() { echo -e "\n${BOLD}── $1 ──${RESET}"; }
dialect_header() { echo -e "\n${BOLD}${CYAN}━━━━ $1 ━━━━${RESET}"; }
log() { echo -e "  $1"; }

# ── Cleanup ──────────────────────────────────────────────────────────────────

cleanup() {
  log "Cleaning up..."
  docker rm -f "$API_CONTAINER" 2>/dev/null || true
  docker rm -f "$PG_CONTAINER" 2>/dev/null || true
  docker rm -f "$MYSQL_CONTAINER" 2>/dev/null || true
  docker rm -f "$VALKEY_CONTAINER" 2>/dev/null || true
  docker rm -f "$REGISTRY_CONTAINER" 2>/dev/null || true
  rm -rf "/tmp/${RUN_ID}" 2>/dev/null || true
  # Clean up git worktree
  if [ -d "$WORKTREE_DIR" ]; then
    git -C "$ROOT_DIR" worktree remove --force "$WORKTREE_DIR" 2>/dev/null || true
    rm -rf "$WORKTREE_DIR" 2>/dev/null || true
  fi
}

trap cleanup EXIT

# ── Docker Checks ────────────────────────────────────────────────────────────

check_docker() {
  if ! docker info >/dev/null 2>&1; then
    echo -e "${RED}Docker is not available. Cannot run upgrade simulation.${RESET}"
    exit 1
  fi
}

# ── Start Local Registry ────────────────────────────────────────────────────

start_registry() {
  section "Starting local Docker registry"
  docker run -d --name "$REGISTRY_CONTAINER" \
    -p "${REGISTRY_PORT}:5000" \
    registry:2 >/dev/null
  log "Registry running at ${REGISTRY}"
}

# ── Build API Image from a source directory ─────────────────────────────────

build_api_image() {
  local source_dir="$1"
  local tag="$2"
  local label="$3"
  local full_tag="${REGISTRY}/fleet-api:${tag}"

  section "Building API image — ${label}"
  log "Source: ${source_dir}"
  log "Tag: ${full_tag}"

  if docker build \
    -f "${source_dir}/docker/Dockerfile.api" \
    -t "$full_tag" \
    "$source_dir" 2>&1 | tail -5; then
    docker push "$full_tag" 2>/dev/null
    pass "Image built and pushed: ${label}"
    return 0
  else
    fail "Image build FAILED: ${label}"
    return 1
  fi
}

# ── Prepare main branch worktree ────────────────────────────────────────────

prepare_main_worktree() {
  section "Preparing main branch worktree (State A)"

  # Check if main branch exists
  if ! git -C "$ROOT_DIR" rev-parse --verify "$MAIN_BRANCH" >/dev/null 2>&1; then
    # Try to fetch it (CI might only have the PR branch)
    git -C "$ROOT_DIR" fetch origin "$MAIN_BRANCH" 2>/dev/null || true
    if ! git -C "$ROOT_DIR" rev-parse --verify "origin/$MAIN_BRANCH" >/dev/null 2>&1; then
      log "${YELLOW}WARNING: main branch not available — using current branch as State A${RESET}"
      return 1
    fi
  fi

  # Create a worktree for the main branch
  rm -rf "$WORKTREE_DIR" 2>/dev/null || true
  local main_ref
  if git -C "$ROOT_DIR" rev-parse --verify "$MAIN_BRANCH" >/dev/null 2>&1; then
    main_ref="$MAIN_BRANCH"
  else
    main_ref="origin/$MAIN_BRANCH"
  fi

  git -C "$ROOT_DIR" worktree add --detach "$WORKTREE_DIR" "$main_ref" 2>/dev/null
  log "Worktree created at ${WORKTREE_DIR} ($(git -C "$WORKTREE_DIR" rev-parse --short HEAD))"
  pass "Main branch checked out for State A"
  return 0
}

# ── Start Infrastructure ────────────────────────────────────────────────────

start_valkey() {
  docker run -d --name "$VALKEY_CONTAINER" \
    -p "${VALKEY_PORT}:6379" \
    valkey/valkey:8-alpine \
    valkey-server --requirepass "$VALKEY_PASSWORD" >/dev/null
}

start_postgres() {
  docker run -d --name "$PG_CONTAINER" \
    -p "${PG_PORT}:5432" \
    -e POSTGRES_PASSWORD="$PG_PASSWORD" \
    -e POSTGRES_DB=fleet_test \
    -e POSTGRES_USER=fleet \
    postgres:17-alpine >/dev/null

  for i in $(seq 1 30); do
    if docker exec "$PG_CONTAINER" pg_isready -U fleet -d fleet_test >/dev/null 2>&1; then
      return 0
    fi
    sleep 1
  done
  fail "PostgreSQL did not become ready"
  return 1
}

start_mysql() {
  docker run -d --name "$MYSQL_CONTAINER" \
    -p "${MYSQL_PORT}:3306" \
    -e MYSQL_ROOT_PASSWORD="$MYSQL_PASSWORD" \
    -e MYSQL_DATABASE=fleet_test \
    mysql:8.0 --default-authentication-plugin=mysql_native_password >/dev/null

  for i in $(seq 1 60); do
    if docker exec "$MYSQL_CONTAINER" mysqladmin ping -h127.0.0.1 -uroot -p"$MYSQL_PASSWORD" --silent 2>/dev/null; then
      return 0
    fi
    sleep 1
  done
  fail "MySQL did not become ready"
  return 1
}

# ── Run API Container ───────────────────────────────────────────────────────

run_api() {
  local dialect="$1"
  local image_tag="$2"
  local api_image="${REGISTRY}/fleet-api:${image_tag}"

  # Clean up any previous API container
  docker rm -f "$API_CONTAINER" 2>/dev/null || true

  local db_env=""
  local extra_args=""

  case "$dialect" in
    sqlite)
      mkdir -p "/tmp/${RUN_ID}/data"
      db_env="-e DB_DIALECT=sqlite -e DATABASE_PATH=/app/data/fleet.db"
      extra_args="-v /tmp/${RUN_ID}/data:/app/data"
      ;;
    pg)
      db_env="-e DB_DIALECT=pg -e DATABASE_URL=postgres://fleet:${PG_PASSWORD}@host.docker.internal:${PG_PORT}/fleet_test"
      ;;
    mysql)
      db_env="-e DB_DIALECT=mysql -e DATABASE_URL=mysql://root:${MYSQL_PASSWORD}@host.docker.internal:${MYSQL_PORT}/fleet_test"
      ;;
  esac

  docker run -d --name "$API_CONTAINER" \
    -p "${API_PORT}:3000" \
    $db_env \
    -e NODE_ENV=production \
    -e JWT_SECRET=test-jwt-secret-for-upgrade-simulation \
    -e ENCRYPTION_KEY=0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef \
    -e VALKEY_URL="redis://:${VALKEY_PASSWORD}@host.docker.internal:${VALKEY_PORT}" \
    -e PLATFORM_DOMAIN=localhost \
    -e CORS_ORIGIN=http://localhost:3000 \
    -e APP_URL=http://localhost:3000 \
    -e LOG_LEVEL=warn \
    --add-host=host.docker.internal:host-gateway \
    $extra_args \
    "$api_image" 2>/dev/null

  return 0
}

# ── Wait for API Health ──────────────────────────────────────────────────────

wait_for_api() {
  local timeout="${1:-60}"
  for i in $(seq 1 "$timeout"); do
    local status
    status=$(curl -s -o /dev/null -w "%{http_code}" "http://127.0.0.1:${API_PORT}/health" 2>/dev/null || echo "000")
    if [ "$status" = "200" ]; then
      return 0
    fi
    sleep 1
  done
  return 1
}

# ── Get API Logs ─────────────────────────────────────────────────────────────

get_api_logs() {
  docker logs "$API_CONTAINER" 2>&1 | tail -30
}

# ── Get table count ──────────────────────────────────────────────────────────

get_table_count() {
  local dialect="$1"
  case "$dialect" in
    sqlite)
      docker exec "$API_CONTAINER" node -e "
        const Database = require('better-sqlite3');
        const db = new Database('/app/data/fleet.db');
        const rows = db.prepare(\"SELECT COUNT(*) AS cnt FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '__drizzle%'\").get();
        console.log(rows.cnt);
        db.close();
      " 2>/dev/null || echo "0"
      ;;
    pg)
      docker exec "$PG_CONTAINER" psql -U fleet -d fleet_test -t -c \
        "SELECT COUNT(*) FROM pg_tables WHERE schemaname = 'public' AND tablename NOT LIKE '__drizzle%';" 2>/dev/null | tr -d ' ' || echo "0"
      ;;
    mysql)
      docker exec "$MYSQL_CONTAINER" mysql -uroot -p"$MYSQL_PASSWORD" -N -e \
        "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema = 'fleet_test' AND table_name NOT LIKE '__drizzle%';" 2>/dev/null | tr -d ' ' || echo "0"
      ;;
  esac
}

# ── Get seeder/settings count ────────────────────────────────────────────────

get_settings_count() {
  local dialect="$1"
  case "$dialect" in
    sqlite)
      docker exec "$API_CONTAINER" node -e "
        const Database = require('better-sqlite3');
        const db = new Database('/app/data/fleet.db');
        try { const r = db.prepare('SELECT COUNT(*) AS cnt FROM platform_settings').get(); console.log(r.cnt); }
        catch(e) { console.log('0'); }
        db.close();
      " 2>/dev/null || echo "0"
      ;;
    pg)
      docker exec "$PG_CONTAINER" psql -U fleet -d fleet_test -t -c \
        "SELECT COUNT(*) FROM platform_settings;" 2>/dev/null | tr -d ' ' || echo "0"
      ;;
    mysql)
      docker exec "$MYSQL_CONTAINER" mysql -uroot -p"$MYSQL_PASSWORD" -N -e \
        "SELECT COUNT(*) FROM fleet_test.platform_settings;" 2>/dev/null | tr -d ' ' || echo "0"
      ;;
  esac
}

# ── Insert marker data (State A) ────────────────────────────────────────────

insert_marker_data() {
  local dialect="$1"
  local marker_id="upgrade-test-${RUN_ID}"

  section "Inserting marker data for upgrade verification"

  case "$dialect" in
    sqlite)
      docker exec "$API_CONTAINER" node -e "
        const Database = require('better-sqlite3');
        const db = new Database('/app/data/fleet.db');
        db.prepare(\"INSERT OR IGNORE INTO platform_settings (key, value) VALUES (?, ?)\").run('test:upgrade_marker', '\"${marker_id}\"');
        db.close();
        console.log('ok');
      " 2>/dev/null
      ;;
    pg)
      docker exec "$PG_CONTAINER" psql -U fleet -d fleet_test -c \
        "INSERT INTO platform_settings (key, value) VALUES ('test:upgrade_marker', '\"${marker_id}\"') ON CONFLICT (key) DO NOTHING;" 2>/dev/null
      ;;
    mysql)
      docker exec "$MYSQL_CONTAINER" mysql -uroot -p"$MYSQL_PASSWORD" -e \
        "INSERT IGNORE INTO fleet_test.platform_settings (\`key\`, value) VALUES ('test:upgrade_marker', '\"${marker_id}\"');" 2>/dev/null
      ;;
  esac

  return 0
}

# ── Verify marker data survives upgrade ──────────────────────────────────────

verify_marker_data() {
  local dialect="$1"
  local marker_id="upgrade-test-${RUN_ID}"
  local found=""

  case "$dialect" in
    sqlite)
      found=$(docker exec "$API_CONTAINER" node -e "
        const Database = require('better-sqlite3');
        const db = new Database('/app/data/fleet.db');
        try { const r = db.prepare(\"SELECT value FROM platform_settings WHERE key = 'test:upgrade_marker'\").get(); console.log(r ? r.value : 'NOT_FOUND'); }
        catch(e) { console.log('ERROR'); }
        db.close();
      " 2>/dev/null || echo "ERROR")
      ;;
    pg)
      found=$(docker exec "$PG_CONTAINER" psql -U fleet -d fleet_test -t -c \
        "SELECT value FROM platform_settings WHERE key = 'test:upgrade_marker';" 2>/dev/null | tr -d ' ' || echo "ERROR")
      ;;
    mysql)
      found=$(docker exec "$MYSQL_CONTAINER" mysql -uroot -p"$MYSQL_PASSWORD" -N -e \
        "SELECT value FROM fleet_test.platform_settings WHERE \`key\` = 'test:upgrade_marker';" 2>/dev/null | tr -d ' ' || echo "ERROR")
      ;;
  esac

  # Check if marker value contains the run ID
  if echo "$found" | grep -q "$marker_id"; then
    return 0
  else
    echo "$found"
    return 1
  fi
}

# ── Clean up marker data ────────────────────────────────────────────────────

cleanup_marker_data() {
  local dialect="$1"
  case "$dialect" in
    sqlite)
      docker exec "$API_CONTAINER" node -e "
        const Database = require('better-sqlite3');
        const db = new Database('/app/data/fleet.db');
        db.prepare(\"DELETE FROM platform_settings WHERE key = 'test:upgrade_marker'\").run();
        db.close();
      " 2>/dev/null || true
      ;;
    pg)
      docker exec "$PG_CONTAINER" psql -U fleet -d fleet_test -c \
        "DELETE FROM platform_settings WHERE key = 'test:upgrade_marker';" 2>/dev/null || true
      ;;
    mysql)
      docker exec "$MYSQL_CONTAINER" mysql -uroot -p"$MYSQL_PASSWORD" -e \
        "DELETE FROM fleet_test.platform_settings WHERE \`key\` = 'test:upgrade_marker';" 2>/dev/null || true
      ;;
  esac
}

# ── Test a Single Dialect (Full A → B → C) ──────────────────────────────────

test_dialect() {
  local dialect="$1"
  local has_main="$2"
  local label
  case "$dialect" in
    sqlite) label="SQLite" ;;
    pg) label="PostgreSQL" ;;
    mysql) label="MySQL" ;;
  esac

  dialect_header "${label} — A → B → C Upgrade Path"
  PASSED=0
  FAILED=0

  local tables_before_upgrade=0

  # ══════════════════════════════════════════════════════════════════
  # STATE A — Deploy from main branch
  # ══════════════════════════════════════════════════════════════════

  section "${label}: Step 1 — Start database"

  case "$dialect" in
    sqlite)
      log "Using SQLite (file-based)"
      mkdir -p "/tmp/${RUN_ID}/data"
      pass "SQLite ready"
      ;;
    pg)
      if start_postgres; then
        pass "PostgreSQL container started"
      else
        return
      fi
      ;;
    mysql)
      if start_mysql; then
        pass "MySQL container started"
      else
        return
      fi
      ;;
  esac

  # ── Deploy State A ─────────────────────────────────────────────
  if [ "$has_main" = "true" ]; then
    section "${label}: Step 2 — Deploy State A (main branch)"
    log "Deploying API from main branch image..."

    if run_api "$dialect" "$TAG_A"; then
      pass "State A container started"
    else
      fail "State A container failed to start"
      return
    fi

    section "${label}: Step 3 — Verify State A health"

    if wait_for_api 90; then
      pass "State A: API healthy (migrations ran, app booted)"
    else
      fail "State A: API health check FAILED" "$(get_api_logs)"
      return
    fi

    # Record table count from State A
    tables_before_upgrade=$(get_table_count "$dialect")
    log "State A has ${tables_before_upgrade} tables"

    # Verify State A is functional
    local health_a
    health_a=$(curl -s "http://127.0.0.1:${API_PORT}/health" 2>/dev/null)
    if echo "$health_a" | grep -q "ok\|healthy\|status"; then
      pass "State A: Health endpoint returns valid response"
    else
      fail "State A: Health endpoint unexpected response: $health_a"
    fi

    # Insert marker data that must survive the upgrade
    section "${label}: Step 4 — Insert upgrade marker data"
    if insert_marker_data "$dialect"; then
      pass "Marker data inserted into State A database"
    else
      fail "Failed to insert marker data"
    fi

    # Stop State A API container (DB persists)
    log "Stopping State A API container..."
    docker rm -f "$API_CONTAINER" 2>/dev/null || true
    sleep 1

  else
    log "${YELLOW}No main branch available — skipping State A, deploying current branch directly${RESET}"
    tables_before_upgrade=0
  fi

  # ══════════════════════════════════════════════════════════════════
  # STATE B — Upgrade to current branch
  # ══════════════════════════════════════════════════════════════════

  local step_offset=2
  if [ "$has_main" = "true" ]; then
    step_offset=5
  fi

  section "${label}: Step ${step_offset} — Deploy State B (current branch → upgrade)"

  if [ "$has_main" = "true" ]; then
    log "Upgrading from main → current branch (same database)..."
  else
    log "Fresh deploy of current branch..."
  fi

  if run_api "$dialect" "$TAG_B"; then
    pass "State B container started"
  else
    fail "State B container failed to start"
    return
  fi

  section "${label}: Step $((step_offset + 1)) — Verify State B health (post-upgrade)"

  if wait_for_api 90; then
    pass "State B: API healthy after upgrade (new migrations applied, app booted)"
  else
    fail "State B: API health check FAILED after upgrade — UPGRADE IS BROKEN" "$(get_api_logs)"
    return
  fi

  # ══════════════════════════════════════════════════════════════════
  # STATE C — Post-upgrade verification
  # ══════════════════════════════════════════════════════════════════

  section "${label}: Step $((step_offset + 2)) — State C: Post-upgrade verification"

  # C.1: Health endpoint
  local health_b
  health_b=$(curl -s "http://127.0.0.1:${API_PORT}/health" 2>/dev/null)
  if echo "$health_b" | grep -q "ok\|healthy\|status"; then
    pass "State C: Health endpoint valid after upgrade"
  else
    fail "State C: Health endpoint broken after upgrade: $health_b"
  fi

  # C.2: Table count (should be >= State A)
  local tables_after_upgrade
  tables_after_upgrade=$(get_table_count "$dialect")
  if [ "${tables_after_upgrade:-0}" -ge 40 ]; then
    pass "State C: Database has ${tables_after_upgrade} tables (expected 40+)"
  else
    fail "State C: Database has only ${tables_after_upgrade} tables (expected 40+)"
  fi

  if [ "$has_main" = "true" ] && [ "${tables_before_upgrade:-0}" -gt 0 ]; then
    if [ "${tables_after_upgrade:-0}" -ge "${tables_before_upgrade}" ]; then
      pass "State C: Table count preserved or grew (${tables_before_upgrade} → ${tables_after_upgrade})"
    else
      fail "State C: Tables LOST during upgrade (${tables_before_upgrade} → ${tables_after_upgrade})"
    fi
  fi

  # C.3: Marker data survived the upgrade
  if [ "$has_main" = "true" ]; then
    section "${label}: Step $((step_offset + 3)) — Verify data survived upgrade"

    if verify_marker_data "$dialect"; then
      pass "State C: Marker data survived the upgrade (no data loss)"
    else
      fail "State C: Marker data LOST during upgrade — DATA LOSS DETECTED"
    fi
  fi

  # C.4: Seeders ran
  section "${label}: Step $((step_offset + 4)) — Verify seeders"

  local settings_count
  settings_count=$(get_settings_count "$dialect")
  if [ "${settings_count:-0}" -ge 1 ]; then
    pass "State C: Seeders executed (${settings_count} platform settings)"
  else
    fail "State C: Seeders may not have run (0 platform settings)"
  fi

  # C.5: Registration endpoint works
  section "${label}: Step $((step_offset + 5)) — Registration endpoint"

  local reg_status
  reg_status=$(curl -s -o /dev/null -w "%{http_code}" -X POST "http://127.0.0.1:${API_PORT}/api/v1/auth/register" \
    -H "Content-Type: application/json" \
    -d "{\"email\":\"admin-${RUN_ID}@test.local\",\"password\":\"TestPassword123!\",\"name\":\"Test Admin\"}" 2>/dev/null)
  if [ "$reg_status" -ge 200 ] && [ "$reg_status" -lt 500 ]; then
    pass "State C: Registration endpoint reachable (HTTP ${reg_status})"
  else
    fail "State C: Registration endpoint returned server error (HTTP ${reg_status})"
  fi

  # C.6: Container stability
  section "${label}: Step $((step_offset + 6)) — Container stability"

  sleep 3
  local container_status
  container_status=$(docker inspect -f '{{.State.Status}}' "$API_CONTAINER" 2>/dev/null || echo "missing")
  if [ "$container_status" = "running" ]; then
    pass "State C: API container still running (no crash loops)"
  else
    fail "State C: API container status: ${container_status}" "$(get_api_logs)"
  fi

  # ── Cleanup marker data ────────────────────────────────────────
  cleanup_marker_data "$dialect"

  # ── Cleanup dialect containers ─────────────────────────────────
  docker rm -f "$API_CONTAINER" 2>/dev/null || true
  case "$dialect" in
    pg) docker rm -f "$PG_CONTAINER" 2>/dev/null || true ;;
    mysql) docker rm -f "$MYSQL_CONTAINER" 2>/dev/null || true ;;
    sqlite) ;; # Keep data dir — cleaned up at exit
  esac

  echo ""
  log "${label}: ${PASSED} passed, ${FAILED} failed"
}

# ── Main ─────────────────────────────────────────────────────────────────────

main() {
  echo -e "${BOLD}"
  echo "============================================"
  echo " FULL DOCKER UPGRADE SIMULATION (A → B → C)"
  echo "============================================"
  echo -e "${RESET}"

  check_docker

  # Parse args
  local dialects=()
  case "${1:-all}" in
    sqlite) dialects=("sqlite") ;;
    pg)     dialects=("pg") ;;
    mysql)  dialects=("mysql") ;;
    all)    dialects=("sqlite" "pg" "mysql") ;;
    *)
      echo "Usage: $0 [sqlite|pg|mysql|all]"
      exit 1
      ;;
  esac

  echo "Dialects: ${dialects[*]}"
  echo "Run ID:   ${RUN_ID}"
  echo ""

  # ── Infrastructure (shared) ────────────────────────────────────
  start_registry
  start_valkey

  # ── Build State A image (from main branch) ─────────────────────
  local has_main="false"
  if prepare_main_worktree; then
    # Use current branch's Docker build config and dependency declarations
    # so State A builds with the latest build pipeline but main's source code.
    # All package.json files referenced by the Dockerfile must match the lockfile.
    cp -f "${ROOT_DIR}/docker/Dockerfile.api" "${WORKTREE_DIR}/docker/Dockerfile.api"
    cp -f "${ROOT_DIR}/docker/tsup.docker.ts" "${WORKTREE_DIR}/docker/tsup.docker.ts"
    cp -f "${ROOT_DIR}/docker/entrypoint-api.sh" "${WORKTREE_DIR}/docker/entrypoint-api.sh"
    cp -f "${ROOT_DIR}/pnpm-lock.yaml" "${WORKTREE_DIR}/pnpm-lock.yaml"
    cp -f "${ROOT_DIR}/package.json" "${WORKTREE_DIR}/package.json"
    cp -f "${ROOT_DIR}/pnpm-workspace.yaml" "${WORKTREE_DIR}/pnpm-workspace.yaml"
    cp -f "${ROOT_DIR}/packages/api/package.json" "${WORKTREE_DIR}/packages/api/package.json"
    cp -f "${ROOT_DIR}/packages/db/package.json" "${WORKTREE_DIR}/packages/db/package.json"
    cp -f "${ROOT_DIR}/packages/types/package.json" "${WORKTREE_DIR}/packages/types/package.json"

    if build_api_image "$WORKTREE_DIR" "$TAG_A" "State A (main branch)"; then
      has_main="true"
    else
      log "${YELLOW}WARNING: Failed to build main branch image — will test fresh deploy only${RESET}"
    fi
    # Clean up worktree after build
    git -C "$ROOT_DIR" worktree remove --force "$WORKTREE_DIR" 2>/dev/null || true
    rm -rf "$WORKTREE_DIR" 2>/dev/null || true
  fi

  # ── Build State B image (from current branch) ──────────────────
  if ! build_api_image "$ROOT_DIR" "$TAG_B" "State B (current branch)"; then
    fail "FATAL: Cannot build current branch image"
    echo -e "\n${RED}DOCKER UPGRADE SIMULATION FAILED${RESET}"
    exit 1
  fi

  # ── Test each dialect ──────────────────────────────────────────
  for dialect in "${dialects[@]}"; do
    test_dialect "$dialect" "$has_main"
  done

  # ── Summary ────────────────────────────────────────────────────
  echo -e "\n${BOLD}============================================"
  echo " RESULTS"
  echo -e "============================================${RESET}"

  if [ "$has_main" = "true" ]; then
    echo -e "  Flow:    A (main) → B (current) → C (verify)"
  else
    echo -e "  Flow:    B (current) → C (verify)  ${YELLOW}[no main branch for A]${RESET}"
  fi
  echo -e "  Total:   ${TOTAL_PASSED} passed, ${TOTAL_FAILED} failed"
  echo ""

  if [ "$TOTAL_FAILED" -gt 0 ]; then
    echo -e "${RED}DOCKER UPGRADE SIMULATION FAILED${RESET}"
    echo "Fix the issues before merging to main."
    exit 1
  else
    echo -e "${GREEN}DOCKER UPGRADE SIMULATION PASSED${RESET}"
    echo "Upgrade path verified: build → deploy A → upgrade B → verify C."
    exit 0
  fi
}

main "$@"
