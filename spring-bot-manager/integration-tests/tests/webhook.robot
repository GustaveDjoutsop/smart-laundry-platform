*** Settings ***
Library    RequestsLibrary
Library    Collections

Suite Setup    Create Session    app    http://${APP_HOST}:${APP_PORT}

*** Variables ***
${APP_HOST}    localhost
${APP_PORT}    3000

*** Test Cases ***
WhatsApp Webhook Verification Requires Valid Token
    ${params}=    Create Dictionary    hub.mode=subscribe    hub.verify_token=invalid_token    hub.challenge=test_challenge
    ${response}=    GET On Session    app    /api/whatsapp/webhook    params=${params}    expected_status=403

WhatsApp Webhook POST Requires Valid Body
    ${headers}=    Create Dictionary    Content-Type=application/json
    ${body}=    Create Dictionary    object=whatsapp_business_account
    ${response}=    POST On Session    app    /api/whatsapp/webhook    json=${body}    headers=${headers}
    Should Be Equal As Strings    ${response.status_code}    200
