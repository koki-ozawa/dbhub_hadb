# This dockerfile adopt a multistage build approach to optimize the final image size.
# The first stage builds the application
# the second stage runs it with only production dependencies.
FROM node:22-alpine AS builder

WORKDIR /app

# Copy package.json and pnpm-lock.yaml
COPY package.json pnpm-lock.yaml ./

# Install pnpm
# corepack is used to manage package managers in Node.js
RUN corepack enable && corepack prepare pnpm@latest --activate

# Install dependencies
RUN pnpm install

# Copy source code to the container
COPY . .

# Build the application
RUN pnpm run build

# Production stage
# multistage build to keep the final image small
FROM node:22-alpine

WORKDIR /app

# Copy only production files from the builder stage
COPY --from=builder /app/package.json /app/pnpm-lock.yaml ./

# Install pnpm
RUN corepack enable && corepack prepare pnpm@latest --activate

# activate pnpm
RUN pnpm pkg set pnpm.onlyBuiltDependencies[0]=better-sqlite3
RUN pnpm add better-sqlite3
RUN node -e 'new require("better-sqlite3")(":memory:")'

# Install production dependencies only
RUN pnpm install --prod

# Copy built application from builder stage
COPY --from=builder /app/dist ./dist

# Expose ports
EXPOSE 8080

# Set environment variables
ENV NODE_ENV=production

# Run the server
ENTRYPOINT ["node", "dist/index.js"]
