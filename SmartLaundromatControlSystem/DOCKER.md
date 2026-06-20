# Docker Guide for Smart Laundromat Backend

This guide explains how to run the Smart Laundromat Control System using Docker and Docker Compose.

## Table of Contents

- [Why Docker?](#why-docker)
- [Prerequisites](#prerequisites)
- [Quick Start](#quick-start)
- [Architecture](#architecture)
- [Common Commands](#common-commands)
- [Using with ngrok](#using-with-ngrok)
- [Development Workflow](#development-workflow)
- [Troubleshooting](#troubleshooting)
- [Production Deployment](#production-deployment)

## Why Docker?

Docker provides several advantages for this project:

✅ **Consistency**: "Works on my machine" → "Works everywhere"
✅ **Easy Setup**: No need to install MongoDB or MQTT broker manually
✅ **Team Onboarding**: New developers just run `docker-compose up`
✅ **Environment Parity**: Local development matches staging/production
✅ **Cost-Effective**: Run everything locally, only pay for cloud when deployed
✅ **Isolation**: Services run in isolated containers with proper networking

## Prerequisites

1. **Install Docker Desktop**
   - **Windows**: [Download Docker Desktop for Windows](https://www.docker.com/products/docker-desktop/)
   - **Mac**: [Download Docker Desktop for Mac](https://www.docker.com/products/docker-desktop/)
   - **Linux**: Install Docker Engine and Docker Compose

2. **Verify Installation**
   ```bash
   docker --version
   docker-compose --version
   ```

3. **Create `.env` file**
   ```bash
   cp .env.example .env
   ```
   Then fill in your credentials.

## Quick Start

### Start Everything

```bash
docker-compose up
```

This single command will:
- Pull/build all required images
- Start MongoDB container on port 27017
- Start MQTT broker (Mosquitto) on ports 1883 and 9001
- Start Node.js backend on port 3000 with hot-reload
- Create a network connecting all services
- Create persistent volumes for MongoDB data

### Verify It's Running

```bash
docker ps
```

You should see three containers:
- `laundry-backend` (Node.js API)
- `laundry-mongodb` (MongoDB database)
- `laundry-mqtt` (Mosquitto MQTT broker)

### Test the API

```bash
curl http://localhost:3000/api/health
```

Expected response:
```json
{"status":"UP"}
```

## Architecture

```
┌─────────────────────────────────────────────┐
│  Docker Compose Network (laundry-network)  │
│                                             │
│  ┌────────────────┐    ┌───────────────┐  │
│  │ laundry-backend│◄───│ laundry-mongodb │ │
│  │  (Node.js)     │    │   (MongoDB)     │ │
│  │  Port: 3000    │    │  Port: 27017    │ │
│  └────────┬───────┘    └─────────────────┘ │
│           │                                  │
│           │            ┌──────────────────┐ │
│           └───────────►│  laundry-mqtt    │ │
│                        │  (Mosquitto)     │ │
│                        │  Port: 1883/9001 │ │
│                        └──────────────────┘ │
└─────────────────────────────────────────────┘
             ▲
             │
          Exposed to
         localhost:3000
             │
             ▼
         ┌────────┐
         │ ngrok  │ (for webhook testing)
         └────────┘
```

### Service Details

#### Backend Service
- **Container Name**: `laundry-backend`
- **Image**: Custom built from Dockerfile
- **Ports**: 3000:3000
- **Volumes**:
  - Source code mounted for hot-reload (`./src:/app/src`)
  - node_modules in container (not overwritten)
- **Environment**: Uses `.env` file
- **Dependencies**: Waits for MongoDB and MQTT health checks

#### MongoDB Service
- **Container Name**: `laundry-mongodb`
- **Image**: `mongo:7.0`
- **Ports**: 27017:27017
- **Volumes**:
  - `mongodb_data` (persistent database storage)
  - `mongodb_config` (configuration)
- **Health Check**: Pings database every 10s

#### MQTT Service
- **Container Name**: `laundry-mqtt`
- **Image**: `eclipse-mosquitto:2.0`
- **Ports**:
  - 1883 (MQTT protocol)
  - 9001 (WebSockets)
- **Volumes**:
  - `./mosquitto/config` (configuration)
  - `./mosquitto/data` (persistence)
  - `./mosquitto/log` (logs)
- **Health Check**: Tests broker connectivity every 10s

## Common Commands

### Development

```bash
# Start all services (attached mode, see logs)
docker-compose up

# Start in background (detached mode)
docker-compose up -d

# Stop all services
docker-compose down

# Stop and remove volumes (deletes database!)
docker-compose down -v

# Rebuild after changing Dockerfile or dependencies
docker-compose up --build

# Rebuild specific service
docker-compose up --build backend

# View logs
docker-compose logs -f

# View logs for specific service
docker-compose logs -f backend

# Restart a service
docker-compose restart backend

# Execute command in running container
docker-compose exec backend npm run test

# Open shell in container
docker-compose exec backend sh
```

### Monitoring

```bash
# Check container status
docker ps

# View container resource usage
docker stats

# Inspect container
docker inspect laundry-backend

# View container logs
docker logs laundry-backend -f
```

### Cleanup

```bash
# Remove all stopped containers
docker container prune

# Remove unused images
docker image prune -a

# Remove unused volumes
docker volume prune

# Nuclear option: remove everything
docker system prune -a --volumes
```

## Using with ngrok

Docker exposes port 3000 to your host machine at `localhost:3000`, so ngrok works exactly the same as without Docker.

### Setup

1. **Start Docker containers** (Terminal 1):
   ```bash
   docker-compose up
   ```

2. **Start ngrok** (Terminal 2):
   ```bash
   ngrok http 3000
   ```

3. **Configure Meta webhook** with ngrok URL:
   ```
   https://abc123.ngrok.io/api/webhook/whatsapp
   ```

4. **Test** by sending "Hi" to your WhatsApp bot

### The Flow

```
WhatsApp Cloud API
      ↓
  ngrok tunnel
      ↓
localhost:3000 (host machine)
      ↓
Docker port mapping (3000:3000)
      ↓
laundry-backend container (port 3000)
```

## Development Workflow

### Hot Reload

The backend service is configured for hot reload using nodemon:

1. Make changes to files in `./src/`
2. nodemon automatically detects changes
3. Server restarts inside container
4. No need to rebuild or restart containers

```bash
# This is what's running inside the container:
npm run dev  # Uses nodemon
```

### Installing New Dependencies

If you add a new package to `package.json`:

```bash
# Option 1: Rebuild container
docker-compose up --build backend

# Option 2: Install inside running container
docker-compose exec backend npm install

# Then restart
docker-compose restart backend
```

### Running Tests

```bash
# Run tests in a temporary container
docker-compose run --rm backend npm test

# Or inside running container
docker-compose exec backend npm test
```

### Accessing MongoDB

```bash
# Connect with MongoDB shell
docker-compose exec mongodb mongosh laundry_db

# Or from host machine (if you have mongosh installed)
mongosh mongodb://localhost:27017/laundry_db
```

### Accessing MQTT Broker

```bash
# Subscribe to topic (from host, if mosquitto clients installed)
mosquitto_sub -h localhost -p 1883 -t "laundry/#"

# Publish test message
mosquitto_pub -h localhost -p 1883 -t "laundry/washer_01" -m "test"

# Or use MQTT Explorer GUI tool
```

## Troubleshooting

### Problem: Containers won't start

```bash
# Check logs
docker-compose logs

# Check if ports are already in use
netstat -ano | findstr :3000  # Windows
lsof -i :3000  # Mac/Linux

# Remove and recreate
docker-compose down
docker-compose up
```

### Problem: MongoDB health check failing

```bash
# Check MongoDB logs
docker-compose logs mongodb

# Try accessing manually
docker-compose exec mongodb mongosh --eval "db.runCommand('ping')"

# Restart MongoDB
docker-compose restart mongodb
```

### Problem: "Cannot connect to Docker daemon"

Docker Desktop is not running. Start Docker Desktop.

### Problem: Changes not reflecting

```bash
# Rebuild the container
docker-compose up --build

# Or restart nodemon inside container
docker-compose restart backend
```

### Problem: Port already in use

```bash
# Find process using port 3000
# Windows:
netstat -ano | findstr :3000
taskkill /PID <PID> /F

# Mac/Linux:
lsof -i :3000
kill -9 <PID>

# Or change port in docker-compose.yml:
ports:
  - "3001:3000"  # Use port 3001 on host
```

### Problem: Permission denied (Linux)

```bash
# Add your user to docker group
sudo usermod -aG docker $USER

# Log out and log back in
```

### Problem: MQTT connection refused

```bash
# Check MQTT logs
docker-compose logs mqtt

# Check MQTT config
cat mosquitto/config/mosquitto.conf

# Test MQTT connection
docker-compose exec mqtt mosquitto_sub -t '$SYS/#' -C 1
```

## Production Deployment

### Docker Compose Production Mode

For production, uncomment the production backend service in `docker-compose.yml`:

```yaml
# backend:
#   build:
#     context: .
#     dockerfile: Dockerfile
#   env_file:
#     - .env.production
#   depends_on:
#     mongodb:
#       condition: service_healthy
#     mqtt:
#       condition: service_healthy
```

Then run:

```bash
docker-compose -f docker-compose.yml up -d
```

### Deploying to Heroku with Docker

Heroku can build and deploy Docker containers:

```bash
# Login to Heroku
heroku login
heroku container:login

# Create app
heroku create smartlaundry

# Set environment variables
heroku config:set NODE_ENV=production
heroku config:set MONGO_URI=mongodb+srv://...
# ... (set all env vars)

# Build and push
heroku container:push web -a smartlaundry
heroku container:release web -a smartlaundry

# View logs
heroku logs --tail -a smartlaundry
```

### Security Considerations for Production

1. **MongoDB Authentication**
   - Add username/password to MongoDB
   - Update MONGO_URI in .env.production

2. **MQTT Authentication**
   - Enable authentication in `mosquitto.conf`
   - Create password file
   - Update MQTT_BROKER_URL

3. **Environment Variables**
   - Never commit `.env` files
   - Use secrets management (e.g., AWS Secrets Manager)

4. **Network Security**
   - Don't expose MongoDB/MQTT ports publicly
   - Use internal Docker network only
   - Put backend behind reverse proxy (nginx)

5. **Container Security**
   - Use non-root user in Dockerfile
   - Scan images for vulnerabilities
   - Keep base images updated

## Best Practices

### Do's ✅

- Use `.env` for environment-specific config
- Commit `docker-compose.yml` and `Dockerfile` to git
- Use health checks for service dependencies
- Use named volumes for persistent data
- Use `.dockerignore` to exclude unnecessary files
- Monitor container logs regularly

### Don'ts ❌

- Don't commit `.env` files with real credentials
- Don't use `docker-compose down -v` in production (deletes data!)
- Don't expose MongoDB/MQTT ports to the internet
- Don't run containers as root in production
- Don't hardcode secrets in Dockerfile
- Don't use `latest` tag for production images

## Additional Resources

- [Docker Documentation](https://docs.docker.com/)
- [Docker Compose Documentation](https://docs.docker.com/compose/)
- [Mosquitto Docker Image](https://hub.docker.com/_/eclipse-mosquitto)
- [MongoDB Docker Image](https://hub.docker.com/_/mongo)
- [Node.js Docker Best Practices](https://github.com/nodejs/docker-node/blob/main/docs/BestPractices.md)

## Support

If you encounter issues with Docker setup:

1. Check this troubleshooting guide
2. Review Docker logs: `docker-compose logs`
3. Check Docker Desktop is running
4. Verify `.env` file is configured correctly
5. Try `docker-compose down && docker-compose up --build`
