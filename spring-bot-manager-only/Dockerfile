# ── Build stage ──────────────────────────────────────────────────────────────
FROM eclipse-temurin:25-jdk-alpine AS build
WORKDIR /app

COPY pom.xml .
COPY bot-core/  ./bot-core/
COPY bot-payment/ ./bot-payment/
COPY bot-laundry/ ./bot-laundry/
COPY bot-pharmacy/ ./bot-pharmacy/
COPY bot-app/ ./bot-app/

RUN apk add --no-cache maven && \
    mvn -B package -DskipTests

# ── Runtime stage ─────────────────────────────────────────────────────────────
FROM eclipse-temurin:25-jre-alpine
WORKDIR /app

RUN addgroup -S appgroup && adduser -S appuser -G appgroup

COPY --from=build /app/bot-app/target/bot-app-*.jar app.jar
COPY configs ./configs

RUN mkdir -p /logs && chown -R appuser:appgroup /logs /app

USER appuser

EXPOSE 8090

ENTRYPOINT ["java", "-Xms256m", "-Xmx512m", "-XX:+UseG1GC", "-jar", "app.jar"]
