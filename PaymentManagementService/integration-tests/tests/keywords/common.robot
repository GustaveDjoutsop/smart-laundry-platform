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
    ...    Returns the raw access_token string.
    ...    Credentials default to the dev tenant values in variables.robot;
    ...    override AUTH0_CLIENT_ID / AUTH0_CLIENT_SECRET via --variable for other envs.
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

Create Session To Service
    [Documentation]
    ...    Opens an authenticated HTTP session to the PaymentManagementService.
    ...    Fetches a Bearer token from Auth0 and sets it as the default
    ...    Authorization header so every subsequent request is authenticated.
    ${token}=    Get Auth0 Bearer Token
    &{headers}=    Create Dictionary
    ...    Authorization=Bearer ${token}
    ...    Content-Type=application/json
    Create Session    payment    ${BASE_URL}    headers=${headers}    verify=False

Create Public Session To Service
    [Documentation]
    ...    Opens an unauthenticated session used for webhook tests
    ...    (webhooks are public — no Bearer token required).
    Create Session    payment    ${BASE_URL}    verify=False

Delete Session To Service
    Delete All Sessions

# ── RFID helpers ───────────────────────────────────────────────────────────────

Register RFID Card
    [Arguments]    ${card_uid}    ${owner_name}=${CARD_OWNER}    ${phone}=${CARD_PHONE}
    &{body}=    Create Dictionary
    ...    cardUid=${card_uid}
    ...    ownerName=${owner_name}
    ...    phoneNumber=${phone}
    ${resp}=    POST On Session    payment    /api/rfid/register    json=${body}    expected_status=201
    RETURN    ${resp.json()}

Get Card Balance
    [Arguments]    ${card_uid}    ${required_amount}=${NONE}
    IF    $required_amount is not None
        ${resp}=    GET On Session    payment    /api/rfid/balance/${card_uid}
        ...    params=requiredAmount=${required_amount}    expected_status=200
    ELSE
        ${resp}=    GET On Session    payment    /api/rfid/balance/${card_uid}    expected_status=200
    END
    RETURN    ${resp.json()}

Debit Card
    [Arguments]    ${card_uid}    ${amount}    ${machine_id}=${MACHINE_ID}
    ...            ${pulse_count}=${PULSE_COUNT}    ${cycle_duration}=${CYCLE_DURATION}
    &{body}=    Create Dictionary
    ...    cardUid=${card_uid}
    ...    amount=${amount}
    ...    machineId=${machine_id}
    ...    pulseCount=${pulse_count}
    ...    cycleDuration=${cycle_duration}
    ...    description=Integration test debit
    ${resp}=    POST On Session    payment    /api/rfid/debit    json=${body}    expected_status=200
    RETURN    ${resp.json()}

Top Up Card With Cash
    [Arguments]    ${card_uid}    ${amount}
    &{body}=    Create Dictionary
    ...    cardUid=${card_uid}
    ...    amount=${amount}
    ...    channel=CASH
    ${resp}=    POST On Session    payment    /api/topup    json=${body}    expected_status=200
    RETURN    ${resp.json()}

Initiate Mobile Money Payment
    [Arguments]    ${phone}    ${amount}    ${provider}    ${machine_id}=${MACHINE_ID}
    &{body}=    Create Dictionary
    ...    phoneNumber=${phone}
    ...    amount=${amount}
    ...    machineId=${machine_id}
    ...    pulseCount=${PULSE_COUNT}
    ...    cycleDuration=${CYCLE_DURATION}
    ...    provider=${provider}
    ...    description=Integration test payment
    ${resp}=    POST On Session    payment    /api/payments/initiate    json=${body}    expected_status=200
    RETURN    ${resp.json()}

Post Webhook
    [Documentation]    Posts a provider webhook using a separate public session (no token).
    ...    CamPay webhooks must carry a valid X-Campay-Signature (HMAC-SHA256 of the
    ...    raw body using CAMPAY_WEBHOOK_SECRET) — PaymentManagementService rejects
    ...    unsigned/invalid CamPay webhooks with 401, and rejects all CamPay webhooks
    ...    with 503 if CAMPAY_WEBHOOK_SECRET isn't configured on the service.
    [Arguments]    ${provider_path}    ${payload}
    Create Session    _webhook    ${BASE_URL}    verify=False
    IF    '${provider_path}' == 'campay'
        ${body}=    Evaluate    json.dumps($payload)    modules=json
        ${signature}=    Evaluate
        ...    hmac.new($CAMPAY_WEBHOOK_SECRET.encode(), $body.encode(), hashlib.sha256).hexdigest()
        ...    modules=hmac,hashlib
        &{headers}=    Create Dictionary    Content-Type=application/json    X-Campay-Signature=${signature}
        ${resp}=    POST On Session    _webhook    /api/webhook/${provider_path}
        ...    data=${body}    headers=${headers}    expected_status=200
    ELSE
        ${resp}=    POST On Session    _webhook    /api/webhook/${provider_path}    json=${payload}    expected_status=200
    END
    RETURN    ${resp.json()}
