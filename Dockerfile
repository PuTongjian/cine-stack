FROM node:24-bookworm-slim AS build
WORKDIR /app
COPY package*.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
COPY packages/crawler-engine/package.json packages/crawler-engine/package.json
COPY packages/contracts/package.json packages/contracts/package.json
RUN npm ci
COPY . .
RUN npm run db:generate && npm run build

FROM node:24-bookworm-slim
WORKDIR /app
COPY --from=build /app /app
ENV HOST=0.0.0.0 DATA_DIR=/app/data PORT=3001
EXPOSE 3001
CMD ["sh", "-c", "node scripts/migrate.mjs && node apps/api/dist/main.js"]
