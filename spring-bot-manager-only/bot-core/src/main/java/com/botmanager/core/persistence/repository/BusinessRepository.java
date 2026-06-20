package com.botmanager.core.persistence.repository;

import com.botmanager.core.persistence.entity.BusinessEntity;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;
import java.util.Optional;
import java.util.UUID;

public interface BusinessRepository extends JpaRepository<BusinessEntity, UUID> {

    Optional<BusinessEntity> findByBotId(String botId);

    Optional<BusinessEntity> findByPhoneNumberId(String phoneNumberId);

    List<BusinessEntity> findByActiveTrue();

    boolean existsByBotId(String botId);

    boolean existsByPhoneNumberId(String phoneNumberId);
}
