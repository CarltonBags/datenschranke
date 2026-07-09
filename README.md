# GDPR AI Gateway

Use LLMs (OpenAI / Anthropic / Azure OpenAI) without exposing personal data.
PII is detected and replaced with placeholders **before** any text leaves the
tenant boundary; the LLM only ever sees redacted text; placeholders are mapped
back to real values on the way back to the user.

- **Product A — Company Chat**: ChatGPT-style web app for employees.
- **Product B — API Proxy**: OpenAI-compatible endpoint (`/v1/chat/completions`) —
  change one base URL and get redaction transparently, including streamed responses.

## Deploy targets
- **Any Linux server / VPS** — `./deploy.sh prod --build --seed` (see `docs/deploy.md`)
- **Coolify** (git-connected) — same compose, no `deploy.sh` needed (see `docs/coolify.md`)

The `docker-compose.yml` is provider-agnostic: a one-shot `migrate` service makes
the stack self-migrating anywhere `docker compose up` runs.

## Quick start (local)

```bash
./deploy.sh dev --build --seed
```

Prints a demo tenant id + API key and verifies the full path with a smoke test
(German name + IBAN → provider mock sees only placeholders → you get real values
back). Then:

```bash
# Product B (change base URL in any OpenAI SDK):
curl http://localhost:8080/v1/chat/completions \
  -H "authorization: Bearer <API_KEY>" -H "content-type: application/json" \
  -d '{"model":"gpt-4o-mini","stream":false,
       "messages":[{"role":"user","content":"Ich bin Anna Schmidt, IBAN DE89 3704 0044 0532 0130 00."}]}'

# Product A chat UI:
open http://localhost:3000
```

## Layout
```
apps/web            Next.js 15 chat UI + admin (glass design system, light/dark)
apps/gateway        Fastify gateway — auth, policy, vault, un-redactor, providers, audit
services/redactor   Python/FastAPI + Presidio + spaCy (de/en) detection
services/provider-mock  OpenAI-compatible mock (splits placeholders across chunks)
packages/shared             placeholder grammar (contract), zod schemas, types
packages/stream-unredactor  SSE hold-back un-redactor (OpenAI + Anthropic adapters)
infra/migrations    numbered SQL migrations (Postgres RLS) + runner
tests/load          k6 scenarios + sizing runner
docs/adr            architecture decision records
```

## Non-negotiable invariants
1. Raw PII never leaves the boundary (LLM, logs, traces, metrics, client).
2. Token map encrypted at rest (AES-256-GCM envelope) + tenant-scoped via Postgres RLS.
3. Placeholder consistency per conversation.
4. Every PII-touching request emits an audit event.
5. **Fail closed** — redactor down ⇒ nothing is forwarded.
6. Deletion cascades to the token map (GDPR Art. 17).

## Status of this build
Implemented and unit-verified: the placeholder grammar + cross-language contract,
the stream un-redactor (split/back-to-back/unknown/tool-call cases), the redactor
policy + numbering/reuse engine, envelope encryption + the cross-service reuse-hash
contract, the full gateway request lifecycle (fail-closed), RLS migrations, compose
stack, `deploy.sh` with smoke verification, and the chat UI.

See `docs/deploy.md` for the full install. Milestones M7 admin UI screens and the
M9 Anthropic/Responses inbound surfaces are scaffolded at the gateway/redactor
level (canonical model, Anthropic SSE adapter, custom-entity engine) with UI and
surface routes as the next increment.
```
pnpm -r test    # TS unit tests
pnpm -r typecheck
cd services/redactor && pytest   # Python (Presidio tests auto-skip if not installed)
```
