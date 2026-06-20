package com.smartlaundromat.reporting.controller;

import com.smartlaundromat.reporting.service.RevenueService;
import lombok.RequiredArgsConstructor;
import org.springframework.jdbc.core.namedparam.MapSqlParameterSource;
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate;
import org.springframework.web.bind.annotation.*;

import java.util.List;
import java.util.Map;

@RestController
@RequestMapping("/api/admin/reconciliation")
@RequiredArgsConstructor
public class ReconciliationController {

    private final RevenueService revenueService;
    private final NamedParameterJdbcTemplate jdbc;

    @PostMapping("/run")
    public Map<String, Object> run(@RequestBody(required = false) Map<String, Object> body) {
        String startDate = body != null ? (String) body.get("startDate") : null;
        String endDate   = body != null ? (String) body.get("endDate")   : null;
        Map<String, Object> summary = revenueService.summary(startDate, endDate);
        List<Map<String, Object>> discrepancies = findDiscrepancies(startDate, endDate);
        return Map.of(
            "status",           "completed",
            "period",           Map.of(
                "startDate", startDate != null ? startDate : "all",
                "endDate",   endDate   != null ? endDate   : "now"
            ),
            "paymentTotal",      summary.get("total_revenue"),
            "transactionCount",  summary.get("total_transactions"),
            "discrepancyCount",  discrepancies.size(),
            "discrepancies",     discrepancies
        );
    }

    @GetMapping("/discrepancies")
    public List<Map<String, Object>> discrepancies(
            @RequestParam(required = false) String startDate,
            @RequestParam(required = false) String endDate) {
        return findDiscrepancies(startDate, endDate);
    }

    private List<Map<String, Object>> findDiscrepancies(String startDate, String endDate) {
        return jdbc.queryForList("""
            SELECT t.id, t.external_reference, t.machine_id, t.amount, t.created_at
            FROM payment.transactions t
            LEFT JOIN machine.machine_cycles mc
              ON mc.transaction_reference = t.external_reference
            WHERE t.status = 'SUCCESSFUL'
              AND mc.id IS NULL
              AND (:startDate IS NULL OR t.created_at >= :startDate::timestamptz)
              AND (:endDate   IS NULL OR t.created_at <= :endDate::timestamptz)
            ORDER BY t.created_at DESC
            """, new MapSqlParameterSource()
                .addValue("startDate", startDate)
                .addValue("endDate",   endDate));
    }
}
