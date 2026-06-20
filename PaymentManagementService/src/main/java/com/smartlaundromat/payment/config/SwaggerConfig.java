package com.smartlaundromat.payment.config;

import io.swagger.v3.oas.annotations.enums.SecuritySchemeType;
import io.swagger.v3.oas.annotations.security.OAuthFlow;
import io.swagger.v3.oas.annotations.security.OAuthFlows;
import io.swagger.v3.oas.annotations.security.OAuthScope;
import io.swagger.v3.oas.annotations.security.SecurityScheme;
import io.swagger.v3.oas.models.OpenAPI;
import io.swagger.v3.oas.models.info.Contact;
import io.swagger.v3.oas.models.info.Info;
import io.swagger.v3.oas.models.info.License;
import io.swagger.v3.oas.models.servers.Server;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

import java.util.List;

@Configuration(proxyBeanMethods = false)
@SecurityScheme(
    name = "auth0",
    type = SecuritySchemeType.OAUTH2,
    flows = @OAuthFlows(
        clientCredentials = @OAuthFlow(
            tokenUrl = "https://dev-iuo6si32jobgnmod.eu.auth0.com/oauth/token",
            scopes = {
                @OAuthScope(name = "sls-rfid-read",        description = "Read RFID card info and balance"),
                @OAuthScope(name = "sls-rfid-manage",      description = "Register, activate, deactivate RFID cards"),
                @OAuthScope(name = "sls-rfid-debit",       description = "Debit an RFID card balance (ESP32 / machine)"),
                @OAuthScope(name = "sls-payment-read",     description = "Read transaction history and payment status"),
                @OAuthScope(name = "sls-payment-initiate", description = "Initiate a mobile money payment request"),
                @OAuthScope(name = "sls-topup-manage",     description = "Create top-ups and read top-up history")
            }
        )
    )
)
public class SwaggerConfig {

    @Value("${server.port:8081}")
    private String serverPort;

    @Bean
    public OpenAPI openAPI() {
        return new OpenAPI()
            .info(new Info()
                .title("PaymentManagementService API")
                .version("1.0.0")
                .description("""
                    REST API for the SmartLaundromat payment microservice.

                    Handles:
                    - **RFID card accounts** – register cards, check balance, debit per wash cycle, top-up
                    - **Mobile money payments** – CamPay, MTN MoMo, Orange Money
                    - **Provider webhooks** – ingest payment callbacks and update transaction state

                    ### Authentication
                    All endpoints (except webhooks and docs) require a **Bearer token** issued by Auth0.
                    Obtain a token via the `client_credentials` grant:
                    ```bash
                    curl --request POST \\
                      --url https://dev-iuo6si32jobgnmod.eu.auth0.com/oauth/token \\
                      --header 'content-type: application/json' \\
                      --data '{
                        "client_id":     "<your-client-id>",
                        "client_secret": "<your-client-secret>",
                        "audience":      "https://smartlaundry.api",
                        "grant_type":    "client_credentials",
                        "scope":         "sls-rfid-read sls-payment-read"
                      }'
                    ```
                    """)
                .contact(new Contact()
                    .name("SmartLaundromat Team")
                    .email("dev@smartlaundromat.cm"))
                .license(new License().name("MIT").url("https://opensource.org/licenses/MIT"))
            )
            .servers(List.of(
                new Server().url("http://localhost:" + serverPort).description("Local / Dev"),
                new Server().url("https://api.smartlaundromat.cm/payment").description("Production")
            ));
    }
}
