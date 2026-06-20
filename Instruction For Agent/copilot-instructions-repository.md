# Copilot instructions (repository)

These instructions guide GitHub Copilot Chat when generating code, tests, and CI/CD changes for this repository.

---

## Repository shape and expectations

- Language/runtime: Java (Maven) + Spring Boot.
- Packaging: build produces a single runnable JAR under `target/*.jar`.
- Containerization: Docker image is built from `Dockerfile` and starts via `run.sh`.
- Kubernetes: Helm chart lives in `ci/helm-chart/`, with environment overrides in `ci/helm-values/`.
- Integration tests: live in `integration-tests/` and are runnable locally via Docker Compose.

---

## What Copilot should do by default

When asked to add features or fix bugs:

1. Prefer small, safe changes and keep public APIs stable.
2. Add/adjust unit tests under `src/test/java` for business logic and edge cases.
3. If a change affects runtime config, update the correct Spring profile file (e.g. `application-cicd.properties`).
4. If a change affects deployment behavior, update Helm templates/values in `ci/helm-chart` and `ci/helm-values`.

---

## Maven / Spring Boot conventions

- Use `mvnw` (`mvnw.cmd` on Windows) where possible.
- Keep Java version consistent between `pom.xml`, Docker base image, and CI.
- Use Spring profiles and wire them via `SPRING_PROFILES_ACTIVE` in Helm (`.Values.springProfiles`).
- Keep secrets out of git; route sensitive values through Helm `.Values.secrets`.

---

## Docker conventions

- The image must run as non-root.
- The entrypoint should delegate to `/run.sh`.

---

## Helm conventions

- `ci/helm-chart/templates/deployment.yaml` injects:
  - `SPRING_PROFILES_ACTIVE` from `.Values.springProfiles`
  - environment variables from `.Values.envs`
  - secret environment variables from `.Values.secrets` via `secretKeyRef`
- Liveness/readiness probes use `.Values.healthcheck.*`.

---

## Integration test conventions

- Robot Framework resources and libraries live under `integration-tests/libraries/`.
- Tests live under `integration-tests/tests/`.
- Configuration must be overridable via environment variables (e.g. `TM_HOST`, `FSS_HOST`, `AWS_ENDPOINT_OVERRIDE`).
- Don't add noisy debug logging (`Log To Console`) permanently; keep test output clean.
- Do not commit generated artifacts:
  - `integration-tests/results/`
  - `integration-tests/test-output/`

---

## CI/CD guidance (portable)

When asked to create or update GitHub workflows for a new Spring Boot repo:

- Build + unit tests: `▷ mvn -B -U clean test`
- Package: `▷ mvn -B -DskipTests package`
- Docker build: `docker build .`
- Helm lint: `helm lint ci/helm-chart`
- Integration tests (if enabled): run via the `integration-tests` Docker Compose setup or as a Kubernetes job/Helm test.

---

For a full template of how to create a new Spring Boot Maven repository with this structure, see:

- `copilot-instructions-springboot-maven.md`
