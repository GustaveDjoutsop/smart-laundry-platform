*** Variables ***
${BASE_URL}                 http://localhost:8090
${WIREMOCK_META_URL}        http://localhost:9090
${WIREMOCK_PAYMENT_URL}     http://localhost:9091
${WIREMOCK_MACHINE_URL}     http://localhost:9092
${CONTENT_TYPE}             application/json

# ── Auth0 credentials (dev tenant) ───────────────────────────────────────────
# No credentials here — CI always passes AUTH0_CLIENT_ID/AUTH0_CLIENT_SECRET via
# --variable (see .github/workflows/pull-request.yml). To run locally, pass your
# own dev M2M credentials the same way: --variable AUTH0_CLIENT_ID:... etc.
${AUTH0_TOKEN_URL}          https://dev-iuo6si32jobgnmod.eu.auth0.com/oauth/token
${AUTH0_CLIENT_ID}          ${EMPTY}
${AUTH0_CLIENT_SECRET}      ${EMPTY}
${AUTH0_AUDIENCE}           https://smartlaundry.api
${AUTH0_SCOPE}              sls-machine-read sls-payment-read

# ── WhatsApp webhook test data ────────────────────────────────────────────────
${BOT_ID}                   laundry
# Must match configs/bots/laundry.bot.json's phoneNumberId — webhook routing
# (BotRegistry.getBotByPhoneId) keys off metadata.phone_number_id.
${PHONE_NUMBER_ID}          1089648187567384
${VERIFY_TOKEN}             test-verify-token
${HUB_CHALLENGE}            challenge-abc-123
${CUSTOMER_PHONE}           237650000001
${APP_SECRET}               test-app-secret

# ── Payment test data ─────────────────────────────────────────────────────────
${MACHINE_ID}               washer_01
${PAYMENT_AMOUNT}           ${1000}
${TX_REF}                   ext-ref-mock-001

# ── Machine test data ─────────────────────────────────────────────────────────
${MACHINE_WASHER_1}         washer_01
${MACHINE_WASHER_2}         washer_02