# The Enemy Within: a self-contained Next.js server (output: "standalone").
# The database and uploaded media live in DATA_DIR (/data), a persistent volume on the host (see fly.toml).

FROM node:22-bookworm-slim AS deps
WORKDIR /app
# Tools to compile better-sqlite3 if no prebuilt binary matches.
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ && rm -rf /var/lib/apt/lists/*
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/web/package.json apps/web/
RUN pnpm install --frozen-lockfile

FROM node:22-bookworm-slim AS build
WORKDIR /app
RUN corepack enable
COPY --from=deps /app ./
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
# The build must not touch the real data: give it a scratch data folder.
RUN DATA_DIR=/tmp/build-data pnpm --filter @tew/web build

FROM node:22-bookworm-slim AS run
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=8080 HOSTNAME=0.0.0.0 DATA_DIR=/data
# The monorepo's standalone output: the app's server under apps/web, the root's node_modules beside it.
COPY --from=build /app/apps/web/.next/standalone ./
COPY --from=build /app/apps/web/.next/static ./apps/web/.next/static
COPY --from=build /app/apps/web/public ./apps/web/public
EXPOSE 8080
CMD ["node", "apps/web/server.js"]
