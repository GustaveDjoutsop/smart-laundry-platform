package com.smartlaundromat.reporting.service;

import lombok.RequiredArgsConstructor;
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate;
import org.springframework.stereotype.Service;

import java.time.LocalDate;
import java.util.List;
import java.util.Map;

@Service
@RequiredArgsConstructor
public class DashboardService {

    private final NamedParameterJdbcTemplate jdbc;

    public Map<String, Object> summary() {
        Map<String, Object> todayRev = jdbc.queryForMap("""
            SELECT COALESCE(SUM(amount), 0) AS total, COUNT(*)::int AS count
            FROM payment.transactions
            WHERE status = 'SUCCESSFUL'
              AND created_at >= CURRENT_DATE::timestamptz
            """, Map.of());

        Map<String, Object> monthRev = jdbc.queryForMap("""
            SELECT COALESCE(SUM(amount), 0) AS total, COUNT(*)::int AS count
            FROM payment.transactions
            WHERE status = 'SUCCESSFUL'
              AND created_at >= DATE_TRUNC('month', CURRENT_DATE)::timestamptz
            """, Map.of());

        Map<String, Object> machines = jdbc.queryForMap("""
            SELECT
              COUNT(*)::int AS total,
              COUNT(*) FILTER (WHERE status = 'RUNNING')::int    AS running,
              COUNT(*) FILTER (WHERE status = 'IDLE')::int       AS idle,
              COUNT(*) FILTER (WHERE status IN ('MAINTENANCE','OFFLINE'))::int AS unavailable
            FROM machine.machines
            """, Map.of());

        Map<String, Object> activeCycles = jdbc.queryForMap("""
            SELECT COUNT(*)::int AS count
            FROM machine.machine_cycles
            WHERE status = 'RUNNING' AND ends_at > NOW()
            """, Map.of());

        Map<String, Object> pending = jdbc.queryForMap("""
            SELECT COUNT(*)::int AS count
            FROM payment.transactions
            WHERE status = 'PENDING'
              AND created_at >= NOW() - INTERVAL '24 hours'
            """, Map.of());

        return Map.of(
            "today", Map.of(
                "revenue", todayRev.get("total"),
                "transactions", todayRev.get("count")
            ),
            "month", Map.of(
                "revenue", monthRev.get("total"),
                "transactions", monthRev.get("count")
            ),
            "machines", Map.of(
                "total", machines.get("total"),
                "running", machines.get("running"),
                "idle", machines.get("idle"),
                "unavailable", machines.get("unavailable"),
                "activeCycles", activeCycles.get("count")
            ),
            "pendingTransactions24h", pending.get("count")
        );
    }

    public List<Map<String, Object>> dailyStats(LocalDate start, LocalDate end) {
        return jdbc.queryForList("""
            SELECT
              created_at::date                    AS date,
              COALESCE(SUM(amount), 0)            AS revenue,
              COUNT(*)::int                       AS transactions,
              COUNT(DISTINCT machine_id)::int     AS machines_used
            FROM payment.transactions
            WHERE status = 'SUCCESSFUL'
              AND created_at >= :start::timestamptz
              AND created_at <  :end::timestamptz
            GROUP BY 1
            ORDER BY 1
            """, Map.of("start", start.toString(), "end", end.toString()));
    }
}
