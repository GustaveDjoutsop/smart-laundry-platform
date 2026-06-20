package com.smartlaundromat.reporting.service;

import lombok.RequiredArgsConstructor;
import org.springframework.jdbc.core.namedparam.MapSqlParameterSource;
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate;
import org.springframework.stereotype.Service;

import java.util.List;
import java.util.Map;

@Service
@RequiredArgsConstructor
public class ExpenseService {

    private final NamedParameterJdbcTemplate jdbc;

    public List<Map<String, Object>> list(String startDate, String endDate, String category) {
        return jdbc.queryForList("""
            SELECT id, category, description, amount, currency, expense_date,
                   payment_method, vendor, receipt_number, notes, is_recurring, created_at
            FROM ops.expenses
            WHERE (:startDate IS NULL OR expense_date >= :startDate::date)
              AND (:endDate   IS NULL OR expense_date <= :endDate::date)
              AND (:category  IS NULL OR category = :category)
            ORDER BY expense_date DESC
            """, new MapSqlParameterSource()
                .addValue("startDate", startDate, java.sql.Types.VARCHAR)
                .addValue("endDate",   endDate,   java.sql.Types.VARCHAR)
                .addValue("category",  category,  java.sql.Types.VARCHAR));
    }

    public Map<String, Object> create(Map<String, Object> request) {
        var params = new MapSqlParameterSource()
            .addValue("category",      request.get("category"))
            .addValue("description",   request.get("description"))
            .addValue("amount",        request.get("amount"))
            .addValue("currency",      request.getOrDefault("currency", "XAF"))
            .addValue("expenseDate",   request.get("expenseDate"))
            .addValue("paymentMethod", request.get("paymentMethod"))
            .addValue("vendor",        request.get("vendor"))
            .addValue("receiptNumber", request.get("receiptNumber"))
            .addValue("notes",         request.get("notes"))
            .addValue("isRecurring",   Boolean.TRUE.equals(request.get("isRecurring")));

        List<Map<String, Object>> result = jdbc.queryForList("""
            INSERT INTO ops.expenses
              (category, description, amount, currency, expense_date,
               payment_method, vendor, receipt_number, notes, is_recurring)
            VALUES
              (:category, :description, :amount, :currency, :expenseDate::date,
               :paymentMethod, :vendor, :receiptNumber, :notes, :isRecurring)
            RETURNING id, category, description, amount, currency, expense_date,
                      payment_method, vendor, receipt_number, notes, is_recurring, created_at
            """, params);
        return result.isEmpty() ? Map.of() : result.get(0);
    }
}
