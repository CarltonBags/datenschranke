#!/usr/bin/env bash
# One-script deployment for the GDPR AI Gateway.
#
#   ./deploy.sh [dev|prod] [--build] [--seed]
#   ./deploy.sh --down          # stop the stack
#   ./deploy.sh --destroy       # stop + remove volumes (typed confirmation)
#
# Idempotent: re-running performs a rolling update (build/pull, migrate, restart),
# never data loss. This same script + compose bundle is the customer VPC install
# artifact — no step depends on our infrastructure.
set -euo pipefail

cd "$(dirname "$0")"
COMPOSE="docker compose"
ENV_FILE=".env"

red()   { printf '\033[31m%s\033[0m\n' "$*"; }
green() { printf '\033[32m%s\033[0m\n' "$*"; }
blue()  { printf '\033[34m%s\033[0m\n' "$*"; }

# ---- arg parsing -----------------------------------------------------------
PROFILE="dev"; BUILD=0; SEED=0; ACTION="up"
for arg in "$@"; do
  case "$arg" in
    dev|prod)   PROFILE="$arg" ;;
    --build)    BUILD=1 ;;
    --seed)     SEED=1 ;;
    --down)     ACTION="down" ;;
    --destroy)  ACTION="destroy" ;;
    *) red "unknown argument: $arg"; exit 1 ;;
  esac
done

# ---- 1. prerequisites ------------------------------------------------------
check_prereqs() {
  local missing=()
  command -v docker >/dev/null || missing+=("docker")
  docker compose version >/dev/null 2>&1 || missing+=("docker compose v2")
  command -v openssl >/dev/null || missing+=("openssl")
  if [ "${#missing[@]}" -gt 0 ]; then
    red "Missing prerequisites:"; printf '  - %s\n' "${missing[@]}"; exit 1
  fi
}

# ---- down / destroy --------------------------------------------------------
if [ "$ACTION" = "down" ]; then
  check_prereqs
  $COMPOSE --profile dev --profile prod down
  green "stack stopped"; exit 0
fi
if [ "$ACTION" = "destroy" ]; then
  check_prereqs
  read -r -p "Type DESTROY to remove ALL data volumes: " confirm
  [ "$confirm" = "DESTROY" ] || { red "aborted"; exit 1; }
  $COMPOSE --profile dev --profile prod down -v
  green "stack + volumes destroyed"; exit 0
fi

check_prereqs

# ---- 2. generate missing secrets ------------------------------------------
[ -f "$ENV_FILE" ] || { cp .env.example "$ENV_FILE"; blue "created $ENV_FILE from template"; }

set_secret() { # name generator
  local name="$1" gen="$2" cur
  cur="$(grep -E "^${name}=" "$ENV_FILE" | cut -d= -f2- || true)"
  if [ -z "$cur" ]; then
    local val; val="$(eval "$gen")"
    # portable in-place edit
    if grep -qE "^${name}=" "$ENV_FILE"; then
      awk -v n="$name" -v v="$val" 'BEGIN{FS=OFS="="} $1==n{$0=n"="v} {print}' "$ENV_FILE" > "$ENV_FILE.tmp" && mv "$ENV_FILE.tmp" "$ENV_FILE"
    else
      printf '%s=%s\n' "$name" "$val" >> "$ENV_FILE"
    fi
    blue "generated $name"
  fi
}
set_secret POSTGRES_PASSWORD    "openssl rand -hex 24"
set_secret GATEWAY_DB_PASSWORD  "openssl rand -hex 24"
set_secret MASTER_ENCRYPTION_KEY "openssl rand -base64 32"
set_secret SESSION_SECRET       "openssl rand -hex 32"

set -a; . "$ENV_FILE"; set +a
export DEFAULT_PROVIDER="${DEFAULT_PROVIDER:-mock}"

if [ "$PROFILE" = "prod" ] && [ "$DEFAULT_PROVIDER" != "mock" ] && [ -z "${OPENAI_API_KEY:-}" ]; then
  red "prod with DEFAULT_PROVIDER=$DEFAULT_PROVIDER requires OPENAI_API_KEY in .env"; exit 1
fi

# ---- 3+4. build & start ----------------------------------------------------
COMPOSE_P="$COMPOSE --profile $PROFILE"
if [ "$BUILD" = 1 ]; then
  blue "building images..."; $COMPOSE_P build
fi
blue "starting stack (profile: $PROFILE)..."
$COMPOSE_P up -d

# ---- 5. wait for postgres, run migrations ---------------------------------
blue "waiting for postgres..."
until docker compose exec -T postgres pg_isready -U postgres -d gdpr >/dev/null 2>&1; do sleep 1; done

blue "running migrations..."
docker compose exec -T \
  -e DATABASE_URL="postgres://postgres:${POSTGRES_PASSWORD}@postgres:5432/gdpr" \
  -e GATEWAY_DB_PASSWORD="${GATEWAY_DB_PASSWORD}" \
  gateway node /repo/infra/migrations/migrate.mjs

# ---- 6. optional seed ------------------------------------------------------
if [ "$SEED" = 1 ]; then
  blue "seeding demo tenant..."
  SEED_OUT="$(docker compose exec -T \
    -e DATABASE_URL="postgres://postgres:${POSTGRES_PASSWORD}@postgres:5432/gdpr" \
    -e DEFAULT_PROVIDER="${DEFAULT_PROVIDER}" \
    gateway node /repo/infra/migrations/seed.mjs "Demo GmbH")"
  DEMO_TENANT="$(printf '%s' "$SEED_OUT" | sed -n 's/.*"tenant_id":"\([^"]*\)".*/\1/p')"
  DEMO_KEY="$(printf '%s' "$SEED_OUT" | sed -n 's/.*"api_key":"\([^"]*\)".*/\1/p')"
  set_secret DEMO_TENANT_ID "printf '%s' '$DEMO_TENANT'"
  green "demo tenant: $DEMO_TENANT"
  green "demo API key (save it): $DEMO_KEY"
fi

# ---- 7. verify: healthchecks + one full redact->mock->unredact smoke -------
# Wait for the gateway healthcheck to pass (start-period ~30s) before verifying.
blue "waiting for gateway to become healthy..."
for _ in $(seq 1 40); do
  gw="$(docker compose ps --format '{{.Service}} {{.Health}}' | awk '$1=="gateway"{print $2}')"
  [ "$gw" = "healthy" ] && break
  sleep 3
done

blue "verifying services..."
fail=0
for svc in postgres redis redactor gateway; do
  state="$(docker compose ps --format '{{.Service}} {{.Health}}' | awk -v s="$svc" '$1==s{print $2}')"
  if [ "$state" = "healthy" ] || { [ "$svc" = "redis" ] && [ -n "$state" ]; }; then
    green "  $svc: ${state:-running}"
  else
    red "  $svc: ${state:-missing}"; fail=1
  fi
done

if [ "$fail" = 0 ]; then
  blue "smoke test: full redact -> mock -> unredact ..."
  SMOKE="$(docker compose exec -T \
    -e DATABASE_URL="postgres://postgres:${POSTGRES_PASSWORD}@postgres:5432/gdpr" \
    -e DEFAULT_PROVIDER="${DEFAULT_PROVIDER}" \
    gateway node /repo/infra/migrations/smoke.mjs || echo 'SMOKE_FAILED')"
  if printf '%s' "$SMOKE" | grep -q '"ok":true'; then
    green "  smoke passed: $SMOKE"
  else
    red "  smoke FAILED: $SMOKE"; fail=1
  fi
fi

echo
if [ "$fail" = 0 ]; then
  green "==================== DEPLOY OK ===================="
  green "gateway:   http://localhost:${GATEWAY_PORT:-8080}   (POST /v1/chat/completions)"
  green "web:       http://localhost:${WEB_PORT:-3000}"
  green "redactor:  http://localhost:${REDACTOR_PORT:-8000}/healthz"
  [ "$PROFILE" = dev ] && green "mock:      http://localhost:9090"
else
  red "==================== DEPLOY FAILED ===================="
  red "last logs from unhealthy services:"
  $COMPOSE logs --tail=30 gateway redactor
  exit 1
fi
