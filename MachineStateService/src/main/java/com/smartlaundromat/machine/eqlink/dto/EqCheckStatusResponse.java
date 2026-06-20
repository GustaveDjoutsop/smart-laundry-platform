package com.smartlaundromat.machine.eqlink.dto;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import com.fasterxml.jackson.annotation.JsonProperty;
import lombok.Data;

/**
 * Response from {@code POST /api/open/v2/Device/iot_check_dev_status}.
 * Returns real-time module status including online state and operational metrics.
 */
@Data
@JsonIgnoreProperties(ignoreUnknown = true)
public class EqCheckStatusResponse {

    /** HTTP-style status code; 200 = success, 400 = bad request. */
    @JsonProperty("status")
    private Integer status;

    /**
     * Whether the module is reachable.
     * {@code "YES"} = online, {@code "NO"} = offline.
     */
    @JsonProperty("isonline")
    private String isonline;

    /** Bluetooth command data (for BT fallback scenarios). */
    @JsonProperty("bt_cmd")
    private String btCmd;

    /** Real-time machine metrics (price, coin counts, cycle state). */
    @JsonProperty("device_status")
    private EqDeviceInfo deviceStatus;

    /** Human-readable result message. */
    @JsonProperty("message")
    private String message;

    /** Server timestamp. */
    @JsonProperty("server_time")
    private String serverTime;

    public boolean isSuccess() {
        return Integer.valueOf(200).equals(status);
    }

    public boolean isOnline() {
        return "YES".equalsIgnoreCase(isonline);
    }
}
