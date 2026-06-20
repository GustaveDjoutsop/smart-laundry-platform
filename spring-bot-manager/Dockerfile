FROM eclipse-temurin:25-jre-alpine

# Create non-root user
RUN addgroup -S appgroup && adduser -S appuser -G appgroup

# Set working directory
WORKDIR /app

# Copy application files
ARG JAR_FILE=bot-app/target/*.jar
COPY ${JAR_FILE} app.jar
COPY run.sh /run.sh
RUN chmod +x /run.sh

# Create logs directory
RUN mkdir -p /logs && chown -R appuser:appgroup /logs /app

# Switch to non-root user
USER appuser

# Expose ports
EXPOSE 3000 8081

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=60s --retries=3 \
    CMD wget -qO- http://localhost:8081/actuator/health || exit 1

# Run application
ENTRYPOINT ["/bin/sh", "/run.sh"]
