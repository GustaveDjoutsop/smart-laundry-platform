package com.smartlaundromat.reporting.service;

import lombok.RequiredArgsConstructor;
import org.springframework.jdbc.core.namedparam.MapSqlParameterSource;
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate;
import org.springframework.stereotype.Service;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;

@Service
@RequiredArgsConstructor
public class FeedbackService {

    private final NamedParameterJdbcTemplate jdbc;

    public Map<String, Object> list(Integer rating, String machineId,
                                    String startDate, String endDate,
                                    boolean hasComment, int page, int size) {
        List<String> conds = new ArrayList<>();
        MapSqlParameterSource params = new MapSqlParameterSource();

        if (rating != null) {
            conds.add("f.rating = :rating");
            params.addValue("rating", rating, java.sql.Types.SMALLINT);
        }
        if (machineId != null) {
            conds.add("f.machine_id = :machineId");
            params.addValue("machineId", machineId, java.sql.Types.VARCHAR);
        }
        if (startDate != null) {
            conds.add("f.submitted_at >= :startDate::timestamptz");
            params.addValue("startDate", startDate, java.sql.Types.VARCHAR);
        }
        if (endDate != null) {
            conds.add("f.submitted_at <= :endDate::timestamptz");
            params.addValue("endDate", endDate, java.sql.Types.VARCHAR);
        }
        if (hasComment) {
            conds.add("f.comment IS NOT NULL AND f.comment <> ''");
        }

        String where = conds.isEmpty() ? "" : "WHERE " + String.join(" AND ", conds);

        Integer total = jdbc.queryForObject(
            "SELECT COUNT(*)::int FROM ops.feedback f " + where, params, Integer.class);

        params.addValue("limit", size).addValue("offset", (long) page * size);

        List<Map<String, Object>> data = jdbc.queryForList("""
            SELECT
              f.id, f.transaction_reference, f.machine_id,
              f.phone_number, f.rating, f.comment,
              f.submitted_at, f.staff_alert_sent, f.amount, f.cycle_duration
            FROM ops.feedback f
            """ + where + """
             ORDER BY f.submitted_at DESC
             LIMIT :limit OFFSET :offset
            """, params);

        // Overall stats not filtered — matches legacy getFeedback behavior
        Map<String, Object> stats = jdbc.queryForMap("""
            SELECT
              ROUND(AVG(rating), 1)                                                           AS average_rating,
              COUNT(*)::int                                                                    AS total_reviews,
              COUNT(*) FILTER (WHERE comment IS NOT NULL AND comment <> '')::int              AS with_comments
            FROM ops.feedback
            """, Map.of());

        List<Map<String, Object>> distribution = jdbc.queryForList("""
            SELECT rating, COUNT(*)::int AS count
            FROM ops.feedback
            GROUP BY rating
            ORDER BY rating DESC
            """, Map.of());

        // Fill gaps so every star 1-5 appears
        List<Map<String, Object>> dist = new ArrayList<>();
        for (int star = 5; star >= 1; star--) {
            final int s = star;
            long count = distribution.stream()
                .filter(r -> ((Number) r.get("rating")).intValue() == s)
                .mapToLong(r -> ((Number) r.get("count")).longValue())
                .findFirst().orElse(0L);
            dist.add(Map.of("rating", s, "count", count));
        }

        int safeTotal = total != null ? total : 0;
        return Map.of(
            "feedback",    data,
            "stats",       stats,
            "distribution", dist,
            "page",        page,
            "size",        size,
            "total",       safeTotal,
            "totalPages",  safeTotal == 0 ? 0 : (int) Math.ceil((double) safeTotal / size)
        );
    }

    public Map<String, Object> analytics(String startDate, String endDate) {
        MapSqlParameterSource params = new MapSqlParameterSource()
            .addValue("startDate", startDate, java.sql.Types.VARCHAR)
            .addValue("endDate",   endDate,   java.sql.Types.VARCHAR);

        String dateFilter = """
            WHERE (CAST(:startDate AS TEXT) IS NULL OR f.submitted_at >= :startDate::timestamptz)
              AND (CAST(:endDate   AS TEXT) IS NULL OR f.submitted_at <= :endDate::timestamptz)
            """;

        Map<String, Object> stats = jdbc.queryForMap("""
            SELECT
              ROUND(AVG(f.rating), 1)                                                         AS average_rating,
              COUNT(*)::int                                                                    AS total_reviews,
              COUNT(*) FILTER (WHERE f.comment IS NOT NULL AND f.comment <> '')::int          AS with_comments
            FROM ops.feedback f
            """ + dateFilter, params);

        List<Map<String, Object>> distribution = jdbc.queryForList("""
            SELECT f.rating, COUNT(*)::int AS count
            FROM ops.feedback f
            """ + dateFilter + """
            GROUP BY f.rating
            ORDER BY f.rating DESC
            """, params);

        List<Map<String, Object>> dist = new ArrayList<>();
        for (int star = 5; star >= 1; star--) {
            final int s = star;
            long count = distribution.stream()
                .filter(r -> ((Number) r.get("rating")).intValue() == s)
                .mapToLong(r -> ((Number) r.get("count")).longValue())
                .findFirst().orElse(0L);
            dist.add(Map.of("rating", s, "count", count));
        }

        // All-time rating by machine (not date-filtered — same as legacy)
        List<Map<String, Object>> byMachine = jdbc.queryForList("""
            SELECT
              f.machine_id,
              ROUND(AVG(f.rating), 1)  AS average_rating,
              COUNT(*)::int            AS total_reviews
            FROM ops.feedback f
            GROUP BY f.machine_id
            ORDER BY average_rating DESC
            """, Map.of());

        // Daily rating trend within period
        List<Map<String, Object>> trend = jdbc.queryForList("""
            SELECT
              f.submitted_at::date          AS period,
              ROUND(AVG(f.rating), 1)       AS average_rating,
              COUNT(*)::int                 AS count
            FROM ops.feedback f
            """ + dateFilter + """
            GROUP BY 1
            ORDER BY 1
            """, params);

        // Low-rating alerts (≤ 2 stars) within period
        List<Map<String, Object>> lowRatings = jdbc.queryForList("""
            SELECT
              f.id, f.transaction_reference, f.machine_id, f.phone_number,
              f.rating, f.comment, f.submitted_at
            FROM ops.feedback f
            """ + dateFilter + """
              AND f.rating <= 2
            ORDER BY f.submitted_at DESC
            LIMIT 20
            """, params);

        return Map.of(
            "stats",           stats,
            "distribution",    dist,
            "ratingByMachine", byMachine,
            "ratingTrend",     trend,
            "lowRatingAlerts", lowRatings
        );
    }
}
