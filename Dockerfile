# syntax=docker/dockerfile:1

FROM node:20-bookworm-slim AS base
WORKDIR /app

FROM base AS build
ENV NODE_ENV=development

COPY package.json package-lock.json tsconfig.base.json ./
COPY apps/service/package.json apps/service/package.json
COPY packages/data-schema/package.json packages/data-schema/package.json

RUN npm ci

COPY apps/service apps/service
COPY packages/data-schema packages/data-schema

RUN npm run build --workspace @education-researcher/data-schema \
  && npm run build --workspace @education-researcher/service \
  && npm prune --omit=dev

FROM base AS runtime
ENV NODE_ENV=production
ENV SERVICE_HOST=0.0.0.0
ENV PORT=4000

COPY --from=build /app/package.json /app/package-lock.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/apps/service/package.json ./apps/service/package.json
COPY --from=build /app/apps/service/dist ./apps/service/dist
COPY --from=build /app/packages/data-schema/package.json ./packages/data-schema/package.json
COPY --from=build /app/packages/data-schema/dist ./packages/data-schema/dist

RUN mkdir -p /tmp/education-researcher/interview-audio \
  && chown -R node:node /tmp/education-researcher

ENV INTERVIEW_AUDIO_STORAGE_DIR=/tmp/education-researcher/interview-audio

USER node

EXPOSE 4000

HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:' + (process.env.PORT || process.env.SERVICE_PORT || '4000') + '/health').then((response) => process.exit(response.ok ? 0 : 1)).catch(() => process.exit(1))"

CMD ["npm", "run", "start", "--workspace", "@education-researcher/service"]
