package com.smartlaundromat.machine.controller;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.smartlaundromat.machine.dto.*;
import com.smartlaundromat.machine.exception.GlobalExceptionHandler;
import com.smartlaundromat.machine.exception.ReservationException;
import com.smartlaundromat.machine.model.Reservation;
import com.smartlaundromat.machine.model.enums.ReservationStatus;
import com.smartlaundromat.machine.service.ReservationService;
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
import static org.mockito.Mockito.when;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.csrf;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

@WebMvcTest(ReservationController.class)
@Import(GlobalExceptionHandler.class)
@TestPropertySource(properties = {
        "spring.security.oauth2.resourceserver.jwt.issuer-uri=https://example.auth0.com/",
        "auth0.audience=https://smartlaundry.api"
})
class ReservationControllerTest {

    @Autowired
    MockMvc mockMvc;

    @Autowired
    ObjectMapper objectMapper;

    @MockitoBean
    ReservationService reservationService;

    @Test
    @WithMockUser(authorities = "SCOPE_sls-reservation-write")
    void shouldCreateReservation() throws Exception {
        // given
        ReservationResponse response = ReservationResponse.builder()
                .reservationCode("RES-ABC123")
                .machineId("washer_01")
                .machineName("Washer 1")
                .status(ReservationStatus.PENDING_PAYMENT)
                .slotStart(LocalDateTime.now().plusHours(1))
                .slotEnd(LocalDateTime.now().plusHours(2))
                .feeAmount(1500)
                .currency("XAF")
                .message("Reservation created")
                .build();
        when(reservationService.createReservation(any(CreateReservationRequest.class)))
                .thenReturn(response);

        CreateReservationRequest request = new CreateReservationRequest();
        request.setMachineId("washer_01");
        request.setSlotStart(LocalDateTime.now().plusHours(1));

        // when / then
        mockMvc.perform(post("/api/reservations")
                        .with(csrf())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(request)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.reservationCode").value("RES-ABC123"))
                .andExpect(jsonPath("$.status").value("PENDING_PAYMENT"));
    }

    @Test
    @WithMockUser(authorities = "SCOPE_sls-reservation-write")
    void shouldReturn409WhenReservationConflict() throws Exception {
        // given
        when(reservationService.createReservation(any()))
                .thenThrow(new ReservationException("Machine washer_01 is already reserved"));

        CreateReservationRequest request = new CreateReservationRequest();
        request.setMachineId("washer_01");
        request.setSlotStart(LocalDateTime.now().plusHours(1));

        // when / then
        mockMvc.perform(post("/api/reservations")
                        .with(csrf())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(request)))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.error").value("RESERVATION_ERROR"));
    }

    @Test
    @WithMockUser(authorities = "SCOPE_sls-reservation-write")
    void shouldActivateReservation() throws Exception {
        // given
        ReservationResponse response = ReservationResponse.builder()
                .reservationCode("RES-ABC123")
                .machineId("washer_01")
                .status(ReservationStatus.ACTIVE)
                .feeAmount(1500)
                .currency("XAF")
                .message("Reservation is now active")
                .build();
        when(reservationService.activateByReference("REF-123")).thenReturn(response);

        ActivateReservationRequest request = new ActivateReservationRequest();
        request.setTransactionReference("REF-123");

        // when / then
        mockMvc.perform(post("/api/reservations/activate")
                        .with(csrf())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(request)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("ACTIVE"));
    }

    @Test
    @WithMockUser(authorities = "SCOPE_sls-reservation-read")
    void shouldValidateReservation() throws Exception {
        // given
        ValidateReservationResponse response = ValidateReservationResponse.builder()
                .valid(true)
                .reservationCode("RES-ABC")
                .machineId("washer_01")
                .status(ReservationStatus.ACTIVE)
                .build();
        when(reservationService.validate("RES-ABC", "washer_01")).thenReturn(response);

        ValidateReservationRequest request = new ValidateReservationRequest();
        request.setReservationCode("RES-ABC");
        request.setMachineId("washer_01");

        // when / then
        mockMvc.perform(post("/api/reservations/validate")
                        .with(csrf())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(request)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.valid").value(true));
    }

    @Test
    @WithMockUser(authorities = "SCOPE_sls-reservation-read")
    void shouldGetReservationByCode() throws Exception {
        // given
        ReservationResponse response = ReservationResponse.builder()
                .reservationCode("RES-ABC123")
                .machineId("washer_01")
                .status(ReservationStatus.ACTIVE)
                .feeAmount(1500)
                .currency("XAF")
                .build();
        when(reservationService.getByCode("RES-ABC123")).thenReturn(response);

        // when / then
        mockMvc.perform(get("/api/reservations/RES-ABC123"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.reservationCode").value("RES-ABC123"));
    }

    @Test
    @WithMockUser(authorities = "SCOPE_sls-reservation-read")
    void shouldListReservationsForMachine() throws Exception {
        // given
        Reservation reservation = Reservation.builder()
                .reservationCode("RES-ABC")
                .machineId("washer_01")
                .status(ReservationStatus.ACTIVE)
                .slotStart(LocalDateTime.now())
                .slotEnd(LocalDateTime.now().plusHours(1))
                .feeAmount(1500)
                .currency("XAF")
                .build();
        when(reservationService.listForMachine("washer_01")).thenReturn(List.of(reservation));

        // when / then
        mockMvc.perform(get("/api/reservations/machine/washer_01"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$[0].reservationCode").value("RES-ABC"));
    }

    @Test
    void shouldReturn401WhenNoAuth() throws Exception {
        // when / then
        mockMvc.perform(get("/api/reservations/RES-ABC"))
                .andExpect(status().isUnauthorized());
    }

    @Test
    @WithMockUser(authorities = "SCOPE_sls-reservation-write")
    void shouldReturn400WhenMachineIdMissing() throws Exception {
        // given
        CreateReservationRequest request = new CreateReservationRequest();
        request.setSlotStart(LocalDateTime.now().plusHours(1));
        // machineId is missing

        // when / then
        mockMvc.perform(post("/api/reservations")
                        .with(csrf())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(request)))
                .andExpect(status().isBadRequest());
    }

    @Test
    @WithMockUser(authorities = "SCOPE_sls-reservation-write")
    void shouldReturn400WhenActivateRefMissing() throws Exception {
        // given
        ActivateReservationRequest request = new ActivateReservationRequest();
        // transactionReference is missing

        // when / then
        mockMvc.perform(post("/api/reservations/activate")
                        .with(csrf())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(request)))
                .andExpect(status().isBadRequest());
    }
}
