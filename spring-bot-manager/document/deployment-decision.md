# Deployment Decision: Kubernetes

**Date:** 2025  
**Decision:** Keep Kubernetes as the deployment target.

## Rationale

The project already has a mature Kubernetes deployment setup:
- Full Helm chart (`ci/helm-chart/`) with templates for deployment, service, secrets, and service account
- Environment-specific Helm values for `dev`, `prod`, and `cicd`
- CI/CD workflows (`.github/workflows/`) that build Docker images and deploy to K8s
- Non-root Docker container with health checks

Switching to Heroku would waste this existing infrastructure investment and introduce limitations (e.g., no MQTT support, limited control over scaling).

## What This Means

- **Dockerfile** builds from `bot-app/target/*.jar` (updated for multi-module)
- **Helm values** manage environment-specific configuration (database URLs, Redis, MQTT broker, API keys)
- **Secrets** are managed via Kubernetes Secrets (referenced in `ci/helm-chart/templates/secrets.yaml`)
- **Scaling** is controlled via `replicaCount` in Helm values
- **PostgreSQL and Redis** are external services (not in-cluster) for production

## Removed

- `document/strategic decision.md` — outdated, replaced by this decision and the refactoring gap analysis
