# Build the web app
FROM node:24-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

# Runtime: Node server (API + static files), SQLite database in /data
FROM node:24-alpine
WORKDIR /app
ENV NODE_ENV=production PORT=3000 DB_FILE=/data/board.db STATIC_DIR=/app/dist
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build /app/dist ./dist
COPY server ./server
COPY src/shared.ts ./src/shared.ts
RUN mkdir -p /data && chown node:node /data
USER node
EXPOSE 3000
CMD ["node", "--disable-warning=ExperimentalWarning", "server/index.ts"]
