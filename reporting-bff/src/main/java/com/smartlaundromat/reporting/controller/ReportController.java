package com.smartlaundromat.reporting.controller;

import com.smartlaundromat.reporting.service.RevenueService;
import lombok.RequiredArgsConstructor;
import org.springframework.web.bind.annotation.*;

import java.time.LocalDate;
import java.util.Map;

@RestController
@RequestMapping("/api/admin/reports")
@RequiredArgsConstructor
public class ReportController {

    private final RevenueService revenueService;

    @GetMapping("/daily/{date}")
    public Map<String, Object> daily(@PathVariable String date) {
        LocalDate d    = LocalDate.parse(date);
        String start   = d.toString();
        String end     = d.plusDays(1).toString();
        return Map.of(
            "date",       date,
            "summary",    revenueService.summary(start, end),
            "byProvider", revenueService.byProvider(start, end),
            "byMachine",  revenueService.byMachine(start, end)
        );
    }

    @GetMapping("/monthly/{year}/{month}")
    public Map<String, Object> monthly(@PathVariable int year, @PathVariable int month) {
        LocalDate start = LocalDate.of(year, month, 1);
        String startStr = start.toString();
        String endStr   = start.plusMonths(1).toString();
        return Map.of(
            "year",       year,
            "month",      month,
            "summary",    revenueService.summary(startStr, endStr),
            "byProvider", revenueService.byProvider(startStr, endStr),
            "byMachine",  revenueService.byMachine(startStr, endStr),
            "dailyTrend", revenueService.trends("day", startStr, endStr)
        );
    }
}
