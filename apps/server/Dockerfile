FROM node:22-bookworm-slim
WORKDIR /workspace
RUN corepack enable
COPY . .
RUN pnpm install --no-frozen-lockfile
ENV NODE_ENV=production PORT=3000 DIMAT_DB=/data/dimat.sqlite
VOLUME ["/data"]
EXPOSE 3000
CMD ["pnpm","--filter","@dimat/server","start"]
