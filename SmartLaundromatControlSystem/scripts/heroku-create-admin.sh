#!/bin/bash
# heroku-create-admin.sh
# Script to create admin user on Heroku
# Called from GitHub Actions

set -e

echo "========================================"
echo "   CREATE ADMIN - Heroku Script"
echo "========================================"
echo ""
echo "Environment variables received:"
echo "  NODE_ENV: $NODE_ENV"
echo "  ADMIN_EMAIL: $ADMIN_EMAIL"
echo "  ADMIN_NAME: $ADMIN_NAME"
echo "  FORCE_CREATE: $FORCE_CREATE"
echo "  MONGO_URI: ${MONGO_URI:0:30}..."
echo ""

# Export all variables for Node.js
export NODE_ENV="${NODE_ENV:-test}"
export NON_INTERACTIVE=true
export ALLOW_ADMIN_CREATION=true

# Run the Node.js script
echo "Running createAdmin.js..."
node scripts/createAdmin.js

echo ""
echo "Script completed successfully!"
