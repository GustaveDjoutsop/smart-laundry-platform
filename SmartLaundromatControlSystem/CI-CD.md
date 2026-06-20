# CI/CD Pipeline Documentation

This document explains the complete Continuous Integration and Continuous Deployment (CI/CD) pipeline for the Smart Laundromat Control System.

## Table of Contents

- [Overview](#overview)
- [GitHub Actions Workflows](#github-actions-workflows)
- [Deployment Environments](#deployment-environments)
- [Setup Instructions](#setup-instructions)
- [Workflow Details](#workflow-details)
- [Best Practices](#best-practices)
- [Troubleshooting](#troubleshooting)

## Overview

Our CI/CD pipeline uses **GitHub Actions** with **Docker** for consistent builds and deployments across all environments.

### Architecture

```
┌─────────────────────────────────────────────────────────┐
│                    Developer Workflow                    │
└─────────────────────────────────────────────────────────┘
                           │
                           ▼
          ┌────────────────────────────────┐
          │  1. Create Feature Branch      │
          │     feature/sl-XXX-name        │
          └────────────────┬───────────────┘
                           │
                           ▼
          ┌────────────────────────────────┐
          │  2. Make Changes & Commit      │
          └────────────────┬───────────────┘
                           │
                           ▼
          ┌────────────────────────────────┐
          │  3. Open Pull Request          │
          │     → Triggers PR Checks       │
          └────────────────┬───────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────┐
│              PR Quality Check Workflow                  │
│  ✓ Run tests (Node 18.x, 20.x)                         │
│  ✓ Build Docker image                                   │
│  ✓ Start services (MongoDB, MQTT, Backend)             │
│  ✓ Run tests in Docker                                  │
│  ✓ Security audit (npm audit)                           │
│  ✓ Validate docker-compose.yml                          │
└─────────────────────────────────────────────────────────┘
                           │
                           ▼
          ┌────────────────────────────────┐
          │  4. Merge to develop           │
          │     → Auto-deploy to TEST      │
          └────────────────┬───────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────┐
│           Deploy to Heroku TEST Workflow                │
│  ✓ Build Docker image                                   │
│  ✓ Deploy to Heroku TEST environment                    │
│  ✓ Set environment variables                            │
│  ✓ Run health checks                                    │
└─────────────────────────────────────────────────────────┘
                           │
                           ▼
          ┌────────────────────────────────┐
          │  5. Manual Trigger             │
          │     → Deploy to STAGE          │
          └────────────────┬───────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────┐
│          Deploy to Heroku STAGE Workflow                │
│  ✓ Require manual confirmation                          │
│  ✓ Run tests before deployment                          │
│  ✓ Build Docker image                                   │
│  ✓ Deploy to Heroku STAGE                               │
│  ✓ Set environment variables                            │
│  ✓ Run health checks                                    │
└─────────────────────────────────────────────────────────┘
                           │
                           ▼
          ┌────────────────────────────────┐
          │  6. Create GitHub Release      │
          │     (v1.0.0 tag)               │
          │     → Deploy to PROD           │
          └────────────────┬───────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────┐
│          Deploy to Heroku PROD Workflow                 │
│  ✓ Validate tag format (vX.Y.Z)                         │
│  ✓ Run production tests                                 │
│  ✓ Build Docker image                                   │
│  ✓ Deploy to Heroku PROD                                │
│  ✓ Set production environment variables                 │
│  ✓ Health checks + smoke tests                          │
│  ✓ Rollback on failure                                  │
└─────────────────────────────────────────────────────────┘
```

## GitHub Actions Workflows

We have 6 main workflows:

| Workflow | Trigger | Purpose | File |
|----------|---------|---------|------|
| **PR Quality Check** | PR opened/updated | Run tests, Docker build, security checks | [pull-request.yml](.github/workflows/pull-request.yml) |
| **Build Docker Image** | Push to develop/main, tags | Build and push to GitHub Container Registry | [docker-build-push.yml](.github/workflows/docker-build-push.yml) |
| **Deploy to TEST** | Merge to develop | Auto-deploy to TEST environment | [deploy-heroku-test.yml](.github/workflows/deploy-heroku-test.yml) |
| **Deploy to STAGE** | Manual trigger | Deploy develop to STAGE | [deploy-heroku-stage.yml](.github/workflows/deploy-heroku-stage.yml) |
| **Deploy to PROD** | GitHub Release or Manual | Deploy tagged version to PROD | [deploy-heroku-prod.yml](.github/workflows/deploy-heroku-prod.yml) |

## Deployment Environments

### TEST Environment
- **URL**: `https://smartlaundry-test.herokuapp.com`
- **Trigger**: Automatic on merge to `develop`
- **Purpose**: Automated testing, integration verification
- **Database**: MongoDB Atlas (test cluster)
- **Data**: Test/mock data only

### STAGE Environment
- **URL**: `https://smartlaundry-stage.herokuapp.com`
- **Trigger**: Manual (requires confirmation)
- **Purpose**: UAT, client demos, pre-production testing
- **Database**: MongoDB Atlas (stage cluster)
- **Data**: Production-like data

### PRODUCTION Environment
- **URL**: `https://smartlaundry.herokuapp.com`
- **Trigger**: GitHub Release creation or manual (requires strong confirmation)
- **Purpose**: Live production system
- **Database**: MongoDB Atlas (production cluster)
- **Data**: Real user data

## Setup Instructions

### 1. GitHub Secrets Configuration

Go to your GitHub repository → Settings → Secrets and variables → Actions → New repository secret

#### Required Secrets for Heroku Deployment:

```bash
# Heroku Credentials
HEROKU_API_KEY=your_heroku_api_key
HEROKU_EMAIL=your_heroku_email

# Heroku App Names
HEROKU_TEST_APP_NAME=smartlaundry-test
HEROKU_STAGE_APP_NAME=smartlaundry-stage
HEROKU_PROD_APP_NAME=smartlaundry

# TEST Environment Variables
TEST_MONGO_URI=mongodb+srv://user:pass@cluster.mongodb.net/laundry_test
TEST_MQTT_BROKER_URL=mqtt://test-broker.your-domain.com
TEST_CAMPAY_KEY=test_campay_key
TEST_CAMPAY_SECRET=test_campay_secret
TEST_WHATSAPP_TOKEN=test_whatsapp_token
TEST_WHATSAPP_PHONE_ID=test_phone_id
TEST_WHATSAPP_VERIFY_TOKEN=test_verify_token

# STAGE Environment Variables
STAGE_MONGO_URI=mongodb+srv://user:pass@cluster.mongodb.net/laundry_stage
STAGE_MQTT_BROKER_URL=mqtt://stage-broker.your-domain.com
STAGE_CAMPAY_KEY=stage_campay_key
STAGE_CAMPAY_SECRET=stage_campay_secret
STAGE_WHATSAPP_TOKEN=stage_whatsapp_token
STAGE_WHATSAPP_PHONE_ID=stage_phone_id
STAGE_WHATSAPP_VERIFY_TOKEN=stage_verify_token

# PRODUCTION Environment Variables
PROD_MONGO_URI=mongodb+srv://user:pass@cluster.mongodb.net/laundry_prod
PROD_MQTT_BROKER_URL=mqtt://broker.your-domain.com
PROD_CAMPAY_KEY=prod_campay_key
PROD_CAMPAY_SECRET=prod_campay_secret
PROD_WHATSAPP_TOKEN=prod_whatsapp_token
PROD_WHATSAPP_PHONE_ID=prod_phone_id
PROD_WHATSAPP_VERIFY_TOKEN=prod_verify_token
PROD_PRICE_SHORT_CYCLE=1000
PROD_PRICE_LONG_CYCLE=2000
PROD_MACHINE_IDS=washer_01,washer_02,washer_03
```

### 2. Get Your Heroku API Key

```bash
# Login to Heroku
heroku login

# Get your API key
heroku authorizations:create -d "GitHub Actions"
```

Copy the token and add it as `HEROKU_API_KEY` in GitHub secrets.

### 3. Create Heroku Apps

```bash
# Create TEST app
heroku create smartlaundry-test

# Create STAGE app
heroku create smartlaundry-stage

# Create PROD app
heroku create smartlaundry
```

### 4. Setup MongoDB Atlas

1. Go to [MongoDB Atlas](https://www.mongodb.com/cloud/atlas)
2. Create three clusters: `laundry_test`, `laundry_stage`, `laundry_prod`
3. Get connection strings and add to GitHub secrets

### 5. Configure GitHub Environments (Optional but Recommended)

Go to Settings → Environments → Create environment

For **STAGE** and **PROD** environments, add:
- **Required reviewers**: Add team members who must approve deployments
- **Wait timer**: Add a delay before deployment starts
- **Deployment branches**: Restrict which branches can deploy

## Workflow Details

### 1. PR Quality Check Workflow

**File**: [.github/workflows/pull-request.yml](.github/workflows/pull-request.yml)

**What it does**:
1. Runs tests on Node.js 18.x and 20.x
2. Auto-formats PR title from branch name (e.g., `feature/sl-003-payment` → "Payment (SL-003)")
3. Builds Docker image with caching
4. Starts all services (MongoDB, MQTT, Backend) using docker-compose
5. Waits for health checks
6. Runs tests inside Docker container
7. Checks for security vulnerabilities
8. Validates docker-compose.yml syntax

**When it runs**: Every PR opened or updated

**Example**:
```bash
# Create feature branch
git checkout -b feature/sl-001-user-auth

# Make changes
git add .
git commit -m "Add user authentication"

# Push and open PR
git push origin feature/sl-001-user-auth
# → Triggers PR Quality Check workflow
```

### 2. Deploy to TEST Workflow

**File**: [.github/workflows/deploy-heroku-test.yml](.github/workflows/deploy-heroku-test.yml)

**What it does**:
1. Builds Docker image
2. Deploys to Heroku TEST app using Docker
3. Sets all environment variables
4. Verifies deployment with health check
5. Shows logs on failure

**When it runs**: Automatic on merge to `develop`

**Example**:
```bash
# After PR is approved and merged to develop
# → Automatically deploys to TEST
```

**Verify deployment**:
```bash
curl https://smartlaundry-test.herokuapp.com/api/health
# Should return: {"status":"UP"}
```

### 3. Deploy to STAGE Workflow

**File**: [.github/workflows/deploy-heroku-stage.yml](.github/workflows/deploy-heroku-stage.yml)

**What it does**:
1. Requires manual confirmation (type "deploy")
2. Runs tests before deployment
3. Builds Docker image
4. Deploys to Heroku STAGE
5. Sets environment variables
6. Verifies deployment
7. Creates deployment summary

**When it runs**: Manual trigger only

**How to deploy**:
1. Go to Actions tab in GitHub
2. Select "Deploy to Heroku STAGE"
3. Click "Run workflow"
4. Type "deploy" in the confirmation field
5. Click "Run workflow"

### 4. Deploy to PRODUCTION Workflow

**File**: [.github/workflows/deploy-heroku-prod.yml](.github/workflows/deploy-heroku-prod.yml)

**What it does**:
1. Validates tag format (must be vX.Y.Z)
2. Requires strong confirmation ("DEPLOY TO PRODUCTION")
3. Runs production tests
4. Builds Docker image
5. Deploys to Heroku PROD
6. Sets production environment variables
7. Waits 30 seconds for stabilization
8. Runs health checks + smoke tests
9. **Automatically rolls back on failure**
10. Creates detailed deployment summary

**When it runs**:
- **Automatic**: When a GitHub Release is published
- **Manual**: Workflow dispatch (requires approval)

**How to deploy (recommended)**:
```bash
# 1. Create and push tag
git tag v1.0.0
git push origin v1.0.0

# 2. Go to GitHub → Releases → Draft a new release
# 3. Select tag: v1.0.0
# 4. Write release notes
# 5. Click "Publish release"
# → Automatically triggers PROD deployment
```

**Manual deployment**:
1. Go to Actions → "Deploy to Heroku PRODUCTION"
2. Click "Run workflow"
3. Enter tag: `v1.0.0`
4. Type "DEPLOY TO PRODUCTION"
5. Click "Run workflow"

### 5. Build and Push Docker Image Workflow

**File**: [.github/workflows/docker-build-push.yml](.github/workflows/docker-build-push.yml)

**What it does**:
1. Builds Docker image for multiple platforms (amd64, arm64)
2. Pushes to GitHub Container Registry (ghcr.io)
3. Creates multiple tags:
   - `latest` (for main branch)
   - `develop` (for develop branch)
   - `v1.0.0` (for version tags)
   - `sha-abc123` (for commit SHAs)
4. Uses GitHub Actions cache for faster builds
5. Creates build attestation for security

**When it runs**:
- Push to develop or main
- Git tags
- Pull requests (build only, no push)

**Pull the image**:
```bash
# Latest version
docker pull ghcr.io/YOUR_USERNAME/laundry-backend:latest

# Specific version
docker pull ghcr.io/YOUR_USERNAME/laundry-backend:v1.0.0

# Run it
docker run -p 3000:3000 ghcr.io/YOUR_USERNAME/laundry-backend:latest
```

## Best Practices

### Branching Strategy

```
main (production)
  └── develop (integration)
        ├── feature/sl-001-user-auth
        ├── feature/sl-002-payment
        ├── hotfix/sl-010-critical-bug
        └── ...
```

**Branch naming convention**:
- Feature: `feature/sl-XXX-description`
- Hotfix: `hotfix/sl-XXX-description`
- Release: `release/vX.Y.Z`

**Workflow**:
1. Create feature branch from `develop`
2. Make changes, commit
3. Open PR to `develop`
4. PR checks run automatically
5. After approval, merge to `develop`
6. TEST deployment happens automatically
7. For STAGE, manually trigger workflow
8. For PROD, create GitHub Release

### Versioning (Semantic Versioning)

Use [Semantic Versioning](https://semver.org/): `vMAJOR.MINOR.PATCH`

- **MAJOR**: Breaking changes (v2.0.0)
- **MINOR**: New features, backward-compatible (v1.1.0)
- **PATCH**: Bug fixes (v1.0.1)

**Examples**:
- `v1.0.0` - Initial production release
- `v1.1.0` - Added new wash cycle option
- `v1.1.1` - Fixed payment webhook bug
- `v2.0.0` - Migrated to new payment API (breaking change)

### Environment Variables Management

**Never commit secrets to git!**

✅ **Do**:
- Use GitHub Secrets for all credentials
- Use different credentials for each environment
- Rotate credentials regularly
- Use `.env.example` as template

❌ **Don't**:
- Commit `.env` files with real credentials
- Use production credentials in test/stage
- Share secrets via chat or email
- Hardcode secrets in code

### Testing Strategy

**PR Level**:
- Unit tests (fast)
- Integration tests (with Docker)
- Security audit
- Docker build validation

**Pre-deployment**:
- All tests must pass
- Docker image must build successfully
- No critical security vulnerabilities

**Post-deployment**:
- Health check endpoint
- Smoke tests
- Monitor logs for errors

### Deployment Safety

**TEST**: Deploy freely, experiment, break things
**STAGE**: Deploy carefully, test thoroughly, involve QA
**PROD**: Deploy cautiously, monitor closely, have rollback ready

**Production deployment checklist**:
- [ ] All tests passing
- [ ] Tested in STAGE
- [ ] Database migrations ready (if any)
- [ ] Team notified
- [ ] Off-peak hours preferred
- [ ] Monitoring dashboard open
- [ ] Rollback plan ready

## Troubleshooting

### Problem: PR checks failing

**Check**:
1. View workflow logs in Actions tab
2. Identify which job failed (test, docker-test, lint)
3. Fix the issue locally
4. Push fix to PR branch

**Common issues**:
- Tests failing: Fix test code
- Docker build failing: Check Dockerfile syntax
- npm audit failing: Update vulnerable packages

```bash
# Fix vulnerabilities
npm audit fix

# Or force fix
npm audit fix --force
```

### Problem: Heroku deployment failing

**Check**:
1. Verify Heroku API key is correct
2. Check Heroku app names in secrets
3. Verify environment variables are set
4. Check Heroku logs

```bash
# View Heroku logs
heroku logs --tail --app smartlaundry-test

# Check app status
heroku ps --app smartlaundry-test

# Check environment variables
heroku config --app smartlaundry-test
```

**Common issues**:
- Invalid MongoDB URI
- Missing environment variables
- Heroku app doesn't exist
- Insufficient Heroku dynos

### Problem: Health check failing after deployment

**Check**:
1. Wait longer (services may need time to start)
2. Check if MongoDB is accessible from Heroku
3. Verify MQTT broker is reachable
4. Check Heroku logs for errors

```bash
# Test health check manually
curl -v https://smartlaundry-test.herokuapp.com/api/health

# Check if app is running
heroku ps --app smartlaundry-test

# Restart app
heroku restart --app smartlaundry-test
```

### Problem: Docker image build failing

**Check**:
1. Validate Dockerfile syntax
2. Check if dependencies can be installed
3. Verify base image is available
4. Check build logs

```bash
# Build locally to test
docker build -t test .

# Check logs
docker logs <container_id>
```

### Problem: Tests failing in Docker but passing locally

**Possible causes**:
- Environment variable differences
- Different Node.js versions
- MongoDB/MQTT not ready (timing issue)
- Port conflicts

**Fix**:
```yaml
# Add wait time in docker-compose
depends_on:
  mongodb:
    condition: service_healthy
```

### Rollback Procedures

#### TEST/STAGE
```bash
# Rollback to previous release
heroku releases:rollback --app smartlaundry-test
```

#### PRODUCTION
```bash
# View releases
heroku releases --app smartlaundry

# Rollback to specific version
heroku rollback v123 --app smartlaundry
```

**Or re-run workflow with previous tag**:
1. Go to Actions → "Deploy to Heroku PRODUCTION"
2. Run workflow with previous working tag

## Monitoring and Alerts

### Heroku Logs

```bash
# View real-time logs
heroku logs --tail --app smartlaundry

# View specific number of lines
heroku logs -n 500 --app smartlaundry

# Search logs
heroku logs --app smartlaundry | grep "ERROR"
```

### GitHub Actions Status

- View workflow runs: Repository → Actions tab
- Check workflow status: Green ✓ = passed, Red ✗ = failed
- Download logs: Workflow run → Download logs

### Recommended Monitoring Tools

For production, consider:
- **Heroku Metrics**: Built-in dyno metrics
- **Sentry**: Error tracking and monitoring
- **LogDNA/Papertrail**: Log aggregation
- **UptimeRobot**: Uptime monitoring
- **New Relic**: APM (Application Performance Monitoring)

## Cost Optimization

### GitHub Actions

- Free for public repositories
- 2,000 minutes/month for private repos (free tier)
- Use caching to reduce build times

### Heroku

- **TEST**: Hobby dyno ($7/month) or Eco ($5/month shared)
- **STAGE**: Hobby dyno ($7/month)
- **PROD**: Standard dynos ($25/month) for better performance

**Optimization tips**:
- Use Eco dynos for non-critical environments
- Scale dynos based on traffic
- Use MongoDB Atlas free tier for TEST
- Share STAGE environment across team

## Additional Resources

- [GitHub Actions Documentation](https://docs.github.com/en/actions)
- [Heroku Docker Deploys](https://devcenter.heroku.com/articles/container-registry-and-runtime)
- [Docker Best Practices](https://docs.docker.com/develop/dev-best-practices/)
- [Semantic Versioning](https://semver.org/)
- [MongoDB Atlas](https://www.mongodb.com/cloud/atlas)

## Support

If you encounter issues:

1. Check this documentation
2. Review workflow logs in GitHub Actions
3. Check Heroku logs
4. Consult team lead or DevOps engineer
5. Open an issue in the repository

---

**Last Updated**: 2025-12-10
**Maintained by**: DevOps Team
