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

Create Session To Service
    [Documentation]
    ...    Opens an authenticated HTTP session to MachineStateService.
    ...    Fetches a Bearer token from Auth0 and sets it as the default header.
    ${token}=    Get Auth0 Bearer Token
    &{headers}=    Create Dictionary
    ...    Authorization=Bearer ${token}
    ...    Content-Type=application/json
    Create Session    machine    ${BASE_URL}    headers=${headers}    verify=False

Delete Session To Service
    Delete All Sessions

# ── Machine queries ────────────────────────────────────────────────────────────

Get All Machines
    ${resp}=    GET On Session    machine    /api/machines    expected_status=200
    RETURN    ${resp.json()}

Get Machine By Id
    [Arguments]    ${machine_id}
    ${resp}=    GET On Session    machine    /api/machines/${machine_id}    expected_status=200
    RETURN    ${resp.json()}

Get Machine By Id Expecting Error
    [Arguments]    ${machine_id}    ${expected_status}
    ${resp}=    GET On Session    machine    /api/machines/${machine_id}
    ...    expected_status=${expected_status}
    RETURN    ${resp.json()}

Start Cycle
    [Arguments]    ${machine_id}    ${cycle_type}=${CYCLE_TYPE_NORMAL}
    ...            ${duration}=${DURATION_30}    ${pulse_count}=${PULSE_1}
    ...            ${rfid_uid}=${RFID_UID}    ${tx_ref}=${TX_REF}
    &{body}=    Create Dictionary
    ...    machineId=${machine_id}
    ...    cycleType=${cycle_type}
    ...    durationMinutes=${duration}
    ...    pulseCount=${pulse_count}
    ...    rfidCardUid=${rfid_uid}
    ...    transactionReference=${tx_ref}
    ${resp}=    POST On Session    machine    /api/machines/start-cycle    json=${body}    expected_status=200
    RETURN    ${resp.json()}

Start Cycle Expecting Error
    [Arguments]    ${machine_id}    ${expected_status}
    &{body}=    Create Dictionary
    ...    machineId=${machine_id}
    ...    cycleType=${CYCLE_TYPE_NORMAL}
    ...    durationMinutes=${DURATION_30}
    ...    pulseCount=${PULSE_1}
    ${resp}=    POST On Session    machine    /api/machines/start-cycle
    ...    json=${body}    expected_status=${expected_status}
    RETURN    ${resp.json()}

Post Telemetry
    [Arguments]    ${machine_id}    ${status}    ${cycle_type}=NONE    ${progress}=${0}
    ...            ${temperature}=${None}    ${door_locked}=${False}
    &{body}=    Create Dictionary
    ...    machineId=${machine_id}
    ...    status=${status}
    ...    cycleType=${cycle_type}
    ...    cycleProgress=${progress}
    ...    doorLocked=${door_locked}
    IF    $temperature is not None
        Set To Dictionary    ${body}    temperature=${temperature}
    END
    ${resp}=    POST On Session    machine    /api/esp32/telemetry    json=${body}    expected_status=200
    RETURN    ${resp.json()}

Get Machine Events
    [Arguments]    ${machine_id}
    ${resp}=    GET On Session    machine    /api/machines/${machine_id}/events    expected_status=200
    RETURN    ${resp.json()}

Get Machine Cycles
    [Arguments]    ${machine_id}
    ${resp}=    GET On Session    machine    /api/machines/${machine_id}/cycles    expected_status=200
    RETURN    ${resp.json()}

Get Mqtt Status
    ${resp}=    GET On Session    machine    /api/esp32/mqtt/status    expected_status=200
    RETURN    ${resp.json()}
