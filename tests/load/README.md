# Load testing & system sizing

k6 scenarios (TypeScript). First-class deliverables — **always run against the
provider MOCK**, never real providers. The mock deliberately splits placeholders
across SSE chunks to exercise the stream un-redactor under load, and records
every request body so a run can assert **zero raw PII** ever reached the
provider.

## Scenarios
| file | what |
|------|------|
| `chat-users.ts` | 50 concurrent chat users, ramp 0→50 (2m), hold 10m, ramp down |
| `proxy-throughput.ts` | Product B sustained req/s, stream+non-stream, 0.5/2/8 KB |
| `redactor-bench.ts` | isolates the Python service; latency vs size + custom recognizers |
| `soak.ts` | 20 users, 2h; memory/Redis/token_map leak checks (via runner) |
| `sizing.ts` | steps 10/25/50/100/200 users, samples `docker stats`, writes `docs/sizing.md` |

## Pass thresholds (CI gates)
- chat send→first-token **p95 < 800 ms** (excludes mock latency)
- redaction **p95 < 150 ms @ 2 KB**, **< 400 ms @ 8 KB**
- proxy overhead **p95 < 250 ms** non-streaming; un-redaction inter-chunk delay **p99 < 5 ms**
- error rate **< 0.1%**; **zero** raw-PII appearances in mock request bodies

## Running
```bash
# boot the stack + seed a tenant/key first:
./deploy.sh dev --build --seed        # prints TENANT_ID + API_KEY

export GATEWAY_URL=http://localhost:8080 REDACTOR_URL=http://localhost:8000
export TENANT_ID=... API_KEY=...

k6 run tests/load/chat-users.ts               # full 10m hold
HOLD=3m k6 run tests/load/chat-users.ts       # CI shortened run
k6 run tests/load/redactor-bench.ts
k6 run tests/load/proxy-throughput.ts
```

## CI wiring
- Shortened 50-user chat run (`HOLD=3m`) on every main-branch merge, thresholds as gates.
- `soak.ts` + full `sizing.ts` run nightly / manual.
