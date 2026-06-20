package com.smartlaundromat.machine.modbus;

/**
 * Modbus RTU register map for the SX174003A washer controller.
 *
 * Bus: 9600/8/N/1, CRC16 (Modbus). Protocol addresses are PLC address − 1
 * (e.g. 4X1145 → 0x0478). Source: SX174003A communication protocol-20260113.xlsx.
 */
public final class WasherModbusRegisters {

    private WasherModbusRegisters() { }

    // ── Write registers (function 0x10) ─────────────────────────────────────────
    public static final int REG_RESET_ALARM    = 0x0478; // 4X1145 — reset alarm and silence
    public static final int REG_START          = 0x0479; // 4X1146 — start machine
    public static final int REG_NEXT_STEP      = 0x047A; // 4X1147 — advance to next step while running
    public static final int REG_FORCE_STOP     = 0x047B; // 4X1148 — forced stop
    public static final int REG_COIN_INPUT     = 0x047C; // 4X1149 — number of coins to credit
    public static final int REG_PROGRAM_SELECT = 0x047D; // 4X1150 — program number 1–3
    public static final int REG_SAVE_PARAMS    = 0x047E; // 4X1151 — save parameters
    public static final int REG_SAVE_PROGRAM   = 0x047F; // 4X1152 — save program data
    public static final int REG_READ_AUTO_PROG = 0x0480; // 4X1153 — request auto-program to read (1–3)

    // ── Read registers (function 0x03) ──────────────────────────────────────────
    public static final int REG_STATUS_BASE       = 0x048C; // 5X1165 — washer monitor block
    public static final int STATUS_REGISTER_COUNT = 20;

    public static final int REG_ALARM_BASE        = 0x04B4; // 5X1205 — alarms/warnings and I/O status
    public static final int ALARM_REGISTER_COUNT  = 7;

    // ── Status block offsets (0-based within REG_STATUS_BASE) ──────────────────
    public static final int IDX_MACHINE_STATUS   = 0;  // 0=PowerOn 1=Idle 3=Autorun
    public static final int IDX_DOOR_STATUS      = 1;  // 0=Idle 1=Open 2=Closed 3=Locked 4=Error
    public static final int IDX_ERROR_STATUS     = 2;  // bit0=Alarm bit1=Warning
    public static final int IDX_STEP_TIME_MIN    = 3;
    public static final int IDX_STEP_TIME_SEC    = 4;
    public static final int IDX_REMAIN_HOUR      = 5;
    public static final int IDX_REMAIN_MIN       = 6;
    public static final int IDX_REMAIN_SEC       = 7;
    public static final int IDX_WATER_LEVEL_REAL = 8;  // cm
    public static final int IDX_WATER_LEVEL_SET  = 9;  // cm
    public static final int IDX_TEMP_REAL        = 10; // ℃
    public static final int IDX_TEMP_SET         = 11; // ℃
    public static final int IDX_SPEED_REAL       = 12; // rpm
    public static final int IDX_SPEED_SET        = 13; // rpm
    public static final int IDX_PROGRAM_CURRENT  = 14;
    public static final int IDX_STEP_CURRENT     = 15;
    public static final int IDX_COINS_REQUIRED   = 16;
    public static final int IDX_COINS_CURRENT    = 17;
    public static final int IDX_COINS_TOTAL      = 18;
    public static final int IDX_COINS_BOX        = 19;

    // ── Machine-status values (IDX_MACHINE_STATUS) ──────────────────────────────
    public static final int STATUS_POWER_ON = 0;
    public static final int STATUS_IDLE     = 1;
    public static final int STATUS_AUTORUN  = 3;

    // ── Door-status values (IDX_DOOR_STATUS) ────────────────────────────────────
    public static final int DOOR_IDLE   = 0;
    public static final int DOOR_OPENED = 1;
    public static final int DOOR_CLOSED = 2;
    public static final int DOOR_LOCKED = 3;
    public static final int DOOR_ERROR  = 4;
}
