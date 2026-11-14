# syntax=docker/dockerfile:1
# Guidesk api: multi-stage build for ECS Fargate (arm64), run as a non-root user.
FROM node:24-alpine AS build
WORKDIR /repo
RUN npm install -g pnpm@12.18.0
COPY . .
RUN pnpm install --frozen-lockfile
RUN pnpm --filter @guidesk/api... build
RUN pnpm deploy --filter @guidesk/api --prod /out

FROM node:24-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build --chown=node:node /out ./
USER node
EXPOSE 4000
CMD ["node", "--enable-source-maps", "dist/main.js"]
