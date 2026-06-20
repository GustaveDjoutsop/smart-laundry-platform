package com.smartlaundromat.machine.eqlink;

import com.smartlaundromat.machine.eqlink.dto.*;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.*;
import org.springframework.stereotype.Service;
import org.springframework.util.StringUtils;
import org.springframework.web.client.RestTemplate;

import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * HTTP client for the EQLink Open API v2.
 *
 * <h2>Base URL</h2>
 * {@code {eqlink.base-url}/api/open/v2/Device/}
 *
 * <h2>Authentication</h2>
 * Every request body includes {@code vendor_id}, {@code app_id}, and {@code sign}.
 * The {@code sign} is an MD5 signature computed by {@link EqLinkSignatureUtil}.
 * There is <strong>no Bearer token</strong>.
 *
 * <h2>Endpoints</h2>
 * <table>
 *   <tr><th>Method</th><th>Path</th><th>Purpose</th></tr>
 *   <tr><td>POST</td><td>.../get_device_list</td><td>List all devices</td></tr>
 *   <tr><td>POST</td><td>.../iot_check_dev_status</td><td>Check device status online/offline</td></tr>
 *   <tr><td>POST</td><td>.../iot_start_device</td><td>Start machine via IoT cloud</td></tr>
 *   <tr><td>POST</td><td>.../bt_start_device</td><td>Generate BT start command (fallback)</td></tr>
 * </table>
 *
 * <p>All methods return safe defaults (empty / null) when EQLink is disabled or not configured.
 */
@Service
@Slf4j
@RequiredArgsConstructor
public class EqLinkClient {

    private static final String PATH_PREFIX = "/api/open/v2/Device/";

    private final EqLinkProperties props;
    private final RestTemplate restTemplate;

    // ── Device listing ────────────────────────────────────────────────────────

    /**
     * Retrieves all devices under the EQLink account, filtered by WiFi SSID if configured.
     * Endpoint: {@code POST /api/open/v2/Device/get_device_list}
     *
     * @return list of device items; empty when disabled or on error
     */
    public List<EqDeviceItem> getDeviceList() {
        if (!props.isFullyConfigured()) return Collections.emptyList();
        try {
            Map<String, Object> body = baseParams();
            if (StringUtils.hasText(props.getWifiSsid())) {
                body.put("wifi_ssid", props.getWifiSsid());
            }
            sign(body);

            EqDeviceListResponse resp = post("get_device_list", body, EqDeviceListResponse.class);
            if (resp != null && resp.isSuccess() && resp.getList() != null) {
                log.debug("EQLink getDeviceList: {} device(s)", resp.getList().size());
                return resp.getList();
            }
            if (resp != null) {
                log.warn("EQLink getDeviceList: status={} msg={}", resp.getStatus(), resp.getMessage());
            }
            return Collections.emptyList();
        } catch (Exception e) {
            log.error("EQLink getDeviceList error: {}", e.getMessage());
            return Collections.emptyList();
        }
    }

    // ── Device status ─────────────────────────────────────────────────────────

    /**
     * Checks real-time online/offline status and machine metrics for one device.
     * Endpoint: {@code POST /api/open/v2/Device/iot_check_dev_status}
     *
     * @param devicename EQLink module serial (e.g. {@code NYJ312007A100130896})
     * @return status response; {@code null} on error
     */
    public EqCheckStatusResponse checkDeviceStatus(String devicename) {
        if (!props.isFullyConfigured()) return null;
        try {
            Map<String, Object> body = baseParams();
            body.put("devicename", devicename);
            sign(body);

            EqCheckStatusResponse resp = post("iot_check_dev_status", body, EqCheckStatusResponse.class);
            if (resp != null && !resp.isSuccess()) {
                log.warn("EQLink checkDeviceStatus {}: status={} msg={}",
                        devicename, resp.getStatus(), resp.getMessage());
            }
            return resp;
        } catch (Exception e) {
            log.error("EQLink checkDeviceStatus {} error: {}", devicename, e.getMessage());
            return null;
        }
    }

    // ── Machine start via IoT ─────────────────────────────────────────────────

    /**
     * Starts a machine via the EQLink IoT cloud relay.
     * Endpoint: {@code POST /api/open/v2/Device/iot_start_device}
     *
     * <h3>total_amt calculation</h3>
     * {@code total_amt = pulseCount × vendPrice}.
     * The machine's {@code vend_price} comes from a prior {@link #checkDeviceStatus} call
     * or falls back to {@code eqlink.default-vend-price} when {@code vendPrice <= 0}.
     *
     * <h3>Timeout fallback</h3>
     * EQLink returns HTTP 406 when the IoT cloud can't reach the module within its timeout.
     * In that case {@link EqStartDeviceResponse#isIotTimeout()} is {@code true} and the
     * caller should fall back to MQTT (since BT requires physical proximity and cannot
     * be initiated remotely by the backend).
     *
     * @param devicename EQLink module serial
     * @param pulseCount number of start pulses to send
     * @param vendPrice  per-pulse price from the machine; {@code <= 0} uses configured default
     * @return start response; {@code null} on connection error
     */
    public EqStartDeviceResponse startDeviceIot(String devicename, int pulseCount, int vendPrice) {
        if (!props.isFullyConfigured()) {
            log.debug("EQLink disabled — skipping IoT start for {}", devicename);
            return null;
        }
        try {
            int effective = (vendPrice > 0) ? vendPrice : props.getDefaultVendPrice();
            int totalAmt  = pulseCount * effective;

            Map<String, Object> body = baseParams();
            body.put("devicename", devicename);
            body.put("total_amt", totalAmt);
            sign(body);

            EqStartDeviceResponse resp = post("iot_start_device", body, EqStartDeviceResponse.class);
            if (resp == null) return null;

            if (resp.isSuccess()) {
                log.info("EQLink IoT start OK — device={} pulses={} totalAmt={} vendPrice={}",
                        devicename, pulseCount, totalAmt, effective);
            } else if (resp.isIotTimeout()) {
                log.warn("EQLink IoT start timed out (406) for {} — MQTT will handle it", devicename);
            } else {
                log.error("EQLink IoT start failed — device={} status={} msg={}",
                        devicename, resp.getStatus(), resp.getMessage());
            }
            return resp;
        } catch (Exception e) {
            log.error("EQLink startDeviceIot {} error: {}", devicename, e.getMessage());
            return null;
        }
    }

    /**
     * Generates a Bluetooth start command for a machine.
     * Endpoint: {@code POST /api/open/v2/Device/bt_start_device}
     *
     * <p>The returned {@code bt_cmd} is an encrypted hex payload. It must be sent to the
     * physical EQLink module via Bluetooth (e.g., via the EQLink app on a nearby phone).
     * The backend cannot execute it remotely.
     *
     * @param devicename EQLink module serial
     * @param pulseCount number of start pulses
     * @param vendPrice  per-pulse price; {@code <= 0} uses configured default
     * @return BT command response; {@code null} on error
     */
    public EqStartDeviceResponse startDeviceBt(String devicename, int pulseCount, int vendPrice) {
        if (!props.isFullyConfigured()) return null;
        try {
            int effective = (vendPrice > 0) ? vendPrice : props.getDefaultVendPrice();
            int totalAmt  = pulseCount * effective;

            Map<String, Object> body = baseParams();
            body.put("devicename", devicename);
            body.put("total_amt", totalAmt);
            sign(body);

            EqStartDeviceResponse resp = post("bt_start_device", body, EqStartDeviceResponse.class);
            if (resp != null && resp.isSuccess()) {
                log.info("EQLink BT cmd generated — device={} totalAmt={}", devicename, totalAmt);
            }
            return resp;
        } catch (Exception e) {
            log.error("EQLink startDeviceBt {} error: {}", devicename, e.getMessage());
            return null;
        }
    }

    // ── Private helpers ───────────────────────────────────────────────────────

    private Map<String, Object> baseParams() {
        Map<String, Object> p = new LinkedHashMap<>();
        p.put("vendor_id", props.getVendorId());
        p.put("app_id",    props.getAppId());
        return p;
    }

    private void sign(Map<String, Object> params) {
        params.put("sign", EqLinkSignatureUtil.compute(params, props.getSecretKey()));
    }

    private <T> T post(String endpoint, Object body, Class<T> type) {
        String url = props.getBaseUrl() + PATH_PREFIX + endpoint;
        HttpHeaders h = new HttpHeaders();
        h.setContentType(MediaType.APPLICATION_JSON);
        ResponseEntity<T> resp = restTemplate.exchange(
                url, HttpMethod.POST, new HttpEntity<>(body, h), type);
        return resp.getBody();
    }
}
