# Use official Node.js LTS image
FROM node:20-alpine

# Set working directory
WORKDIR /app

# Copy package files
COPY package*.json ./

# Build argument for environment (default: production)
ARG NODE_ENV=production
ENV NODE_ENV=${NODE_ENV}

# Install dependencies
# - production: only production dependencies
# - anything else: include devDependencies
RUN if [ "$NODE_ENV" = "production" ]; then \
      npm ci --only=production; \
    else \
      npm ci; \
    fi

# Copy application code
COPY . .

# Run as the image's built-in non-root user rather than root
USER node

# Expose the port the app runs on
EXPOSE 3000

# Health check - reads $PORT at check time so this stays correct under
# Railway's dynamically-assigned port, not just the local default of 3000.
# Explicit 'error' handler (e.g. ECONNREFUSED while the server is still
# starting) so the check always exits deterministically instead of letting
# an unhandled error event produce noisy output / an unpredictable exit.
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD node -e "require('http').get('http://localhost:'+(process.env.PORT||3000)+'/api/health', (r) => { r.resume(); process.exit(r.statusCode === 200 ? 0 : 1); }).on('error', () => process.exit(1))"

# Start the application directly (not via `npm start`) so SIGTERM/SIGINT
# reach the Node process straight from the container runtime instead of
# through npm's wrapper process, which does not reliably forward signals.
CMD ["node", "src/server.js"]
