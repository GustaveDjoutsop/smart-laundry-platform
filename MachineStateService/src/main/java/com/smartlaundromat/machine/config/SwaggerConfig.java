package com.smartlaundromat.machine.config;

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
                @OAuthScope(name = "sls-machine-read",    description = "Read machine status, events, cycle history"),
                @OAuthScope(name = "sls-machine-start",   description = "Start a machine cycle (triggers MQTT pulse to ESP32)"),
                @OAuthScope(name = "sls-machine-command", description = "Send raw commands: stop, reset, status"),
                @OAuthScope(name = "sls-telemetry-write", description = "Submit ESP32 telemetry data via HTTP")
            }
        )
    )
)
public class SwaggerConfig {

    @Value("${server.port:8082}")
    private String serverPort;

    @Bean
    public OpenAPI openAPI() {
        return new OpenAPI()
            .info(new Info()
                .title("MachineStateService API")
                .version("1.0.0")
                .description("""
                    REST API for the SmartLaundromat machine state microservice.

                    Handles:
                    - **Machine lifecycle** – tracks IDLE → RUNNING → FINISHED → IDLE transitions
                    - **Cycle management** – start/stop cycles, history, event log
                    - **ESP32 telemetry** – receives sensor data from washing machines via HTTP or MQTT
                    - **MQTT commands** – dispatches pulse/stop/reset commands to ESP32 devices

                    ### Authentication
                    All endpoints (except docs) require a **Bearer token** issued by Auth0.
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
                        "scope":         "sls-machine-read sls-machine-start"
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
                new Server().url("https://api.smartlaundromat.cm/machine").description("Production")
            ));
    }
}
