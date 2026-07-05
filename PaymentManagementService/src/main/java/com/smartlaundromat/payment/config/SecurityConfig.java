package com.smartlaundromat.payment.config;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.http.HttpMethod;
import org.springframework.security.config.annotation.method.configuration.EnableMethodSecurity;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.config.annotation.web.configuration.EnableWebSecurity;
import org.springframework.security.config.annotation.web.configurers.AbstractHttpConfigurer;
import org.springframework.security.config.annotation.web.configurers.HeadersConfigurer;
import org.springframework.security.config.http.SessionCreationPolicy;
import org.springframework.security.oauth2.core.DelegatingOAuth2TokenValidator;
import org.springframework.security.oauth2.core.OAuth2TokenValidator;
import org.springframework.security.oauth2.jwt.*;
import org.springframework.security.oauth2.server.resource.authentication.JwtAuthenticationConverter;
import org.springframework.security.oauth2.server.resource.authentication.JwtGrantedAuthoritiesConverter;
import org.springframework.security.web.SecurityFilterChain;
import org.springframework.web.cors.CorsConfiguration;
import org.springframework.web.cors.CorsConfigurationSource;
import org.springframework.web.cors.UrlBasedCorsConfigurationSource;

import java.util.Arrays;
import java.util.List;

/**
 * Security configuration for PaymentManagementService.
 *
 * <p>This service is an <strong>OAuth2 Resource Server</strong>. It never issues tokens —
 * all Bearer tokens are validated against the Auth0 JWKS endpoint.
 *
 * <h2>Scope → Endpoint mapping</h2>
 * <ul>
 *   <li>{@code sls-rfid-read}      — GET  /api/rfid/balance/*, GET /api/rfid/cards/*</li>
 *   <li>{@code sls-rfid-manage}    — POST /api/rfid/register, PATCH activate/deactivate</li>
 *   <li>{@code sls-rfid-debit}     — POST /api/rfid/debit</li>
 *   <li>{@code sls-payment-read}   — GET  /api/payments/**</li>
 *   <li>{@code sls-payment-initiate} — POST /api/payments/initiate</li>
 *   <li>{@code sls-topup-manage}   — POST /api/topup, GET /api/topup/history/*</li>
 *   <li>{@code sls-pricing-manage} — PUT  /api/pricing/{key} (GET is public)</li>
 * </ul>
 *
 * <h2>Public endpoints (no token required)</h2>
 * <ul>
 *   <li>POST /api/webhook/** — provider callbacks (secured by HMAC signature verification)</li>
 *   <li>GET  /swagger-ui/**, /v3/api-docs/** — API documentation</li>
 *   <li>GET  /h2-console/** — development only</li>
 *   <li>GET  /actuator/health</li>
 * </ul>
 */
@Configuration(proxyBeanMethods = false)
@EnableWebSecurity
@EnableMethodSecurity
public class SecurityConfig {

    @Value("${spring.security.oauth2.resourceserver.jwt.issuer-uri}")
    private String issuerUri;

    @Value("${auth0.audience}")
    private String audience;

    @Value("${cors.allowed-origins:http://localhost:3000}")
    private String allowedOrigins;

    @Bean
    public SecurityFilterChain filterChain(HttpSecurity http) throws Exception {
        http
            .cors(cors -> cors.configurationSource(corsConfigurationSource()))
            .csrf(AbstractHttpConfigurer::disable)
            .headers(headers -> headers
                .frameOptions(HeadersConfigurer.FrameOptionsConfig::sameOrigin)) // for H2 console
            .sessionManagement(sm -> sm.sessionCreationPolicy(SessionCreationPolicy.STATELESS))
            .authorizeHttpRequests(auth -> auth

                // ── Public: provider webhooks (HMAC-verified inside the controller) ──
                .requestMatchers(HttpMethod.POST, "/api/webhook/**").permitAll()

                // ── Public: API docs & dev tooling ──
                .requestMatchers("/swagger-ui/**", "/swagger-ui.html",
                                 "/v3/api-docs/**", "/v3/api-docs").permitAll()
                .requestMatchers("/h2-console/**").permitAll()
                .requestMatchers("/actuator/health", "/actuator/info").permitAll()

                // ── RFID card endpoints ──
                .requestMatchers(HttpMethod.POST, "/api/rfid/register")
                    .hasAuthority("SCOPE_sls-rfid-manage")
                .requestMatchers(HttpMethod.GET, "/api/rfid/balance/**")
                    .hasAnyAuthority("SCOPE_sls-rfid-read", "SCOPE_sls-rfid-debit")
                .requestMatchers(HttpMethod.POST, "/api/rfid/debit")
                    .hasAuthority("SCOPE_sls-rfid-debit")
                .requestMatchers(HttpMethod.GET, "/api/rfid/cards/**")
                    .hasAuthority("SCOPE_sls-rfid-read")
                .requestMatchers(HttpMethod.GET, "/api/rfid/cards")
                    .hasAuthority("SCOPE_sls-rfid-read")
                .requestMatchers(HttpMethod.PATCH, "/api/rfid/cards/**")
                    .hasAuthority("SCOPE_sls-rfid-manage")

                // ── Mobile money payment endpoints ──
                .requestMatchers(HttpMethod.POST, "/api/payments/initiate")
                    .hasAuthority("SCOPE_sls-payment-initiate")
                // Public: bot queries active cycle by phone (read-only, no sensitive data)
                .requestMatchers(HttpMethod.GET, "/api/payments/phone/**").permitAll()
                .requestMatchers(HttpMethod.GET, "/api/payments/**")
                    .hasAuthority("SCOPE_sls-payment-read")

                // ── Top-up endpoints ──
                .requestMatchers(HttpMethod.POST, "/api/topup")
                    .hasAuthority("SCOPE_sls-topup-manage")
                .requestMatchers(HttpMethod.GET, "/api/topup/history/**")
                    .hasAnyAuthority("SCOPE_sls-topup-manage", "SCOPE_sls-rfid-read")

                // ── Pricing endpoints ──
                .requestMatchers(HttpMethod.GET, "/api/pricing").permitAll()
                .requestMatchers(HttpMethod.PUT, "/api/pricing/**")
                    .hasAuthority("SCOPE_sls-pricing-manage")

                .anyRequest().authenticated()
            )
            .oauth2ResourceServer(oauth2 -> oauth2
                .jwt(jwt -> jwt
                    .decoder(jwtDecoder())
                    .jwtAuthenticationConverter(jwtAuthenticationConverter())
                )
                .authenticationEntryPoint((request, response, ex) -> {
                    response.setStatus(401);
                    response.setContentType("application/json");
                    response.getWriter().write(
                        "{\"error\":\"UNAUTHORIZED\",\"message\":\"Bearer token required\"}");
                })
            );

        return http.build();
    }

    @Bean
    public JwtDecoder jwtDecoder() {
        NimbusJwtDecoder decoder = JwtDecoders.fromOidcIssuerLocation(issuerUri);

        OAuth2TokenValidator<Jwt> withIssuer = JwtValidators.createDefaultWithIssuer(issuerUri);
        OAuth2TokenValidator<Jwt> withAudience = new AudienceValidator(audience);
        OAuth2TokenValidator<Jwt> combined =
                new DelegatingOAuth2TokenValidator<>(withIssuer, withAudience);

        decoder.setJwtValidator(combined);
        return decoder;
    }

    @Bean
    public JwtAuthenticationConverter jwtAuthenticationConverter() {
        // Auth0 M2M tokens carry scopes in the "scope" claim (space-delimited string).
        // Spring's JwtGrantedAuthoritiesConverter reads it and prefixes with "SCOPE_".
        JwtGrantedAuthoritiesConverter authoritiesConverter = new JwtGrantedAuthoritiesConverter();
        authoritiesConverter.setAuthoritiesClaimName("scope");
        authoritiesConverter.setAuthorityPrefix("SCOPE_");

        JwtAuthenticationConverter converter = new JwtAuthenticationConverter();
        converter.setJwtGrantedAuthoritiesConverter(authoritiesConverter);
        return converter;
    }

    @Bean
    public CorsConfigurationSource corsConfigurationSource() {
        CorsConfiguration config = new CorsConfiguration();
        config.setAllowedOrigins(Arrays.asList(allowedOrigins.split(",")));
        config.setAllowedMethods(List.of("GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"));
        config.setAllowedHeaders(List.of("*"));
        config.setAllowCredentials(true);
        config.setMaxAge(3600L);

        UrlBasedCorsConfigurationSource source = new UrlBasedCorsConfigurationSource();
        source.registerCorsConfiguration("/**", config);
        return source;
    }
}
