FROM node:22-bookworm-slim AS build
WORKDIR /workspace
RUN corepack enable
COPY . .
RUN pnpm install --no-frozen-lockfile && pnpm --filter @dimat/web build
FROM caddy:2-alpine
COPY apps/web/Caddyfile /etc/caddy/Caddyfile
COPY --from=build /workspace/apps/web/dist /srv
EXPOSE 80
