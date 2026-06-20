package com.smartlaundromat.payment.service;

import com.smartlaundromat.payment.dto.RfidBalanceResponse;
import com.smartlaundromat.payment.dto.RfidCardRegistrationRequest;
import com.smartlaundromat.payment.dto.TransactionDebitResponse;
import com.smartlaundromat.payment.exception.CardNotFoundException;
import com.smartlaundromat.payment.exception.InsufficientBalanceException;
import com.smartlaundromat.payment.model.RfidCard;
import com.smartlaundromat.payment.model.Transaction;
import com.smartlaundromat.payment.repository.RfidCardRepository;
import com.smartlaundromat.payment.repository.TransactionRepository;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Nested;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.CsvSource;
import org.mockito.ArgumentCaptor;
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
class RfidCardServiceTest {

    @Mock
    RfidCardRepository rfidCardRepository;

    @Mock
    TransactionRepository transactionRepository;

    @InjectMocks
    RfidCardService rfidCardService;

    private RfidCard activeCard;

    @BeforeEach
    void setUp() {
        activeCard = RfidCard.builder()
                .id(1L)
                .cardUid("ABC123")
                .ownerName("John Doe")
                .phoneNumber("237612345678")
                .balance(new BigDecimal("5000.00"))
                .currency("XAF")
                .isActive(true)
                .build();
    }

    // ── registerCard ─────────────────────────────────────────────────────────

    @Nested
    class RegisterCard {

        @Test
        void shouldRegisterCardWhenUidIsNew() {
            // given
            RfidCardRegistrationRequest request = new RfidCardRegistrationRequest();
            request.setCardUid("NEW001");
            request.setOwnerName("Jane Doe");
            request.setPhoneNumber("237612345678");

            when(rfidCardRepository.existsByCardUid("NEW001")).thenReturn(false);
            when(rfidCardRepository.save(any(RfidCard.class))).thenAnswer(inv -> inv.getArgument(0));

            // when
            RfidCard result = rfidCardService.registerCard(request);

            // then
            assertThat(result.getCardUid()).isEqualTo("NEW001");
            assertThat(result.getOwnerName()).isEqualTo("Jane Doe");
            verify(rfidCardRepository).save(any(RfidCard.class));
        }

        @Test
        void shouldThrowWhenCardUidAlreadyExists() {
            // given
            RfidCardRegistrationRequest request = new RfidCardRegistrationRequest();
            request.setCardUid("ABC123");

            when(rfidCardRepository.existsByCardUid("ABC123")).thenReturn(true);

            // when / then
            assertThatThrownBy(() -> rfidCardService.registerCard(request))
                    .isInstanceOf(IllegalArgumentException.class)
                    .hasMessageContaining("already registered");
        }
    }

    // ── checkBalance ─────────────────────────────────────────────────────────

    @Nested
    class CheckBalance {

        @Test
        void shouldReturnBalanceWhenCardExists() {
            // given
            when(rfidCardRepository.findByCardUid("ABC123")).thenReturn(Optional.of(activeCard));

            // when
            RfidBalanceResponse response = rfidCardService.checkBalance("ABC123");

            // then
            assertThat(response.getCardUid()).isEqualTo("ABC123");
            assertThat(response.getBalance()).isEqualByComparingTo("5000.00");
            assertThat(response.isSufficient()).isTrue();
        }

        @Test
        void shouldReturnSufficientTrueWhenBalanceIsEnough() {
            // given
            when(rfidCardRepository.findByCardUid("ABC123")).thenReturn(Optional.of(activeCard));

            // when
            RfidBalanceResponse response = rfidCardService.checkBalance("ABC123", new BigDecimal("3000"));

            // then
            assertThat(response.isSufficient()).isTrue();
            assertThat(response.getMessage()).contains("OK");
        }

        @Test
        void shouldReturnSufficientFalseWhenBalanceIsNotEnough() {
            // given
            when(rfidCardRepository.findByCardUid("ABC123")).thenReturn(Optional.of(activeCard));

            // when
            RfidBalanceResponse response = rfidCardService.checkBalance("ABC123", new BigDecimal("10000"));

            // then
            assertThat(response.isSufficient()).isFalse();
            assertThat(response.getMessage()).contains("insuffisant");
        }

        @Test
        void shouldReturnSufficientFalseWhenCardIsDeactivated() {
            // given
            activeCard.setIsActive(false);
            when(rfidCardRepository.findByCardUid("ABC123")).thenReturn(Optional.of(activeCard));

            // when
            RfidBalanceResponse response = rfidCardService.checkBalance("ABC123");

            // then
            assertThat(response.isSufficient()).isFalse();
            assertThat(response.getMessage()).isEqualTo("Card is deactivated");
        }

        @Test
        void shouldThrowWhenCardNotFound() {
            // given
            when(rfidCardRepository.findByCardUid("INVALID")).thenReturn(Optional.empty());

            // when / then
            assertThatThrownBy(() -> rfidCardService.checkBalance("INVALID"))
                    .isInstanceOf(CardNotFoundException.class);
        }
    }

    // ── debitCard ─────────────────────────────────────────────────────────────

    @Nested
    class DebitCard {

        @Test
        void shouldDebitCardWhenBalanceIsSufficient() {
            // given
            when(rfidCardRepository.findByCardUid("ABC123")).thenReturn(Optional.of(activeCard));
            when(rfidCardRepository.save(any(RfidCard.class))).thenAnswer(inv -> inv.getArgument(0));
            when(transactionRepository.save(any(Transaction.class))).thenAnswer(inv -> inv.getArgument(0));

            // when
            TransactionDebitResponse response = rfidCardService.debitCard(
                    "ABC123", new BigDecimal("1000"), "MACH-01", 2, 30, "Wash cycle");

            // then
            assertThat(response.isSuccess()).isTrue();
            assertThat(response.getAmountDebited()).isEqualByComparingTo("1000");
            assertThat(response.getRemainingBalance()).isEqualByComparingTo("4000.00");
            assertThat(response.getMachineId()).isEqualTo("MACH-01");

            ArgumentCaptor<RfidCard> cardCaptor = ArgumentCaptor.forClass(RfidCard.class);
            verify(rfidCardRepository).save(cardCaptor.capture());
            assertThat(cardCaptor.getValue().getBalance()).isEqualByComparingTo("4000.00");
        }

        @Test
        void shouldThrowWhenCardIsDeactivated() {
            // given
            activeCard.setIsActive(false);
            when(rfidCardRepository.findByCardUid("ABC123")).thenReturn(Optional.of(activeCard));

            // when / then
            assertThatThrownBy(() -> rfidCardService.debitCard(
                    "ABC123", new BigDecimal("100"), "MACH-01", 1, 30, "test"))
                    .isInstanceOf(InsufficientBalanceException.class)
                    .hasMessageContaining("deactivated");
        }

        @Test
        void shouldThrowWhenBalanceIsInsufficient() {
            // given
            when(rfidCardRepository.findByCardUid("ABC123")).thenReturn(Optional.of(activeCard));

            // when / then
            assertThatThrownBy(() -> rfidCardService.debitCard(
                    "ABC123", new BigDecimal("99999"), "MACH-01", 1, 30, "test"))
                    .isInstanceOf(InsufficientBalanceException.class)
                    .hasMessageContaining("Insufficient balance");
        }

        @Test
        void shouldThrowWhenCardNotFoundOnDebit() {
            // given
            when(rfidCardRepository.findByCardUid("INVALID")).thenReturn(Optional.empty());

            // when / then
            assertThatThrownBy(() -> rfidCardService.debitCard(
                    "INVALID", new BigDecimal("100"), "MACH-01", 1, 30, "test"))
                    .isInstanceOf(CardNotFoundException.class);
        }
    }

    // ── creditCard ────────────────────────────────────────────────────────────

    @Test
    void shouldCreditCardSuccessfully() {
        // given
        when(rfidCardRepository.findByCardUid("ABC123")).thenReturn(Optional.of(activeCard));
        when(rfidCardRepository.save(any(RfidCard.class))).thenAnswer(inv -> inv.getArgument(0));

        // when
        RfidCard result = rfidCardService.creditCard("ABC123", new BigDecimal("2000"));

        // then
        assertThat(result.getBalance()).isEqualByComparingTo("7000.00");
    }

    @Test
    void shouldThrowWhenCreditingNonExistentCard() {
        // given
        when(rfidCardRepository.findByCardUid("INVALID")).thenReturn(Optional.empty());

        // when / then
        assertThatThrownBy(() -> rfidCardService.creditCard("INVALID", new BigDecimal("100")))
                .isInstanceOf(CardNotFoundException.class);
    }

    // ── getAllCards ────────────────────────────────────────────────────────────

    @Test
    void shouldReturnAllCards() {
        // given
        when(rfidCardRepository.findAll()).thenReturn(List.of(activeCard));

        // when
        List<RfidCard> result = rfidCardService.getAllCards();

        // then
        assertThat(result).hasSize(1);
    }

    // ── getCardByUid ──────────────────────────────────────────────────────────

    @Test
    void shouldReturnCardByUid() {
        // given
        when(rfidCardRepository.findByCardUid("ABC123")).thenReturn(Optional.of(activeCard));

        // when
        RfidCard result = rfidCardService.getCardByUid("ABC123");

        // then
        assertThat(result.getCardUid()).isEqualTo("ABC123");
    }

    // ── deactivateCard / activateCard ─────────────────────────────────────────

    @Test
    void shouldDeactivateCard() {
        // given
        when(rfidCardRepository.findByCardUid("ABC123")).thenReturn(Optional.of(activeCard));
        when(rfidCardRepository.save(any(RfidCard.class))).thenAnswer(inv -> inv.getArgument(0));

        // when
        RfidCard result = rfidCardService.deactivateCard("ABC123");

        // then
        assertThat(result.getIsActive()).isFalse();
    }

    @Test
    void shouldActivateCard() {
        // given
        activeCard.setIsActive(false);
        when(rfidCardRepository.findByCardUid("ABC123")).thenReturn(Optional.of(activeCard));
        when(rfidCardRepository.save(any(RfidCard.class))).thenAnswer(inv -> inv.getArgument(0));

        // when
        RfidCard result = rfidCardService.activateCard("ABC123");

        // then
        assertThat(result.getIsActive()).isTrue();
    }
}
