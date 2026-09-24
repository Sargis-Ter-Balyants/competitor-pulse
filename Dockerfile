FROM node:24-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY server/package.json server/
COPY web/package.json web/
RUN npm ci
COPY server server
COPY web web
COPY fixtures fixtures
RUN npm run build

FROM node:24-alpine
WORKDIR /app
ENV NODE_ENV=production
ENV STATIC_DIR=/app/web/dist
ENV LISTINGS_PATH=/app/fixtures/listings.json
COPY package.json package-lock.json ./
COPY server/package.json server/
COPY web/package.json web/
RUN npm ci --omit=dev
COPY --from=build /app/server/dist server/dist
COPY --from=build /app/web/dist web/dist
COPY server/migrations server/migrations
COPY fixtures fixtures
EXPOSE 3000
CMD ["node", "server/dist/index.js"]
