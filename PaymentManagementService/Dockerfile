# ── Build stage ──────────────────────────────────────────────────────────────
FROM eclipse-temurin:25-jdk-alpine AS build
WORKDIR /app

# R8: laundry-contracts is resolved from GitHub Packages, which requires auth even
# for read-only downloads. GITHUB_PACKAGES_TOKEN must be set as a Railway service
# variable (a classic GitHub PAT, read:packages scope) — see laundry-contracts/README.md.
# Declared as ARG (not left to the environment) because Dockerfile builds don't
# inherit Railway's runtime variables automatically, unlike Railpack builds.
ARG GITHUB_PACKAGES_TOKEN

COPY pom.xml .
COPY src ./src

# settings.xml is written and removed within this single RUN so the token never
# lands in a committed image layer, and this whole stage is discarded anyway —
# only the runtime stage below is shipped.
RUN apk add --no-cache maven && \
    mkdir -p /root/.m2 && \
    printf '<settings><servers><server><id>github</id><username>x-access-token</username><password>%s</password></server></servers></settings>' "$GITHUB_PACKAGES_TOKEN" > /root/.m2/settings.xml && \
    mvn -B package -DskipTests && \
    rm /root/.m2/settings.xml

# ── Runtime stage ─────────────────────────────────────────────────────────────
FROM eclipse-temurin:25-jre-alpine
WORKDIR /app

RUN addgroup -S appgroup && adduser -S appuser -G appgroup

COPY --from=build /app/target/payment-management-service-*.jar app.jar

USER appuser

EXPOSE 8081

ENTRYPOINT ["java", "-jar", "app.jar"]
