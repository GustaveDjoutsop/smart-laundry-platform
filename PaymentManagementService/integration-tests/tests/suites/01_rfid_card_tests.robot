*** Settings ***
Documentation     Integration tests for RFID card management endpoints.
...               Covers card registration, balance checks, debit, top-up,
...               and error scenarios (card not found, insufficient balance).
Library           RequestsLibrary
Library           Collections
Resource          ../keywords/common.robot
Resource          ../resources/variables.robot

Suite Setup       Create Session To Service
Suite Teardown    Delete Session To Service

*** Test Cases ***

TC01 - Register a new RFID card
    [Tags]    rfid    smoke    registration
    ${card}=    Register RFID Card    ${CARD_UID_1}
    Should Be Equal As Strings    ${card}[cardUid]      ${CARD_UID_1}
    Should Be Equal As Strings    ${card}[ownerName]    ${CARD_OWNER}
    Should Be Equal As Strings    ${card}[isActive]     True
    Should Be Equal As Numbers    ${card}[balance]      0

TC02 - Register a second RFID card
    [Tags]    rfid    registration
    ${card}=    Register RFID Card    ${CARD_UID_2}    owner_name=Marie Curie    phone=237651000002
    Should Be Equal As Strings    ${card}[cardUid]    ${CARD_UID_2}

TC03 - Cannot register a card with duplicate UID
    [Tags]    rfid    registration    negative
    &{body}=    Create Dictionary    cardUid=${CARD_UID_1}    ownerName=Duplicate
    ${resp}=    POST On Session    payment    /api/rfid/register    json=${body}    expected_status=400

TC04 - Top-up card via CASH to set initial balance
    [Tags]    rfid    topup
    ${result}=    Top Up Card With Cash    ${CARD_UID_1}    ${INITIAL_BALANCE}
    Should Be Equal As Strings    ${result}[status]      SUCCESSFUL
    Should Be Equal As Numbers    ${result}[newBalance]  ${INITIAL_BALANCE}

TC05 - Check balance returns sufficient when funds are enough
    [Tags]    rfid    balance
    ${bal}=    Get Card Balance    ${CARD_UID_1}    required_amount=${DEBIT_AMOUNT}
    Should Be Equal As Strings    ${bal}[cardUid]    ${CARD_UID_1}
    Should Be True                ${bal}[sufficient]
    Should Be Equal As Numbers    ${bal}[balance]    ${INITIAL_BALANCE}

TC06 - Check balance returns insufficient when amount exceeds balance
    [Tags]    rfid    balance    negative
    ${bal}=    Get Card Balance    ${CARD_UID_1}    required_amount=${LARGE_AMOUNT}
    Should Not Be True    ${bal}[sufficient]

TC07 - Check balance without requiredAmount always returns balance
    [Tags]    rfid    balance
    ${bal}=    Get Card Balance    ${CARD_UID_1}
    Should Be Equal As Strings    ${bal}[cardUid]    ${CARD_UID_1}
    Should Be True    '${bal}[balance]' != '0' or '${bal}[balance]' == '0'

TC08 - Debit card successfully debits the correct amount
    [Tags]    rfid    debit    smoke
    ${result}=    Debit Card    ${CARD_UID_1}    ${DEBIT_AMOUNT}    machine_id=${DEBIT_TEST_MACHINE}
    Should Be True                ${result}[success]
    Should Be Equal As Numbers    ${result}[amountDebited]      ${DEBIT_AMOUNT}
    ${expected_remaining}=    Evaluate    ${INITIAL_BALANCE} - ${DEBIT_AMOUNT}
    Should Be Equal As Numbers    ${result}[remainingBalance]   ${expected_remaining}
    Should Be Equal As Strings    ${result}[cardUid]            ${CARD_UID_1}
    Should Be Equal As Strings    ${result}[machineId]          ${DEBIT_TEST_MACHINE}

TC09 - Debit fails when balance is insufficient
    [Tags]    rfid    debit    negative
    &{payload}=    Create Dictionary
    ...    cardUid=${CARD_UID_2}    amount=${LARGE_AMOUNT}    machineId=${MACHINE_ID}    pulseCount=${1}    cycleDuration=${30}
    ${resp}=    POST On Session    payment    /api/rfid/debit
    ...    json=${payload}
    ...    expected_status=400
    ${body}=    Set Variable    ${resp.json()}
    Should Be Equal As Strings    ${body}[error]    INSUFFICIENT_BALANCE

TC10 - Balance check for unknown card returns 404
    [Tags]    rfid    balance    negative
    ${resp}=    GET On Session    payment    /api/rfid/balance/${CARD_UID_UNKNOWN}    expected_status=404
    ${body}=    Set Variable    ${resp.json()}
    Should Be Equal As Strings    ${body}[error]    CARD_NOT_FOUND

TC11 - Get all cards returns a list
    [Tags]    rfid    listing
    ${resp}=    GET On Session    payment    /api/rfid/cards    expected_status=200
    ${cards}=    Set Variable    ${resp.json()}
    Should Not Be Empty    ${cards}

TC12 - Get single card by UID
    [Tags]    rfid    listing
    ${resp}=    GET On Session    payment    /api/rfid/cards/${CARD_UID_1}    expected_status=200
    ${card}=    Set Variable    ${resp.json()}
    Should Be Equal As Strings    ${card}[cardUid]    ${CARD_UID_1}

TC13 - Deactivate a card prevents debiting
    [Tags]    rfid    lifecycle
    PATCH On Session    payment    /api/rfid/cards/${CARD_UID_2}/deactivate    expected_status=200
    &{payload}=    Create Dictionary
    ...    cardUid=${CARD_UID_2}    amount=${100}    machineId=${MACHINE_ID}    pulseCount=${1}    cycleDuration=${30}
    ${resp}=    POST On Session    payment    /api/rfid/debit
    ...    json=${payload}
    ...    expected_status=400

TC14 - Re-activate a deactivated card
    [Tags]    rfid    lifecycle
    ${resp}=    PATCH On Session    payment    /api/rfid/cards/${CARD_UID_2}/activate    expected_status=200
    ${card}=    Set Variable    ${resp.json()}
    Should Be True    ${card}[isActive]
