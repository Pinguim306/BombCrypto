# MinerBlast game server — built from the pnpm workspace root.
# Node 22+ is required (the persistence layer uses the built-in node:sqlite).
FROM node:22-slim AS build
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY server/package.json server/package.json
RUN pnpm install --frozen-lockfile --filter @minerblast/server
COPY server server
RUN pnpm --filter @minerblast/server build && \
    pnpm prune --prod

FROM node:22-slim
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/node_modules node_modules
COPY --from=build /app/server/node_modules server/node_modules
COPY --from=build /app/server/dist server/dist
COPY --from=build /app/server/package.json server/package.json
# DATABASE_PATH should point into the mounted volume (e.g. /data/minerblast.db)
EXPOSE 3000
CMD ["node", "server/dist/main.js"]
