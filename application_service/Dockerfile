FROM node:24-bookworm-slim

ENV NODE_ENV=production
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY src ./src
COPY migrations ./migrations
COPY scripts/migrate.js ./scripts/migrate.js

USER node
EXPOSE 3000
CMD ["node", "src/server.js"]
