package com.smartlaundromat.reporting.service;

import lombok.RequiredArgsConstructor;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.namedparam.MapSqlParameterSource;
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.stereotype.Service;
import org.springframework.web.server.ResponseStatusException;

import java.sql.Timestamp;
import java.time.Duration;
import java.time.Instant;
import java.util.*;

@Service
@RequiredArgsConstructor
public class TimekeepingService {

    private final NamedParameterJdbcTemplate jdbc;

    // ── Identity helpers ──────────────────────────────────────────────────────

    /**
     * Finds the ops.staff UUID for the JWT user.
     * If no record exists yet, auto-provisions one from the JWT email/name claims
     * so the first clock-in works without a manual admin setup step.
     */
    private UUID findOrCreateEmployee(Jwt jwt) {
        String auth0Id = jwt.getSubject();

        List<Map<String, Object>> existing = jdbc.queryForList(
            "SELECT id FROM ops.staff WHERE auth0_id = :auth0Id",
            Map.of("auth0Id", auth0Id));

        if (!existing.isEmpty()) {
            return UUID.fromString(existing.get(0).get("id").toString());
        }

        // Auto-provision from JWT claims.
        // Auth0 access tokens don't carry email/name by default; fall back to
        // placeholders derived from the sub so the INSERT always succeeds.
        // Admin can update name/email/auth0Id from the Users page later.
        String email = jwt.getClaimAsString("email");
        String name  = jwt.getClaimAsString("name");

        String safeId = auth0Id.replaceAll("[^a-zA-Z0-9]", "_");
        String effectiveEmail = (email != null && !email.isBlank())
                ? email : (safeId + "@pending.local");
        String effectiveName  = (name  != null && !name.isBlank())
                ? name  : ("Staff " + safeId);

        String role = "employee";
        List<String> roles = jwt.getClaimAsStringList("https://smartlaundry.api/roles");
        if (roles != null && !roles.isEmpty()) role = roles.get(0);

        var params = new MapSqlParameterSource()
            .addValue("auth0Id", auth0Id)
            .addValue("name",    effectiveName)
            .addValue("email",   effectiveEmail)
            .addValue("role",    role);

        List<Map<String, Object>> created = jdbc.queryForList("""
            INSERT INTO ops.staff (auth0_id, name, email, role)
            VALUES (:auth0Id, :name, :email, :role)
            ON CONFLICT (auth0_id) DO UPDATE SET updated_at = NOW()
            RETURNING id
            """, params);

        return UUID.fromString(created.get(0).get("id").toString());
    }

    // ── Clock operations ──────────────────────────────────────────────────────

    public Map<String, Object> clockIn(Jwt jwt, String notes) {
        UUID empId = findOrCreateEmployee(jwt);

        // Verify not already clocked in
        List<Map<String, Object>> last = jdbc.queryForList("""
            SELECT type FROM ops.time_entries WHERE employee_id = :empId
            ORDER BY timestamp DESC LIMIT 1
            """, Map.of("empId", empId));

        if (!last.isEmpty() && "clock_in".equals(last.get(0).get("type"))) {
            throw new ResponseStatusException(HttpStatus.CONFLICT, "Already clocked in");
        }

        var params = new MapSqlParameterSource()
            .addValue("empId", empId)
            .addValue("notes", notes, java.sql.Types.VARCHAR);

        List<Map<String, Object>> result = jdbc.queryForList("""
            INSERT INTO ops.time_entries (employee_id, type, method, notes)
            VALUES (:empId, 'clock_in', 'manual', :notes)
            RETURNING id, employee_id, type, timestamp, method, notes, created_at, updated_at
            """, params);

        Map<String, Object> entry = result.isEmpty() ? Map.of() : result.get(0);
        return Map.of("entry", entry, "message", "Clocked in successfully");
    }

    public Map<String, Object> clockOut(Jwt jwt, String notes) {
        UUID empId = findOrCreateEmployee(jwt);

        List<Map<String, Object>> last = jdbc.queryForList("""
            SELECT id, type, timestamp FROM ops.time_entries WHERE employee_id = :empId
            ORDER BY timestamp DESC LIMIT 1
            """, Map.of("empId", empId));

        if (last.isEmpty() || !"clock_in".equals(last.get(0).get("type"))) {
            throw new ResponseStatusException(HttpStatus.CONFLICT, "Not currently clocked in");
        }

        Instant clockInTime = toInstant(last.get(0).get("timestamp"));
        long sessionMinutes = Duration.between(clockInTime, Instant.now()).toMinutes();

        var params = new MapSqlParameterSource()
            .addValue("empId", empId)
            .addValue("notes", notes, java.sql.Types.VARCHAR);

        List<Map<String, Object>> result = jdbc.queryForList("""
            INSERT INTO ops.time_entries (employee_id, type, method, notes)
            VALUES (:empId, 'clock_out', 'manual', :notes)
            RETURNING id, employee_id, type, timestamp, method, notes, created_at, updated_at
            """, params);

        Map<String, Object> entry = result.isEmpty() ? Map.of() : result.get(0);
        long hours   = sessionMinutes / 60;
        long minutes = sessionMinutes % 60;
        return Map.of(
            "entry", entry,
            "message", "Clocked out successfully",
            "session_duration", Map.of(
                "hours", hours,
                "minutes", minutes,
                "formatted", hours + "h " + minutes + "m"));
    }

    public Map<String, Object> getStatus(Jwt jwt) {
        UUID empId = findOrCreateEmployee(jwt);

        List<Map<String, Object>> last = jdbc.queryForList("""
            SELECT id, employee_id, type, timestamp, method, notes, created_at, updated_at
            FROM ops.time_entries WHERE employee_id = :empId
            ORDER BY timestamp DESC LIMIT 1
            """, Map.of("empId", empId));

        if (last.isEmpty()) {
            var status = new LinkedHashMap<String, Object>();
            status.put("is_clocked_in", false);
            status.put("last_entry", null);
            status.put("current_session_duration", null);
            return status;
        }

        Map<String, Object> lastEntry = last.get(0);
        boolean isClockedIn = "clock_in".equals(lastEntry.get("type"));

        Map<String, Object> sessionDuration = null;
        if (isClockedIn) {
            Instant start = toInstant(lastEntry.get("timestamp"));
            long totalMinutes = Duration.between(start, Instant.now()).toMinutes();
            long hours   = totalMinutes / 60;
            long minutes = totalMinutes % 60;
            sessionDuration = Map.of(
                "hours", hours,
                "minutes", minutes,
                "formatted", hours + "h " + minutes + "m",
                "start_time", start.toString());
        }

        var result = new LinkedHashMap<String, Object>();
        result.put("is_clocked_in", isClockedIn);
        result.put("last_entry", lastEntry);
        result.put("current_session_duration", sessionDuration);
        return result;
    }

    // ── Entry list ─────────────────────────────────────────────────────────────

    public Map<String, Object> getEntries(String startDate, String endDate,
                                           UUID employeeId, Jwt jwt,
                                           int page, int limit) {
        UUID empId = employeeId != null ? employeeId : findOrCreateEmployee(jwt);

        var params = new MapSqlParameterSource()
            .addValue("empId",     empId)
            .addValue("startDate", startDate, java.sql.Types.VARCHAR)
            .addValue("endDate",   endDate,   java.sql.Types.VARCHAR)
            .addValue("limit",     limit)
            .addValue("offset",    (page - 1) * limit);

        String where = """
            WHERE te.employee_id = :empId
              AND (:startDate IS NULL OR te.timestamp >= :startDate::timestamptz)
              AND (:endDate   IS NULL OR te.timestamp <= :endDate::timestamptz + INTERVAL '1 day')
            """;

        Integer total = jdbc.queryForObject(
            "SELECT COUNT(*) FROM ops.time_entries te " + where, params, Integer.class);
        total = total != null ? total : 0;

        List<Map<String, Object>> rawRows = jdbc.queryForList("""
            SELECT te.id, te.type, te.timestamp, te.method, te.notes, te.created_at, te.updated_at,
                   s.id AS emp_id, s.name AS emp_name, s.email AS emp_email, s.role AS emp_role
            FROM ops.time_entries te
            JOIN ops.staff s ON s.id = te.employee_id
            """ + where + " ORDER BY te.timestamp DESC LIMIT :limit OFFSET :offset", params);

        List<Map<String, Object>> entries = rawRows.stream()
            .map(this::buildEntry).toList();

        var result = new LinkedHashMap<String, Object>();
        result.put("entries", entries);
        result.put("pagination", Map.of(
            "page",  page,
            "limit", limit,
            "total", total,
            "pages", (total + limit - 1) / limit));
        return result;
    }

    public Map<String, Object> createManualEntry(Map<String, Object> req) {
        var params = new MapSqlParameterSource()
            .addValue("empId",  req.get("employeeId"))
            .addValue("type",   req.get("type"))
            .addValue("ts",     req.get("timestamp"), java.sql.Types.VARCHAR)
            .addValue("notes",  req.get("notes"),     java.sql.Types.VARCHAR);

        List<Map<String, Object>> result = jdbc.queryForList("""
            INSERT INTO ops.time_entries (employee_id, type, timestamp, method, notes)
            VALUES (:empId::uuid, :type, COALESCE(:ts::timestamptz, NOW()), 'manual', :notes)
            RETURNING id, employee_id, type, timestamp, method, notes, created_at, updated_at
            """, params);

        return result.isEmpty() ? Map.of() : result.get(0);
    }

    public void deleteEntry(String id) {
        int rows = jdbc.update(
            "DELETE FROM ops.time_entries WHERE id = :id::uuid", Map.of("id", id));
        if (rows == 0) throw new ResponseStatusException(HttpStatus.NOT_FOUND, "Entry not found: " + id);
    }

    // ── Summary (session pairing) ──────────────────────────────────────────────

    public Map<String, Object> getSummary(String startDate, String endDate,
                                           UUID employeeId, Jwt jwt) {
        UUID empId = employeeId != null ? employeeId : findOrCreateEmployee(jwt);

        var params = new MapSqlParameterSource()
            .addValue("empId",     empId)
            .addValue("startDate", startDate, java.sql.Types.VARCHAR)
            .addValue("endDate",   endDate,   java.sql.Types.VARCHAR);

        List<Map<String, Object>> rows = jdbc.queryForList("""
            SELECT te.id, te.type, te.timestamp, te.notes,
                   s.id AS emp_id, s.name AS emp_name, s.email AS emp_email, s.role AS emp_role
            FROM ops.time_entries te
            JOIN ops.staff s ON s.id = te.employee_id
            WHERE te.employee_id = :empId
              AND (:startDate IS NULL OR te.timestamp >= :startDate::timestamptz)
              AND (:endDate   IS NULL OR te.timestamp <= :endDate::timestamptz + INTERVAL '1 day')
            ORDER BY te.timestamp ASC
            """, params);

        // Pair clock-in / clock-out into sessions
        List<Map<String, Object>> sessions = new ArrayList<>();
        Map<String, Object> openIn = null;
        long totalMinutes = 0;

        for (Map<String, Object> row : rows) {
            String type = (String) row.get("type");
            if ("clock_in".equals(type)) {
                openIn = row;
            } else if ("clock_out".equals(type) && openIn != null) {
                Instant inTime  = toInstant(openIn.get("timestamp"));
                Instant outTime = toInstant(row.get("timestamp"));
                long mins = Duration.between(inTime, outTime).toMinutes();
                totalMinutes += mins;
                sessions.add(buildSession(inTime, outTime, mins, false));
                openIn = null;
            }
        }
        if (openIn != null) {
            Instant inTime = toInstant(openIn.get("timestamp"));
            long mins = Duration.between(inTime, Instant.now()).toMinutes();
            totalMinutes += mins;
            sessions.add(buildSession(inTime, null, mins, true));
        }

        Map<String, Object> employee = Map.of();
        if (!rows.isEmpty()) {
            Map<String, Object> r = rows.get(0);
            employee = Map.of(
                "id",    r.get("emp_id"),
                "name",  r.get("emp_name"),
                "email", r.get("emp_email"),
                "role",  r.get("emp_role"));
        }

        long totalHours     = totalMinutes / 60;
        long remainingMins  = totalMinutes % 60;

        var result = new LinkedHashMap<String, Object>();
        result.put("employee",          employee);
        result.put("period",            Map.of("start", startDate != null ? startDate : "",
                                               "end",   endDate   != null ? endDate   : ""));
        result.put("total_hours",        totalHours);
        result.put("total_minutes",      totalMinutes);
        result.put("remaining_minutes",  remainingMins);
        result.put("formatted_duration", totalHours + "h " + remainingMins + "m");
        result.put("sessions",           sessions);
        return result;
    }

    public Map<String, Object> getToday(Jwt jwt) {
        UUID empId = findOrCreateEmployee(jwt);
        String today = java.time.LocalDate.now().toString();

        var params = new MapSqlParameterSource()
            .addValue("empId", empId)
            .addValue("today", today, java.sql.Types.VARCHAR);

        List<Map<String, Object>> rawRows = jdbc.queryForList("""
            SELECT te.id, te.type, te.timestamp, te.method, te.notes, te.created_at, te.updated_at,
                   s.id AS emp_id, s.name AS emp_name, s.email AS emp_email, s.role AS emp_role
            FROM ops.time_entries te
            JOIN ops.staff s ON s.id = te.employee_id
            WHERE te.employee_id = :empId
              AND te.timestamp >= :today::date
              AND te.timestamp <  :today::date + INTERVAL '1 day'
            ORDER BY te.timestamp ASC
            """, params);

        List<Map<String, Object>> entries = rawRows.stream().map(this::buildEntry).toList();

        // Pair sessions
        List<Map<String, Object>> sessions = new ArrayList<>();
        Map<String, Object> openIn = null;
        long totalMinutes = 0;

        for (Map<String, Object> row : rawRows) {
            if ("clock_in".equals(row.get("type"))) {
                openIn = row;
            } else if ("clock_out".equals(row.get("type")) && openIn != null) {
                Instant inTime  = toInstant(openIn.get("timestamp"));
                Instant outTime = toInstant(row.get("timestamp"));
                long mins = Duration.between(inTime, outTime).toMinutes();
                totalMinutes += mins;
                sessions.add(buildSession(inTime, outTime, mins, false));
                openIn = null;
            }
        }
        if (openIn != null) {
            Instant inTime = toInstant(openIn.get("timestamp"));
            long mins = Duration.between(inTime, Instant.now()).toMinutes();
            totalMinutes += mins;
            sessions.add(buildSession(inTime, null, mins, true));
        }

        long h = totalMinutes / 60;
        long m = totalMinutes % 60;

        var today_data = new LinkedHashMap<String, Object>();
        today_data.put("entries",    entries);
        today_data.put("sessions",   sessions);
        today_data.put("total_hours", h + "h " + m + "m");
        return Map.of("today", today_data);
    }

    // ── Helpers ───────────────────────────────────────────────────────────────

    private Map<String, Object> buildEntry(Map<String, Object> row) {
        var emp = new LinkedHashMap<String, Object>();
        emp.put("id",    row.get("emp_id"));
        emp.put("name",  row.get("emp_name"));
        emp.put("email", row.get("emp_email"));
        emp.put("role",  row.get("emp_role"));

        var entry = new LinkedHashMap<String, Object>();
        entry.put("id",         row.get("id"));
        entry.put("employee",   emp);
        entry.put("type",       row.get("type"));
        entry.put("timestamp",  row.get("timestamp"));
        entry.put("method",     row.get("method"));
        entry.put("notes",      row.get("notes"));
        entry.put("created_at", row.get("created_at"));
        entry.put("updated_at", row.get("updated_at"));
        return entry;
    }

    private Map<String, Object> buildSession(Instant inTime, Instant outTime, long minutes, boolean isOpen) {
        var session = new LinkedHashMap<String, Object>();
        session.put("date",      inTime.toString().substring(0, 10));
        session.put("clock_in",  inTime.toString());
        session.put("clock_out", outTime != null ? outTime.toString() : null);
        session.put("duration",  (minutes / 60) + "h " + (minutes % 60) + "m");
        session.put("is_open",   isOpen);
        return session;
    }

    private Instant toInstant(Object ts) {
        if (ts instanceof Timestamp t) return t.toInstant();
        if (ts instanceof Instant i)   return i;
        return Instant.parse(ts.toString());
    }
}
