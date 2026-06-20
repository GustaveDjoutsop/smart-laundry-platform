package com.smartlaundry.gateway.config;

import org.junit.jupiter.api.Test;
import org.springframework.security.oauth2.core.OAuth2TokenValidatorResult;
import org.springframework.security.oauth2.jwt.Jwt;

import java.time.Instant;
import java.util.List;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;

class AudienceValidatorTest {

    private final AudienceValidator validator = new AudienceValidator("https://smartlaundry.api");

    @Test
    void succeedsWhenAudiencePresent() {
        Jwt jwt = jwtWithAudience(List.of("https://smartlaundry.api", "https://other.api"));

        OAuth2TokenValidatorResult result = validator.validate(jwt);

        assertThat(result.hasErrors()).isFalse();
    }

    @Test
    void failsWhenAudienceMissing() {
        Jwt jwt = jwtWithAudience(List.of("https://other.api"));

        OAuth2TokenValidatorResult result = validator.validate(jwt);

        assertThat(result.hasErrors()).isTrue();
        assertThat(result.getErrors())
                .anyMatch(error -> error.getDescription().contains("https://smartlaundry.api"));
    }

    private Jwt jwtWithAudience(List<String> audience) {
        Instant now = Instant.now();
        return Jwt.withTokenValue("token")
                .header("alg", "RS256")
                .claim("aud", audience)
                .claim("sub", "auth0|test-user")
                .issuedAt(now)
                .expiresAt(now.plusSeconds(60))
                .build();
    }
}
