package com.smartlaundromat.payment.service;

import com.smartlaundromat.payment.dto.RfidBalanceResponse;
import com.smartlaundromat.payment.dto.RfidCardRegistrationRequest;
import com.smartlaundromat.payment.dto.TransactionDebitResponse;
import com.smartlaundromat.payment.exception.CardNotFoundException;
import com.smartlaundromat.payment.exception.InsufficientBalanceException;
import com.smartlaundromat.payment.model.RfidCard;
import com.smartlaundromat.payment.model.Transaction;
import com.smartlaundromat.payment.model.enums.PaymentProvider;
import com.smartlaundromat.payment.model.enums.PaymentStatus;
import com.smartlaundromat.payment.repository.RfidCardRepository;
import com.smartlaundromat.payment.repository.TransactionRepository;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.math.BigDecimal;
import java.util.List;

@Service
@Slf4j
@RequiredArgsConstructor
public class RfidCardService {

    private final RfidCardRepository rfidCardRepository;
    private final TransactionRepository transactionRepository;

    public RfidCard registerCard(RfidCardRegistrationRequest request) {
        if (rfidCardRepository.existsByCardUid(request.getCardUid())) {
            throw new IllegalArgumentException("Card with UID " + request.getCardUid() + " already registered");
        }

        RfidCard card = RfidCard.builder()
                .cardUid(request.getCardUid())
                .ownerName(request.getOwnerName())
                .phoneNumber(request.getPhoneNumber())
                .build();

        return rfidCardRepository.save(card);
    }

    public RfidBalanceResponse checkBalance(String cardUid) {
        return checkBalance(cardUid, null);
    }

    public RfidBalanceResponse checkBalance(String cardUid, BigDecimal requiredAmount) {
        RfidCard card = rfidCardRepository.findByCardUid(cardUid)
                .orElseThrow(() -> new CardNotFoundException("Card not found: " + cardUid));

        if (!card.getIsActive()) {
            return RfidBalanceResponse.builder()
                    .cardUid(card.getCardUid())
                    .ownerName(card.getOwnerName())
                    .balance(card.getBalance())
                    .currency(card.getCurrency())
                    .sufficient(false)
                    .message("Card is deactivated")
                    .build();
        }

        boolean sufficient = requiredAmount == null || card.hasSufficientBalance(requiredAmount);
        String message = sufficient
                ? String.format("Solde = %s %s — OK", card.getBalance().toPlainString(), card.getCurrency())
                : String.format("Solde insuffisant: %s %s (requis: %s %s)",
                    card.getBalance().toPlainString(), card.getCurrency(),
                    requiredAmount.toPlainString(), card.getCurrency());

        return RfidBalanceResponse.builder()
                .cardUid(card.getCardUid())
                .ownerName(card.getOwnerName())
                .balance(card.getBalance())
                .currency(card.getCurrency())
                .sufficient(sufficient)
                .message(message)
                .build();
    }

    @Transactional
    public TransactionDebitResponse debitCard(String cardUid, BigDecimal amount, String machineId,
                                              Integer pulseCount, Integer cycleDuration, String description) {
        RfidCard card = rfidCardRepository.findByCardUid(cardUid)
                .orElseThrow(() -> new CardNotFoundException("Card not found: " + cardUid));

        if (!card.getIsActive()) {
            throw new InsufficientBalanceException("Card is deactivated");
        }

        if (!card.hasSufficientBalance(amount)) {
            throw new InsufficientBalanceException(
                    String.format("Insufficient balance: %s %s (required: %s %s)",
                            card.getBalance().toPlainString(), card.getCurrency(),
                            amount.toPlainString(), card.getCurrency()));
        }

        card.setBalance(card.getBalance().subtract(amount));
        rfidCardRepository.save(card);

        Transaction transaction = Transaction.builder()
                .amount(amount)
                .machineId(machineId)
                .pulseCount(pulseCount)
                .cycleDuration(cycleDuration)
                .description(description)
                .status(PaymentStatus.SUCCESSFUL)
                .paymentProvider(PaymentProvider.CAMPAY)
                .rfidCardUid(cardUid)
                .build();
        transactionRepository.save(transaction);

        log.info("RFID debit: card={}, amount={}, machine={}, remaining={}",
                cardUid, amount, machineId, card.getBalance());

        return TransactionDebitResponse.builder()
                .success(true)
                .transactionReference(transaction.getExternalReference())
                .cardUid(cardUid)
                .machineId(machineId)
                .amountDebited(amount)
                .remainingBalance(card.getBalance())
                .pulseCount(pulseCount)
                .cycleDuration(cycleDuration)
                .message(String.format("Debit OK — %s %s debited. Remaining: %s %s",
                        amount.toPlainString(), card.getCurrency(),
                        card.getBalance().toPlainString(), card.getCurrency()))
                .build();
    }

    @Transactional
    public RfidCard creditCard(String cardUid, BigDecimal amount) {
        RfidCard card = rfidCardRepository.findByCardUid(cardUid)
                .orElseThrow(() -> new CardNotFoundException("Card not found: " + cardUid));

        card.setBalance(card.getBalance().add(amount));
        return rfidCardRepository.save(card);
    }

    public List<RfidCard> getAllCards() {
        return rfidCardRepository.findAll();
    }

    public RfidCard getCardByUid(String cardUid) {
        return rfidCardRepository.findByCardUid(cardUid)
                .orElseThrow(() -> new CardNotFoundException("Card not found: " + cardUid));
    }

    @Transactional
    public RfidCard deactivateCard(String cardUid) {
        RfidCard card = getCardByUid(cardUid);
        card.setIsActive(false);
        return rfidCardRepository.save(card);
    }

    @Transactional
    public RfidCard activateCard(String cardUid) {
        RfidCard card = getCardByUid(cardUid);
        card.setIsActive(true);
        return rfidCardRepository.save(card);
    }
}
