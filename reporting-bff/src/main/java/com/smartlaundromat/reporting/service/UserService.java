package com.smartlaundromat.reporting.service;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.dao.EmptyResultDataAccessException;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.namedparam.MapSqlParameterSource;
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.web.server.ResponseStatusException;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

@Service
@Slf4j
@RequiredArgsConstructor
public class UserService {

    private final NamedParameterJdbcTemplate jdbc;
    private final Auth0ManagementService auth0;

    public Map<String, Object> list(int page, int limit, String role, Boolean isActive, String search) {
        String searchPattern = search != null ? "%" + search.toLowerCase() + "%" : null;
        var params = new MapSqlParameterSource()
            .addValue("role",   role,          java.sql.Types.VARCHAR)
            .addValue("active", isActive,      java.sql.Types.BOOLEAN)
            .addValue("search", searchPattern, java.sql.Types.VARCHAR)
            .addValue("limit",  limit)
            .addValue("offset", (page - 1) * limit);

        String where = """
            WHERE (:role   IS NULL OR role = :role)
              AND (:active IS NULL OR is_active = :active)
              AND (:search IS NULL OR LOWER(name) LIKE :search OR LOWER(email) LIKE :search)
            """;

        Integer total = jdbc.queryForObject(
            "SELECT COUNT(*) FROM ops.staff " + where, params, Integer.class);
        total = total != null ? total : 0;

        List<Map<String, Object>> rows = jdbc.queryForList(
            "SELECT id, name, email, role, is_active, auth0_id, created_at, updated_at "
            + "FROM ops.staff " + where
            + "ORDER BY created_at DESC LIMIT :limit OFFSET :offset", params);

        var result = new LinkedHashMap<String, Object>();
        result.put("users", rows);
        result.put("pagination", Map.of(
            "page",  page,
            "limit", limit,
            "total", total,
            "pages", (total + limit - 1) / limit));
        return result;
    }

    public Map<String, Object> getById(String id) {
        try {
            return jdbc.queryForMap(
                "SELECT id, name, email, role, is_active, auth0_id, created_at, updated_at "
                + "FROM ops.staff WHERE id = :id::uuid",
                Map.of("id", id));
        } catch (EmptyResultDataAccessException e) {
            throw new ResponseStatusException(HttpStatus.NOT_FOUND, "User not found: " + id);
        }
    }

    public Map<String, Object> findByAuth0Id(String auth0Id) {
        try {
            return jdbc.queryForMap(
                "SELECT id, name, email, role, is_active, auth0_id FROM ops.staff WHERE auth0_id = :auth0Id",
                Map.of("auth0Id", auth0Id));
        } catch (EmptyResultDataAccessException e) {
            throw new ResponseStatusException(HttpStatus.NOT_FOUND, "Staff record not found for Auth0 user");
        }
    }

    public Map<String, Object> create(Map<String, Object> req) {
        String email    = (String) req.get("email");
        String name     = (String) req.get("name");
        String password = (String) req.get("password");
        String role     = (String) req.getOrDefault("role", "employee");

        // 1. Create the user in Auth0 first — this is the identity provider.
        //    On failure, nothing is written to ops.staff.
        String auth0Id = auth0.createUser(email, name, password, role);

        // 2. Persist the staff record with the Auth0 user_id so auto-provisioning
        //    on first login finds an existing row instead of creating a placeholder.
        var params = new MapSqlParameterSource()
            .addValue("name",     name)
            .addValue("email",    email)
            .addValue("role",     role)
            .addValue("auth0Id",  auth0Id, java.sql.Types.VARCHAR)
            .addValue("isActive", !Boolean.FALSE.equals(req.get("isActive")));

        try {
            List<Map<String, Object>> result = jdbc.queryForList("""
                INSERT INTO ops.staff (name, email, role, auth0_id, is_active)
                VALUES (:name, :email, :role, :auth0Id, :isActive)
                ON CONFLICT (email) DO UPDATE
                  SET auth0_id   = EXCLUDED.auth0_id,
                      name       = EXCLUDED.name,
                      role       = EXCLUDED.role,
                      is_active  = EXCLUDED.is_active,
                      updated_at = NOW()
                RETURNING id, name, email, role, auth0_id, is_active, created_at, updated_at
                """, params);
            return result.isEmpty() ? Map.of() : result.get(0);
        } catch (Exception e) {
            // ops.staff insert failed — roll back the Auth0 user so we don't leave orphans
            log.error("ops.staff insert failed after Auth0 user creation, rolling back: {}", e.getMessage());
            auth0.deleteUser(auth0Id);
            throw new ResponseStatusException(HttpStatus.INTERNAL_SERVER_ERROR,
                "Failed to save user record: " + e.getMessage());
        }
    }

    public Map<String, Object> update(String id, Map<String, Object> req) {
        var params = new MapSqlParameterSource()
            .addValue("id",       id)
            .addValue("name",     req.get("name"),     java.sql.Types.VARCHAR)
            .addValue("email",    req.get("email"),    java.sql.Types.VARCHAR)
            .addValue("role",     req.get("role"),     java.sql.Types.VARCHAR)
            .addValue("auth0Id",  req.get("auth0Id"),  java.sql.Types.VARCHAR)
            .addValue("isActive", req.get("isActive"), java.sql.Types.BOOLEAN);

        List<Map<String, Object>> result = jdbc.queryForList("""
            UPDATE ops.staff SET
              name      = COALESCE(:name,     name),
              email     = COALESCE(:email,    email),
              role      = COALESCE(:role,     role),
              auth0_id  = COALESCE(:auth0Id,  auth0_id),
              is_active = COALESCE(:isActive, is_active),
              updated_at = NOW()
            WHERE id = :id::uuid
            RETURNING id, name, email, role, auth0_id, is_active, created_at, updated_at
            """, params);

        if (result.isEmpty()) throw new ResponseStatusException(HttpStatus.NOT_FOUND, "User not found: " + id);
        return result.get(0);
    }

    public void delete(String id) {
        // Get auth0_id before deleting so we can remove from Auth0 too
        String auth0Id = null;
        try {
            Map<String, Object> row = jdbc.queryForMap(
                "SELECT auth0_id FROM ops.staff WHERE id = :id::uuid", Map.of("id", id));
            auth0Id = (String) row.get("auth0_id");
        } catch (EmptyResultDataAccessException e) {
            throw new ResponseStatusException(HttpStatus.NOT_FOUND, "User not found: " + id);
        }

        int rows = jdbc.update(
            "DELETE FROM ops.staff WHERE id = :id::uuid", Map.of("id", id));
        if (rows == 0) throw new ResponseStatusException(HttpStatus.NOT_FOUND, "User not found: " + id);

        // Delete from Auth0 after local delete — best effort (logged but not fatal)
        auth0.deleteUser(auth0Id);
    }

    public Map<String, Object> setActive(String id, boolean isActive) {
        List<Map<String, Object>> result = jdbc.queryForList("""
            UPDATE ops.staff SET is_active = :isActive, updated_at = NOW()
            WHERE id = :id::uuid
            RETURNING id, name, email, role, auth0_id, is_active, created_at, updated_at
            """, Map.of("id", id, "isActive", isActive));
        if (result.isEmpty()) throw new ResponseStatusException(HttpStatus.NOT_FOUND, "User not found: " + id);
        return result.get(0);
    }
}
