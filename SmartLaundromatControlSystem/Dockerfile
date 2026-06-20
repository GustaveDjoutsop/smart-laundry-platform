# Use official Node.js LTS image
FROM node:20-alpine

# Set working directory
WORKDIR /app

# Copy package files
COPY package*.json ./

# Build argument for environment (default: production)
ARG NODE_ENV=production

# Set NODE_ENV as environment variable for runtime
# This determines which config file to load (config/environments/{NODE_ENV}.yml)
ENV NODE_ENV=${NODE_ENV}

# Install dependencies
# - production/stage: only production dependencies
# - test/development: include devDependencies
RUN if [ "$NODE_ENV" = "production" ] || [ "$NODE_ENV" = "stage" ]; then \
      npm ci --only=production; \
    else \
      npm ci; \
    fi

# Copy application code (includes config/environments/*.yml)
COPY . .

# Expose the port the app runs on
EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD node -e "require('http').get('http://localhost:3000/api/health', (r) => {process.exit(r.statusCode === 200 ? 0 : 1)})"

# Start the application
CMD ["npm", "start"]
