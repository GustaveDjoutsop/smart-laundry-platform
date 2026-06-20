package com.botmanager.config;

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
                @OAuthScope(name = "sls-machine-read",
                    description = "Query machine availability via the bot proxy"),
                @OAuthScope(name = "sls-payment-read",
                    description = "Query payment transaction status via the bot"),
                @OAuthScope(name = "sls-bot-admin",
                    description = "Admin-level bot management operations")
            }
        )
    )
)
public class SwaggerConfig {

    @Value("${server.port:8090}")
    private String serverPort;

    @Bean
    public OpenAPI openAPI() {
        return new OpenAPI()
            .info(new Info()
                .title("spring-bot-manager-only API")
                .version("0.1.0")
                .description(
                    "WhatsApp bot manager for SmartLaundromat. "
                    + "Proxies machine/payment queries and processes WhatsApp messages. "
                    + "Webhook endpoints are public (HMAC-verified); other endpoints require Auth0 Bearer tokens.")
                .contact(new Contact()
                    .name("SmartLaundromat Team")
                    .email("dev@smartlaundromat.cm"))
                .license(new License()
                    .name("MIT")
                    .url("https://opensource.org/licenses/MIT"))
            )
            .servers(List.of(
                new Server().url("http://localhost:" + serverPort).description("Local / Dev"),
                new Server().url("https://api.smartlaundromat.cm/bot").description("Production")
            ));
    }
}
