package com.botmanager.core.payment;

import com.botmanager.config.PaymentProperties;
import com.botmanager.core.persistence.entity.BusinessEntity;
import com.botmanager.core.persistence.entity.PaymentEntity;
import com.botmanager.core.persistence.repository.BusinessRepository;
import com.botmanager.core.persistence.repository.PaymentRepository;
import com.botmanager.core.redis.RedisManager;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Component;

import java.math.BigDecimal;
import java.time.Instant;
import java.util.Optional;

@Slf4j
@Component
@RequiredArgsConstructor
public class PaymentStore {

    private static final String PAYMENT_KEY_PREFIX = "payment:";

    private static final String PAYMENT_REF_KEY_PREFIX = "paymentRef:";

    private final RedisManager redisManager;

    private final PaymentProperties paymentProperties;

    private final PaymentRepository paymentRepository;

    private final BusinessRepository businessRepository;

    public void upsertPayment(PaymentRecord record) {
        String key = PAYMENT_KEY_PREFIX + record.getBotId() + ":" + record.getTransactionId();

        if (record.getCreatedAt() == null) {
            record.setCreatedAt(Instant.now());
        }

        record.setUpdatedAt(Instant.now());

        redisManager.setWithExpiry(key, record, paymentProperties.getTtlSeconds());

        if (record.getExternalRef() != null) {
            String refKey = PAYMENT_REF_KEY_PREFIX + record.getBotId() + ":" + record.getExternalRef();
            redisManager.setWithExpiry(refKey, record.getTransactionId(), paymentProperties.getTtlSeconds());
        }

        persistToDatabase(record);

        log.debug("Upserted payment {} for bot {}", record.getTransactionId(), record.getBotId());
    }

    public Optional<PaymentRecord> getPayment(String botId, String transactionId) {
        String key = PAYMENT_KEY_PREFIX + botId + ":" + transactionId;

        return redisManager.get(key, PaymentRecord.class);
    }

    public Optional<PaymentRecord> getPaymentByExternalRef(String botId, String externalRef) {
        String refKey = PAYMENT_REF_KEY_PREFIX + botId + ":" + externalRef;

        return redisManager.get(refKey)
                .flatMap(transactionId -> getPayment(botId, transactionId));
    }

    private void persistToDatabase(PaymentRecord record) {
        try {
            PaymentEntity entity = paymentRepository.findByTransactionId(record.getTransactionId())
                    .orElseGet(PaymentEntity::new);

            BusinessEntity business = businessRepository.findByBotId(record.getBotId()).orElse(null);
            entity.setBusiness(business);
            entity.setCustomerPhone(record.getCustomerPhone());
            entity.setProvider(record.getProvider());
            entity.setAmount(BigDecimal.valueOf(record.getAmount()));
            entity.setCurrency(record.getCurrency());
            entity.setStatus(record.getStatus().getValue());
            entity.setTransactionId(record.getTransactionId());
            entity.setExternalRef(record.getExternalRef());
            entity.setMetadata(record.getMetadata());
            entity.setUpdatedAt(Instant.now());

            if (entity.getCreatedAt() == null) {
                entity.setCreatedAt(record.getCreatedAt());
            }

            paymentRepository.save(entity);
        } catch (Exception exception) {
            log.warn("Failed to persist payment {} to database: {}", record.getTransactionId(), exception.getMessage());
        }
    }

}
