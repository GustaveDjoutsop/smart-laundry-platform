package com.smartlaundromat.machine.eqlink.dto;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import com.fasterxml.jackson.annotation.JsonProperty;
import lombok.Data;

/**
 * Response from:
 * <ul>
 *   <li>{@code POST /api/open/v2/Device/iot_start_device} — IoT cloud trigger</li>
 *   <li>{@code POST /api/open/v2/Device/bt_start_device} — BT command generator</li>
 * </ul>
 *
 * <p>IoT success: {@code status=200, message="Start device call successful!"}
 * <p>IoT timeout (fallback to BT): {@code status=406, message="Request timeout, pls try bt!"}
 * <p>BT success: {@code status=200, bt_cmd="...hex..."} — the caller must relay this to the device via BT
 */
@Data
@JsonIgnoreProperties(ignoreUnknown = true)
public class EqStartDeviceResponse {

    /** 200 = success, 406 = IoT timeout (try BT), 400 = bad request. */
    @JsonProperty("status")
    private Integer status;

    /** Human-readable result. */
    @JsonProperty("message")
    private String message;

    /**
     * Encoded BT command payload returned by {@code bt_start_device}.
     * Only present in BT responses. Must be relayed to the physical device via Bluetooth.
     */
    @JsonProperty("bt_cmd")
    private String btCmd;

    /** Server timestamp. */
    @JsonProperty("server_time")
    private String serverTime;

    public boolean isSuccess() {
        return Integer.valueOf(200).equals(status);
    }

    /** Returns true when EQLink's IoT path timed out and BT fallback is recommended. */
    public boolean isIotTimeout() {
        return Integer.valueOf(406).equals(status);
    }
}
