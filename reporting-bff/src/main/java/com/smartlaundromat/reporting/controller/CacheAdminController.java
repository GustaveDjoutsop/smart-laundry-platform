package com.smartlaundromat.reporting.controller;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;

import org.springframework.cache.Cache;
import org.springframework.cache.CacheManager;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import lombok.RequiredArgsConstructor;

/**
 * Manual cache eviction (R9).
 *
 * <p>The roadmap's "evict on write: a new transaction invalidates revenue-today and
 * dashboard-summary" doesn't apply literally here — this service never writes
 * {@code payment.transactions} or {@code machine.machines} itself; PaymentManagementService
 * and MachineStateService do, in a different process. Wiring a real event-driven evict
 * would mean those services publishing a signal this one subscribes to (Redis pub/sub,
 * Postgres LISTEN/NOTIFY) — real infrastructure, not something this BFF can do to itself,
 * and outside R9's stated scope.
 *
 * <p>The 60 s TTL on {@code dashboard-summary}/{@code revenue-today} already bounds
 * staleness tightly enough for normal operation. This endpoint is the escape hatch for
 * the abnormal case — a manual data fix, a reconciliation run, a migration backfill —
 * where staff need the dashboard to reflect a correction immediately rather than wait
 * out the TTL.
 */
@RestController
@RequestMapping("/api/admin/cache")
@RequiredArgsConstructor
public class CacheAdminController {

    private final CacheManager cacheManager;

    /**
     * Clears one cache ({@code ?name=revenue-today}) or, with no {@code name}, every
     * cache this service manages.
     */
    @PostMapping("/evict")
    public Map<String, Object> evict(@RequestParam(required = false) String name) {
        List<String> targets = name != null ? List.of(name) : new ArrayList<>(cacheManager.getCacheNames());

        List<String> evicted = new ArrayList<>();
        List<String> unknown = new ArrayList<>();
        for (String target : targets) {
            Cache cache = cacheManager.getCache(target);

            if (cache == null) {
                unknown.add(target);
                continue;
            }

            cache.clear();
            evicted.add(target);
        }

        return Map.of("evicted", evicted, "unknown", unknown);
    }
}
