package com.smartlaundromat.machine.dto;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.util.List;

@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class MachineSummaryResponse {

    private List<MachineStatusResponse> machines;
    private int total;
    private int available;
    private int inUse;
    private int offline;
    private int error;
    private int maintenance;
}
