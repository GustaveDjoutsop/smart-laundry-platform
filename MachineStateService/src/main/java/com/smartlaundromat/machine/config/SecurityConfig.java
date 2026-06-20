package com.smartlaundromat.machine.config;

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
 * Security configuration for MachineStateService.
 *
 * <p>This service is an <strong>OAuth2 Resource Server</strong>. Bearer tokens
 * are validated against Auth0's JWKS endpoint.
 *
 * <h2>Scope → Endpoint mapping</h2>
 * <ul>
 *   <li>{@code sls-machine-read}    — GET  /api/machines/**, /api/esp32/mqtt/status</li>
 *   <li>{@code sls-machine-start}   — POST /api/machines/start-cycle</li>
 *   <li>{@code sls-machine-command} — POST /api/machines/{id}/command/{action}</li>
 *   <li>{@code sls-telemetry-write} — POST /api/esp32/telemetry</li>
 * </ul>
 *
 * <h2>Public endpoints</h2>
 * <ul>
 *   <li>GET  /swagger-ui/**, /v3/api-docs/**</li>
 *   <li>GET  /h2-console/** (dev only)</li>
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
                .frameOptions(HeadersConfigurer.FrameOptionsConfig::sameOrigin))
            .sessionManagement(sm -> sm.sessionCreationPolicy(SessionCreationPolicy.STATELESS))
            .authorizeHttpRequests(auth -> auth

                // ── Public: API docs & dev tooling ──
                .requestMatchers("/swagger-ui/**", "/swagger-ui.html",
                                 "/v3/api-docs/**", "/v3/api-docs").permitAll()
                .requestMatchers("/h2-console/**").permitAll()
                .requestMatchers("/actuator/health", "/actuator/info").permitAll()

                // ── ESP32 telemetry (device posts sensor data) ──
                .requestMatchers(HttpMethod.POST, "/api/esp32/telemetry")
                    .hasAuthority("SCOPE_sls-telemetry-write")
                .requestMatchers(HttpMethod.GET, "/api/esp32/mqtt/status")
                    .hasAuthority("SCOPE_sls-machine-read")

                // ── Machine read endpoints ──
                .requestMatchers(HttpMethod.GET, "/api/machines/**")
                    .hasAuthority("SCOPE_sls-machine-read")
                .requestMatchers(HttpMethod.GET, "/api/machines")
                    .hasAuthority("SCOPE_sls-machine-read")

                // ── Cycle start (triggers MQTT pulse to ESP32) ──
                .requestMatchers(HttpMethod.POST, "/api/machines/start-cycle")
                    .hasAuthority("SCOPE_sls-machine-start")

                // ── Raw commands: stop / reset / status ──
                .requestMatchers(HttpMethod.POST, "/api/machines/*/command/**")
                    .hasAuthority("SCOPE_sls-machine-command")

                // ── Reservations: write (create / activate) ──
                .requestMatchers(HttpMethod.POST, "/api/reservations", "/api/reservations/activate")
                    .hasAuthority("SCOPE_sls-reservation-write")
                // ── Reservations: read (validate code+machine / lookups) ──
                .requestMatchers(HttpMethod.POST, "/api/reservations/validate")
                    .hasAuthority("SCOPE_sls-reservation-read")
                .requestMatchers(HttpMethod.GET, "/api/reservations/**")
                    .hasAuthority("SCOPE_sls-reservation-read")

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
