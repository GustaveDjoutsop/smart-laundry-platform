package com.smartlaundromat.payment.service.provider;

import com.smartlaundromat.payment.config.PaymentConfig;
import org.junit.jupiter.api.BeforeEach;
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
class CampayServiceTest {

    @Mock
    PaymentConfig paymentConfig;

    @Mock
    WebClient.Builder webClientBuilder;

    @InjectMocks
    CampayService campayService;

    @Test
    void shouldReturnProviderName() {
        // when / then
        assertThat(campayService.getProviderName()).isEqualTo("CAMPAY");
    }

    @Test
    void shouldReturnConfiguredTrueWhenKeysAreSet() {
        // given
        PaymentConfig.CampayConfig config = new PaymentConfig.CampayConfig();
        config.setAppKey("test-key");
        config.setAppSecret("test-secret");
        when(paymentConfig.getCampay()).thenReturn(config);

        // when / then
        assertThat(campayService.isConfigured()).isTrue();
    }

    @Test
    void shouldReturnConfiguredFalseWhenAppKeyIsMissing() {
        // given
        PaymentConfig.CampayConfig config = new PaymentConfig.CampayConfig();
        config.setAppKey(null);
        config.setAppSecret("test-secret");
        when(paymentConfig.getCampay()).thenReturn(config);

        // when / then
        assertThat(campayService.isConfigured()).isFalse();
    }

    @Test
    void shouldReturnConfiguredFalseWhenAppSecretIsMissing() {
        // given
        PaymentConfig.CampayConfig config = new PaymentConfig.CampayConfig();
        config.setAppKey("test-key");
        config.setAppSecret(null);
        when(paymentConfig.getCampay()).thenReturn(config);

        // when / then
        assertThat(campayService.isConfigured()).isFalse();
    }

    @ParameterizedTest
    @CsvSource({
            "237612345678, 237612345678",   // already formatted with country code
            "0612345678,   237612345678",   // starts with 0, 10 digits
            "612345678,    237612345678",   // starts with 6, 9 digits
            "12345678,     237612345678",   // 8 digits
            "+237612345678, 237612345678",  // with + prefix
    })
    void shouldFormatPhoneNumberCorrectly(String input, String expected) {
        // when
        String result = campayService.formatPhoneNumber(input);

        // then
        assertThat(result).isEqualTo(expected);
    }

    @Test
    void shouldPassthroughUnrecognizedPhoneFormat() {
        // when
        String result = campayService.formatPhoneNumber("123");

        // then
        assertThat(result).isEqualTo("123");
    }
}
