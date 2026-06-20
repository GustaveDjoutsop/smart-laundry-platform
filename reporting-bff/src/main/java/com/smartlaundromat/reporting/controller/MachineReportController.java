package com.smartlaundromat.reporting.controller;

import com.smartlaundromat.reporting.service.MachineReportService;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.List;
import java.util.Map;

@RestController
@RequestMapping("/api/admin/machines")
@RequiredArgsConstructor
public class MachineReportController {

    private final MachineReportService machineReportService;

    @GetMapping
    public List<Map<String, Object>> list() {
        return machineReportService.listMachines();
    }

    @GetMapping("/{machineId}")
    public ResponseEntity<Map<String, Object>> findById(@PathVariable String machineId) {
        Map<String, Object> machine = machineReportService.findMachine(machineId);
        return machine != null ? ResponseEntity.ok(machine) : ResponseEntity.notFound().build();
    }

    @GetMapping("/{machineId}/history")
    public List<Map<String, Object>> history(
            @PathVariable String machineId,
            @RequestParam(defaultValue = "50") int limit) {
        return machineReportService.cycleHistory(machineId, limit);
    }
}
