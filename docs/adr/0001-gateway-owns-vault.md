# ADR-0001: The gateway owns all vault access; the redactor is stateless

## Status
Accepted.

## Context
The redactor must reuse an existing placeholder when it re-encounters an entity
already mapped in a conversation (invariant #3). Two designs were possible:
(a) the Python redactor queries the Postgres vault directly, or (b) the gateway
owns all vault access and passes the redactor what it needs per request.

## Decision
The gateway owns **all** vault access. The redactor is stateless with respect to
the map. Per request the gateway sends `existing_entities: [{value_hash,
placeholder, type}]`, where `value_hash` is `sha256("TYPE:<normalized value>")`
(a content hash, NOT the encrypted-storage HMAC). The redactor recomputes the
same hash for each detected entity and reuses the matching placeholder; new
entities are numbered continuing from the max existing index per type.

## Consequences
- One component (gateway) touches encrypted PII → smaller audit surface for
  invariant #2. The Python service never connects to Postgres.
- The reuse hash (`match_hash`) and the vault's storage HMAC (`value_hash`,
  keyed by the tenant DEK) are deliberately different hashes with different
  purposes. Both are documented where computed
  (`apps/gateway/src/crypto/matchhash.ts`, `.../envelope.ts`,
  `services/redactor/app/redactor.py`). A cross-service test locks `match_hash`
  identical across TS and Python.
- The redactor scales horizontally with no shared state.
