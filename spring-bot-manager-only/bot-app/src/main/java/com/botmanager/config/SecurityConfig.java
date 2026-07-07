package com.botmanager.config;

import com.botmanager.auth.AudienceValidator;
import com.botmanager.auth.JwtAuthenticationFilter;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.core.annotation.Order;
import org.springframework.http.HttpMethod;
import org.springframework.security.config.annotation.method.configuration.EnableMethodSecurity;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.config.annotation.web.configuration.EnableWebSecurity;
import org.springframework.security.config.annotation.web.configurers.AbstractHttpConfigurer;
import org.springframework.util.StringUtils;
import org.springframework.security.config.http.SessionCreationPolicy;
import org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.security.oauth2.core.DelegatingOAuth2TokenValidator;
import org.springframework.security.oauth2.core.OAuth2TokenValidator;
import org.springframework.security.oauth2.jwt.BadJwtException;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.security.oauth2.jwt.JwtDecoder;
import org.springframework.security.oauth2.jwt.JwtDecoders;
import org.springframework.security.oauth2.jwt.JwtValidators;
import org.springframework.security.oauth2.jwt.NimbusJwtDecoder;
import org.springframework.security.oauth2.server.resource.authentication.JwtAuthenticationConverter;
import org.springframework.security.oauth2.server.resource.authentication.JwtGrantedAuthoritiesConverter;
import org.springframework.security.web.SecurityFilterChain;
import org.springframework.security.web.authentication.UsernamePasswordAuthenticationFilter;
import org.springframework.web.cors.CorsConfiguration;
import org.springframework.web.cors.CorsConfigurationSource;
import org.springframework.web.cors.UrlBasedCorsConfigurationSource;

import java.util.Arrays;
import java.util.List;

/**
 * Security configuration for spring-bot-manager-only.
 *
 * <p>Two filter chains run in priority order:
 * <ol>
 *   <li>Admin chain (Order 1) — /admin/** secured with the locally-issued JWT.</li>
 *   <li>API chain   (Order 2) — all other endpoints act as an OAuth2 Resource Server,
 *       validating Auth0 Bearer tokens.</li>
 * </ol>
 *
 * <p>Public endpoints (no token): WhatsApp/payment webhooks (HMAC-verified internally),
 * /auth/**, Swagger UI, /actuator/health.
 *
 * <p>Scopes:
 * <ul>
 *   <li>sls-machine-read  - GET /api/machines/**</li>
 *   <li>sls-payment-read  - GET /api/payments/{botId}/transactions/**</li>
 *   <li>sls-bot-admin     - POST /api/notifications/send (proactive WhatsApp push)</li>
 * </ul>
 */
@Configuration(proxyBeanMethods = false)
@EnableWebSecurity
@EnableMethodSecurity
public class SecurityConfig {

    @Value("${spring.security.oauth2.resourceserver.jwt.issuer-uri:}")
    private String issuerUri;

    @Value("${auth0.audience:https://smartlaundry.api}")
    private String audience;

    @Value("${cors.allowed-origins:http://localhost:3000}")
    private String allowedOrigins;

    // ── Chain 1: Admin — local JWT ────────────────────────────────────────────

    @Bean
    @Order(1)
    public SecurityFilterChain adminFilterChain(
            HttpSecurity http,
            @Autowired(required = false) JwtAuthenticationFilter jwtAuthFilter) throws Exception {
        http
            .securityMatcher("/admin/**")
            .cors(cors -> cors.configurationSource(corsConfigurationSource()))
            .csrf(AbstractHttpConfigurer::disable)
            .sessionManagement(s -> s.sessionCreationPolicy(SessionCreationPolicy.STATELESS))
            .authorizeHttpRequests(auth -> auth.anyRequest().hasRole("ADMIN"))
            .exceptionHandling(ex -> ex.authenticationEntryPoint(
                (req, res, e) -> res.sendError(HttpServletResponse.SC_UNAUTHORIZED, "Unauthorized")));
        if (jwtAuthFilter != null) {
            http.addFilterBefore(jwtAuthFilter, UsernamePasswordAuthenticationFilter.class);
        }
        return http.build();
    }

    // ── Chain 2: API — Auth0 resource server ─────────────────────────────────

    @Bean
    @Order(2)
    public SecurityFilterChain apiFilterChain(HttpSecurity http) throws Exception {
        http
            .cors(cors -> cors.configurationSource(corsConfigurationSource()))
            .csrf(AbstractHttpConfigurer::disable)
            .sessionManagement(s -> s.sessionCreationPolicy(SessionCreationPolicy.STATELESS))
            .authorizeHttpRequests(auth -> auth
                // Public — webhooks (HMAC-verified inside controllers)
                .requestMatchers(HttpMethod.GET,  "/api/whatsapp/webhook", "/api/whatsapp/webhooks/**").permitAll()
                .requestMatchers(HttpMethod.POST, "/api/whatsapp/webhook", "/api/whatsapp/webhooks/**").permitAll()
                .requestMatchers(HttpMethod.POST, "/api/payments/webhooks/**").permitAll()
                // Public — legacy admin login
                .requestMatchers("/auth/**").permitAll()
                // Public — API docs & health
                .requestMatchers("/swagger-ui/**", "/swagger-ui.html",
                                 "/v3/api-docs/**", "/v3/api-docs").permitAll()
                .requestMatchers("/actuator/health", "/actuator/info").permitAll()
                // Machine availability proxy (requires sls-machine-read)
                .requestMatchers(HttpMethod.GET, "/api/machines/**")
                    .hasAuthority("SCOPE_sls-machine-read")
                // Payment transaction query (requires sls-payment-read)
                .requestMatchers(HttpMethod.GET, "/api/payments/*/transactions/**")
                    .hasAuthority("SCOPE_sls-payment-read")
                .requestMatchers(HttpMethod.GET, "/api/payments/*/external/**")
                    .hasAuthority("SCOPE_sls-payment-read")
                // Proactive notifications — MachineStateService/PaymentManagementService
                // pushing a WhatsApp message to a customer outside any inbound conversation
                .requestMatchers(HttpMethod.POST, "/api/notifications/send")
                    .hasAuthority("SCOPE_sls-bot-admin")
                .anyRequest().authenticated()
            )
            .oauth2ResourceServer(oauth2 -> oauth2
                .jwt(jwt -> jwt
                    .decoder(jwtDecoder())
                    .jwtAuthenticationConverter(jwtAuthenticationConverter()))
                .authenticationEntryPoint((req, res, ex) -> {
                    res.setStatus(401);
                    res.setContentType("application/json");
                    res.getWriter().write(
                        "{\"error\":\"UNAUTHORIZED\","
                        + "\"message\":\"Valid Auth0 Bearer token required\"}");
                })
            );
        return http.build();
    }

    @Bean
    public JwtDecoder jwtDecoder() {
        if (!StringUtils.hasText(issuerUri)) {
            return token -> {
                throw new BadJwtException("Auth0 issuer-uri not configured");
            };
        }
        NimbusJwtDecoder decoder = JwtDecoders.fromOidcIssuerLocation(issuerUri);
        OAuth2TokenValidator<Jwt> withIssuer = JwtValidators.createDefaultWithIssuer(issuerUri);
        OAuth2TokenValidator<Jwt> withAudience = new AudienceValidator(audience);
        decoder.setJwtValidator(new DelegatingOAuth2TokenValidator<>(withIssuer, withAudience));
        return decoder;
    }

    @Bean
    public JwtAuthenticationConverter jwtAuthenticationConverter() {
        JwtGrantedAuthoritiesConverter gac = new JwtGrantedAuthoritiesConverter();
        gac.setAuthoritiesClaimName("scope");
        gac.setAuthorityPrefix("SCOPE_");
        JwtAuthenticationConverter converter = new JwtAuthenticationConverter();
        converter.setJwtGrantedAuthoritiesConverter(gac);
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

    @Bean
    public PasswordEncoder passwordEncoder() {
        return new BCryptPasswordEncoder();
    }
}
