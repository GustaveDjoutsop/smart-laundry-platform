package com.botmanager.bots.laundry;

import lombok.Builder;
import lombok.Getter;
import lombok.extern.slf4j.Slf4j;

import java.time.LocalTime;
import java.time.ZoneId;
import java.time.ZonedDateTime;
import java.time.format.DateTimeFormatter;

@Slf4j
public class BusinessHoursService {

    private static final DateTimeFormatter TIME_FORMATTER = DateTimeFormatter.ofPattern("HH:mm");

    private final LocalTime openTime;

    private final LocalTime closeTime;

    private final int closingBufferMinutes;

    private final ZoneId timezone;

    public BusinessHoursService(String openTimeStr, String closeTimeStr, int closingBufferMinutes, String timezoneStr) {
        this.openTime = LocalTime.parse(openTimeStr, TIME_FORMATTER);
        this.closeTime = LocalTime.parse(closeTimeStr, TIME_FORMATTER);
        this.closingBufferMinutes = closingBufferMinutes;
        this.timezone = ZoneId.of(timezoneStr);
    }

    public static BusinessHoursService createDefault() {
        return new BusinessHoursService("07:00", "22:00", 15, "Africa/Douala");
    }

    public boolean isOpen() {
        LocalTime currentTime = getCurrentTime();

        return !currentTime.isBefore(openTime) && currentTime.isBefore(closeTime);
    }

    public CycleCheckResult canStartCycle(int cycleDurationMinutes) {
        LocalTime currentTime = getCurrentTime();

        if (currentTime.isBefore(openTime)) {
            return CycleCheckResult.builder()
                    .allowed(false)
                    .reason(CycleCheckReason.BEFORE_OPENING)
                    .openTime(formatTime(openTime))
                    .closeTime(formatTime(closeTime))
                    .currentTime(formatTime(currentTime))
                    .build();
        }

        if (!currentTime.isBefore(closeTime)) {
            return CycleCheckResult.builder()
                    .allowed(false)
                    .reason(CycleCheckReason.AFTER_CLOSING)
                    .openTime(formatTime(openTime))
                    .closeTime(formatTime(closeTime))
                    .currentTime(formatTime(currentTime))
                    .build();
        }

        LocalTime latestEndTime = closeTime.minusMinutes(closingBufferMinutes);
        LocalTime cycleEndTime = currentTime.plusMinutes(cycleDurationMinutes);
        LocalTime lastAllowedStartTime = latestEndTime.minusMinutes(cycleDurationMinutes);

        if (cycleEndTime.isAfter(latestEndTime)) {
            return CycleCheckResult.builder()
                    .allowed(false)
                    .reason(CycleCheckReason.CYCLE_EXCEEDS_CLOSING)
                    .cycleDuration(cycleDurationMinutes)
                    .closeTime(formatTime(closeTime))
                    .lastAllowedTime(formatTime(lastAllowedStartTime))
                    .currentTime(formatTime(currentTime))
                    .openTime(formatTime(openTime))
                    .build();
        }

        return CycleCheckResult.builder()
                .allowed(true)
                .reason(CycleCheckReason.OK)
                .build();
    }

    public BusinessHoursInfo getBusinessHoursInfo() {
        LocalTime currentTime = getCurrentTime();

        return BusinessHoursInfo.builder()
                .openTime(formatTime(openTime))
                .closeTime(formatTime(closeTime))
                .timezone(timezone.getId())
                .currentlyOpen(isOpen())
                .currentTime(formatTime(currentTime))
                .build();
    }

    public String calculateCycleEndTime(int cycleDurationMinutes) {
        LocalTime currentTime = getCurrentTime();
        LocalTime endTime = currentTime.plusMinutes(cycleDurationMinutes);

        return formatTime(endTime);
    }

    private LocalTime getCurrentTime() {
        return ZonedDateTime.now(timezone).toLocalTime();
    }

    private String formatTime(LocalTime time) {
        return time.format(TIME_FORMATTER);
    }

    @Getter
    @Builder
    public static class CycleCheckResult {

        private final boolean allowed;

        private final CycleCheckReason reason;

        private final Integer cycleDuration;

        private final String closeTime;

        private final String lastAllowedTime;

        private final String currentTime;

        private final String openTime;
    }

    public enum CycleCheckReason {
        OK,
        BEFORE_OPENING,
        AFTER_CLOSING,
        CYCLE_EXCEEDS_CLOSING
    }

    @Getter
    @Builder
    public static class BusinessHoursInfo {

        private final String openTime;

        private final String closeTime;

        private final String timezone;

        private final boolean currentlyOpen;

        private final String currentTime;
    }

}
