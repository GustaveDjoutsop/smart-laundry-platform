package com.smartlaundromat.machine.eqlink.dto;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import com.fasterxml.jackson.annotation.JsonProperty;
import lombok.Data;

import java.util.List;

/**
 * Top-level response from {@code POST /api/open/v2/Device/get_device_list}.
 */
@Data
@JsonIgnoreProperties(ignoreUnknown = true)
public class EqDeviceListResponse {

    /** HTTP-style status code; 200 = success. */
    @JsonProperty("status")
    private Integer status;

    /** Human-readable result message, e.g. {@code "Get successful"}. */
    @JsonProperty("message")
    private String message;

    /** List of devices matching the requested {@code wifi_ssid}. */
    @JsonProperty("list")
    private List<EqDeviceItem> list;

    /** Server timestamp, e.g. {@code "2024-08-07 15:04:12"}. */
    @JsonProperty("server_time")
    private String serverTime;

    public boolean isSuccess() {
        return Integer.valueOf(200).equals(status);
    }
}
