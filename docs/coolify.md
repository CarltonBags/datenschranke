# Deploying on Coolify (optional)

Coolify is **one** supported target. Nothing in the app depends on it — the same
`docker-compose.yml` runs anywhere:

| Target | How |
|---|---|
| **Any Linux server / VPS** | `./deploy.sh prod --build --seed` (generates secrets, migrates, seeds, TLS via Caddy) — see `docs/deploy.md` |
| **Coolify** | Point Coolify at this repo's `docker-compose.yml` (this doc) |
| **Kubernetes** | `infra/helm` (future) |

## Why it works on Coolify unchanged
- The compose uses **profiles**: `provider-mock` is `dev`-only and `caddy` is
  `prod`-only. Coolify runs `docker compose up` with **no profile**, so it starts
  exactly `postgres, redis, redactor, migrate, gateway, web` — no mock, and **no
  Caddy** (Coolify's own Traefik proxy handles domains + TLS).
- A one-shot **`migrate`** service applies SQL migrations before the gateway
  starts (`depends_on: migrate: service_completed_successfully`). No `deploy.sh`
  needed. It's idempotent, so running `deploy.sh` elsewhere stays safe.

## Steps
1. **Push** this repo to GitHub (done).
2. Coolify → **Sources** → connect your GitHub (GitHub App).
3. **New Resource → Docker Compose** → select repo + branch → compose path
   `docker-compose.yml`.
4. **Environment variables** (Coolify → the resource → *Environment*). These
   replace what `deploy.sh` would generate — set them yourself:
   ```
   POSTGRES_PASSWORD=<openssl rand -hex 24>
   GATEWAY_DB_PASSWORD=<openssl rand -hex 24>
   MASTER_ENCRYPTION_KEY=<openssl rand -base64 32>   # 32 bytes, base64
   SESSION_SECRET=<openssl rand -hex 32>
   DEFAULT_PROVIDER=openai            # or azure-openai
   OPENAI_BASE_URL=https://api.deepseek.com/v1   # or a EU endpoint (see GDPR note)
   OPENAI_API_KEY=<provider key>
   UVICORN_WORKERS=1                  # KVM 2 / 8 GB: keep at 1 (spaCy is RAM-heavy)
   ```
5. **Domains**: assign your domain to the **`web`** service (port 3000) and a
   subdomain (e.g. `api.…`) to the **`gateway`** service (port 8080). Traefik
   issues Let's Encrypt certs. Set the web container's `GATEWAY_URL` to the
   internal gateway URL Coolify provides (service DNS), not the public one.
6. **Deploy**. On success, **seed the first tenant** once via Coolify's terminal
   for the gateway container:
   ```
   DATABASE_URL="postgres://postgres:$POSTGRES_PASSWORD@postgres:5432/gdpr" \
   DEFAULT_PROVIDER=$DEFAULT_PROVIDER \
   node /repo/infra/migrations/seed.mjs "Your Company"
   # prints {"tenant_id":"…","api_key":"…"} — save the key
   ```
   Put the printed `tenant_id` into the web service env as `DEMO_TENANT_ID` (until
   OIDC is wired), redeploy `web`.
7. **Auto-deploy on push** is enabled by default.

## Sizing on KVM 2 (2 vCPU / 8 GB)
- `UVICORN_WORKERS=1` is important — 2 workers × ~1.5 GB spaCy + Tesseract can
  OOM alongside Postgres/gateway/web + the build.
- Building the redactor image on-box (spaCy + OpenCV + Tesseract) is slow on
  2 vCPU and memory-hungry. If builds OOM, build the redactor image in CI/GHCR
  and set `image:` instead of `build:` for that service, or use KVM 4 (16 GB).

## GDPR note
This is a data-protection product — deploy in an **EU region**, and prefer an
**EU-hosted model endpoint** (e.g. Azure OpenAI EU) over non-EU APIs, even though
only redacted text leaves the boundary. Switch via `OPENAI_BASE_URL`.
