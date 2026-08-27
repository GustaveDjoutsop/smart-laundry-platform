package com.smartlaundromat.reporting.config;

import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.http.HttpHeaders;
import org.springframework.web.filter.OncePerRequestFilter;

import java.io.IOException;

/**
 * Marks every {@code /api/admin/**} response {@code no-store} (R10 item 2). This
 * service's whole controller package is operator/admin-facing — revenue, users,
 * absences, timekeeping, settings, transactions — so nothing it returns should be
 * retained by a browser disk cache or any intermediate proxy. This deliberately does not
 * exclude the endpoints that also carry an ETag; see {@link ConditionalCacheEtagFilter}
 * for why the two coexist without conflict there.
 */
public class NoStoreResponseFilter extends OncePerRequestFilter {

    @Override
    protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response,
                                     FilterChain filterChain) throws ServletException, IOException {
        response.setHeader(HttpHeaders.CACHE_CONTROL, "no-store");

        filterChain.doFilter(request, response);
    }
}
