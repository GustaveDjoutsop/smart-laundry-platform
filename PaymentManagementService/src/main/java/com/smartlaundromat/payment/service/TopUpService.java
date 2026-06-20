package com.smartlaundromat.payment.service;

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
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.util.StringUtils;

import java.util.List;

@Service
@Slf4j
@RequiredArgsConstructor
public class TopUpService {

    private final RfidCardRepository rfidCardRepository;
    private final TopUpTransactionRepository topUpTransactionRepository;
    private final CampayService campayService;
    private final MtnMomoService mtnMomoService;
    private final OrangeMoneyService orangeMoneyService;

    @Transactional
    public TopUpResponse initiateTopUp(TopUpRequest request) {
        RfidCard card = rfidCardRepository.findByCardUid(request.getCardUid())
                .orElseThrow(() -> new CardNotFoundException("Card not found: " + request.getCardUid()));

        if (!card.getIsActive()) {
            throw new PaymentException("CARD_INACTIVE", "Card is deactivated");
        }

        TopUpTransaction topUp = TopUpTransaction.builder()
                .rfidCardUid(request.getCardUid())
                .amount(request.getAmount())
                .phoneNumber(request.getPhoneNumber())
                .channel(request.getChannel())
                .build();

        if (request.getChannel() == TopUpChannel.CASH) {
            card.setBalance(card.getBalance().add(request.getAmount()));
            rfidCardRepository.save(card);

            topUp.setStatus(PaymentStatus.SUCCESSFUL);
            topUpTransactionRepository.save(topUp);

            log.info("Cash top-up: card={}, amount={}, newBalance={}",
                    request.getCardUid(), request.getAmount(), card.getBalance());

            return TopUpResponse.builder()
                    .reference(topUp.getReference())
                    .cardUid(request.getCardUid())
                    .amount(request.getAmount())
                    .currency(card.getCurrency())
                    .channel(request.getChannel())
                    .status(PaymentStatus.SUCCESSFUL)
                    .newBalance(card.getBalance())
                    .message("Top-up successful")
                    .build();
        }

        topUpTransactionRepository.save(topUp);

        String phoneNumber = request.getPhoneNumber();
        if (!StringUtils.hasText(phoneNumber)) {
            throw new PaymentException("PHONE_REQUIRED", "Phone number is required for mobile money top-up");
        }

        var provider = switch (request.getChannel()) {
            case CAMPAY -> campayService;
            case MTN -> mtnMomoService;
            case ORANGE_MONEY -> orangeMoneyService;
            default -> throw new PaymentException("INVALID_CHANNEL", "Invalid top-up channel");
        };

        var paymentResponse = provider.requestPayment(
                phoneNumber, request.getAmount(),
                "RFID Card Top-Up: " + request.getCardUid(),
                topUp.getReference()
        );

        topUp.setProviderReference(paymentResponse.getProviderReference());
        topUpTransactionRepository.save(topUp);

        return TopUpResponse.builder()
                .reference(topUp.getReference())
                .cardUid(request.getCardUid())
                .amount(request.getAmount())
                .currency(card.getCurrency())
                .channel(request.getChannel())
                .status(PaymentStatus.PENDING)
                .newBalance(card.getBalance())
                .message("Top-up payment initiated. Please confirm on your phone.")
                .build();
    }

    @Transactional
    public TopUpResponse processTopUpWebhook(String reference, String status, String failureReason) {
        TopUpTransaction topUp = topUpTransactionRepository.findByReference(reference)
                .orElseThrow(() -> new PaymentException("TOPUP_NOT_FOUND", "Top-up not found: " + reference));

        if (topUp.getStatus() == PaymentStatus.SUCCESSFUL) {
            RfidCard card = rfidCardRepository.findByCardUid(topUp.getRfidCardUid()).orElse(null);
            return TopUpResponse.builder()
                    .reference(reference)
                    .cardUid(topUp.getRfidCardUid())
                    .amount(topUp.getAmount())
                    .channel(topUp.getChannel())
                    .status(PaymentStatus.SUCCESSFUL)
                    .newBalance(card != null ? card.getBalance() : null)
                    .message("Already processed")
                    .build();
        }

        if ("SUCCESSFUL".equalsIgnoreCase(status)) {
            topUp.setStatus(PaymentStatus.SUCCESSFUL);
            topUpTransactionRepository.save(topUp);

            RfidCard card = rfidCardRepository.findByCardUid(topUp.getRfidCardUid())
                    .orElseThrow(() -> new CardNotFoundException("Card not found: " + topUp.getRfidCardUid()));

            card.setBalance(card.getBalance().add(topUp.getAmount()));
            rfidCardRepository.save(card);

            log.info("Mobile money top-up confirmed: card={}, amount={}, newBalance={}",
                    topUp.getRfidCardUid(), topUp.getAmount(), card.getBalance());

            return TopUpResponse.builder()
                    .reference(reference)
                    .cardUid(topUp.getRfidCardUid())
                    .amount(topUp.getAmount())
                    .currency(card.getCurrency())
                    .channel(topUp.getChannel())
                    .status(PaymentStatus.SUCCESSFUL)
                    .newBalance(card.getBalance())
                    .message("Top-up successful")
                    .build();
        } else {
            topUp.setStatus(PaymentStatus.FAILED);
            topUp.setFailureReason(failureReason);
            topUpTransactionRepository.save(topUp);

            return TopUpResponse.builder()
                    .reference(reference)
                    .cardUid(topUp.getRfidCardUid())
                    .amount(topUp.getAmount())
                    .channel(topUp.getChannel())
                    .status(PaymentStatus.FAILED)
                    .message("Top-up failed: " + failureReason)
                    .build();
        }
    }

    public List<TopUpTransaction> getTopUpHistory(String cardUid) {
        return topUpTransactionRepository.findByRfidCardUidOrderByCreatedAtDesc(cardUid);
    }
}
