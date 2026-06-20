package com.smartlaundromat.machine.model.enums;

/**
 * The remote-control transport a machine uses.
 *
 * <ul>
 *   <li>{@link #EQLINK}  — EQLink Open API v2 (IoT cloud, HTTP + MD5 signature).</li>
 *   <li>{@link #MODBUS}  — Modbus RTU over RS485 (function 0x10 write / 0x03 read),
 *       reached through a serial↔HTTP gateway bridge.</li>
 *   <li>{@link #MQTT}    — direct MQTT pulse to a local ESP32 relay (legacy / fallback).</li>
 * </ul>
 *
 * <p>The MQTT pulse is always also fired as a safety net regardless of the primary
 * protocol, so a machine still starts when the primary transport has a hiccup.
 */
public enum CommProtocol {
    EQLINK,
    MODBUS,
    MQTT
}
