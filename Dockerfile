# Stage 1: Install production server deps (needs build tools for better-sqlite3)
FROM node:20-alpine AS prod-deps
WORKDIR /app
RUN apk add --no-cache python3 make g++
COPY server/package*.json ./
RUN npm ci --omit=dev

# Stage 2: Build client
FROM node:20-alpine AS client-builder
WORKDIR /app
COPY client/package*.json client/
RUN cd client && npm ci
COPY client/ client/
RUN cd client && npm run build
# Output lands at /app/server/public (per vite.config outDir)

# Stage 3: Compile server TypeScript
FROM node:20-alpine AS server-builder
WORKDIR /app
RUN apk add --no-cache python3 make g++
COPY server/package*.json server/
RUN cd server && npm ci
COPY server/ server/
RUN cd server && npm run build

# Stage 4: Lean production runner
FROM node:20-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production

RUN apk add --no-cache su-exec && \
    addgroup -g 1001 -S nodejs && adduser -S nodejs -u 1001

COPY --from=prod-deps --chown=nodejs:nodejs /app/node_modules ./node_modules
COPY --from=server-builder --chown=nodejs:nodejs /app/server/dist ./dist
COPY --from=client-builder --chown=nodejs:nodejs /app/server/public ./public

# Data dir is /data (path.join(__dirname='dist/', '../../data') resolves to /data)
RUN mkdir -p /data && chown nodejs:nodejs /data

COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://localhost:3000/api/leaderboard/unlimited || exit 1

ENTRYPOINT ["/entrypoint.sh"]
CMD ["node", "dist/index.js"]
