# CLAUDE.md — GDPR AI Gateway Platform

## What this project is

A GDPR-compliance platform that lets companies use LLMs (OpenAI, Anthropic, Azure OpenAI) without exposing personal data (PII) to the providers. PII is detected and replaced with placeholders **before** any text leaves the tenant boundary; the LLM only ever sees redacted text; placeholders are mapped back to real values on the way back to the user.

Two products, one shared core:

- **Product A — "Company Chat"**: a ChatGPT-style web app for employees. Kills shadow AI. Employees chat normally; redaction/un-redaction is invisible to them.
- **Product B — "API Proxy"**: an OpenAI-compatible endpoint (`/v1/chat/completions`). Companies change one base URL in their existing integrations and get redaction transparently, including for streamed responses.

Target buyers: DPOs / CISOs at EU companies. The audit trail, policy engine, and EU-language detection quality ARE the product — treat them as first-class features, never afterthoughts.

## Non-negotiable invariants (violating any of these is a critical bug)

1. **Raw PII never leaves the system boundary.** No PII in: outbound LLM requests, logs, error messages, traces, metrics, third-party telemetry, or client-side storage. Log placeholders and entity types, never values.
2. **The token map (placeholder → original value) is encrypted at rest** (AES-256-GCM via envelope encryption) **and tenant-scoped.** No code path may read a map across tenant boundaries. Every vault query MUST filter by `tenant_id` — enforce with Postgres Row-Level Security, not just application code.
3. **Placeholder consistency per conversation.** The same real-world entity gets the same placeholder for the entire conversation lifetime (`Anna Schmidt` → `[[PERSON_1]]` in turn 1 must still be `[[PERSON_1]]` in turn 20, and the reverse mapping must resolve identically).
4. **Every request that touches PII produces an audit event** (see Audit log section). No silent paths.
5. **Fail closed.** If the redaction service is unreachable, errors, or times out: the request MUST NOT be forwarded to the LLM provider. Return a clear error. Never "best effort" redaction.
6. **Deletion works.** Deleting a conversation deletes its token map entries (GDPR Art. 17). Cascade deletes, verified by tests.

## Architecture

```
┌───────────────┐      ┌───────────────┐
│ Product A     │      │ Product B     │
│ chat UI       │      │ OpenAI-compat │
│ (Next.js)     │      │ API proxy     │
└───────┬───────┘      └───────┬───────┘
        │      HTTPS/SSE       │
        ▼                      ▼
┌──────────────────────────────────────┐
│ Gateway (Node/TypeScript, Fastify)   │
│  - auth (SSO/OIDC + API keys)        │
│  - policy engine (per-tenant rules)  │
│  - token map vault client            │
│  - stream un-redactor (SSE buffer)   │
│  - provider router                   │
│  - audit logger                      │
└───────┬──────────────────┬───────────┘
        │ gRPC/HTTP        │ HTTPS (redacted text only)
        ▼                  ▼
┌───────────────┐   ┌───────────────────┐
│ Redaction svc │   │ LLM providers     │
│ (Python,      │   │ OpenAI/Anthropic/ │
│  FastAPI +    │   │ Azure OpenAI      │
│  Presidio)    │   └───────────────────┘
└───────────────┘
        │
┌───────┴───────────────────────────────┐
│ Postgres (system of record + vault)    │
│ Redis (sessions, rate limits, cache)   │
│ BullMQ (background jobs only)          │
└────────────────────────────────────────┘
```

The redaction service and gateway are separate deployables but ship together (docker-compose for dev, Helm chart for prod). Everything must be deployable inside a customer's VPC — no hard dependency on our cloud.

## Repository layout (pnpm monorepo + Python service)

```
/
├── CLAUDE.md
├── deploy.sh                   # one-script deployment (see Deployment section)
├── docker-compose.yml          # full stack, profiles: dev | prod
├── tests/
│   └── load/                   # k6 scenarios + sizing runner (see Load testing section)
├── apps/
│   ├── web/                    # Product A chat UI + admin console (Next.js 15, App Router)
│   └── gateway/                # Node gateway (Fastify, TypeScript, ESM)
├── services/
│   └── redactor/               # Python 3.12, FastAPI, Presidio, spaCy models
├── packages/
│   ├── shared/                 # shared TS types, placeholder grammar constants, zod schemas
│   └── stream-unredactor/      # the SSE hold-back buffer (reference impl exists, see below)
├── infra/
│   ├── migrations/             # SQL migrations (raw SQL, numbered, via node-pg-migrate)
│   └── helm/                   # prod deployment chart
└── docs/
    └── adr/                    # architecture decision records, one file per decision
```

## Tech stack (fixed — do not substitute without an ADR)

- **Frontend**: Next.js 15 (App Router), Tailwind, shadcn/ui, TypeScript strict.
- **Gateway**: Node 22, Fastify, TypeScript strict, ESM. Zod for all input validation.
- **Redaction service**: Python 3.12, FastAPI, Microsoft Presidio (analyzer + anonymizer), spaCy `de_core_news_lg` and `en_core_web_lg` (add `fr`, `nl` later).
- **Data**: Postgres 16 (system of record + vault, with RLS), Redis 7 (sessions, rate limiting, hot map cache), BullMQ (background jobs ONLY — never in the live request path).
- **Auth**: OIDC (support Entra ID + Okta + generic OIDC) for Product A; hashed API keys (SHA-256, prefix-searchable) for Product B.
- **Testing**: Vitest (TS), pytest (Python), Playwright (E2E for chat UI).

## The placeholder grammar (contract between all services)

Format: `[[TYPE_N]]` where TYPE ∈ {PERSON, EMAIL, PHONE, IBAN, ADDRESS, ORG, LOCATION, DATE, ID, MISC} and N is 1–4 digits, numbered per conversation in order of first appearance.

Rules:
- The grammar is defined ONCE in `packages/shared/src/placeholder.ts` (TS) and mirrored in `services/redactor/app/placeholder.py` (Python). A cross-language test asserts both produce/accept identical strings.
- Max placeholder length is derived from the grammar; the stream buffer depends on it.
- The redactor MUST reuse an existing placeholder when it sees an entity already in the conversation's map (lookup by normalized value + entity type).
- Every outbound LLM request gets a system-prompt suffix: "Tokens of the form [[TYPE_N]] are opaque references. Preserve them exactly; never modify, translate, expand, or invent them."
- **Tenant custom entities do NOT extend the wire grammar.** Tenants can define custom recognizers (see Policy engine), but on the wire every custom entity maps to the fixed placeholder type `CUSTOM` (add CUSTOM to the type vocabulary in both grammar implementations, i.e. `[[CUSTOM_N]]`). The tenant's descriptive label ("Acme account number") lives only in the token_map row (`custom_label` column, nullable), audit events, and the admin UI. The grammar stays a closed vocabulary — `couldBePlaceholderPrefix` and the stream buffer must never depend on tenant-defined strings.

## Stream un-redaction (Product B hot path)

A working reference implementation exists: `stream-unredactor.ts` (StreamUnredactor class + couldBePlaceholderPrefix + createSSEUnredactor TransformStream for OpenAI-format SSE). Move it into `packages/stream-unredactor/`, keep its algorithm intact, and extend:

- Add an Anthropic SSE adapter (`content_block_delta` events) reusing the same StreamUnredactor core.
- Add a bound on the SSE line buffer (protect against upstream that never sends newlines).
- Port its inline sanity check into proper Vitest tests, including: placeholder split across 2–4 chunks, back-to-back placeholders, unknown placeholder pass-through, stream ending mid-possible-placeholder, tool-call argument streams.
- Non-streaming responses use a simple whole-body replace (same COMPLETE_PLACEHOLDER regex, same stats).

## Redaction service API (Python)

```
POST /v1/redact
  { tenant_id, conversation_id, text, language?, policy: {...} }
→ { redacted_text, entities: [{placeholder, type, start, end, score}], new_map_entries: [{placeholder, value}] }

POST /v1/analyze          # detection only, no replacement (for the admin "test your policy" screen)
GET  /healthz             # gateway fail-closed check
```

Notes:
- The redactor is STATELESS regarding the map: the gateway sends known entities' normalized values with the request (or the redactor queries the vault via the gateway — pick one and write an ADR; default: gateway owns all vault access, redactor receives `existing_entities: [{value_hash, placeholder, type}]` and matches against them).
- Language detection: use `langdetect` fallback if `language` not provided.
- German coverage: pin a Presidio version that includes the built-in German recognizer set (Steuer-IdNr, Steuernummer, Reisepassnummer, Personalausweisnummer, Rentenversicherungsnummer, Krankenversicherungsnummer — added upstream in 2026) and explicitly ENABLE it in the recognizer registry config (country-specific groups are often disabled by default). Do NOT reimplement these. Write test fixtures with known-valid examples (valid checksums) for each German ID type asserting detection.
- Build custom PatternRecognizers ONLY for upstream gaps: Handelsregisternummer (HRB/HRA + court), USt-IdNr (DE + 9 digits, checksum), EU driving license. Add German context words to boost confidence for German text.
- NER quality for free-text German PII (names, addresses) is the product moat: maintain a labeled German evaluation set from day one and track precision/recall per entity type across releases.
- Latency budget: p95 < 150 ms for 2 KB of text. Keep spaCy models loaded in memory; run with 2+ uvicorn workers; expose a warmup endpoint.

## Token map vault (Postgres)

```sql
-- migrations sketch; refine but keep the shape
CREATE TABLE tenants (id uuid PK, name text, ...);
CREATE TABLE conversations (
  id uuid PK, tenant_id uuid NOT NULL REFERENCES tenants,
  product text CHECK (product IN ('chat','proxy')),
  created_at timestamptz, deleted_at timestamptz
);
CREATE TABLE token_map (
  id bigint generated PK,
  tenant_id uuid NOT NULL,
  conversation_id uuid NOT NULL REFERENCES conversations ON DELETE CASCADE,
  placeholder text NOT NULL,             -- '[[PERSON_1]]'
  entity_type text NOT NULL,
  custom_label text,                     -- tenant's display label for CUSTOM entities, else NULL
  value_ciphertext bytea NOT NULL,       -- AES-256-GCM
  value_hash bytea NOT NULL,             -- HMAC-SHA256(tenant_key, normalized value) for reuse lookup
  dek_id uuid NOT NULL,                  -- envelope encryption: data key id
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (conversation_id, placeholder)
);
ALTER TABLE token_map ENABLE ROW LEVEL SECURITY;
-- RLS policy: current_setting('app.tenant_id')::uuid = tenant_id
```

- Envelope encryption: per-tenant data encryption keys (DEKs), wrapped by a master key (env var in dev; KMS in prod behind an interface so customers can bring their own KMS).
- Hot cache: conversation's map in Redis with short TTL, keyed `map:{tenant}:{conversation}`, values encrypted the same way (cache stores ciphertext; decrypt in the gateway process only).
- Deletion: `DELETE conversation` cascades to token_map; a BullMQ job verifies and writes an audit event `map.deleted`.

## Policy engine (gateway)

Per-tenant JSON policy, versioned, stored in Postgres, cached in Redis:

```jsonc
{
  "version": 3,
  "default_action": "redact",           // redact | block | allow
  "entities": {
    "PERSON": "redact",
    "ORG": "allow",                      // e.g. company names may pass through
    "IBAN": "block"                      // request rejected entirely if found
  },
  "min_confidence": 0.6,
  "allowed_providers": ["azure-openai"],
  "languages": ["de", "en"]
}
```

- "block" means the whole request is rejected with a user-readable reason and an audit event — some data must never go to an LLM even redacted.
- **Tenant custom recognizers** (first-class feature): the policy may define custom entities via two mechanisms, both delivered to the redactor per-request as Presidio ad-hoc recognizers (no redeploy needed):

```jsonc
"custom_entities": [
  {
    "label": "Acme account number",       // display only — never on the wire
    "kind": "pattern",
    "regex": "\\bUK-\\d{2}[a-z]{3}\\b",   // e.g. UK-78dzu
    "context": ["account", "Konto", "Kundennummer"],
    "score": 0.7,
    "action": "redact"                     // redact | block
  },
  {
    "label": "Confidential projects",
    "kind": "deny_list",
    "values": ["Project Kranich", "Müller Holding GmbH"],
    "action": "block"
  }
]
```

  - Validate tenant regexes on save: compile check, reject catastrophic-backtracking-prone patterns (use RE2-compatible subset or a regex linter), enforce max pattern length, and execute all custom patterns with a per-request time budget in the redactor. A tenant must not be able to DoS the redaction service with a pathological regex.
  - All custom entities map to placeholder type CUSTOM on the wire (see Placeholder grammar).
  - Admin console gets a "Custom entities" screen: define label/regex/context/action, with live testing against sample text.
- Admin console (in apps/web) provides a policy editor with a live "test your policy" textarea calling `/v1/analyze`.

## Audit log

Append-only table `audit_events(tenant_id, event_type, actor, conversation_id?, payload jsonb, created_at)`. Payload NEVER contains raw PII — entity types, counts, placeholders, policy version, provider, latency, and unredactor stats (replaced count, unknown placeholders) only. Event types at minimum: `request.redacted`, `request.blocked`, `response.unredacted`, `map.deleted`, `policy.updated`, `auth.login`, `apikey.created`. CSV/JSON export endpoint for DPOs. Nightly BullMQ job rolls up per-tenant stats for the dashboard.

## Gateway API surface

**Surface strategy:** Product B exposes multiple inbound API surfaces so customers keep their existing SDKs ("change one base URL"). All surfaces translate into ONE canonical internal request model; redaction, policy, vault, and audit operate ONLY on the canonical form; provider adapters translate canonical → provider format (hub-and-spoke — never N×M direct surface-to-provider translations). Build order: OpenAI Chat Completions (M6) → Anthropic Messages + OpenAI Responses (M9). When translating streams, preserve tool-call IDs and indexes exactly — this is the known-fiddly part.

```
# Product B surfaces
POST /v1/chat/completions        # OpenAI Chat Completions compatible (M6), streaming + non-streaming
GET  /v1/models
POST /v1/messages                # Anthropic Messages compatible (M9)
POST /v1/responses               # OpenAI Responses compatible (M9)

# Product A (internal API for the chat UI)
POST /api/conversations
POST /api/conversations/:id/messages     # SSE response to the browser
GET  /api/conversations/:id
DELETE /api/conversations/:id

# Admin
GET/PUT /api/admin/policy
GET  /api/admin/audit?from=&to=&type=
POST /api/admin/apikeys
```

**OpenAI Responses surface rules (M9):**
- STATELESS ONLY in v1: force `store: false` on outbound provider calls; reject inbound requests using `previous_response_id` or Conversations with a clear error ("this gateway requires full-context requests"). Server-side state at the provider breaks conversation→token-map association and weakens the GDPR posture. Gateway-tracked stateful chaining is future work behind an ADR.
- Provider-hosted built-in tools (web_search, file_search, code_interpreter) execute on REDACTED text: per-tenant policy-gated, default OFF, limitation documented.
- Streaming uses semantic events (`response.output_text.delta`, typed output items): implement as a third SSE adapter over the same StreamUnredactor core.

Request lifecycle (both products): auth → resolve tenant + policy → load conversation map (Redis→Postgres) → call redactor (fail closed) → policy verdict (block?) → forward redacted request to provider → pipe response through un-redactor → persist new map entries + audit event → return.

## Product A chat UI requirements

- Familiar ChatGPT-like layout: sidebar with conversations, streaming responses, markdown + code rendering, stop-generation button.

### Design system (applies to chat UI AND admin console)

- **Aesthetic: hyper-modern, minimal, glassmorphism.** Translucent surfaces (`backdrop-filter: blur`) for the sidebar, message composer, modals, and cards; subtle borders (1px, low-alpha white/black); soft layered shadows; generous whitespace; rounded corners (lg/xl); restrained accent color (one primary hue). No visual clutter — every element earns its place.
- **Light AND dark mode from day one.** Implement with CSS variables + `next-themes` (class strategy): design tokens defined once (`--surface-glass`, `--border-glass`, `--text-primary`, etc.), both themes derive from tokens. Default to `prefers-color-scheme`, with a manual toggle persisted per user. Glass surfaces must be tuned PER THEME (light glass: white/60 + blur; dark glass: near-black/50 + blur) — never a single rgba for both.
- **Glassmorphism guardrails (non-negotiable):**
  - Text on glass surfaces must meet WCAG AA contrast (4.5:1) in BOTH themes — verify with automated contrast checks in CI (e.g. axe in Playwright).
  - `backdrop-filter` is expensive: apply it to a small number of large surfaces (sidebar, composer, modals), NEVER per-message or per-list-item. Provide a solid-color fallback via `@supports`.
  - Respect `prefers-reduced-motion` and `prefers-reduced-transparency`: reduce/disable blur and animations accordingly.
- Micro-interactions: subtle transitions (150–250 ms ease) on hover/focus/theme switch; streaming text should render smoothly without layout shift.
- All shadcn/ui components restyled through the token layer — do not ship default shadcn look.
- A subtle per-message "shield" indicator showing how many entities were protected; expandable to list entity TYPES (never values in the UI of other users; the author may reveal values client-side from their own input only — the UI never fetches decrypted values from the server).
- Admin console: policy editor, audit log viewer with filters + export, API key management, usage dashboard.
- i18n scaffolding from day one (de + en).

## Development workflow

- `docker compose up` boots the full stack; `pnpm dev` runs web + gateway with hot reload against the compose services.
- Conventional commits. CI must run: typecheck, lint, Vitest, pytest, the cross-language placeholder-grammar test, and the E2E happy path (send a message containing a German name + IBAN → assert provider mock received no raw PII → assert user saw the real values back).
- Every schema change is a numbered SQL migration. Never edit an applied migration.
- **Dependency management:** Node workspaces use pnpm with a single root `pnpm-lock.yaml`. The Python redactor uses `pyproject.toml` + `uv` with a committed `uv.lock` (exact, reproducible builds — no loose `requirements.txt`). Pin Presidio to an exact version (must include the German recognizer set). spaCy models (`de_core_news_lg`, `en_core_web_lg`) are pinned to exact versions and installed INTO the redactor Docker image at build time — never downloaded at container startup (VPC installs must not require runtime internet access, and startup downloads would break healthchecks). Renovate/dependabot config included; lockfile updates are ordinary PRs subject to full CI.
- Secrets only via env vars; `.env.example` kept current; no secrets in code or compose files.

## Load testing & system sizing

Location: `tests/load/` (k6, scripts in TypeScript). First-class deliverables, not ad-hoc scripts.

**Scenarios:**
1. `chat-users.ts` — simulates **50 concurrent chat users**: login, create conversation, send messages containing German PII (names, IBANs, Steuer-IDs from a fixture pool), consume the SSE stream to completion, think-time 5–15 s, sessions of 10–20 messages. Ramp 0→50 over 2 min, hold 10 min, ramp down.
2. `proxy-throughput.ts` — Product B: sustained req/s against `/v1/chat/completions`, streaming + non-streaming mixes, payloads 0.5/2/8 KB.
3. `redactor-bench.ts` — isolates the Python service: p50/p95/p99 latency vs text size and entity density, with and without tenant custom recognizers.
4. `soak.ts` — 20 users for 2 h; assert no memory growth in gateway/redactor containers, no Redis key leaks, token_map growth matches expectation.

**All load tests run against the provider MOCK** — a container streaming realistic SSE with configurable latency, which deliberately splits placeholders across chunks to exercise the stream un-redactor under load. Never load-test against real providers.

**Pass thresholds (CI gates — fail the run if violated):**
- Chat send→first-token p95 < 800 ms (excluding the mock's simulated provider latency).
- Redaction p95 < 150 ms @ 2 KB; < 400 ms @ 8 KB.
- Proxy overhead p95 < 250 ms non-streaming; added inter-chunk delay from un-redaction p99 < 5 ms.
- Error rate < 0.1%. Zero invariant violations: the mock records every request body; the run fails if ANY raw fixture PII appears in one.

**System sizing:** `tests/load/sizing.ts` runs the chat scenario at stepped user counts (10/25/50/100/200) against the compose stack with fixed per-container resource limits, samples CPU/RAM per service via `docker stats`, and generates `docs/sizing.md` — a capacity table (users → vCPU/RAM per service, recommended replica counts). Note per-worker RAM for the redactor explicitly (spaCy models are memory-heavy, ~1–2 GB/worker) and the users-per-worker ratio. Regenerate per release; this table doubles as the customer VPC deployment guide.

**CI wiring:** shortened 50-user chat run (3 min hold) on every main-branch merge with thresholds as gates; soak + full sizing runs nightly/manual.

## Deployment — one script

Everything runs on Docker; a single script deploys the entire stack:

```
./deploy.sh [dev|prod] [--build] [--seed]
```

The script MUST, in order: (1) validate prerequisites (docker, compose v2, required env vars — fail fast with a readable list of what's missing); (2) generate missing secrets into `.env` on first run (Postgres password, master encryption key, session secret) using openssl rand; (3) build images (`--build` or if missing); (4) start the stack via compose profiles (`dev`: hot reload, exposed ports, mock provider; `prod`: built images, TLS via Caddy reverse proxy with auto-certificates, real provider config, resource limits from docs/sizing.md); (5) wait for Postgres health, run migrations idempotently; (6) optionally seed a demo tenant + policy (`--seed`); (7) verify: hit every service healthcheck and run one smoke request through the full redact→mock→unredact path; print a green summary with URLs or a red diagnosis of which service failed and its last log lines.

- One `docker-compose.yml` with profiles — no divergent compose files per environment.
- Idempotent: re-running `./deploy.sh prod` on an existing install performs a rolling update (pull/build, migrate, restart services one by one), never data loss.
- `./deploy.sh --down` stops the stack; `--destroy` additionally removes volumes after an explicit typed confirmation.
- The same script + compose bundle is the customer VPC install artifact — no step may depend on our infrastructure. Document the full install in `docs/deploy.md` (generated once, kept current).

## What NOT to do

- Do NOT put BullMQ/queues in the live chat/proxy request path.
- Do NOT add a "skip redaction" flag, debug mode that logs raw text, or any bypass — not even behind an env var.
- Do NOT call the vault from the Python service directly (gateway owns vault access).
- Do NOT use localStorage for anything sensitive in the web app.
- Do NOT swap core stack pieces (Fastify, Presidio, Postgres) without writing an ADR first.
- Do NOT mock the fail-closed behavior in tests in a way that lets a redactor outage silently pass text through.

## Build order (milestones)

1. **M1 — Skeleton**: monorepo, docker-compose (postgres/redis), migrations for tenants/conversations/token_map/audit_events with RLS, healthchecks.
2. **M2 — Redaction core**: Python service with Presidio, de+en models, /v1/redact + /v1/analyze, placeholder grammar in shared package + cross-language test, latency benchmark script.
3. **M3 — Gateway + vault**: canonical internal request model (all later surfaces map onto it); request lifecycle end-to-end non-streaming against a provider mock; envelope encryption; map reuse across turns; audit events; fail-closed tests.
4. **M4 — Streaming**: integrate stream-unredactor package, OpenAI SSE end-to-end with real split-placeholder tests, then Anthropic adapter.
5. **M5 — Product A UI**: chat interface with streaming, conversation persistence, shield indicator, OIDC login; full design system (glass tokens, light/dark, contrast checks in CI).
6. **M6 — Product B**: OpenAI-compatible surface, API keys, per-key metering, /v1/models.
7. **M7 — Admin**: policy editor + live test, custom entities screen (pattern + deny-list, live testing, regex safety validation), audit viewer + export, usage dashboard, BullMQ nightly rollups + deletion verification job.
8. **M8 — Load, sizing & deployment**: k6 suite (all four scenarios) with CI-gated thresholds, provider mock with chunk-splitting under load, sizing runs generating docs/sizing.md, deploy.sh with dev/prod profiles + smoke verification + rolling updates, docs/deploy.md.
9. **M9 — Additional API surfaces**: Anthropic Messages surface (content blocks, `content_block_delta` streaming) and OpenAI Responses surface (stateless-only rules, semantic-event SSE adapter, hosted-tools policy gate), both mapped onto the canonical model; cross-surface conformance tests (same canonical request through every surface yields equivalent redaction, audit, and un-redaction results).

Each milestone ends green: all tests pass, compose stack boots clean, and the E2E for that milestone's scope passes.