package com.smartlaundromat.reporting.controller;

import com.smartlaundromat.reporting.service.Auth0ManagementService;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.web.bind.annotation.*;

import java.util.Map;

@RestController
@RequestMapping("/api/admin/auth")
@RequiredArgsConstructor
public class AuthController {

    private final Auth0ManagementService auth0ManagementService;

    /**
     * Lets the currently authenticated user change their own password.
     * The user's Auth0 sub is taken from the JWT — no separate current-password
     * verification is needed since the token itself proves the user is authenticated.
     */
    @PostMapping("/change-password")
    public ResponseEntity<Map<String, Object>> changePassword(
            @RequestBody Map<String, Object> request,
            @AuthenticationPrincipal Jwt jwt) {
        String newPassword = request.get("newPassword") instanceof String s ? s : null;
        if (newPassword == null || newPassword.length() < 8) {
            return ResponseEntity.badRequest()
                    .body(Map.of("error", "Password must be at least 8 characters"));
        }
        auth0ManagementService.updatePassword(jwt.getSubject(), newPassword);
        return ResponseEntity.ok(Map.of("success", true, "message", "Password updated successfully"));
    }
}
