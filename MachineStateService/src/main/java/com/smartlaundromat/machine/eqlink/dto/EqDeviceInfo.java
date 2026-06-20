package com.smartlaundromat.machine.eqlink.dto;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import com.fasterxml.jackson.annotation.JsonProperty;
import lombok.Data;

/**
 * Operational telemetry for a single EQLink device,
 * as returned inside {@code get_device_list → list[].device_info}
 * and {@code iot_check_dev_status → device_status}.
 */
@Data
@JsonIgnoreProperties(ignoreUnknown = true)
public class EqDeviceInfo {

    /** 1 if a cycle is currently in progress; 0 otherwise. */
    @JsonProperty("cycle_start")
    private Integer cycleStart;

    /** Machine error code; 0 means no error. */
    @JsonProperty("mach_errno")
    private Integer machErrno;

    /**
     * Coins in the current cash box.
     * Coin statistics: number of coins collected since the last cash-box reset.
     */
    @JsonProperty("coin_box_cnt")
    private Integer coinBoxCnt;

    /** WiFi SSID the module is connected to (in check-status response). */
    @JsonProperty("wifi_ssid")
    private String wifiSsid;

    /** Machine model identifier from the EQLink module. {@code "null"} when not set. */
    @JsonProperty("mach_model")
    private String machModel;

    /** User ID of the customer who last triggered a cycle. {@code "null"} when not set. */
    @JsonProperty("user_id")
    private String userId;

    /**
     * 1 when the machine is available for a new cycle, 0 when busy or blocked.
     * Note: a machine can be available=1 but cycle_start=0 (idle and ready).
     */
    @JsonProperty("available")
    private Integer available;

    /**
     * Single-pulse price configured on the machine.
     * {@code total_amt = pulse_count × vend_price}.
     */
    @JsonProperty("vend_price")
    private Integer vendPrice;

    /** Duration of the current or last cycle (seconds or minutes — confirm with EQLink). */
    @JsonProperty("cycle_time")
    private Integer cycleTime;

    /** Start type flag. */
    @JsonProperty("start_type")
    private Integer startType;

    /**
     * Total lifetime coin count since the module was first installed on this machine.
     */
    @JsonProperty("coin_lifetime_cnt")
    private Integer coinLifetimeCnt;

    /** General machine status flag. */
    @JsonProperty("status")
    private Integer status;

    /** Remaining time in the current cycle (unit: seconds). 0 when idle. */
    @JsonProperty("remain_time")
    private Integer remainTime;

    /** Device / machine type identifier (e.g. 1 = washer, 2 = dryer — confirm with EQLink). */
    @JsonProperty("device_type")
    private Integer deviceType;

    public boolean isAvailable() {
        return Integer.valueOf(1).equals(available);
    }

    public boolean isCycleRunning() {
        return Integer.valueOf(1).equals(cycleStart);
    }

    public boolean hasError() {
        return machErrno != null && machErrno != 0;
    }
}
