FROM node:22-alpine AS build
WORKDIR /repo
RUN corepack enable
COPY . .
RUN pnpm install --frozen-lockfile
RUN pnpm --filter @pulsegrid/shared build && pnpm --filter @pulsegrid/web build

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
ENV HOSTNAME=0.0.0.0
ENV PORT=3000
COPY --from=build /repo/apps/web/.next/standalone .
COPY --from=build /repo/apps/web/.next/static apps/web/.next/static
COPY --from=build /repo/apps/web/public apps/web/public
USER node
EXPOSE 3000
CMD ["node", "apps/web/server.js"]
