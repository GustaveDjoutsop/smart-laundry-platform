package com.smartlaundromat.payment.service.provider;

import com.smartlaundromat.payment.config.PaymentConfig;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.CsvSource;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.web.reactive.function.client.WebClient;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.when;

@ExtendWith(MockitoExtension.class)
class MtnMomoServiceTest {

    @Mock
    PaymentConfig paymentConfig;

    @Mock
    WebClient.Builder webClientBuilder;

    @InjectMocks
    MtnMomoService mtnMomoService;

    @Test
    void shouldReturnProviderName() {
        // when / then
        assertThat(mtnMomoService.getProviderName()).isEqualTo("MTN");
    }

    @Test
    void shouldReturnConfiguredTrueWhenAllKeysAreSet() {
        // given
        PaymentConfig.MtnConfig config = new PaymentConfig.MtnConfig();
        config.setSubscriptionKey("sub-key");
        config.setApiUserId("user-id");
        config.setApiKey("api-key");
        when(paymentConfig.getMtn()).thenReturn(config);

        // when / then
        assertThat(mtnMomoService.isConfigured()).isTrue();
    }

    @Test
    void shouldReturnConfiguredFalseWhenSubscriptionKeyIsMissing() {
        // given
        PaymentConfig.MtnConfig config = new PaymentConfig.MtnConfig();
        config.setSubscriptionKey(null);
        config.setApiUserId("user-id");
        config.setApiKey("api-key");
        when(paymentConfig.getMtn()).thenReturn(config);

        // when / then
        assertThat(mtnMomoService.isConfigured()).isFalse();
    }

    @Test
    void shouldReturnConfiguredFalseWhenApiUserIdIsMissing() {
        // given
        PaymentConfig.MtnConfig config = new PaymentConfig.MtnConfig();
        config.setSubscriptionKey("sub-key");
        config.setApiUserId(null);
        config.setApiKey("api-key");
        when(paymentConfig.getMtn()).thenReturn(config);

        // when / then
        assertThat(mtnMomoService.isConfigured()).isFalse();
    }

    @Test
    void shouldReturnConfiguredFalseWhenApiKeyIsMissing() {
        // given
        PaymentConfig.MtnConfig config = new PaymentConfig.MtnConfig();
        config.setSubscriptionKey("sub-key");
        config.setApiUserId("user-id");
        config.setApiKey(null);
        when(paymentConfig.getMtn()).thenReturn(config);

        // when / then
        assertThat(mtnMomoService.isConfigured()).isFalse();
    }

    @ParameterizedTest
    @CsvSource({
            "237612345678, 237612345678",
            "0612345678,   237612345678",
            "612345678,    237612345678",
            "+237612345678, 237612345678",
    })
    void shouldFormatPhoneNumberCorrectly(String input, String expected) {
        // when
        String result = mtnMomoService.formatPhoneNumber(input);

        // then
        assertThat(result).isEqualTo(expected);
    }

    @Test
    void shouldPassthroughUnrecognizedPhoneFormat() {
        // when
        String result = mtnMomoService.formatPhoneNumber("12345");

        // then
        assertThat(result).isEqualTo("12345");
    }
}
