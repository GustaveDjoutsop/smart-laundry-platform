package com.smartlaundromat.machine.eqlink;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.Map;
import java.util.TreeMap;

/**
 * Utility for computing the EQLink API MD5 request signature.
 *
 * <h2>Algorithm (from EQLink docs)</h2>
 * <ol>
 *   <li>Sort array parameters in dictionary order — {@code ksort($params)}</li>
 *   <li>Concatenate as URL params — {@code 'a=aa&b=bb&c=cc'}</li>
 *   <li>Append secret key — {@code $string . "&secret_key=" . $KEY}</li>
 *   <li>MD5 encryption — {@code md5($string)}</li>
 *   <li>Convert to uppercase — {@code strtoupper($string)}</li>
 * </ol>
 *
 * <h2>Example</h2>
 * <pre>
 *   params = { app_id:"eql71…", devicename:"NYJ3…", vendor_id:"100068" }
 *   sorted = app_id, devicename, vendor_id
 *   string = "app_id=eql71…&devicename=NYJ3…&vendor_id=100068&secret_key=MY_KEY"
 *   sign   = MD5(string).toUpperCase()
 * </pre>
 */
public final class EqLinkSignatureUtil {

    private EqLinkSignatureUtil() {}

    /**
     * Computes the EQLink MD5 signature for the given request parameters.
     *
     * @param params    all request parameters, excluding {@code sign} itself
     * @param secretKey the account secret key
     * @return uppercase MD5 hex string to use as the {@code sign} field
     */
    public static String compute(Map<String, Object> params, String secretKey) {
        // 1. Sort by key alphabetically (dictionary order)
        TreeMap<String, Object> sorted = new TreeMap<>(params);
        sorted.remove("sign"); // never include sign in its own computation

        // 2. Build query string: key1=val1&key2=val2…
        StringBuilder sb = new StringBuilder();
        for (Map.Entry<String, Object> entry : sorted.entrySet()) {
            if (sb.length() > 0) sb.append('&');
            sb.append(entry.getKey()).append('=').append(entry.getValue());
        }

        // 3. Append &secret_key=KEY
        sb.append("&secret_key=").append(secretKey);

        // 4 & 5. MD5 → uppercase
        return md5Upper(sb.toString());
    }

    // ── private ───────────────────────────────────────────────────────────────

    private static String md5Upper(String input) {
        try {
            MessageDigest md = MessageDigest.getInstance("MD5");
            byte[] digest = md.digest(input.getBytes(StandardCharsets.UTF_8));
            StringBuilder hex = new StringBuilder(32);
            for (byte b : digest) {
                hex.append(String.format("%02x", b));
            }
            return hex.toString().toUpperCase();
        } catch (Exception e) {
            throw new IllegalStateException("MD5 not available", e);
        }
    }
}
