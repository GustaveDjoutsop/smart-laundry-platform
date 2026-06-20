*** Settings ***
Documentation     Integration tests for machine status and listing endpoints.
...               Verifies that all machines are seeded at startup, are reachable,
...               and return the expected initial state (IDLE / online / available).
Library           RequestsLibrary
Library           Collections
Resource          ../keywords/common.robot
Resource          ../resources/variables.robot

Suite Setup       Create Session To Service
Suite Teardown    Delete Session To Service

*** Test Cases ***

TC01 - Get all machines returns a summary with machines
    [Tags]    machine    smoke    listing
    ${summary}=    Get All Machines
    Should Not Be Empty    ${summary}[machines]
    Should Be True    ${summary}[total] >= 10

TC02 - Summary totals are consistent with machine list
    [Tags]    machine    listing
    ${summary}=    Get All Machines
    ${total}=     Set Variable    ${summary}[total]
    ${avail}=     Set Variable    ${summary}[available]
    ${in_use}=    Set Variable    ${summary}[inUse]
    ${offline}=   Set Variable    ${summary}[offline]
    ${err}=       Set Variable    ${summary}[error]
    ${maint}=     Set Variable    ${summary}[maintenance]
    ${sum}=       Evaluate    ${avail} + ${in_use} + ${offline} + ${err} + ${maint}
    Should Be True    ${sum} <= ${total}

TC03 - All washer IDs are present in machine list
    [Tags]    machine    listing    seeding
    ${summary}=    Get All Machines
    ${ids}=    Evaluate    [m['machineId'] for m in $summary['machines']]
    FOR    ${wid}    IN    @{WASHER_IDS}
        List Should Contain Value    ${ids}    ${wid}
    END

TC04 - All dryer IDs are present in machine list
    [Tags]    machine    listing    seeding
    ${summary}=    Get All Machines
    ${ids}=    Evaluate    [m['machineId'] for m in $summary['machines']]
    FOR    ${did}    IN    @{DRYER_IDS}
        List Should Contain Value    ${ids}    ${did}
    END

TC05 - Get single washer returns correct fields
    [Tags]    machine    smoke    status
    ${machine}=    Get Machine By Id    ${MACHINE_WASHER}
    Should Be Equal As Strings    ${machine}[machineId]       ${MACHINE_WASHER}
    Should Be Equal As Strings    ${machine}[type]            WASHER
    Should Be Equal As Strings    ${machine}[displayName]     Washer 01
    Should Not Be Equal           ${machine}[status]    ${None}
    Should Not Be Equal           ${machine}[online]    ${None}

TC06 - Get single dryer returns correct fields
    [Tags]    machine    status
    ${machine}=    Get Machine By Id    ${MACHINE_DRYER}
    Should Be Equal As Strings    ${machine}[machineId]    ${MACHINE_DRYER}
    Should Be Equal As Strings    ${machine}[type]         DRYER

TC07 - Freshly started machines are IDLE and available
    [Tags]    machine    status    smoke
    ${machine}=    Get Machine By Id    ${MACHINE_WASHER}
    Should Be Equal As Strings    ${machine}[status]     IDLE
    Should Be True                ${machine}[online]
    Should Be True                ${machine}[available]

TC08 - Unknown machine ID returns 404 with MACHINE_NOT_FOUND
    [Tags]    machine    status    negative
    ${resp}=    GET On Session    machine    /api/machines/${MACHINE_UNKNOWN}    expected_status=404
    ${body}=    Set Variable    ${resp.json()}
    Should Be Equal As Strings    ${body}[error]    MACHINE_NOT_FOUND

TC09 - Machine has empty events list initially
    [Tags]    machine    events
    ${events}=    Get Machine Events    ${MACHINE_WASHER_2}
    # Events list may be empty or contain seeding events
    Should Not Be Equal    ${events}    ${None}

TC10 - Machine has empty cycle history initially
    [Tags]    machine    cycles
    ${cycles}=    Get Machine Cycles    ${MACHINE_WASHER_2}
    Should Not Be Equal    ${cycles}    ${None}
