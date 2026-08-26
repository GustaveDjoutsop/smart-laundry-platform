# ── Stage 1: Build ────────────────────────────────────────────────────────────
FROM maven:3.9-eclipse-temurin-25 AS build

WORKDIR /app

# R8: laundry-contracts is resolved from GitHub Packages, which requires auth even
# for read-only downloads. GITHUB_PACKAGES_TOKEN must be set as a Railway service
# variable (a classic GitHub PAT, read:packages scope) — see laundry-contracts/README.md.
ARG GITHUB_PACKAGES_TOKEN

# Copy pom first to cache dependency layer. settings.xml is written and removed
# within each RUN that needs it (not just once at the top) so the token never lands
# in a committed layer even with dependency resolution split across two RUNs for
# Docker layer caching.
COPY pom.xml .
RUN mkdir -p /root/.m2 && \
    printf '<settings><servers><server><id>github</id><username>x-access-token</username><password>%s</password></server></servers></settings>' "$GITHUB_PACKAGES_TOKEN" > /root/.m2/settings.xml && \
    mvn dependency:go-offline -q && \
    rm /root/.m2/settings.xml

COPY src ./src
RUN mkdir -p /root/.m2 && \
    printf '<settings><servers><server><id>github</id><username>x-access-token</username><password>%s</password></server></servers></settings>' "$GITHUB_PACKAGES_TOKEN" > /root/.m2/settings.xml && \
    mvn package -DskipTests -q && \
    rm /root/.m2/settings.xml

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
