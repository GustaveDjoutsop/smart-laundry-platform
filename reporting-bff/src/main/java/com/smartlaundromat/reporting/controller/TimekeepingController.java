package com.smartlaundromat.reporting.controller;

import com.smartlaundromat.reporting.service.TimekeepingService;
import lombok.RequiredArgsConstructor;
import org.springframework.http.HttpStatus;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.web.bind.annotation.*;

import java.util.Map;
import java.util.UUID;

@RestController
@RequestMapping("/api/admin/timekeeping")
@RequiredArgsConstructor
public class TimekeepingController {

    private final TimekeepingService timekeepingService;

    @PostMapping("/clock-in")
    @ResponseStatus(HttpStatus.CREATED)
    public Map<String, Object> clockIn(
            @RequestBody(required = false) Map<String, Object> body,
            @AuthenticationPrincipal Jwt jwt) {
        String notes = body != null ? (String) body.get("notes") : null;
        return timekeepingService.clockIn(jwt, notes);
    }

    @PostMapping("/clock-out")
    public Map<String, Object> clockOut(
            @RequestBody(required = false) Map<String, Object> body,
            @AuthenticationPrincipal Jwt jwt) {
        String notes = body != null ? (String) body.get("notes") : null;
        return timekeepingService.clockOut(jwt, notes);
    }

    @GetMapping("/status")
    public Map<String, Object> getStatus(@AuthenticationPrincipal Jwt jwt) {
        return timekeepingService.getStatus(jwt);
    }

    @GetMapping("/today")
    public Map<String, Object> getToday(@AuthenticationPrincipal Jwt jwt) {
        return timekeepingService.getToday(jwt);
    }

    @GetMapping("/entries")
    public Map<String, Object> getEntries(
            @RequestParam(required = false) String startDate,
            @RequestParam(required = false) String endDate,
            @RequestParam(required = false) String employeeId,
            @RequestParam(defaultValue = "1")  int page,
            @RequestParam(defaultValue = "50") int limit,
            @AuthenticationPrincipal Jwt jwt) {
        UUID empId = employeeId != null ? UUID.fromString(employeeId) : null;
        return timekeepingService.getEntries(startDate, endDate, empId, jwt, page, limit);
    }

    @PostMapping("/entries")
    @ResponseStatus(HttpStatus.CREATED)
    public Map<String, Object> createManualEntry(@RequestBody Map<String, Object> body) {
        return timekeepingService.createManualEntry(body);
    }

    @DeleteMapping("/entries/{id}")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void deleteEntry(@PathVariable String id) {
        timekeepingService.deleteEntry(id);
    }

    @GetMapping("/summary")
    public Map<String, Object> getSummary(
            @RequestParam(required = false) String startDate,
            @RequestParam(required = false) String endDate,
            @RequestParam(required = false) String employeeId,
            @AuthenticationPrincipal Jwt jwt) {
        UUID empId = employeeId != null ? UUID.fromString(employeeId) : null;
        return timekeepingService.getSummary(startDate, endDate, empId, jwt);
    }
}
