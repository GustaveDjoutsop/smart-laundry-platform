package com.smartlaundromat.reporting.service;

import lombok.RequiredArgsConstructor;
import org.springframework.jdbc.core.namedparam.MapSqlParameterSource;
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate;
import org.springframework.stereotype.Service;

import java.util.List;
import java.util.Map;

@Service
@RequiredArgsConstructor
public class RevenueService {

    private final NamedParameterJdbcTemplate jdbc;

    public Map<String, Object> summary(String startDate, String endDate) {
        String prevStart = null;
        String prevEnd   = null;
        if (startDate != null && endDate != null) {
            java.time.LocalDate s = java.time.LocalDate.parse(startDate);
            java.time.LocalDate e = java.time.LocalDate.parse(endDate);
            long days = java.time.temporal.ChronoUnit.DAYS.between(s, e) + 1;
            prevEnd   = s.minusDays(1).toString();
            prevStart = s.minusDays(days).toString();
        }
        var params = new MapSqlParameterSource()
            .addValue("startDate", startDate, java.sql.Types.VARCHAR)
            .addValue("endDate",   endDate,   java.sql.Types.VARCHAR)
            .addValue("prevStart", prevStart, java.sql.Types.VARCHAR)
            .addValue("prevEnd",   prevEnd,   java.sql.Types.VARCHAR);
        return jdbc.queryForMap("""
            WITH cur AS (
              SELECT
                COALESCE(SUM(amount), 0)        AS revenue,
                COUNT(*)::int                   AS transactions,
                COALESCE(AVG(amount), 0)        AS avg_transaction,
                COUNT(DISTINCT machine_id)::int AS machines_used
              FROM payment.transactions
              WHERE status = 'SUCCESSFUL'
                AND (:startDate IS NULL OR created_at >= :startDate::timestamptz)
                AND (:endDate   IS NULL OR created_at <= :endDate::timestamptz)
            ),
            prev AS (
              SELECT
                COALESCE(SUM(amount), 0) AS revenue,
                COUNT(*)::int            AS transactions
              FROM payment.transactions
              WHERE status = 'SUCCESSFUL'
                AND (:prevStart IS NULL OR created_at >= :prevStart::timestamptz)
                AND (:prevEnd   IS NULL OR created_at <= :prevEnd::timestamptz)
            )
            SELECT
              cur.revenue         AS total_revenue,
              cur.transactions    AS total_transactions,
              cur.avg_transaction AS avg_transaction,
              cur.machines_used   AS machines_used,
              prev.revenue        AS prev_revenue,
              prev.transactions   AS prev_transactions
            FROM cur, prev
            """, params);
    }

    public List<Map<String, Object>> byProvider(String startDate, String endDate) {
        return jdbc.queryForList("""
            SELECT
              payment_provider            AS provider,
              COALESCE(SUM(amount), 0)    AS revenue,
              COUNT(*)::int               AS transactions
            FROM payment.transactions
            WHERE status = 'SUCCESSFUL'
              AND (:startDate IS NULL OR created_at >= :startDate::timestamptz)
              AND (:endDate   IS NULL OR created_at <= :endDate::timestamptz)
            GROUP BY payment_provider
            ORDER BY revenue DESC
            """, dateParams(startDate, endDate));
    }

    public List<Map<String, Object>> byProgram(String startDate, String endDate) {
        return jdbc.queryForList("""
            SELECT
              cycle_duration              AS duration_minutes,
              COALESCE(SUM(amount), 0)    AS revenue,
              COUNT(*)::int               AS transactions,
              COALESCE(AVG(amount), 0)    AS avg_price
            FROM payment.transactions
            WHERE status = 'SUCCESSFUL'
              AND (:startDate IS NULL OR created_at >= :startDate::timestamptz)
              AND (:endDate   IS NULL OR created_at <= :endDate::timestamptz)
            GROUP BY cycle_duration
            ORDER BY revenue DESC
            """, dateParams(startDate, endDate));
    }

    public List<Map<String, Object>> byMachine(String startDate, String endDate) {
        return jdbc.queryForList("""
            SELECT
              t.machine_id,
              m.type                      AS machine_type,
              COALESCE(SUM(t.amount), 0)  AS revenue,
              COUNT(*)::int               AS transactions
            FROM payment.transactions t
            LEFT JOIN machine.machines m ON m.machine_id = t.machine_id
            WHERE t.status = 'SUCCESSFUL'
              AND (:startDate IS NULL OR t.created_at >= :startDate::timestamptz)
              AND (:endDate   IS NULL OR t.created_at <= :endDate::timestamptz)
            GROUP BY t.machine_id, m.type
            ORDER BY revenue DESC
            """, dateParams(startDate, endDate));
    }

    public List<Map<String, Object>> trends(String granularity, String startDate, String endDate) {
        String truncExpr = switch (granularity != null ? granularity.toLowerCase() : "day") {
            case "week"  -> "DATE_TRUNC('week',  created_at)";
            case "month" -> "DATE_TRUNC('month', created_at)";
            default      -> "created_at::date";
        };
        return jdbc.queryForList("""
            SELECT
              %s                          AS period,
              COALESCE(SUM(amount), 0)    AS revenue,
              COUNT(*)::int               AS transactions
            FROM payment.transactions
            WHERE status = 'SUCCESSFUL'
              AND (:startDate IS NULL OR created_at >= :startDate::timestamptz)
              AND (:endDate   IS NULL OR created_at <= :endDate::timestamptz)
            GROUP BY 1
            ORDER BY 1
            """.formatted(truncExpr), dateParams(startDate, endDate));
    }

    private MapSqlParameterSource dateParams(String startDate, String endDate) {
        return new MapSqlParameterSource()
            .addValue("startDate", startDate, java.sql.Types.VARCHAR)
            .addValue("endDate",   endDate,   java.sql.Types.VARCHAR);
    }
}
