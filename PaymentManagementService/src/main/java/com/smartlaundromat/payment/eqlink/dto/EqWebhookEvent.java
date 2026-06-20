package com.smartlaundromat.payment.eqlink.dto;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import com.fasterxml.jackson.annotation.JsonProperty;
import lombok.Data;

import java.time.Instant;
import java.util.Map;

/**
 * Payload of a webhook event pushed by EQLink to the payment service.
 *
 * <p>EQLink sends these when a payment/order event occurs on a machine:
 * <ul>
 *   <li>{@code cycle.completed}  — customer paid and cycle finished</li>
 *   <li>{@code payment.confirmed} — payment confirmed, cycle starting</li>
 *   <li>{@code payment.failed}   — payment attempt failed</li>
 * </ul>
 */
@Data
@JsonIgnoreProperties(ignoreUnknown = true)
public class EqWebhookEvent {

    /** Event type (e.g. {@code cycle.completed}, {@code payment.confirmed}). */
    @JsonProperty("event_type")
    private String eventType;

    /** EQLink device ID of the machine. */
    @JsonProperty("device_id")
    private String deviceId;

    /** Internal reference your backend sent with the start command (if any). */
    @JsonProperty("transaction_ref")
    private String transactionRef;

    /** Amount collected by EQLink in XAF. */
    @JsonProperty("amount")
    private Integer amount;

    /** Currency code. */
    @JsonProperty("currency")
    private String currency;

    /** Customer phone number (when payment is mobile-money initiated). */
    @JsonProperty("customer_phone")
    private String customerPhone;

    /** UTC timestamp of the event. */
    @JsonProperty("timestamp")
    private Instant timestamp;

    /** Additional event-specific fields. */
    @JsonProperty("payload")
    private Map<String, Object> payload;
}
