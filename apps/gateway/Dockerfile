# syntax=docker/dockerfile:1
FROM node:22-slim AS base
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH
RUN corepack enable

WORKDIR /repo

# Copy workspace manifests first for cached installs.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY packages/shared/package.json packages/shared/
COPY packages/stream-unredactor/package.json packages/stream-unredactor/
COPY apps/gateway/package.json apps/gateway/
COPY infra/migrations/package.json infra/migrations/

RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --frozen-lockfile

# Source (gateway runs from TS via tsx — no build step).
COPY packages ./packages
COPY apps/gateway ./apps/gateway
COPY infra ./infra

WORKDIR /repo/apps/gateway
EXPOSE 8080
CMD ["pnpm", "start"]

HEALTHCHECK --interval=15s --timeout=5s --start-period=30s --retries=5 \
  CMD node -e "require('http').get('http://localhost:8080/healthz',r=>process.exit(r.statusCode===200?0:1)).on('error',()=>process.exit(1))"
