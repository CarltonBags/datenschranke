# ADR-0002: The gateway and shared packages run from TypeScript source via tsx

## Status
Accepted.

## Context
The gateway imports two workspace packages (`@gdpr/shared`,
`@gdpr/stream-unredactor`) whose entry points are `.ts` source. A conventional
`tsc` emit-to-`dist` build across the workspace introduces a build-order graph
(shared → stream-unredactor → gateway) and dual ESM/`.js` extension bookkeeping.

## Decision
The gateway process runs directly from TypeScript via `tsx` in both dev and
prod. `tsc` is used for typechecking only (`--noEmit`). Workspace packages
expose their `src/*.ts` via `exports`.

## Consequences
- No cross-package emit/build ordering; `pnpm start` = `tsx src/index.ts`.
- One-time transpile cost at boot (negligible for a long-running service).
- The Docker image copies source + installs deps; there is no compile stage.
- The **frontend** (`apps/web`) is unaffected — Next.js has its own build and
  typechecks during `next build`.
- Revisit if we ever need AOT compilation or to drop the `tsx` dependency.
