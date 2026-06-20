# API Documentation

## Base URL

```
http://localhost:3000  (Development)
https://your-domain.com  (Production)
```

## Table of Contents

- [Health Check](#health-check)
- [Payment Endpoints](#payment-endpoints)
- [Webhook Endpoints](#webhook-endpoints)
- [Error Codes](#error-codes)

---

## Health Check

### Check Server Status

**Endpoint:** `GET /api/health`

**Description:** Returns the current status of the server.

**Response:**

```json
{
  "status": "UP"
}
```

**Status Codes:**
- `200 OK` - Server is running

---

## Payment Endpoints

### Initiate Payment

**Endpoint:** `POST /api/pay`

**Description:** Initiates a mobile money payment request via Campay.

**Headers:**
```
Content-Type: application/json
```

**Request Body:**

```json
{
  "phone": "237677123456",
  "amount": 1000,
  "machineId": "washer_01",
  "pulseCount": 1,
  "description": "Payment for washer_01"
}
```

**Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `phone` | string | Yes | User's mobile money number (format: 237XXXXXXXXX) |
| `amount` | number | Yes | Amount in XAF |
| `machineId` | string | Yes | Unique identifier for the washing machine |
| `pulseCount` | number | Yes | Number of pulses to trigger the machine |
| `description` | string | No | Payment description (default: "Payment for {machineId}") |

**Success Response:**

```json
{
  "success": true,
  "message": "Payment initiated successfully",
  "reference": "campay-ref-123456",
  "internalRef": "uuid-v4-reference"
}
```

**Error Response:**

```json
{
  "success": false,
  "message": "Sorry, we can only accept MTN Mobile Money or Orange Money. Your number appears to be from a different network."
}
```

**Status Codes:**
- `200 OK` - Payment initiated successfully
- `400 Bad Request` - Missing required fields
- `500 Internal Server Error` - Payment initiation failed

**Example cURL:**

```bash
curl -X POST http://localhost:3000/api/pay \
  -H "Content-Type: application/json" \
  -d '{
    "phone": "237677123456",
    "amount": 1000,
    "machineId": "washer_01",
    "pulseCount": 1,
    "description": "30-minute wash cycle"
  }'
```

---

## Webhook Endpoints

### Campay Payment Webhook

**Endpoint:** `POST /api/webhook/campay`

**Description:** Receives payment status notifications from Campay. When a payment is successful, this triggers the washing machine via MQTT.

**Headers:**
```
Content-Type: application/json
```

**Request Body (from Campay):**

```json
{
  "reference": "uuid-v4-reference",
  "status": "SUCCESSFUL"
}
```

**Parameters:**

| Parameter | Type | Description |
|-----------|------|-------------|
| `reference` | string | The external_reference sent during payment initiation |
| `status` | string | Payment status: `SUCCESSFUL`, `FAILED`, or `PENDING` |

**Response:**

```
OK
```

**Status Codes:**
- `200 OK` - Webhook received and processed

**Behavior:**
- If status is `SUCCESSFUL`:
  - Updates transaction status in database
  - Publishes MQTT message to trigger the washing machine
  - Sends confirmation message to user via WhatsApp
- If status is `FAILED`:
  - Updates transaction status to FAILED
  - No machine trigger

---

### WhatsApp Webhook Verification

**Endpoint:** `GET /api/webhook/whatsapp`

**Description:** Used by Meta to verify the webhook URL.

**Query Parameters:**

| Parameter | Type | Description |
|-----------|------|-------------|
| `hub.mode` | string | Should be "subscribe" |
| `hub.verify_token` | string | Your verification token |
| `hub.challenge` | string | Challenge string from Meta |

**Success Response:**

Returns the `hub.challenge` value as plain text.

**Error Response:**

```
403 Forbidden
```

**Status Codes:**
- `200 OK` - Verification successful
- `403 Forbidden` - Invalid verify token

---

### WhatsApp Incoming Messages

**Endpoint:** `POST /api/webhook/whatsapp`

**Description:** Receives incoming WhatsApp messages and button interactions from users.

**Headers:**
```
Content-Type: application/json
```

**Request Body (from Meta):**

```json
{
  "object": "whatsapp_business_account",
  "entry": [
    {
      "id": "WHATSAPP_BUSINESS_ACCOUNT_ID",
      "changes": [
        {
          "value": {
            "messaging_product": "whatsapp",
            "metadata": {
              "display_phone_number": "15551234567",
              "phone_number_id": "PHONE_NUMBER_ID"
            },
            "messages": [
              {
                "from": "237677123456",
                "id": "wamid.XXX",
                "timestamp": "1234567890",
                "type": "text",
                "text": {
                  "body": "hi"
                }
              }
            ]
          },
          "field": "messages"
        }
      ]
    }
  ]
}
```

**Response:**

```
OK
```

**Status Codes:**
- `200 OK` - Message received and processed

**Conversation Flow:**

1. **User sends "hi", "hello", "start", or "reset"**
   - Bot responds with main menu (interactive buttons)
   - Options: "Start a Wash" or "Check Status"

2. **User selects "Start a Wash"**
   - Bot displays available machines (interactive buttons)
   - Options: "Washer 1 (Available)", "Washer 2 (Available)"

3. **User selects a machine**
   - Bot displays cycle options (interactive buttons)
   - Options: "30 Mins (1000 XAF)", "60 Mins (2000 XAF)"

4. **User selects a cycle**
   - Bot initiates payment via Campay
   - User receives USSD prompt on their phone
   - User enters PIN to complete payment

5. **Payment confirmed (via Campay webhook)**
   - Bot sends confirmation message
   - Machine starts automatically via MQTT

**Error Handling:**

The bot provides clear error messages for common issues:
- ER102: Unsupported carrier (not MTN/Orange)
- ER101: Invalid phone number format
- ER103: Insufficient balance
- ER104: Transaction limit exceeded
- ER105: Inactive mobile money account
- ER106: Payment declined

---

## Error Codes

### Campay Error Codes

| Code | Message | User-Friendly Description |
|------|---------|---------------------------|
| ER101 | Invalid Phone Number | The phone number format is incorrect. Please make sure you entered the correct number. |
| ER102 | Unsupported Carrier | Sorry, we can only accept MTN Mobile Money or Orange Money. Your number appears to be from a different network. |
| ER103 | Insufficient Balance | You don't have enough money in your mobile money account. Please add funds and try again. |
| ER104 | Transaction Limit Exceeded | This amount exceeds your daily transaction limit. Please try a smaller amount or contact your network provider. |
| ER105 | Inactive Account | Your mobile money account is not activated. Please activate it with your network provider first. |
| ER106 | Payment Declined | The payment was declined. Please check with your network provider and try again. |

### HTTP Status Codes

| Code | Description |
|------|-------------|
| 200 | OK - Request successful |
| 400 | Bad Request - Missing or invalid parameters |
| 403 | Forbidden - Invalid webhook verification token |
| 500 | Internal Server Error - Server-side error |

---

## Data Models

### Transaction Model

```javascript
{
  externalReference: String (UUID),  // Our unique ID
  amount: Number,                    // Amount in XAF
  phoneNumber: String,               // User's phone (237XXXXXXXXX)
  machineId: String,                 // Machine identifier
  pulseCount: Number,                // Number of pulses for machine
  description: String,               // Payment description
  status: String,                    // PENDING | SUCCESSFUL | FAILED
  campayReference: String,           // Reference from Campay
  createdAt: Date,                   // Auto-generated
  updatedAt: Date                    // Auto-generated
}
```

### Session State Model (In-Memory)

```javascript
{
  phoneNumber: {
    step: String,        // Current conversation step
    machineId: String,   // Selected machine
    // Other temporary data
  }
}
```

**Session Steps:**
- `MAIN_MENU` - Initial state
- `AWAITING_MENU_CHOICE` - Waiting for user to select menu option
- `SELECT_CYCLE` - Waiting for user to select wash cycle
- `CONFIRM_PAY` - Processing payment

---

## Environment Configuration

### Environment-Specific Configuration

The API uses environment-specific configuration to support multiple deployment environments. Configuration is automatically selected based on the `NODE_ENV` variable.

| Environment | NODE_ENV | Campay API | Use Case |
|-------------|----------|------------|----------|
| Development | `development` | Sandbox (`demo.campay.net`) | Local development |
| Test | `test` | Sandbox (`demo.campay.net`) | CI/CD automated testing |
| Stage | `stage` | Production (`www.campay.net`) | Staging/UAT |
| Production | `production` | Production (`www.campay.net`) | Live production |

### Required Environment Variables

```bash
# Environment
NODE_ENV=development  # Options: development, test, stage, production

# Server Configuration
PORT=3000

# Database
MONGO_URI=mongodb://localhost:27017/laundry_db

# MQTT Broker
MQTT_BROKER_URL=mqtt://test.mosquitto.org

# Campay API Credentials
# For dev/test: Get from https://demo.campay.net
# For stage/prod: Get from https://www.campay.net
CAMPAY_APP_KEY=your_app_username
CAMPAY_APP_SECRET=your_app_password

# Meta (WhatsApp) API Credentials
WHATSAPP_TOKEN=your_whatsapp_access_token
WHATSAPP_PHONE_ID=your_phone_number_id
WHATSAPP_VERIFY_TOKEN=your_verify_token

# Business Configuration (Optional - defaults shown)
PRICE_SHORT_CYCLE=1000  # Price for 30-min cycle (XAF)
PRICE_LONG_CYCLE=2000   # Price for 60-min cycle (XAF)
MACHINE_IDS=washer_01,washer_02  # Available machines
```

### Configuration Details

**For complete configuration documentation, including:**
- Detailed variable descriptions
- Environment-specific setup guides
- Security best practices
- Deployment instructions

**See [CONFIGURATION.md](CONFIGURATION.md)**

### Sandbox vs Production

**Campay API URLs are automatically selected based on `NODE_ENV`:**

| NODE_ENV | Campay Base URL | Purpose |
|----------|----------------|---------|
| `development` | `https://demo.campay.net` | Local dev with sandbox API |
| `test` | `https://demo.campay.net` | CI/CD testing with sandbox |
| `stage` | `https://www.campay.net` | Staging with production API |
| `production` | `https://www.campay.net` | Live production |

**Development/Testing:**
- Automatically uses Campay sandbox: `https://demo.campay.net`
- Use Campay sandbox credentials from dashboard
- Test with MTN/Orange Cameroon numbers

**Stage/Production:**
- Automatically uses Campay production: `https://www.campay.net`
- Use production credentials from Campay production dashboard
- Obtain permanent WhatsApp access token (System User token)

---

## Rate Limits

### WhatsApp API Limits

- **Tier 1 (New Business)**: 1,000 conversations per 24 hours
- **Tier 2**: 10,000 conversations per 24 hours
- **Tier 3**: 100,000 conversations per 24 hours

### Campay API Limits

Refer to your Campay account dashboard for current rate limits.

---

## Security Considerations

1. **Webhook Verification**
   - Always verify the `hub.verify_token` for WhatsApp webhooks
   - Validate request signatures when available

2. **Environment Variables**
   - Never commit `.env` files to version control
   - Use secrets management in production

3. **Database**
   - MongoDB should be behind a firewall
   - Use authentication for MongoDB connections

4. **HTTPS**
   - Always use HTTPS in production
   - Ngrok provides HTTPS URLs for testing

---

## Testing

### Manual Testing with cURL

**Test Health Endpoint:**
```bash
curl http://localhost:3000/api/health
```

**Test Payment Endpoint:**
```bash
curl -X POST http://localhost:3000/api/pay \
  -H "Content-Type: application/json" \
  -d '{
    "phone": "237677123456",
    "amount": 1000,
    "machineId": "washer_01",
    "pulseCount": 1
  }'
```

### Automated Testing

```bash
npm test
```

---

## Support

For issues or questions:
- Check the main [README.md](README.md)
- Review the [Campay API Documentation](https://documenter.getpostman.com/view/2391374/T1LV8PVA)
- Review the [WhatsApp Business API Documentation](https://developers.facebook.com/docs/whatsapp)

---

## Changelog

### Version 1.0.0 (Sprint 3)
- WhatsApp chatbot integration
- Campay payment processing
- MQTT machine control
- MongoDB transaction tracking
- Comprehensive error handling with user-friendly messages
