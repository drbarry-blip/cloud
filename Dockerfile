# Production image for the web app (Google Cloud Run or any container host).
# Build from the repo root:  docker build -t clinic-web .

FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages/core/package.json packages/core/
COPY apps/web/package.json apps/web/
RUN npm ci

FROM node:22-alpine AS build
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build -w apps/web

FROM node:22-alpine AS run
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=8080 \
    HOSTNAME=0.0.0.0 \
    PLAYBOOK_DIR=/app/playbook
RUN addgroup -S app && adduser -S app -G app
# Next.js "standalone" output: a minimal server plus only the files it needs.
COPY --from=build --chown=app:app /app/apps/web/.next/standalone ./
COPY --from=build --chown=app:app /app/apps/web/.next/static ./apps/web/.next/static
# The playbook is read at runtime; migrations run as a separate one-off command.
COPY --from=build --chown=app:app /app/playbook ./playbook
COPY --from=build --chown=app:app /app/apps/web/migrations ./apps/web/migrations
COPY --from=build --chown=app:app /app/apps/web/scripts ./apps/web/scripts
USER app
EXPOSE 8080
CMD ["node", "apps/web/server.js"]
