package com.smartlaundromat.machine.eqlink.dto;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import com.fasterxml.jackson.annotation.JsonProperty;
import lombok.Data;

/**
 * Connectivity state for a single EQLink device,
 * as returned inside each entry of {@code get_device_list → list[].device_status}.
 */
@Data
@JsonIgnoreProperties(ignoreUnknown = true)
public class EqDeviceStatus {

    /**
     * Online state reported by the EQLink cloud.
     * Value is {@code "YES"} when the module is online, {@code "NO"} or {@code "OFFLINE"} when not.
     */
    @JsonProperty("Status")
    private String status;

    /** Unix epoch timestamp of the last heartbeat received from the module. */
    @JsonProperty("Timestamp")
    private Long timestamp;

    public boolean isOnline() {
        return "YES".equalsIgnoreCase(status);
    }
}
