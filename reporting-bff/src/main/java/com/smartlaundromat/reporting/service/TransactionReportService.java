package com.smartlaundromat.reporting.service;

import lombok.RequiredArgsConstructor;
import org.springframework.jdbc.core.namedparam.MapSqlParameterSource;
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate;
import org.springframework.stereotype.Service;

import java.util.List;
import java.util.Map;

@Service
@RequiredArgsConstructor
public class TransactionReportService {

    private final NamedParameterJdbcTemplate jdbc;

    public Map<String, Object> list(String status, String machineId, String search,
                                    String startDate, String endDate, int page, int size) {
        var params = new MapSqlParameterSource()
            .addValue("status",    status,    java.sql.Types.VARCHAR)
            .addValue("machineId", machineId, java.sql.Types.VARCHAR)
            .addValue("search",    search != null ? "%" + search + "%" : null, java.sql.Types.VARCHAR)
            .addValue("startDate", startDate, java.sql.Types.VARCHAR)
            .addValue("endDate",   endDate,   java.sql.Types.VARCHAR)
            .addValue("limit",     size)
            .addValue("offset",    (long) (Math.max(page, 1) - 1) * size);

        String where = """
            WHERE (CAST(:status    AS TEXT) IS NULL OR t.status     = :status)
              AND (CAST(:machineId AS TEXT) IS NULL OR t.machine_id = :machineId)
              AND (CAST(:startDate AS TEXT) IS NULL OR t.created_at >= :startDate::timestamptz)
              AND (CAST(:endDate   AS TEXT) IS NULL OR t.created_at <= :endDate::timestamptz)
              AND (CAST(:search    AS TEXT) IS NULL OR t.phone_number       ILIKE :search
                                                    OR t.external_reference ILIKE :search
                                                    OR t.provider_reference ILIKE :search)
            """;

        Integer total = jdbc.queryForObject(
            "SELECT COUNT(*)::int FROM payment.transactions t " + where, params, Integer.class);

        List<Map<String, Object>> data = jdbc.queryForList("""
            SELECT
              t.id, t.external_reference, t.phone_number, t.machine_id,
              t.amount, t.status, t.cycle_duration, t.payment_provider,
              t.created_at, t.provider_reference, t.failure_reason, t.rfid_card_uid,
              mc.status      AS cycle_status,
              mc.ends_at     AS cycle_ends_at,
              mc.started_at  AS cycle_started_at
            FROM payment.transactions t
            LEFT JOIN machine.machine_cycles mc
              ON mc.transaction_reference = t.external_reference
            """ + where + """
            ORDER BY t.created_at DESC
            LIMIT :limit OFFSET :offset
            """, params);

        int safeTotal = total != null ? total : 0;
        return Map.of(
            "data",       data,
            "total",      safeTotal,
            "page",       page,
            "size",       size,
            "totalPages", safeTotal == 0 ? 0 : (int) Math.ceil((double) safeTotal / size)
        );
    }

    public byte[] exportCsv(String startDate, String endDate, String machineId, String status) {
        var params = new MapSqlParameterSource()
            .addValue("status",    status,    java.sql.Types.VARCHAR)
            .addValue("machineId", machineId, java.sql.Types.VARCHAR)
            .addValue("startDate", startDate, java.sql.Types.VARCHAR)
            .addValue("endDate",   endDate,   java.sql.Types.VARCHAR);

        List<Map<String, Object>> rows = jdbc.queryForList("""
            SELECT
              t.id, t.external_reference, t.phone_number, t.machine_id,
              t.amount, t.status, t.cycle_duration, t.payment_provider,
              t.created_at, t.provider_reference, t.failure_reason
            FROM payment.transactions t
            WHERE (CAST(:status    AS TEXT) IS NULL OR t.status     = :status)
              AND (CAST(:machineId AS TEXT) IS NULL OR t.machine_id = :machineId)
              AND (CAST(:startDate AS TEXT) IS NULL OR t.created_at >= :startDate::timestamptz)
              AND (CAST(:endDate   AS TEXT) IS NULL OR t.created_at <= :endDate::timestamptz)
            ORDER BY t.created_at DESC
            LIMIT 10000
            """, params);

        var sb = new StringBuilder();
        sb.append("ID,Reference,Phone,Machine,Amount,Status,Duration (min),Provider,Date,Provider Ref,Failure Reason\n");
        for (Map<String, Object> row : rows) {
            sb.append(csvField(row.get("id"))).append(',')
              .append(csvField(row.get("external_reference"))).append(',')
              .append(csvField(row.get("phone_number"))).append(',')
              .append(csvField(row.get("machine_id"))).append(',')
              .append(csvField(row.get("amount"))).append(',')
              .append(csvField(row.get("status"))).append(',')
              .append(csvField(row.get("cycle_duration"))).append(',')
              .append(csvField(row.get("payment_provider"))).append(',')
              .append(csvField(row.get("created_at"))).append(',')
              .append(csvField(row.get("provider_reference"))).append(',')
              .append(csvField(row.get("failure_reason"))).append('\n');
        }
        return sb.toString().getBytes(java.nio.charset.StandardCharsets.UTF_8);
    }

    private static String csvField(Object value) {
        if (value == null) return "";
        String s = value.toString();
        if (s.contains(",") || s.contains("\"") || s.contains("\n")) {
            return "\"" + s.replace("\"", "\"\"") + "\"";
        }
        return s;
    }

    public Map<String, Object> findById(Long id) {
        List<Map<String, Object>> rows = jdbc.queryForList("""
            SELECT
              t.id, t.external_reference, t.phone_number, t.machine_id,
              t.amount, t.status, t.cycle_duration, t.payment_provider,
              t.created_at, t.provider_reference, t.failure_reason, t.rfid_card_uid,
              mc.id          AS cycle_id,
              mc.status      AS cycle_status,
              mc.started_at  AS cycle_started_at,
              mc.ends_at     AS cycle_ends_at
            FROM payment.transactions t
            LEFT JOIN machine.machine_cycles mc
              ON mc.transaction_reference = t.external_reference
            WHERE t.id = :id
            """, Map.of("id", id));
        return rows.isEmpty() ? null : rows.get(0);
    }
}
