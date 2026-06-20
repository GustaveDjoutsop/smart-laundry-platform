package com.smartlaundromat.reporting.controller;

import com.smartlaundromat.reporting.service.RevenueService;
import lombok.RequiredArgsConstructor;
import org.springframework.web.bind.annotation.*;

import java.util.List;
import java.util.Map;

@RestController
@RequestMapping("/api/admin/revenue")
@RequiredArgsConstructor
public class RevenueController {

    private final RevenueService revenueService;

    @GetMapping("/summary")
    public Map<String, Object> summary(
            @RequestParam(required = false) String startDate,
            @RequestParam(required = false) String endDate) {
        return revenueService.summary(startDate, endDate);
    }

    @GetMapping("/by-provider")
    public List<Map<String, Object>> byProvider(
            @RequestParam(required = false) String startDate,
            @RequestParam(required = false) String endDate) {
        return revenueService.byProvider(startDate, endDate);
    }

    @GetMapping("/by-program")
    public List<Map<String, Object>> byProgram(
            @RequestParam(required = false) String startDate,
            @RequestParam(required = false) String endDate) {
        return revenueService.byProgram(startDate, endDate);
    }

    @GetMapping("/by-machine")
    public List<Map<String, Object>> byMachine(
            @RequestParam(required = false) String startDate,
            @RequestParam(required = false) String endDate) {
        return revenueService.byMachine(startDate, endDate);
    }

    @GetMapping("/trends")
    public List<Map<String, Object>> trends(
            @RequestParam(defaultValue = "day") String granularity,
            @RequestParam(required = false) String startDate,
            @RequestParam(required = false) String endDate) {
        return revenueService.trends(granularity, startDate, endDate);
    }
}
