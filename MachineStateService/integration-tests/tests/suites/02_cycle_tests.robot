*** Settings ***
Documentation     Integration tests for machine cycle management.
...               Covers starting cycles, state transitions, MQTT command dispatch,
...               and conflict detection (busy machine rejection).
Library           RequestsLibrary
Library           Collections
Resource          ../keywords/common.robot
Resource          ../resources/variables.robot

Suite Setup       Create Session To Service
Suite Teardown    Delete Session To Service

*** Variables ***
${CYCLE_MACHINE}        washer_03
${CYCLE_MACHINE_2}      washer_04

*** Test Cases ***

TC01 - Start a cycle on an IDLE machine succeeds
    [Tags]    cycle    smoke    start
    ${cycle}=    Start Cycle    ${CYCLE_MACHINE}
    Should Be Equal As Strings    ${cycle}[machineId]     ${CYCLE_MACHINE}
    Should Be Equal As Strings    ${cycle}[status]        IN_PROGRESS
    Should Not Be Equal            ${cycle}[startedAt]    ${None}
    Should Not Be Equal            ${cycle}[endsAt]    ${None}
    Should Be True                ${cycle}[durationMinutes] == 30

TC02 - Machine status is RUNNING after cycle start
    [Tags]    cycle    smoke    status
    ${machine}=    Get Machine By Id    ${CYCLE_MACHINE}
    Should Be Equal As Strings    ${machine}[status]     RUNNING
    Should Not Be True            ${machine}[available]
    Should Be True                ${machine}[doorLocked]

TC03 - Cannot start a second cycle on a RUNNING machine
    [Tags]    cycle    negative    conflict
    &{payload}=    Create Dictionary
    ...    machineId=${CYCLE_MACHINE}    cycleType=NORMAL    durationMinutes=${30}    pulseCount=${1}
    ${resp}=    POST On Session    machine    /api/machines/start-cycle
    ...    json=${payload}
    ...    expected_status=409
    ${body}=    Set Variable    ${resp.json()}
    Should Be Equal As Strings    ${body}[error]    MACHINE_NOT_AVAILABLE

TC04 - Machine has cycle in its history after start
    [Tags]    cycle    history
    ${cycles}=    Get Machine Cycles    ${CYCLE_MACHINE}
    Should Not Be Empty    ${cycles}
    Should Be Equal As Strings    ${cycles}[0][machineId]    ${CYCLE_MACHINE}
    Should Be Equal As Strings    ${cycles}[0][status]       IN_PROGRESS

TC05 - Machine events log records STATUS_CHANGE for cycle start
    [Tags]    cycle    events
    ${events}=    Get Machine Events    ${CYCLE_MACHINE}
    Should Not Be Empty    ${events}
    ${event_types}=    Evaluate    [e['eventType'] for e in $events]
    List Should Contain Value    ${event_types}    CYCLE_STARTED

TC06 - Start a Cotton 60 cycle with custom duration and pulses
    [Tags]    cycle    programs
    ${cycle}=    Start Cycle
    ...    machine_id=${CYCLE_MACHINE_2}
    ...    cycle_type=${CYCLE_TYPE_COTTON}
    ...    duration=${DURATION_60}
    ...    pulse_count=${PULSE_2}
    ...    rfid_uid=UID-CYCLE-TEST-001
    ...    tx_ref=txn-cycle-cotton-001
    Should Be Equal As Strings    ${cycle}[machineId]         ${CYCLE_MACHINE_2}
    Should Be True                ${cycle}[durationMinutes] == 60
    Should Be True                ${cycle}[pulseCount] == 2

TC07 - Start cycle fails for unknown machine
    [Tags]    cycle    negative    validation
    &{payload}=    Create Dictionary
    ...    machineId=${MACHINE_UNKNOWN}    cycleType=NORMAL    durationMinutes=${30}    pulseCount=${1}
    ${resp}=    POST On Session    machine    /api/machines/start-cycle
    ...    json=${payload}
    ...    expected_status=404
    ${body}=    Set Variable    ${resp.json()}
    Should Be Equal As Strings    ${body}[error]    MACHINE_NOT_FOUND

TC08 - Start cycle fails with missing required fields
    [Tags]    cycle    negative    validation
    &{payload}=    Create Dictionary    cycleType=NORMAL
    POST On Session    machine    /api/machines/start-cycle
    ...    json=${payload}    expected_status=400

TC09 - Send stop command to a running machine
    [Tags]    cycle    command
    # ${CYCLE_MACHINE} is still RUNNING from TC01
    ${resp}=    POST On Session    machine
    ...    /api/machines/${CYCLE_MACHINE}/command/stop    expected_status=200
    ${body}=    Set Variable    ${resp.json()}
    Should Be Equal As Strings    ${body}[status]      sent
    Should Be Equal As Strings    ${body}[action]      stop
    Should Be Equal As Strings    ${body}[machineId]   ${CYCLE_MACHINE}

TC10 - Send status command to any machine
    [Tags]    cycle    command
    ${resp}=    POST On Session    machine
    ...    /api/machines/${MACHINE_WASHER}/command/status    expected_status=200
    ${body}=    Set Variable    ${resp.json()}
    Should Be Equal As Strings    ${body}[status]    sent
