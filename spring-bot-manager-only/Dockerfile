# ── Stage 1: Build with Maven ──
FROM maven:3.9-eclipse-temurin-25 AS build

WORKDIR /workspace

# Copy parent pom and all module poms first (dependency caching)
COPY pom.xml .
COPY bot-core/pom.xml bot-core/pom.xml
COPY bot-payment/pom.xml bot-payment/pom.xml
COPY bot-laundry/pom.xml bot-laundry/pom.xml
COPY bot-pharmacy/pom.xml bot-pharmacy/pom.xml
COPY bot-app/pom.xml bot-app/pom.xml

# Download dependencies (cached unless pom.xml changes)
RUN mvn dependency:go-offline -B

# Copy source code
COPY . .

# Build the application
RUN mvn package -DskipTests -B

# ── Stage 2: Runtime ──
FROM eclipse-temurin:25-jre-alpine

# Create non-root user
RUN addgroup -S appgroup && adduser -S appuser -G appgroup

# Set working directory
WORKDIR /app

# Copy application files from build stage
COPY --from=build /workspace/bot-app/target/*.jar app.jar
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
