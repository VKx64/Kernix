# Build the TypeScript, then ship only the compiled output and runtime deps.
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build /app/dist ./dist

# Never root: this process holds no secrets of its own, but it does hold every
# caller's token in memory for the life of a request.
USER node

EXPOSE 8765

# Hosted by default — one deployment, every workspace, a token per caller.
ENV KERNIX_MCP_HOSTED=1 \
    KERNIX_MCP_HOST=0.0.0.0 \
    KERNIX_MCP_PORT=8765

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:8765/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "dist/index.js", "--http"]
