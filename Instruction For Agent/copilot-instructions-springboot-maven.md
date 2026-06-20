# Copilot instructions: Maven + Spring Boot repository template (CI/CD friendly)

Use this document as a prompt/instructions file when creating a new Spring Boot service repository. It follows the same structure and "contracts" proven in this repo:

- Maven + Spring Boot build producing a single runnable JAR
- Docker image running as non-root
- Helm chart under `ci/helm-chart/` with environment-specific values under `ci/helm-values/`
- Integration tests runnable locally via Docker Compose and in CI via a dedicated test container

---

## 0) Project contract (what we're building)

### Build output

- A single runnable Spring Boot JAR: `target/*.jar`

### Runtime

- HTTP service on `containerPort` (e.g. 8080/8081)
- Health endpoint exposed on a separate port or same port, but must be stable and used by Kubernetes probes
  - Typical: `/actuator/health`

### Deploy

- Docker image built from repo `Dockerfile`
- Helm chart deploys the service into Kubernetes
- CI runs unit tests + optional integration tests and can publish Docker/Helm artifacts

---

## 1) Repository structure (recommended)

Use this layout:

```
.
├─ pom.xml
├─ mvnw / mvnw.cmd
├─ Dockerfile
├─ run.sh
├─ README.md
├─ ci/
│  ├─ helm-chart/
│  │  ├─ Chart.yaml
│  │  ├─ values.yaml
│  │  └─ templates/
│  │     ├─ deployment.yaml
│  │     ├─ service.yaml
│  │     ├─ ingress.yaml (optional)
│  │     ├─ secrets.yaml
│  │     └─ ...
│  └─ helm-values/
│     ├─ dev.yaml
│     ├─ test.yaml
│     ├─ staging.yaml
│     ├─ prod.yaml
│     └─ cicd.yaml
├─ integration-tests/
│  ├─ docker-compose.yml
│  ├─ Dockerfile
│  ├─ requirements.txt
│  ├─ tests/
│  └─ libraries/
└─ src/
   ├─ main/java
   ├─ main/resources
   ├─ test/java
   └─ test/resources
```

### Notes:

- Keep Helm under `ci/helm-chart/` and values under `ci/helm-values/` so release automation can find them.
- Keep integration tests isolated in `integration-tests/` so CI can build/publish a dedicated test image.

---

## 2) Maven (`pom.xml`) requirements

### Baseline

- Use `spring-boot-starter-parent`.
- Pin Java version via Maven properties (e.g. 11 or 17), and keep CI consistent with that.

### Plugins (minimum)

Include at least:

- `spring-boot-maven-plugin` to build a runnable jar
- `maven-surefire-plugin` for unit tests
- `maven-failsafe-plugin` if you have integration tests as Maven ITs
- `jacoco-maven-plugin` if you collect coverage

### Profiles

Create explicit Spring profiles and align them with Helm:

- `local` (developer machine)
- `cicd` (CI integration environment)

Spring activation is usually done via env var:

- `SPRING_PROFILES_ACTIVE=cicd`

### Dependency hygiene

- Prefer dependency management via BOMs (Spring Cloud BOM if used).
- If your org requires CVE overrides, pin vulnerable transitive deps via properties (as done here).

---

## 3) Spring Boot configuration best practices

### `application.properties`

- Keep safe defaults.
- Do not hardcode environment secrets.

### `application-cicd.properties`

- Configure integration env behavior (e.g. LocalStack endpoints, mock URLs, reduced timeouts).

### Actuator

- Expose health endpoint.
- If using a separate management port, make sure Helm probes point to it.

---

## 4) Dockerfile contract

Use a Dockerfile that:

- Copies `target/*.jar` into the image
- Runs as non-root
- Uses an entry script (`run.sh`) so you can easily inject JVM flags

### Example pattern (adapt):

- Base image: `amazoncorretto:11-alpine` (or a JRE/JDK image matching your Java)
- `ARG JAR_FILE=target/*.jar`
- `COPY ${JAR_FILE} app.jar`
- `ENTRYPOINT ["bash", "/run.sh"]`

### `run.sh` should:

- Run `java $JAVA_OPTS -jar app.jar`
- Optionally write logs to `/logs` (if your platform expects it)

---

## 5) Helm chart contract (`ci/helm-chart/`)

### `Chart.yaml`

- Define chart name and version.
- Define dependencies conditionally (e.g. mysql, localstack) using `condition: <dep>.enabled`.

### `values.yaml` (defaults)

Provide sane defaults for local/dev:

- `app`, `group`, `release`
- `resources.requests/limits`
- `healthcheck.port/path/initialDelaySeconds`
- `serviceaccount.*`
- `envs` map for non-secret environment variables
- `secrets` map for secret env vars (wired to a Kubernetes Secret)

### `templates/deployment.yaml`

Follow these rules:

- `image` is parameterized by values (repo + tag)
- inject env vars:
  - `SPRING_PROFILES_ACTIVE` from `.Values.springProfiles`
  - values from `.Values.envs`
  - secrets from `.Values.secrets` via `secretKeyRef`
- define `livenessProbe` + `readinessProbe` using `.Values.healthcheck.*`

### Environment values (`ci/helm-values/*.yaml`)

- Put environment overrides in separate files.
- For CI integration envs, use something like `ci/helm-values/cicd.yaml` to enable dependencies like:
  - `localstack.enabled: true`

---

## 6) Integration tests contract (`integration-tests/`)

### Goal

Integration tests must be runnable:

- locally (developer machine) using Docker Compose
- in CI (Kubernetes/Helm) using a dedicated test container

### Suggested approach

- Use Robot Framework (this repo pattern) OR JUnit/Testcontainers.
- If Robot:
  - Put shared keywords under `integration-tests/libraries/`
  - Put tests under `integration-tests/tests/`
  - Use env vars to override hosts and endpoints (`TM_HOST`, `FSS_HOST`, etc.)

### Docker Compose

- Provide `docker-compose.yml` that spins up:
  - the test container
  - dependencies (localstack/mysql/etc.) if needed for local runs

### Do NOT commit runtime outputs

Add `.gitignore` rules for generated artifacts:

- `integration-tests/results/`
- `integration-tests/test-output/`

---

## 7) GitHub Actions workflow guidance (portable)

Create workflows (or reuse shared workflows) that do these steps:

### Build + unit tests

- Checkout
- Setup Java (version matches `pom.xml`)
- Cache Maven
- `▷ mvn -B -U clean test`

### Build Docker image

- `▷ mvn -B -DskipTests package`
- `docker build -t <image>:<tag> .`
- Push to GHCR/ECR depending on org standard

### Helm lint/package

- `helm lint ci/helm-chart`
- package and publish chart (OCI registry or chart repo)

### Deploy + integration tests

- Deploy chart using the environment values file:
  - `helm upgrade --install ... -f ci/helm-values/cicd.yaml`
- Run integration tests:
  - either as Helm `test` hooks
  - or by running the integration-test Kubernetes job/pod
- Collect and upload test artifacts (Robot output.xml/log.html)

### Required secrets/vars checklist

- Registry credentials (GHCR/ECR)
- Kubernetes credentials (if deploying)

---

## 8) Copy/paste checklist for new repos

Before declaring the template "ready", confirm:

- [ ] `▷ mvn clean test` passes locally
- [ ] `▷ mvn package` produces exactly one runnable jar under `target/`
- [ ] `docker build .` succeeds
- [ ] Service starts in container with `SPRING_PROFILES_ACTIVE=cicd`
- [ ] Health endpoint is reachable and matches Helm probes
- [ ] Helm deployment works with `ci/helm-chart` + one `ci/helm-values/<env>.yaml`
- [ ] Integration tests can run locally with Docker Compose
- [ ] CI workflow runs unit tests and optionally integration tests
- [ ] `.gitignore` excludes generated test outputs (`integration-tests/results`, `integration-tests/test-output`)

---

## 9) Repo-specific customization points

When Copilot generates a new service, it must ask/decide:

### 1. Ports

- app port (service) and management/health port

### 2. Persistence

- mysql/postgres? flyway/liquibase?

### 3. Messaging

- SNS/SQS (LocalStack in CI) vs Kafka vs AMQ

### 4. Security

- OAuth/JWT config
- required issuers

### 5. Helm dependencies

- do we need `mysql`, `localstack`, other service charts in `Chart.yaml`?

If any of these differ, update both:

- Helm env values (`ci/helm-values/*.yaml`)
- Integration test env overrides (`integration-tests/.env` or CI injected env vars)

---

## Notes

- You previously asked to "clean integration-tests by removing all logs added"; I already removed the noisy `Log To Console` debug lines from `integration-tests/libraries/resources-sns-sqs.robot`.
- The new instructions doc is written to be reusable for *any* Spring Boot Maven repo, not just this one.

If you want the instructions to be picked up automatically by GitHub Copilot Chat in a repo, I can also add a `./.github/copilot-instructions.md` variant (GitHub supports that pattern) and keep `copilot-instructions-springboot-maven.md` as the human-readable template.
