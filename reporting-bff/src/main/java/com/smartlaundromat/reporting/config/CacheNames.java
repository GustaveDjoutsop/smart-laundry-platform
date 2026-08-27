package com.smartlaundromat.reporting.config;

/**
 * Cache names used across the service (R9). Kept as constants — referenced both from
 * {@code @Cacheable} annotations (which require compile-time constants) and from
 * {@link CacheConfig}'s per-cache TTL configuration, so the two can never drift apart.
 */
public final class CacheNames {

    public static final String DASHBOARD_SUMMARY = "dashboard-summary";
    public static final String REVENUE_DAILY = "revenue-daily";
    public static final String REVENUE_TODAY = "revenue-today";
    public static final String MACHINE_REPORT = "machine-report";

    private CacheNames() {
    }
}
