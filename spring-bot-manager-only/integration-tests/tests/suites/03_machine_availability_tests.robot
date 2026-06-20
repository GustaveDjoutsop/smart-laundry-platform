*** Settings ***
Documentation     Integration tests for machine availability proxying.
...               The bot exposes /api/machines/{botId}/* endpoints that proxy to
...               MachineStateService. WireMock (port 9092) mocks the machine service
...               so tests are deterministic and do not need a running MachineStateService.
Library           RequestsLibrary
Library           Collections
Resource          ../keywords/common.robot
Resource          ../resources/variables.robot

Suite Setup       Create Session To Bot
Suite Teardown    Delete Session To Bot

*** Test Cases ***

TC01 - Get all machines for bot returns proxy response from MachineStateService
    [Tags]    machine    smoke    proxy
    ${machines}=    Get Machines For Bot    ${BOT_ID}
    Should Not Be Empty    ${machines}

TC02 - Response contains at least one AVAILABLE machine
    [Tags]    machine    status    smoke
    [Documentation]    The bot maps MachineStateService's "IDLE"/available=true to its own
    ...    MachineStatus.AVAILABLE — see MachineService.mapMachineFromResponse.
    ${machines}=    Get Machines For Bot    ${BOT_ID}
    ${idle_machines}=    Evaluate
    ...    [m for m in $machines if m.get('status') == 'AVAILABLE']
    Should Not Be Empty    ${idle_machines}

TC03 - Response contains at least one IN_USE machine
    [Tags]    machine    status
    [Documentation]    The bot maps MachineStateService's "RUNNING"/available=false to its own
    ...    MachineStatus.IN_USE — see MachineService.mapMachineFromResponse.
    ${machines}=    Get Machines For Bot    ${BOT_ID}
    ${running}=    Evaluate
    ...    [m for m in $machines if m.get('status') == 'IN_USE']
    Should Not Be Empty    ${running}

TC04 - Get single machine for bot returns machine record
    [Tags]    machine    smoke    single
    ${machine}=    Get Machine For Bot    ${BOT_ID}    ${MACHINE_WASHER_1}
    Should Be Equal As Strings    ${machine}[machineId]    ${MACHINE_WASHER_1}
    Should Be Equal As Strings    ${machine}[status]       AVAILABLE

TC05 - Get available machines for bot filters correctly
    [Tags]    machine    available    smoke
    ${available}=    Get Available Machines For Bot    ${BOT_ID}
    Should Not Be Empty    ${available}
    FOR    ${machine}    IN    @{available}
        Should Be Equal As Strings    ${machine}[status]    AVAILABLE
    END

TC06 - Running machine is not in available list
    [Tags]    machine    available
    ${available}=    Get Available Machines For Bot    ${BOT_ID}
    ${ids}=    Evaluate    [m['machineId'] for m in $available]
    # washer_02 is RUNNING in the WireMock stub — should not be in available list
    List Should Not Contain Value    ${ids}    ${MACHINE_WASHER_2}

TC07 - Machine type is correctly proxied
    [Tags]    machine    data
    ${machine}=    Get Machine For Bot    ${BOT_ID}    ${MACHINE_WASHER_1}
    Should Be Equal As Strings    ${machine}[type]    WASHER
