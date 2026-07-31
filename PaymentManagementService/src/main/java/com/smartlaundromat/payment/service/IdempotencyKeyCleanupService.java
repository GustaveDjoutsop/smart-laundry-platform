package com.smartlaundromat.payment.service;

import com.smartlaundromat.payment.repository.IdempotencyKeyRepository;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.OffsetDateTime;

@Service
@Slf4j
@RequiredArgsConstructor
public class IdempotencyKeyCleanupService {

    private final IdempotencyKeyRepository idempotencyKeyRepository;

    @Scheduled(fixedRate = 3_600_000)
    @Transactional
    public void purgeExpiredKeys() {
        int deleted = idempotencyKeyRepository.deleteByExpiresAtBefore(OffsetDateTime.now());

        if (deleted > 0) {
            log.info("Purged {} expired idempotency keys", deleted);
        }
    }
}
