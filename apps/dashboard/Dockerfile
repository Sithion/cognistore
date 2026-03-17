# Stage 1: Build
FROM node:20-alpine AS build
RUN corepack enable && corepack prepare pnpm@9.15.0 --activate
WORKDIR /app

# Copy workspace config
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml turbo.json ./

# Copy all package.json files for dependency resolution
COPY packages/shared/package.json packages/shared/
COPY packages/core/package.json packages/core/
COPY packages/embeddings/package.json packages/embeddings/
COPY packages/sdk/package.json packages/sdk/
COPY apps/dashboard/package.json apps/dashboard/

# Install dependencies
RUN pnpm install --frozen-lockfile

# Copy source code
COPY packages/ packages/
COPY apps/dashboard/ apps/dashboard/
COPY tsconfig.json ./

# Build everything (dashboard depends on sdk -> core -> shared)
RUN pnpm turbo build --filter=@ai-knowledge/dashboard

# Stage 2: Runtime
FROM node:20-alpine AS runtime
RUN corepack enable && corepack prepare pnpm@9.15.0 --activate
WORKDIR /app

# Copy workspace config for pnpm
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY packages/shared/package.json packages/shared/
COPY packages/core/package.json packages/core/
COPY packages/embeddings/package.json packages/embeddings/
COPY packages/sdk/package.json packages/sdk/
COPY apps/dashboard/package.json apps/dashboard/

# Install production dependencies only
RUN pnpm install --frozen-lockfile --prod

# Copy built outputs from build stage
COPY --from=build /app/packages/shared/dist/ packages/shared/dist/
COPY --from=build /app/packages/core/dist/ packages/core/dist/
COPY --from=build /app/packages/embeddings/dist/ packages/embeddings/dist/
COPY --from=build /app/packages/sdk/dist/ packages/sdk/dist/
COPY --from=build /app/apps/dashboard/dist/ apps/dashboard/dist/
COPY --from=build /app/apps/dashboard/dist-server/ apps/dashboard/dist-server/

ENV NODE_ENV=production
ENV DASHBOARD_PORT=3847
EXPOSE 3847

CMD ["node", "apps/dashboard/dist-server/index.js"]
