package com.smartlaundromat.reporting.controller;

import com.smartlaundromat.reporting.service.UserService;
import lombok.RequiredArgsConstructor;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.*;

import java.util.List;
import java.util.Map;

@RestController
@RequestMapping("/api/admin/users")
@RequiredArgsConstructor
public class UserController {

    private final UserService userService;

    @GetMapping
    public Map<String, Object> list(
            @RequestParam(defaultValue = "1")  int page,
            @RequestParam(defaultValue = "20") int limit,
            @RequestParam(required = false) String role,
            @RequestParam(required = false) Boolean isActive,
            @RequestParam(required = false) String search) {
        return userService.list(page, limit, role, isActive, search);
    }

    @GetMapping("/{id}")
    public Map<String, Object> getById(@PathVariable String id) {
        return userService.getById(id);
    }

    @PostMapping
    @ResponseStatus(HttpStatus.CREATED)
    public Map<String, Object> create(@RequestBody Map<String, Object> request) {
        return userService.create(request);
    }

    @PutMapping("/{id}")
    public Map<String, Object> update(@PathVariable String id, @RequestBody Map<String, Object> request) {
        return userService.update(id, request);
    }

    @DeleteMapping("/{id}")
    public Map<String, Object> delete(@PathVariable String id) {
        userService.delete(id);
        return Map.of("deleted", true, "userId", id);
    }

    @PostMapping("/{id}/activate")
    public Map<String, Object> activate(@PathVariable String id) {
        return userService.setActive(id, true);
    }

    @PostMapping("/{id}/deactivate")
    public Map<String, Object> deactivate(@PathVariable String id) {
        return userService.setActive(id, false);
    }

    // Auth0 manages sessions — return stubs so the dashboard doesn't 404
    @GetMapping("/{id}/sessions")
    public Map<String, Object> getSessions(@PathVariable String id) {
        return Map.of("sessions", List.of(), "count", 0);
    }

    @DeleteMapping("/{id}/sessions/{sessionIndex}")
    public Map<String, Object> revokeSession(@PathVariable String id, @PathVariable int sessionIndex) {
        return Map.of("message", "Session management is handled by Auth0");
    }

    @GetMapping("/{id}/login-history")
    public Map<String, Object> getLoginHistory(
            @PathVariable String id,
            @RequestParam(required = false) Integer limit) {
        return Map.of("history", List.of());
    }

    @PostMapping("/{id}/reset-password")
    public Map<String, Object> resetPassword(@PathVariable String id, @RequestBody Map<String, Object> request) {
        return Map.of("message", "Trigger a password reset email from the Auth0 dashboard");
    }
}
