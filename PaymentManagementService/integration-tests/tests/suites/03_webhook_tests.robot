*** Settings ***
Documentation     Integration tests for payment provider webhook ingestion.
...               Simulates provider callbacks (CamPay, MTN, Orange) to verify
...               the service processes them and updates transaction state.
Library           RequestsLibrary
Library           Collections
Resource          ../keywords/common.robot
Resource          ../resources/variables.robot

Suite Setup       Run Keywords    Create Session To Service    AND    Setup Webhook Test Data
Suite Teardown    Delete Session To Service

*** Variables ***
${WEBHOOK_EXTERNAL_REF}     ${EMPTY}

*** Keywords ***
Setup Webhook Test Data
    [Documentation]    Creates a PENDING payment to be used in webhook tests
    # Create a card and top it up (not needed for mobile money, but ensures DB is seeded)
    Run Keyword And Ignore Error    Register RFID Card    UID-WEBHOOK-TEST
    # Initiate a payment — the externalReference from the response is what the webhook will target
    ${result}=    Initiate Mobile Money Payment
    ...    phone=${CUSTOMER_PHONE_CAMPAY}    amount=${1500}    provider=${PROVIDER_CAMPAY}
    ...    machine_id=washer_04
    Set Suite Variable    ${WEBHOOK_EXTERNAL_REF}    ${result}[externalReference]

*** Test Cases ***

TC01 - CamPay SUCCESSFUL webhook is accepted
    [Tags]    webhook    campay    smoke
    &{payload}=    Create Dictionary
    ...    reference=CAMP-REF-001
    ...    external_reference=${WEBHOOK_EXTERNAL_REF}
    ...    status=SUCCESSFUL
    ...    amount=1500
    ...    operator=MTN
    ${result}=    Post Webhook    campay    ${payload}
    Should Be Equal As Strings    ${result}[status]    received

TC02 - CamPay FAILED webhook is accepted and marks transaction
    [Tags]    webhook    campay    negative
    # Create a fresh payment to fail
    ${fresh}=    Initiate Mobile Money Payment
    ...    phone=${CUSTOMER_PHONE_CAMPAY}    amount=${1000}    provider=${PROVIDER_CAMPAY}
    ...    machine_id=washer_05
    &{payload}=    Create Dictionary
    ...    reference=CAMP-FAIL-001
    ...    external_reference=${fresh}[externalReference]
    ...    status=FAILED
    ...    reason=INSUFFICIENT_FUNDS
    ${result}=    Post Webhook    campay    ${payload}
    Should Be Equal As Strings    ${result}[status]    received

TC03 - MTN MoMo SUCCESSFUL webhook is accepted
    [Tags]    webhook    mtn    smoke
    ${mtn_tx}=    Initiate Mobile Money Payment
    ...    phone=${CUSTOMER_PHONE_MTN}    amount=${2000}    provider=${PROVIDER_MTN}
    ...    machine_id=washer_06
    &{payload}=    Create Dictionary
    ...    externalId=${mtn_tx}[externalReference]
    ...    status=SUCCESSFUL
    ...    financialTransactionId=MTN-FIN-TX-001
    ${result}=    Post Webhook    mtn    ${payload}
    Should Be Equal As Strings    ${result}[status]    received

TC04 - Orange Money SUCCESSFUL webhook is accepted
    [Tags]    webhook    orange    smoke
    ${orange_tx}=    Initiate Mobile Money Payment
    ...    phone=${CUSTOMER_PHONE_ORANGE}    amount=${1500}    provider=${PROVIDER_ORANGE}
    ...    machine_id=dryer_02
    &{payload}=    Create Dictionary
    ...    externalId=${orange_tx}[externalReference]
    ...    status=SUCCESSFUL
    ...    reference=ORANGE-PAY-DONE-001
    ${result}=    Post Webhook    orange    ${payload}
    Should Be Equal As Strings    ${result}[status]    received

TC05 - Duplicate SUCCESSFUL webhook is idempotent
    [Tags]    webhook    campay    idempotency
    # Send the same successful webhook twice — both should return 200 received
    &{payload}=    Create Dictionary
    ...    reference=CAMP-REF-001
    ...    external_reference=${WEBHOOK_EXTERNAL_REF}
    ...    status=SUCCESSFUL
    ...    amount=1500
    ${result1}=    Post Webhook    campay    ${payload}
    ${result2}=    Post Webhook    campay    ${payload}
    Should Be Equal As Strings    ${result1}[status]    received
    Should Be Equal As Strings    ${result2}[status]    received

TC06 - RFID card top-up via mobile money webhook confirms balance
    [Tags]    webhook    topup    rfid
    # Register a card, initiate mobile money top-up, confirm via webhook
    Register RFID Card    UID-TOPUP-WEBHOOK-01
    &{topup_body}=    Create Dictionary
    ...    cardUid=UID-TOPUP-WEBHOOK-01
    ...    amount=${3000}
    ...    channel=MTN
    ...    phoneNumber=${CUSTOMER_PHONE_MTN}
    ${topup}=    POST On Session    payment    /api/topup    json=${topup_body}    expected_status=200
    ${topup_ref}=    Set Variable    ${topup.json()}[reference]
    # Simulate webhook confirming top-up
    &{webhook_payload}=    Create Dictionary
    ...    externalId=${topup_ref}
    ...    status=SUCCESSFUL
    ...    financialTransactionId=MTN-TOPUP-FIN-001
    Post Webhook    mtn    ${webhook_payload}
    # Verify balance updated
    ${bal}=    Get Card Balance    UID-TOPUP-WEBHOOK-01
    Should Be Equal As Numbers    ${bal}[balance]    3000
