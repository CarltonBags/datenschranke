# syntax=docker/dockerfile:1
FROM node:22-slim
WORKDIR /app
COPY server.mjs ./
EXPOSE 9090
CMD ["node", "server.mjs"]
HEALTHCHECK --interval=10s --timeout=3s --retries=3 \
  CMD node -e "require('http').get('http://localhost:9090/healthz',r=>process.exit(r.statusCode===200?0:1)).on('error',()=>process.exit(1))"
