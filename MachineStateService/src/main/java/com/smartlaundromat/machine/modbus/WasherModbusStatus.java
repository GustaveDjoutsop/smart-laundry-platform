package com.smartlaundromat.machine.modbus;

import lombok.Builder;
import lombok.Data;

/**
 * Decoded view of the 20-register washer status block ({@link WasherModbusRegisters#REG_STATUS_BASE}).
 */
@Data
@Builder
public class WasherModbusStatus {

    private int machineStatus;      // 0=PowerOn 1=Idle 3=Autorun
    private int doorStatus;         // 0=Idle 1=Open 2=Closed 3=Locked 4=Error
    private int errorStatus;        // bit0=Alarm bit1=Warning
    private int remainingHour;
    private int remainingMin;
    private int remainingSec;
    private int currentTemperature; // ℃
    private int currentRpm;         // rpm
    private int currentProgram;
    private int currentStep;
    private int coinsRequired;
    private int coinsCurrent;
    private int coinsTotal;

    public static WasherModbusStatus from(int[] registers) {
        if (registers == null || registers.length < WasherModbusRegisters.STATUS_REGISTER_COUNT) {
            return WasherModbusStatus.builder().build();
        }

        return WasherModbusStatus.builder()
                .machineStatus(registers[WasherModbusRegisters.IDX_MACHINE_STATUS])
                .doorStatus(registers[WasherModbusRegisters.IDX_DOOR_STATUS])
                .errorStatus(registers[WasherModbusRegisters.IDX_ERROR_STATUS])
                .remainingHour(registers[WasherModbusRegisters.IDX_REMAIN_HOUR])
                .remainingMin(registers[WasherModbusRegisters.IDX_REMAIN_MIN])
                .remainingSec(registers[WasherModbusRegisters.IDX_REMAIN_SEC])
                .currentTemperature(registers[WasherModbusRegisters.IDX_TEMP_REAL])
                .currentRpm(registers[WasherModbusRegisters.IDX_SPEED_REAL])
                .currentProgram(registers[WasherModbusRegisters.IDX_PROGRAM_CURRENT])
                .currentStep(registers[WasherModbusRegisters.IDX_STEP_CURRENT])
                .coinsRequired(registers[WasherModbusRegisters.IDX_COINS_REQUIRED])
                .coinsCurrent(registers[WasherModbusRegisters.IDX_COINS_CURRENT])
                .coinsTotal(registers[WasherModbusRegisters.IDX_COINS_TOTAL])
                .build();
    }

    public boolean isRunning()    { return machineStatus == WasherModbusRegisters.STATUS_AUTORUN; }
    public boolean isIdle()       { return machineStatus == WasherModbusRegisters.STATUS_IDLE
                                           || machineStatus == WasherModbusRegisters.STATUS_POWER_ON; }
    public boolean hasAlarm()     { return (errorStatus & 0x01) != 0; }
    public boolean hasWarning()   { return (errorStatus & 0x02) != 0; }
    public boolean isDoorLocked() { return doorStatus == WasherModbusRegisters.DOOR_LOCKED; }

    public int remainingMinutes() { return remainingHour * 60 + remainingMin; }
}
