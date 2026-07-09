# Deployment

Everything runs on Docker; a single script deploys the entire stack. The same
script + compose bundle is the customer VPC install artifact — no step depends on
our infrastructure.

## Prerequisites
- Docker + Docker Compose v2
- `openssl` (secret generation)

## Commands
```bash
./deploy.sh dev  --build --seed   # local dev: hot-reload-ish, mock provider, exposed ports
./deploy.sh prod --build          # built images, Caddy TLS, resource limits
./deploy.sh --down                # stop
./deploy.sh --destroy             # stop + remove volumes (typed confirmation)
```

`deploy.sh` in order: (1) validates prerequisites; (2) generates missing secrets
into `.env` with `openssl rand`; (3) builds images (`--build`); (4) starts via
the compose profile; (5) waits for Postgres health and runs migrations
idempotently; (6) optionally seeds a demo tenant + policy (`--seed`); (7) verifies
every healthcheck and runs one full `redact → mock → unredact` smoke request,
printing a green summary or a red diagnosis with last log lines.

Re-running performs a rolling update (build/pull, migrate, restart) — never data
loss.

## Environment
See `.env.example`. Required secrets (auto-generated on first run):
`POSTGRES_PASSWORD`, `GATEWAY_DB_PASSWORD`, `MASTER_ENCRYPTION_KEY` (32-byte
base64 envelope master key — back this with a KMS in real prod via the
`apps/gateway/src/crypto/envelope.ts` seam), `SESSION_SECRET`.

For real providers set `DEFAULT_PROVIDER=openai` (or `azure-openai`) and
`OPENAI_API_KEY`; prod refuses to start with a non-mock provider and no key.

## Prod TLS
`prod` runs Caddy with automatic certificates. Set `PUBLIC_DOMAIN` in `.env`;
Caddy proxies `/v1/*` and `/api/*` to the gateway and everything else to the web
app (`infra/Caddyfile`).

## Migrations
Numbered raw SQL in `infra/migrations`, applied idempotently by
`migrate.mjs` (tracked in `schema_migrations`). Never edit an applied migration —
add a new numbered file.

## Sizing
`docs/sizing.md` is regenerated per release by `tests/load/sizing.ts` and doubles
as the VPC capacity guide (users → vCPU/RAM per service, replica counts).
