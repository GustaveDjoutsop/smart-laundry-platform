package com.smartlaundromat.machine.eqlink;

import lombok.Data;
import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.stereotype.Component;
import org.springframework.util.StringUtils;

import java.util.HashMap;
import java.util.Map;
import java.util.Optional;

/**
 * Configuration properties for the EQLink Open API v2 integration.
 *
 * <h2>What EQLink is</h2>
 * EQLink is a SaaS platform that attaches an IoT module to coin-operated laundry machines.
 * It provides a REST API (v2) for remote machine control and status monitoring.
 * <strong>EQLink is not a payment system</strong> — payments are handled separately
 * by CamPay, MTN MoMo, or Orange Money.
 *
 * <h2>Authentication</h2>
 * All requests use an MD5 signature (NOT a Bearer token):
 * <ol>
 *   <li>Collect all request parameters (excluding {@code sign})</li>
 *   <li>Sort them alphabetically by key</li>
 *   <li>Concatenate as {@code key1=val1&key2=val2…}</li>
 *   <li>Append {@code &secret_key=YOUR_SECRET_KEY}</li>
 *   <li>Compute MD5 of the resulting string</li>
 *   <li>Convert to uppercase → this is the {@code sign} value</li>
 * </ol>
 *
 * <h2>Device mapping</h2>
 * EQLink identifies machines by their {@code devicename}
 * (a serial number printed on the module, e.g. {@code NYJ312007A100130896}).
 * Map your internal machine IDs to these {@code devicename} values via
 * {@code eqlink.device-name-mapping}.
 *
 * <h2>pulse / total_amt</h2>
 * To start a machine: {@code total_amt = pulse_count × vend_price}.
 * {@code vend_price} is the per-pulse price configured on the machine
 * (obtained from {@code iot_check_dev_status} → {@code device_status.vend_price}).
 * You can cache this per machine or configure a default via {@code default-vend-price}.
 *
 * <h2>Example {@code ci/dev.yaml}</h2>
 * <pre>{@code
 * eqlink:
 *   enabled: true
 *   base-url: https://tokyo.anlun.vip
 *   vendor-id: "100068"
 *   app-id: "eql7129047088153393"
 *   secret-key: "YOUR_SECRET_KEY"
 *   wifi-ssid: "EQLink"
 *   poll-interval-ms: 30000
 *   default-vend-price: 10
 *   device-name-mapping:
 *     washer_01: "NYJ312007A100130896"
 *     washer_02: "NYJ312007A100130849"
 * }</pre>
 */
@Data
@Component
@ConfigurationProperties(prefix = "eqlink")
public class EqLinkProperties {

    // ── Master switch ─────────────────────────────────────────────────────────

    /** Set {@code true} to activate EQLink integration. Default: {@code false}. */
    private boolean enabled = false;

    // ── API connection ────────────────────────────────────────────────────────

    /** EQLink server base URL — confirm with EQLink support. */
    private String baseUrl = "https://tokyo.anlun.vip";

    // ── Authentication (all three required for API calls) ─────────────────────

    /**
     * Your EQLink vendor ID.
     * Contact EQLink support (+86 186 5325 0609 / admin@eqlink.top) to obtain.
     */
    private String vendorId;

    /**
     * Your EQLink app ID.
     * Contact EQLink support to obtain.
     */
    private String appId;

    /**
     * Your EQLink secret key — used to compute the MD5 {@code sign} for every request.
     * Keep this private; never commit to source control in plain text.
     * Store as env var {@code EQLINK_SECRET_KEY}.
     */
    private String secretKey;

    // ── Device filtering ──────────────────────────────────────────────────────

    /**
     * The WiFi SSID that your EQLink modules are connected to.
     * Used as a filter parameter in {@code get_device_list}.
     * Leave blank to retrieve all devices under your account.
     */
    private String wifiSsid;

    // ── Polling ───────────────────────────────────────────────────────────────

    /**
     * How often (ms) to poll EQLink for machine states.
     * Only active when {@code enabled=true}. Default: 30 000 ms.
     */
    private long pollIntervalMs = 30_000;

    // ── Machine pricing ───────────────────────────────────────────────────────

    /**
     * Default {@code vend_price} to use when the machine's price is not known from
     * a prior status check. This must match the value configured on the EQLink module.
     * {@code total_amt = pulse_count × vend_price}.
     */
    private int defaultVendPrice = 10;

    // ── Device name mapping ───────────────────────────────────────────────────

    /**
     * Maps internal machine IDs (e.g. {@code washer_01}) to EQLink {@code devicename}
     * values (e.g. {@code NYJ312007A100130896}).
     * Only machines present in this map can be controlled via EQLink; others fall back to MQTT.
     */
    private Map<String, String> deviceNameMapping = new HashMap<>();

    // ── Helpers ───────────────────────────────────────────────────────────────

    /**
     * Returns the EQLink {@code devicename} for a given internal machine ID.
     *
     * @param machineId internal ID (e.g. {@code washer_01})
     * @return EQLink devicename, or empty if not mapped
     */
    public Optional<String> resolveDeviceName(String machineId) {
        return Optional.ofNullable(deviceNameMapping.get(machineId))
                .filter(StringUtils::hasText);
    }

    /**
     * Returns {@code true} if the integration is enabled and the minimum required
     * credentials ({@code vendor-id}, {@code app-id}, {@code secret-key}) are present.
     */
    public boolean isFullyConfigured() {
        return enabled
                && StringUtils.hasText(vendorId)
                && StringUtils.hasText(appId)
                && StringUtils.hasText(secretKey);
    }
}
