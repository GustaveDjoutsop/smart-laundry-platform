package com.smartlaundromat.reporting.controller;

import com.smartlaundromat.reporting.service.AbsenceService;
import lombok.RequiredArgsConstructor;
import org.springframework.http.HttpStatus;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.web.bind.annotation.*;

import java.util.List;
import java.util.Map;

@RestController
@RequestMapping("/api/admin/absences")
@RequiredArgsConstructor
public class AbsenceController {

    private final AbsenceService absenceService;

    @GetMapping
    public Map<String, Object> getAll(
            @RequestParam(required = false) String startDate,
            @RequestParam(required = false) String endDate,
            @RequestParam(required = false) String employeeId,
            @RequestParam(required = false) String status,
            @RequestParam(required = false) String type,
            @RequestParam(defaultValue = "1")   int page,
            @RequestParam(defaultValue = "50")  int limit) {
        return absenceService.getAll(startDate, endDate, employeeId, status, type, page, limit);
    }

    // Must be declared before /{id} so Spring routes "pending" as a literal
    @GetMapping("/pending")
    public Map<String, Object> getPendingCount() {
        return absenceService.getPendingCount();
    }

    // Must be declared before /{id} so Spring routes "types" as a literal
    @GetMapping("/types")
    public Map<String, Object> getTypes() {
        return Map.of("types", List.of(
            Map.of("value", "vacation",         "label", "Vacation"),
            Map.of("value", "sick",             "label", "Sick Leave"),
            Map.of("value", "personal",         "label", "Personal"),
            Map.of("value", "unpaid_leave",     "label", "Unpaid Leave"),
            Map.of("value", "family_emergency", "label", "Family Emergency"),
            Map.of("value", "training",         "label", "Training")
        ));
    }

    @GetMapping("/summary/{employeeId}")
    public Map<String, Object> getEmployeeSummary(
            @PathVariable String employeeId,
            @RequestParam(defaultValue = "0") int year) {
        int effectiveYear = year > 0 ? year : java.time.LocalDate.now().getYear();
        return absenceService.getEmployeeSummary(employeeId, effectiveYear);
    }

    @GetMapping("/{id}")
    public Map<String, Object> getById(@PathVariable String id) {
        return absenceService.getById(id);
    }

    @PostMapping
    @ResponseStatus(HttpStatus.CREATED)
    public Map<String, Object> create(@RequestBody Map<String, Object> body) {
        return absenceService.create(body);
    }

    @PutMapping("/{id}")
    public Map<String, Object> update(@PathVariable String id, @RequestBody Map<String, Object> body) {
        return absenceService.update(id, body);
    }

    @DeleteMapping("/{id}")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void delete(@PathVariable String id) {
        absenceService.delete(id);
    }

    @PostMapping("/{id}/approve")
    public Map<String, Object> approve(
            @PathVariable String id,
            @RequestBody(required = false) Map<String, Object> body,
            @AuthenticationPrincipal Jwt jwt) {
        String notes = body != null ? (String) body.get("notes") : null;
        return absenceService.review(id, "approved", jwt.getSubject(), notes);
    }

    @PostMapping("/{id}/reject")
    public Map<String, Object> reject(
            @PathVariable String id,
            @RequestBody Map<String, Object> body,
            @AuthenticationPrincipal Jwt jwt) {
        String notes = (String) body.get("notes");
        return absenceService.review(id, "rejected", jwt.getSubject(), notes);
    }
}
