# Complete Setup Guide

This guide will help you set up the entire Smart Laundromat Control System from scratch, including local development, Docker, and CI/CD pipelines.

## Table of Contents

1. [Prerequisites](#prerequisites)
2. [Local Development Setup](#local-development-setup)
3. [Docker Setup](#docker-setup)
4. [CI/CD Setup](#cicd-setup)
5. [Production Deployment](#production-deployment)
6. [Next Steps](#next-steps)

## Prerequisites

### Required Software

- [Git](https://git-scm.com/)
- [Node.js 18.x or 20.x](https://nodejs.org/)
- [Docker Desktop](https://www.docker.com/products/docker-desktop/)
- [ngrok](https://ngrok.com/) (for webhook testing)
- A code editor (VS Code recommended)

### Required Accounts

- GitHub account
- Heroku account (for deployment)
- MongoDB Atlas account (for production database)
- Meta Developer account (for WhatsApp API)
- Campay account (for payment processing)

## Local Development Setup

### Step 1: Clone the Repository

```bash
git clone https://github.com/YOUR_USERNAME/SmartLaundromatControlSystem.git
cd SmartLaundromatControlSystem
```

### Step 2: Install Dependencies

```bash
npm install
```

### Step 3: Configure Environment Variables

```bash
# Copy the example file
cp .env.example .env
```

Edit `.env` and fill in your credentials:

```bash
NODE_ENV=development
PORT=3000
MONGO_URI=mongodb://localhost:27017/laundry_db
MQTT_BROKER_URL=mqtt://test.mosquitto.org

# Get these from Meta Developer Dashboard
WHATSAPP_TOKEN=your_whatsapp_token
WHATSAPP_PHONE_ID=your_phone_id
WHATSAPP_VERIFY_TOKEN=your_verify_token

# Get these from Campay Dashboard
CAMPAY_APP_KEY=your_campay_key
CAMPAY_APP_SECRET=your_campay_secret

# Business logic
PRICE_SHORT_CYCLE=1000
PRICE_LONG_CYCLE=2000
MACHINE_IDS=washer_01,washer_02
```

### Step 4: Run the Application

**Option A: Without Docker (Manual)**
```bash
# Ensure MongoDB is running locally
# Then start the server
npm run dev
```

**Option B: With Docker (Recommended)**
```bash
# Start all services (MongoDB, MQTT, Backend)
docker-compose up
```

### Step 5: Test the API

```bash
# Health check
curl http://localhost:3000/api/health

# Should return: {"status":"UP"}
```

### Step 6: Set Up WhatsApp Webhooks with ngrok

**Terminal 1** (Docker):
```bash
docker-compose up
```

**Terminal 2** (ngrok):
```bash
ngrok http 3000
```

Copy the ngrok URL (e.g., `https://abc123.ngrok.io`)

**Configure Meta Webhook**:
1. Go to Meta Developer Dashboard
2. Select your app → WhatsApp → Configuration
3. Click "Edit" on Callback URL
4. Enter: `https://abc123.ngrok.io/api/webhook/whatsapp`
5. Enter your `WHATSAPP_VERIFY_TOKEN`
6. Click "Verify and Save"

### Step 7: Test WhatsApp Bot

Send "Hi" to your WhatsApp test number. You should receive an interactive menu!

## Docker Setup

### What Docker Provides

✅ MongoDB database (no manual installation needed)
✅ MQTT broker (Mosquitto)
✅ Node.js backend with hot-reload
✅ Persistent data volumes
✅ Isolated networking

### Docker Commands

```bash
# Start all services
docker-compose up

# Start in background
docker-compose up -d

# Stop all services
docker-compose down

# View logs
docker-compose logs -f

# Rebuild after changes
docker-compose up --build

# Remove all data (including database!)
docker-compose down -v
```

### Docker with ngrok

Docker and ngrok work perfectly together:

```
WhatsApp → ngrok → localhost:3000 → Docker Container
```

No special configuration needed!

For complete Docker documentation, see [DOCKER.md](DOCKER.md).

## CI/CD Setup

### GitHub Actions Workflows

We have 5 main workflows:

1. **PR Quality Check** - Runs on every PR
2. **Deploy to TEST** - Auto-deploys on merge to develop
3. **Deploy to STAGE** - Manual trigger
4. **Deploy to PROD** - Triggered by GitHub Release
5. **Build Docker Image** - Builds and publishes images

### Step 1: Configure GitHub Secrets

Go to your GitHub repository → Settings → Secrets and variables → Actions

#### Heroku Credentials

```bash
# Get your Heroku API key
heroku login
heroku authorizations:create -d "GitHub Actions"
```

Add these secrets:
- `HEROKU_API_KEY` - Your Heroku API key
- `HEROKU_EMAIL` - Your Heroku email

#### Heroku App Names

Create Heroku apps:
```bash
heroku create smartlaundry-test
heroku create smartlaundry-stage
heroku create smartlaundry
```

Add secrets:
- `HEROKU_TEST_APP_NAME` = `smartlaundry-test`
- `HEROKU_STAGE_APP_NAME` = `smartlaundry-stage`
- `HEROKU_PROD_APP_NAME` = `smartlaundry`

#### Environment Variables

For each environment (TEST, STAGE, PROD), add:

**TEST Environment**:
- `TEST_MONGO_URI` - MongoDB Atlas connection string
- `TEST_MQTT_BROKER_URL` - MQTT broker URL
- `TEST_CAMPAY_KEY` - Campay test credentials
- `TEST_CAMPAY_SECRET`
- `TEST_WHATSAPP_TOKEN` - WhatsApp test credentials
- `TEST_WHATSAPP_PHONE_ID`
- `TEST_WHATSAPP_VERIFY_TOKEN`

**STAGE Environment** (same as TEST but with STAGE_ prefix)
**PROD Environment** (same as TEST but with PROD_ prefix)

### Step 2: MongoDB Atlas Setup

1. Go to [MongoDB Atlas](https://www.mongodb.com/cloud/atlas)
2. Create free cluster
3. Create database user
4. Whitelist Heroku IP addresses (or use 0.0.0.0/0 for development)
5. Get connection string
6. Add to GitHub secrets

### Step 3: Test CI/CD Pipeline

```bash
# Create a feature branch
git checkout -b feature/sl-001-test-cicd

# Make a small change
echo "# Test" >> test.txt

# Commit and push
git add .
git commit -m "Test CI/CD pipeline"
git push origin feature/sl-001-test-cicd
```

**Open a PR** on GitHub → PR checks should run automatically!

### Step 4: Deploy to TEST

Merge your PR to `develop` → Automatic deployment to TEST environment

Verify: `curl https://smartlaundry-test.herokuapp.com/api/health`

### Step 5: Deploy to STAGE (Manual)

1. Go to Actions tab
2. Select "Deploy to Heroku STAGE"
3. Click "Run workflow"
4. Type "deploy"
5. Click "Run workflow" button

### Step 6: Deploy to PRODUCTION

**Create a release**:
```bash
git checkout develop
git pull
git tag v1.0.0
git push origin v1.0.0
```

**On GitHub**:
1. Go to Releases → Draft new release
2. Select tag `v1.0.0`
3. Write release notes
4. Click "Publish release"

→ Automatic deployment to PRODUCTION!

For complete CI/CD documentation, see [CI-CD.md](CI-CD.md).

## Production Deployment

### Pre-Production Checklist

Before deploying to production:

- [ ] All tests passing in CI/CD
- [ ] Tested in STAGE environment
- [ ] MongoDB Atlas production cluster ready
- [ ] Permanent WhatsApp System User token configured
- [ ] Production MQTT broker configured
- [ ] Campay production credentials ready
- [ ] SSL/TLS certificates configured
- [ ] Monitoring and alerts set up
- [ ] Backup strategy in place
- [ ] Team notified of deployment
- [ ] Rollback plan ready

### Production Configuration

**MongoDB Atlas**:
- Use dedicated cluster (not shared)
- Enable backups
- Configure IP whitelist
- Use strong password

**Heroku**:
- Use Standard or Performance dynos (not Hobby)
- Enable automatic SSL
- Configure custom domain
- Set up monitoring

**Security**:
- Rotate all secrets
- Use environment-specific credentials
- Enable 2FA on all accounts
- Regular security audits

**WhatsApp**:
- Create System User in Business Manager
- Generate permanent access token
- Configure production phone number
- Set up message templates

**Monitoring**:
- Heroku Metrics
- Application Performance Monitoring (New Relic/DataDog)
- Error tracking (Sentry)
- Log aggregation (Papertrail/LogDNA)
- Uptime monitoring (UptimeRobot)

### Post-Deployment

After deploying to production:

1. **Monitor for 30 minutes**
   ```bash
   heroku logs --tail --app smartlaundry
   ```

2. **Run smoke tests**
   - Test health endpoint
   - Send test WhatsApp message
   - Process test payment
   - Check MongoDB connections

3. **Verify metrics**
   - Response times
   - Error rates
   - Memory usage
   - Database connections

4. **Set up alerts**
   - Downtime alerts
   - Error rate alerts
   - Performance degradation alerts

## Next Steps

### Documentation

- **API Documentation**: [API.md](API.md)
- **Configuration Guide**: [CONFIGURATION.md](CONFIGURATION.md)
- **Docker Guide**: [DOCKER.md](DOCKER.md)
- **CI/CD Guide**: [CI-CD.md](CI-CD.md)

### Development Workflow

1. Create feature branch: `feature/sl-XXX-description`
2. Make changes
3. Commit with clear messages
4. Open PR
5. Wait for CI checks
6. Get code review
7. Merge to develop
8. Test in TEST environment
9. Deploy to STAGE for UAT
10. Create release for PROD

### Team Onboarding

New team members should:
1. Clone repository
2. Run `docker-compose up`
3. Configure `.env` with test credentials
4. Read all documentation
5. Make a small test PR

### Troubleshooting

Common issues and solutions:

**Problem**: Tests failing
- Check Node.js version (18.x or 20.x)
- Run `npm install` to update dependencies
- Check MongoDB is running

**Problem**: Docker containers won't start
- Ensure Docker Desktop is running
- Check ports 3000, 27017, 1883 are available
- Try `docker-compose down -v && docker-compose up`

**Problem**: WhatsApp bot not responding
- Check ngrok is running
- Verify webhook URL in Meta dashboard
- Check `WHATSAPP_VERIFY_TOKEN` matches
- View logs: `docker-compose logs backend`

**Problem**: Deployment failing
- Check GitHub secrets are configured
- Verify Heroku app names
- Check Heroku logs: `heroku logs --tail --app <app-name>`
- Verify MongoDB Atlas IP whitelist

### Getting Help

- **Documentation**: Check relevant .md files
- **GitHub Issues**: Open an issue for bugs
- **Team Chat**: Ask in team channel
- **Logs**: Always check logs first
  - Docker: `docker-compose logs`
  - Heroku: `heroku logs --tail`
  - GitHub Actions: Check workflow logs

## Quick Command Reference

### Local Development
```bash
npm run dev                    # Start with nodemon
npm test                       # Run tests
npm start                      # Production mode
```

### Docker
```bash
docker-compose up             # Start all services
docker-compose down           # Stop all services
docker-compose logs -f        # View logs
docker-compose up --build     # Rebuild and start
```

### Heroku
```bash
heroku login                              # Login
heroku logs --tail --app <app-name>      # View logs
heroku ps --app <app-name>               # Check dynos
heroku restart --app <app-name>          # Restart
heroku releases:rollback --app <app>     # Rollback
```

### Git
```bash
git checkout -b feature/sl-XXX-name  # Create branch
git add .                             # Stage changes
git commit -m "message"               # Commit
git push origin <branch>              # Push
git tag v1.0.0                        # Create tag
git push origin v1.0.0                # Push tag
```

### ngrok
```bash
ngrok http 3000                       # Tunnel to localhost:3000
ngrok http 3000 --subdomain=myapp     # Custom subdomain (paid)
```

## Success Criteria

You'll know everything is working when:

✅ Docker containers start without errors
✅ Health check returns `{"status":"UP"}`
✅ WhatsApp bot responds to "Hi"
✅ PR checks pass automatically
✅ TEST deployment succeeds on merge
✅ STAGE deployment works manually
✅ PROD deployment succeeds via release
✅ All environments have different credentials
✅ Monitoring and alerts are active

## Congratulations!

You now have a fully functional development and deployment pipeline! 🎉

Remember:
- **Develop locally** with Docker + ngrok
- **Test in TEST** automatically on merge
- **Demo in STAGE** for stakeholders
- **Deploy to PROD** via GitHub Releases
- **Monitor everything** always

Happy coding! 🚀
