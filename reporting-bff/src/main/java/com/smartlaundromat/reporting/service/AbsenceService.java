package com.smartlaundromat.reporting.service;

import lombok.RequiredArgsConstructor;
import org.springframework.dao.EmptyResultDataAccessException;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.namedparam.MapSqlParameterSource;
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.web.server.ResponseStatusException;

import java.sql.Timestamp;
import java.time.LocalDate;
import java.util.*;

@Service
@RequiredArgsConstructor
public class AbsenceService {

    private final NamedParameterJdbcTemplate jdbc;

    private static final String ABSENCE_SELECT = """
        SELECT a.id, a.type, a.start_date, a.end_date, a.reason, a.status,
               a.review_notes, a.reviewed_at, a.created_at, a.updated_at,
               (a.end_date - a.start_date + 1) AS duration_days,
               emp.id AS emp_id, emp.name AS emp_name, emp.email AS emp_email, emp.role AS emp_role,
               rev.id AS rev_id, rev.name AS rev_name, rev.email AS rev_email
        FROM ops.absences a
        JOIN ops.staff emp ON emp.id = a.employee_id
        LEFT JOIN ops.staff rev ON rev.id = a.reviewed_by
        """;

    public Map<String, Object> getAll(String startDate, String endDate, String employeeId,
                                       String status, String type, int page, int limit) {
        var params = new MapSqlParameterSource()
            .addValue("startDate",  startDate,  java.sql.Types.VARCHAR)
            .addValue("endDate",    endDate,    java.sql.Types.VARCHAR)
            .addValue("employeeId", employeeId, java.sql.Types.VARCHAR)
            .addValue("status",     status,     java.sql.Types.VARCHAR)
            .addValue("type",       type,       java.sql.Types.VARCHAR)
            .addValue("limit",      limit)
            .addValue("offset",     (page - 1) * limit);

        String where = """
            WHERE (:startDate  IS NULL OR a.start_date >= :startDate::date)
              AND (:endDate    IS NULL OR a.end_date   <= :endDate::date)
              AND (:employeeId IS NULL OR emp.id::text = :employeeId OR emp.auth0_id = :employeeId)
              AND (:status     IS NULL OR a.status = :status)
              AND (:type       IS NULL OR a.type   = :type)
            """;

        Integer total = jdbc.queryForObject(
            "SELECT COUNT(*) FROM ops.absences a JOIN ops.staff emp ON emp.id = a.employee_id " + where,
            params, Integer.class);
        total = total != null ? total : 0;

        List<Map<String, Object>> rows = jdbc.queryForList(
            ABSENCE_SELECT + where + " ORDER BY a.created_at DESC LIMIT :limit OFFSET :offset", params);

        var result = new LinkedHashMap<String, Object>();
        result.put("absences",   rows.stream().map(this::buildAbsence).toList());
        result.put("pagination", Map.of(
            "page",  page,
            "limit", limit,
            "total", total,
            "pages", (total + limit - 1) / limit));
        return result;
    }

    public Map<String, Object> getById(String id) {
        List<Map<String, Object>> rows = jdbc.queryForList(
            ABSENCE_SELECT + " WHERE a.id = :id::uuid", Map.of("id", id));
        if (rows.isEmpty()) throw new ResponseStatusException(HttpStatus.NOT_FOUND, "Absence not found: " + id);
        return buildAbsence(rows.get(0));
    }

    public Map<String, Object> create(Map<String, Object> req) {
        var params = new MapSqlParameterSource()
            .addValue("employeeId", req.get("employeeId"))
            .addValue("type",       req.get("type"))
            .addValue("startDate",  req.get("startDate"))
            .addValue("endDate",    req.get("endDate"))
            .addValue("reason",     req.get("reason"), java.sql.Types.VARCHAR);

        List<Map<String, Object>> result = jdbc.queryForList("""
            INSERT INTO ops.absences (employee_id, type, start_date, end_date, reason)
            VALUES (:employeeId::uuid, :type, :startDate::date, :endDate::date, :reason)
            RETURNING id
            """, params);

        if (result.isEmpty()) throw new ResponseStatusException(HttpStatus.INTERNAL_SERVER_ERROR, "Insert failed");
        return getById(result.get(0).get("id").toString());
    }

    public Map<String, Object> update(String id, Map<String, Object> req) {
        var params = new MapSqlParameterSource()
            .addValue("id",        id)
            .addValue("type",      req.get("type"),      java.sql.Types.VARCHAR)
            .addValue("startDate", req.get("startDate"), java.sql.Types.VARCHAR)
            .addValue("endDate",   req.get("endDate"),   java.sql.Types.VARCHAR)
            .addValue("reason",    req.get("reason"),    java.sql.Types.VARCHAR);

        int rows = jdbc.update("""
            UPDATE ops.absences SET
              type       = COALESCE(:type,            type),
              start_date = COALESCE(:startDate::date, start_date),
              end_date   = COALESCE(:endDate::date,   end_date),
              reason     = COALESCE(:reason,          reason),
              updated_at = NOW()
            WHERE id = :id::uuid
            """, params);

        if (rows == 0) throw new ResponseStatusException(HttpStatus.NOT_FOUND, "Absence not found: " + id);
        return getById(id);
    }

    public void delete(String id) {
        int rows = jdbc.update("DELETE FROM ops.absences WHERE id = :id::uuid", Map.of("id", id));
        if (rows == 0) throw new ResponseStatusException(HttpStatus.NOT_FOUND, "Absence not found: " + id);
    }

    public Map<String, Object> review(String id, String status, String reviewerAuth0Id, String notes) {
        // Resolve reviewer id
        List<Map<String, Object>> reviewer = jdbc.queryForList(
            "SELECT id FROM ops.staff WHERE auth0_id = :auth0Id",
            Map.of("auth0Id", reviewerAuth0Id));
        Object reviewerId = reviewer.isEmpty() ? null : reviewer.get(0).get("id");

        var params = new MapSqlParameterSource()
            .addValue("id",         id)
            .addValue("status",     status)
            .addValue("reviewerId", reviewerId)
            .addValue("notes",      notes, java.sql.Types.VARCHAR);

        int rows = jdbc.update("""
            UPDATE ops.absences SET
              status      = :status,
              reviewed_by = :reviewerId::uuid,
              reviewed_at = NOW(),
              review_notes = :notes,
              updated_at  = NOW()
            WHERE id = :id::uuid
            """, params);

        if (rows == 0) throw new ResponseStatusException(HttpStatus.NOT_FOUND, "Absence not found: " + id);
        return getById(id);
    }

    public Map<String, Object> getPendingCount() {
        List<Map<String, Object>> rows = jdbc.queryForList("""
            SELECT s.id AS emp_id, s.name AS emp_name, s.email AS emp_email,
                   COUNT(*) AS pending_count
            FROM ops.absences a
            JOIN ops.staff s ON s.id = a.employee_id
            WHERE a.status = 'pending'
            GROUP BY s.id, s.name, s.email
            ORDER BY pending_count DESC
            """, Map.of());

        int total = rows.stream().mapToInt(r -> ((Number) r.get("pending_count")).intValue()).sum();

        List<Map<String, Object>> byEmployee = rows.stream().map(r -> Map.of(
            "employee", Map.of("name", r.get("emp_name"), "email", r.get("emp_email")),
            "count",    r.get("pending_count")
        )).toList();

        return Map.of("count", total, "by_employee", byEmployee);
    }

    public Map<String, Object> getEmployeeSummary(String employeeId, int year) {
        var params = new MapSqlParameterSource()
            .addValue("employeeId", employeeId, java.sql.Types.VARCHAR)
            .addValue("year",       year);

        // employeeId may be UUID or Auth0 sub — handle both
        List<Map<String, Object>> rows = jdbc.queryForList("""
            SELECT a.type,
                   COUNT(*)                               AS count,
                   SUM(a.end_date - a.start_date + 1)    AS total_days,
                   s.id AS emp_id, s.name AS emp_name, s.email AS emp_email, s.role AS emp_role
            FROM ops.absences a
            JOIN ops.staff s ON s.id = a.employee_id
            WHERE (s.id::text = :employeeId OR s.auth0_id = :employeeId)
              AND EXTRACT(YEAR FROM a.start_date) = :year
              AND a.status = 'approved'
            GROUP BY a.type, s.id, s.name, s.email, s.role
            """, params);

        Map<String, Object> employee = Map.of();
        Map<String, Object> summary  = buildEmptySummary();

        for (Map<String, Object> row : rows) {
            if (employee.isEmpty()) {
                employee = Map.of(
                    "id",    row.get("emp_id"),
                    "name",  row.get("emp_name"),
                    "email", row.get("emp_email"),
                    "role",  row.get("emp_role"));
            }
            String absType  = (String) row.get("type");
            int    count    = ((Number) row.get("count")).intValue();
            int    days     = ((Number) row.get("total_days")).intValue();
            ((Map<String, Object>) summary.get(absType)).put("count",      count);
            ((Map<String, Object>) summary.get(absType)).put("total_days", days);
        }

        return Map.of("employee", employee, "year", year, "summary", summary);
    }

    @SuppressWarnings("unchecked")
    private Map<String, Object> buildEmptySummary() {
        var summary = new LinkedHashMap<String, Object>();
        for (String t : List.of("vacation","sick","personal","unpaid_leave","family_emergency","training")) {
            var m = new LinkedHashMap<String, Object>();
            m.put("total_days", 0);
            m.put("count",      0);
            summary.put(t, m);
        }
        return summary;
    }

    private Map<String, Object> buildAbsence(Map<String, Object> row) {
        var emp = new LinkedHashMap<String, Object>();
        emp.put("id",    row.get("emp_id"));
        emp.put("name",  row.get("emp_name"));
        emp.put("email", row.get("emp_email"));
        emp.put("role",  row.get("emp_role"));

        var absence = new LinkedHashMap<String, Object>();
        absence.put("id",           row.get("id"));
        absence.put("employee",     emp);
        absence.put("type",         row.get("type"));
        absence.put("start_date",   row.get("start_date"));
        absence.put("end_date",     row.get("end_date"));
        absence.put("reason",       row.get("reason"));
        absence.put("status",       row.get("status"));
        absence.put("review_notes", row.get("review_notes"));
        absence.put("reviewed_at",  row.get("reviewed_at"));
        absence.put("duration_days",row.get("duration_days"));
        absence.put("created_at",   row.get("created_at"));
        absence.put("updated_at",   row.get("updated_at"));

        if (row.get("rev_id") != null) {
            var rev = new LinkedHashMap<String, Object>();
            rev.put("id",    row.get("rev_id"));
            rev.put("name",  row.get("rev_name"));
            rev.put("email", row.get("rev_email"));
            absence.put("reviewed_by", rev);
        } else {
            absence.put("reviewed_by", null);
        }
        return absence;
    }
}
