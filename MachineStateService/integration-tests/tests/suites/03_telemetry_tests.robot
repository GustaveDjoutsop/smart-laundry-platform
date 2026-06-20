*** Settings ***
Documentation     Integration tests for ESP32 telemetry ingestion (HTTP path).
...               Verifies that telemetry updates machine state, that events are
...               logged on status changes, and that the MQTT status endpoint
...               is reachable (broker may be absent in CI — that is expected).
Library           RequestsLibrary
Library           Collections
Resource          ../keywords/common.robot
Resource          ../resources/variables.robot

Suite Setup       Create Session To Service
Suite Teardown    Delete Session To Service

*** Variables ***
${TELEMETRY_MACHINE}    washer_05

*** Test Cases ***

TC01 - POST HTTP telemetry is accepted by the service
    [Tags]    telemetry    smoke    esp32
    ${result}=    Post Telemetry
    ...    machine_id=${TELEMETRY_MACHINE}
    ...    status=${TELEMETRY_STATUS_RUNNING}
    ...    cycle_type=NORMAL
    ...    progress=${TELEMETRY_PROGRESS}
    ...    temperature=${TELEMETRY_TEMP}
    ...    door_locked=${True}
    Should Be Equal As Strings    ${result}[status]    received

TC02 - Machine state is updated after telemetry ingestion
    [Tags]    telemetry    smoke    state
    ${machine}=    Get Machine By Id    ${TELEMETRY_MACHINE}
    Should Be Equal As Strings    ${machine}[status]      RUNNING
    Should Be True                ${machine}[doorLocked]
    Should Be Equal As Numbers    ${machine}[temperature]    ${TELEMETRY_TEMP}

TC03 - Telemetry with IDLE status resets machine to available
    [Tags]    telemetry    state
    ${result}=    Post Telemetry
    ...    machine_id=${TELEMETRY_MACHINE}
    ...    status=${TELEMETRY_STATUS_IDLE}
    ...    cycle_type=NONE
    ...    progress=${0}
    ...    door_locked=${False}
    Should Be Equal As Strings    ${result}[status]    received
    ${machine}=    Get Machine By Id    ${TELEMETRY_MACHINE}
    Should Be Equal As Strings    ${machine}[status]    IDLE

TC04 - Telemetry with ERROR status is recorded
    [Tags]    telemetry    error
    &{body}=    Create Dictionary
    ...    machineId=${TELEMETRY_MACHINE}
    ...    status=ERROR
    ...    errorCode=E_DOOR
    ...    errorMessage=Door sensor fault
    POST On Session    machine    /api/esp32/telemetry    json=${body}    expected_status=200
    ${machine}=    Get Machine By Id    ${TELEMETRY_MACHINE}
    Should Be Equal As Strings    ${machine}[status]    ERROR

TC05 - Status change via telemetry is recorded in events
    [Tags]    telemetry    events
    # Restore machine to IDLE first
    Post Telemetry    ${TELEMETRY_MACHINE}    IDLE
    ${events}=    Get Machine Events    ${TELEMETRY_MACHINE}
    Should Not Be Empty    ${events}
    ${event_types}=    Evaluate    [e['eventType'] for e in $events]
    List Should Contain Value    ${event_types}    STATUS_CHANGE

TC06 - Telemetry for unknown machine is silently ignored
    [Tags]    telemetry    negative
    &{body}=    Create Dictionary    machineId=unknown_ghost_machine    status=RUNNING
    # Service should return 200 received (no error thrown for unknown machines)
    ${resp}=    POST On Session    machine    /api/esp32/telemetry    json=${body}    expected_status=200
    Should Be Equal As Strings    ${resp.json()}[status]    received

TC07 - MQTT connection status endpoint is reachable
    [Tags]    telemetry    mqtt    smoke
    ${status}=    Get Mqtt Status
    Dictionary Should Contain Key    ${status}    connected
    # connected may be False in CI (no broker) — we only check the field exists

TC08 - Partial telemetry payload (only status) is accepted
    [Tags]    telemetry    partial
    &{body}=    Create Dictionary    machineId=${TELEMETRY_MACHINE}    status=IDLE
    ${resp}=    POST On Session    machine    /api/esp32/telemetry    json=${body}    expected_status=200
    Should Be Equal As Strings    ${resp.json()}[status]    received
