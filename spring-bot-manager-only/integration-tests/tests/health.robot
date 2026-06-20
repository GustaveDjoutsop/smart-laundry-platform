*** Settings ***
Library    RequestsLibrary
Library    Collections

Suite Setup    Create Session    app    http://${APP_HOST}:${HEALTH_PORT}

*** Variables ***
${APP_HOST}    localhost
${HEALTH_PORT}    8081

*** Test Cases ***
Health Endpoint Returns OK
    ${response}=    GET On Session    app    /actuator/health
    Should Be Equal As Strings    ${response.status_code}    200
    ${json}=    Set Variable    ${response.json()}
    Dictionary Should Contain Key    ${json}    status
