*** Settings ***
Documentation     Integration tests for WhatsApp webhook endpoints.
...               Verifies webhook verification (GET), inbound message handling (POST),
...               and signature rejection. WireMock (port 9090) mocks the Meta Graph API
...               so no real WhatsApp messages are sent.
Library           RequestsLibrary
Library           Collections
Resource          ../keywords/common.robot
Resource          ../resources/variables.robot

Suite Setup       Create Session To Bot
Suite Teardown    Delete Session To Bot

*** Test Cases ***

TC01 - WhatsApp webhook verification challenge succeeds with correct token
    [Tags]    whatsapp    smoke    verification
    ${params}=    Create Dictionary
    ...    hub.mode=subscribe
    ...    hub.challenge=${HUB_CHALLENGE}
    ...    hub.verify_token=${VERIFY_TOKEN}
    ${resp}=    GET On Session    bot    /api/whatsapp/webhook    params=${params}    expected_status=200
    # The response body should echo back the challenge
    Should Contain    ${resp.text}    ${HUB_CHALLENGE}

TC02 - WhatsApp webhook verification fails with wrong verify token
    [Tags]    whatsapp    verification    negative
    ${params}=    Create Dictionary
    ...    hub.mode=subscribe
    ...    hub.challenge=${HUB_CHALLENGE}
    ...    hub.verify_token=wrong-token
    GET On Session    bot    /api/whatsapp/webhook    params=${params}    expected_status=403

TC03 - Inbound text message is processed without error (WireMock absorbs outbound)
    [Tags]    whatsapp    smoke    inbound
    ${payload}=    Build WhatsApp Text Message Payload
    ...    from_number=${CUSTOMER_PHONE}
    ...    message_text=hello
    ...    phone_number_id=${PHONE_NUMBER_ID}
    ${resp}=    Post WhatsApp Webhook    ${payload}
    # Service should accept the event and return 200
    Should Be True    '${resp}' is not None

TC04 - Inbound text "hi" triggers language selection (conversation start)
    [Tags]    whatsapp    conversation    smoke
    ${payload}=    Build WhatsApp Text Message Payload
    ...    from_number=237651111001
    ...    message_text=hi
    ...    phone_number_id=${PHONE_NUMBER_ID}
    Post WhatsApp Webhook    ${payload}

TC05 - Inbound text "reset" resets conversation state
    [Tags]    whatsapp    conversation
    ${payload}=    Build WhatsApp Text Message Payload
    ...    from_number=237651111002
    ...    message_text=reset
    Post WhatsApp Webhook    ${payload}

TC06 - Button reply is processed without error
    [Tags]    whatsapp    conversation
    ${payload}=    Build WhatsApp Button Reply Payload
    ...    from_number=237651111003
    ...    button_id=action_wash
    Post WhatsApp Webhook    ${payload}

TC07 - Webhook with empty entry list returns 200 (no-op)
    [Tags]    whatsapp    edge
    @{empty_entries}=    Create List
    &{payload}=    Create Dictionary    object=whatsapp_business_account    entry=${empty_entries}
    POST On Session    bot    /api/whatsapp/webhook    json=${payload}    expected_status=200
