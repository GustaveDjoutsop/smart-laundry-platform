package com.smartlaundromat.reporting.controller;

import com.smartlaundromat.reporting.service.MaintenanceService;
import lombok.RequiredArgsConstructor;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.*;

import java.util.List;
import java.util.Map;

@RestController
@RequestMapping("/api/admin/maintenance")
@RequiredArgsConstructor
public class MaintenanceController {

    private final MaintenanceService maintenanceService;

    @GetMapping("/alerts")
    public List<Map<String, Object>> alerts() {
        return maintenanceService.activeAlerts();
    }

    @GetMapping("/history")
    public List<Map<String, Object>> history(@RequestParam(required = false) String machineId) {
        return maintenanceService.history(machineId);
    }

    @PostMapping("/log")
    @ResponseStatus(HttpStatus.CREATED)
    public Map<String, Object> log(@RequestBody Map<String, Object> request) {
        return maintenanceService.log(request);
    }

    @PutMapping("/{id}/acknowledge")
    public Map<String, Object> acknowledge(@PathVariable Long id) {
        return maintenanceService.acknowledgeAlert(id);
    }
}
