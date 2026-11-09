FROM node:22-alpine AS build
WORKDIR /repo
RUN corepack enable
COPY . .
RUN pnpm install --frozen-lockfile
RUN pnpm --filter @pulsegrid/shared build && pnpm --filter @pulsegrid/api build
RUN pnpm --filter @pulsegrid/api deploy --prod /deploy

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
ENV NODE_EXTRA_CA_CERTS=/etc/ssl/rds-global-bundle.pem
ADD --chmod=644 https://truststore.pki.rds.amazonaws.com/global/global-bundle.pem /etc/ssl/rds-global-bundle.pem
COPY --from=build /deploy .
USER node
EXPOSE 4000
CMD ["node", "dist/main.js"]
