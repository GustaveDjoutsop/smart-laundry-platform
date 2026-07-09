package com.botmanager.bots.laundry;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;

import java.time.Instant;

@Getter
@Setter
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class FeedbackRecord {

    private String id;

    private String botId;

    private String customerPhone;

    private String machineId;

    private String machineName;

    private String transactionId;

    private int rating;

    private String comment;

    private Instant submittedAt;

    private boolean staffAlertSent;

}
