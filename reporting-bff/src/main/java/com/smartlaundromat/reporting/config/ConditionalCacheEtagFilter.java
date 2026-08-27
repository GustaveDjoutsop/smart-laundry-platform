package com.smartlaundromat.reporting.config;

import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.http.HttpMethod;
import org.springframework.web.filter.ShallowEtagHeaderFilter;

import java.io.InputStream;

/**
 * Spring's {@link ShallowEtagHeaderFilter} skips ETag generation whenever the response
 * already carries {@code Cache-Control: no-store} (its {@code isEligibleForEtag} bails
 * out on that directive). That default is right for a generic app, but wrong for this
 * one: reporting-bff's dashboard/revenue/machine-report endpoints deliberately carry
 * both — {@code no-store} (see {@link NoStoreResponseFilter}) so no shared or
 * intermediate cache ever retains this tenant's admin data, and an ETag so the *same
 * authenticated caller*'s own repeat polls can still be answered with 304 instead of the
 * full payload (R10). RFC 7234 §5.2.2.3 only forbids storing the response for later
 * reuse — it says nothing against the origin recomputing a fresh validator per request,
 * so the two are not actually in tension; only Spring's stock filter's conservative
 * default assumes otherwise. This subclass restores plain GET+2xx eligibility without
 * the no-store carve-out — every other check of the parent's {@code isEligibleForEtag}
 * (not committed yet, 2xx, GET) is kept as-is; only the {@code no-store} condition is
 * dropped.
 */
public class ConditionalCacheEtagFilter extends ShallowEtagHeaderFilter {

    @Override
    protected boolean isEligibleForEtag(HttpServletRequest request, HttpServletResponse response,
                                         int responseStatusCode, InputStream inputStream) {
        return !response.isCommitted()
                && responseStatusCode >= 200 && responseStatusCode < 300
                && HttpMethod.GET.matches(request.getMethod());
    }
}
