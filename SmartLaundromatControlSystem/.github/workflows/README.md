# GitHub Actions Workflows

This directory contains all CI/CD workflows for the Smart Laundromat Control System.

## Quick Reference

### Workflows Overview

| Workflow | Trigger | When to Use |
|----------|---------|-------------|
| [PR Quality Check](pull-request.yml) | Automatic on PR | Always runs - validates code quality |
| [Docker Build & Push](docker-build-push.yml) | Push to develop/main, tags | Automatic - builds versioned images |
| [Deploy to TEST](deploy-heroku-test.yml) | Merge to develop | Automatic - instant feedback |
| [Deploy to STAGE](deploy-heroku-stage.yml) | Manual | Before releases - UAT testing |
| [Deploy to PROD](deploy-heroku-prod.yml) | GitHub Release | Production deployment |

## Common Tasks

### I want to... deploy to TEST
**Action**: Merge your PR to `develop`
**Result**: Automatic deployment to TEST environment

### I want to... deploy to STAGE
1. Go to **Actions** tab
2. Select **"Deploy to Heroku STAGE"**
3. Click **"Run workflow"**
4. Type `deploy` to confirm
5. Click **"Run workflow"** button

### I want to... deploy to PRODUCTION
**Recommended approach**:
```bash
# 1. Tag the release
git tag v1.0.0
git push origin v1.0.0

# 2. Create GitHub Release
# Go to Releases → Draft new release → Select tag v1.0.0 → Publish
```
**Result**: Automatic deployment to PROD

**Alternative** (manual):
1. Go to **Actions** tab
2. Select **"Deploy to Heroku PRODUCTION"**
3. Click **"Run workflow"**
4. Enter tag: `v1.0.0`
5. Type `DEPLOY TO PRODUCTION` to confirm
6. Click **"Run workflow"** button

### I want to... rollback a deployment
```bash
# Rollback Heroku deployment
heroku releases:rollback --app smartlaundry

# Or re-deploy previous tag using GitHub Actions
```

### I want to... check deployment status
1. Go to **Actions** tab
2. Check workflow status (✓ green = success, ✗ red = failed)
3. Click on workflow for detailed logs

### I want to... view application logs
```bash
# TEST environment
heroku logs --tail --app smartlaundry-test

# STAGE environment
heroku logs --tail --app smartlaundry-stage

# PRODUCTION environment
heroku logs --tail --app smartlaundry
```

## Secrets Required

Go to **Settings → Secrets and variables → Actions** and add:

### Heroku
- `HEROKU_API_KEY` - Your Heroku API key
- `HEROKU_EMAIL` - Your Heroku email
- `HEROKU_TEST_APP_NAME` - TEST app name (e.g., smartlaundry-test)
- `HEROKU_STAGE_APP_NAME` - STAGE app name (e.g., smartlaundry-stage)
- `HEROKU_PROD_APP_NAME` - PROD app name (e.g., smartlaundry)

### Environment Variables (per environment)
For each environment (TEST, STAGE, PROD), add:
- `{ENV}_MONGO_URI` - MongoDB connection string
- `{ENV}_MQTT_BROKER_URL` - MQTT broker URL
- `{ENV}_CAMPAY_KEY` - Campay API key
- `{ENV}_CAMPAY_SECRET` - Campay API secret
- `{ENV}_WHATSAPP_TOKEN` - WhatsApp access token
- `{ENV}_WHATSAPP_PHONE_ID` - WhatsApp phone ID
- `{ENV}_WHATSAPP_VERIFY_TOKEN` - WhatsApp verify token

Example: `TEST_MONGO_URI`, `STAGE_MONGO_URI`, `PROD_MONGO_URI`

## Workflow Details

### PR Quality Check
**File**: [pull-request.yml](pull-request.yml)

Runs on every PR:
- ✓ Tests on Node.js 18.x and 20.x
- ✓ Docker build and integration tests
- ✓ Security vulnerability scan
- ✓ Auto-format PR title from branch name

### Deploy to TEST
**File**: [deploy-heroku-test.yml](deploy-heroku-test.yml)

Automatic on merge to `develop`:
- ✓ Build Docker image
- ✓ Deploy to Heroku TEST
- ✓ Set environment variables
- ✓ Health check verification

### Deploy to STAGE
**File**: [deploy-heroku-stage.yml](deploy-heroku-stage.yml)

Manual trigger with confirmation:
- ✓ Run tests before deployment
- ✓ Build Docker image
- ✓ Deploy to Heroku STAGE
- ✓ Health check + deployment summary

### Deploy to PROD
**File**: [deploy-heroku-prod.yml](deploy-heroku-prod.yml)

Triggered by GitHub Release:
- ✓ Tag validation (vX.Y.Z format)
- ✓ Production tests
- ✓ Build Docker image
- ✓ Deploy to Heroku PROD
- ✓ Extended health checks + smoke tests
- ✓ **Automatic rollback on failure**

### Docker Build & Push
**File**: [docker-build-push.yml](docker-build-push.yml)

Builds and publishes Docker images:
- ✓ Multi-platform builds (amd64, arm64)
- ✓ Push to GitHub Container Registry
- ✓ Version tagging
- ✓ Build caching for speed

## Troubleshooting

### Workflow Failed
1. Click on the failed workflow
2. Expand the failed step
3. Read error message
4. Fix the issue
5. Re-run workflow or push fix

### Deployment Failed
```bash
# Check Heroku logs
heroku logs --tail --app <app-name>

# Check app status
heroku ps --app <app-name>

# Restart app
heroku restart --app <app-name>

# Rollback
heroku releases:rollback --app <app-name>
```

### Tests Failing
```bash
# Run tests locally
npm test

# Run tests in Docker
docker-compose run --rm backend npm test

# Check test logs
docker-compose logs backend
```

## Best Practices

✅ **Do**:
- Always create PRs for code changes
- Wait for PR checks to pass before merging
- Test in STAGE before deploying to PROD
- Use semantic versioning for releases (vX.Y.Z)
- Monitor deployments for at least 5 minutes
- Write clear commit messages

❌ **Don't**:
- Push directly to develop or main
- Skip PR checks
- Deploy to PROD without testing in STAGE
- Use invalid tag formats
- Ignore failed tests
- Commit secrets or credentials

## Need Help?

- **Full Documentation**: See [CI-CD.md](../../CI-CD.md)
- **Docker Guide**: See [DOCKER.md](../../DOCKER.md)
- **Configuration**: See [CONFIGURATION.md](../../CONFIGURATION.md)
- **API Documentation**: See [API.md](../../API.md)

## Version History

- **v1.0.0** (2025-12-10): Initial CI/CD setup with Docker and Heroku
