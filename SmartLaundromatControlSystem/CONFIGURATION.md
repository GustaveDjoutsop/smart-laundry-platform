# Environment Configuration Guide

This document explains how to configure the Smart Laundromat Control System for different deployment environments.

## Table of Contents

- [Overview](#overview)
- [Environment Types](#environment-types)
- [Configuration Files](#configuration-files)
- [Configuration Variables](#configuration-variables)
- [Deployment-Specific Setup](#deployment-specific-setup)
- [Security Best Practices](#security-best-practices)

---

## Overview

The application uses **environment-specific configuration** to support different deployment scenarios. All environment-sensitive values (pricing, API credentials, URLs) are externalized from the code and managed through environment variables.

### Key Benefits

- **No hardcoded values**: Prices, credentials, and URLs are all configurable
- **Environment isolation**: Dev/Test use sandbox APIs, Stage/Prod use production APIs
- **Easy deployment**: Each environment has its own configuration file
- **Security**: Sensitive values are never committed to version control

---

## Environment Types

The system supports four environment types, determined by the `NODE_ENV` variable:

### 1. Development (`development`)

- **Purpose**: Local development on your machine
- **Campay API**: Sandbox (`https://demo.campay.net`)
- **Database**: Local MongoDB
- **Credentials**: Your personal test credentials
- **File**: `.env` or `.env.development`

### 2. Test (`test`)

- **Purpose**: Automated CI/CD testing (Pull Requests)
- **Campay API**: Sandbox (`https://demo.campay.net`)
- **Database**: Test database (wiped between runs)
- **Credentials**: Test credentials (mocked or sandbox)
- **File**: `.env.test`
- **Note**: This configuration is committed to version control

### 3. Stage (`stage`)

- **Purpose**: Staging/UAT environment for pre-production testing
- **Campay API**: Production API (`https://www.campay.net`)
- **Database**: Staging database (production-like)
- **Credentials**: Staging credentials from secret manager
- **File**: `.env.stage` (template only - actual values from secrets)

### 4. Production (`production`)

- **Purpose**: Live production environment
- **Campay API**: Production API (`https://www.campay.net`)
- **Database**: Production database
- **Credentials**: Production credentials from secret manager
- **File**: `.env.production` (template only - actual values from secrets)

---

## Configuration Files

### File Structure

```
SmartLaundromatControlSystem/
├── .env.example         # Template with all variables (commit this)
├── .env                 # Your local dev config (DO NOT commit)
├── .env.development     # Development config (DO NOT commit)
├── .env.test            # Test config (commit this)
├── .env.stage           # Stage template (commit template, not secrets)
└── .env.production      # Production template (commit template, not secrets)
```

### Which Files to Commit

| File | Commit? | Purpose |
|------|---------|---------|
| `.env.example` | ✅ Yes | Template for all environments |
| `.env` | ❌ No | Your personal local config |
| `.env.development` | ❌ No | Local dev configs (may contain real credentials) |
| `.env.test` | ✅ Yes | Test configs for CI/CD (uses test credentials) |
| `.env.stage` | ✅ Yes* | Template only (placeholders, not real secrets) |
| `.env.production` | ✅ Yes* | Template only (placeholders, not real secrets) |

*Commit templates with placeholder values. Actual secrets should be injected at deployment time from GitHub Secrets or your secret manager.

---

## Configuration Variables

### Core Environment Variables

#### `NODE_ENV`
- **Type**: String
- **Values**: `development`, `test`, `stage`, `production`
- **Default**: `development`
- **Description**: Determines which environment configuration to use

#### `PORT`
- **Type**: Number
- **Default**: `3000`
- **Description**: Port the server listens on

### Database

#### `MONGO_URI`
- **Type**: String (MongoDB connection string)
- **Description**: MongoDB connection URL with authentication
- **Security**: **CRITICAL** - Stage/Prod MUST use authentication

**Environment-Specific Configurations:**

##### Development
```bash
MONGO_URI=mongodb://localhost:27017/laundry_db
```
- No authentication required for local development
- Uses local MongoDB instance

##### Test
```bash
MONGO_URI=mongodb://localhost:27017/laundry_db_test
```
- No authentication required for CI/CD testing
- Uses separate test database

##### Stage (WITH AUTHENTICATION)
```bash
# Standard MongoDB with auth
MONGO_URI=mongodb://stage_user:SECURE_PASSWORD@stage-db.example.com:27017/laundry_db_stage?authSource=admin

# Or MongoDB Atlas (recommended)
MONGO_URI=mongodb+srv://stage_user:SECURE_PASSWORD@stage-cluster.mongodb.net/laundry_db_stage?retryWrites=true&w=majority
```
- **REQUIRED**: Username and password authentication
- Use dedicated database user with limited permissions
- Store credentials in GitHub Secrets: `${{ secrets.STAGE_MONGO_URI }}`

##### Production (WITH AUTHENTICATION + SSL)
```bash
# Standard MongoDB with auth and SSL
MONGO_URI=mongodb://prod_user:SECURE_PASSWORD@prod-db.example.com:27017/laundry_db_prod?authSource=admin&ssl=true

# Or MongoDB Atlas (recommended for production)
MONGO_URI=mongodb+srv://prod_user:SECURE_PASSWORD@prod-cluster.mongodb.net/laundry_db_prod?retryWrites=true&w=majority&ssl=true
```
- **REQUIRED**: Username, password, and SSL/TLS
- Use strong passwords (minimum 20 characters)
- Store credentials in GitHub Secrets: `${{ secrets.PROD_MONGO_URI }}`
- Enable IP whitelisting
- Use MongoDB Atlas for managed security and backups

**MongoDB Security Checklist for Stage/Production:**

✅ **Authentication**
- Create dedicated database user (not admin user)
- Use strong password (20+ chars, mixed case, numbers, symbols)
- Set appropriate user permissions (readWrite on specific database only)

✅ **Network Security**
- Enable IP whitelisting (only allow your server IPs)
- Use SSL/TLS connections (`?ssl=true` parameter)
- Use private network if possible (VPC)

✅ **Database Configuration**
```javascript
// Example MongoDB user creation
use admin
db.createUser({
  user: "laundry_prod_user",
  pwd: "STRONG_PASSWORD_HERE",
  roles: [
    { role: "readWrite", db: "laundry_db_prod" }
  ]
})
```

✅ **Connection String Parameters**
- `authSource=admin` - Specify authentication database
- `ssl=true` - Enable SSL/TLS encryption
- `retryWrites=true` - Enable retryable writes
- `w=majority` - Write concern for data durability

✅ **Credential Management**
- Store in GitHub Secrets for CI/CD
- Use platform secret manager (Heroku Config Vars, Railway Variables, etc.)
- Never commit connection strings to version control
- Rotate credentials quarterly

### MQTT Broker

#### `MQTT_BROKER_URL`
- **Type**: String (MQTT URL)
- **Description**: MQTT broker URL for IoT machine communication
- **Security**: **CRITICAL** - Stage/Prod MUST use TLS and authentication

**Environment-Specific Configurations:**

##### Development
```bash
MQTT_BROKER_URL=mqtt://test.mosquitto.org
# No authentication (public test broker)
```
- Use public test broker for local development
- No authentication required

##### Test
```bash
MQTT_BROKER_URL=mqtt://test.mosquitto.org
# No authentication (public test broker)
```
- Use public test broker for CI/CD
- No authentication required

##### Stage (WITH AUTHENTICATION + TLS)
```bash
MQTT_BROKER_URL=mqtts://stage-mqtt-broker.example.com:8883
MQTT_USERNAME=stage_mqtt_user
MQTT_PASSWORD=SECURE_MQTT_PASSWORD
```
- **REQUIRED**: Username and password authentication
- **REQUIRED**: TLS/SSL encryption (`mqtts://` not `mqtt://`)
- Use private MQTT broker (HiveMQ Cloud, AWS IoT Core, or self-hosted)
- Store credentials in GitHub Secrets

##### Production (WITH AUTHENTICATION + TLS)
```bash
MQTT_BROKER_URL=mqtts://prod-mqtt-broker.example.com:8883
MQTT_USERNAME=prod_mqtt_user
MQTT_PASSWORD=SECURE_MQTT_PASSWORD
```
- **REQUIRED**: Username and password authentication
- **REQUIRED**: TLS/SSL encryption (`mqtts://`)
- Use managed MQTT service (HiveMQ Cloud recommended)
- Configure ACL (Access Control Lists) on broker
- Store credentials in GitHub Secrets

#### `MQTT_USERNAME`
- **Type**: String
- **Description**: MQTT broker username for authentication
- **Required**: Yes for stage/production, No for dev/test
- **Security**: Store in secret manager

#### `MQTT_PASSWORD`
- **Type**: String
- **Description**: MQTT broker password for authentication
- **Required**: Yes for stage/production, No for dev/test
- **Security**: Store in secret manager, rotate semi-annually

**MQTT Security Checklist for Stage/Production:**

✅ **Use TLS/SSL Encryption**
- Protocol: `mqtts://` (not `mqtt://`)
- Port: 8883 (TLS) not 1883 (unencrypted)
- Certificate validation enabled

✅ **Enable Authentication**
- Username and password required
- Use strong passwords (16+ characters)
- Separate credentials for each environment

✅ **Configure Access Control Lists (ACL)**
```
# Example Mosquitto ACL
user backend_user
topic write laundry/cameroon/+/command
topic read laundry/cameroon/+/telemetry

user esp32_device
topic read laundry/cameroon/washer_01/command
topic write laundry/cameroon/washer_01/telemetry
```

✅ **Recommended MQTT Providers**
- **HiveMQ Cloud**: Managed MQTT with built-in security, free tier available
- **AWS IoT Core**: Enterprise-grade with certificate authentication
- **Self-hosted Mosquitto**: Configure with TLS certificates and ACLs

✅ **Network Security**
- Use VPC/private network if possible
- Enable IP whitelisting
- Monitor connection logs

✅ **Credential Management**
- Store in GitHub Secrets for CI/CD
- Use platform secret manager
- Rotate credentials semi-annually
- Never commit credentials to version control

### Campay Payment Gateway

#### `CAMPAY_APP_KEY`
- **Type**: String
- **Description**: Campay App Username
- **Where to get**:
  - Dev/Test: [Campay Sandbox Dashboard](https://demo.campay.net)
  - Prod: [Campay Production Dashboard](https://www.campay.net)

#### `CAMPAY_APP_SECRET`
- **Type**: String
- **Description**: Campay App Password
- **Security**: **CRITICAL** - Never commit real values

#### `CAMPAY_BASE_URL` (Optional)
- **Type**: String
- **Default**: Auto-detected based on `NODE_ENV`
- **Description**: Override Campay API base URL
- **Auto-detected values**:
  - `development`: `https://demo.campay.net`
  - `test`: `https://demo.campay.net`
  - `stage`: `https://www.campay.net`
  - `production`: `https://www.campay.net`

### WhatsApp (Meta) API

#### `WHATSAPP_TOKEN`
- **Type**: String
- **Description**: Meta WhatsApp API access token
- **Important**:
  - Dev: Use temporary token (expires every 24h)
  - Prod: Use permanent System User token
- **Where to get**: [Meta Developer Portal](https://developers.facebook.com/apps)

#### `WHATSAPP_PHONE_ID`
- **Type**: String
- **Description**: Phone Number ID from Meta WhatsApp Business API

#### `WHATSAPP_VERIFY_TOKEN`
- **Type**: String
- **Description**: Secret token for webhook verification
- **Note**: You create this yourself (any random string)

### Business Configuration

#### Pricing (in XAF - Central African Francs)

##### `PRICE_SHORT_CYCLE`
- **Type**: Number
- **Default**: `1000`
- **Description**: Price for short wash cycle
- **Environment-Specific**:
  - Dev/Test: `1000` (sandbox)
  - Stage: `1000` or `1500` (test pricing)
  - Prod: `1500` (actual production price)

##### `PRICE_LONG_CYCLE`
- **Type**: Number
- **Default**: `2000`
- **Description**: Price for long wash cycle
- **Environment-Specific**:
  - Dev/Test: `2000` (sandbox)
  - Stage: `2000` or `3000` (test pricing)
  - Prod: `3000` (actual production price)

#### Wash Cycles

##### `DURATION_SHORT`
- **Type**: String (minutes)
- **Default**: `30`
- **Description**: Duration of short wash cycle

##### `DURATION_LONG`
- **Type**: String (minutes)
- **Default**: `60`
- **Description**: Duration of long wash cycle

##### `PULSE_SHORT`
- **Type**: Number
- **Default**: `1`
- **Description**: Number of pulses to trigger for short cycle

##### `PULSE_LONG`
- **Type**: Number
- **Default**: `2`
- **Description**: Number of pulses to trigger for long cycle

### Machine Configuration

#### `MACHINE_IDS`
- **Type**: String (comma-separated)
- **Default**: `washer_01,washer_02`
- **Description**: List of available washing machine IDs
- **Environment-Specific**:
  - Dev: `washer_01,washer_02`
  - Test: `washer_01,washer_02`
  - Stage: `washer_stage_01,washer_stage_02`
  - Prod: `washer_douala_01,washer_douala_02,washer_yaounde_01,washer_yaounde_02`

---

## Deployment-Specific Setup

### Local Development

1. **Copy the example file:**
   ```bash
   cp .env.example .env
   ```

2. **Fill in your local credentials:**
   ```bash
   NODE_ENV=development
   MONGO_URI=mongodb://localhost:27017/laundry_db
   CAMPAY_APP_KEY=your_sandbox_username
   CAMPAY_APP_SECRET=your_sandbox_password
   WHATSAPP_TOKEN=your_temp_token
   # ... other values
   ```

3. **Start the server:**
   ```bash
   npm run dev
   ```

### CI/CD Testing (GitHub Actions)

The `.env.test` file is already configured for automated testing.

**In your GitHub Actions workflow:**

```yaml
- name: Run tests
  env:
    NODE_ENV: test
  run: npm test
```

No additional setup needed - the `.env.test` file is committed to the repository.

### Staging Deployment

**Prerequisites:**
1. Set up MongoDB with authentication (see MongoDB Security section below)
2. Create staging Campay account credentials
3. Configure WhatsApp permanent token

**Option 1: Using deployment platform (Heroku, DigitalOcean, Railway):**

Set environment variables via the platform's secret manager:

```bash
NODE_ENV=stage
MONGO_URI=mongodb://stage_user:SECURE_PASSWORD@stage-db.example.com:27017/laundry_db_stage?authSource=admin
MQTT_BROKER_URL=mqtts://stage-mqtt-broker.example.com:8883
MQTT_USERNAME=stage_mqtt_user
MQTT_PASSWORD=SECURE_MQTT_PASSWORD
CAMPAY_APP_KEY=<stage_campay_username>
CAMPAY_APP_SECRET=<stage_campay_password>
WHATSAPP_TOKEN=<stage_permanent_token>
WHATSAPP_PHONE_ID=<stage_phone_id>
WHATSAPP_VERIFY_TOKEN=<stage_verify_token>
PRICE_SHORT_CYCLE=1500
PRICE_LONG_CYCLE=3000
MACHINE_IDS=washer_stage_01,washer_stage_02
```

**Option 2: Using GitHub Secrets in deploy workflow:**

```yaml
- name: Deploy to Stage
  env:
    NODE_ENV: stage
    # Database with authentication
    MONGO_URI: ${{ secrets.STAGE_MONGO_URI }}
    # MQTT Broker with authentication
    MQTT_BROKER_URL: ${{ secrets.STAGE_MQTT_BROKER_URL }}
    MQTT_USERNAME: ${{ secrets.STAGE_MQTT_USERNAME }}
    MQTT_PASSWORD: ${{ secrets.STAGE_MQTT_PASSWORD }}
    # Campay credentials
    CAMPAY_APP_KEY: ${{ secrets.STAGE_CAMPAY_KEY }}
    CAMPAY_APP_SECRET: ${{ secrets.STAGE_CAMPAY_SECRET }}
    # WhatsApp credentials
    WHATSAPP_TOKEN: ${{ secrets.STAGE_WHATSAPP_TOKEN }}
    WHATSAPP_PHONE_ID: ${{ secrets.STAGE_WHATSAPP_PHONE_ID }}
    WHATSAPP_VERIFY_TOKEN: ${{ secrets.STAGE_WHATSAPP_VERIFY_TOKEN }}
    # Business configuration
    PRICE_SHORT_CYCLE: 1500
    PRICE_LONG_CYCLE: 3000
    MACHINE_IDS: washer_stage_01,washer_stage_02
  run: npm run deploy:stage
```

### Production Deployment

**CRITICAL SECURITY REQUIREMENTS:**

1. ✅ MongoDB MUST have authentication enabled
2. ✅ MongoDB MUST use SSL/TLS connections
3. ✅ MQTT MUST use TLS (mqtts://) with authentication
4. ✅ Use managed services (MongoDB Atlas, HiveMQ Cloud)
5. ✅ Enable IP whitelisting on database and MQTT broker
6. ✅ Use strong passwords (20+ characters)
7. ✅ Store ALL credentials in secret manager
8. ✅ Never hardcode production credentials

**Prerequisites:**
1. Set up production MongoDB with authentication and SSL (see MongoDB Security section)
2. Set up production MQTT broker with TLS and authentication (see MQTT Security section)
3. Create production Campay account credentials
4. Configure WhatsApp permanent System User token
5. Set up IP whitelisting for your production servers

**Use your platform's secret management:**

- **GitHub Secrets**: For GitHub Actions deployments
- **Heroku Config Vars**: For Heroku deployments
- **Railway Variables**: For Railway deployments
- **AWS Secrets Manager**: For AWS deployments
- **Azure Key Vault**: For Azure deployments
- **DigitalOcean App Platform**: Environment variables

**Example GitHub Actions production deploy:**

```yaml
- name: Deploy to Production
  env:
    NODE_ENV: production

    # Database with authentication + SSL (CRITICAL)
    MONGO_URI: ${{ secrets.PROD_MONGO_URI }}
    # Example: mongodb+srv://prod_user:PASSWORD@prod-cluster.mongodb.net/laundry_db_prod?ssl=true

    # MQTT Broker with TLS + authentication (CRITICAL)
    MQTT_BROKER_URL: ${{ secrets.PROD_MQTT_BROKER_URL }}
    # Example: mqtts://prod-cluster.s2.eu.hivemq.cloud:8883
    MQTT_USERNAME: ${{ secrets.PROD_MQTT_USERNAME }}
    MQTT_PASSWORD: ${{ secrets.PROD_MQTT_PASSWORD }}

    # Campay Production credentials
    CAMPAY_APP_KEY: ${{ secrets.PROD_CAMPAY_KEY }}
    CAMPAY_APP_SECRET: ${{ secrets.PROD_CAMPAY_SECRET }}

    # WhatsApp Production credentials (System User token)
    WHATSAPP_TOKEN: ${{ secrets.PROD_WHATSAPP_TOKEN }}
    WHATSAPP_PHONE_ID: ${{ secrets.PROD_WHATSAPP_PHONE_ID }}
    WHATSAPP_VERIFY_TOKEN: ${{ secrets.PROD_WHATSAPP_VERIFY_TOKEN }}

    # Production business configuration
    PRICE_SHORT_CYCLE: 1500
    PRICE_LONG_CYCLE: 3000

    # Production machines
    MACHINE_IDS: washer_douala_01,washer_douala_02,washer_yaounde_01,washer_yaounde_02
  run: npm run deploy:prod
```

**MongoDB Atlas Setup for Production (Recommended):**

1. **Create MongoDB Atlas Account**
   - Sign up at https://www.mongodb.com/cloud/atlas
   - Create a new cluster (M10 or higher for production)

2. **Configure Database Security**
   ```javascript
   // Create production database user
   use admin
   db.createUser({
     user: "laundry_prod_user",
     pwd: "GENERATE_STRONG_PASSWORD_HERE",
     roles: [
       { role: "readWrite", db: "laundry_db_prod" }
     ]
   })
   ```

3. **Configure Network Access**
   - Go to Network Access tab
   - Add IP addresses of your production servers
   - Enable "Allow access from anywhere" ONLY if using VPN/bastion

4. **Get Connection String**
   ```
   mongodb+srv://laundry_prod_user:PASSWORD@prod-cluster.mongodb.net/laundry_db_prod?retryWrites=true&w=majority&ssl=true
   ```

5. **Store in GitHub Secrets**
   - Go to repository Settings → Secrets and variables → Actions
   - Add secret: `PROD_MONGO_URI`
   - Paste the connection string with real password

---

## Security Best Practices

### 1. Never Commit Secrets

- ❌ **Do NOT** commit `.env` files with real credentials
- ✅ **DO** commit `.env.example` and `.env.test` (with test values only)
- ✅ **DO** use `.gitignore` to exclude `.env.development`, `.env`, etc.

### 2. Use Secret Management

- **Development**: Local `.env` file (not committed)
- **CI/CD**: GitHub Secrets or equivalent
- **Production**: Platform secret manager (Heroku Config Vars, AWS Secrets Manager, etc.)

### 3. Database Security (Stage/Production)

**CRITICAL: Production databases MUST have authentication and encryption**

#### MongoDB Security Checklist

✅ **Enable Authentication**
```javascript
// Create dedicated database user
use admin
db.createUser({
  user: "laundry_user",
  pwd: "STRONG_PASSWORD_20_CHARS_MIN",
  roles: [
    { role: "readWrite", db: "laundry_db_prod" }
  ]
})
```

✅ **Use SSL/TLS Encryption**
```bash
# Connection string MUST include ssl=true
MONGO_URI=mongodb+srv://user:pass@host/db?ssl=true
```

✅ **Enable IP Whitelisting**
- Only allow connections from your application servers
- Never use "Allow access from anywhere" in production
- Use VPC/private network if possible

✅ **Use Strong Passwords**
- Minimum 20 characters
- Mix of uppercase, lowercase, numbers, symbols
- Use password generator
- Example: `K9#mP$xL2@vN8!qR7^wF`

✅ **Limit User Permissions**
- Use `readWrite` role (not `dbAdmin` or `root`)
- Grant permissions only for specific database
- Never use admin/root user for application

✅ **Connection String Format**
```bash
# Self-hosted MongoDB with auth + SSL
mongodb://username:password@host:port/database?authSource=admin&ssl=true

# MongoDB Atlas (recommended)
mongodb+srv://username:password@cluster.mongodb.net/database?retryWrites=true&w=majority&ssl=true
```

✅ **Regular Backups**
- Enable automated backups (MongoDB Atlas does this automatically)
- Test restore procedures
- Store backups in separate secure location

✅ **Monitor and Alert**
- Set up alerts for failed login attempts
- Monitor unusual access patterns
- Track connection counts and query performance

### 4. Rotate Credentials Regularly

- **Database Passwords**: Rotate quarterly (every 3 months)
- **WhatsApp Token**: Use permanent System User tokens, rotate quarterly
- **Campay Credentials**: Rotate per Campay security policy
- **MQTT Credentials**: Rotate semi-annually

### 5. Separate Environment Credentials

- **Never** use production credentials in development or test
- **Always** use separate database instances for each environment
- **Always** use separate Campay accounts for sandbox and production
- **Always** use separate WhatsApp numbers for test and production
- **Always** use different passwords for each environment

### 6. Audit Access

- Log who has access to production secrets
- Review and revoke access regularly
- Use role-based access control (RBAC)
- Maintain audit log of secret access
- Require MFA for secret manager access

---

## Troubleshooting

### Issue: "Authentication with payment provider failed"

**Cause**: Wrong Campay credentials or wrong environment

**Solution**:
1. Check `NODE_ENV` is set correctly
2. Verify `CAMPAY_APP_KEY` and `CAMPAY_APP_SECRET` match your environment
3. For dev/test: Use sandbox credentials from https://demo.campay.net
4. For stage/prod: Use production credentials from https://www.campay.net

### Issue: Prices don't match what I set

**Cause**: Environment variables not loaded correctly

**Solution**:
1. Check your `.env` file exists and has the correct values
2. Restart the server after changing `.env`
3. Verify `PRICE_SHORT_CYCLE` and `PRICE_LONG_CYCLE` are set
4. Check logs for the loaded environment: Look for `Campay Auth [development]` in logs

### Issue: Machine IDs not appearing in WhatsApp

**Cause**: `MACHINE_IDS` not configured or empty

**Solution**:
1. Set `MACHINE_IDS` in your `.env` file: `MACHINE_IDS=washer_01,washer_02`
2. Restart the server
3. Verify in logs that machines are loaded

---

## Need Help?

- Check the main [README.md](README.md) for setup instructions
- Review the [API.md](API.md) for API documentation
- Contact the development team for access to production secrets
