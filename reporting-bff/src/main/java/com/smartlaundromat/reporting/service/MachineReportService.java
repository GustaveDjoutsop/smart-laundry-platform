package com.smartlaundromat.reporting.service;

import lombok.RequiredArgsConstructor;
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate;
import org.springframework.stereotype.Service;

import java.util.List;
import java.util.Map;

@Service
@RequiredArgsConstructor
public class MachineReportService {

    private final NamedParameterJdbcTemplate jdbc;

    public List<Map<String, Object>> listMachines() {
        return jdbc.queryForList("""
            SELECT
              m.machine_id, m.type, m.status, m.created_at,
              mc.id                       AS active_cycle_id,
              mc.started_at               AS cycle_started_at,
              mc.ends_at                  AS cycle_ends_at,
              mc.transaction_reference    AS cycle_tx_ref,
              t.phone_number              AS cycle_customer,
              t.amount                    AS cycle_amount,
              t.payment_provider          AS cycle_provider
            FROM machine.machines m
            LEFT JOIN machine.machine_cycles mc
              ON mc.machine_id = m.machine_id
              AND mc.status = 'RUNNING'
              AND mc.ends_at > NOW()
            LEFT JOIN payment.transactions t
              ON t.external_reference = mc.transaction_reference
            ORDER BY m.machine_id
            """, Map.of());
    }

    public Map<String, Object> findMachine(String machineId) {
        List<Map<String, Object>> rows = jdbc.queryForList("""
            SELECT
              m.machine_id, m.type, m.status, m.created_at,
              mc.id                       AS active_cycle_id,
              mc.started_at               AS cycle_started_at,
              mc.ends_at                  AS cycle_ends_at,
              t.phone_number              AS cycle_customer,
              t.amount                    AS cycle_amount
            FROM machine.machines m
            LEFT JOIN machine.machine_cycles mc
              ON mc.machine_id = m.machine_id
              AND mc.status = 'RUNNING'
              AND mc.ends_at > NOW()
            LEFT JOIN payment.transactions t
              ON t.external_reference = mc.transaction_reference
            WHERE m.machine_id = :machineId
            """, Map.of("machineId", machineId));
        return rows.isEmpty() ? null : rows.get(0);
    }

    public List<Map<String, Object>> cycleHistory(String machineId, int limit) {
        return jdbc.queryForList("""
            SELECT
              mc.id, mc.machine_id, mc.status, mc.started_at,
              mc.ends_at, mc.transaction_reference, mc.created_at,
              t.phone_number, t.amount, t.payment_provider
            FROM machine.machine_cycles mc
            LEFT JOIN payment.transactions t
              ON t.external_reference = mc.transaction_reference
            WHERE mc.machine_id = :machineId
            ORDER BY mc.created_at DESC
            LIMIT :limit
            """, Map.of("machineId", machineId, "limit", limit));
    }
}
