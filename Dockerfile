FROM node:24-alpine AS builder

# Install dependencies needed for native modules (sharp) and enable pnpm
# hadolint ignore=DL3018
RUN apk add --no-cache python3 make g++ && \
    corepack enable

WORKDIR /app

# Copy package files
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./

# Install all dependencies (needed for building)
RUN pnpm install --frozen-lockfile

# Copy source code and build
COPY tsconfig.json ./
COPY src/ ./src/
RUN pnpm run build && NODE_ENV=production pnpm prune --prod

# Production stage
FROM node:24-alpine AS production

# Install sharp dependencies and enable pnpm
# hadolint ignore=DL3018
RUN apk add --no-cache vips-dev && \
    corepack enable

# Create non-root user for security
RUN addgroup -g 1001 -S nodejs && \
    adduser -S picturebot -u 1001

WORKDIR /app

# Copy package files and pre-built node_modules from builder.
# We reuse the builder's node_modules to avoid recompiling native addons
# (e.g. sharp) in an environment without build tools (python3/make/g++).
COPY --chown=picturebot:nodejs package.json pnpm-lock.yaml ./
COPY --chown=picturebot:nodejs --from=builder /app/node_modules ./node_modules

# Copy built application from builder stage
COPY --chown=picturebot:nodejs --from=builder /app/dist ./dist

USER picturebot

CMD ["node", "dist/index.cjs"]
