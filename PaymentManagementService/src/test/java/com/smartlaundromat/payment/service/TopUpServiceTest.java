package com.smartlaundromat.payment.service;

import com.smartlaundromat.payment.dto.PaymentResponse;
import com.smartlaundromat.payment.dto.TopUpRequest;
import com.smartlaundromat.payment.dto.TopUpResponse;
import com.smartlaundromat.payment.exception.CardNotFoundException;
import com.smartlaundromat.payment.exception.PaymentException;
import com.smartlaundromat.payment.model.RfidCard;
import com.smartlaundromat.payment.model.TopUpTransaction;
import com.smartlaundromat.payment.model.enums.PaymentStatus;
import com.smartlaundromat.payment.model.enums.TopUpChannel;
import com.smartlaundromat.payment.repository.RfidCardRepository;
import com.smartlaundromat.payment.repository.TopUpTransactionRepository;
import com.smartlaundromat.payment.service.provider.CampayService;
import com.smartlaundromat.payment.service.provider.MtnMomoService;
import com.smartlaundromat.payment.service.provider.OrangeMoneyService;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Nested;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.EnumSource;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import java.math.BigDecimal;
import java.util.List;
import java.util.Optional;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.*;

@ExtendWith(MockitoExtension.class)
class TopUpServiceTest {

    @Mock
    RfidCardRepository rfidCardRepository;

    @Mock
    TopUpTransactionRepository topUpTransactionRepository;

    @Mock
    CampayService campayService;

    @Mock
    MtnMomoService mtnMomoService;

    @Mock
    OrangeMoneyService orangeMoneyService;

    @InjectMocks
    TopUpService topUpService;

    private RfidCard activeCard;

    @BeforeEach
    void setUp() {
        activeCard = RfidCard.builder()
                .id(1L)
                .cardUid("ABC123")
                .ownerName("John Doe")
                .balance(new BigDecimal("5000.00"))
                .currency("XAF")
                .isActive(true)
                .build();
    }

    // ── initiateTopUp ────────────────────────────────────────────────────────

    @Nested
    class InitiateTopUp {

        @Test
        void shouldTopUpWithCashImmediately() {
            // given
            TopUpRequest request = new TopUpRequest();
            request.setCardUid("ABC123");
            request.setAmount(new BigDecimal("2000"));
            request.setChannel(TopUpChannel.CASH);

            when(rfidCardRepository.findByCardUid("ABC123")).thenReturn(Optional.of(activeCard));
            when(rfidCardRepository.save(any(RfidCard.class))).thenAnswer(inv -> inv.getArgument(0));
            when(topUpTransactionRepository.save(any(TopUpTransaction.class))).thenAnswer(inv -> inv.getArgument(0));

            // when
            TopUpResponse response = topUpService.initiateTopUp(request);

            // then
            assertThat(response.getStatus()).isEqualTo(PaymentStatus.SUCCESSFUL);
            assertThat(response.getNewBalance()).isEqualByComparingTo("7000.00");
            assertThat(response.getMessage()).isEqualTo("Top-up successful");
        }

        @Test
        void shouldInitiateMobileMoneyTopUpViaCampay() {
            // given
            TopUpRequest request = new TopUpRequest();
            request.setCardUid("ABC123");
            request.setAmount(new BigDecimal("2000"));
            request.setChannel(TopUpChannel.CAMPAY);
            request.setPhoneNumber("237612345678");

            when(rfidCardRepository.findByCardUid("ABC123")).thenReturn(Optional.of(activeCard));
            when(topUpTransactionRepository.save(any(TopUpTransaction.class))).thenAnswer(inv -> inv.getArgument(0));

            PaymentResponse paymentResponse = PaymentResponse.builder()
                    .providerReference("CAMP-REF-001")
                    .build();
            when(campayService.requestPayment(anyString(), any(), anyString(), anyString()))
                    .thenReturn(paymentResponse);

            // when
            TopUpResponse response = topUpService.initiateTopUp(request);

            // then
            assertThat(response.getStatus()).isEqualTo(PaymentStatus.PENDING);
            assertThat(response.getMessage()).contains("initiated");
        }

        @Test
        void shouldInitiateMobileMoneyTopUpViaMtn() {
            // given
            TopUpRequest request = new TopUpRequest();
            request.setCardUid("ABC123");
            request.setAmount(new BigDecimal("2000"));
            request.setChannel(TopUpChannel.MTN);
            request.setPhoneNumber("237612345678");

            when(rfidCardRepository.findByCardUid("ABC123")).thenReturn(Optional.of(activeCard));
            when(topUpTransactionRepository.save(any(TopUpTransaction.class))).thenAnswer(inv -> inv.getArgument(0));

            PaymentResponse paymentResponse = PaymentResponse.builder()
                    .providerReference("MTN-REF-001")
                    .build();
            when(mtnMomoService.requestPayment(anyString(), any(), anyString(), anyString()))
                    .thenReturn(paymentResponse);

            // when
            TopUpResponse response = topUpService.initiateTopUp(request);

            // then
            assertThat(response.getStatus()).isEqualTo(PaymentStatus.PENDING);
            verify(mtnMomoService).requestPayment(anyString(), any(), anyString(), anyString());
        }

        @Test
        void shouldInitiateMobileMoneyTopUpViaOrange() {
            // given
            TopUpRequest request = new TopUpRequest();
            request.setCardUid("ABC123");
            request.setAmount(new BigDecimal("2000"));
            request.setChannel(TopUpChannel.ORANGE_MONEY);
            request.setPhoneNumber("237612345678");

            when(rfidCardRepository.findByCardUid("ABC123")).thenReturn(Optional.of(activeCard));
            when(topUpTransactionRepository.save(any(TopUpTransaction.class))).thenAnswer(inv -> inv.getArgument(0));

            PaymentResponse paymentResponse = PaymentResponse.builder()
                    .providerReference("ORANGE-REF-001")
                    .build();
            when(orangeMoneyService.requestPayment(anyString(), any(), anyString(), anyString()))
                    .thenReturn(paymentResponse);

            // when
            TopUpResponse response = topUpService.initiateTopUp(request);

            // then
            assertThat(response.getStatus()).isEqualTo(PaymentStatus.PENDING);
            verify(orangeMoneyService).requestPayment(anyString(), any(), anyString(), anyString());
        }

        @Test
        void shouldThrowWhenCardNotFound() {
            // given
            TopUpRequest request = new TopUpRequest();
            request.setCardUid("INVALID");
            request.setAmount(new BigDecimal("1000"));
            request.setChannel(TopUpChannel.CASH);

            when(rfidCardRepository.findByCardUid("INVALID")).thenReturn(Optional.empty());

            // when / then
            assertThatThrownBy(() -> topUpService.initiateTopUp(request))
                    .isInstanceOf(CardNotFoundException.class);
        }

        @Test
        void shouldThrowWhenCardIsInactive() {
            // given
            activeCard.setIsActive(false);
            TopUpRequest request = new TopUpRequest();
            request.setCardUid("ABC123");
            request.setAmount(new BigDecimal("1000"));
            request.setChannel(TopUpChannel.CASH);

            when(rfidCardRepository.findByCardUid("ABC123")).thenReturn(Optional.of(activeCard));

            // when / then
            assertThatThrownBy(() -> topUpService.initiateTopUp(request))
                    .isInstanceOf(PaymentException.class)
                    .hasMessageContaining("deactivated");
        }

        @Test
        void shouldThrowWhenPhoneNumberMissingForMobileMoney() {
            // given
            TopUpRequest request = new TopUpRequest();
            request.setCardUid("ABC123");
            request.setAmount(new BigDecimal("1000"));
            request.setChannel(TopUpChannel.CAMPAY);
            request.setPhoneNumber(null);

            when(rfidCardRepository.findByCardUid("ABC123")).thenReturn(Optional.of(activeCard));
            when(topUpTransactionRepository.save(any(TopUpTransaction.class))).thenAnswer(inv -> inv.getArgument(0));

            // when / then
            assertThatThrownBy(() -> topUpService.initiateTopUp(request))
                    .isInstanceOf(PaymentException.class)
                    .hasMessageContaining("Phone number is required");
        }
    }

    // ── processTopUpWebhook ──────────────────────────────────────────────────

    @Nested
    class ProcessTopUpWebhook {

        @Test
        void shouldCreditCardOnSuccessfulWebhook() {
            // given
            TopUpTransaction topUp = TopUpTransaction.builder()
                    .reference("REF-001")
                    .rfidCardUid("ABC123")
                    .amount(new BigDecimal("2000"))
                    .channel(TopUpChannel.CAMPAY)
                    .status(PaymentStatus.PENDING)
                    .build();
            when(topUpTransactionRepository.findByReference("REF-001"))
                    .thenReturn(Optional.of(topUp));
            when(topUpTransactionRepository.save(any(TopUpTransaction.class))).thenAnswer(inv -> inv.getArgument(0));
            when(rfidCardRepository.findByCardUid("ABC123")).thenReturn(Optional.of(activeCard));
            when(rfidCardRepository.save(any(RfidCard.class))).thenAnswer(inv -> inv.getArgument(0));

            // when
            TopUpResponse response = topUpService.processTopUpWebhook("REF-001", "SUCCESSFUL", null);

            // then
            assertThat(response.getStatus()).isEqualTo(PaymentStatus.SUCCESSFUL);
            assertThat(response.getNewBalance()).isEqualByComparingTo("7000.00");
        }

        @Test
        void shouldMarkTopUpFailedOnFailedWebhook() {
            // given
            TopUpTransaction topUp = TopUpTransaction.builder()
                    .reference("REF-001")
                    .rfidCardUid("ABC123")
                    .amount(new BigDecimal("2000"))
                    .channel(TopUpChannel.CAMPAY)
                    .status(PaymentStatus.PENDING)
                    .build();
            when(topUpTransactionRepository.findByReference("REF-001"))
                    .thenReturn(Optional.of(topUp));
            when(topUpTransactionRepository.save(any(TopUpTransaction.class))).thenAnswer(inv -> inv.getArgument(0));

            // when
            TopUpResponse response = topUpService.processTopUpWebhook("REF-001", "FAILED", "User cancelled");

            // then
            assertThat(response.getStatus()).isEqualTo(PaymentStatus.FAILED);
            assertThat(response.getMessage()).contains("User cancelled");
        }

        @Test
        void shouldReturnAlreadyProcessedWhenTopUpIsAlreadySuccessful() {
            // given
            TopUpTransaction topUp = TopUpTransaction.builder()
                    .reference("REF-001")
                    .rfidCardUid("ABC123")
                    .amount(new BigDecimal("2000"))
                    .channel(TopUpChannel.CAMPAY)
                    .status(PaymentStatus.SUCCESSFUL)
                    .build();
            when(topUpTransactionRepository.findByReference("REF-001"))
                    .thenReturn(Optional.of(topUp));
            when(rfidCardRepository.findByCardUid("ABC123")).thenReturn(Optional.of(activeCard));

            // when
            TopUpResponse response = topUpService.processTopUpWebhook("REF-001", "SUCCESSFUL", null);

            // then
            assertThat(response.getStatus()).isEqualTo(PaymentStatus.SUCCESSFUL);
            assertThat(response.getMessage()).isEqualTo("Already processed");
        }

        @Test
        void shouldHandleAlreadyProcessedWhenCardNotFound() {
            // given
            TopUpTransaction topUp = TopUpTransaction.builder()
                    .reference("REF-001")
                    .rfidCardUid("GONE")
                    .amount(new BigDecimal("2000"))
                    .channel(TopUpChannel.CAMPAY)
                    .status(PaymentStatus.SUCCESSFUL)
                    .build();
            when(topUpTransactionRepository.findByReference("REF-001"))
                    .thenReturn(Optional.of(topUp));
            when(rfidCardRepository.findByCardUid("GONE")).thenReturn(Optional.empty());

            // when
            TopUpResponse response = topUpService.processTopUpWebhook("REF-001", "SUCCESSFUL", null);

            // then
            assertThat(response.getNewBalance()).isNull();
        }

        @Test
        void shouldThrowWhenTopUpNotFound() {
            // given
            when(topUpTransactionRepository.findByReference("INVALID"))
                    .thenReturn(Optional.empty());

            // when / then
            assertThatThrownBy(() -> topUpService.processTopUpWebhook("INVALID", "SUCCESSFUL", null))
                    .isInstanceOf(PaymentException.class)
                    .hasMessageContaining("Top-up not found");
        }

        @Test
        void shouldThrowWhenCardNotFoundOnSuccessfulWebhook() {
            // given
            TopUpTransaction topUp = TopUpTransaction.builder()
                    .reference("REF-001")
                    .rfidCardUid("GONE")
                    .amount(new BigDecimal("2000"))
                    .channel(TopUpChannel.CAMPAY)
                    .status(PaymentStatus.PENDING)
                    .build();
            when(topUpTransactionRepository.findByReference("REF-001"))
                    .thenReturn(Optional.of(topUp));
            when(topUpTransactionRepository.save(any(TopUpTransaction.class))).thenAnswer(inv -> inv.getArgument(0));
            when(rfidCardRepository.findByCardUid("GONE")).thenReturn(Optional.empty());

            // when / then
            assertThatThrownBy(() -> topUpService.processTopUpWebhook("REF-001", "SUCCESSFUL", null))
                    .isInstanceOf(CardNotFoundException.class);
        }
    }

    // ── getTopUpHistory ──────────────────────────────────────────────────────

    @Test
    void shouldGetTopUpHistory() {
        // given
        when(topUpTransactionRepository.findByRfidCardUidOrderByCreatedAtDesc("ABC123"))
                .thenReturn(List.of(TopUpTransaction.builder().rfidCardUid("ABC123").build()));

        // when
        List<TopUpTransaction> result = topUpService.getTopUpHistory("ABC123");

        // then
        assertThat(result).hasSize(1);
    }
}
