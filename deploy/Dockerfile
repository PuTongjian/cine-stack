ARG NODE_IMAGE=node:24-bookworm-slim
ARG NGINX_IMAGE=nginx:stable-alpine
FROM ${NODE_IMAGE} AS build
RUN apt-get update \
    && apt-get install -y --no-install-recommends python3 make g++ \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package*.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
COPY packages/crawler-engine/package.json packages/crawler-engine/package.json
COPY packages/contracts/package.json packages/contracts/package.json
# Use bundled Node headers and compile native modules without downloading GitHub prebuilds.
RUN npm_config_build_from_source=true npm_config_nodedir=/usr/local npm ci
COPY . .
RUN npm run db:generate && npm run build

FROM ${NODE_IMAGE} AS api
WORKDIR /app
COPY --from=build /app /app
ENV HOST=0.0.0.0 DATA_DIR=/app/data PORT=3001
EXPOSE 3001
CMD ["sh", "-c", "node scripts/migrate.mjs && node apps/api/dist/main.js"]

FROM ${NGINX_IMAGE} AS web
COPY --from=build /app/apps/web/dist /usr/share/nginx/html
COPY deploy/nginx.conf /etc/nginx/conf.d/default.conf
