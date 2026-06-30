package com.smartlaundry.gateway.config;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.core.io.buffer.DataBuffer;
import org.springframework.http.HttpMethod;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.security.config.annotation.web.reactive.EnableWebFluxSecurity;
import org.springframework.security.config.web.server.ServerHttpSecurity;
import org.springframework.security.oauth2.core.DelegatingOAuth2TokenValidator;
import org.springframework.security.oauth2.core.OAuth2TokenValidator;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.security.oauth2.jwt.JwtValidators;
import org.springframework.security.oauth2.jwt.ReactiveJwtDecoder;
import org.springframework.security.web.server.SecurityWebFilterChain;
import org.springframework.security.oauth2.jwt.NimbusReactiveJwtDecoder;
import reactor.core.publisher.Mono;

import java.nio.charset.StandardCharsets;

/**
 * Reactive resource-server security for the gateway.
 *
 * <p>Mirrors the Auth0 issuer/audience validation already used by
 * spring-bot-manager-only ({@code com.botmanager.config.SecurityConfig}), ported to
 * WebFlux. The gateway only enforces coarse "is there a valid token" authorization;
 * fine-grained scope checks remain in each backend service (defense-in-depth — see
 * architecture-review/05-API-GATEWAY-DESIGN.md §4). The validated Authorization
 * header is passed through to the backends unchanged.
 */
@Configuration(proxyBeanMethods = false)
@EnableWebFluxSecurity
public class SecurityConfig {

    @Value("${spring.security.oauth2.resourceserver.jwt.issuer-uri}")
    private String issuerUri;

    @Value("${spring.security.oauth2.resourceserver.jwt.audience}")
    private String audience;

    @Bean
    public SecurityWebFilterChain securityWebFilterChain(ServerHttpSecurity http, ReactiveJwtDecoder jwtDecoder) {
        http
            // CORS is handled by spring.cloud.gateway.globalcors (CorsWebFilter), not here.
            .cors(ServerHttpSecurity.CorsSpec::disable)
            .csrf(ServerHttpSecurity.CsrfSpec::disable)
            .authorizeExchange(exchange -> exchange
                // CORS preflight requests carry no Authorization header.
                .pathMatchers(HttpMethod.OPTIONS, "/**").permitAll()
                // Public — CamPay/MTN/Orange call this directly; PaymentManagementService
                // verifies the HMAC signature itself. See design doc §4 security note.
                .pathMatchers(HttpMethod.POST, "/payments/api/webhook/**").permitAll()
                // WhatsApp webhook — Meta sends GET for verification and POST for events
                // with no Auth0 token. Signature is verified by the bot-manager itself.
                .pathMatchers(HttpMethod.GET, "/bot/api/whatsapp/webhook", "/bot/api/whatsapp/webhooks", "/bot/api/whatsapp/webhooks/**").permitAll()
                .pathMatchers(HttpMethod.POST, "/bot/api/whatsapp/webhook", "/bot/api/whatsapp/webhooks", "/bot/api/whatsapp/webhooks/**").permitAll()
                .pathMatchers("/actuator/health", "/actuator/info").permitAll()
                .pathMatchers("/*/swagger-ui/**", "/*/swagger-ui.html",
                              "/*/v3/api-docs/**", "/*/v3/api-docs").permitAll()
                .anyExchange().authenticated()
            )
            .oauth2ResourceServer(oauth2 -> oauth2
                .jwt(jwt -> jwt.jwtDecoder(jwtDecoder))
                .authenticationEntryPoint((exchange, ex) -> {
                    exchange.getResponse().setStatusCode(HttpStatus.UNAUTHORIZED);
                    exchange.getResponse().getHeaders().setContentType(MediaType.APPLICATION_JSON);
                    DataBuffer buffer = exchange.getResponse().bufferFactory().wrap(
                            "{\"error\":\"UNAUTHORIZED\",\"message\":\"Valid Auth0 Bearer token required\"}"
                                    .getBytes(StandardCharsets.UTF_8));
                    return exchange.getResponse().writeWith(Mono.just(buffer));
                })
            );
        return http.build();
    }

    @Bean
    public ReactiveJwtDecoder jwtDecoder() {
        NimbusReactiveJwtDecoder decoder = NimbusReactiveJwtDecoder.withIssuerLocation(issuerUri).build();
        OAuth2TokenValidator<Jwt> withIssuer = JwtValidators.createDefaultWithIssuer(issuerUri);
        OAuth2TokenValidator<Jwt> withAudience = new AudienceValidator(audience);
        decoder.setJwtValidator(new DelegatingOAuth2TokenValidator<>(withIssuer, withAudience));
        return decoder;
    }
}
