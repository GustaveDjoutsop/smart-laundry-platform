package com.botmanager.core.persistence.entity;

import com.botmanager.core.persistence.converter.EncryptedStringConverter;
import jakarta.persistence.Column;
import jakarta.persistence.Convert;
import jakarta.persistence.Entity;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.PreUpdate;
import jakarta.persistence.Table;
import lombok.Getter;
import lombok.Setter;
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.type.SqlTypes;

import java.time.Instant;
import java.util.Map;
import java.util.UUID;

@Getter
@Setter
@Entity
@Table(name = "businesses")
public class BusinessEntity {

    @Id
    @GeneratedValue(strategy = GenerationType.UUID)
    private UUID id;

    @Column(name = "bot_id", unique = true, nullable = false, length = 50)
    private String botId;

    @Column(nullable = false, length = 200)
    private String name;

    @Column(nullable = false, length = 50)
    private String industry;

    @Column(name = "phone_number_id", unique = true, nullable = false, length = 50)
    private String phoneNumberId;

    @Convert(converter = EncryptedStringConverter.class)
    @Column(name = "verify_token_enc")
    private String verifyToken;

    @Convert(converter = EncryptedStringConverter.class)
    @Column(name = "access_token_enc")
    private String accessToken;

    @Convert(converter = EncryptedStringConverter.class)
    @Column(name = "app_secret_enc")
    private String appSecret;

    @JdbcTypeCode(SqlTypes.JSON)
    @Column(columnDefinition = "jsonb")
    private Map<String, Object> config;

    @Column(name = "is_active")
    private boolean active = true;

    @Column(name = "created_at")
    private Instant createdAt = Instant.now();

    @Column(name = "updated_at")
    private Instant updatedAt = Instant.now();

    @PreUpdate
    void onUpdate() {
        updatedAt = Instant.now();
    }
}
