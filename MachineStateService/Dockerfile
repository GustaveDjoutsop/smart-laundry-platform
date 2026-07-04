# ── Stage 1: Build ────────────────────────────────────────────────────────────
FROM maven:3.9-eclipse-temurin-25 AS build

WORKDIR /app

# Copy pom first to cache dependency layer
COPY pom.xml .
RUN mvn dependency:go-offline -q

COPY src ./src
RUN mvn package -DskipTests -q

# ── Stage 2: Run ──────────────────────────────────────────────────────────────
FROM eclipse-temurin:25-jre

WORKDIR /app

COPY --from=build /app/target/machine-state-service-*.jar app.jar

EXPOSE 8082

# Railway (and any container runtime) can override the active profile by setting
# SPRING_PROFILES_ACTIVE. The railway.toml startCommand takes precedence for
# the smart-laundry-dev service; this ENV acts as documentation and fallback.
ENV SPRING_PROFILES_ACTIVE=default

ENTRYPOINT ["java", "-jar", "app.jar"]
