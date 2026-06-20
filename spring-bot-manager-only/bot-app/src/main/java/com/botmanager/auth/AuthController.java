package com.botmanager.auth;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.autoconfigure.condition.ConditionalOnBean;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.List;

@Slf4j
@RestController
@RequestMapping("/auth")
@ConditionalOnBean(JwtTokenProvider.class)
@RequiredArgsConstructor
public class AuthController {

    private static final List<String> ADMIN_SCOPES = List.of("ADMIN");

    private final JwtTokenProvider jwtTokenProvider;

    @Value("${admin.username:admin}")
    private String adminUsername;

    @Value("${admin.password:change-me-in-production}")
    private String adminPassword;

    @Value("${jwt.expiration-ms:3600000}")
    private long expirationMs;

    @PostMapping("/login")
    public ResponseEntity<?> login(@RequestBody AuthDtos.LoginRequest request) {
        if (request.getUsername() == null || request.getPassword() == null) {
            return ResponseEntity.badRequest().body(
                    AuthDtos.ErrorResponse.builder().error("Username and password are required").build());
        }

        // Use constant-time comparison for both fields (evaluated unconditionally via &)
        // to prevent timing-based username/password enumeration.
        boolean valid = constantTimeEquals(adminUsername, request.getUsername())
                & constantTimeEquals(adminPassword, request.getPassword());

        if (!valid) {
            log.warn("Failed login attempt for username '{}'", request.getUsername());
            return ResponseEntity.status(401).body(
                    AuthDtos.ErrorResponse.builder().error("Invalid credentials").build());
        }

        String token = jwtTokenProvider.generateToken(request.getUsername(), ADMIN_SCOPES);

        return ResponseEntity.ok(AuthDtos.TokenResponse.builder()
                .token(token)
                .tokenType("Bearer")
                .expiresIn(expirationMs / 1000)
                .scopes(ADMIN_SCOPES)
                .build());
    }

    private static boolean constantTimeEquals(String a, String b) {
        return MessageDigest.isEqual(
                a.getBytes(StandardCharsets.UTF_8),
                b.getBytes(StandardCharsets.UTF_8));
    }
}
