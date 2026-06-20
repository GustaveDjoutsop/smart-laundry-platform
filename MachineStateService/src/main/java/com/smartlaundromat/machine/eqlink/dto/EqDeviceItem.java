package com.smartlaundromat.machine.eqlink.dto;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import com.fasterxml.jackson.annotation.JsonProperty;
import lombok.Data;

/**
 * A single device entry in the {@code get_device_list} response array.
 */
@Data
@JsonIgnoreProperties(ignoreUnknown = true)
public class EqDeviceItem {

    /** WiFi SSID the module is connected to (group / location identifier). */
    @JsonProperty("wifi_ssid")
    private String wifiSsid;

    /**
     * EQLink device name — the module's unique serial number.
     * Example: {@code "NYJ312007A100130896"}.
     * This is the primary identifier used in all other API calls.
     */
    @JsonProperty("devicename")
    private String devicename;

    /** Connectivity state (online/offline + last-heartbeat timestamp). */
    @JsonProperty("device_status")
    private EqDeviceStatus deviceStatus;

    /** Operational telemetry: pricing, coin counts, cycle state. */
    @JsonProperty("device_info")
    private EqDeviceInfo deviceInfo;
}
