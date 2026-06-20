package com.smartlaundromat.reporting.controller;

import com.smartlaundromat.reporting.service.MachineReportService;
import lombok.RequiredArgsConstructor;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.util.Arrays;
import java.util.List;
import java.util.Map;

@RestController
@RequestMapping("/api/admin/machines")
@RequiredArgsConstructor
public class MachineReportController {

    private final MachineReportService machineReportService;

    @Value("${whatsapp.business-phone:}")
    private String whatsappPhone;

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

    @GetMapping("/{machineId}/qrcode-url")
    public ResponseEntity<Map<String, Object>> qrcodeUrl(@PathVariable String machineId) {
        if (whatsappPhone == null || whatsappPhone.isBlank()) {
            return ResponseEntity.internalServerError()
                    .body(Map.of("error", "WHATSAPP_BUSINESS_PHONE not configured"));
        }
        Map<String, Object> machine = machineReportService.findMachine(machineId);
        if (machine == null) {
            return ResponseEntity.notFound().build();
        }
        String machineName = toDisplayName(machineId);
        String text = URLEncoder.encode("START " + machineId, StandardCharsets.UTF_8);
        String whatsappUrl = "https://wa.me/" + whatsappPhone + "?text=" + text;
        return ResponseEntity.ok(Map.of(
                "machineId",   machineId,
                "machineName", machineName,
                "whatsappUrl", whatsappUrl,
                "phoneNumber", whatsappPhone
        ));
    }

    private static String toDisplayName(String machineId) {
        // "washer_01" → "Washer 01", "dryer_03" → "Dryer 03"
        return Arrays.stream(machineId.split("[_\\-]"))
                .map(part -> part.isEmpty() ? part
                        : Character.toUpperCase(part.charAt(0)) + part.substring(1))
                .reduce((a, b) -> a + " " + b)
                .orElse(machineId);
    }
}
