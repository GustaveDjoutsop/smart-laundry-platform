# Secrets Management — Doppler

**Status:** Proposed/Accepted (2026-06-13), part of Phase 0 (W3).
**Decision:** Use [Doppler](https://www.doppler.com/) as the central secret store for
`PaymentManagementService`, `MachineStateService`, and `spring-bot-manager-only`.
Free tier is sufficient at current scale (solo dev, 3 services).

This doc lists what to set up (manual, one-time, in the Doppler dashboard + GitHub +
the prod cluster) and how each environment (local dev, CI, prod K8s) consumes secrets
afterwards. **No code changes are required for CI** beyond what's already in
`pull-request.yml` — Doppler's GitHub sync writes directly into GitHub Actions repo
secrets, which the workflows already reference via `${{ secrets.* }}`.

---

## 1. Doppler project layout

One Doppler project per repo, each with three configs (`dev`, `ci`, `prd`):

| Doppler project | Repo |
|---|---|
| `payment-management-service` | `PaymentManagementService` |
| `machine-state-service` | `MachineStateService` |
| `spring-bot-manager` | `spring-bot-manager-only` |

- `dev` — local development values (can mirror current `application-local.yaml` /
  `.env` defaults).
- `ci` — values consumed by GitHub Actions (PR pipeline, integration tests).
- `prd` — production values, consumed by the Kubernetes deployment.

---

## 2. Secrets inventory (as of 2026-06-13)

All currently default to `${VAR:}` (empty) in `application.yml`/`application.yaml` —
**none of these have a real value committed after the P0 stripping commits.** Populate
them in Doppler only with **rotated** values (see `03-MIGRATION-TODO.md` rotation item
— do not re-use the credentials that were ever committed to git history).

### PaymentManagementService (`payment-management-service`)
| Variable | Purpose |
|---|---|
| `POSTGRES_PASSWORD` | `paymentdb` datasource |
| `AUTH0_CLIENT_ID` / `AUTH0_CLIENT_SECRET` | `smartlaundry-m2m` registration — calls MachineStateService `/api/machines/start-cycle` |
| `CAMPAY_APP_KEY` / `CAMPAY_APP_SECRET` / `CAMPAY_WEBHOOK_SECRET` | CamPay mobile money |
| `MTN_SUBSCRIPTION_KEY` / `MTN_API_USER_ID` / `MTN_API_KEY` | MTN MoMo |
| `ORANGE_CLIENT_ID` / `ORANGE_CLIENT_SECRET` / `ORANGE_MERCHANT_KEY` | Orange Money |
| `SWAGGER_CLIENT_ID` / `SWAGGER_CLIENT_SECRET` | Swagger UI OAuth login |
| `AUTH0_DEV_CLIENT_ID` / `AUTH0_DEV_CLIENT_SECRET` (CI config only) | Robot Framework integration tests — Auth0 dev-tenant M2M client used to obtain test Bearer tokens |

### MachineStateService (`machine-state-service`)
| Variable | Purpose |
|---|---|
| `SPRING_DATASOURCE_PASSWORD` | `machinedb` datasource |
| `MQTT_PASSWORD` | MQTT broker auth |
| `EQLINK_SECRET_KEY` | EQLink MD5 signature key |
| `SWAGGER_CLIENT_ID` / `SWAGGER_CLIENT_SECRET` | Swagger UI OAuth login |
| `AUTH0_DEV_CLIENT_ID` / `AUTH0_DEV_CLIENT_SECRET` (CI config only) | Robot Framework integration tests |

### spring-bot-manager-only (`spring-bot-manager`)
| Variable | Purpose |
|---|---|
| `DATABASE_PASSWORD` | `smartbot` datasource |
| `AUTH0_CLIENT_SECRET` (client-id is non-secret) | `smartlaundry-m2m` registration — calls PaymentManagementService/MachineStateService |
| `WHATSAPP_APP_SECRET` / `WHATSAPP_ACCESS_TOKEN_LAUNDRY` (+ per-tenant tokens, e.g. `WHATSAPP_ACCESS_TOKEN_THOMASNETWORK`) | WhatsApp Cloud API |
| `CAMPAY_TOKEN` / `CAMPAY_WEBHOOK_SECRET` | CamPay webhook verification |
| `MQTT_PASSWORD` | MQTT broker auth (fallback path) |
| `SWAGGER_CLIENT_ID` / `SWAGGER_CLIENT_SECRET` | Swagger UI OAuth login |
| `ADMIN_PASSWORD` | Admin API basic auth |
| `ENCRYPTION_MASTER_KEY` | At-rest encryption |
| `AUTH0_DEV_CLIENT_ID` / `AUTH0_DEV_CLIENT_SECRET` (CI config only) | Robot Framework integration tests |

### CI/CD-only secrets (not app config — already GitHub Actions secrets, can stay there or move into a shared Doppler "infra" project later)
- `DO_REGISTRY_NAME`, `DO_REGISTRY_TOKEN` — DigitalOcean Container Registry
- `PROD_KUBECONFIG` / staging equivalent — cluster access for Helm deploys
- `SONAR_TOKEN`, `SONAR_PROJECT_KEY`, `SONAR_ORGANIZATION` — SonarCloud

---

## 3. Local development

1. Install the [Doppler CLI](https://docs.doppler.com/docs/install-cli).
2. `doppler login`
3. In each repo: `doppler setup` → select the matching project, config = `dev`.
4. Run the app via Doppler instead of `application-local.yaml` plaintext values:
   ```bash
   doppler run -- mvn spring-boot:run
   ```
   or wrap the IDE run configuration's command with `doppler run --`.
5. Once `dev` configs are populated, remove the hardcoded credential defaults from
   `application-local.yaml` (gitignored, but still better not to keep live secrets on
   disk) — replace with `${VAR:}` placeholders matching `application.yaml`.

---

## 4. CI (GitHub Actions)

No workflow changes needed beyond the inline-fallback removals already done in this
branch (`fix/p0-strip-auth0-dev-m2m-secrets`). Setup steps (one-time, per repo):

1. In Doppler: **Integrations → GitHub Actions** → connect the repo → select the `ci`
   config → this writes Doppler's secrets into the repo's **Settings → Secrets and
   variables → Actions** automatically (kept in sync on every change).
2. Populate the `ci` config with the `AUTH0_DEV_CLIENT_ID` / `AUTH0_DEV_CLIENT_SECRET`
   values (rotated dev-tenant M2M client — **do not reuse the value that was
   committed in git history**, see rotation item in `03-MIGRATION-TODO.md`).
3. Existing workflow references (`${{ secrets.AUTH0_DEV_CLIENT_ID }}`, etc.) keep
   working unchanged.

---

## 5. Production (Kubernetes / Helm)

1. Install the [Doppler Kubernetes Operator](https://docs.doppler.com/docs/kubernetes-operator)
   in the prod cluster (`bot-manager` namespace and equivalents for Payment/Machine
   once they're containerized similarly).
2. Create a `DopplerSecret` CRD per service pointing at its `prd` config — the
   operator materializes it as a regular `Secret` (e.g. `payment-management-service-secrets`),
   auto-updating on Doppler changes.
3. Reference that `Secret` from the Helm chart via `envFrom`:
   ```yaml
   envFrom:
     - secretRef:
         name: payment-management-service-secrets
   ```
4. Remove any secret values currently passed as `--set` Helm flags or baked into
   `ci/helm-values/*.yaml`.

---

## 6. Rollout order

1. ✅ Strip hardcoded secrets from `application.yml`/`.yaml` (done — see Progress Log
   in `03-MIGRATION-TODO.md`).
2. ✅ Strip the leaked Auth0 dev-tenant M2M credential from the three
   `pull-request.yml` workflows and `variables.robot` files (this branch).
3. 🟡 Create Doppler projects + populate `dev`/`ci`/`prd` configs with **rotated**
   values. (2026-06-13) Projects + `ci` environments created and CLI verified working
   in all 3 repo roots (see `03-MIGRATION-TODO.md`). **Still pending:** actually
   populating each config with the rotated values — run `doppler secrets set KEY=value`
   per repo/config (or use the dashboard) with the real rotated credentials.
4. ⬜ Enable Doppler → GitHub Actions sync for each repo's `ci` config.
5. ⬜ Install the Doppler Kubernetes Operator and migrate prod Helm values.
6. 🟡 Deferred — purge old secrets from git history (BFG/`git filter-repo`). See
   `03-MIGRATION-TODO.md` Phase 0 for the 2026-06-13 scoping note: full rewrite spans
   ~10+ commits per repo across all 3 repos, force-push required on `master`/`develop`,
   breaks all existing clones/PR references. Since rotation (step 3 dependency) is
   done, remaining exposure is hygiene-only — scheduled as a dedicated future session.
