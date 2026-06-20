package com.smartlaundromat.machine.controller;

import com.smartlaundromat.machine.dto.MachineSummaryResponse;
import com.smartlaundromat.machine.dto.MachineStatusResponse;
import com.smartlaundromat.machine.dto.StartCycleRequest;
import com.smartlaundromat.machine.model.MachineCycle;
import com.smartlaundromat.machine.model.MachineEvent;
import com.smartlaundromat.machine.service.MachineService;
import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;

import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.List;
import java.util.Map;

@Slf4j
@RestController
@RequestMapping("/api/machines")
@RequiredArgsConstructor
public class MachineController {

    private final MachineService machineService;

    @GetMapping
    public ResponseEntity<MachineSummaryResponse> getAllMachines() {
        log.info("Received request to get all machines");

        return ResponseEntity.ok(machineService.getAllMachines());
    }

    @GetMapping("/{machineId}")
    public ResponseEntity<MachineStatusResponse> getMachineStatus(@PathVariable String machineId) {
        return ResponseEntity.ok(machineService.getMachineStatus(machineId));
    }

    @GetMapping("/{machineId}/events")
    public ResponseEntity<List<MachineEvent>> getMachineEvents(@PathVariable String machineId) {
        return ResponseEntity.ok(machineService.getMachineEvents(machineId));
    }

    @GetMapping("/{machineId}/cycles")
    public ResponseEntity<List<MachineCycle>> getMachineCycles(@PathVariable String machineId) {
        return ResponseEntity.ok(machineService.getMachineCycles(machineId));
    }

    @PostMapping("/start-cycle")
    public ResponseEntity<MachineCycle> startCycle(@Valid @RequestBody StartCycleRequest request) {
        MachineCycle cycle = machineService.startCycle(request);
        return ResponseEntity.ok(cycle);
    }

    @PostMapping("/{machineId}/command/{action}")
    public ResponseEntity<Map<String, String>> sendCommand(
            @PathVariable String machineId,
            @PathVariable String action) {
        machineService.sendCommand(machineId, action);
        return ResponseEntity.ok(Map.of(
                "status", "sent",
                "machineId", machineId,
                "action", action
        ));
    }
}
