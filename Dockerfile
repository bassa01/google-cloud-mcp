FROM node:24-alpine

ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0

WORKDIR /app

# Copy package files
COPY package.json pnpm-lock.yaml ./

# Install pnpm via Corepack
RUN corepack enable && corepack prepare pnpm@10.21.0 --activate

# Install dependencies
RUN pnpm install --frozen-lockfile

# Copy application code
COPY . .

# Build the application
RUN pnpm build

# Command will be provided by smithery.yaml
CMD ["node", "dist/index.js"]
