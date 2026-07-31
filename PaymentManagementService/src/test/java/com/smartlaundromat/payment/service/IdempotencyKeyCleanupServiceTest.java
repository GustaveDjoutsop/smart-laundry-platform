package com.smartlaundromat.payment.service;

import com.smartlaundromat.payment.repository.IdempotencyKeyRepository;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import java.time.OffsetDateTime;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

@ExtendWith(MockitoExtension.class)
class IdempotencyKeyCleanupServiceTest {

    @Mock
    IdempotencyKeyRepository idempotencyKeyRepository;

    @InjectMocks
    IdempotencyKeyCleanupService idempotencyKeyCleanupService;

    @Test
    void shouldDeleteExpiredKeys() {
        // given
        when(idempotencyKeyRepository.deleteByExpiresAtBefore(any(OffsetDateTime.class))).thenReturn(3);

        // when
        idempotencyKeyCleanupService.purgeExpiredKeys();

        // then
        verify(idempotencyKeyRepository).deleteByExpiresAtBefore(any(OffsetDateTime.class));
    }

    @Test
    void shouldDoNothingWhenNoExpiredKeys() {
        // given
        when(idempotencyKeyRepository.deleteByExpiresAtBefore(any(OffsetDateTime.class))).thenReturn(0);

        // when
        idempotencyKeyCleanupService.purgeExpiredKeys();

        // then
        verify(idempotencyKeyRepository).deleteByExpiresAtBefore(any(OffsetDateTime.class));
    }
}
