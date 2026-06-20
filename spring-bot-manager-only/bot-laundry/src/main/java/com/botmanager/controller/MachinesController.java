package com.botmanager.controller;

import com.botmanager.core.machine.MachineRecord;
import com.botmanager.core.machine.MachineService;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;

@RestController
@RequestMapping("/api/machines")
@RequiredArgsConstructor
public class MachinesController {

    private final MachineService machineService;

    @GetMapping("/{botId}")
    public ResponseEntity<List<MachineRecord>> getMachines(@PathVariable String botId) {
        List<MachineRecord> machines = machineService.getMachines(botId);
        return ResponseEntity.ok(machines);
    }

    @GetMapping("/{botId}/{machineId}")
    public ResponseEntity<MachineRecord> getMachine(@PathVariable String botId,
                                                    @PathVariable String machineId) {
        return machineService.getMachine(botId, machineId)
                .map(ResponseEntity::ok)
                .orElse(ResponseEntity.notFound().build());
    }

    @GetMapping("/{botId}/available")
    public ResponseEntity<List<MachineRecord>> getAvailableMachines(@PathVariable String botId) {
        return ResponseEntity.ok(machineService.getAvailableMachines(botId));
    }

}
