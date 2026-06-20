*** Settings ***
Documentation     Integration tests for mobile money payment initiation.
...               Uses WireMock (port 9090) to mock CamPay, MTN MoMo,
...               and Orange Money provider APIs so no real money moves.
Library           RequestsLibrary
Library           Collections
Resource          ../keywords/common.robot
Resource          ../resources/variables.robot

Suite Setup       Create Session To Service
Suite Teardown    Delete Session To Service

*** Test Cases ***

TC01 - Initiate CamPay payment returns PENDING reference
    [Tags]    payment    campay    smoke
    ${result}=    Initiate Mobile Money Payment
    ...    phone=${CUSTOMER_PHONE_CAMPAY}    amount=${1500}    provider=${PROVIDER_CAMPAY}
    Should Be True                ${result}[success]
    Should Be Equal As Strings    ${result}[status]      PENDING
    Should Be Equal As Strings    ${result}[provider]    CAMPAY
    Should Not Be Empty           ${result}[externalReference]

TC02 - Initiate MTN MoMo payment returns PENDING reference
    [Tags]    payment    mtn    smoke
    ${result}=    Initiate Mobile Money Payment
    ...    phone=${CUSTOMER_PHONE_MTN}    amount=${1000}    provider=${PROVIDER_MTN}
    ...    machine_id=washer_02
    Should Be True                ${result}[success]
    Should Be Equal As Strings    ${result}[status]      PENDING
    Should Be Equal As Strings    ${result}[provider]    MTN

TC03 - Initiate Orange Money payment returns PENDING reference
    [Tags]    payment    orange    smoke
    ${result}=    Initiate Mobile Money Payment
    ...    phone=${CUSTOMER_PHONE_ORANGE}    amount=${2000}    provider=${PROVIDER_ORANGE}
    ...    machine_id=washer_03
    Should Be True                ${result}[success]
    Should Be Equal As Strings    ${result}[status]      PENDING
    Should Be Equal As Strings    ${result}[provider]    ORANGE_MONEY

TC04 - Payment request fails with missing required fields
    [Tags]    payment    validation    negative
    &{body}=    Create Dictionary    amount=${1000}    provider=CAMPAY
    POST On Session    payment    /api/payments/initiate    json=${body}    expected_status=400

TC05 - Get transaction by reference returns payment data
    [Tags]    payment    query    smoke
    # First create a payment to get a reference
    ${result}=    Initiate Mobile Money Payment
    ...    phone=${CUSTOMER_PHONE_CAMPAY}    amount=${1500}    provider=${PROVIDER_CAMPAY}
    ...    machine_id=dryer_01
    ${ref}=    Set Variable    ${result}[externalReference]
    # Now retrieve it
    ${resp}=    GET On Session    payment    /api/payments/transaction/${ref}    expected_status=200
    ${tx}=    Set Variable    ${resp.json()}
    Should Be Equal As Strings    ${tx}[externalReference]    ${ref}

TC06 - Get transactions for a machine returns a list
    [Tags]    payment    query
    ${resp}=    GET On Session    payment    /api/payments/machine/washer_01    expected_status=200
    ${list}=    Set Variable    ${resp.json()}
    # At least TC01 created a transaction for washer_01
    Should Not Be Empty    ${list}

TC07 - Provider status endpoint reports which providers are configured
    [Tags]    payment    providers    smoke
    ${resp}=    GET On Session    payment    /api/payments/providers/status    expected_status=200
    ${status}=    Set Variable    ${resp.json()}
    Dictionary Should Contain Key    ${status}    campay
    Dictionary Should Contain Key    ${status}    mtn
    Dictionary Should Contain Key    ${status}    orange_money
