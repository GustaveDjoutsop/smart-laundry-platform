package com.botmanager.core.persistence.entity;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.FetchType;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.JoinColumn;
import jakarta.persistence.ManyToOne;
import jakarta.persistence.Table;
import lombok.Getter;
import lombok.Setter;

import java.time.Instant;
import java.util.UUID;

@Getter
@Setter
@Entity
@Table(name = "messages")
public class MessageEntity {

    @Id
    @GeneratedValue(strategy = GenerationType.UUID)
    private UUID id;

    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "business_id")
    private BusinessEntity business;

    @Column(name = "sender_phone", nullable = false, length = 20)
    private String senderPhone;

    @Column(nullable = false, length = 10)
    private String direction;

    @Column(name = "message_type", length = 20)
    private String messageType;

    @Column(columnDefinition = "TEXT")
    private String content;

    @Column(name = "whatsapp_msg_id", length = 100)
    private String whatsappMsgId;

    @Column(name = "created_at")
    private Instant createdAt = Instant.now();
}
