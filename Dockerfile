# EventControl server + UI in one container (used by Render, or any Docker host).
# Ubuntu 24.04 for its headless LibreOffice; Node.js from the official nodejs.org build.
FROM ubuntu:24.04

ARG NODE_VERSION=22.22.2

# LibreOffice (PowerPoint → slides), fonts for faithful rendering, OpenSSL for Prisma.
RUN apt-get update \
 && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends \
      libreoffice-impress-nogui fonts-dejavu-core fonts-liberation2 fonts-noto-core \
      openssl ca-certificates curl xz-utils \
 && rm -rf /var/lib/apt/lists/*

RUN ARCH="$(dpkg --print-architecture)"; case "$ARCH" in amd64) ARCH=x64 ;; esac \
 && curl -fsSL "https://nodejs.org/dist/v${NODE_VERSION}/node-v${NODE_VERSION}-linux-${ARCH}.tar.xz" \
    | tar -xJ -C /usr/local --strip-components=1 --exclude CHANGELOG.md --exclude README.md --exclude LICENSE \
 && node --version && npm --version

WORKDIR /app

# Install dependencies first (cached between builds when only source code changes).
COPY package.json package-lock.json ./
COPY client/package.json client/
COPY server/package.json server/
COPY prisma prisma
COPY scripts scripts
RUN npm ci

COPY . .
RUN npm run build

ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=10000 \
    TRUST_PROXY=1 \
    ALLOW_EXTERNAL_OPEN=false \
    MAX_UPLOAD_MB=200 \
    UPLOADS_DIR=/app/uploads

EXPOSE 10000

# Generate the database client for the configured DATABASE_URL (Postgres or SQLite),
# create/upgrade the tables, then start the server.
CMD ["sh", "-c", "node scripts/prisma.mjs generate && npm start"]
