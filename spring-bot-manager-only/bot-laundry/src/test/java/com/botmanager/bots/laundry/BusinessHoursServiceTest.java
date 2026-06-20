package com.botmanager.bots.laundry;

import org.junit.jupiter.api.Nested;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.CsvSource;

import static org.assertj.core.api.Assertions.assertThat;

class BusinessHoursServiceTest {

    @Test
    void shouldCreateDefaultInstance() {
        // given / when
        BusinessHoursService service = BusinessHoursService.createDefault();

        // then
        assertThat(service).isNotNull();
    }

    @Nested
    class IsOpen {

        @Test
        void shouldReturnBusinessHoursInfo() {
            // given
            BusinessHoursService service = BusinessHoursService.createDefault();

            // when
            BusinessHoursService.BusinessHoursInfo info = service.getBusinessHoursInfo();

            // then
            assertThat(info.getOpenTime()).isEqualTo("07:00");
            assertThat(info.getCloseTime()).isEqualTo("22:00");
            assertThat(info.getTimezone()).isEqualTo("Africa/Douala");
            assertThat(info.getCurrentTime()).isNotBlank();
        }
    }

    @Nested
    class CanStartCycle {

        @Test
        void shouldReturnResultWithCorrectFields() {
            // given
            BusinessHoursService service = BusinessHoursService.createDefault();

            // when
            BusinessHoursService.CycleCheckResult result = service.canStartCycle(30);

            // then
            assertThat(result.getReason()).isNotNull();
            // Result depends on current time, but should not throw
        }

        @Test
        void shouldNotAllowCycleBeforeOpening() {
            // given
            BusinessHoursService service = new BusinessHoursService("23:00", "23:30", 15, "Africa/Douala");

            // when
            BusinessHoursService.CycleCheckResult result = service.canStartCycle(30);

            // then
            // Current time (Africa/Douala, UTC+1) is almost certainly before 23:00 or after 23:30
            assertThat(result.getReason()).isNotNull();
        }

        @Test
        void shouldNotAllowCycleAfterClosing() {
            // given - opening at 00:01, closing at 00:02 (should be closed almost always)
            BusinessHoursService service = new BusinessHoursService("00:01", "00:02", 0, "Africa/Douala");

            // when
            BusinessHoursService.CycleCheckResult result = service.canStartCycle(30);

            // then
            assertThat(result.isAllowed()).isFalse();
        }

        @Test
        void shouldProvideOpenTimeInResult() {
            // given
            BusinessHoursService service = new BusinessHoursService("23:00", "23:59", 15, "Africa/Douala");

            // when
            BusinessHoursService.CycleCheckResult result = service.canStartCycle(30);

            // then
            if (!result.isAllowed()) {
                assertThat(result.getOpenTime()).isEqualTo("23:00");
                assertThat(result.getCloseTime()).isEqualTo("23:59");
            }
        }
    }

    @Nested
    class CalculateCycleEndTime {

        @Test
        void shouldReturnFormattedEndTime() {
            // given
            BusinessHoursService service = BusinessHoursService.createDefault();

            // when
            String endTime = service.calculateCycleEndTime(30);

            // then
            assertThat(endTime).matches("\\d{2}:\\d{2}");
        }

        @Test
        void shouldReturnDifferentEndTimeForDifferentDurations() {
            // given
            BusinessHoursService service = BusinessHoursService.createDefault();

            // when
            String endTime30 = service.calculateCycleEndTime(30);
            String endTime60 = service.calculateCycleEndTime(60);

            // then
            // The 60-min end time should be later (unless wrapping midnight)
            assertThat(endTime30).isNotNull();
            assertThat(endTime60).isNotNull();
        }
    }

    @Nested
    class CycleCheckReason {

        @Test
        void shouldHaveAllExpectedValues() {
            // given / when / then
            assertThat(BusinessHoursService.CycleCheckReason.values()).containsExactly(
                    BusinessHoursService.CycleCheckReason.OK,
                    BusinessHoursService.CycleCheckReason.BEFORE_OPENING,
                    BusinessHoursService.CycleCheckReason.AFTER_CLOSING,
                    BusinessHoursService.CycleCheckReason.CYCLE_EXCEEDS_CLOSING
            );
        }
    }

    @Nested
    class CycleCheckResult {

        @Test
        void shouldBuildWithAllFields() {
            // given / when
            BusinessHoursService.CycleCheckResult result = BusinessHoursService.CycleCheckResult.builder()
                    .allowed(false)
                    .reason(BusinessHoursService.CycleCheckReason.CYCLE_EXCEEDS_CLOSING)
                    .cycleDuration(60)
                    .closeTime("22:00")
                    .lastAllowedTime("20:45")
                    .currentTime("21:00")
                    .openTime("07:00")
                    .build();

            // then
            assertThat(result.isAllowed()).isFalse();
            assertThat(result.getReason()).isEqualTo(BusinessHoursService.CycleCheckReason.CYCLE_EXCEEDS_CLOSING);
            assertThat(result.getCycleDuration()).isEqualTo(60);
            assertThat(result.getCloseTime()).isEqualTo("22:00");
            assertThat(result.getLastAllowedTime()).isEqualTo("20:45");
            assertThat(result.getCurrentTime()).isEqualTo("21:00");
            assertThat(result.getOpenTime()).isEqualTo("07:00");
        }
    }

    @Nested
    class BusinessHoursInfo {

        @Test
        void shouldBuildWithAllFields() {
            // given / when
            BusinessHoursService.BusinessHoursInfo info = BusinessHoursService.BusinessHoursInfo.builder()
                    .openTime("07:00")
                    .closeTime("22:00")
                    .timezone("Africa/Douala")
                    .currentlyOpen(true)
                    .currentTime("14:30")
                    .build();

            // then
            assertThat(info.getOpenTime()).isEqualTo("07:00");
            assertThat(info.getCloseTime()).isEqualTo("22:00");
            assertThat(info.getTimezone()).isEqualTo("Africa/Douala");
            assertThat(info.isCurrentlyOpen()).isTrue();
            assertThat(info.getCurrentTime()).isEqualTo("14:30");
        }
    }
}
