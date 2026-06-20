*** Settings ***
Library     RequestsLibrary
Library     JSONLibrary
Library     Collections
Resource    ../resources/variables.robot

*** Keywords ***

# ── Auth0 token acquisition ────────────────────────────────────────────────────

Get Auth0 Bearer Token
    [Documentation]
    ...    Requests an M2M access token from Auth0 using client_credentials.
    ...    Credentials default to the dev tenant values in variables.robot;
    ...    override AUTH0_CLIENT_ID / AUTH0_CLIENT_SECRET via --variable for staging/prod.
    [Arguments]    ${scope}=${AUTH0_SCOPE}
    Create Session    _auth0    https://dev-iuo6si32jobgnmod.eu.auth0.com    verify=True
    &{body}=    Create Dictionary
    ...    client_id=${AUTH0_CLIENT_ID}
    ...    client_secret=${AUTH0_CLIENT_SECRET}
    ...    audience=${AUTH0_AUDIENCE}
    ...    grant_type=client_credentials
    ...    scope=${scope}
    ${resp}=    POST On Session    _auth0    /oauth/token
    ...    json=${body}    expected_status=200
    ${token}=    Set Variable    ${resp.json()}[access_token]
    Delete All Sessions
    RETURN    ${token}

# ── Session management ─────────────────────────────────────────────────────────

Create Session To Bot
    [Documentation]
    ...    Opens an authenticated HTTP session to spring-bot-manager-only.
    ...    Fetches a Bearer token from Auth0 and sets it as the default header.
    ...    Webhook endpoints are public but the token is harmless to include.
    ${token}=    Get Auth0 Bearer Token
    &{headers}=    Create Dictionary
    ...    Authorization=Bearer ${token}
    ...    Content-Type=application/json
    Create Session    bot    ${BASE_URL}    headers=${headers}    verify=False

Create Public Session To Bot
    [Documentation]    Opens a session without Bearer token (for webhook verification tests)
    Create Session    bot    ${BASE_URL}    verify=False

Delete Session To Bot
    Delete All Sessions

# ── WhatsApp helpers ───────────────────────────────────────────────────────────

Build WhatsApp Text Message Payload
    [Arguments]    ${from_number}=${CUSTOMER_PHONE}    ${message_text}=hello
    ...            ${phone_number_id}=${PHONE_NUMBER_ID}
    ${payload}=    Evaluate
    ...    {"object": "whatsapp_business_account", "entry": [{"id": "ENTRY-1", "changes": [{"value": {"messaging_product": "whatsapp", "metadata": {"display_phone_number": "237650000000", "phone_number_id": "${phone_number_id}"}, "contacts": [{"profile": {"name": "Test User"}, "wa_id": "${from_number}"}], "messages": [{"from": "${from_number}", "id": "wamid.TEST001", "timestamp": "1700000000", "text": {"body": "${message_text}"}, "type": "text"}]}, "field": "messages"}]}]}
    RETURN    ${payload}

Build WhatsApp Button Reply Payload
    [Arguments]    ${from_number}=${CUSTOMER_PHONE}    ${button_id}=action_wash
    ...            ${phone_number_id}=${PHONE_NUMBER_ID}
    ${payload}=    Evaluate
    ...    {"object": "whatsapp_business_account", "entry": [{"id": "ENTRY-1", "changes": [{"value": {"messaging_product": "whatsapp", "metadata": {"display_phone_number": "237650000000", "phone_number_id": "${phone_number_id}"}, "contacts": [{"profile": {"name": "Test User"}, "wa_id": "${from_number}"}], "messages": [{"from": "${from_number}", "id": "wamid.TEST002", "timestamp": "1700000000", "interactive": {"type": "button_reply", "button_reply": {"id": "${button_id}", "title": "Start Wash"}}, "type": "interactive"}]}, "field": "messages"}]}]}
    RETURN    ${payload}

Post WhatsApp Webhook
    [Documentation]    The webhook endpoint returns a plain-text body ("EVENT_RECEIVED"), not JSON.
    [Arguments]    ${payload}
    ${resp}=    POST On Session    bot    /api/whatsapp/webhook    json=${payload}    expected_status=200
    RETURN    ${resp.text}

# ── Machine proxy helpers ──────────────────────────────────────────────────────

Get Machines For Bot
    [Arguments]    ${bot_id}=${BOT_ID}
    ${resp}=    GET On Session    bot    /api/machines/${bot_id}    expected_status=200
    RETURN    ${resp.json()}

Get Machine For Bot
    [Arguments]    ${bot_id}    ${machine_id}
    ${resp}=    GET On Session    bot    /api/machines/${bot_id}/${machine_id}    expected_status=200
    RETURN    ${resp.json()}

Get Available Machines For Bot
    [Arguments]    ${bot_id}=${BOT_ID}
    ${resp}=    GET On Session    bot    /api/machines/${bot_id}/available    expected_status=200
    RETURN    ${resp.json()}

# ── Payment webhook helpers ────────────────────────────────────────────────────

Post CamPay Webhook For Bot
    [Arguments]    ${bot_id}    ${payload}
    ${resp}=    POST On Session    bot    /api/payments/webhooks/campay/${bot_id}
    ...    json=${payload}    expected_status=200
    RETURN    ${resp.json()}