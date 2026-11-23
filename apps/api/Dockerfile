# syntax=docker/dockerfile:1
# Guidesk api: multi-stage build for ECS Fargate (arm64), run as a non-root user.
FROM node:24-alpine AS build
WORKDIR /repo
RUN npm install -g pnpm@12.18.0
# Dependencies first: this layer is reused until the lockfile or workspace settings change, so a
# code change does not download every package again.
COPY pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm fetch
COPY . .
RUN pnpm install --frozen-lockfile --offline
RUN pnpm --filter @guidesk/api... build
RUN pnpm deploy --filter @guidesk/api --prod /out

FROM node:24-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build --chown=node:node /out ./
USER node
EXPOSE 4000
CMD ["node", "--enable-source-maps", "dist/main.js"]
