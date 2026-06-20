package com.smartlaundromat.machine.controller;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.smartlaundromat.machine.dto.MachineStatusResponse;
import com.smartlaundromat.machine.dto.MachineSummaryResponse;
import com.smartlaundromat.machine.dto.StartCycleRequest;
import com.smartlaundromat.machine.exception.GlobalExceptionHandler;
import com.smartlaundromat.machine.exception.MachineNotAvailableException;
import com.smartlaundromat.machine.exception.MachineNotFoundException;
import com.smartlaundromat.machine.model.MachineCycle;
import com.smartlaundromat.machine.model.MachineEvent;
import com.smartlaundromat.machine.model.enums.CycleStatus;
import com.smartlaundromat.machine.model.enums.CycleType;
import com.smartlaundromat.machine.model.enums.MachineStatus;
import com.smartlaundromat.machine.model.enums.MachineType;
import com.smartlaundromat.machine.service.MachineService;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.WebMvcTest;
import org.springframework.context.annotation.Import;
import org.springframework.http.MediaType;
import org.springframework.security.test.context.support.WithMockUser;
import org.springframework.test.context.TestPropertySource;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;

import java.time.LocalDateTime;
import java.util.List;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.csrf;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

@WebMvcTest(MachineController.class)
@Import(GlobalExceptionHandler.class)
@TestPropertySource(properties = {
        "spring.security.oauth2.resourceserver.jwt.issuer-uri=https://example.auth0.com/",
        "auth0.audience=https://smartlaundry.api"
})
class MachineControllerTest {

    @Autowired
    MockMvc mockMvc;

    @Autowired
    ObjectMapper objectMapper;

    @MockitoBean
    MachineService machineService;

    @Test
    @WithMockUser(authorities = "SCOPE_sls-machine-read")
    void shouldGetAllMachines() throws Exception {
        // given
        MachineSummaryResponse summary = MachineSummaryResponse.builder()
                .total(2)
                .available(1)
                .inUse(1)
                .offline(0)
                .error(0)
                .maintenance(0)
                .machines(List.of())
                .build();
        when(machineService.getAllMachines()).thenReturn(summary);

        // when / then
        mockMvc.perform(get("/api/machines"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.total").value(2))
                .andExpect(jsonPath("$.available").value(1));
    }

    @Test
    @WithMockUser(authorities = "SCOPE_sls-machine-read")
    void shouldGetMachineStatus() throws Exception {
        // given
        MachineStatusResponse response = MachineStatusResponse.builder()
                .machineId("washer_01")
                .displayName("Washer 1")
                .type(MachineType.WASHER)
                .status(MachineStatus.IDLE)
                .online(true)
                .available(true)
                .build();
        when(machineService.getMachineStatus("washer_01")).thenReturn(response);

        // when / then
        mockMvc.perform(get("/api/machines/washer_01"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.machineId").value("washer_01"))
                .andExpect(jsonPath("$.status").value("IDLE"));
    }

    @Test
    @WithMockUser(authorities = "SCOPE_sls-machine-read")
    void shouldReturn404WhenMachineNotFound() throws Exception {
        // given
        when(machineService.getMachineStatus("washer_99"))
                .thenThrow(new MachineNotFoundException("Machine not found: washer_99"));

        // when / then
        mockMvc.perform(get("/api/machines/washer_99"))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.error").value("MACHINE_NOT_FOUND"));
    }

    @Test
    @WithMockUser(authorities = "SCOPE_sls-machine-read")
    void shouldGetMachineEvents() throws Exception {
        // given
        MachineEvent event = MachineEvent.builder()
                .machineId("washer_01")
                .eventType("STATUS_CHANGE")
                .build();
        when(machineService.getMachineEvents("washer_01")).thenReturn(List.of(event));

        // when / then
        mockMvc.perform(get("/api/machines/washer_01/events"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$[0].eventType").value("STATUS_CHANGE"));
    }

    @Test
    @WithMockUser(authorities = "SCOPE_sls-machine-read")
    void shouldGetMachineCycles() throws Exception {
        // given
        MachineCycle cycle = MachineCycle.builder()
                .machineId("washer_01")
                .cycleType(CycleType.NORMAL)
                .status(CycleStatus.COMPLETED)
                .durationMinutes(30)
                .build();
        when(machineService.getMachineCycles("washer_01")).thenReturn(List.of(cycle));

        // when / then
        mockMvc.perform(get("/api/machines/washer_01/cycles"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$[0].cycleType").value("NORMAL"));
    }

    @Test
    @WithMockUser(authorities = "SCOPE_sls-machine-start")
    void shouldStartCycle() throws Exception {
        // given
        MachineCycle cycle = MachineCycle.builder()
                .machineId("washer_01")
                .cycleType(CycleType.NORMAL)
                .status(CycleStatus.IN_PROGRESS)
                .durationMinutes(30)
                .startedAt(LocalDateTime.now())
                .build();
        when(machineService.startCycle(any(StartCycleRequest.class))).thenReturn(cycle);

        StartCycleRequest request = new StartCycleRequest();
        request.setMachineId("washer_01");
        request.setCycleType("NORMAL");
        request.setDurationMinutes(30);
        request.setPulseCount(2);

        // when / then
        mockMvc.perform(post("/api/machines/start-cycle")
                        .with(csrf())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(request)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("IN_PROGRESS"));
    }

    @Test
    @WithMockUser(authorities = "SCOPE_sls-machine-start")
    void shouldReturn409WhenMachineNotAvailable() throws Exception {
        // given
        when(machineService.startCycle(any()))
                .thenThrow(new MachineNotAvailableException("Machine not available"));

        StartCycleRequest request = new StartCycleRequest();
        request.setMachineId("washer_01");
        request.setCycleType("NORMAL");
        request.setDurationMinutes(30);
        request.setPulseCount(2);

        // when / then
        mockMvc.perform(post("/api/machines/start-cycle")
                        .with(csrf())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(request)))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.error").value("MACHINE_NOT_AVAILABLE"));
    }

    @Test
    @WithMockUser(authorities = "SCOPE_sls-machine-command")
    void shouldSendCommand() throws Exception {
        // when / then
        mockMvc.perform(post("/api/machines/washer_01/command/stop")
                        .with(csrf()))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("sent"))
                .andExpect(jsonPath("$.machineId").value("washer_01"))
                .andExpect(jsonPath("$.action").value("stop"));

        verify(machineService).sendCommand("washer_01", "stop");
    }

    @Test
    void shouldReturn401WhenNoAuth() throws Exception {
        // when / then
        mockMvc.perform(get("/api/machines"))
                .andExpect(status().isUnauthorized());
    }

    @Test
    @WithMockUser(authorities = "SCOPE_sls-machine-start")
    void shouldReturn400WhenValidationFails() throws Exception {
        // given - missing required fields
        StartCycleRequest request = new StartCycleRequest();

        // when / then
        mockMvc.perform(post("/api/machines/start-cycle")
                        .with(csrf())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(request)))
                .andExpect(status().isBadRequest());
    }
}
